import * as Joi from 'joi';

const schema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  AWS_REGION: Joi.string().required(),
  AWS_ENDPOINT_URL: Joi.string().uri().allow('').optional(),
  DYNAMODB_TABLE: Joi.string().required(),
  SQS_COMMAND_QUEUE_URL: Joi.string().uri().required(),
  SNS_EVENTS_TOPIC_ARN: Joi.string()
    .pattern(/^arn:aws:sns:/)
    .required(),
  MERCADO_PAGO_BASE_URL: Joi.string()
    .uri()
    .default('https://api.mercadopago.com'),
  MERCADO_PAGO_ACCESS_TOKEN: Joi.string().min(1).required(),
  MERCADO_PAGO_WEBHOOK_SECRET: Joi.string().allow('').default(''),
  WEBHOOK_SIGNATURE_ENABLED: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .default(true),
  SQS_POLLING_ENABLED: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .default(true),
}).unknown(true);

export function validateEnv(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const { error, value } = schema.validate(input, { abortEarly: false });
  if (error) throw new Error(`Environment validation failed: ${error.message}`);
  if (value.WEBHOOK_SIGNATURE_ENABLED && !value.MERCADO_PAGO_WEBHOOK_SECRET) {
    throw new Error(
      'MERCADO_PAGO_WEBHOOK_SECRET is required when signature validation is enabled',
    );
  }
  return value as Record<string, unknown>;
}
