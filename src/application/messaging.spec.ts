import { parseBillingCommand } from './messaging';

const valid = {
  schemaVersion: '1.0',
  messageId: 'm1',
  messageType: 'payment.authorize',
  occurredAt: '2026-01-01T00:00:00.000Z',
  correlationId: 'c1',
  aggregateId: 'o1',
  source: 'test',
  payload: {},
};

describe('billing messaging contract', () => {
  it('accepts both canonical commands', () => {
    expect(parseBillingCommand(valid).messageType).toBe('payment.authorize');
    expect(
      parseBillingCommand({ ...valid, messageType: 'payment.refund' })
        .messageType,
    ).toBe('payment.refund');
  });

  it.each([
    null,
    { ...valid, messageId: '' },
    { ...valid, schemaVersion: '2.0' },
    { ...valid, messageType: 'PaymentApproved' },
    { ...valid, payload: null },
  ])('rejects malformed input %#', (input) => {
    expect(() => parseBillingCommand(input)).toThrow();
  });
});
