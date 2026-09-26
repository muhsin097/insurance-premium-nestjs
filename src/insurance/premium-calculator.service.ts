import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';

const BASE_PREMIUM = new Prisma.Decimal('10000.00');
const AGE_LOADING_RATE = new Prisma.Decimal('0.5');
const PRE_EXISTING_CONDITION_LOADING_FEE = new Prisma.Decimal('5000.00');
const AGE_LOADING_THRESHOLD = 45;

export interface PremiumBreakdown {
  basePremium: Prisma.Decimal;
  loadingFee: Prisma.Decimal;
  totalPremium: Prisma.Decimal;
}

@Injectable()
export class PremiumCalculatorService {
  calculate(age: number, hasPreExistingConditions: boolean): PremiumBreakdown {
    let loadingFee = new Prisma.Decimal(0);

    if (age > AGE_LOADING_THRESHOLD) {
      loadingFee = loadingFee.plus(BASE_PREMIUM.times(AGE_LOADING_RATE));
    }

    if (hasPreExistingConditions) {
      loadingFee = loadingFee.plus(PRE_EXISTING_CONDITION_LOADING_FEE);
    }

    return {
      basePremium: BASE_PREMIUM,
      loadingFee,
      totalPremium: BASE_PREMIUM.plus(loadingFee),
    };
  }
}
