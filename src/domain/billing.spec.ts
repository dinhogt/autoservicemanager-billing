import { Billing, BillingRecord, DomainError } from './billing';

const now = new Date('2026-01-01T00:00:00.000Z');
const command = {
  commandId: 'billing-1',
  orderId: 'order-1',
  customerEmail: 'customer@example.com',
  amount: 100,
  description: 'Oil change',
};

describe('Billing domain', () => {
  it('creates a valid budget', () => {
    expect(Billing.create(command, now)).toMatchObject({
      id: 'billing-1',
      status: 'BUDGET_CREATED',
      createdAt: now.toISOString(),
    });
  });

  it.each([
    [{ ...command, orderId: ' ' }, 'INVALID_ORDER'],
    [{ ...command, amount: 0 }, 'INVALID_AMOUNT'],
    [{ ...command, amount: Number.NaN }, 'INVALID_AMOUNT'],
    [{ ...command, customerEmail: 'invalid' }, 'INVALID_EMAIL'],
  ])('rejects invalid budget data', (invalid, code) => {
    expect(() => Billing.create(invalid, now)).toThrow(
      expect.objectContaining<Partial<DomainError>>({ code }),
    );
  });

  it('moves through payment states', () => {
    const budget = Billing.create(command, now);
    const pending = Billing.paymentPending(
      budget,
      'payment-1',
      'https://pay',
      now,
    );
    expect(pending).toMatchObject({
      status: 'PAYMENT_PENDING',
      paymentId: 'payment-1',
    });
    expect(Billing.paymentResult(pending, true, now).status).toBe('PAID');
    expect(Billing.paymentResult(pending, false, now).status).toBe(
      'PAYMENT_FAILED',
    );
  });

  it('refunds a paid billing', () => {
    expect(Billing.refunded(record('PAID'), now).status).toBe('REFUNDED');
  });

  it('rejects invalid transitions', () => {
    expect(() =>
      Billing.paymentPending(record('PAID'), 'p', 'url', now),
    ).toThrow('payment already requested');
    expect(() => Billing.paymentResult(record('PAID'), true, now)).toThrow(
      'payment is not pending',
    );
    expect(() => Billing.refunded(record('PAYMENT_PENDING'), now)).toThrow(
      'only paid billing',
    );
  });
});

function record(status: BillingRecord['status']): BillingRecord {
  return { ...Billing.create(command, now), status, paymentId: 'payment-1' };
}
