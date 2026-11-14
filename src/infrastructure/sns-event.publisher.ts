import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { EventPublisher } from '../application/ports';
import { BillingEvent } from '../application/messaging';

export class SnsEventPublisher implements EventPublisher {
  constructor(
    private readonly client: SNSClient,
    private readonly topicArn: string,
  ) {}

  async publish(event: BillingEvent): Promise<void> {
    await this.client.send(
      new PublishCommand({
        TopicArn: this.topicArn,
        Message: JSON.stringify(event),
        MessageAttributes: {
          eventType: {
            DataType: 'String',
            StringValue: event.messageType,
          },
          correlationId: {
            DataType: 'String',
            StringValue: event.correlationId,
          },
          messageId: { DataType: 'String', StringValue: event.messageId },
          ...(event.sagaId
            ? {
                sagaId: {
                  DataType: 'String',
                  StringValue: event.sagaId,
                },
              }
            : {}),
          aggregateId: { DataType: 'String', StringValue: event.aggregateId },
        },
      }),
    );
  }
}
