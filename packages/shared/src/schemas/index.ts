import { z } from 'zod';
import {
  AttendanceStatus,
  DISTRIBUTION_METHODS,
  FREQUENCIES,
  GROUP_ROLES,
  GROUP_TYPES,
  IMPORT_KINDS,
  INTEREST_METHODS,
  PAYMENT_METHODS,
  TRANSACTION_STATUSES,
} from '../enums';
import { isIsoDate } from '../dates';
import { normalizeKenyanPhone } from '../phone';
import { MAX_LOAN_INSTALLMENTS } from '../finance/loans';

/* ---------- primitives ---------- */

export const phoneSchema = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const n = normalizeKenyanPhone(v);
    if (!n) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid Kenyan mobile number, e.g. 0712 345 678' });
      return z.NEVER;
    }
    return n;
  });

export const isoDateSchema = z.string().refine(isIsoDate, 'Use a valid date (YYYY-MM-DD)');

/** Positive whole number of cents. */
export const amountCentsSchema = z
  .number({ invalid_type_error: 'Amount is required' })
  .int('Amount must be whole cents')
  .positive('Amount must be greater than zero')
  .max(100_000_000_000_00, 'Amount is too large');

export const nonNegativeCentsSchema = z.number().int().min(0).max(100_000_000_000_00);

export const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Include at least one letter')
  .regex(/\d/, 'Include at least one number');

export const reasonSchema = z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(500);

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

export const dateRangeSchema = z
  .object({
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, { message: '"From" must be before "to"', path: ['to'] });

/* ---------- auth ---------- */

export const registerSchema = z.object({
  fullName: z.string().trim().min(3, 'Enter your full name').max(120),
  phone: phoneSchema,
  email: z.string().trim().email('Enter a valid email').optional().or(z.literal('').transform(() => undefined)),
  password: passwordSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  phone: phoneSchema,
  password: z.string().min(1, 'Enter your password'),
  deviceName: z.string().max(120).optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const otpPurposeSchema = z.enum(['VERIFY_PHONE', 'RESET_PASSWORD', 'LOGIN']);
export type OtpPurpose = z.infer<typeof otpPurposeSchema>;

export const requestOtpSchema = z.object({ phone: phoneSchema, purpose: otpPurposeSchema });
export const verifyOtpSchema = z.object({
  phone: phoneSchema,
  purpose: otpPurposeSchema,
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});
export const resetPasswordSchema = z.object({
  phone: phoneSchema,
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
  newPassword: passwordSchema,
});
export const refreshSchema = z.object({ refreshToken: z.string().min(20) });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema });

export const updateProfileSchema = z.object({
  fullName: z.string().trim().min(3).max(120).optional(),
  email: z.string().trim().email().nullable().optional(),
  nationalIdLast4: z.string().regex(/^\d{4}$/).nullable().optional(),
});

export const notificationPreferencesSchema = z.object({
  sms: z.boolean(),
  email: z.boolean(),
  whatsapp: z.boolean(),
  push: z.boolean(),
  contributionReminders: z.boolean(),
  loanReminders: z.boolean(),
  meetingReminders: z.boolean(),
  announcements: z.boolean(),
  /** Hide my phone number from ordinary members of my groups. */
  hidePhoneFromMembers: z.boolean(),
});
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;

export const accountDeletionSchema = z.object({ reason: z.string().trim().max(500).optional() });

/* ---------- groups ---------- */

export const loanPolicySchema = z.object({
  enabled: z.boolean(),
  interestMethod: z.enum(INTEREST_METHODS),
  rateBps: z.number().int().min(0).max(100000),
  maxInstallments: z.number().int().min(1).max(MAX_LOAN_INSTALLMENTS),
  repaymentFrequency: z.enum(FREQUENCIES),
  maxMultipleOfSavingsBps: z.number().int().min(0).max(1_000_000),
  maxPrincipalCents: nonNegativeCentsSchema,
  requiredApprovals: z.number().int().min(1).max(5),
  allowSelfApproval: z.boolean(),
  latePenaltyBps: z.number().int().min(0).max(10000),
});
export type LoanPolicyInput = z.infer<typeof loanPolicySchema>;

export const defaultLoanPolicy: LoanPolicyInput = {
  enabled: true,
  interestMethod: 'FLAT',
  rateBps: 1000,
  maxInstallments: 6,
  repaymentFrequency: 'MONTHLY',
  maxMultipleOfSavingsBps: 30000,
  maxPrincipalCents: 0,
  requiredApprovals: 2,
  allowSelfApproval: false,
  latePenaltyBps: 0,
};

export const groupSettingsSchema = z.object({
  /** Approvals needed for expenses, payouts and distributions. */
  requiredFinancialApprovals: z.number().int().min(1).max(5),
  lateContributionFineCents: nonNegativeCentsSchema,
  graceDays: z.number().int().min(0).max(60),
  membersCanViewMemberBalances: z.boolean(),
  paybillNumber: z.string().trim().max(20).nullable(),
  accountReferencePrefix: z.string().trim().max(12).nullable(),
});
export type GroupSettingsInput = z.infer<typeof groupSettingsSchema>;

export const defaultGroupSettings: GroupSettingsInput = {
  requiredFinancialApprovals: 2,
  lateContributionFineCents: 0,
  graceDays: 3,
  membersCanViewMemberBalances: false,
  paybillNumber: null,
  accountReferencePrefix: null,
};

export const createGroupSchema = z.object({
  name: z.string().trim().min(3, 'Group name is too short').max(120),
  type: z.enum(GROUP_TYPES),
  description: z.string().trim().max(1000).optional(),
  county: z.string().trim().max(60).optional(),
  registrationNumber: z.string().trim().max(60).optional(),
  financialYearStartMonth: z.number().int().min(1).max(12).default(1),
});
export type CreateGroupInput = z.infer<typeof createGroupSchema>;

export const updateGroupSchema = createGroupSchema.partial().extend({
  settings: groupSettingsSchema.partial().optional(),
  loanPolicy: loanPolicySchema.partial().optional(),
});

/* ---------- membership ---------- */

export const createInvitationSchema = z.object({
  phone: phoneSchema,
  fullName: z.string().trim().min(2).max(120).optional(),
  role: z.enum(GROUP_ROLES).default('MEMBER'),
});
export const respondInvitationSchema = z.object({ accept: z.boolean() });
export const acceptInviteCodeSchema = z.object({ code: z.string().trim().min(6).max(32) });

export const changeRoleSchema = z.object({ role: z.enum(GROUP_ROLES), reason: reasonSchema });
export const changeMemberStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED', 'EXITED']),
  reason: reasonSchema,
});

