import { BillingService } from './billing.service';
import { BillingRepository, EventPublisher, PaymentGateway } from './ports';
import { BillingRecord, CreateBudgetCommand } from '../domain/billing';
import { BillingCommand } from './messaging';

const command: CreateBudgetCommand = {
  commandId: 'billing-1',
  orderId: 'order-1',
  customerEmail: 'customer@example.com',
  amount: 100,
  description: 'Service',
};

describe('BillingService', () => {
  let records: Map<string, BillingRecord>;
  let repository: jest.Mocked<BillingRepository>;
  let payments: jest.Mocked<PaymentGateway>;
  let events: jest.Mocked<EventPublisher>;
  let service: BillingService;

  beforeEach(() => {
    records = new Map();
    repository = {
      findById: jest.fn(async (id) => records.get(id) ?? null),
      findByPaymentId: jest.fn(async (id) => {
        return (
          [...records.values()].find((record) => record.paymentId === id) ??
          null
        );
      }),
      createIfAbsent: jest.fn(async (record) => {
        const result = records.get(record.id) ?? record;
        records.set(result.id, result);
        return result;
      }),
      save: jest.fn(async (record) => {
        records.set(record.id, record);
      }),
      markWebhookProcessed: jest.fn().mockResolvedValue(true),
    };
    payments = {
      createPayment: jest.fn().mockResolvedValue({
        id: 'payment-1',
        checkoutUrl: 'https://checkout',
      }),
      getPayment: jest.fn().mockResolvedValue({ approved: true }),
      refund: jest.fn().mockResolvedValue(undefined),
    };
    events = { publish: jest.fn().mockResolvedValue(undefined) };
    service = new BillingService(repository, payments, events);
  });

  it('creates a budget once', async () => {
    const created = await service.createBudget(command);
    expect(created.status).toBe('BUDGET_CREATED');
    expect(events.publish).not.toHaveBeenCalled();
    expect(await service.createBudget(command)).toBe(created);
    expect(repository.createIfAbsent).toHaveBeenCalledTimes(1);
  });

  it('requests payment once', async () => {
    await service.createBudget(command);
    const pending = await service.requestPayment(command.commandId);
    expect(pending).toMatchObject({
      status: 'PAYMENT_PENDING',
      paymentId: 'payment-1',
    });
    expect(await service.requestPayment(command.commandId)).toBe(pending);
    expect(payments.createPayment).toHaveBeenCalledTimes(1);
  });

  it('authorizes a canonical command and applies payload defaults', async () => {
    const result = await service.authorize(canonicalCommand());
    expect(result.status).toBe('PAYMENT_PENDING');
    expect(repository.createIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'billing-1',
        correlationId: 'corr-1',
      }),
    );
  });

  it('rejects authorization without amount and publishes gateway failures', async () => {
    await expect(
      service.authorize(canonicalCommand({ amount: undefined })),
    ).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
    payments.createPayment.mockRejectedValueOnce(new Error('gateway down'));
    await expect(service.authorize(canonicalCommand())).rejects.toThrow(
      'gateway down',
    );
    expect(events.publish).toHaveBeenCalledWith(
      expect.objectContaining({ messageType: 'payment.failed' }),
    );
  });

  it('processes approved and rejected webhooks', async () => {
    await createPending(service);
    expect(
      (await service.processPaymentWebhook('event-1', 'payment-1'))?.status,
    ).toBe('PAID');
    expect(events.publish).toHaveBeenLastCalledWith(
      expect.objectContaining({ messageType: 'payment.authorized' }),
    );

    const pending = {
      ...records.get('billing-1')!,
      status: 'PAYMENT_PENDING' as const,
    };
    records.set(pending.id, pending);
    payments.getPayment.mockResolvedValue({ approved: false });
    expect(
      (await service.processPaymentWebhook('event-2', 'payment-1'))?.status,
    ).toBe('PAYMENT_FAILED');
    expect(events.publish).toHaveBeenLastCalledWith(
      expect.objectContaining({ messageType: 'payment.failed' }),
    );
  });

  it('ignores duplicate and already resolved webhooks', async () => {
    repository.markWebhookProcessed.mockResolvedValue(false);
    expect(
      await service.processPaymentWebhook('event-1', 'payment-1'),
    ).toBeNull();

    repository.markWebhookProcessed.mockResolvedValue(true);
    records.set('billing-1', paid());
    expect(await service.processPaymentWebhook('event-2', 'payment-1')).toEqual(
      paid(),
    );
    expect(payments.getPayment).not.toHaveBeenCalled();
  });

  it('fails when webhook payment has no billing', async () => {
    await expect(
      service.processPaymentWebhook('event', 'missing'),
    ).rejects.toMatchObject({
      code: 'BILLING_NOT_FOUND',
    });
  });

  it('compensates an approved payment when persistence fails', async () => {
    await createPending(service);
    repository.save.mockRejectedValueOnce(new Error('DynamoDB unavailable'));
    await expect(
      service.processPaymentWebhook('event', 'payment-1'),
    ).rejects.toThrow('DynamoDB unavailable');
    expect(payments.refund).toHaveBeenCalledWith('payment-1');
  });

  it('does not compensate a rejected payment persistence failure', async () => {
    await createPending(service);
    payments.getPayment.mockResolvedValue({ approved: false });
    repository.save.mockRejectedValueOnce(new Error('DynamoDB unavailable'));
    await expect(
      service.processPaymentWebhook('event', 'payment-1'),
    ).rejects.toThrow();
    expect(payments.refund).not.toHaveBeenCalled();
  });

  it('refunds once and publishes', async () => {
    records.set('billing-1', paid());
    const refunded = await service.refund('billing-1');
    expect(refunded.status).toBe('REFUNDED');
    expect(events.publish).toHaveBeenLastCalledWith(
      expect.objectContaining({ messageType: 'refund.completed' }),
    );
    expect(await service.refund('billing-1')).toBe(refunded);
    expect(payments.refund).toHaveBeenCalledTimes(1);
  });

  it('publishes timeout and refund failure outcomes', async () => {
    await createPending(service);
    await service.timeout('billing-1');
    expect(events.publish).toHaveBeenCalledWith(
      expect.objectContaining({ messageType: 'payment.timed-out' }),
    );
    records.set('billing-1', paid());
    payments.refund.mockRejectedValueOnce(new Error('refund unavailable'));
    await expect(service.refund('billing-1')).rejects.toThrow(
      'refund unavailable',
    );
    expect(events.publish).toHaveBeenLastCalledWith(
      expect.objectContaining({ messageType: 'refund.failed' }),
    );
  });

  it('rejects missing billings and payment ids', async () => {
    await expect(service.findById('missing')).rejects.toMatchObject({
      code: 'BILLING_NOT_FOUND',
    });
    records.set('billing-1', {
      ...paid(),
      paymentId: undefined,
    });
    await expect(service.refund('billing-1')).rejects.toMatchObject({
      code: 'PAYMENT_ID_MISSING',
    });
  });
});

async function createPending(service: BillingService): Promise<void> {
  await service.createBudget(command);
  await service.requestPayment(command.commandId);
}

function paid(): BillingRecord {
  return {
    id: 'billing-1',
    orderId: 'order-1',
    customerEmail: 'customer@example.com',
    amount: 100,
    description: 'Service',
    status: 'PAID',
    paymentId: 'payment-1',
    paymentUrl: 'https://checkout',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function canonicalCommand(
  payload: BillingCommand['payload'] = { amount: 100 },
): BillingCommand {
  return {
    schemaVersion: '1.0',
    messageId: 'message-1',
    messageType: 'payment.authorize',
    occurredAt: '2026-01-01T00:00:00.000Z',
    correlationId: 'corr-1',
    aggregateId: 'billing-1',
    source: 'test',
    payload,
  };
}
