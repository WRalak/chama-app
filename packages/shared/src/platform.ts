/**
 * The ChamaHub platform administration portal: staff accounts (separate from Chama members),
 * support cases, and the shapes the portal API returns.
 */
import { z } from 'zod';
import { ALL_PLATFORM_PERMISSIONS, type PlatformPermission } from './permissions';

/* ---------------- staff accounts ---------------- */

export const staffEmailSchema = z.string().trim().toLowerCase().email('Enter a valid e-mail address').max(200);

/** Staff passwords protect every group's metadata: long, with a letter and a number. */
export const staffPasswordSchema = z
  .string()
  .min(12, 'Use at least 12 characters')
  .max(200)
  .regex(/[A-Za-z]/, 'Include at least one letter')
  .regex(/\d/, 'Include at least one number');

export const platformLoginSchema = z.object({ email: staffEmailSchema, password: z.string().min(1).max(200) });
export const platformMfaLoginSchema = z.object({ mfaToken: z.string().min(20).max(2000), code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') });
export const platformForgotSchema = z.object({ email: staffEmailSchema });
export const platformTokenPasswordSchema = z.object({ token: z.string().min(32).max(200), password: staffPasswordSchema });
export const platformChangePasswordSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: staffPasswordSchema });
export const mfaCodeSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') });
export const mfaDisableSchema = z.object({ password: z.string().min(1).max(200), code: z.string().trim().regex(/^\d{6}$/) });

const roleCode = z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,39}$/, 'Use capitals, digits and _');
const permissionList = z.array(z.enum(ALL_PLATFORM_PERMISSIONS as [PlatformPermission, ...PlatformPermission[]])).max(ALL_PLATFORM_PERMISSIONS.length);

export const inviteStaffSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: staffEmailSchema,
  roleCodes: z.array(roleCode).min(1).max(5),
  extraPermissions: permissionList.default([]),
  team: z.string().trim().max(60).optional(),
  /** For temporary helpers: the account stops working after this time. */
  expiresAt: z.string().datetime().optional(),
});

export const updateStaffSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  team: z.string().trim().max(60).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

export const staffAccessSchema = z.object({
  roleCodes: z.array(roleCode).min(1).max(5),
  extraPermissions: permissionList.default([]),
  reason: z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(500),
});

export const staffReasonSchema = z.object({ reason: z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(500) });

export const platformRoleUpsertSchema = z.object({
  code: roleCode,
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).optional(),
  permissions: permissionList.min(1),
});

export type StaffStatus = 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';

export interface PlatformMe {
  id: string;
  fullName: string;
  email: string;
  team: string | null;
  roles: { code: string; name: string }[];
  permissions: PlatformPermission[];
  mfaEnabled: boolean;
  lastLoginAt: string | null;
}

export interface StaffRow {
  id: string;
  fullName: string;
  email: string;
  team: string | null;
  status: StaffStatus;
  invitation: 'PENDING' | 'EXPIRED' | 'ACCEPTED' | null;
  roles: { code: string; name: string }[];
  extraPermissions: PlatformPermission[];
  mfaEnabled: boolean;
  openCases: number;
  lastLoginAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  createdBy: string | null;
}

export interface PlatformRoleRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  system: boolean;
  permissions: PlatformPermission[];
  accounts: number;
}

export interface InviteResult {
  account: StaffRow;
  delivery: { sent: boolean; error?: string };
  /**
   * Only when e-mail could not be sent: the single-use link, shown once to the person who
   * created the invitation so they can pass it on through a secure channel. Never logged.
   */
  inviteUrl?: string;
}

/* ---------------- support cases ---------------- */

export const SUPPORT_CATEGORIES = ['ACCOUNT_ACCESS', 'CONTRIBUTIONS_PAYMENTS', 'PAYOUT_ROTATION', 'LOANS_REPAYMENTS', 'SUBSCRIPTION_BILLING', 'TECHNICAL', 'FEATURE_REQUEST', 'SECURITY', 'OTHER'] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];
export const SUPPORT_STATUSES = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_FOR_USER', 'ESCALATED', 'RESOLVED', 'CLOSED'] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];
export const SUPPORT_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type SupportPriority = (typeof SUPPORT_PRIORITIES)[number];

