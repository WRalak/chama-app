import { GroupRole, PlatformRole } from './enums';

/**
 * Group-scoped permissions. A user's permissions are always evaluated
 * against their membership in ONE group; a role in one Chama never grants
 * anything in another.
 */
export const Permission = {
  GROUP_VIEW: 'group.view',
  GROUP_CONFIGURE: 'group.configure',
  MEMBERS_VIEW: 'members.view',
  MEMBERS_VIEW_FINANCIALS: 'members.view_financials',
  MEMBERS_INVITE: 'members.invite',
  MEMBERS_MANAGE: 'members.manage',
  ROLES_ASSIGN: 'roles.assign',
  CONTRIBUTIONS_VIEW_ALL: 'contributions.view_all',
  CONTRIBUTIONS_RECORD: 'contributions.record',
  CONTRIBUTIONS_VERIFY: 'contributions.verify',
  SCHEDULES_MANAGE: 'schedules.manage',
  RECONCILIATION_MANAGE: 'reconciliation.manage',
  LOANS_APPLY: 'loans.apply',
  LOANS_VIEW_ALL: 'loans.view_all',
  LOANS_APPROVE: 'loans.approve',
  LOANS_DISBURSE: 'loans.disburse',
  REPAYMENTS_RECORD: 'repayments.record',
  LOAN_POLICY_MANAGE: 'loan_policy.manage',
  FINES_VIEW_ALL: 'fines.view_all',
  FINES_MANAGE: 'fines.manage',
  EXPENSES_VIEW: 'expenses.view',
  EXPENSES_RECORD: 'expenses.record',
  EXPENSES_APPROVE: 'expenses.approve',
  ROTATIONS_VIEW: 'rotations.view',
  ROTATIONS_MANAGE: 'rotations.manage',
  PAYOUTS_APPROVE: 'payouts.approve',
  DISTRIBUTIONS_MANAGE: 'distributions.manage',
  DISTRIBUTIONS_APPROVE: 'distributions.approve',
  MEETINGS_VIEW: 'meetings.view',
  MEETINGS_MANAGE: 'meetings.manage',
  MINUTES_APPROVE: 'minutes.approve',
  STATEMENTS_VIEW: 'statements.view',
  STATEMENTS_PUBLISH: 'statements.publish',
  REPORTS_VIEW: 'reports.view',
  LEDGER_ADJUST: 'ledger.adjust',
  IMPORTS_MANAGE: 'imports.manage',
  IMPORTS_APPROVE: 'imports.approve',
  AUDIT_VIEW: 'audit.view',
  ANNOUNCEMENTS_SEND: 'announcements.send',
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];
export const ALL_PERMISSIONS = Object.values(Permission) as Permission[];

const P = Permission;

const MEMBER_PERMISSIONS: Permission[] = [
  P.GROUP_VIEW,
  P.MEMBERS_VIEW,
  P.LOANS_APPLY,
  P.ROTATIONS_VIEW,
  P.MEETINGS_VIEW,
  P.STATEMENTS_VIEW,
  P.EXPENSES_VIEW,
];

const OFFICER_READ: Permission[] = [
  ...MEMBER_PERMISSIONS,
  P.MEMBERS_VIEW_FINANCIALS,
  P.CONTRIBUTIONS_VIEW_ALL,
  P.LOANS_VIEW_ALL,
  P.FINES_VIEW_ALL,
  P.REPORTS_VIEW,
  P.AUDIT_VIEW,
];

export const ROLE_PERMISSIONS: Record<GroupRole, readonly Permission[]> = {
  CHAIRPERSON: ALL_PERMISSIONS,
  VICE_CHAIRPERSON: [
    ...OFFICER_READ,
    P.MEMBERS_INVITE,
    P.LOANS_APPROVE,
    P.EXPENSES_APPROVE,
    P.PAYOUTS_APPROVE,
    P.DISTRIBUTIONS_APPROVE,
    P.MEETINGS_MANAGE,
    P.MINUTES_APPROVE,
    P.IMPORTS_APPROVE,
    P.ANNOUNCEMENTS_SEND,
  ],
  TREASURER: [
    ...OFFICER_READ,
    P.CONTRIBUTIONS_RECORD,
    P.CONTRIBUTIONS_VERIFY,
    P.SCHEDULES_MANAGE,
    P.RECONCILIATION_MANAGE,
    P.LOANS_APPROVE,
    P.LOANS_DISBURSE,
    P.REPAYMENTS_RECORD,
    P.FINES_MANAGE,
    P.EXPENSES_RECORD,
    P.ROTATIONS_MANAGE,
    P.DISTRIBUTIONS_MANAGE,
    P.STATEMENTS_PUBLISH,
    P.LEDGER_ADJUST,
    P.IMPORTS_MANAGE,
  ],
  SECRETARY: [
    ...OFFICER_READ,
    P.MEMBERS_INVITE,
    P.MEMBERS_MANAGE,
    P.FINES_MANAGE,
    P.MEETINGS_MANAGE,
    P.IMPORTS_MANAGE,
    P.ANNOUNCEMENTS_SEND,
  ],
  AUDITOR: [...OFFICER_READ],
  MEMBER: MEMBER_PERMISSIONS,
};

export function permissionsForRole(role: GroupRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function roleHasPermission(role: GroupRole, permission: Permission): boolean {
  return permissionsForRole(role).includes(permission);
}

export const OFFICER_ROLES: readonly GroupRole[] = [
  GroupRole.CHAIRPERSON,
  GroupRole.VICE_CHAIRPERSON,
  GroupRole.TREASURER,
  GroupRole.SECRETARY,
  GroupRole.AUDITOR,
];

export function isOfficer(role: GroupRole): boolean {
  return role !== GroupRole.MEMBER;
}

/**
 * Platform roles govern the SaaS itself (plans, health, support). They do
 * NOT grant access to a group's private finances — that requires a
 * time-boxed, purpose-stated, audited support access grant from the group.
 */
export const PlatformPermission = {
  PLATFORM_VIEW_STATS: 'platform.view_stats',
  PLATFORM_MANAGE_PLANS: 'platform.manage_plans',
  PLATFORM_MANAGE_ACCOUNTS: 'platform.manage_accounts',
  PLATFORM_VIEW_SECURITY: 'platform.view_security',
  PLATFORM_SUPPORT: 'platform.support',
} as const;
export type PlatformPermission = (typeof PlatformPermission)[keyof typeof PlatformPermission];

export const PLATFORM_ROLE_PERMISSIONS: Record<PlatformRole, readonly PlatformPermission[]> = {
  USER: [],
  SUPPORT: [PlatformPermission.PLATFORM_VIEW_STATS, PlatformPermission.PLATFORM_SUPPORT],
  SUPER_ADMIN: Object.values(PlatformPermission),
};

export function platformRoleHas(role: PlatformRole, permission: PlatformPermission): boolean {
  return PLATFORM_ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
