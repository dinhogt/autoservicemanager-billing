import { Inject, Injectable } from '@nestjs/common';
import {
  Billing,
  BillingRecord,
  CreateBudgetCommand,
  DomainError,
} from '../domain/billing';
import {
  BILLING_REPOSITORY,
  BillingRepository,
  EVENT_PUBLISHER,
  EventPublisher,
  PAYMENT_GATEWAY,
  PaymentGateway,
} from './ports';
import {
  BillingCommand,
  BillingEvent,
  BillingEventType,
  MESSAGE_SCHEMA_VERSION,
} from './messaging';
import { randomUUID } from 'node:crypto';
import { emitMetric } from '../common/observability';

@Injectable()
export class BillingService {
  constructor(
    @Inject(BILLING_REPOSITORY) private readonly repository: BillingRepository,
    @Inject(PAYMENT_GATEWAY) private readonly payments: PaymentGateway,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
  ) {}

  async createBudget(command: CreateBudgetCommand): Promise<BillingRecord> {
    const existing = await this.repository.findById(command.commandId);
    if (existing) return existing;

    const budget = Billing.create(command, new Date());
    const created = await this.repository.createIfAbsent(budget);
    return created;
  }

  async authorize(command: BillingCommand): Promise<BillingRecord> {
    const amount = command.payload.amount;
    if (typeof amount !== 'number') {
      throw new DomainError('amount is required', 'INVALID_AMOUNT');
    }
    await this.createBudget({
      commandId: command.aggregateId,
      orderId: command.aggregateId,
      amount,
      customerEmail: command.payload.customerEmail ?? 'cliente@local.test',
      description:
        command.payload.description ?? `Ordem ${command.aggregateId}`,
      correlationId: command.correlationId,
      sagaId: command.sagaId,
      causationId: command.messageId,
    });
    try {
      return await this.requestPayment(command.aggregateId);
    } catch (error) {
      const billing = await this.requiredBilling(command.aggregateId);
      await this.events.publish(
        this.event(BillingEventType.PaymentFailed, billing, {
          reason: error instanceof Error ? error.message : 'payment failed',
        }),
      );
      throw error;
    }
  }

  async requestPayment(billingId: string): Promise<BillingRecord> {
    const billing = await this.requiredBilling(billingId);
    if (billing.status === 'PAYMENT_PENDING' || billing.status === 'PAID')
      return billing;

    const payment = await this.payments.createPayment({
      billingId: billing.id,
      amount: billing.amount,
      description: billing.description,
      customerEmail: billing.customerEmail,
    });
    const pending = Billing.paymentPending(
      billing,
      payment.id,
      payment.checkoutUrl,
      new Date(),
    );
    await this.repository.save(pending);
    return pending;
  }

  async processPaymentWebhook(
    eventId: string,
    paymentId: string,
  ): Promise<BillingRecord | null> {
    const firstProcessing = await this.repository.markWebhookProcessed(eventId);
    if (!firstProcessing) return null;

    const billing = await this.repository.findByPaymentId(paymentId);
    if (!billing)
      throw new DomainError(
        'billing not found for payment',
        'BILLING_NOT_FOUND',
      );
    if (billing.status !== 'PAYMENT_PENDING') return billing;

    const result = await this.payments.getPayment(paymentId);
    const updated = Billing.paymentResult(billing, result.approved, new Date());
    emitMetric({
      event: result.approved ? 'payment_authorized' : 'payment_failed',
      metric: 'PaymentOutcome',
      operation: 'payment.webhook',
      outcome: result.approved ? 'authorized' : 'rejected',
    });
    try {
      await this.repository.save(updated);
      await this.events.publish(
        this.event(
          result.approved
            ? BillingEventType.PaymentAuthorized
            : BillingEventType.PaymentFailed,
          updated,
        ),
      );
      return updated;
    } catch (error) {
      if (result.approved) await this.payments.refund(paymentId);
      throw error;
    }
  }

  async refund(billingId: string): Promise<BillingRecord> {
    const billing = await this.requiredBilling(billingId);
    if (billing.status === 'REFUNDED') return billing;
    if (!billing.paymentId) {
      throw new DomainError('payment id is missing', 'PAYMENT_ID_MISSING');
    }

    try {
      await this.payments.refund(billing.paymentId);
    } catch (error) {
      await this.events.publish(
        this.event(BillingEventType.RefundFailed, billing, {
          reason: error instanceof Error ? error.message : 'refund failed',
        }),
      );
      throw error;
    }
    const refunded = Billing.refunded(billing, new Date());
    await this.repository.save(refunded);
    await this.events.publish(
      this.event(BillingEventType.RefundCompleted, refunded),
    );
    emitMetric({
      event: 'refund_completed',
      metric: 'RefundOutcome',
      operation: 'refund',
      outcome: 'success',
    });
    return refunded;
  }

  async timeout(billingId: string): Promise<BillingRecord> {
    const billing = await this.requiredBilling(billingId);
    if (billing.status === 'PAYMENT_PENDING') {
      await this.events.publish(
        this.event(BillingEventType.PaymentTimedOut, billing, {
          reason: 'payment deadline expired',
        }),
      );
    }
    return billing;
  }

  async findById(id: string): Promise<BillingRecord> {
    return this.requiredBilling(id);
  }

  private async requiredBilling(id: string): Promise<BillingRecord> {
    const billing = await this.repository.findById(id);
    if (!billing)
      throw new DomainError('billing not found', 'BILLING_NOT_FOUND');
    return billing;
  }

  private event(
    messageType: BillingEvent['messageType'],
    billing: BillingRecord,
    extraPayload: Record<string, unknown> = {},
  ): BillingEvent {
    return {
      schemaVersion: MESSAGE_SCHEMA_VERSION,
      messageId: randomUUID(),
      messageType,
      aggregateId: billing.orderId,
      correlationId: billing.correlationId ?? billing.orderId,
      sagaId: billing.sagaId,
      causationId: billing.causationId,
      occurredAt: new Date().toISOString(),
      source: 'autoservicemanager-billing',
      payload: {
        orderId: billing.orderId,
        status: billing.status,
        amount: billing.amount,
        paymentId: billing.paymentId,
        ...extraPayload,
      },
    };
  }
}
