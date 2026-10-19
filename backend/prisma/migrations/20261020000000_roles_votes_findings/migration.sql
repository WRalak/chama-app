-- CreateEnum
CREATE TYPE "public"."SpecialRole" AS ENUM ('LOAN_COMMITTEE', 'PAYOUT_APPROVER', 'JOINT_SIGNATORY', 'READ_ONLY');

-- CreateEnum
CREATE TYPE "public"."ProposalStatus" AS ENUM ('OPEN', 'PASSED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."VoteChoice" AS ENUM ('YES', 'NO', 'ABSTAIN');

-- CreateEnum
CREATE TYPE "public"."FindingSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "public"."FindingStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "public"."PlatformRole" ADD VALUE 'PLATFORM_ADMIN';

-- AlterTable
ALTER TABLE "public"."groups" ADD COLUMN     "rolePolicy" JSONB;

-- AlterTable
ALTER TABLE "public"."loans" ADD COLUMN     "preparedByMembershipId" TEXT;

-- AlterTable
ALTER TABLE "public"."memberships" ADD COLUMN     "specialRoles" "public"."SpecialRole"[] DEFAULT ARRAY[]::"public"."SpecialRole"[];

-- CreateTable
CREATE TABLE "public"."proposals" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "public"."ProposalStatus" NOT NULL DEFAULT 'OPEN',
    "quorumPercent" INTEGER NOT NULL,
    "passPercent" INTEGER NOT NULL,
    "eligibleCount" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."votes" (
    "proposalId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "choice" "public"."VoteChoice" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "votes_pkey" PRIMARY KEY ("proposalId","membershipId")
);

-- CreateTable
CREATE TABLE "public"."audit_findings" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "raisedByMembershipId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "severity" "public"."FindingSeverity" NOT NULL,
    "status" "public"."FindingStatus" NOT NULL DEFAULT 'OPEN',
    "entityType" TEXT,
    "entityId" TEXT,
    "reference" TEXT,
    "response" TEXT,
    "respondedByMembershipId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."platform_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "proposals_groupId_status_idx" ON "public"."proposals"("groupId", "status");

-- CreateIndex
CREATE INDEX "audit_findings_groupId_status_idx" ON "public"."audit_findings"("groupId", "status");

-- AddForeignKey
ALTER TABLE "public"."proposals" ADD CONSTRAINT "proposals_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."votes" ADD CONSTRAINT "votes_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "public"."proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."audit_findings" ADD CONSTRAINT "audit_findings_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Ballots are final: no changing or deleting a cast vote.
CREATE TRIGGER votes_append_only BEFORE UPDATE OR DELETE ON "votes"
  FOR EACH ROW EXECUTE FUNCTION chamahub_forbid_mutation();
CREATE TRIGGER votes_no_truncate BEFORE TRUNCATE ON "votes"
  FOR EACH STATEMENT EXECUTE FUNCTION chamahub_forbid_mutation();
