/**
 * API response contracts shared by the admin dashboard and the mobile app.
 * All money fields are integer KES cents; all dates are ISO strings.
 */
import type {
  ApprovalStatus,
  AttendanceStatus,
  CycleStatus,
  DistributionMethod,
  DistributionStatus,
  ExpenseStatus,
  FineStatus,
  Frequency,
  GroupRole,
  GroupType,
  ImportKind,
  ImportStatus,
  InstallmentStatus,
  InterestMethod,
  LoanStatus,
  MeetingStatus,
  MembershipStatus,
  MinutesStatus,
  NotificationType,
  ObligationStatus,
  PaymentMethod,
  PaymentPurpose,
  PayoutStatus,
  PlatformRole,
  ReconciliationStatus,
  TransactionStatus,
} from './enums';
import type { Permission } from './permissions';
import type { GroupSettingsInput, LoanPolicyInput, NotificationPreferences } from './schemas';
import type { DistributionResult } from './finance/distribution';
import type { LoanSchedule } from './finance/loans';

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ApiErrorBody {
  statusCode: number;
  error: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

/* ---------- auth / users ---------- */

export interface AuthUser {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  phoneVerified: boolean;
  platformRole: PlatformRole;
  createdAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Access token lifetime in seconds. */
  expiresIn: number;
}

export interface AuthResponse {
  user: AuthUser;
  tokens: AuthTokens;
}

export interface SessionInfo {
  id: string;
  deviceName: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}

export interface MeResponse extends AuthUser {
  preferences: NotificationPreferences;
  deletionRequestedAt: string | null;
}

/* ---------- groups ---------- */

export interface GroupMembershipSummary {
  groupId: string;
  membershipId: string;
  name: string;
  type: GroupType;
  role: GroupRole;
  permissions: Permission[];
  status: MembershipStatus;
  memberCount: number;
  schedule: { name: string; amountCents: number; frequency: Frequency } | null;
  nextDueDate: string | null;
  outstandingCents: number;
  loanBalanceCents: number;
  nextPayoutDate: string | null;
}

export interface GroupDetail {
  id: string;
  name: string;
  type: GroupType;
  description: string | null;
  county: string | null;
  registrationNumber: string | null;
  financialYearStartMonth: number;
  inviteCode: string | null;
  settings: GroupSettingsInput;
  loanPolicy: LoanPolicyInput;
  memberCount: number;
  createdAt: string;
  myMembership: { membershipId: string; role: GroupRole; permissions: Permission[] };
}

export interface GroupOverview {
  cashBalanceCents: number;
  totalContributionsCents: number;
  outstandingContributionsCents: number;
  loansOutstandingCents: number;
  pendingApprovals: number;
  pendingVerification: number;
  activeMembers: number;
  monthly: { month: string; contributionsCents: number; expensesCents: number; repaymentsCents: number }[];
}

export interface MemberRow {
  membershipId: string;
  userId: string;
  fullName: string;
  /** Masked unless the viewer may see member contact details. */
  phone: string;
  role: GroupRole;
  status: MembershipStatus;
  joinedAt: string;
  shares: number;
  /** Present only when the viewer may see member financials. */
  financials?: {
    contributedCents: number;
    outstandingCents: number;
    loanBalanceCents: number;
    finesOutstandingCents: number;
  };
}

export interface InvitationRow {
  id: string;
  groupId: string;
  groupName: string;
  phone: string;
  fullName: string | null;
  role: GroupRole;
  status: string;
  invitedByName: string;
  expiresAt: string;
  createdAt: string;
}

/* ---------- contributions & payments ---------- */

export interface ScheduleRow {
  id: string;
  name: string;
  amountCents: number;
  frequency: Frequency;
  startDate: string;
  endDate: string | null;
  active: boolean;
  memberCount: number;
}

export interface ObligationItem {
  id: string;
  groupId: string;
  groupName: string;
  membershipId: string;
  memberName: string;
  scheduleName: string;
  periodLabel: string;
  dueDate: string;
  amountCents: number;
  paidCents: number;
  pendingCents: number;
  outstandingCents: number;
  status: ObligationStatus;
}

export interface PaymentItem {
  id: string;
  groupId: string;
  groupName: string;
  membershipId: string | null;
  memberName: string | null;
  amountCents: number;
  method: PaymentMethod;
  reference: string | null;
  purpose: PaymentPurpose;
  status: TransactionStatus;
  paidAt: string;
  recordedByName: string | null;
  verifiedByName: string | null;
  verifiedAt: string | null;
  notes: string | null;
  createdAt: string;
  allocations?: { label: string; amountCents: number }[];
}

export interface ContributionLedgerRow {
  obligationId: string;
  dueDate: string;
  memberName: string;
  membershipId: string;
  period: string;
  expectedCents: number;
  receivedCents: number;
  pendingCents: number;
  outstandingCents: number;
  status: ObligationStatus;
  payments: {
    paymentId: string;
    amountCents: number;
    method: PaymentMethod;
    reference: string | null;
    status: TransactionStatus;
    recordedByName: string | null;
    paidAt: string;
  }[];
}

export interface ReconciliationSummary {
  expectedCents: number;
  confirmedCents: number;
  pendingCents: number;
  outstandingCents: number;
  failedCount: number;
  pendingCount: number;
  duplicateReferences: { reference: string; count: number; paymentIds: string[] }[];
  unmatched: UnmatchedPayment[];
}

export interface UnmatchedPayment {
  id: string;
  source: string;
  amountCents: number;
  reference: string;
  payerPhone: string | null;
  payerName: string | null;
  accountReference: string | null;
  receivedAt: string;
  status: ReconciliationStatus;
}

export interface CalendarEntry {
  id: string;
  kind: 'CONTRIBUTION' | 'LOAN_INSTALLMENT' | 'PAYOUT' | 'MEETING';
  groupId: string;
  groupName: string;
  date: string;
  title: string;
  amountCents: number | null;
  status: string;
}

/* ---------- loans ---------- */

export interface LoanSummary {
  id: string;
  groupId: string;
  groupName: string;
  membershipId: string;
  memberName: string;
  principalCents: number;
  interestCents: number;
  totalRepayableCents: number;
  paidCents: number;
  outstandingCents: number;
  status: LoanStatus;
  interestMethod: InterestMethod;
  rateBps: number;
  installments: number;
  purpose: string;
  appliedAt: string;
  disbursedAt: string | null;
  nextInstallment: { dueDate: string; amountCents: number } | null;
  overdueCents: number;
  approvalsReceived: number;
  approvalsRequired: number;
}

export interface LoanInstallmentRow {
  id: string;
  number: number;
  dueDate: string;
  principalCents: number;
  interestCents: number;
  totalCents: number;
  paidCents: number;
  status: InstallmentStatus;
}

export interface ApprovalRecord {
  id: string;
  approverName: string;
  approverRole: GroupRole;
  decision: ApprovalStatus;
  comment: string | null;
  createdAt: string;
}

export interface LoanDetail extends LoanSummary {
  schedule: LoanInstallmentRow[];
  repayments: PaymentItem[];
  approvals: ApprovalRecord[];
  guarantors: { membershipId: string; name: string }[];
  disbursementReference: string | null;
  canApprove: boolean;
  canDisburse: boolean;
}

export interface LoanQuote extends LoanSchedule {
  rateBps: number;
  frequency: Frequency;
  eligibility?: { eligible: boolean; reasons: string[]; limitCents: number | null };
}

/* ---------- fines & expenses ---------- */

export interface FineRow {
  id: string;
  membershipId: string;
  memberName: string;
  amountCents: number;
  paidCents: number;
  reason: string;
  issuedOn: string;
  status: FineStatus;
  issuedByName: string;
  waivedReason: string | null;
}

export interface ExpenseRow {
  id: string;
  category: string;
  description: string;
  amountCents: number;
  incurredOn: string;
  payee: string | null;
  status: ExpenseStatus;
  recordedByName: string;
  approvals: ApprovalRecord[];
  approvalsRequired: number;
  paymentReference: string | null;
  paidAt: string | null;
  canApprove: boolean;
}

/* ---------- rotations ---------- */

export interface RotationRoundRow {
  id: string;
  round: number;
  recipientMembershipId: string;
  recipientName: string;
  payoutDate: string;
  expectedCents: number;
  confirmedCents: number;
  pendingCents: number;
  shortfallCents: number;
  status: PayoutStatus;
  approvals: ApprovalRecord[];
  approvalsRequired: number;
  payoutReference: string | null;
  completedAt: string | null;
  shortfallReason: string | null;
}

export interface RotationCycle {
  id: string;
  groupId: string;
  groupName: string;
  name: string;
  status: CycleStatus;
  contributionCents: number;
  frequency: Frequency;
  startDate: string;
  recipientContributes: boolean;
  rounds: RotationRoundRow[];
  currentRound: RotationRoundRow | null;
  nextRound: RotationRoundRow | null;
  remainingRounds: number;
  myRounds: RotationRoundRow[];
  changeLog: { at: string; byName: string; reason: string }[];
}

/* ---------- distributions ---------- */

export interface DistributionRecord {
  id: string;
  title: string;
  status: DistributionStatus;
  method: DistributionMethod;
  periodFrom: string;
  periodTo: string;
  calculation: DistributionResult;
  approvals: ApprovalRecord[];
  approvalsRequired: number;
  createdByName: string;
  createdAt: string;
  allocations: {
    id: string;
    membershipId: string;
    memberName: string;
    grossCents: number;
    loanOffsetCents: number;
    netPayableCents: number;
    paidAt: string | null;
    paymentReference: string | null;
  }[];
}

/* ---------- meetings ---------- */

export interface MeetingRow {
  id: string;
  groupId: string;
  groupName: string;
  title: string;
  scheduledAt: string;
  location: string | null;
  virtualLink: string | null;
  status: MeetingStatus;
  agenda: string[];
  requiresRsvp: boolean;
  myAttendance: AttendanceStatus | null;
  attendanceCounts: Partial<Record<AttendanceStatus, number>>;
  minutesStatus: MinutesStatus | null;
}

export interface MeetingDetail extends MeetingRow {
  attendance: { membershipId: string; name: string; status: AttendanceStatus | null }[];
  minutes: { body: string; status: MinutesStatus; approvedByName: string | null; approvedAt: string | null } | null;
  resolutions: { id: string; title: string; details: string | null; isFinancial: boolean; amountCents: number | null }[];
  actions: { id: string; description: string; assigneeName: string | null; assigneeMembershipId: string | null; dueDate: string | null; done: boolean }[];
}

/* ---------- statements ---------- */

export interface LedgerLine {
  id: string;
  date: string;
  type: string;
  description: string;
  reference: string | null;
  inflowCents: number;
  outflowCents: number;
  balanceCents: number;
  memberName: string | null;
}

export interface GroupStatement {
  groupId: string;
  groupName: string;
  from: string;
  to: string;
  openingBalanceCents: number;
  contributionsCents: number;
  loanRepaymentsCents: number;
  interestReceivedCents: number;
  finesReceivedCents: number;
  otherIncomeCents: number;
  expensesCents: number;
  loansDisbursedCents: number;
  payoutsCents: number;
  distributionsCents: number;
  closingBalanceCents: number;
  loansOutstandingCents: number;
  transactions: LedgerLine[];
  generatedAt: string;
}

export interface PersonalGroupLine {
  groupId: string;
  groupName: string;
  role: GroupRole;
  contributionsCents: number;
  outstandingContributionsCents: number;
  loansReceivedCents: number;
  loanRepaymentsCents: number;
  interestPaidCents: number;
  loanBalanceCents: number;
  finesPaidCents: number;
  payoutsReceivedCents: number;
  distributionsReceivedCents: number;
  shares: number;
}

export interface PersonalStatement {
  userName: string;
  from: string;
  to: string;
  groups: PersonalGroupLine[];
  totals: Omit<PersonalGroupLine, 'groupId' | 'groupName' | 'role' | 'shares'>;
  upcoming: ObligationItem[];
  generatedAt: string;
  notes: string[];
}

/* ---------- dashboard ---------- */

export interface ActivityItem {
  id: string;
  groupId: string;
  groupName: string;
  at: string;
  title: string;
  amountCents: number | null;
  kind: string;
}

export interface PersonalDashboard {
  activeGroups: number;
  contributedThisMonthCents: number;
  upcoming: ObligationItem[];
  overdue: ObligationItem[];
  overdueCents: number;
  outstandingLoanCents: number;
  payoutsReceivedCents: number;
  upcomingPayouts: { groupId: string; groupName: string; cycleName: string; payoutDate: string; expectedCents: number; status: PayoutStatus }[];
  recentActivity: ActivityItem[];
  groups: GroupMembershipSummary[];
  pendingInvitations: number;
  unreadNotifications: number;
}

/* ---------- notifications / audit / imports / platform ---------- */

export interface NotificationItem {
  id: string;
  groupId: string | null;
  groupName: string | null;
  type: NotificationType;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export interface AuditEventRow {
  id: string;
  at: string;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  reference: string | null;
  ipAddress: string | null;
}

export interface ImportBatchRow {
  id: string;
  kind: ImportKind;
  fileName: string;
  status: ImportStatus;
  rowCount: number;
  errorCount: number;
  warningCount: number;
  uploadedByName: string;
  reviewedByName: string | null;
  createdAt: string;
  committedAt: string | null;
}

export interface ImportRowResult {
  rowNumber: number;
  data: Record<string, string>;
  errors: string[];
  warnings: string[];
}

export interface ImportBatchDetail extends ImportBatchRow {
  rows: ImportRowResult[];
  summary: Record<string, number>;
}

export interface PlatformOverview {
  totalGroups: number;
  activeGroups: number;
  totalUsers: number;
  newUsers30d: number;
  subscriptions: Record<string, number>;
  monthlyRecurringRevenueCents: number;
  failedJobs24h: number;
  openSupportRequests: number;
  health: { database: 'ok' | 'down'; integrations: { name: string; configured: boolean; status: string }[] };
  securityEvents: AuditEventRow[];
}

export interface IntegrationStatus {
  mpesa: { configured: boolean; environment: string | null };
  sms: { configured: boolean; provider: string };
  email: { configured: boolean };
  whatsapp: { configured: boolean };
}
