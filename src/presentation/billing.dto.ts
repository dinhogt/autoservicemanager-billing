import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateBudgetDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  commandId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  orderId!: string;

  @ApiProperty()
  @IsEmail()
  customerEmail!: string;

  @ApiProperty({ example: 199.9 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  description!: string;
}

export class MercadoPagoWebhookDataDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  id!: string;
}

export class MercadoPagoWebhookDto {
  @ApiProperty({ example: 'payment' })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiProperty()
  @ValidateNested()
  @Type(() => MercadoPagoWebhookDataDto)
  data!: MercadoPagoWebhookDataDto;
}
