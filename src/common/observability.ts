import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { Injectable, LoggerService, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

export type TelemetryContext = {
  correlationId: string;
  sagaId?: string;
  messageId?: string;
  aggregateId?: string;
};

const correlationStore = new AsyncLocalStorage<TelemetryContext>();

export function correlationId(): string {
  return correlationStore.getStore()?.correlationId ?? 'system';
}

export function withCorrelation<T>(id: string, callback: () => T): T {
  return correlationStore.run({ correlationId: id }, callback);
}

export function withTelemetryContext<T>(
  context: TelemetryContext,
  callback: () => T,
): T {
  return correlationStore.run(context, callback);
}

export function emitMetric(input: {
  event: string;
  metric: string;
  operation: string;
  outcome: string;
  value?: number;
  unit?: 'Count' | 'Milliseconds';
  durationMs?: number;
  errorType?: string;
}): void {
  const now = Date.now();
  const current = correlationStore.getStore();
  const environment =
    process.env.METRICS_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development';
  process.stdout.write(
    `${JSON.stringify({
      _aws: {
        Timestamp: now,
        CloudWatchMetrics: [
          {
            Namespace: `AutoServiceManager/${environment}`,
            Dimensions: [['Service'], ['Service', 'Operation', 'Outcome']],
            Metrics: [{ Name: input.metric, Unit: input.unit ?? 'Count' }],
          },
        ],
      },
      Service: 'billing',
      Operation: input.operation,
      Outcome: input.outcome,
      [input.metric]: input.value ?? 1,
      timestamp: new Date(now).toISOString(),
      level: input.outcome === 'failed' ? 'error' : 'info',
      service: 'billing',
      environment,
      correlationId: current?.correlationId ?? 'system',
      sagaId: current?.sagaId ?? 'none',
      messageId: current?.messageId ?? 'none',
      aggregateId: current?.aggregateId ?? 'none',
      durationMs: input.durationMs ?? 0,
      event: input.event,
      outcome: input.outcome,
      ...(input.errorType ? { errorType: input.errorType } : {}),
    })}\n`,
  );
}

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const header = request.header('x-correlation-id');
    const id = header?.trim() || randomUUID();
    response.setHeader('x-correlation-id', id);
    withCorrelation(id, next);
  }
}

export class JsonLogger implements LoggerService {
  log(message: unknown, context?: string): void {
    this.write('info', message, context);
  }

  error(message: unknown, trace?: string, context?: string): void {
    this.write('error', message, context, trace);
  }

  warn(message: unknown, context?: string): void {
    this.write('warn', message, context);
  }

  debug(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.write('verbose', message, context);
  }

  private write(
    level: string,
    message: unknown,
    context?: string,
    trace?: string,
  ): void {
    process.stdout.write(
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        service: 'billing',
        environment:
          process.env.METRICS_ENVIRONMENT ??
          process.env.NODE_ENV ??
          'development',
        correlationId: correlationId(),
        sagaId: correlationStore.getStore()?.sagaId ?? 'none',
        messageId: correlationStore.getStore()?.messageId ?? 'none',
        aggregateId: correlationStore.getStore()?.aggregateId ?? 'none',
        context,
        message:
          typeof message === 'string' ? message : JSON.stringify(message),
        ...(trace ? { trace } : {}),
      })}\n`,
    );
  }
}
