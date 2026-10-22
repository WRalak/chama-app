-- CreateEnum
CREATE TYPE "public"."BillingInterval" AS ENUM ('MONTH', 'YEAR');

-- CreateEnum
CREATE TYPE "public"."BillingPaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "public"."BillingPurpose" AS ENUM ('NEW', 'UPGRADE', 'RENEWAL');

-- CreateEnum
CREATE TYPE "public"."BillingRefundStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."BillingCaseStatus" AS ENUM ('OPEN', 'WAITING', 'RESOLVED');

-- CreateEnum
CREATE TYPE "public"."BillingCasePriority" AS ENUM ('LOW', 'NORMAL', 'HIGH');

-- CreateEnum
CREATE TYPE "public"."OperatingCostCategory" AS ENUM ('ACQUISITION', 'AI', 'INFRASTRUCTURE', 'PAYMENT_FEES', 'SMS_MESSAGING', 'STAFF', 'OTHER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "public"."GroupType" ADD VALUE 'STOKVEL';
ALTER TYPE "public"."GroupType" ADD VALUE 'COMMUNITY_FUND';
ALTER TYPE "public"."GroupType" ADD VALUE 'FAMILY';
ALTER TYPE "public"."GroupType" ADD VALUE 'OTHER';

-- AlterEnum
ALTER TYPE "public"."PlatformRole" ADD VALUE 'FINANCE';

-- AlterEnum
ALTER TYPE "public"."SubscriptionStatus" ADD VALUE 'EXPIRED';

-- AlterEnum
ALTER TYPE "public"."NotificationType" ADD VALUE 'BILLING';

-- AlterTable
ALTER TABLE "public"."groups" ADD COLUMN     "countryCode" TEXT NOT NULL DEFAULT 'KE',
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'KES',
ADD COLUMN     "locale" TEXT NOT NULL DEFAULT 'en-KE',
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Africa/Nairobi';

-- AlterTable
ALTER TABLE "public"."journal_entries" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'KES';

-- AlterTable
ALTER TABLE "public"."payments" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'KES';

-- AlterTable
ALTER TABLE "public"."plans" ADD COLUMN     "description" TEXT,
ADD COLUMN     "entitlements" JSONB,
ADD COLUMN     "isPublic" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "tier" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Existing plans become legacy plans: hidden, inactive, member cap kept, no paid features.
-- (Their subscriptions keep working until they end; staff can move groups to a current plan.)
UPDATE "public"."plans" SET
  "entitlements" = jsonb_build_object('features', '[]'::jsonb, 'limits', jsonb_build_object('maxMembers', "maxMembers")),
  "isPublic" = false,
  "active" = false,
  "description" = 'Legacy plan from before plan pricing by region';

-- AlterTable
ALTER TABLE "public"."subscriptions" ADD COLUMN     "amountMinor" BIGINT,
ADD COLUMN     "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "currency" TEXT,
ADD COLUMN     "currentPeriodStart" TIMESTAMP(3),
ADD COLUMN     "graceEndsAt" TIMESTAMP(3),
ADD COLUMN     "interval" "public"."BillingInterval",
ADD COLUMN     "remindersSent" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "scheduledInterval" "public"."BillingInterval",
ADD COLUMN     "scheduledPlanId" TEXT;

-- AlterTable
ALTER TABLE "public"."users" ADD COLUMN     "locale" TEXT NOT NULL DEFAULT 'en';

-- CreateTable
CREATE TABLE "public"."plan_prices" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL DEFAULT '*',
    "currency" TEXT NOT NULL,
    "interval" "public"."BillingInterval" NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."promotional_grants" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "grantedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "revokeReason" TEXT,

    CONSTRAINT "promotional_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."billing_payments" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "planId" TEXT NOT NULL,
    "interval" "public"."BillingInterval" NOT NULL,
    "purpose" "public"."BillingPurpose" NOT NULL,
    "provider" TEXT NOT NULL,
    "providerRef" TEXT,
    "livemode" BOOLEAN NOT NULL,
    "currency" TEXT NOT NULL,
    "priceMinor" BIGINT NOT NULL,
    "creditMinor" BIGINT NOT NULL DEFAULT 0,
    "amountMinor" BIGINT NOT NULL,
    "feeMinor" BIGINT,
    "refundedMinor" BIGINT NOT NULL DEFAULT 0,
    "status" "public"."BillingPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "failureReason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "initiatedById" TEXT,
    "payerHint" TEXT,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "receiptNumber" TEXT,
    "paidAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."billing_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "paymentId" TEXT,
    "livemode" BOOLEAN NOT NULL,
    "signatureValid" BOOLEAN NOT NULL,
    "payload" JSONB NOT NULL,
    "result" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "billing_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."billing_refunds" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerRef" TEXT,
    "status" "public"."BillingRefundStatus" NOT NULL DEFAULT 'PENDING',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."subscription_events" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fromPlan" TEXT,
    "toPlan" TEXT,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "paymentId" TEXT,
    "actorUserId" TEXT,
    "reason" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."billing_cases" (
    "id" TEXT NOT NULL,
    "groupId" TEXT,
    "paymentId" TEXT,
    "subject" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "status" "public"."BillingCaseStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "public"."BillingCasePriority" NOT NULL DEFAULT 'NORMAL',
    "createdById" TEXT NOT NULL,
    "assignedToId" TEXT,
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."regions" (
    "countryCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultCurrency" TEXT NOT NULL,
    "defaultTimezone" TEXT NOT NULL,
    "defaultLocale" TEXT NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT false,
    "billingAvailable" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "regions_pkey" PRIMARY KEY ("countryCode")
);

-- CreateTable
CREATE TABLE "public"."billing_provider_availability" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "methods" TEXT[],
    "recurring" BOOLEAN NOT NULL DEFAULT false,
    "refunds" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_provider_availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."exchange_rates" (
    "id" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL,
    "quoteCurrency" TEXT NOT NULL,
    "rate" DECIMAL(24,12) NOT NULL,
    "asOf" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."operating_costs" (
    "id" TEXT NOT NULL,
    "category" "public"."OperatingCostCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "incurredOn" DATE NOT NULL,
    "source" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operating_costs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plan_prices_planId_countryCode_currency_interval_key" ON "public"."plan_prices"("planId", "countryCode", "currency", "interval");

-- CreateIndex
CREATE INDEX "promotional_grants_groupId_endsAt_idx" ON "public"."promotional_grants"("groupId", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "billing_payments_reference_key" ON "public"."billing_payments"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "billing_payments_idempotencyKey_key" ON "public"."billing_payments"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "billing_payments_receiptNumber_key" ON "public"."billing_payments"("receiptNumber");

-- CreateIndex
CREATE INDEX "billing_payments_status_createdAt_idx" ON "public"."billing_payments"("status", "createdAt");

-- CreateIndex
CREATE INDEX "billing_payments_groupId_createdAt_idx" ON "public"."billing_payments"("groupId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "billing_payments_provider_providerRef_key" ON "public"."billing_payments"("provider", "providerRef");

-- CreateIndex
CREATE UNIQUE INDEX "billing_events_provider_providerEventId_key" ON "public"."billing_events"("provider", "providerEventId");

-- CreateIndex
CREATE INDEX "subscription_events_groupId_createdAt_idx" ON "public"."subscription_events"("groupId", "createdAt");

-- CreateIndex
CREATE INDEX "subscription_events_type_createdAt_idx" ON "public"."subscription_events"("type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "billing_provider_availability_provider_countryCode_currency_key" ON "public"."billing_provider_availability"("provider", "countryCode", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "exchange_rates_baseCurrency_quoteCurrency_asOf_key" ON "public"."exchange_rates"("baseCurrency", "quoteCurrency", "asOf");

-- CreateIndex
CREATE INDEX "operating_costs_incurredOn_idx" ON "public"."operating_costs"("incurredOn");

-- CreateIndex
CREATE INDEX "subscriptions_status_currentPeriodEnd_idx" ON "public"."subscriptions"("status", "currentPeriodEnd");

-- AddForeignKey
ALTER TABLE "public"."plan_prices" ADD CONSTRAINT "plan_prices_planId_fkey" FOREIGN KEY ("planId") REFERENCES "public"."plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."promotional_grants" ADD CONSTRAINT "promotional_grants_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."promotional_grants" ADD CONSTRAINT "promotional_grants_planId_fkey" FOREIGN KEY ("planId") REFERENCES "public"."plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."billing_payments" ADD CONSTRAINT "billing_payments_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."billing_payments" ADD CONSTRAINT "billing_payments_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "public"."subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."billing_events" ADD CONSTRAINT "billing_events_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "public"."billing_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."billing_refunds" ADD CONSTRAINT "billing_refunds_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "public"."billing_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "public"."billing_payments" ADD CONSTRAINT "billing_payments_planId_fkey" FOREIGN KEY ("planId") REFERENCES "public"."plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================================
-- Data: legacy prices, initial configuration (all editable by platform staff)
-- =====================================================================================

-- Legacy plan prices (KES per month) are kept as inactive price rows for history.
INSERT INTO "public"."plan_prices" ("id", "planId", "countryCode", "currency", "interval", "amountMinor", "active", "updatedAt")
SELECT 'legacy_' || "id", "id", '*', 'KES', 'MONTH', "priceCents", false, CURRENT_TIMESTAMP FROM "public"."plans";

UPDATE "public"."subscriptions" s SET "currency" = 'KES', "interval" = 'MONTH', "amountMinor" = p."priceCents"
FROM "public"."plans" p WHERE p."id" = s."planId";

ALTER TABLE "public"."plans" DROP COLUMN "features", DROP COLUMN "maxMembers", DROP COLUMN "priceCents";
ALTER TABLE "public"."plans" ALTER COLUMN "entitlements" SET NOT NULL, ALTER COLUMN "updatedAt" DROP DEFAULT;

-- Plans. PRICES ARE PLACEHOLDERS: replace them with the approved Kenya prices in
-- Platform › Plans & pricing before taking real payments.
INSERT INTO "public"."plans" ("id", "code", "name", "description", "tier", "entitlements", "active", "isPublic", "updatedAt") VALUES
  ('plan_free', 'FREE', 'Free', 'Core records for small groups: contributions, payments, statements, rotations and meetings.', 0,
   '{"features": [], "limits": {"maxMembers": 15}}', true, true, CURRENT_TIMESTAMP),
  ('plan_starter', 'STARTER', 'Starter', 'Loans, reminders and WhatsApp summaries for growing groups.', 10,
   '{"features": ["loans", "contribution_reminders", "whatsapp_summaries"], "limits": {"maxMembers": 30}}', true, true, CURRENT_TIMESTAMP),
  ('plan_standard', 'STANDARD', 'Standard', 'Statement import and bulk data import for busy treasurers.', 20,
   '{"features": ["loans", "contribution_reminders", "whatsapp_summaries", "statement_import", "bulk_import"], "limits": {"maxMembers": 100}}', true, true, CURRENT_TIMESTAMP),
  ('plan_premium', 'PREMIUM', 'Premium', 'Everything, including the AI assistant and priority support.', 30,
   '{"features": ["loans", "contribution_reminders", "whatsapp_summaries", "statement_import", "bulk_import", "ai_assistant", "priority_support"], "limits": {"maxMembers": 500}}', true, true, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name", "description" = EXCLUDED."description", "tier" = EXCLUDED."tier",
  "entitlements" = EXCLUDED."entitlements", "active" = true, "isPublic" = true, "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "public"."plan_prices" ("id", "planId", "countryCode", "currency", "interval", "amountMinor", "active", "updatedAt")
SELECT 'price_' || lower(p."code") || '_ke_' || lower(v.interval), p."id", 'KE', 'KES', v.interval::"public"."BillingInterval", v.amount, true, CURRENT_TIMESTAMP
FROM "public"."plans" p
JOIN (VALUES
  ('STARTER', 'MONTH', 50000), ('STARTER', 'YEAR', 500000),
  ('STANDARD', 'MONTH', 100000), ('STANDARD', 'YEAR', 1000000),
  ('PREMIUM', 'MONTH', 200000), ('PREMIUM', 'YEAR', 2000000)
) AS v(code, interval, amount) ON v.code = p."code"
ON CONFLICT ("planId", "countryCode", "currency", "interval") DO NOTHING;

INSERT INTO "public"."regions" ("countryCode", "name", "defaultCurrency", "defaultTimezone", "defaultLocale", "available", "billingAvailable", "notes", "updatedAt") VALUES
  ('KE', 'Kenya', 'KES', 'Africa/Nairobi', 'en-KE', true, true, 'Launch market.', CURRENT_TIMESTAMP),
  ('UG', 'Uganda', 'UGX', 'Africa/Kampala', 'en-UG', false, false, 'Not launched: legal, tax and payment review pending.', CURRENT_TIMESTAMP),
  ('TZ', 'Tanzania', 'TZS', 'Africa/Dar_es_Salaam', 'sw-TZ', false, false, 'Not launched: legal, tax and payment review pending.', CURRENT_TIMESTAMP),
  ('RW', 'Rwanda', 'RWF', 'Africa/Kigali', 'en-RW', false, false, 'Not launched: legal, tax and payment review pending.', CURRENT_TIMESTAMP),
  ('ZA', 'South Africa', 'ZAR', 'Africa/Johannesburg', 'en-ZA', false, false, 'Not launched: legal, tax and payment review pending.', CURRENT_TIMESTAMP),
  ('NG', 'Nigeria', 'NGN', 'Africa/Lagos', 'en-NG', false, false, 'Not launched: legal, tax and payment review pending.', CURRENT_TIMESTAMP),
  ('GH', 'Ghana', 'GHS', 'Africa/Accra', 'en-GH', false, false, 'Not launched: legal, tax and payment review pending.', CURRENT_TIMESTAMP)
ON CONFLICT ("countryCode") DO NOTHING;

INSERT INTO "public"."billing_provider_availability" ("id", "provider", "countryCode", "currency", "methods", "recurring", "refunds", "enabled", "updatedAt") VALUES
  ('bpa_mpesa_ke', 'MPESA_DARAJA', 'KE', 'KES', ARRAY['MPESA_STK'], false, false, true, CURRENT_TIMESTAMP),
  ('bpa_manual_ke', 'MANUAL', 'KE', 'KES', ARRAY['BANK_TRANSFER', 'INVOICE'], false, true, true, CURRENT_TIMESTAMP),
  ('bpa_sandbox_ke', 'SANDBOX', 'KE', 'KES', ARRAY['TEST'], false, true, true, CURRENT_TIMESTAMP),
  ('bpa_paystack_ke', 'PAYSTACK', 'KE', 'KES', ARRAY['CARD', 'MPESA'], false, true, false, CURRENT_TIMESTAMP),
  ('bpa_paystack_ng', 'PAYSTACK', 'NG', 'NGN', ARRAY['CARD', 'BANK_TRANSFER', 'USSD'], false, true, false, CURRENT_TIMESTAMP),
  ('bpa_paystack_gh', 'PAYSTACK', 'GH', 'GHS', ARRAY['CARD', 'MOBILE_MONEY'], false, true, false, CURRENT_TIMESTAMP),
  ('bpa_paystack_za', 'PAYSTACK', 'ZA', 'ZAR', ARRAY['CARD', 'EFT'], false, true, false, CURRENT_TIMESTAMP)
ON CONFLICT ("provider", "countryCode", "currency") DO NOTHING;

CREATE SEQUENCE IF NOT EXISTS "public"."billing_receipt_seq" START 1000;

-- =====================================================================================
-- Currency integrity: one base currency per group, recorded on every money record
-- =====================================================================================

CREATE OR REPLACE FUNCTION chamahub_stamp_group_currency() RETURNS trigger AS $$
BEGIN
  SELECT "currency" INTO NEW."currency" FROM "groups" WHERE "id" = NEW."groupId";
  IF NEW."currency" IS NULL THEN
    RAISE EXCEPTION 'Unknown group % for money record', NEW."groupId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payments_currency BEFORE INSERT ON "payments" FOR EACH ROW EXECUTE FUNCTION chamahub_stamp_group_currency();
CREATE TRIGGER journal_entries_currency BEFORE INSERT ON "journal_entries" FOR EACH ROW EXECUTE FUNCTION chamahub_stamp_group_currency();

CREATE OR REPLACE FUNCTION groups_currency_guard() RETURNS trigger AS $$
BEGIN
  IF NEW."currency" IS DISTINCT FROM OLD."currency"
     AND (EXISTS (SELECT 1 FROM "journal_entries" WHERE "groupId" = OLD."id") OR EXISTS (SELECT 1 FROM "payments" WHERE "groupId" = OLD."id")) THEN
    RAISE EXCEPTION 'currency_locked: a group''s base currency cannot change once it has money records';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER groups_currency_locked BEFORE UPDATE OF "currency" ON "groups" FOR EACH ROW EXECUTE FUNCTION groups_currency_guard();

-- =====================================================================================
-- Billing integrity
-- =====================================================================================

ALTER TABLE "billing_payments" ADD CONSTRAINT "billing_payments_amounts" CHECK (
  "priceMinor" >= 0 AND "creditMinor" >= 0 AND "amountMinor" >= 0 AND "amountMinor" = "priceMinor" - "creditMinor"
  AND "refundedMinor" >= 0 AND "refundedMinor" <= "amountMinor" AND ("feeMinor" IS NULL OR "feeMinor" >= 0));
ALTER TABLE "billing_refunds" ADD CONSTRAINT "billing_refunds_positive" CHECK ("amountMinor" > 0);
ALTER TABLE "plan_prices" ADD CONSTRAINT "plan_prices_non_negative" CHECK ("amountMinor" >= 0);
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_positive" CHECK ("rate" > 0 AND "baseCurrency" <> "quoteCurrency");
ALTER TABLE "operating_costs" ADD CONSTRAINT "operating_costs_positive" CHECK ("amountMinor" > 0);

-- A charge's money facts never change after it is created; only its status, provider details and receipt do.
CREATE OR REPLACE FUNCTION billing_payments_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'append-only: billing payments cannot be deleted';
  END IF;
  IF NEW."reference" IS DISTINCT FROM OLD."reference" OR NEW."groupId" IS DISTINCT FROM OLD."groupId"
     OR NEW."currency" IS DISTINCT FROM OLD."currency" OR NEW."priceMinor" IS DISTINCT FROM OLD."priceMinor"
     OR NEW."creditMinor" IS DISTINCT FROM OLD."creditMinor" OR NEW."amountMinor" IS DISTINCT FROM OLD."amountMinor"
     OR NEW."provider" IS DISTINCT FROM OLD."provider" OR NEW."livemode" IS DISTINCT FROM OLD."livemode"
     OR NEW."planId" IS DISTINCT FROM OLD."planId" OR NEW."interval" IS DISTINCT FROM OLD."interval"
     OR NEW."purpose" IS DISTINCT FROM OLD."purpose" OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
     OR (OLD."receiptNumber" IS NOT NULL AND NEW."receiptNumber" IS DISTINCT FROM OLD."receiptNumber")
     OR NEW."refundedMinor" < OLD."refundedMinor" THEN
    RAISE EXCEPTION 'append-only: a billing payment''s amount, currency, plan and reference cannot change';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER billing_payments_immutable BEFORE UPDATE OR DELETE ON "billing_payments" FOR EACH ROW EXECUTE FUNCTION billing_payments_guard();

-- Provider events are evidence: stored once, then only their processing result may be set, once.
CREATE OR REPLACE FUNCTION billing_events_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'append-only: billing events cannot be deleted';
  END IF;
  IF NEW."provider" IS DISTINCT FROM OLD."provider" OR NEW."providerEventId" IS DISTINCT FROM OLD."providerEventId"
     OR NEW."type" IS DISTINCT FROM OLD."type" OR NEW."payload" IS DISTINCT FROM OLD."payload"
     OR NEW."signatureValid" IS DISTINCT FROM OLD."signatureValid" OR NEW."livemode" IS DISTINCT FROM OLD."livemode"
     OR NEW."receivedAt" IS DISTINCT FROM OLD."receivedAt"
     OR (OLD."processedAt" IS NOT NULL AND (NEW."processedAt" IS DISTINCT FROM OLD."processedAt" OR NEW."result" IS DISTINCT FROM OLD."result"))
     OR (OLD."paymentId" IS NOT NULL AND NEW."paymentId" IS DISTINCT FROM OLD."paymentId") THEN
    RAISE EXCEPTION 'append-only: billing events cannot be edited';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER billing_events_immutable BEFORE UPDATE OR DELETE ON "billing_events" FOR EACH ROW EXECUTE FUNCTION billing_events_guard();

CREATE OR REPLACE FUNCTION billing_refunds_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'append-only: refunds cannot be deleted';
  END IF;
  IF NEW."paymentId" IS DISTINCT FROM OLD."paymentId" OR NEW."amountMinor" IS DISTINCT FROM OLD."amountMinor"
     OR NEW."currency" IS DISTINCT FROM OLD."currency" OR NEW."reason" IS DISTINCT FROM OLD."reason"
     OR NEW."createdById" IS DISTINCT FROM OLD."createdById" OR OLD."status" <> 'PENDING' THEN
    RAISE EXCEPTION 'append-only: a refund can only move from pending to its outcome';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER billing_refunds_immutable BEFORE UPDATE OR DELETE ON "billing_refunds" FOR EACH ROW EXECUTE FUNCTION billing_refunds_guard();

CREATE TRIGGER subscription_events_append_only BEFORE UPDATE OR DELETE ON "subscription_events" FOR EACH ROW EXECUTE FUNCTION chamahub_forbid_mutation();
CREATE TRIGGER exchange_rates_append_only BEFORE UPDATE OR DELETE ON "exchange_rates" FOR EACH ROW EXECUTE FUNCTION chamahub_forbid_mutation();
CREATE TRIGGER operating_costs_append_only BEFORE UPDATE OR DELETE ON "operating_costs" FOR EACH ROW EXECUTE FUNCTION chamahub_forbid_mutation();
CREATE TRIGGER billing_tables_no_truncate BEFORE TRUNCATE ON "billing_payments" FOR EACH STATEMENT EXECUTE FUNCTION chamahub_forbid_mutation();
CREATE TRIGGER billing_events_no_truncate BEFORE TRUNCATE ON "billing_events" FOR EACH STATEMENT EXECUTE FUNCTION chamahub_forbid_mutation();
CREATE TRIGGER subscription_events_no_truncate BEFORE TRUNCATE ON "subscription_events" FOR EACH STATEMENT EXECUTE FUNCTION chamahub_forbid_mutation();

-- New tables are closed to hosted Data APIs too (see 20261026000000_lock_down_data_api).
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = current_schema() LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', current_schema(), t.tablename);
  END LOOP;
END
$$;
