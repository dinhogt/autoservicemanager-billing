import { BillingRecord } from '../domain/billing';
import type { BillingEvent } from './messaging';

export const BILLING_REPOSITORY = Symbol('BILLING_REPOSITORY');
export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');
export const EVENT_PUBLISHER = Symbol('EVENT_PUBLISHER');

export interface BillingRepository {
  createIfAbsent(record: BillingRecord): Promise<BillingRecord>;
  findById(id: string): Promise<BillingRecord | null>;
  findByPaymentId(paymentId: string): Promise<BillingRecord | null>;
  save(record: BillingRecord): Promise<void>;
  markWebhookProcessed(eventId: string): Promise<boolean>;
}

export interface PaymentGateway {
  createPayment(input: {
    billingId: string;
    amount: number;
    description: string;
    customerEmail: string;
  }): Promise<{ id: string; checkoutUrl: string }>;
  getPayment(paymentId: string): Promise<{ approved: boolean }>;
  refund(paymentId: string): Promise<void>;
}

export interface EventPublisher {
  publish(event: BillingEvent): Promise<void>;
}
