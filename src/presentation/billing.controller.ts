import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BillingService } from '../application/billing.service';
import { WebhookSignatureService } from '../infrastructure/webhook-signature.service';
import { CreateBudgetDto, MercadoPagoWebhookDto } from './billing.dto';

@ApiTags('billing')
@Controller('billing')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly signatures: WebhookSignatureService,
  ) {}

  @Post('budgets')
  @ApiOperation({ summary: 'Create an idempotent budget' })
  createBudget(@Body() dto: CreateBudgetDto) {
    return this.billing.createBudget(dto);
  }

  @Post(':id/payment')
  @ApiOperation({ summary: 'Create a Mercado Pago PIX payment' })
  requestPayment(@Param('id') id: string) {
    return this.billing.requestPayment(id);
  }

  @Post(':id/refund')
  @ApiOperation({ summary: 'Refund a paid billing' })
  refund(@Param('id') id: string) {
    return this.billing.refund(id);
  }

  @Post(':id/timeout')
  @ApiOperation({ summary: 'Publish payment timeout for a pending billing' })
  timeout(@Param('id') id: string) {
    return this.billing.timeout(id);
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.billing.findById(id);
  }

  @Post('webhooks/mercado-pago')
  @ApiHeader({ name: 'x-signature', required: true })
  @ApiHeader({ name: 'x-request-id', required: true })
  @ApiOperation({ summary: 'Receive an idempotent Mercado Pago notification' })
  webhook(
    @Body() body: MercadoPagoWebhookDto,
    @Headers('x-signature') signature: string | undefined,
    @Headers('x-request-id') requestId: string | undefined,
  ) {
    if (!body.data?.id || !requestId) {
      throw new BadRequestException('data.id and x-request-id are required');
    }
    if (
      !this.signatures.validate({ dataId: body.data.id, requestId, signature })
    ) {
      throw new UnauthorizedException('invalid webhook signature');
    }
    return this.billing.processPaymentWebhook(requestId, String(body.data.id));
  }
}
