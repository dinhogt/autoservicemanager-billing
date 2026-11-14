import { SQSClient } from '@aws-sdk/client-sqs';
import { BillingService } from '../application/billing.service';
import { SqsCommandConsumer } from './sqs-command.consumer';

describe('SqsCommandConsumer', () => {
  let send: jest.Mock;
  let billing: jest.Mocked<BillingService>;
  let consumer: SqsCommandConsumer;

  beforeEach(() => {
    send = jest.fn();
    billing = {
      authorize: jest.fn().mockResolvedValue({}),
      refund: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<BillingService>;
    consumer = new SqsCommandConsumer(
      { send } as unknown as SQSClient,
      'https://sqs.example.com/commands',
      billing,
      false,
    );
  });

  it.each([
    [
      {
        schemaVersion: '1.0',
        messageId: 'command-1',
        messageType: 'payment.authorize',
        occurredAt: '2026-01-01T00:00:00.000Z',
        correlationId: 'corr-1',
        aggregateId: 'order-1',
        source: 'test',
        payload: { amount: 10 },
      },
      'authorize',
    ],
    [
      {
        schemaVersion: '1.0',
        messageId: 'command-3',
        messageType: 'payment.refund',
        occurredAt: '2026-01-01T00:00:00.000Z',
        correlationId: 'corr-1',
        aggregateId: 'billing-1',
        source: 'test',
        payload: { paymentId: 'pay-1' },
      },
      'refund',
    ],
  ])('handles and acknowledges %s', async (command, method) => {
    send.mockResolvedValueOnce({
      Messages: [{ Body: JSON.stringify(command), ReceiptHandle: 'receipt' }],
    });
    send.mockResolvedValueOnce({});
    await expect(consumer.consumeOnce()).resolves.toBe(1);
    expect(billing[method as keyof BillingService]).toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('handles an empty queue and malformed envelope', async () => {
    send.mockResolvedValueOnce({});
    await expect(consumer.consumeOnce()).resolves.toBe(0);

    send.mockResolvedValueOnce({ Messages: [{ Body: '{}' }, {}] });
    await expect(consumer.consumeOnce()).resolves.toBe(2);
  });

  it('does not acknowledge unsupported commands', async () => {
    send.mockResolvedValueOnce({
      Messages: [
        {
          Body: '{"schemaVersion":"1.0","messageId":"1","messageType":"unknown","occurredAt":"2026-01-01T00:00:00Z","correlationId":"c","aggregateId":"o","source":"test","payload":{}}',
          ReceiptHandle: 'receipt',
        },
      ],
    });
    await expect(consumer.consumeOnce()).rejects.toThrow(
      'Unsupported billing command',
    );
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('supports lifecycle with polling disabled', () => {
    expect(consumer.onModuleInit()).toBeUndefined();
    expect(consumer.onModuleDestroy()).toBeUndefined();
  });

  it('polls when enabled and stops cleanly', async () => {
    jest.useFakeTimers();
    send.mockResolvedValue({ Messages: [] });
    const polling = new SqsCommandConsumer(
      { send } as unknown as SQSClient,
      'queue',
      billing,
      true,
    );
    polling.onModuleInit();
    await Promise.resolve();
    await Promise.resolve();
    expect(send).toHaveBeenCalled();
    polling.onModuleDestroy();
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('recovers polling failures and schedules retry', async () => {
    jest.useFakeTimers();
    send
      .mockRejectedValueOnce(new Error('SQS down'))
      .mockResolvedValue({ Messages: [] });
    const polling = new SqsCommandConsumer(
      { send } as unknown as SQSClient,
      'queue',
      billing,
      true,
    );
    const pollingLogger = (
      polling as unknown as { logger: { error: (message: string) => void } }
    ).logger;
    jest.spyOn(pollingLogger, 'error').mockImplementation(() => undefined);
    polling.onModuleInit();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    jest.runOnlyPendingTimers();
    polling.onModuleDestroy();
    jest.useRealTimers();
    expect(pollingLogger.error).toHaveBeenCalled();
  });
});
