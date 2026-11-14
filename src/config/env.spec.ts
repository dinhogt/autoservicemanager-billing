import { validateEnv } from './env';

const valid = {
  AWS_REGION: 'us-east-1',
  DYNAMODB_TABLE: 'billing',
  SQS_COMMAND_QUEUE_URL: 'https://sqs.us-east-1.amazonaws.com/1/commands',
  SNS_EVENTS_TOPIC_ARN: 'arn:aws:sns:us-east-1:1:events',
  MERCADO_PAGO_ACCESS_TOKEN: 'token',
  MERCADO_PAGO_WEBHOOK_SECRET: 'secret',
};

describe('environment validation', () => {
  it('applies secure defaults', () => {
    expect(validateEnv(valid)).toMatchObject({
      PORT: 3000,
      WEBHOOK_SIGNATURE_ENABLED: true,
      SQS_POLLING_ENABLED: true,
    });
  });

  it('accepts explicitly disabled webhook validation for local development', () => {
    expect(
      validateEnv({
        ...valid,
        WEBHOOK_SIGNATURE_ENABLED: 'false',
        MERCADO_PAGO_WEBHOOK_SECRET: '',
      }),
    ).toMatchObject({ WEBHOOK_SIGNATURE_ENABLED: false });
  });

  it('rejects missing variables and enabled validation without secret', () => {
    expect(() => validateEnv({})).toThrow('Environment validation failed');
    expect(() =>
      validateEnv({ ...valid, MERCADO_PAGO_WEBHOOK_SECRET: '' }),
    ).toThrow('MERCADO_PAGO_WEBHOOK_SECRET is required');
  });
});
