export type BillingStatus =
  'BUDGET_CREATED' | 'PAYMENT_PENDING' | 'PAID' | 'PAYMENT_FAILED' | 'REFUNDED';

export interface BillingRecord {
  id: string;
  orderId: string;
  customerEmail: string;
  amount: number;
  description: string;
  status: BillingStatus;
  paymentId?: string;
  paymentUrl?: string;
  createdAt: string;
  updatedAt: string;
  correlationId?: string;
  sagaId?: string;
  causationId?: string;
}

export interface CreateBudgetCommand {
  commandId: string;
  orderId: string;
  customerEmail: string;
  amount: number;
  description: string;
  correlationId?: string;
  sagaId?: string;
  causationId?: string;
}

export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export class Billing {
  static create(command: CreateBudgetCommand, now: Date): BillingRecord {
    if (!command.orderId.trim()) {
      throw new DomainError('orderId is required', 'INVALID_ORDER');
    }
    if (!Number.isFinite(command.amount) || command.amount <= 0) {
      throw new DomainError('amount must be positive', 'INVALID_AMOUNT');
    }
    if (!command.customerEmail.includes('@')) {
      throw new DomainError('customerEmail is invalid', 'INVALID_EMAIL');
    }

    const timestamp = now.toISOString();
    return {
      id: command.commandId,
      orderId: command.orderId,
      customerEmail: command.customerEmail,
      amount: command.amount,
      description: command.description,
      status: 'BUDGET_CREATED',
      createdAt: timestamp,
      updatedAt: timestamp,
      correlationId: command.correlationId,
      sagaId: command.sagaId,
      causationId: command.causationId,
    };
  }

  static paymentPending(
    billing: BillingRecord,
    paymentId: string,
    paymentUrl: string,
    now: Date,
  ): BillingRecord {
    if (billing.status !== 'BUDGET_CREATED') {
      throw new DomainError('payment already requested', 'INVALID_TRANSITION');
    }
    return {
      ...billing,
      paymentId,
      paymentUrl,
      status: 'PAYMENT_PENDING',
      updatedAt: now.toISOString(),
    };
  }

  static paymentResult(
    billing: BillingRecord,
    approved: boolean,
    now: Date,
  ): BillingRecord {
    if (billing.status !== 'PAYMENT_PENDING') {
      throw new DomainError('payment is not pending', 'INVALID_TRANSITION');
    }
    return {
      ...billing,
      status: approved ? 'PAID' : 'PAYMENT_FAILED',
      updatedAt: now.toISOString(),
    };
  }

  static refunded(billing: BillingRecord, now: Date): BillingRecord {
    if (billing.status !== 'PAID') {
      throw new DomainError(
        'only paid billing can be refunded',
        'INVALID_TRANSITION',
      );
    }
    return { ...billing, status: 'REFUNDED', updatedAt: now.toISOString() };
  }
}
