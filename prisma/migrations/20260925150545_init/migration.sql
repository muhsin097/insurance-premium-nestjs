-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('QUOTE_GENERATED', 'MEDICAL_DECLARED', 'PREMIUM_PAID', 'POLICY_ISSUED');

-- CreateTable
CREATE TABLE "quotes" (
    "id" TEXT NOT NULL,
    "age" INTEGER NOT NULL,
    "has_pre_existing_conditions" BOOLEAN NOT NULL,
    "base_premium" DECIMAL(10,2) NOT NULL,
    "loading_fee" DECIMAL(10,2) NOT NULL,
    "total_premium" DECIMAL(10,2) NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'QUOTE_GENERATED',
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policies" (
    "id" TEXT NOT NULL,
    "quote_id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "premium_paid" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "policies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "quotes_idempotency_key_key" ON "quotes"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "policies_quote_id_key" ON "policies"("quote_id");

-- CreateIndex
CREATE UNIQUE INDEX "policies_contract_id_key" ON "policies"("contract_id");

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
