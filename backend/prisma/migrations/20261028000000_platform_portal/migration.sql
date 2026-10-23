-- Platform administration portal: staff accounts separate from Chama members, database-backed roles,
-- invitations, sessions, password resets, an append-only audit log, and support cases.

-- CreateEnum
CREATE TYPE "public"."PlatformAccountStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "public"."PlatformAuditOutcome" AS ENUM ('SUCCESS', 'FAILURE', 'DENIED');

-- CreateEnum
CREATE TYPE "public"."SupportCategory" AS ENUM ('ACCOUNT_ACCESS', 'CONTRIBUTIONS_PAYMENTS', 'PAYOUT_ROTATION', 'LOANS_REPAYMENTS', 'SUBSCRIPTION_BILLING', 'TECHNICAL', 'FEATURE_REQUEST', 'SECURITY', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."SupportStatus" AS ENUM ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_FOR_USER', 'ESCALATED', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "public"."SupportPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- AlterEnum
ALTER TYPE "public"."GroupStatus" ADD VALUE 'SUSPENDED';

-- AlterEnum: replies to a member's support case.
ALTER TYPE "public"."NotificationType" ADD VALUE 'SUPPORT';

-- AlterTable
ALTER TABLE "public"."support_access_grants" ADD COLUMN     "requestedByAccountId" TEXT,
ALTER COLUMN "requestedByUserId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "public"."platform_accounts" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "passwordHash" TEXT,
    "status" "public"."PlatformAccountStatus" NOT NULL DEFAULT 'INVITED',
    "team" TEXT,
    "mfaSecret" TEXT,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "passwordChangedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."platform_roles" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "system" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."platform_role_permissions" (
    "roleId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,

    CONSTRAINT "platform_role_permissions_pkey" PRIMARY KEY ("roleId","permission")
);

-- CreateTable
CREATE TABLE "public"."platform_account_roles" (
    "accountId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "grantedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_account_roles_pkey" PRIMARY KEY ("accountId","roleId")
);

-- CreateTable
CREATE TABLE "public"."platform_account_permissions" (
    "accountId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "grantedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_account_permissions_pkey" PRIMARY KEY ("accountId","permission")
);

-- CreateTable
CREATE TABLE "public"."platform_invitations" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."platform_password_resets" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_password_resets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."platform_sessions" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,

    CONSTRAINT "platform_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."platform_audit_log" (
    "id" TEXT NOT NULL,
    "actorAccountId" TEXT,
    "actorLabel" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "outcome" "public"."PlatformAuditOutcome" NOT NULL DEFAULT 'SUCCESS',
    "reason" TEXT,
    "requestId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."support_cases" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "requesterUserId" TEXT NOT NULL,
    "groupId" TEXT,
    "subject" TEXT NOT NULL,
    "category" "public"."SupportCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "priority" "public"."SupportPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "public"."SupportStatus" NOT NULL DEFAULT 'OPEN',
    "assignedToId" TEXT,
    "resolution" TEXT,
    "escalationReason" TEXT,
    "escalatedAt" TIMESTAMP(3),
    "firstResponseAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."support_messages" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "authorUserId" TEXT,
    "authorAccountId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."support_internal_notes" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "authorAccountId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_internal_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."support_assignments" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "assignedToId" TEXT,
    "assignedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_accounts_email_key" ON "public"."platform_accounts"("email");

-- CreateIndex
CREATE INDEX "platform_accounts_status_idx" ON "public"."platform_accounts"("status");

-- CreateIndex
CREATE UNIQUE INDEX "platform_roles_code_key" ON "public"."platform_roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "platform_invitations_tokenHash_key" ON "public"."platform_invitations"("tokenHash");

-- CreateIndex
CREATE INDEX "platform_invitations_accountId_idx" ON "public"."platform_invitations"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "platform_password_resets_tokenHash_key" ON "public"."platform_password_resets"("tokenHash");

