import { Module } from '@nestjs/common';
import { InsuranceController } from './insurance.controller.js';
import { InsuranceService } from './insurance.service.js';
import { PremiumCalculatorService } from './premium-calculator.service.js';
import { MockPaymentProvider } from './payment/mock-payment.provider.js';

@Module({
  controllers: [InsuranceController],
  providers: [InsuranceService, PremiumCalculatorService, MockPaymentProvider],
})
export class InsuranceModule {}
