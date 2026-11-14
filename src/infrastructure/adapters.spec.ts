import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { SNSClient } from '@aws-sdk/client-sns';
import { HttpService } from '@nestjs/axios';
import { of } from 'rxjs';
import { BillingRecord } from '../domain/billing';
import { DynamoBillingRepository } from './dynamo-billing.repository';
import { MercadoPagoAdapter } from './mercado-pago.adapter';
import { SnsEventPublisher } from './sns-event.publisher';
import { WebhookSignatureService } from './webhook-signature.service';
import { createHmac } from 'node:crypto';

const record: BillingRecord = {
  id: 'billing-1',
  orderId: 'order-1',
  customerEmail: 'customer@example.com',
  amount: 100,
  description: 'Service',
  status: 'PAYMENT_PENDING',
  paymentId: 'payment-1',
  paymentUrl: 'https://checkout',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('DynamoBillingRepository', () => {
  const item = {
    PK: 'BILLING#billing-1',
    SK: 'BILLING',
    GSI1PK: 'PAYMENT#payment-1',
    ...record,
  };
  let send: jest.Mock;
  let repository: DynamoBillingRepository;

  beforeEach(() => {
    send = jest.fn();
    repository = new DynamoBillingRepository({ send }, 'billing-table');
  });

  it('creates, saves and reads records', async () => {
    send
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Item: item })
      .mockResolvedValueOnce({});
    expect(await repository.createIfAbsent(record)).toBe(record);
    expect(await repository.findById(record.id)).toEqual(record);
    await expect(repository.save(record)).resolves.toBeUndefined();
  });

  it('returns null for missing records', async () => {
    send.mockResolvedValue({});
    await expect(repository.findById('missing')).resolves.toBeNull();
  });

  it('returns an existing record on conditional creation conflict', async () => {
    send
      .mockRejectedValueOnce(conditionalError())
      .mockResolvedValueOnce({ Item: item });
    await expect(repository.createIfAbsent(record)).resolves.toEqual(record);
  });

  it('rethrows conflict when the existing record disappears', async () => {
    send.mockRejectedValueOnce(conditionalError()).mockResolvedValueOnce({});
    await expect(repository.createIfAbsent(record)).rejects.toBeInstanceOf(
      ConditionalCheckFailedException,
    );
  });

  it('rethrows non-conditional create errors', async () => {
    send.mockRejectedValue(new Error('network'));
    await expect(repository.createIfAbsent(record)).rejects.toThrow('network');
  });

  it('queries by payment id', async () => {
    send
      .mockResolvedValueOnce({ Items: [item] })
      .mockResolvedValueOnce({ Items: [] });
    await expect(repository.findByPaymentId('payment-1')).resolves.toEqual(
      record,
    );
    await expect(repository.findByPaymentId('missing')).resolves.toBeNull();
  });

  it('marks webhooks idempotently', async () => {
    send.mockResolvedValueOnce({}).mockRejectedValueOnce(conditionalError());
    await expect(repository.markWebhookProcessed('event-1')).resolves.toBe(
      true,
    );
    await expect(repository.markWebhookProcessed('event-1')).resolves.toBe(
      false,
    );
  });

  it('rethrows webhook storage errors', async () => {
    send.mockRejectedValue(new Error('network'));
    await expect(repository.markWebhookProcessed('event')).rejects.toThrow(
      'network',
    );
  });

  it('stores records without payment index when absent', async () => {
    await repository.save({ ...record, paymentId: undefined });
    const command = send.mock.calls[0][0] as {
      input: { Item: { GSI1PK?: string } };
    };
    expect(command.input.Item.GSI1PK).toBeUndefined();
  });
});

