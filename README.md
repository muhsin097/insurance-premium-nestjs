# CareShield Max — Insurance Buy Journey (Backend)

NestJS API for a D2C health insurance purchase journey. It implements the three-step
"CareShield Max" flow end to end:

1. **Premium Calculation & Quote Lock** — collect applicant details, calculate a
   deterministic premium, and lock the quote for 15 minutes.
2. **Medical Declaration** — submit structured health disclosures and evaluate eligibility.
3. **Instant Bind & Issue** — process a (mocked) payment atomically and issue a policy.

This repo covers the backend only. There is no frontend in this codebase.

## Tech stack

- [NestJS 12](https://nestjs.com/) — controllers, services, DTO validation
- [Prisma 7](https://www.prisma.io/) + `@prisma/adapter-pg` — ORM and Postgres driver adapter
- PostgreSQL 16 (run locally via Docker Compose)
- `class-validator` / `class-transformer` — request validation
- [Vitest](https://vitest.dev/) + Supertest — unit and e2e tests
- `oxlint` + Prettier — linting and formatting

## Prerequisites

- Node.js 24+
- Docker (for local Postgres)

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Copy environment variables
cp .env.example .env

# 3. Start a local Postgres instance
docker compose up -d

# 4. Apply the database schema
npx prisma migrate dev

# 5. Start the API
npm run start:dev
```

The API listens on `http://localhost:3000` by default (override with `PORT`).

### Environment variables

| Variable       | Description                                       | Example                                                              |
| -------------- | -------------------------------------------------- | --------------------------------------------------------------------- |
| `DATABASE_URL` | Postgres connection string used by the app and CLI | `postgresql://insurance:insurance@localhost:5432/insurance?schema=public` |

## Data model

`prisma/schema.prisma` defines two tables and a finite state machine on `Quote.status`:

```
QUOTE_GENERATED → MEDICAL_DECLARED → PREMIUM_PAID → POLICY_ISSUED
```

- **`quotes`** — applicant details, premium breakdown (`NUMERIC(10,2)`, never float),
  status, `expires_at` (15-minute lock), and an `idempotency_key` used to make checkout
  safe to retry.
- **`policies`** — one-to-one with a quote (`quote_id` unique), holding the issued
  `contract_id` and the premium actually paid.

## API

All endpoints are namespaced under `/api/v1/insurance`.

### `POST /api/v1/insurance/quote`

Calculates and locks a premium quote for 15 minutes.

Premium rules: base premium is ₹10,000; if `age > 45`, add a 50% loading fee (₹5,000);
if `hasPreExistingConditions` is `true`, add a flat ₹5,000 loading fee.

```bash
curl -X POST http://localhost:3000/api/v1/insurance/quote \
  -H 'Content-Type: application/json' \
  -d '{"age": 50, "hasPreExistingConditions": true}'
```

```json
{
  "id": "2a271d01-dc85-4285-97e0-842b12395d59",
  "age": 50,
  "hasPreExistingConditions": true,
  "basePremium": "10000",
  "loadingFee": "10000",
  "totalPremium": "20000",
  "status": "QUOTE_GENERATED",
  "createdAt": "2026-09-26T09:38:10.884Z",
  "expiresAt": "2026-09-26T09:53:10.869Z"
}
```

### `POST /api/v1/insurance/quote/:id/medical-declaration`

Submits structured health disclosures and evaluates eligibility. Ineligible
applicants (currently: `recentHospitalization: true`) are rejected and the quote
stays at `QUOTE_GENERATED`; eligible applicants move to `MEDICAL_DECLARED`.

```bash
curl -X POST http://localhost:3000/api/v1/insurance/quote/<quoteId>/medical-declaration \
  -H 'Content-Type: application/json' \
  -d '{"smoker": true, "recentHospitalization": false, "chronicConditions": ["asthma"]}'
```

| Response | When                                                    |
| -------- | -------------------------------------------------------- |
| `200`    | Eligible — quote moves to `MEDICAL_DECLARED`              |
| `422`    | Ineligible based on the declaration                       |
| `404`    | Quote not found                                            |
| `409`    | A declaration was already submitted for this quote        |
| `410`    | Quote has expired                                           |

### `POST /api/v1/insurance/checkout`

Charges the (mocked) payment and, on success, atomically marks the quote as
converted and issues a policy. Requires an `Idempotency-Key` header — the client
generates a fresh key per checkout attempt and reuses it for retries of that
same attempt so duplicate rapid clicks never double-charge.

```bash
curl -X POST http://localhost:3000/api/v1/insurance/checkout \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"quoteId": "<quoteId>", "paymentToken": "tok_ok"}'
```

```json
{
  "contractId": "POL-6f8841a4-4d55-434f-9114-a7efb92cfa1f",
  "status": "POLICY_ISSUED",
  "premiumPaid": "20000",
  "quoteId": "2a271d01-dc85-4285-97e0-842b12395d59"
}
```

The mock payment provider declines any `paymentToken` prefixed with `fail_`, useful
for exercising the rollback path.

| Response | When                                                                 |
| -------- | ---------------------------------------------------------------------- |
| `200`    | Payment succeeded — policy issued (or replayed from a prior attempt)   |
| `400`    | Missing `Idempotency-Key` header                                        |
| `402`    | Payment declined                                                        |
| `404`    | Quote not found                                                          |
| `409`    | Medical declaration not completed, or key reused on a different attempt |
| `410`    | Quote has expired                                                        |

## Testing

```bash
npm run test       # unit tests
npm run test:e2e   # e2e tests (spins up the full app against Postgres)
npm run test:cov   # unit tests with coverage
npm run lint        # oxlint
npm run format      # prettier --write
```

e2e tests talk to the real Postgres instance from `docker compose`, so make sure
it's running (and migrated) before `npm run test:e2e`.

## Project structure

```
src/
├── insurance/           # quote, medical declaration, checkout
│   ├── dto/
│   ├── payment/          # mock payment provider
│   ├── premium-calculator.service.ts
│   ├── insurance.controller.ts
│   ├── insurance.service.ts
│   └── insurance.module.ts
├── prisma/               # PrismaService/PrismaModule (DB access)
└── generated/prisma/     # generated Prisma client (not committed)
prisma/
├── schema.prisma
└── migrations/
```
