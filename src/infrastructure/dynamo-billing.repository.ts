import {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { BillingRepository } from '../application/ports';
import { BillingRecord } from '../domain/billing';

interface DocumentClient {
  send(command: object): Promise<{ Item?: unknown; Items?: unknown[] }>;
}

export class DynamoBillingRepository implements BillingRepository {
  constructor(
    private readonly client: DocumentClient,
    private readonly tableName: string,
  ) {}

  async createIfAbsent(record: BillingRecord): Promise<BillingRecord> {
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: this.toItem(record),
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      );
      return record;
    } catch (error) {
      if (!(error instanceof ConditionalCheckFailedException)) throw error;
      const existing = await this.findById(record.id);
      if (!existing) throw error;
      return existing;
    }
  }

  async findById(id: string): Promise<BillingRecord | null> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: `BILLING#${id}`, SK: 'BILLING' },
        ConsistentRead: true,
      }),
    );
    return response.Item
      ? this.fromItem(response.Item as Record<string, unknown>)
      : null;
  }

  async findByPaymentId(paymentId: string): Promise<BillingRecord | null> {
    const response = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': `PAYMENT#${paymentId}` },
        Limit: 1,
      }),
    );
    const item = response.Items?.[0] as Record<string, unknown> | undefined;
    return item ? this.fromItem(item) : null;
  }

  async save(record: BillingRecord): Promise<void> {
    await this.client.send(
      new PutCommand({ TableName: this.tableName, Item: this.toItem(record) }),
    );
  }

  async markWebhookProcessed(eventId: string): Promise<boolean> {
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { PK: `WEBHOOK#${eventId}`, SK: 'WEBHOOK' },
          UpdateExpression: 'SET processedAt = :now, expiresAt = :ttl',
          ConditionExpression: 'attribute_not_exists(PK)',
          ExpressionAttributeValues: {
            ':now': new Date().toISOString(),
            ':ttl': Math.floor(Date.now() / 1000) + 86400 * 7,
          },
        }),
      );
      return true;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) return false;
      throw error;
    }
  }

  private toItem(record: BillingRecord): Record<string, unknown> {
    return {
      PK: `BILLING#${record.id}`,
      SK: 'BILLING',
      GSI1PK: record.paymentId ? `PAYMENT#${record.paymentId}` : undefined,
      ...record,
    };
  }

  private fromItem(item: Record<string, unknown>): BillingRecord {
    const record = { ...item };
    delete record.PK;
    delete record.SK;
    delete record.GSI1PK;
    return record as unknown as BillingRecord;
  }
}
