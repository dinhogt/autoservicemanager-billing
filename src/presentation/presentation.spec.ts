import {
  ArgumentsHost,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { BillingService } from '../application/billing.service';
import { DomainError } from '../domain/billing';
import { WebhookSignatureService } from '../infrastructure/webhook-signature.service';
import { BillingController } from './billing.controller';
import { DomainExceptionFilter } from './domain-exception.filter';
import { HealthController } from './health.controller';

describe('BillingController', () => {
  const billing = {
    createBudget: jest.fn(),
    requestPayment: jest.fn(),
    refund: jest.fn(),
    findById: jest.fn(),
    processPaymentWebhook: jest.fn(),
  } as unknown as jest.Mocked<BillingService>;
  const signatures = {
    validate: jest.fn(),
  } as unknown as jest.Mocked<WebhookSignatureService>;
  const controller = new BillingController(billing, signatures);

  beforeEach(() => jest.clearAllMocks());

  it('delegates application operations', () => {
    const dto = {
      commandId: 'c',
      orderId: 'o',
      customerEmail: 'a@b.com',
      amount: 10,
      description: 'x',
    };
    controller.createBudget(dto);
    controller.requestPayment('id');
    controller.refund('id');
    controller.findById('id');
    expect(billing.createBudget).toHaveBeenCalledWith(dto);
    expect(billing.requestPayment).toHaveBeenCalledWith('id');
    expect(billing.refund).toHaveBeenCalledWith('id');
    expect(billing.findById).toHaveBeenCalledWith('id');
  });

  it('accepts a signed webhook', () => {
    signatures.validate.mockReturnValue(true);
    controller.webhook({ data: { id: 'payment-1' } }, 'signature', 'request-1');
    expect(billing.processPaymentWebhook).toHaveBeenCalledWith(
      'request-1',
      'payment-1',
    );
  });

  it('rejects malformed or unsigned webhooks', () => {
    expect(() =>
      controller.webhook({ data: { id: '' } }, 'sig', 'request'),
    ).toThrow(BadRequestException);
    expect(() =>
      controller.webhook({ data: { id: 'payment' } }, 'sig', undefined),
    ).toThrow(BadRequestException);
    signatures.validate.mockReturnValue(false);
    expect(() =>
      controller.webhook({ data: { id: 'payment' } }, 'sig', 'request'),
    ).toThrow(UnauthorizedException);
  });
});

describe('health and domain error presentation', () => {
  it('reports liveness and readiness', () => {
    const health = new HealthController();
    expect(health.live()).toEqual({ status: 'ok' });
    expect(health.ready()).toEqual({ status: 'ready' });
  });

  it.each([
    ['BILLING_NOT_FOUND', 404],
    ['INVALID_TRANSITION', 409],
  ])('maps %s domain errors', (code, expectedStatus) => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({ getResponse: () => ({ status }) }),
    } as unknown as ArgumentsHost;
    new DomainExceptionFilter().catch(new DomainError('failure', code), host);
    expect(status).toHaveBeenCalledWith(expectedStatus);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ code, correlationId: 'system' }),
    );
  });
});
