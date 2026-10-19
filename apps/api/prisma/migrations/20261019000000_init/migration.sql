-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."PlatformRole" AS ENUM ('USER', 'SUPPORT', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "public"."GroupType" AS ENUM ('MERRY_GO_ROUND', 'TABLE_BANKING', 'INVESTMENT', 'WELFARE', 'SAVINGS', 'HYBRID');

-- CreateEnum
CREATE TYPE "public"."GroupStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "public"."GroupRole" AS ENUM ('CHAIRPERSON', 'VICE_CHAIRPERSON', 'TREASURER', 'SECRETARY', 'AUDITOR', 'MEMBER');

-- CreateEnum
CREATE TYPE "public"."MembershipStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'EXITED');

-- CreateEnum
CREATE TYPE "public"."InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "public"."OtpPurpose" AS ENUM ('VERIFY_PHONE', 'RESET_PASSWORD', 'LOGIN');

-- CreateEnum
CREATE TYPE "public"."Frequency" AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY', 'QUARTERLY');

-- CreateEnum
CREATE TYPE "public"."ObligationStatus" AS ENUM ('UPCOMING', 'DUE', 'PARTIAL', 'PAID', 'OVERDUE', 'WAIVED');

-- CreateEnum
CREATE TYPE "public"."TransactionStatus" AS ENUM ('SCHEDULED', 'PENDING', 'CONFIRMED', 'FAILED', 'REVERSED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "public"."PaymentMethod" AS ENUM ('CASH', 'MPESA', 'BANK_TRANSFER', 'CHEQUE', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."PaymentPurpose" AS ENUM ('CONTRIBUTION', 'LOAN_REPAYMENT', 'FINE', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."PaymentSource" AS ENUM ('MANUAL', 'MPESA_STK', 'MPESA_C2B', 'IMPORT');

-- CreateEnum
CREATE TYPE "public"."InterestMethod" AS ENUM ('FLAT', 'ONE_OFF', 'REDUCING_BALANCE', 'AMORTIZED');

-- CreateEnum
CREATE TYPE "public"."LoanStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'DISBURSED', 'REPAID', 'DEFAULTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."InstallmentStatus" AS ENUM ('UPCOMING', 'PARTIAL', 'PAID', 'OVERDUE');

-- CreateEnum
CREATE TYPE "public"."ApprovalEntity" AS ENUM ('LOAN', 'EXPENSE', 'PAYOUT', 'DISTRIBUTION', 'IMPORT', 'CYCLE_CHANGE', 'SUPPORT_ACCESS');

-- CreateEnum
CREATE TYPE "public"."ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."FineStatus" AS ENUM ('OUTSTANDING', 'PARTIAL', 'PAID', 'WAIVED');

-- CreateEnum
CREATE TYPE "public"."ExpenseStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PAID', 'REVERSED');

-- CreateEnum
CREATE TYPE "public"."CycleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."PayoutStatus" AS ENUM ('SCHEDULED', 'COLLECTING', 'READY', 'APPROVED', 'COMPLETED', 'DEFERRED');

-- CreateEnum
CREATE TYPE "public"."DistributionMethod" AS ENUM ('EQUAL', 'CONTRIBUTION_PROPORTIONAL', 'SHARE_BASED');

-- CreateEnum
CREATE TYPE "public"."DistributionStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."MeetingStatus" AS ENUM ('SCHEDULED', 'HELD', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."AttendanceStatus" AS ENUM ('CONFIRMED', 'DECLINED', 'PRESENT', 'ABSENT', 'APOLOGY');

-- CreateEnum
CREATE TYPE "public"."MinutesStatus" AS ENUM ('DRAFT', 'APPROVED');

-- CreateEnum
CREATE TYPE "public"."LedgerAccount" AS ENUM ('CASH', 'MEMBER_CONTRIBUTIONS', 'LOANS_RECEIVABLE', 'INTEREST_INCOME', 'FINE_INCOME', 'EXPENSES', 'PAYOUTS', 'DISTRIBUTIONS', 'OPENING_BALANCE', 'OTHER_INCOME');

-- CreateEnum
CREATE TYPE "public"."LedgerEntryType" AS ENUM ('CONTRIBUTION', 'LOAN_DISBURSEMENT', 'LOAN_REPAYMENT_PRINCIPAL', 'LOAN_REPAYMENT_INTEREST', 'FINE_PAYMENT', 'EXPENSE', 'PAYOUT', 'DISTRIBUTION', 'OPENING_BALANCE', 'ADJUSTMENT', 'REVERSAL', 'OTHER_INCOME');

-- CreateEnum
CREATE TYPE "public"."NotificationType" AS ENUM ('CONTRIBUTION_DUE', 'CONTRIBUTION_OVERDUE', 'PAYMENT_CONFIRMED', 'LOAN_APPROVED', 'LOAN_REJECTED', 'REPAYMENT_DUE', 'PAYOUT_UPCOMING', 'PAYOUT_COMPLETED', 'MEETING_SCHEDULED', 'MEETING_REMINDER', 'STATEMENT_PUBLISHED', 'ANNOUNCEMENT', 'INVITATION', 'APPROVAL_REQUIRED');

-- CreateEnum
CREATE TYPE "public"."NotificationChannel" AS ENUM ('IN_APP', 'SMS', 'EMAIL', 'WHATSAPP', 'PUSH');

-- CreateEnum
CREATE TYPE "public"."DeliveryStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "public"."ImportKind" AS ENUM ('MEMBERS', 'CONTRIBUTIONS', 'LOANS', 'REPAYMENTS', 'FINES', 'PAYOUTS', 'OPENING_BALANCE');

-- CreateEnum
CREATE TYPE "public"."ImportStatus" AS ENUM ('VALIDATED', 'HAS_ERRORS', 'COMMITTED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "public"."DisputeStatus" AS ENUM ('OPEN', 'RESOLVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "public"."SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."ReconciliationStatus" AS ENUM ('UNMATCHED', 'MATCHED', 'DUPLICATE', 'IGNORED');

-- CreateEnum
CREATE TYPE "public"."MpesaRequestStatus" AS ENUM ('INITIATED', 'SUCCESS', 'FAILED', 'TIMEOUT');

-- CreateEnum
CREATE TYPE "public"."SupportGrantStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'REVOKED');

-- CreateEnum
CREATE TYPE "public"."JobStatus" AS ENUM ('SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "public"."users" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT NOT NULL,
    "phoneVerifiedAt" TIMESTAMP(3),
    "platformRole" "public"."PlatformRole" NOT NULL DEFAULT 'USER',
    "preferences" JSONB NOT NULL DEFAULT '{}',
    "nationalIdLast4" TEXT,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "deletionRequestedAt" TIMESTAMP(3),
    "deletionReason" TEXT,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."otp_codes" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "purpose" "public"."OtpPurpose" NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "previousTokenHash" TEXT,
    "deviceName" TEXT,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."groups" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "public"."GroupType" NOT NULL,
    "status" "public"."GroupStatus" NOT NULL DEFAULT 'ACTIVE',
    "description" TEXT,
    "county" TEXT,
    "registrationNumber" TEXT,
    "financialYearStartMonth" INTEGER NOT NULL DEFAULT 1,
    "inviteCode" TEXT,
    "settings" JSONB NOT NULL,
    "loanPolicy" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."memberships" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "public"."GroupRole" NOT NULL DEFAULT 'MEMBER',
    "status" "public"."MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "shares" INTEGER NOT NULL DEFAULT 0,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exitedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."invitations" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "fullName" TEXT,
    "role" "public"."GroupRole" NOT NULL DEFAULT 'MEMBER',
    "status" "public"."InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "invitedById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."support_access_grants" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "hours" INTEGER NOT NULL,
    "status" "public"."SupportGrantStatus" NOT NULL DEFAULT 'PENDING',
    "decidedByMembershipId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_access_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."contribution_schedules" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "frequency" "public"."Frequency" NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "allMembers" BOOLEAN NOT NULL DEFAULT true,
    "cycleId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contribution_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."schedule_members" (
    "scheduleId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,

    CONSTRAINT "schedule_members_pkey" PRIMARY KEY ("scheduleId","membershipId")
);

-- CreateTable
CREATE TABLE "public"."contribution_obligations" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "periodLabel" TEXT NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "paidCents" BIGINT NOT NULL DEFAULT 0,
    "status" "public"."ObligationStatus" NOT NULL DEFAULT 'UPCOMING',
    "roundId" TEXT,
    "waivedReason" TEXT,
    "waivedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contribution_obligations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."payments" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "membershipId" TEXT,
    "amountCents" BIGINT NOT NULL,
    "method" "public"."PaymentMethod" NOT NULL,
    "source" "public"."PaymentSource" NOT NULL DEFAULT 'MANUAL',
    "purpose" "public"."PaymentPurpose" NOT NULL,
    "status" "public"."TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "reference" TEXT,
    "paidAt" DATE NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "targetId" TEXT,
    "notes" TEXT,
    "recordedById" TEXT,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "reversedById" TEXT,
    "reversedAt" TIMESTAMP(3),
    "reversalReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."payment_allocations" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "obligationId" TEXT,
    "installmentId" TEXT,
    "fineId" TEXT,
    "principalCents" BIGINT NOT NULL DEFAULT 0,
    "interestCents" BIGINT NOT NULL DEFAULT 0,
    "amountCents" BIGINT NOT NULL,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."mpesa_requests" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "merchantRequestId" TEXT,
    "checkoutRequestId" TEXT,
    "phone" TEXT NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "status" "public"."MpesaRequestStatus" NOT NULL DEFAULT 'INITIATED',
    "resultCode" INTEGER,
    "resultDesc" TEXT,
    "receiptNumber" TEXT,
    "rawCallback" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mpesa_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."unmatched_payments" (
    "id" TEXT NOT NULL,
    "groupId" TEXT,
    "source" TEXT NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "reference" TEXT NOT NULL,
    "payerPhone" TEXT,
    "payerName" TEXT,
    "accountReference" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "status" "public"."ReconciliationStatus" NOT NULL DEFAULT 'UNMATCHED',
    "matchedPaymentId" TEXT,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unmatched_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."journal_entries" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "entryDate" DATE NOT NULL,
    "type" "public"."LedgerEntryType" NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "membershipId" TEXT,
    "paymentId" TEXT,
    "loanId" TEXT,
    "expenseId" TEXT,
    "fineId" TEXT,
    "roundId" TEXT,
    "allocationId" TEXT,
    "reversesId" TEXT,
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."journal_lines" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "account" "public"."LedgerAccount" NOT NULL,
    "amountCents" BIGINT NOT NULL,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."published_statements" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "periodFrom" DATE NOT NULL,
    "periodTo" DATE NOT NULL,
    "snapshot" JSONB NOT NULL,
    "publishedById" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "published_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."loans" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "principalCents" BIGINT NOT NULL,
    "rateBps" INTEGER NOT NULL,
    "interestMethod" "public"."InterestMethod" NOT NULL,
    "installmentsCount" INTEGER NOT NULL,
    "frequency" "public"."Frequency" NOT NULL,
    "totalInterestCents" BIGINT NOT NULL,
    "purpose" TEXT NOT NULL,
    "status" "public"."LoanStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "requiredApprovals" INTEGER NOT NULL,
    "allowSelfApproval" BOOLEAN NOT NULL DEFAULT false,
    "policySnapshot" JSONB NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "disbursedAt" DATE,
    "disbursementMethod" "public"."PaymentMethod",
    "disbursementReference" TEXT,
    "disbursementKey" TEXT,
    "disbursedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."loan_installments" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "dueDate" DATE NOT NULL,
    "principalCents" BIGINT NOT NULL,
    "interestCents" BIGINT NOT NULL,
    "principalPaidCents" BIGINT NOT NULL DEFAULT 0,
    "interestPaidCents" BIGINT NOT NULL DEFAULT 0,
    "status" "public"."InstallmentStatus" NOT NULL DEFAULT 'UPCOMING',

    CONSTRAINT "loan_installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."loan_guarantors" (
    "loanId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,

    CONSTRAINT "loan_guarantors_pkey" PRIMARY KEY ("loanId","membershipId")
);

-- CreateTable
CREATE TABLE "public"."approvals" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "entityType" "public"."ApprovalEntity" NOT NULL,
    "entityId" TEXT NOT NULL,
    "approverMembershipId" TEXT NOT NULL,
    "decision" "public"."ApprovalStatus" NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."fines" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "paidCents" BIGINT NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL,
    "issuedOn" DATE NOT NULL,
    "status" "public"."FineStatus" NOT NULL DEFAULT 'OUTSTANDING',
    "obligationId" TEXT,
    "issuedById" TEXT NOT NULL,
    "waivedById" TEXT,
    "waivedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."expenses" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "incurredOn" DATE NOT NULL,
    "payee" TEXT,
    "status" "public"."ExpenseStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "requiredApprovals" INTEGER NOT NULL,
    "recordedById" TEXT NOT NULL,
    "paidAt" DATE,
    "paymentMethod" "public"."PaymentMethod",
    "paymentReference" TEXT,
    "paymentKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."payout_cycles" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "public"."CycleStatus" NOT NULL DEFAULT 'ACTIVE',
    "contributionCents" BIGINT NOT NULL,
    "frequency" "public"."Frequency" NOT NULL,
    "startDate" DATE NOT NULL,
    "recipientContributes" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payout_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."payout_rounds" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "membershipId" TEXT NOT NULL,
    "payoutDate" DATE NOT NULL,
    "expectedCents" BIGINT NOT NULL,
    "status" "public"."PayoutStatus" NOT NULL DEFAULT 'SCHEDULED',
    "requiredApprovals" INTEGER NOT NULL,
    "shortfallReason" TEXT,
    "payoutMethod" "public"."PaymentMethod",
    "payoutReference" TEXT,
    "payoutKey" TEXT,
    "payoutAmountCents" BIGINT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payout_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."cycle_changes" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "beforeOrder" JSONB NOT NULL,
    "afterOrder" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "proposedByMembershipId" TEXT NOT NULL,
    "status" "public"."ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "cycle_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."distributions" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "method" "public"."DistributionMethod" NOT NULL,
    "periodFrom" DATE NOT NULL,
    "periodTo" DATE NOT NULL,
    "status" "public"."DistributionStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "calculation" JSONB NOT NULL,
    "inputs" JSONB NOT NULL,
    "requiredApprovals" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "distributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."distribution_allocations" (
    "id" TEXT NOT NULL,
    "distributionId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "grossCents" BIGINT NOT NULL,
    "loanOffsetCents" BIGINT NOT NULL DEFAULT 0,
    "netCents" BIGINT NOT NULL,
    "paidAt" DATE,
    "paymentMethod" "public"."PaymentMethod",
    "paymentReference" TEXT,
    "paymentKey" TEXT,

    CONSTRAINT "distribution_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."investment_holdings" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "costCents" BIGINT NOT NULL,
    "currentValueCents" BIGINT NOT NULL,
    "acquiredOn" DATE NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investment_holdings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."meetings" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "virtualLink" TEXT,
    "status" "public"."MeetingStatus" NOT NULL DEFAULT 'SCHEDULED',
    "agenda" JSONB NOT NULL DEFAULT '[]',
    "requiresRsvp" BOOLEAN NOT NULL DEFAULT true,
    "reminderSentAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."attendance" (
    "meetingId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "status" "public"."AttendanceStatus" NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_pkey" PRIMARY KEY ("meetingId","membershipId")
);

-- CreateTable
CREATE TABLE "public"."minutes" (
    "meetingId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "public"."MinutesStatus" NOT NULL DEFAULT 'DRAFT',
    "recordedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "minutes_pkey" PRIMARY KEY ("meetingId")
);

-- CreateTable
CREATE TABLE "public"."resolutions" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "details" TEXT,
    "isFinancial" BOOLEAN NOT NULL DEFAULT false,
    "amountCents" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resolutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."action_items" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "assigneeMembershipId" TEXT,
    "dueDate" DATE,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "action_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."announcements" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "groupId" TEXT,
    "type" "public"."NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "dedupeKey" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."notification_deliveries" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "channel" "public"."NotificationChannel" NOT NULL,
    "status" "public"."DeliveryStatus" NOT NULL DEFAULT 'QUEUED',
    "provider" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."plans" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceCents" BIGINT NOT NULL,
    "maxMembers" INTEGER NOT NULL,
    "features" JSONB NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."subscriptions" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "public"."SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "trialEndsAt" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."audit_events" (
    "id" TEXT NOT NULL,
    "groupId" TEXT,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "reference" TEXT,
    "approvalStatus" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."import_batches" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "kind" "public"."ImportKind" NOT NULL,
    "fileName" TEXT NOT NULL,
    "status" "public"."ImportStatus" NOT NULL,
    "rows" JSONB NOT NULL,
    "summary" JSONB NOT NULL DEFAULT '{}',
    "rowCount" INTEGER NOT NULL,
    "errorCount" INTEGER NOT NULL,
    "warningCount" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "committedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."disputes" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "paymentId" TEXT,
    "subject" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "status" "public"."DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."support_tickets" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "groupId" TEXT,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."job_runs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "public"."JobStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "details" JSONB,
    "error" TEXT,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "public"."users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "public"."users"("email");

-- CreateIndex
CREATE INDEX "otp_codes_phone_purpose_createdAt_idx" ON "public"."otp_codes"("phone", "purpose", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refreshTokenHash_key" ON "public"."sessions"("refreshTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_previousTokenHash_key" ON "public"."sessions"("previousTokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "public"."sessions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "groups_inviteCode_key" ON "public"."groups"("inviteCode");

-- CreateIndex
CREATE INDEX "memberships_userId_idx" ON "public"."memberships"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_groupId_userId_key" ON "public"."memberships"("groupId", "userId");

-- CreateIndex
CREATE INDEX "invitations_phone_status_idx" ON "public"."invitations"("phone", "status");

-- CreateIndex
CREATE INDEX "invitations_groupId_status_idx" ON "public"."invitations"("groupId", "status");

-- CreateIndex
CREATE INDEX "support_access_grants_requestedByUserId_groupId_idx" ON "public"."support_access_grants"("requestedByUserId", "groupId");

-- CreateIndex
CREATE UNIQUE INDEX "contribution_schedules_cycleId_key" ON "public"."contribution_schedules"("cycleId");

-- CreateIndex
CREATE INDEX "contribution_schedules_groupId_idx" ON "public"."contribution_schedules"("groupId");

-- CreateIndex
CREATE INDEX "contribution_obligations_groupId_dueDate_idx" ON "public"."contribution_obligations"("groupId", "dueDate");

-- CreateIndex
CREATE INDEX "contribution_obligations_membershipId_status_idx" ON "public"."contribution_obligations"("membershipId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "contribution_obligations_scheduleId_membershipId_dueDate_key" ON "public"."contribution_obligations"("scheduleId", "membershipId", "dueDate");

-- CreateIndex
CREATE INDEX "payments_groupId_status_idx" ON "public"."payments"("groupId", "status");

-- CreateIndex
CREATE INDEX "payments_groupId_reference_idx" ON "public"."payments"("groupId", "reference");

-- CreateIndex
CREATE INDEX "payments_membershipId_idx" ON "public"."payments"("membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_groupId_idempotencyKey_key" ON "public"."payments"("groupId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "payment_allocations_paymentId_idx" ON "public"."payment_allocations"("paymentId");

-- CreateIndex
CREATE INDEX "payment_allocations_obligationId_idx" ON "public"."payment_allocations"("obligationId");

-- CreateIndex
CREATE INDEX "payment_allocations_installmentId_idx" ON "public"."payment_allocations"("installmentId");

-- CreateIndex
CREATE UNIQUE INDEX "mpesa_requests_paymentId_key" ON "public"."mpesa_requests"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "mpesa_requests_checkoutRequestId_key" ON "public"."mpesa_requests"("checkoutRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "mpesa_requests_receiptNumber_key" ON "public"."mpesa_requests"("receiptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "unmatched_payments_reference_key" ON "public"."unmatched_payments"("reference");

-- CreateIndex
CREATE INDEX "unmatched_payments_groupId_status_idx" ON "public"."unmatched_payments"("groupId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_reversesId_key" ON "public"."journal_entries"("reversesId");

-- CreateIndex
CREATE INDEX "journal_entries_groupId_entryDate_idx" ON "public"."journal_entries"("groupId", "entryDate");

-- CreateIndex
CREATE INDEX "journal_entries_paymentId_idx" ON "public"."journal_entries"("paymentId");

-- CreateIndex
CREATE INDEX "journal_lines_entryId_idx" ON "public"."journal_lines"("entryId");

-- CreateIndex
CREATE INDEX "published_statements_groupId_publishedAt_idx" ON "public"."published_statements"("groupId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "loans_disbursementKey_key" ON "public"."loans"("disbursementKey");

-- CreateIndex
CREATE INDEX "loans_groupId_status_idx" ON "public"."loans"("groupId", "status");

-- CreateIndex
CREATE INDEX "loans_membershipId_idx" ON "public"."loans"("membershipId");

-- CreateIndex
CREATE INDEX "loan_installments_dueDate_idx" ON "public"."loan_installments"("dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "loan_installments_loanId_number_key" ON "public"."loan_installments"("loanId", "number");

-- CreateIndex
CREATE INDEX "approvals_groupId_entityType_entityId_idx" ON "public"."approvals"("groupId", "entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "approvals_entityType_entityId_approverMembershipId_key" ON "public"."approvals"("entityType", "entityId", "approverMembershipId");

-- CreateIndex
CREATE UNIQUE INDEX "fines_obligationId_key" ON "public"."fines"("obligationId");

-- CreateIndex
CREATE INDEX "fines_groupId_status_idx" ON "public"."fines"("groupId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_paymentKey_key" ON "public"."expenses"("paymentKey");

-- CreateIndex
CREATE INDEX "expenses_groupId_status_idx" ON "public"."expenses"("groupId", "status");

-- CreateIndex
CREATE INDEX "payout_cycles_groupId_idx" ON "public"."payout_cycles"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "payout_rounds_payoutKey_key" ON "public"."payout_rounds"("payoutKey");

-- CreateIndex
CREATE UNIQUE INDEX "payout_rounds_cycleId_round_key" ON "public"."payout_rounds"("cycleId", "round");

-- CreateIndex
CREATE INDEX "distributions_groupId_idx" ON "public"."distributions"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "distribution_allocations_paymentKey_key" ON "public"."distribution_allocations"("paymentKey");

-- CreateIndex
CREATE UNIQUE INDEX "distribution_allocations_distributionId_membershipId_key" ON "public"."distribution_allocations"("distributionId", "membershipId");

-- CreateIndex
CREATE INDEX "meetings_groupId_scheduledAt_idx" ON "public"."meetings"("groupId", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_dedupeKey_key" ON "public"."notifications"("dedupeKey");

-- CreateIndex
CREATE INDEX "notifications_userId_createdAt_idx" ON "public"."notifications"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "notification_deliveries_status_idx" ON "public"."notification_deliveries"("status");

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "public"."plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_groupId_key" ON "public"."subscriptions"("groupId");

-- CreateIndex
CREATE INDEX "audit_events_groupId_createdAt_idx" ON "public"."audit_events"("groupId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_events_entityType_entityId_idx" ON "public"."audit_events"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_events_action_createdAt_idx" ON "public"."audit_events"("action", "createdAt");

-- CreateIndex
CREATE INDEX "import_batches_groupId_idx" ON "public"."import_batches"("groupId");

-- CreateIndex
CREATE INDEX "disputes_groupId_status_idx" ON "public"."disputes"("groupId", "status");

-- CreateIndex
CREATE INDEX "job_runs_name_startedAt_idx" ON "public"."job_runs"("name", "startedAt");

-- AddForeignKey
ALTER TABLE "public"."sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."groups" ADD CONSTRAINT "groups_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."memberships" ADD CONSTRAINT "memberships_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."memberships" ADD CONSTRAINT "memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."invitations" ADD CONSTRAINT "invitations_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."invitations" ADD CONSTRAINT "invitations_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."support_access_grants" ADD CONSTRAINT "support_access_grants_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."contribution_schedules" ADD CONSTRAINT "contribution_schedules_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."contribution_schedules" ADD CONSTRAINT "contribution_schedules_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "public"."payout_cycles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."schedule_members" ADD CONSTRAINT "schedule_members_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "public"."contribution_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."schedule_members" ADD CONSTRAINT "schedule_members_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "public"."memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."contribution_obligations" ADD CONSTRAINT "contribution_obligations_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."contribution_obligations" ADD CONSTRAINT "contribution_obligations_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "public"."contribution_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."contribution_obligations" ADD CONSTRAINT "contribution_obligations_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "public"."memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."contribution_obligations" ADD CONSTRAINT "contribution_obligations_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "public"."payout_rounds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."payments" ADD CONSTRAINT "payments_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."payments" ADD CONSTRAINT "payments_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "public"."memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."payment_allocations" ADD CONSTRAINT "payment_allocations_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "public"."payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."payment_allocations" ADD CONSTRAINT "payment_allocations_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "public"."contribution_obligations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."payment_allocations" ADD CONSTRAINT "payment_allocations_installmentId_fkey" FOREIGN KEY ("installmentId") REFERENCES "public"."loan_installments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."payment_allocations" ADD CONSTRAINT "payment_allocations_fineId_fkey" FOREIGN KEY ("fineId") REFERENCES "public"."fines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."mpesa_requests" ADD CONSTRAINT "mpesa_requests_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "public"."payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."unmatched_payments" ADD CONSTRAINT "unmatched_payments_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."journal_entries" ADD CONSTRAINT "journal_entries_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."journal_entries" ADD CONSTRAINT "journal_entries_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "public"."memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."journal_entries" ADD CONSTRAINT "journal_entries_reversesId_fkey" FOREIGN KEY ("reversesId") REFERENCES "public"."journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."journal_lines" ADD CONSTRAINT "journal_lines_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "public"."journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."published_statements" ADD CONSTRAINT "published_statements_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."loans" ADD CONSTRAINT "loans_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."loans" ADD CONSTRAINT "loans_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "public"."memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."loan_installments" ADD CONSTRAINT "loan_installments_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "public"."loans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."loan_guarantors" ADD CONSTRAINT "loan_guarantors_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "public"."loans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."loan_guarantors" ADD CONSTRAINT "loan_guarantors_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "public"."memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."approvals" ADD CONSTRAINT "approvals_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."approvals" ADD CONSTRAINT "approvals_approverMembershipId_fkey" FOREIGN KEY ("approverMembershipId") REFERENCES "public"."memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."fines" ADD CONSTRAINT "fines_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."fines" ADD CONSTRAINT "fines_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "public"."memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."fines" ADD CONSTRAINT "fines_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "public"."contribution_obligations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."expenses" ADD CONSTRAINT "expenses_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."payout_cycles" ADD CONSTRAINT "payout_cycles_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."payout_rounds" ADD CONSTRAINT "payout_rounds_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "public"."payout_cycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."payout_rounds" ADD CONSTRAINT "payout_rounds_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "public"."memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."cycle_changes" ADD CONSTRAINT "cycle_changes_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "public"."payout_cycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."distributions" ADD CONSTRAINT "distributions_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."distribution_allocations" ADD CONSTRAINT "distribution_allocations_distributionId_fkey" FOREIGN KEY ("distributionId") REFERENCES "public"."distributions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."distribution_allocations" ADD CONSTRAINT "distribution_allocations_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "public"."memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."investment_holdings" ADD CONSTRAINT "investment_holdings_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."meetings" ADD CONSTRAINT "meetings_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."attendance" ADD CONSTRAINT "attendance_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "public"."meetings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."attendance" ADD CONSTRAINT "attendance_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "public"."memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."minutes" ADD CONSTRAINT "minutes_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "public"."meetings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."resolutions" ADD CONSTRAINT "resolutions_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "public"."meetings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."action_items" ADD CONSTRAINT "action_items_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "public"."meetings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."action_items" ADD CONSTRAINT "action_items_assigneeMembershipId_fkey" FOREIGN KEY ("assigneeMembershipId") REFERENCES "public"."memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."announcements" ADD CONSTRAINT "announcements_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notification_deliveries" ADD CONSTRAINT "notification_deliveries_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "public"."notifications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."subscriptions" ADD CONSTRAINT "subscriptions_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."subscriptions" ADD CONSTRAINT "subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "public"."plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."audit_events" ADD CONSTRAINT "audit_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."import_batches" ADD CONSTRAINT "import_batches_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."disputes" ADD CONSTRAINT "disputes_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."disputes" ADD CONSTRAINT "disputes_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "public"."memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."disputes" ADD CONSTRAINT "disputes_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "public"."payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ───────────── ChamaHub financial integrity safeguards ─────────────

ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_positive" CHECK ("amountCents" > 0);
ALTER TABLE "payment_allocations" ADD CONSTRAINT "allocations_non_negative"
  CHECK ("amountCents" >= 0 AND "principalCents" >= 0 AND "interestCents" >= 0);
ALTER TABLE "contribution_schedules" ADD CONSTRAINT "schedules_amount_positive" CHECK ("amountCents" > 0);
ALTER TABLE "contribution_obligations" ADD CONSTRAINT "obligations_amounts_valid"
  CHECK ("amountCents" >= 0 AND "paidCents" >= 0 AND "paidCents" <= "amountCents");
ALTER TABLE "loans" ADD CONSTRAINT "loans_amounts_valid"
  CHECK ("principalCents" > 0 AND "rateBps" >= 0 AND "totalInterestCents" >= 0 AND "installmentsCount" > 0);
ALTER TABLE "loan_installments" ADD CONSTRAINT "installments_paid_within_due"
  CHECK ("principalPaidCents" >= 0 AND "interestPaidCents" >= 0
     AND "principalPaidCents" <= "principalCents" AND "interestPaidCents" <= "interestCents");
ALTER TABLE "fines" ADD CONSTRAINT "fines_amounts_valid"
  CHECK ("amountCents" > 0 AND "paidCents" >= 0 AND "paidCents" <= "amountCents");
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_amount_positive" CHECK ("amountCents" > 0);
ALTER TABLE "payout_cycles" ADD CONSTRAINT "cycles_amount_positive" CHECK ("contributionCents" > 0);
ALTER TABLE "distribution_allocations" ADD CONSTRAINT "dist_alloc_valid"
  CHECK ("grossCents" >= 0 AND "loanOffsetCents" >= 0 AND "netCents" = "grossCents" - "loanOffsetCents");
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_shares_non_negative" CHECK ("shares" >= 0);

-- Ledger and audit trail are append-only. Corrections are reversal entries.
CREATE OR REPLACE FUNCTION chamahub_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only; post a reversal or adjustment instead', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER journal_entries_append_only BEFORE UPDATE OR DELETE ON "journal_entries"
  FOR EACH ROW EXECUTE FUNCTION chamahub_forbid_mutation();
CREATE TRIGGER journal_lines_append_only BEFORE UPDATE OR DELETE ON "journal_lines"
  FOR EACH ROW EXECUTE FUNCTION chamahub_forbid_mutation();
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION chamahub_forbid_mutation();
CREATE TRIGGER journal_entries_no_truncate BEFORE TRUNCATE ON "journal_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION chamahub_forbid_mutation();
CREATE TRIGGER journal_lines_no_truncate BEFORE TRUNCATE ON "journal_lines"
  FOR EACH STATEMENT EXECUTE FUNCTION chamahub_forbid_mutation();
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON "audit_events"
  FOR EACH STATEMENT EXECUTE FUNCTION chamahub_forbid_mutation();

-- Every journal entry must balance (sum of lines = 0) when the transaction commits.
CREATE OR REPLACE FUNCTION chamahub_check_entry_balanced() RETURNS trigger AS $$
DECLARE
  total BIGINT;
  line_count INT;
BEGIN
  SELECT COALESCE(SUM("amountCents"), 0), COUNT(*) INTO total, line_count
    FROM "journal_lines" WHERE "entryId" = NEW."entryId";
  IF total <> 0 OR line_count < 2 THEN
    RAISE EXCEPTION 'Journal entry % is unbalanced (sum %, % lines)', NEW."entryId", total, line_count
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER journal_lines_balanced AFTER INSERT ON "journal_lines"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION chamahub_check_entry_balanced();
