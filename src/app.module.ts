import { HttpModule, HttpService } from '@nestjs/axios';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SNSClient } from '@aws-sdk/client-sns';
import { SQSClient } from '@aws-sdk/client-sqs';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { BillingService } from './application/billing.service';
import {
  BILLING_REPOSITORY,
  EVENT_PUBLISHER,
  PAYMENT_GATEWAY,
} from './application/ports';
import { CorrelationMiddleware } from './common/observability';
import { validateEnv } from './config/env';
import { DynamoBillingRepository } from './infrastructure/dynamo-billing.repository';
import { MercadoPagoAdapter } from './infrastructure/mercado-pago.adapter';
import { SnsEventPublisher } from './infrastructure/sns-event.publisher';
import { SqsCommandConsumer } from './infrastructure/sqs-command.consumer';
import { WebhookSignatureService } from './infrastructure/webhook-signature.service';
import { BillingController } from './presentation/billing.controller';
import { HealthController } from './presentation/health.controller';

const awsOptions = (config: ConfigService) => ({
  region: config.getOrThrow<string>('AWS_REGION'),
  ...(config.get<string>('AWS_ENDPOINT_URL')
    ? { endpoint: config.get<string>('AWS_ENDPOINT_URL') }
    : {}),
});

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    HttpModule.register({ timeout: 5000, maxRedirects: 0 }),
  ],
  controllers: [BillingController, HealthController],
  providers: [
    BillingService,
    {
      provide: BILLING_REPOSITORY,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new DynamoBillingRepository(
          DynamoDBDocumentClient.from(new DynamoDBClient(awsOptions(config))),
          config.getOrThrow<string>('DYNAMODB_TABLE'),
        ),
    },
    {
      provide: PAYMENT_GATEWAY,
      inject: [HttpService, ConfigService],
      useFactory: (http: HttpService, config: ConfigService) =>
        new MercadoPagoAdapter(
          http,
          config.getOrThrow<string>('MERCADO_PAGO_ACCESS_TOKEN'),
          config.getOrThrow<string>('MERCADO_PAGO_BASE_URL'),
        ),
    },
    {
      provide: EVENT_PUBLISHER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new SnsEventPublisher(
          new SNSClient(awsOptions(config)),
          config.getOrThrow<string>('SNS_EVENTS_TOPIC_ARN'),
        ),
    },
    {
      provide: WebhookSignatureService,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new WebhookSignatureService(
          config.getOrThrow<string>('MERCADO_PAGO_WEBHOOK_SECRET'),
          config.getOrThrow<boolean>('WEBHOOK_SIGNATURE_ENABLED'),
        ),
    },
    {
      provide: SqsCommandConsumer,
      inject: [ConfigService, BillingService],
      useFactory: (config: ConfigService, billing: BillingService) =>
        new SqsCommandConsumer(
          new SQSClient(awsOptions(config)),
          config.getOrThrow<string>('SQS_COMMAND_QUEUE_URL'),
          billing,
          config.getOrThrow<boolean>('SQS_POLLING_ENABLED'),
        ),
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
