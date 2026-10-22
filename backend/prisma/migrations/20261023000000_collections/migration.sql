-- CreateEnum
CREATE TYPE "public"."DestinationType" AS ENUM ('PERSONAL_MPESA', 'OTHER_MOBILE_MONEY', 'PAYBILL', 'TILL', 'BANK_ACCOUNT', 'BANK_TRANSFER', 'CASH', 'PROVIDER', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."DestinationStatus" AS ENUM ('PENDING_APPROVAL', 'ACTIVE', 'RETIRED', 'REJECTED');

-- CreateEnum
CREATE TYPE "public"."DestinationVerification" AS ENUM ('MANUAL_REVIEW', 'STATEMENT_IMPORT', 'PROVIDER_CALLBACK');

-- CreateEnum
CREATE TYPE "public"."StatementImportStatus" AS ENUM ('REVIEWING', 'CLOSED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "public"."StatementMatch" AS ENUM ('REPORT_MATCH', 'STRONG', 'SUGGESTED', 'AMBIGUOUS', 'UNMATCHED', 'DUPLICATE', 'OUTGOING');

-- CreateEnum
CREATE TYPE "public"."StatementLineState" AS ENUM ('OPEN', 'CONFIRMED', 'IGNORED');

-- AlterEnum
ALTER TYPE "public"."ApprovalEntity" ADD VALUE 'DESTINATION';

-- AlterEnum
ALTER TYPE "public"."NotificationType" ADD VALUE 'DESTINATION_CHANGED';

-- AlterEnum
ALTER TYPE "public"."PaymentSource" ADD VALUE 'STATEMENT';

-- AlterTable
ALTER TABLE "public"."payments" ADD COLUMN     "destinationId" TEXT;

-- CreateTable
CREATE TABLE "public"."payment_destinations" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "type" "public"."DestinationType" NOT NULL,
    "displayName" TEXT NOT NULL,
    "provider" TEXT,
    "accountNumber" TEXT,
    "accountReference" TEXT,
    "accountName" TEXT,
    "branch" TEXT,
    "instructions" TEXT,
    "intendedUse" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "responsibleMembershipId" TEXT,
    "verification" "public"."DestinationVerification" NOT NULL DEFAULT 'MANUAL_REVIEW',
    "status" "public"."DestinationStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "replacesId" TEXT,
    "proposedByMembershipId" TEXT NOT NULL,
    "proposalReason" TEXT,
    "requiredApprovals" INTEGER NOT NULL DEFAULT 1,
    "decidedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "retiredReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_destinations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."payment_evidence" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "note" TEXT,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."payment_events" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fromStatus" "public"."TransactionStatus",
    "toStatus" "public"."TransactionStatus",
    "actorUserId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."statement_imports" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "destinationId" TEXT,
    "fileName" TEXT NOT NULL,
    "fileSha256" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "status" "public"."StatementImportStatus" NOT NULL DEFAULT 'REVIEWING',
    "lineCount" INTEGER NOT NULL,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "periodFrom" DATE,
    "periodTo" DATE,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "statement_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."statement_lines" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "rowNo" INTEGER NOT NULL,
    "transactionAt" TIMESTAMP(3) NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "reference" TEXT,
    "payerName" TEXT,
    "payerPhone" TEXT,
    "accountReference" TEXT,
    "description" TEXT,
    "fingerprint" TEXT NOT NULL,
    "match" "public"."StatementMatch" NOT NULL,
    "candidates" JSONB NOT NULL DEFAULT '[]',
    "suggestedMembershipId" TEXT,
    "reportPaymentId" TEXT,
    "state" "public"."StatementLineState" NOT NULL DEFAULT 'OPEN',
    "resolvedMembershipId" TEXT,
    "resolvedPaymentId" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,

    CONSTRAINT "statement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_destinations_groupId_status_idx" ON "public"."payment_destinations"("groupId", "status");

-- CreateIndex
CREATE INDEX "payment_evidence_groupId_idx" ON "public"."payment_evidence"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_evidence_paymentId_sha256_key" ON "public"."payment_evidence"("paymentId", "sha256");

-- CreateIndex
CREATE INDEX "payment_events_paymentId_createdAt_idx" ON "public"."payment_events"("paymentId", "createdAt");

-- CreateIndex
CREATE INDEX "statement_imports_groupId_createdAt_idx" ON "public"."statement_imports"("groupId", "createdAt");

-- CreateIndex
CREATE INDEX "statement_lines_groupId_state_idx" ON "public"."statement_lines"("groupId", "state");

-- CreateIndex
CREATE INDEX "statement_lines_groupId_fingerprint_idx" ON "public"."statement_lines"("groupId", "fingerprint");

-- CreateIndex
CREATE INDEX "statement_lines_importId_rowNo_idx" ON "public"."statement_lines"("importId", "rowNo");

-- AddForeignKey
ALTER TABLE "public"."payments" ADD CONSTRAINT "payments_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "public"."payment_destinations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."payment_destinations" ADD CONSTRAINT "payment_destinations_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."payment_destinations" ADD CONSTRAINT "payment_destinations_replacesId_fkey" FOREIGN KEY ("replacesId") REFERENCES "public"."payment_destinations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."payment_evidence" ADD CONSTRAINT "payment_evidence_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "public"."payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."payment_events" ADD CONSTRAINT "payment_events_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "public"."payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."statement_imports" ADD CONSTRAINT "statement_imports_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."statement_imports" ADD CONSTRAINT "statement_imports_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "public"."payment_destinations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."statement_lines" ADD CONSTRAINT "statement_lines_importId_fkey" FOREIGN KEY ("importId") REFERENCES "public"."statement_imports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ───────── integrity rules the application cannot bypass ─────────

-- A destination's payment details never change. A new number, Paybill or
-- account is a new destination that replaces the old one, so the history of
-- where members were told to pay is always recoverable.
CREATE OR REPLACE FUNCTION payment_destinations_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payment destinations are never deleted; retire them instead' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."groupId" IS DISTINCT FROM OLD."groupId" OR NEW."type" IS DISTINCT FROM OLD."type"
     OR NEW."displayName" IS DISTINCT FROM OLD."displayName" OR NEW."provider" IS DISTINCT FROM OLD."provider"
     OR NEW."accountNumber" IS DISTINCT FROM OLD."accountNumber" OR NEW."accountReference" IS DISTINCT FROM OLD."accountReference"
     OR NEW."accountName" IS DISTINCT FROM OLD."accountName" OR NEW."branch" IS DISTINCT FROM OLD."branch"
     OR NEW."instructions" IS DISTINCT FROM OLD."instructions" OR NEW."intendedUse" IS DISTINCT FROM OLD."intendedUse"
     OR NEW."verification" IS DISTINCT FROM OLD."verification" OR NEW."replacesId" IS DISTINCT FROM OLD."replacesId"
     OR NEW."proposedByMembershipId" IS DISTINCT FROM OLD."proposedByMembershipId" OR NEW."requiredApprovals" IS DISTINCT FROM OLD."requiredApprovals" THEN
    RAISE EXCEPTION 'payment destination details cannot be changed; propose a replacement' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
       (OLD."status" = 'PENDING_APPROVAL' AND NEW."status" IN ('ACTIVE', 'REJECTED'))
    OR (OLD."status" = 'ACTIVE' AND NEW."status" = 'RETIRED')) THEN
    RAISE EXCEPTION 'payment destination cannot move from % to %', OLD."status", NEW."status" USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payment_destinations_guard BEFORE UPDATE OR DELETE ON "payment_destinations"
  FOR EACH ROW EXECUTE FUNCTION payment_destinations_guard();
CREATE TRIGGER payment_destinations_no_truncate BEFORE TRUNCATE ON "payment_destinations"
  FOR EACH STATEMENT EXECUTE FUNCTION chamahub_forbid_mutation();

-- Evidence and payment history are append-only.
CREATE TRIGGER payment_evidence_append_only BEFORE UPDATE OR DELETE ON "payment_evidence"
  FOR EACH ROW EXECUTE FUNCTION chamahub_forbid_mutation();
CREATE TRIGGER payment_evidence_no_truncate BEFORE TRUNCATE ON "payment_evidence"
  FOR EACH STATEMENT EXECUTE FUNCTION chamahub_forbid_mutation();
CREATE TRIGGER payment_events_append_only BEFORE UPDATE OR DELETE ON "payment_events"
  FOR EACH ROW EXECUTE FUNCTION chamahub_forbid_mutation();
CREATE TRIGGER payment_events_no_truncate BEFORE TRUNCATE ON "payment_events"
  FOR EACH STATEMENT EXECUTE FUNCTION chamahub_forbid_mutation();

-- Every payment status change is recorded, whichever code path made it.
CREATE OR REPLACE FUNCTION payments_log_status() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO "payment_events" ("id", "groupId", "paymentId", "kind", "fromStatus", "toStatus", "actorUserId", "note", "createdAt")
    VALUES (gen_random_uuid()::text, NEW."groupId", NEW."id", 'CREATED', NULL, NEW."status", NEW."recordedById", NULL, clock_timestamp());
  ELSIF NEW."status" IS DISTINCT FROM OLD."status" THEN
    INSERT INTO "payment_events" ("id", "groupId", "paymentId", "kind", "fromStatus", "toStatus", "actorUserId", "note", "createdAt")
    VALUES (gen_random_uuid()::text, NEW."groupId", NEW."id", 'STATUS_CHANGED', OLD."status", NEW."status",
            CASE WHEN NEW."status" = 'REVERSED' THEN NEW."reversedById" WHEN NEW."status" IN ('CONFIRMED', 'FAILED') THEN NEW."verifiedById" ELSE NULL END,
            CASE WHEN NEW."status" = 'REVERSED' THEN NEW."reversalReason" WHEN NEW."status" = 'FAILED' THEN NEW."failureReason" ELSE NULL END,
            clock_timestamp());
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payments_log_status AFTER INSERT OR UPDATE OF "status" ON "payments"
  FOR EACH ROW EXECUTE FUNCTION payments_log_status();

-- Payments recorded before this history existed get a starting entry.
INSERT INTO "payment_events" ("id", "groupId", "paymentId", "kind", "fromStatus", "toStatus", "actorUserId", "note", "createdAt")
SELECT gen_random_uuid()::text, "groupId", "id", 'CREATED', NULL, "status", "recordedById", 'Recorded before payment history was kept', "createdAt" FROM "payments";

-- A statement line can settle at most one payment, and vice versa.
CREATE UNIQUE INDEX "statement_lines_resolved_payment" ON "statement_lines" ("resolvedPaymentId") WHERE "resolvedPaymentId" IS NOT NULL;
ALTER TABLE "payment_evidence" ADD CONSTRAINT "payment_evidence_size" CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 3145728);
