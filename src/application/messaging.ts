export const MESSAGE_SCHEMA_VERSION = '1.0' as const;

export const BillingCommandType = {
  AuthorizePayment: 'payment.authorize',
  RefundPayment: 'payment.refund',
} as const;

export const BillingEventType = {
  PaymentAuthorized: 'payment.authorized',
  PaymentFailed: 'payment.failed',
  PaymentTimedOut: 'payment.timed-out',
  RefundCompleted: 'refund.completed',
  RefundFailed: 'refund.failed',
} as const;

export interface MessageEnvelope<TType extends string, TPayload> {
  schemaVersion: typeof MESSAGE_SCHEMA_VERSION;
  messageId: string;
  messageType: TType;
  occurredAt: string;
  correlationId: string;
  sagaId?: string;
  aggregateId: string;
  causationId?: string;
  source: string;
  payload: TPayload;
}

export type BillingCommand = MessageEnvelope<
  (typeof BillingCommandType)[keyof typeof BillingCommandType],
  {
    amount?: number;
    customerEmail?: string;
    description?: string;
    paymentId?: string;
    reason?: string;
  }
>;

export type BillingEvent = MessageEnvelope<
  (typeof BillingEventType)[keyof typeof BillingEventType],
  Record<string, unknown>
>;

export function parseBillingCommand(input: unknown): BillingCommand {
  if (!isRecord(input)) throw new Error('Invalid command envelope');
  for (const field of [
    'messageId',
    'messageType',
    'occurredAt',
    'correlationId',
    'aggregateId',
    'source',
  ]) {
    if (typeof input[field] !== 'string' || input[field].length === 0) {
      throw new Error(`Invalid command field: ${field}`);
    }
  }
  if (input.schemaVersion !== MESSAGE_SCHEMA_VERSION) {
    throw new Error('Unsupported schema version');
  }
  if (
    !Object.values(BillingCommandType).includes(
      input.messageType as BillingCommand['messageType'],
    )
  ) {
    throw new Error('Unsupported billing command');
  }
  if (!isRecord(input.payload)) throw new Error('Invalid command payload');
  return input as unknown as BillingCommand;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
