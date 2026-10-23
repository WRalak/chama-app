-- Staff two-step sign-in hardening: replay protection (last accepted TOTP step) and single-use recovery codes.

-- AlterTable
ALTER TABLE "public"."platform_accounts" ADD COLUMN     "mfaLastStep" INTEGER;

-- CreateTable
CREATE TABLE "public"."platform_recovery_codes" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "platform_recovery_codes_accountId_usedAt_idx" ON "public"."platform_recovery_codes"("accountId", "usedAt");

-- CreateIndex
CREATE UNIQUE INDEX "platform_recovery_codes_accountId_codeHash_key" ON "public"."platform_recovery_codes"("accountId", "codeHash");

-- AddForeignKey
ALTER TABLE "public"."platform_recovery_codes" ADD CONSTRAINT "platform_recovery_codes_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "public"."platform_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "platform_accounts" ADD CONSTRAINT "platform_accounts_mfa_step_non_negative" CHECK ("mfaLastStep" IS NULL OR "mfaLastStep" >= 0);
ALTER TABLE "platform_recovery_codes" ENABLE ROW LEVEL SECURITY;
