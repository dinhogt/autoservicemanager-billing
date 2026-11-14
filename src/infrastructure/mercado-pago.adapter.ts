import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { PaymentGateway } from '../application/ports';
import { emitMetric } from '../common/observability';

interface MercadoPagoPayment {
  id: number | string;
  status?: string;
  point_of_interaction?: { transaction_data?: { ticket_url?: string } };
  init_point?: string;
}

export class MercadoPagoAdapter implements PaymentGateway {
  constructor(
    private readonly http: HttpService,
    private readonly accessToken: string,
    private readonly baseUrl: string,
  ) {}

  async createPayment(input: {
    billingId: string;
    amount: number;
    description: string;
    customerEmail: string;
  }): Promise<{ id: string; checkoutUrl: string }> {
    const startedAt = Date.now();
    try {
      const response = await firstValueFrom(
        this.http.post<MercadoPagoPayment>(
          `${this.baseUrl}/v1/payments`,
          {
            transaction_amount: input.amount,
            description: input.description,
            payment_method_id: 'pix',
            external_reference: input.billingId,
            payer: { email: input.customerEmail },
          },
          {
            headers: {
              Authorization: `Bearer ${this.accessToken}`,
              'X-Idempotency-Key': input.billingId,
            },
          },
        ),
      );
      const checkoutUrl =
        response.data.point_of_interaction?.transaction_data?.ticket_url ??
        response.data.init_point;
      if (!checkoutUrl)
        throw new Error('Mercado Pago response has no checkout URL');
      this.emitGateway('payment.create', 'success', startedAt);
      return { id: String(response.data.id), checkoutUrl };
    } catch (error) {
      this.emitGateway('payment.create', 'failed', startedAt, error);
      throw error;
    }
  }

  async getPayment(paymentId: string): Promise<{ approved: boolean }> {
    const startedAt = Date.now();
    try {
      const response = await firstValueFrom(
        this.http.get<MercadoPagoPayment>(
          `${this.baseUrl}/v1/payments/${paymentId}`,
          {
            headers: { Authorization: `Bearer ${this.accessToken}` },
          },
        ),
      );
      this.emitGateway('payment.get', 'success', startedAt);
      return { approved: response.data.status === 'approved' };
    } catch (error) {
      this.emitGateway('payment.get', 'failed', startedAt, error);
      throw error;
    }
  }

  async refund(paymentId: string): Promise<void> {
    const startedAt = Date.now();
    try {
      await firstValueFrom(
        this.http.post(
          `${this.baseUrl}/v1/payments/${paymentId}/refunds`,
          {},
          {
            headers: {
              Authorization: `Bearer ${this.accessToken}`,
              'X-Idempotency-Key': `refund-${paymentId}`,
            },
          },
        ),
      );
      this.emitGateway('refund', 'success', startedAt);
    } catch (error) {
      this.emitGateway('refund', 'failed', startedAt, error);
      throw error;
    }
  }

  private emitGateway(
    operation: string,
    outcome: 'success' | 'failed',
    startedAt: number,
    error?: unknown,
  ): void {
    const durationMs = Date.now() - startedAt;
    emitMetric({
      event:
        outcome === 'failed' ? 'mercado_pago_error' : 'mercado_pago_request',
      metric: 'MercadoPagoDuration',
      unit: 'Milliseconds',
      value: durationMs,
      durationMs,
      operation,
      outcome,
      errorType: error instanceof Error ? error.name : undefined,
    });
    if (outcome === 'failed') {
      emitMetric({
        event: operation === 'refund' ? 'refund_failed' : 'mercado_pago_error',
        metric: operation === 'refund' ? 'RefundFailed' : 'MercadoPagoError',
        operation,
        outcome,
        errorType: error instanceof Error ? error.name : undefined,
      });
    }
  }
}
