import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Insurance (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function createQuote(body: {
    age: number;
    hasPreExistingConditions: boolean;
  }) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/insurance/quote')
      .send(body)
      .expect(201);
    return res.body;
  }

  function declareMedical(
    quoteId: string,
    body: {
      smoker: boolean;
      recentHospitalization: boolean;
      chronicConditions?: string[];
    } = { smoker: false, recentHospitalization: false },
  ) {
    return request(app.getHttpServer())
      .post(`/api/v1/insurance/quote/${quoteId}/medical-declaration`)
      .send(body);
  }

  /** Creates a quote and walks it through an eligible medical declaration. */
  async function createDeclaredQuote() {
    const quote = await createQuote({
      age: 30,
      hasPreExistingConditions: false,
    });
    await declareMedical(quote.id).expect(200);
    return quote;
  }

  describe('POST /api/v1/insurance/quote', () => {
    it('charges only the base premium with no loadings', async () => {
      const quote = await createQuote({
        age: 30,
        hasPreExistingConditions: false,
      });
      expect(quote.basePremium).toBe('10000');
      expect(quote.loadingFee).toBe('0');
      expect(quote.totalPremium).toBe('10000');
      expect(quote.status).toBe('QUOTE_GENERATED');
    });

    it('applies the 50% age loading and flat pre-existing loading together', async () => {
      const quote = await createQuote({
        age: 50,
        hasPreExistingConditions: true,
      });
      expect(quote.loadingFee).toBe('10000');
      expect(quote.totalPremium).toBe('20000');
    });

    it('locks the quote for exactly 15 minutes', async () => {
      const quote = await createQuote({
        age: 30,
        hasPreExistingConditions: false,
      });
      const createdAt = new Date(quote.createdAt).getTime();
      const expiresAt = new Date(quote.expiresAt).getTime();
      // expiresAt is computed just before createdAt is stamped by the DB, so
      // allow a small tolerance for the gap between the two clock reads.
      expect(expiresAt - createdAt).toBeGreaterThan(15 * 60 * 1000 - 1000);
      expect(expiresAt - createdAt).toBeLessThanOrEqual(15 * 60 * 1000);
    });

    it('rejects invalid payloads', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/insurance/quote')
        .send({ age: 200, hasPreExistingConditions: false })
        .expect(400);
    });
  });

  describe('POST /api/v1/insurance/quote/:id/medical-declaration', () => {
    it('moves an eligible quote to MEDICAL_DECLARED', async () => {
      const quote = await createQuote({
        age: 30,
        hasPreExistingConditions: false,
      });

      const res = await declareMedical(quote.id, {
        smoker: true,
        recentHospitalization: false,
        chronicConditions: ['asthma'],
      }).expect(200);

      expect(res.body.status).toBe('MEDICAL_DECLARED');

      const stored = await prisma.quote.findUniqueOrThrow({
        where: { id: quote.id },
      });
      expect(stored.status).toBe('MEDICAL_DECLARED');
      expect(stored.medicalDeclaration).toMatchObject({
        smoker: true,
        recentHospitalization: false,
      });
    });

    it('rejects an ineligible declaration and leaves the quote at QUOTE_GENERATED', async () => {
      const quote = await createQuote({
        age: 30,
        hasPreExistingConditions: false,
      });

      await declareMedical(quote.id, {
        smoker: false,
        recentHospitalization: true,
      }).expect(422);

      const stored = await prisma.quote.findUniqueOrThrow({
        where: { id: quote.id },
      });
      expect(stored.status).toBe('QUOTE_GENERATED');
    });

    it('returns 404 for an unknown quote', async () => {
      await declareMedical(randomUUID()).expect(404);
    });

    it('returns 409 when a declaration was already submitted', async () => {
      const quote = await createDeclaredQuote();
      await declareMedical(quote.id).expect(409);
    });

    it('returns 410 for an expired quote', async () => {
      const quote = await createQuote({
        age: 30,
        hasPreExistingConditions: false,
      });
      await prisma.quote.update({
        where: { id: quote.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await declareMedical(quote.id).expect(410);
    });
  });

  describe('POST /api/v1/insurance/checkout', () => {
    it('requires an idempotency-key header', async () => {
      const quote = await createQuote({
        age: 30,
        hasPreExistingConditions: false,
      });
      await request(app.getHttpServer())
        .post('/api/v1/insurance/checkout')
        .send({ quoteId: quote.id, paymentToken: 'tok_ok' })
        .expect(400);
    });

    it('returns 404 for an unknown quote', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/insurance/checkout')
        .set('idempotency-key', randomUUID())
        .send({ quoteId: randomUUID(), paymentToken: 'tok_ok' })
        .expect(404);
    });

    it('rejects checkout before the medical declaration step is completed', async () => {
      const quote = await createQuote({
        age: 30,
        hasPreExistingConditions: false,
      });

      await request(app.getHttpServer())
        .post('/api/v1/insurance/checkout')
        .set('idempotency-key', randomUUID())
        .send({ quoteId: quote.id, paymentToken: 'tok_ok' })
        .expect(409);
    });

    it('issues a policy on successful payment', async () => {
      const quote = await createDeclaredQuote();

      const res = await request(app.getHttpServer())
        .post('/api/v1/insurance/checkout')
        .set('idempotency-key', randomUUID())
        .send({ quoteId: quote.id, paymentToken: 'tok_ok' })
        .expect(200);

      expect(res.body.status).toBe('POLICY_ISSUED');
      expect(res.body.contractId).toMatch(/^POL-/);
      expect(res.body.premiumPaid).toBe('10000');

      const stored = await prisma.quote.findUniqueOrThrow({
        where: { id: quote.id },
        include: { policy: true },
      });
      expect(stored.status).toBe('POLICY_ISSUED');
      expect(stored.policy).not.toBeNull();
    });

    it('replays the same result when retried with the same idempotency key', async () => {
      const quote = await createDeclaredQuote();
      const idempotencyKey = randomUUID();

      const first = await request(app.getHttpServer())
        .post('/api/v1/insurance/checkout')
        .set('idempotency-key', idempotencyKey)
        .send({ quoteId: quote.id, paymentToken: 'tok_ok' })
        .expect(200);

      const second = await request(app.getHttpServer())
        .post('/api/v1/insurance/checkout')
        .set('idempotency-key', idempotencyKey)
        .send({ quoteId: quote.id, paymentToken: 'tok_ok' })
        .expect(200);

      expect(second.body.contractId).toBe(first.body.contractId);

      const policyCount = await prisma.policy.count({
        where: { quoteId: quote.id },
      });
      expect(policyCount).toBe(1);
    });

    it('rejects a retry that reuses the quote with a different idempotency key', async () => {
      const quote = await createDeclaredQuote();

      await request(app.getHttpServer())
        .post('/api/v1/insurance/checkout')
        .set('idempotency-key', randomUUID())
        .send({ quoteId: quote.id, paymentToken: 'tok_ok' })
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/v1/insurance/checkout')
        .set('idempotency-key', randomUUID())
        .send({ quoteId: quote.id, paymentToken: 'tok_ok' })
        .expect(409);
    });

    it('declines payment and leaves the quote unconverted, with no policy created', async () => {
      const quote = await createDeclaredQuote();

      await request(app.getHttpServer())
        .post('/api/v1/insurance/checkout')
        .set('idempotency-key', randomUUID())
        .send({ quoteId: quote.id, paymentToken: 'fail_card' })
        .expect(402);

      const stored = await prisma.quote.findUniqueOrThrow({
        where: { id: quote.id },
        include: { policy: true },
      });
      expect(stored.status).toBe('MEDICAL_DECLARED');
      expect(stored.policy).toBeNull();
    });

    it('rejects checkout on an expired quote', async () => {
      const quote = await createDeclaredQuote();

      await prisma.quote.update({
        where: { id: quote.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await request(app.getHttpServer())
        .post('/api/v1/insurance/checkout')
        .set('idempotency-key', randomUUID())
        .send({ quoteId: quote.id, paymentToken: 'tok_ok' })
        .expect(410);
    });
  });
});