-- CreateIndex
CREATE INDEX "platform_password_resets_accountId_idx" ON "public"."platform_password_resets"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "platform_sessions_refreshTokenHash_key" ON "public"."platform_sessions"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "platform_sessions_accountId_revokedAt_idx" ON "public"."platform_sessions"("accountId", "revokedAt");

-- CreateIndex
CREATE INDEX "platform_audit_log_createdAt_idx" ON "public"."platform_audit_log"("createdAt");

-- CreateIndex
CREATE INDEX "platform_audit_log_actorAccountId_createdAt_idx" ON "public"."platform_audit_log"("actorAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "platform_audit_log_action_createdAt_idx" ON "public"."platform_audit_log"("action", "createdAt");

-- CreateIndex
CREATE INDEX "platform_audit_log_targetType_targetId_idx" ON "public"."platform_audit_log"("targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "support_cases_number_key" ON "public"."support_cases"("number");

-- CreateIndex
CREATE INDEX "support_cases_status_priority_idx" ON "public"."support_cases"("status", "priority");

-- CreateIndex
CREATE INDEX "support_cases_assignedToId_status_idx" ON "public"."support_cases"("assignedToId", "status");

-- CreateIndex
CREATE INDEX "support_cases_requesterUserId_createdAt_idx" ON "public"."support_cases"("requesterUserId", "createdAt");

-- CreateIndex
CREATE INDEX "support_messages_caseId_createdAt_idx" ON "public"."support_messages"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "support_internal_notes_caseId_createdAt_idx" ON "public"."support_internal_notes"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "support_assignments_caseId_createdAt_idx" ON "public"."support_assignments"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "support_access_grants_requestedByAccountId_groupId_idx" ON "public"."support_access_grants"("requestedByAccountId", "groupId");

-- AddForeignKey
ALTER TABLE "public"."platform_role_permissions" ADD CONSTRAINT "platform_role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "public"."platform_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."platform_account_roles" ADD CONSTRAINT "platform_account_roles_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "public"."platform_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."platform_account_roles" ADD CONSTRAINT "platform_account_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "public"."platform_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."platform_account_permissions" ADD CONSTRAINT "platform_account_permissions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "public"."platform_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."platform_invitations" ADD CONSTRAINT "platform_invitations_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "public"."platform_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."platform_password_resets" ADD CONSTRAINT "platform_password_resets_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "public"."platform_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."platform_sessions" ADD CONSTRAINT "platform_sessions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "public"."platform_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."support_cases" ADD CONSTRAINT "support_cases_requesterUserId_fkey" FOREIGN KEY ("requesterUserId") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."support_cases" ADD CONSTRAINT "support_cases_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."support_cases" ADD CONSTRAINT "support_cases_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "public"."platform_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."support_messages" ADD CONSTRAINT "support_messages_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "public"."support_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."support_internal_notes" ADD CONSTRAINT "support_internal_notes_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "public"."support_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."support_assignments" ADD CONSTRAINT "support_assignments_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "public"."support_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ───── support case numbers (CH-000001) ─────
CREATE SEQUENCE IF NOT EXISTS "support_case_seq" START 1;

-- ───── move the old free-text tickets into support cases ─────
INSERT INTO "support_cases" ("id", "number", "requesterUserId", "groupId", "subject", "category", "description", "status", "createdAt", "updatedAt", "resolvedAt")
SELECT t."id",
       'CH-' || lpad(nextval('support_case_seq')::text, 6, '0'),
       t."userId",
       t."groupId",
       t."subject",
       'OTHER'::"SupportCategory",
       t."body",
       CASE t."status" WHEN 'RESOLVED' THEN 'RESOLVED'::"SupportStatus" WHEN 'IN_PROGRESS' THEN 'IN_PROGRESS'::"SupportStatus" ELSE 'OPEN'::"SupportStatus" END,
       t."createdAt",
       t."createdAt",
       CASE WHEN t."status" = 'RESOLVED' THEN t."createdAt" END
FROM "support_tickets" t
WHERE t."userId" IS NOT NULL AND EXISTS (SELECT 1 FROM "users" u WHERE u."id" = t."userId")
ORDER BY t."createdAt";

INSERT INTO "support_messages" ("id", "caseId", "authorUserId", "body", "createdAt")
SELECT c."id" || '-m0', c."id", c."requesterUserId", c."description", c."createdAt" FROM "support_cases" c;

-- Staff used to be member accounts with a platformRole; that is gone. Platform staff must be
-- re-created as platform accounts (see docs/PLATFORM_ADMIN.md, "Bootstrap the owner").
UPDATE "support_access_grants" SET "status" = 'REVOKED', "expiresAt" = LEAST(COALESCE("expiresAt", now()), now())
WHERE "status" IN ('PENDING', 'APPROVED');

ALTER TABLE "users" DROP COLUMN "platformRole";
DROP TABLE "support_tickets";
DROP TYPE "PlatformRole";

-- ───── integrity ─────
ALTER TABLE "platform_accounts" ADD CONSTRAINT "platform_accounts_email_lower" CHECK ("email" = lower("email"));
ALTER TABLE "platform_accounts" ADD CONSTRAINT "platform_accounts_active_has_password" CHECK ("status" <> 'ACTIVE' OR "passwordHash" IS NOT NULL);
ALTER TABLE "platform_accounts" ADD CONSTRAINT "platform_accounts_failed_non_negative" CHECK ("failedLoginCount" >= 0);
ALTER TABLE "platform_roles" ADD CONSTRAINT "platform_roles_code_format" CHECK ("code" ~ '^[A-Z][A-Z0-9_]{1,39}$');
ALTER TABLE "platform_role_permissions" ADD CONSTRAINT "platform_role_permissions_format" CHECK ("permission" LIKE 'platform.%');
ALTER TABLE "platform_account_permissions" ADD CONSTRAINT "platform_account_permissions_format" CHECK ("permission" LIKE 'platform.%');
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_number_format" CHECK ("number" ~ '^CH-[0-9]{6,}$');
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_resolved_has_summary" CHECK ("status" NOT IN ('RESOLVED', 'CLOSED') OR "resolvedAt" IS NOT NULL OR "closedAt" IS NOT NULL);
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_one_author" CHECK (("authorUserId" IS NULL) <> ("authorAccountId" IS NULL));
ALTER TABLE "support_access_grants" ADD CONSTRAINT "support_access_grants_requester" CHECK ("requestedByUserId" IS NOT NULL OR "requestedByAccountId" IS NOT NULL);
ALTER TABLE "support_access_grants" ADD CONSTRAINT "support_access_grants_requestedByAccountId_fkey" FOREIGN KEY ("requestedByAccountId") REFERENCES "platform_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───── append-only: the audit trail, the conversation and the assignment history ─────
CREATE TRIGGER platform_audit_log_append_only BEFORE UPDATE OR DELETE ON "platform_audit_log" FOR EACH ROW EXECUTE FUNCTION chamahub_forbid_mutation();
CREATE TRIGGER platform_audit_log_no_truncate BEFORE TRUNCATE ON "platform_audit_log" FOR EACH STATEMENT EXECUTE FUNCTION chamahub_forbid_mutation();
CREATE TRIGGER support_messages_append_only BEFORE UPDATE OR DELETE ON "support_messages" FOR EACH ROW EXECUTE FUNCTION chamahub_forbid_mutation();
CREATE TRIGGER support_internal_notes_append_only BEFORE UPDATE OR DELETE ON "support_internal_notes" FOR EACH ROW EXECUTE FUNCTION chamahub_forbid_mutation();
CREATE TRIGGER support_assignments_append_only BEFORE UPDATE OR DELETE ON "support_assignments" FOR EACH ROW EXECUTE FUNCTION chamahub_forbid_mutation();

-- New tables are closed to hosted Data APIs too (see 20261026000000_lock_down_data_api).
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = current_schema() LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', current_schema(), t.tablename);
  END LOOP;
END
$$;
