-- CreateEnum
CREATE TYPE "public"."DisbursementStatus" AS ENUM ('PROCESSING', 'CONFIRMED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."PayoutConfirmationKind" AS ENUM ('RECIPIENT', 'OFFICER_VERIFIED');

-- CreateEnum
CREATE TYPE "public"."RotationOrderMethod" AS ENUM ('AGREED', 'RANDOM_DRAW', 'CARRY_OVER');

-- CreateEnum
CREATE TYPE "public"."RotationApprovalMode" AS ENUM ('OFFICERS', 'MEMBER_VOTE');

-- CreateEnum
CREATE TYPE "public"."RotationAmendmentKind" AS ENUM ('REORDER', 'ADD_MEMBERS', 'REMOVE_MEMBER', 'REPLACE_MEMBER');

-- AlterEnum
ALTER TYPE "public"."ApprovalEntity" ADD VALUE 'CYCLE_ACTIVATION';

-- AlterEnum
ALTER TYPE "public"."NotificationType" ADD VALUE 'PAYOUT_APPROVED';
ALTER TYPE "public"."NotificationType" ADD VALUE 'PAYOUT_SENT';
ALTER TYPE "public"."NotificationType" ADD VALUE 'PAYOUT_FAILED';
ALTER TYPE "public"."NotificationType" ADD VALUE 'ROTATION_UPDATED';

-- AlterEnum
BEGIN;
CREATE TYPE "public"."PayoutStatus_new" AS ENUM ('SCHEDULED', 'AWAITING_APPROVAL', 'APPROVED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');
ALTER TABLE "public"."payout_rounds" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "public"."payout_rounds" ALTER COLUMN "status" TYPE "public"."PayoutStatus_new" USING ((CASE "status"::text WHEN 'COLLECTING' THEN 'SCHEDULED' WHEN 'READY' THEN 'SCHEDULED' WHEN 'DEFERRED' THEN 'SCHEDULED' ELSE "status"::text END)::"public"."PayoutStatus_new");
ALTER TYPE "public"."PayoutStatus" RENAME TO "PayoutStatus_old";
ALTER TYPE "public"."PayoutStatus_new" RENAME TO "PayoutStatus";
DROP TYPE "public"."PayoutStatus_old";
ALTER TABLE "public"."payout_rounds" ALTER COLUMN "status" SET DEFAULT 'SCHEDULED';
COMMIT;

-- DropIndex
DROP INDEX "public"."payout_rounds_cycleId_round_key";

-- DropIndex
DROP INDEX "public"."payout_rounds_payoutKey_key";

-- AlterTable
ALTER TABLE "public"."cycle_changes" ADD COLUMN     "joined" JSONB,
ADD COLUMN     "kind" "public"."RotationAmendmentKind" NOT NULL DEFAULT 'REORDER',
ADD COLUMN     "left" JSONB;

-- AlterTable
ALTER TABLE "public"."disputes" ADD COLUMN     "roundId" TEXT;

-- AlterTable
ALTER TABLE "public"."payout_cycles" ADD COLUMN     "activatedAt" TIMESTAMP(3),
ADD COLUMN     "approvalMode" "public"."RotationApprovalMode" NOT NULL DEFAULT 'OFFICERS',
ADD COLUMN     "approvedPlan" JSONB,
ADD COLUMN     "drawParticipants" JSONB,
ADD COLUMN     "drawSeed" TEXT,
ADD COLUMN     "orderMethod" "public"."RotationOrderMethod" NOT NULL DEFAULT 'AGREED',
ADD COLUMN     "previousCycleId" TEXT,
ADD COLUMN     "proposalId" TEXT,
ADD COLUMN     "recipientsPerRound" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "public"."payout_rounds" ADD COLUMN "legacyPayoutKey" TEXT;
UPDATE "public"."payout_rounds" SET "legacyPayoutKey" = "payoutKey";
ALTER TABLE "public"."payout_rounds" DROP COLUMN "payoutKey",
ADD COLUMN     "cancelledReason" TEXT,
ADD COLUMN     "preparationNo" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "preparedAmountCents" BIGINT,
ADD COLUMN     "preparedAt" TIMESTAMP(3),
ADD COLUMN     "preparedByMembershipId" TEXT,
ADD COLUMN     "readinessSnapshot" JSONB,
ADD COLUMN     "slot" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "public"."proposals" ADD COLUMN     "subjectId" TEXT,
ADD COLUMN     "subjectType" TEXT;

-- AlterTable
ALTER TABLE "public"."schedule_members" ADD COLUMN     "fromDate" DATE,
ADD COLUMN     "untilDate" DATE;

-- CreateTable
CREATE TABLE "public"."payout_disbursements" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "method" "public"."PaymentMethod" NOT NULL,
    "reference" TEXT,
    "destination" TEXT,
    "sentOn" DATE NOT NULL,
    "evidenceNote" TEXT,
    "recordedByMembershipId" TEXT NOT NULL,
    "status" "public"."DisbursementStatus" NOT NULL DEFAULT 'PROCESSING',
    "confirmationKind" "public"."PayoutConfirmationKind",
    "confirmedByUserId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "confirmationNote" TEXT,
    "failureReason" TEXT,
    "failedByUserId" TEXT,
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payout_disbursements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payout_disbursements_idempotencyKey_key" ON "public"."payout_disbursements"("idempotencyKey");

-- CreateIndex
CREATE INDEX "payout_disbursements_groupId_status_idx" ON "public"."payout_disbursements"("groupId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payout_disbursements_roundId_attempt_key" ON "public"."payout_disbursements"("roundId", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "payout_disbursements_groupId_reference_key" ON "public"."payout_disbursements"("groupId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "payout_cycles_proposalId_key" ON "public"."payout_cycles"("proposalId");

-- CreateIndex
CREATE UNIQUE INDEX "payout_rounds_cycleId_round_slot_key" ON "public"."payout_rounds"("cycleId", "round", "slot");

-- AddForeignKey
ALTER TABLE "public"."payout_disbursements" ADD CONSTRAINT "payout_disbursements_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "public"."payout_rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Backfill: payouts completed before this migration become confirmed disbursement attempts.
INSERT INTO "public"."payout_disbursements" ("id", "groupId", "roundId", "attempt", "idempotencyKey", "amountCents", "method", "reference", "sentOn", "recordedByMembershipId", "status", "confirmationKind", "confirmedAt", "confirmationNote")
SELECT 'legacy_' || r."id", c."groupId", r."id", 1, COALESCE(r."legacyPayoutKey", 'legacy_' || r."id"), r."payoutAmountCents", COALESCE(r."payoutMethod", 'OTHER'), r."payoutReference", COALESCE(r."completedAt", r."payoutDate")::date, r."membershipId", 'CONFIRMED', 'OFFICER_VERIFIED', r."completedAt", 'Recorded before payout confirmations were introduced'
FROM "public"."payout_rounds" r JOIN "public"."payout_cycles" c ON c."id" = r."cycleId"
WHERE r."status" = 'COMPLETED' AND r."payoutAmountCents" IS NOT NULL;
ALTER TABLE "public"."payout_rounds" DROP COLUMN "legacyPayoutKey";

-- Backfill: cycles already running keep their current schedule as the approved one.
UPDATE "public"."payout_cycles" c SET
  "activatedAt" = c."createdAt",
  "approvedPlan" = (
    SELECT jsonb_agg(jsonb_build_object('round', r."round", 'slot', r."slot", 'membershipId', r."membershipId", 'payoutDate', to_char(r."payoutDate", 'YYYY-MM-DD')) ORDER BY r."round", r."slot")
    FROM "public"."payout_rounds" r WHERE r."cycleId" = c."id")
WHERE c."status" IN ('ACTIVE', 'COMPLETED');

-- Integrity: payouts and their attempts.
ALTER TABLE "public"."payout_rounds" ADD CONSTRAINT "payout_rounds_slot_positive" CHECK ("slot" >= 1 AND "round" >= 1);
ALTER TABLE "public"."payout_rounds" ADD CONSTRAINT "payout_rounds_amounts_positive" CHECK (("payoutAmountCents" IS NULL OR "payoutAmountCents" > 0) AND ("preparedAmountCents" IS NULL OR "preparedAmountCents" > 0));
ALTER TABLE "public"."payout_disbursements" ADD CONSTRAINT "payout_disbursements_amount_positive" CHECK ("amountCents" > 0);
ALTER TABLE "public"."payout_disbursements" ADD CONSTRAINT "payout_disbursements_outcome_consistent" CHECK (
  ("status" = 'PROCESSING' AND "confirmedAt" IS NULL AND "failedAt" IS NULL) OR
  ("status" = 'CONFIRMED' AND "confirmationKind" IS NOT NULL AND "failedAt" IS NULL) OR
  ("status" = 'FAILED' AND "failureReason" IS NOT NULL AND "confirmedAt" IS NULL));
-- At most one live (sent or confirmed) attempt per payout: a payout can never be sent twice.
CREATE UNIQUE INDEX "payout_disbursements_one_live_attempt" ON "public"."payout_disbursements" ("roundId") WHERE "status" IN ('PROCESSING', 'CONFIRMED');

-- Attempts are never deleted, and their facts never change. Only the outcome
-- of a PROCESSING attempt may be recorded, exactly once.
CREATE OR REPLACE FUNCTION payout_disbursements_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payout_disbursements is append-only';
  END IF;
  IF OLD."status" <> 'PROCESSING' THEN
    RAISE EXCEPTION 'payout attempt % already has an outcome (%)', OLD."id", OLD."status";
  END IF;
  IF NEW."roundId" IS DISTINCT FROM OLD."roundId" OR NEW."groupId" IS DISTINCT FROM OLD."groupId" OR NEW."attempt" IS DISTINCT FROM OLD."attempt"
     OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey" OR NEW."amountCents" IS DISTINCT FROM OLD."amountCents"
     OR NEW."method" IS DISTINCT FROM OLD."method" OR NEW."reference" IS DISTINCT FROM OLD."reference"
     OR NEW."destination" IS DISTINCT FROM OLD."destination" OR NEW."sentOn" IS DISTINCT FROM OLD."sentOn"
     OR NEW."evidenceNote" IS DISTINCT FROM OLD."evidenceNote" OR NEW."recordedByMembershipId" IS DISTINCT FROM OLD."recordedByMembershipId" THEN
    RAISE EXCEPTION 'the facts of a payout attempt cannot be changed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payout_disbursements_guard BEFORE UPDATE OR DELETE ON "public"."payout_disbursements" FOR EACH ROW EXECUTE FUNCTION payout_disbursements_guard();
CREATE OR REPLACE FUNCTION payout_disbursements_no_truncate() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'payout_disbursements is append-only'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payout_disbursements_no_truncate BEFORE TRUNCATE ON "public"."payout_disbursements" FOR EACH STATEMENT EXECUTE FUNCTION payout_disbursements_no_truncate();
