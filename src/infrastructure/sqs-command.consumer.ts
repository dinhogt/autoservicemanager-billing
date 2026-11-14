import {
  DeleteMessageCommand,
  Message,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { BillingService } from '../application/billing.service';
import { emitMetric, withTelemetryContext } from '../common/observability';
import {
  BillingCommandType,
  parseBillingCommand,
} from '../application/messaging';

@Injectable()
export class SqsCommandConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SqsCommandConsumer.name);
  private timer?: NodeJS.Timeout;
  private stopped = false;

  constructor(
    private readonly client: SQSClient,
    private readonly queueUrl: string,
    private readonly billing: BillingService,
    private readonly pollingEnabled: boolean,
  ) {}

  onModuleInit(): void {
    if (this.pollingEnabled) void this.poll();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  async consumeOnce(): Promise<number> {
    const response = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 20,
        MessageAttributeNames: ['All'],
      }),
    );
    const messages = response.Messages ?? [];
    for (const message of messages) await this.process(message);
    return messages.length;
  }

  private async poll(): Promise<void> {
    if (this.stopped) return;
    try {
      await this.consumeOnce();
    } catch (error) {
      this.logger.error(
        'SQS polling failed',
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      if (!this.stopped) this.timer = setTimeout(() => void this.poll(), 1000);
    }
  }

  private async process(message: Message): Promise<void> {
    if (!message.Body || !message.ReceiptHandle) return;
    const command = parseBillingCommand(unwrap(message.Body));
    await withTelemetryContext(
      {
        correlationId: command.correlationId,
        sagaId: command.sagaId,
        messageId: command.messageId,
        aggregateId: command.aggregateId,
      },
      async () => {
        const startedAt = Date.now();
        emitMetric({
          event: 'billing_command_received',
          metric: 'QueueMessageAge',
          unit: 'Milliseconds',
          value: Math.max(0, startedAt - Date.parse(command.occurredAt)),
          operation: command.messageType,
          outcome: 'received',
        });
        switch (command.messageType) {
          case BillingCommandType.AuthorizePayment:
            await this.billing.authorize(command);
            break;
          case BillingCommandType.RefundPayment:
            await this.billing.refund(command.aggregateId);
            break;
        }
        await this.client.send(
          new DeleteMessageCommand({
            QueueUrl: this.queueUrl,
            ReceiptHandle: message.ReceiptHandle,
          }),
        );
        emitMetric({
          event: 'billing_command_processed',
          metric: 'BillingDuration',
          unit: 'Milliseconds',
          value: Date.now() - startedAt,
          durationMs: Date.now() - startedAt,
          operation: command.messageType,
          outcome: 'success',
        });
      },
    );
  }
}

function unwrap(body: string): unknown {
  const parsed = JSON.parse(body) as unknown;
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'Message' in parsed &&
    typeof (parsed as { Message?: unknown }).Message === 'string'
  ) {
    return JSON.parse((parsed as { Message: string }).Message) as unknown;
  }
  return parsed;
}
