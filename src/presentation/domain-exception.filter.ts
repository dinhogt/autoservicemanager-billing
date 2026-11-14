import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { DomainError } from '../domain/billing';
import { correlationId } from '../common/observability';

@Catch(DomainError)
export class DomainExceptionFilter implements ExceptionFilter {
  catch(exception: DomainError, host: ArgumentsHost): void {
    const status =
      exception.code === 'BILLING_NOT_FOUND'
        ? HttpStatus.NOT_FOUND
        : HttpStatus.CONFLICT;
    host.switchToHttp().getResponse<Response>().status(status).json({
      statusCode: status,
      code: exception.code,
      message: exception.message,
      correlationId: correlationId(),
    });
  }
}
