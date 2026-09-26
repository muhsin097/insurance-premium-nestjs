import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { InsuranceService } from './insurance.service.js';
import { CreateQuoteDto } from './dto/create-quote.dto.js';
import { CheckoutDto } from './dto/checkout.dto.js';
import { MedicalDeclarationDto } from './dto/medical-declaration.dto.js';

@Controller('api/v1/insurance')
export class InsuranceController {
  constructor(private readonly insuranceService: InsuranceService) {}

  @Post('quote')
  @HttpCode(HttpStatus.CREATED)
  createQuote(@Body() dto: CreateQuoteDto) {
    return this.insuranceService.createQuote(dto);
  }

  @Post('quote/:id/medical-declaration')
  @HttpCode(HttpStatus.OK)
  declareMedical(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MedicalDeclarationDto,
  ) {
    return this.insuranceService.declareMedical(id, dto);
  }

  @Post('checkout')
  @HttpCode(HttpStatus.OK)
  checkout(
    @Body() dto: CheckoutDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException('idempotency-key header is required');
    }
    return this.insuranceService.checkout(dto, idempotencyKey);
  }
}
