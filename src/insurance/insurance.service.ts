import {
  ConflictException,
  GoneException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { PremiumCalculatorService } from './premium-calculator.service.js';
import { MockPaymentProvider } from './payment/mock-payment.provider.js';
import { CreateQuoteDto } from './dto/create-quote.dto.js';
import { CheckoutDto } from './dto/checkout.dto.js';
import { MedicalDeclarationDto } from './dto/medical-declaration.dto.js';
import {
  QuoteStatus,
  type Policy,
  type Quote,
  type Prisma,
} from '../generated/prisma/client.js';

const QUOTE_TTL_MS = 15 * 60 * 1000;

type QuoteWithPolicy = Quote & { policy: Policy | null };

@Injectable()
export class InsuranceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly premiumCalculator: PremiumCalculatorService,
    private readonly paymentProvider: MockPaymentProvider,
  ) {}

  async createQuote(dto: CreateQuoteDto) {
    const { basePremium, loadingFee, totalPremium } =
      this.premiumCalculator.calculate(dto.age, dto.hasPreExistingConditions);

    const quote = await this.prisma.quote.create({
      data: {
        age: dto.age,
        hasPreExistingConditions: dto.hasPreExistingConditions,
        basePremium,
        loadingFee,
        totalPremium,
        expiresAt: new Date(Date.now() + QUOTE_TTL_MS),
      },
    });

    return this.toQuoteResponse(quote);
  }

  async declareMedical(quoteId: string, dto: MedicalDeclarationDto) {
    const quote = await this.prisma.quote.findUnique({
      where: { id: quoteId },
    });

    if (!quote) {
      throw new NotFoundException('Quote not found');
    }

    if (quote.status !== QuoteStatus.QUOTE_GENERATED) {
      throw new ConflictException(
        'A medical declaration has already been submitted for this quote',
      );
    }

    if (quote.expiresAt.getTime() < Date.now()) {
      throw new GoneException(
        'Quote has expired, please recalculate the premium',
      );
    }

    const isEligible = !dto.recentHospitalization;
    const declaration: Prisma.InputJsonValue = {
      smoker: dto.smoker,
      recentHospitalization: dto.recentHospitalization,
      chronicConditions: dto.chronicConditions ?? [],
    };

    const updated = await this.prisma.quote.update({
      where: { id: quoteId },
      data: {
        medicalDeclaration: declaration,
        ...(isEligible ? { status: QuoteStatus.MEDICAL_DECLARED } : {}),
      },
    });

    if (!isEligible) {
      throw new UnprocessableEntityException(
        'Applicant is not eligible for coverage based on the medical declaration',
      );
    }

    return this.toQuoteResponse(updated);
  }

  async checkout(dto: CheckoutDto, idempotencyKey: string) {
    let quote = await this.prisma.quote.findUnique({
      where: { id: dto.quoteId },
      include: { policy: true },
    });

    if (!quote) {
      throw new NotFoundException('Quote not found');
    }

    if (quote.idempotencyKey && quote.idempotencyKey !== idempotencyKey) {
      throw new ConflictException(
        'This quote is already being processed with a different idempotency key',
      );
    }

    if (quote.status === QuoteStatus.POLICY_ISSUED && quote.policy) {
      return this.toCheckoutResponse(quote.policy);
    }

    if (quote.status === QuoteStatus.QUOTE_GENERATED) {
      throw new ConflictException(
        'Medical declaration must be completed before checkout',
      );
    }

    if (!quote.idempotencyKey) {
      if (quote.expiresAt.getTime() < Date.now()) {
        throw new GoneException(
          'Quote has expired, please recalculate the premium',
        );
      }

      const claim = await this.prisma.quote.updateMany({
        where: { id: dto.quoteId, idempotencyKey: null },
        data: { idempotencyKey },
      });

      if (claim.count === 0) {
        // Lost a race to a concurrent duplicate click — re-read and defer to
        // whichever request claimed the key first.
        quote = await this.prisma.quote.findUnique({
          where: { id: dto.quoteId },
          include: { policy: true },
        });
        if (!quote) {
          throw new NotFoundException('Quote not found');
        }
        if (quote.idempotencyKey !== idempotencyKey) {
          throw new ConflictException(
            'This quote is already being processed with a different idempotency key',
          );
        }
        if (quote.status === QuoteStatus.POLICY_ISSUED && quote.policy) {
          return this.toCheckoutResponse(quote.policy);
        }
      }
    }

    quote = await this.chargeIfUnpaid(quote, dto.paymentToken);

    const policy = await this.prisma.$transaction(async (tx) => {
      await tx.quote.update({
        where: { id: quote!.id },
        data: { status: QuoteStatus.POLICY_ISSUED },
      });
      return tx.policy.create({
        data: {
          quoteId: quote!.id,
          contractId: `POL-${randomUUID()}`,
          premiumPaid: quote!.totalPremium,
        },
      });
    });

    return this.toCheckoutResponse(policy);
  }

  private async chargeIfUnpaid(
    quote: QuoteWithPolicy,
    paymentToken: string,
  ): Promise<QuoteWithPolicy> {
    if (quote.status !== QuoteStatus.MEDICAL_DECLARED) {
      return quote;
    }

    const payment = await this.paymentProvider.charge(
      paymentToken,
      quote.totalPremium.toString(),
    );

    if (!payment.success) {
      throw new HttpException('Payment declined', HttpStatus.PAYMENT_REQUIRED);
    }

    return this.prisma.quote.update({
      where: { id: quote.id },
      data: { status: QuoteStatus.PREMIUM_PAID },
      include: { policy: true },
    });
  }

  private toQuoteResponse(quote: Quote) {
    return {
      id: quote.id,
      age: quote.age,
      hasPreExistingConditions: quote.hasPreExistingConditions,
      basePremium: quote.basePremium.toString(),
      loadingFee: quote.loadingFee.toString(),
      totalPremium: quote.totalPremium.toString(),
      status: quote.status,
      createdAt: quote.createdAt,
      expiresAt: quote.expiresAt,
    };
  }

  private toCheckoutResponse(policy: Policy) {
    return {
      contractId: policy.contractId,
      status: QuoteStatus.POLICY_ISSUED,
      premiumPaid: policy.premiumPaid.toString(),
      quoteId: policy.quoteId,
    };
  }
}