/* ---------- contributions ---------- */

export const createScheduleSchema = z.object({
  name: z.string().trim().min(2).max(80),
  amountCents: amountCentsSchema,
  frequency: z.enum(FREQUENCIES),
  startDate: isoDateSchema,
  endDate: isoDateSchema.optional(),
  /** Applies to all active members when omitted. */
  memberIds: z.array(z.string()).optional(),
});
export type CreateScheduleInput = z.infer<typeof createScheduleSchema>;

export const recordPaymentSchema = z.object({
  memberId: z.string().min(1),
  amountCents: amountCentsSchema,
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().max(60).optional(),
  paidAt: isoDateSchema,
  purpose: z.enum(['CONTRIBUTION', 'LOAN_REPAYMENT', 'FINE']).default('CONTRIBUTION'),
  /** Target obligation / loan / fine. When omitted contributions are applied oldest-first. */
  targetId: z.string().optional(),
  notes: z.string().trim().max(500).optional(),
  /** Client-generated key; the same key never records twice. */
  idempotencyKey: z.string().min(8).max(100),
});
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

export const verifyPaymentSchema = z.object({
  decision: z.enum(['CONFIRM', 'FAIL']),
  note: z.string().trim().max(500).optional(),
});
export const reversePaymentSchema = z.object({ reason: reasonSchema });

export const mpesaStkSchema = z.object({
  amountCents: amountCentsSchema,
  phone: phoneSchema,
  purpose: z.enum(['CONTRIBUTION', 'LOAN_REPAYMENT', 'FINE']).default('CONTRIBUTION'),
  targetId: z.string().optional(),
  idempotencyKey: z.string().min(8).max(100),
});

export const paymentFilterSchema = paginationSchema.extend({
  status: z.enum(TRANSACTION_STATUSES).optional(),
  memberId: z.string().optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  q: z.string().trim().max(60).optional(),
});

export const matchUnmatchedSchema = z.object({ memberId: z.string(), purpose: z.enum(['CONTRIBUTION', 'LOAN_REPAYMENT', 'FINE']), targetId: z.string().optional() });

/* ---------- loans ---------- */

export const loanQuoteSchema = z.object({
  principalCents: amountCentsSchema,
  installments: z.number().int().min(1).max(MAX_LOAN_INSTALLMENTS),
  firstDueDate: isoDateSchema.optional(),
});

export const loanApplicationSchema = z.object({
  principalCents: amountCentsSchema,
  installments: z.number().int().min(1).max(MAX_LOAN_INSTALLMENTS),
  purpose: z.string().trim().min(3).max(300),
  guarantorMemberIds: z.array(z.string()).max(5).default([]),
});
export type LoanApplicationInput = z.infer<typeof loanApplicationSchema>;

export const loanDecisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  comment: z.string().trim().max(500).optional(),
});

export const loanDisburseSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().max(60).optional(),
  disbursedAt: isoDateSchema,
  firstDueDate: isoDateSchema,
  idempotencyKey: z.string().min(8).max(100),
});

/* ---------- fines & expenses ---------- */

export const issueFineSchema = z.object({
  memberId: z.string(),
  amountCents: amountCentsSchema,
  reason: z.string().trim().min(3).max(300),
  issuedOn: isoDateSchema,
});
export const waiveFineSchema = z.object({ reason: reasonSchema });