export const SUPPORT_LABELS = {
  category: {
    ACCOUNT_ACCESS: 'Login and account access',
    CONTRIBUTIONS_PAYMENTS: 'Contributions and payment records',
    PAYOUT_ROTATION: 'Payout rotation',
    LOANS_REPAYMENTS: 'Loans and repayments',
    SUBSCRIPTION_BILLING: 'Subscription and billing',
    TECHNICAL: 'Technical issue',
    FEATURE_REQUEST: 'Feature request',
    SECURITY: 'Security concern',
    OTHER: 'Other',
  } satisfies Record<SupportCategory, string>,
  status: {
    OPEN: 'Open',
    ASSIGNED: 'Assigned',
    IN_PROGRESS: 'In progress',
    WAITING_FOR_USER: 'Waiting for you',
    ESCALATED: 'Escalated',
    RESOLVED: 'Resolved',
    CLOSED: 'Closed',
  } satisfies Record<SupportStatus, string>,
  priority: { LOW: 'Low', NORMAL: 'Normal', HIGH: 'High', URGENT: 'Urgent' } satisfies Record<SupportPriority, string>,
};

export const createSupportCaseSchema = z.object({
  subject: z.string().trim().min(3).max(200),
  category: z.enum(SUPPORT_CATEGORIES),
  description: z.string().trim().min(10, 'Describe the problem (at least 10 characters)').max(5000),
  groupId: z.string().optional(),
});
export const supportMessageSchema = z.object({ body: z.string().trim().min(1).max(5000) });
export const staffReplySchema = z.object({ body: z.string().trim().min(1).max(5000), requestClarification: z.boolean().default(false) });
export const supportNoteSchema = z.object({ body: z.string().trim().min(1).max(5000) });
export const supportAssignSchema = z.object({ accountId: z.string().nullable() });
export const supportStatusSchema = z.object({ status: z.enum(['IN_PROGRESS', 'WAITING_FOR_USER', 'RESOLVED', 'CLOSED']), resolution: z.string().trim().max(5000).optional() });
export const supportEscalateSchema = z.object({ reason: z.string().trim().min(5).max(2000), priority: z.enum(SUPPORT_PRIORITIES).optional() });
export const supportPrioritySchema = z.object({ priority: z.enum(SUPPORT_PRIORITIES) });

/** What the person who asked for help sees. Internal notes are never part of it. */
export interface MySupportCase {
  id: string;
  number: string;
  subject: string;
  category: SupportCategory;
  status: SupportStatus;
  groupName: string | null;
  createdAt: string;
  updatedAt: string;
  resolution: string | null;
  messages: { id: string; from: 'YOU' | 'CHAMAHUB'; authorName: string; body: string; createdAt: string }[];
}

export interface SupportCaseRow {
  id: string;
  number: string;
  subject: string;
  category: SupportCategory;
  priority: SupportPriority;
  status: SupportStatus;
  requesterName: string;
  groupName: string | null;
  assignedTo: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
  firstResponseAt: string | null;
}

export interface SupportCaseDetail extends SupportCaseRow {
  description: string;
  resolution: string | null;
  escalationReason: string | null;
  /** Only what is needed to help: no balances, contributions or loans. */
  requester: { id: string; name: string; phoneMasked: string; email: string | null; accountStatus: 'ACTIVE' | 'DISABLED' | 'LOCKED'; memberSince: string; groups: number };
  group: { id: string; name: string; countryCode: string; members: number; plan: string; status: string } | null;
  messages: { id: string; from: 'USER' | 'STAFF'; authorName: string; body: string; createdAt: string }[];
  notes: { id: string; authorName: string; body: string; createdAt: string }[];
  assignments: { to: string | null; by: string; at: string }[];
  canWork: boolean;
  canAssign: boolean;
  /** On money-related cases: how corrections are made (by the group's officers, never by support). */
  financialGuidance: string | null;
}

/* ---------------- dashboard & audit ---------------- */

export interface Series {
  key: string;
  points: { period: string; value: number }[];
}

export interface PlatformDashboard {
  range: { from: string; to: string; bucket: 'day' | 'week' | 'month' };
  totals: {
    users: number;
    groups: number;
    activeGroups30d: number;
    newUsers: number;
    newGroups: number;
    payingGroups: number;
    freeGroups: number;
    trialGroups: number;
    activeHelpers: number;
    openSupportCases: number;
    criticalIncidents: number;
  };
  registrations: { period: string; users: number; groups: number }[];
  groupActivity: { active: number; inactive: number };
  planDistribution: { plan: string; groups: number }[];
  support: {
    byStatus: { status: SupportStatus; count: number }[];
    medianFirstResponseHours: number | null;
    medianResolutionHours: number | null;
    weekly: { period: string; opened: number; resolved: number }[];
  };
  /** Only for staff allowed to see revenue; null otherwise. Verified payments only. */
  revenue: null | { byMonth: { period: string; currency: string; collected: number; refunded: number }[]; pending: { currency: string; amountMinor: number; count: number }[] };
}

export interface PlatformAuditRow {
  id: string;
  at: string;
  actor: string | null;
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  outcome: 'SUCCESS' | 'FAILURE' | 'DENIED';
  reason: string | null;
  requestId: string | null;
  ipAddress: string | null;
  before: unknown;
  after: unknown;
}