describe('MercadoPagoAdapter', () => {
  const post = jest.fn();
  const get = jest.fn();
  const http = { post, get } as unknown as HttpService;
  const adapter = new MercadoPagoAdapter(
    http,
    'token',
    'https://api.example.com',
  );

  beforeEach(() => jest.clearAllMocks());

  it('creates PIX payment using the billing id as idempotency key', async () => {
    post.mockReturnValue(
      of({
        data: {
          id: 123,
          point_of_interaction: {
            transaction_data: { ticket_url: 'https://pix' },
          },
        },
      }),
    );
    await expect(
      adapter.createPayment({
        billingId: 'billing-1',
        amount: 100,
        description: 'Service',
        customerEmail: 'customer@example.com',
      }),
    ).resolves.toEqual({ id: '123', checkoutUrl: 'https://pix' });
    expect(post).toHaveBeenCalledWith(
      'https://api.example.com/v1/payments',
      expect.objectContaining({ payment_method_id: 'pix' }),
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Idempotency-Key': 'billing-1' }),
      }),
    );
  });

  it('uses init_point and rejects a response without checkout URL', async () => {
    post.mockReturnValueOnce(
      of({ data: { id: '1', init_point: 'https://checkout' } }),
    );
    await expect(
      adapter.createPayment({
        billingId: 'id',
        amount: 1,
        description: 'x',
        customerEmail: 'a@b.com',
      }),
    ).resolves.toMatchObject({ checkoutUrl: 'https://checkout' });
    post.mockReturnValueOnce(of({ data: { id: '1' } }));
    await expect(
      adapter.createPayment({
        billingId: 'id',
        amount: 1,
        description: 'x',
        customerEmail: 'a@b.com',
      }),
    ).rejects.toThrow('no checkout URL');
  });

  it('reads payment status and refunds', async () => {
    get.mockReturnValueOnce(of({ data: { id: 1, status: 'approved' } }));
    get.mockReturnValueOnce(of({ data: { id: 1, status: 'rejected' } }));
    post.mockReturnValue(of({ data: {} }));
    await expect(adapter.getPayment('1')).resolves.toEqual({ approved: true });
    await expect(adapter.getPayment('1')).resolves.toEqual({ approved: false });
    await expect(adapter.refund('1')).resolves.toBeUndefined();
  });
});

describe('SNS and webhook adapters', () => {
  it('publishes typed JSON to SNS', async () => {
    const send = jest.fn().mockResolvedValue({});
    const publisher = new SnsEventPublisher(
      { send } as unknown as SNSClient,
      'arn:aws:sns:us-east-1:1:events',
    );
    await publisher.publish({
      schemaVersion: '1.0',
      messageId: 'event-1',
      messageType: 'payment.authorized',
      aggregateId: 'order-1',
      correlationId: 'corr-1',
      occurredAt: '2026-01-01T00:00:00.000Z',
      source: 'test',
      payload: { status: 'PAID' },
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.any(Object) }),
    );
  });

  it('validates Mercado Pago signatures and configuration', () => {
    const secret = 'secret';
    const ts = '123';
    const digest = createHmac('sha256', secret)
      .update('id:payment-1;request-id:request-1;ts:123;')
      .digest('hex');
    const service = new WebhookSignatureService(secret, true);
    expect(
      service.validate({
        dataId: 'payment-1',
        requestId: 'request-1',
        signature: `ts=${ts},v1=${digest}`,
      }),
    ).toBe(true);
    expect(service.validate({ dataId: 'x', requestId: 'x' })).toBe(false);
    expect(
      service.validate({ dataId: 'x', requestId: 'x', signature: 'ts=1' }),
    ).toBe(false);
    expect(
      service.validate({
        dataId: 'x',
        requestId: 'x',
        signature: 'ts=1,v1=bad',
      }),
    ).toBe(false);
    expect(
      new WebhookSignatureService('', true).validate({
        dataId: 'x',
        requestId: 'x',
        signature: 'ts=1,v1=x',
      }),
    ).toBe(false);
    expect(
      new WebhookSignatureService('', false).validate({
        dataId: 'x',
        requestId: 'x',
      }),
    ).toBe(true);
  });
});

function conditionalError(): ConditionalCheckFailedException {
  return new ConditionalCheckFailedException({
    message: 'exists',
    $metadata: {},
  });
}