export const createExpenseSchema = z.object({
  category: z.string().trim().min(2).max(60),
  description: z.string().trim().min(3).max(500),
  amountCents: amountCentsSchema,
  incurredOn: isoDateSchema,
  payee: z.string().trim().max(120).optional(),
});
export const approvalDecisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  comment: z.string().trim().max(500).optional(),
});
export const markPaidSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().max(60).optional(),
  paidAt: isoDateSchema,
  idempotencyKey: z.string().min(8).max(100),
});

/* ---------- rotations ---------- */

export const createCycleSchema = z.object({
  name: z.string().trim().min(2).max(80),
  contributionCents: amountCentsSchema,
  frequency: z.enum(FREQUENCIES),
  startDate: isoDateSchema,
  memberIdsInOrder: z.array(z.string()).min(2),
  recipientContributes: z.boolean().default(true),
});
export type CreateCycleInput = z.infer<typeof createCycleSchema>;

export const reorderCycleSchema = z.object({
  memberIdsInOrder: z.array(z.string()).min(2),
  reason: reasonSchema,
});
export const approvePayoutSchema = z.object({
  comment: z.string().trim().max(500).optional(),
  /** Required when the confirmed collection is below expected. */
  shortfallReason: z.string().trim().max(500).optional(),
});
export const deferRoundSchema = z.object({ reason: reasonSchema });

/* ---------- distributions ---------- */

export const distributionPreviewSchema = z.object({
  method: z.enum(DISTRIBUTION_METHODS),
  periodFrom: isoDateSchema,
  periodTo: isoDateSchema,
  liabilitiesCents: nonNegativeCentsSchema.default(0),
  retainedCents: nonNegativeCentsSchema.default(0),
  amountToDistributeCents: nonNegativeCentsSchema.optional(),
  offsetOutstandingLoans: z.boolean().default(false),
  shares: z.record(z.string(), z.number().int().min(0)).optional(),
});
export type DistributionPreviewInput = z.infer<typeof distributionPreviewSchema>;
export const createDistributionSchema = distributionPreviewSchema.extend({ title: z.string().trim().min(3).max(120) });

/* ---------- meetings ---------- */

export const createMeetingSchema = z.object({
  title: z.string().trim().min(3).max(120),
  scheduledAt: z.string().datetime({ offset: true }),
  location: z.string().trim().max(200).optional(),
  virtualLink: z.string().url().optional(),
  agenda: z.array(z.string().trim().min(1).max(300)).max(30).default([]),
  requiresRsvp: z.boolean().default(true),
});
export const updateMeetingSchema = createMeetingSchema.partial().extend({ status: z.enum(['SCHEDULED', 'HELD', 'CANCELLED']).optional() });
export const rsvpSchema = z.object({ status: z.enum([AttendanceStatus.CONFIRMED, AttendanceStatus.DECLINED, AttendanceStatus.APOLOGY]) });
export const attendanceRegisterSchema = z.object({
  entries: z.array(z.object({ memberId: z.string(), status: z.enum(['PRESENT', 'ABSENT', 'APOLOGY']) })).min(1),
});
export const minutesSchema = z.object({ body: z.string().trim().min(10).max(50000) });
export const resolutionSchema = z.object({
  title: z.string().trim().min(3).max(200),
  details: z.string().trim().max(5000).optional(),
  isFinancial: z.boolean().default(false),
  amountCents: nonNegativeCentsSchema.optional(),
});
export const actionItemSchema = z.object({
  description: z.string().trim().min(3).max(500),
  assigneeMemberId: z.string().optional(),
  dueDate: isoDateSchema.optional(),
});
export const updateActionItemSchema = z.object({ done: z.boolean() });

export const announcementSchema = z.object({
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(3).max(2000),
});

/* ---------- ledger ---------- */

export const adjustmentSchema = z.object({
  /** Positive increases cash, negative decreases. */
  amountCents: z.number().int().refine((v) => v !== 0, 'Amount cannot be zero'),
  account: z.enum(['OTHER_INCOME', 'EXPENSES', 'OPENING_BALANCE']),
  reason: reasonSchema,
  effectiveDate: isoDateSchema,
  reference: z.string().trim().max(60).optional(),
});

/* ---------- imports ---------- */

export const createImportSchema = z.object({
  kind: z.enum(IMPORT_KINDS),
  fileName: z.string().max(200),
  /** Raw CSV text. Spreadsheets are converted to CSV on the client. */
  csv: z.string().min(1).max(5_000_000),
});

/* ---------- platform ---------- */

export const planSchema = z.object({
  code: z.string().trim().regex(/^[A-Z0-9_]{2,30}$/),
  name: z.string().trim().min(2).max(60),
  priceCents: nonNegativeCentsSchema,
  maxMembers: z.number().int().min(1).max(100000),
  features: z.array(z.string().max(80)).max(30),
  active: z.boolean().default(true),
});
export const supportAccessRequestSchema = z.object({
  groupId: z.string(),
  purpose: reasonSchema,
  hours: z.number().int().min(1).max(72),
});
export const disputeSchema = z.object({
  paymentId: z.string().optional(),
  subject: z.string().trim().min(3).max(200),
  details: z.string().trim().min(5).max(2000),
});
export const resolveDisputeSchema = z.object({ resolution: reasonSchema, status: z.enum(['RESOLVED', 'REJECTED']) });
