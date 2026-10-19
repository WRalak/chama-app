import { GroupRole, PlatformRole } from './enums';

/**
 * Chama-level permissions. They are always evaluated against the caller's
 * membership in ONE group: a role in one Chama never grants anything in
 * another. Separation of duties (maker ≠ checker, no self-approval) is
 * enforced in the API independently of these permissions, so no
 * configuration can bypass a required approval.
 */
export const Permission = {
  GROUP_VIEW: 'group.view',
  GROUP_CONFIGURE: 'group.configure',
  PERMISSIONS_CONFIGURE: 'permissions.configure',
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
  LOANS_PREPARE: 'loans.prepare',
  LOANS_VIEW_ALL: 'loans.view_all',
  LOANS_APPROVE: 'loans.approve',
  LOANS_DISBURSE: 'loans.disburse',
  REPAYMENTS_RECORD: 'repayments.record',
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
  /** Full group audit log. */
  AUDIT_VIEW: 'audit.view',
  /** Audit records for the areas the holder works in (finance or administration). */
  AUDIT_VIEW_AREA: 'audit.view_area',
  ANNOUNCEMENTS_SEND: 'announcements.send',
  VOTES_CREATE: 'votes.create',
  VOTES_CAST: 'votes.cast',
  FINDINGS_RAISE: 'findings.raise',
  FINDINGS_RESOLVE: 'findings.resolve',
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];
export const ALL_PERMISSIONS = Object.values(Permission) as Permission[];

const P = Permission;

/** Human-readable descriptions for the permission editor. */
export const PERMISSION_INFO: Record<Permission, { label: string; area: 'Group' | 'Members' | 'Contributions' | 'Loans' | 'Expenses & fines' | 'Payouts' | 'Meetings' | 'Reports & audit' | 'Decisions' }> = {
  'group.view': { label: 'View the group', area: 'Group' },
  'group.configure': { label: 'Change group settings and policies', area: 'Group' },
  'permissions.configure': { label: 'Configure role permissions', area: 'Group' },
  'members.view': { label: 'View member directory', area: 'Members' },
  'members.view_financials': { label: 'View members’ balances', area: 'Members' },
  'members.invite': { label: 'Invite members', area: 'Members' },
  'members.manage': { label: 'Suspend, exit and set member shares', area: 'Members' },
  'roles.assign': { label: 'Assign roles', area: 'Members' },
  'contributions.view_all': { label: 'View the contributions ledger', area: 'Contributions' },
  'contributions.record': { label: 'Record contributions', area: 'Contributions' },
  'contributions.verify': { label: 'Verify payments (as second officer)', area: 'Contributions' },
  'schedules.manage': { label: 'Set contribution schedules', area: 'Contributions' },
  'reconciliation.manage': { label: 'Reconcile payments', area: 'Contributions' },
  'loans.apply': { label: 'Apply for own loan', area: 'Loans' },
  'loans.prepare': { label: 'Prepare loan applications for members', area: 'Loans' },
  'loans.view_all': { label: 'View the loan register', area: 'Loans' },
  'loans.approve': { label: 'Approve loans', area: 'Loans' },
  'loans.disburse': { label: 'Record loan disbursements', area: 'Loans' },
  'repayments.record': { label: 'Record loan repayments', area: 'Loans' },
  'fines.view_all': { label: 'View all fines', area: 'Expenses & fines' },
  'fines.manage': { label: 'Issue and waive fines', area: 'Expenses & fines' },
  'expenses.view': { label: 'View expenses', area: 'Expenses & fines' },
  'expenses.record': { label: 'Record and pay expenses', area: 'Expenses & fines' },
  'expenses.approve': { label: 'Approve expenses', area: 'Expenses & fines' },
  'rotations.view': { label: 'View payout rotation', area: 'Payouts' },
  'rotations.manage': { label: 'Manage rotations and prepare payouts', area: 'Payouts' },
  'payouts.approve': { label: 'Approve payouts and order changes', area: 'Payouts' },
  'distributions.manage': { label: 'Prepare distributions', area: 'Payouts' },
  'distributions.approve': { label: 'Approve distributions', area: 'Payouts' },
  'meetings.view': { label: 'View meetings and published minutes', area: 'Meetings' },
  'meetings.manage': { label: 'Schedule meetings, attendance and minutes', area: 'Meetings' },
  'minutes.approve': { label: 'Approve and publish minutes', area: 'Meetings' },
  'statements.view': { label: 'View published group statements', area: 'Reports & audit' },
  'statements.publish': { label: 'Generate and publish statements', area: 'Reports & audit' },
  'reports.view': { label: 'View financial reports', area: 'Reports & audit' },
  'ledger.adjust': { label: 'Post reversals and adjustments (with reason)', area: 'Reports & audit' },
  'imports.manage': { label: 'Upload paper-record imports', area: 'Reports & audit' },
  'imports.approve': { label: 'Review and commit imports', area: 'Reports & audit' },
  'audit.view': { label: 'View the full audit log', area: 'Reports & audit' },
  'audit.view_area': { label: 'View audit records for own area', area: 'Reports & audit' },
  'announcements.send': { label: 'Send announcements', area: 'Decisions' },
  'votes.create': { label: 'Start and close votes', area: 'Decisions' },
  'votes.cast': { label: 'Vote on group decisions', area: 'Decisions' },
  'findings.raise': { label: 'Raise audit findings', area: 'Decisions' },
  'findings.resolve': { label: 'Respond to audit findings', area: 'Decisions' },
};

const MEMBER_DEFAULT: Permission[] = [
  P.GROUP_VIEW,
  P.MEMBERS_VIEW,
  P.LOANS_APPLY,
  P.ROTATIONS_VIEW,
  P.MEETINGS_VIEW,
  P.STATEMENTS_VIEW,
  P.EXPENSES_VIEW,
  P.VOTES_CAST,
];

/** Default matrix. Each group may adjust it within PERMISSION_SAFEGUARDS. */
export const ROLE_PERMISSIONS: Record<GroupRole, readonly Permission[]> = {
  CHAIRPERSON: [
    ...MEMBER_DEFAULT,
    P.GROUP_CONFIGURE,
    P.PERMISSIONS_CONFIGURE,
    P.MEMBERS_VIEW_FINANCIALS,
    P.MEMBERS_INVITE,
    P.MEMBERS_MANAGE,
    P.ROLES_ASSIGN,
    P.CONTRIBUTIONS_VIEW_ALL,
    P.CONTRIBUTIONS_VERIFY,
    P.SCHEDULES_MANAGE,
    P.LOANS_PREPARE,
    P.LOANS_VIEW_ALL,
    P.LOANS_APPROVE,
    P.FINES_VIEW_ALL,
    P.EXPENSES_APPROVE,
    P.ROTATIONS_MANAGE,
    P.PAYOUTS_APPROVE,
    P.DISTRIBUTIONS_MANAGE,
    P.DISTRIBUTIONS_APPROVE,
    P.MEETINGS_MANAGE,
    P.MINUTES_APPROVE,
    P.STATEMENTS_PUBLISH,
    P.REPORTS_VIEW,
    P.LEDGER_ADJUST,
    P.IMPORTS_APPROVE,
    P.AUDIT_VIEW,
    P.ANNOUNCEMENTS_SEND,
    P.VOTES_CREATE,
    P.FINDINGS_RESOLVE,
  ],
  VICE_CHAIRPERSON: [
    ...MEMBER_DEFAULT,
    P.MEMBERS_VIEW_FINANCIALS,
    P.MEMBERS_INVITE,
    P.CONTRIBUTIONS_VIEW_ALL,
    P.LOANS_VIEW_ALL,
    P.LOANS_APPROVE,
    P.FINES_VIEW_ALL,
    P.EXPENSES_APPROVE,
    P.PAYOUTS_APPROVE,
    P.DISTRIBUTIONS_APPROVE,
    P.MEETINGS_MANAGE,
    P.MINUTES_APPROVE,
    P.REPORTS_VIEW,
    P.IMPORTS_APPROVE,
    P.AUDIT_VIEW,
    P.ANNOUNCEMENTS_SEND,
    P.VOTES_CREATE,
    P.FINDINGS_RESOLVE,
  ],
  // The treasurer prepares; another officer approves sensitive transactions.
  TREASURER: [
    ...MEMBER_DEFAULT,
    P.MEMBERS_VIEW_FINANCIALS,
    P.CONTRIBUTIONS_VIEW_ALL,
    P.CONTRIBUTIONS_RECORD,
    P.CONTRIBUTIONS_VERIFY,
    P.SCHEDULES_MANAGE,
    P.RECONCILIATION_MANAGE,
    P.LOANS_PREPARE,
    P.LOANS_VIEW_ALL,
    P.LOANS_APPROVE,
    P.LOANS_DISBURSE,
    P.REPAYMENTS_RECORD,
    P.FINES_VIEW_ALL,
    P.FINES_MANAGE,
    P.EXPENSES_RECORD,
    P.ROTATIONS_MANAGE,
    P.DISTRIBUTIONS_MANAGE,
    P.STATEMENTS_PUBLISH,
    P.REPORTS_VIEW,
    P.LEDGER_ADJUST,
    P.IMPORTS_MANAGE,
    P.AUDIT_VIEW_AREA,
    P.FINDINGS_RESOLVE,
  ],
  SECRETARY: [...MEMBER_DEFAULT, P.MEMBERS_INVITE, P.MEETINGS_MANAGE, P.ANNOUNCEMENTS_SEND, P.AUDIT_VIEW_AREA],
  AUDITOR: [
    ...MEMBER_DEFAULT,
    P.MEMBERS_VIEW_FINANCIALS,
    P.CONTRIBUTIONS_VIEW_ALL,
    P.LOANS_VIEW_ALL,
    P.FINES_VIEW_ALL,
    P.REPORTS_VIEW,
    P.AUDIT_VIEW,
    P.FINDINGS_RAISE,
  ],
  MEMBER: MEMBER_DEFAULT,
};

/** Optional roles a group can add to a membership on top of its main role. */
export const SpecialRole = {
  LOAN_COMMITTEE: 'LOAN_COMMITTEE',
  PAYOUT_APPROVER: 'PAYOUT_APPROVER',
  JOINT_SIGNATORY: 'JOINT_SIGNATORY',
  READ_ONLY: 'READ_ONLY',
} as const;
export type SpecialRole = (typeof SpecialRole)[keyof typeof SpecialRole];
export const SPECIAL_ROLES = Object.values(SpecialRole) as [SpecialRole, ...SpecialRole[]];

export const SPECIAL_ROLE_INFO: Record<SpecialRole, { label: string; description: string; grants: readonly Permission[] }> = {
  LOAN_COMMITTEE: { label: 'Loan Committee Member', description: 'Reviews and approves loan applications within the group’s loan policy.', grants: [P.LOANS_VIEW_ALL, P.LOANS_APPROVE, P.MEMBERS_VIEW_FINANCIALS] },
  PAYOUT_APPROVER: { label: 'Payout Approver', description: 'Authorises rotation payouts and distributions.', grants: [P.PAYOUTS_APPROVE, P.DISTRIBUTIONS_APPROVE, P.REPORTS_VIEW] },
  JOINT_SIGNATORY: { label: 'Joint Signatory', description: 'Provides an additional authorisation for sensitive financial operations.', grants: [P.EXPENSES_APPROVE, P.PAYOUTS_APPROVE, P.DISTRIBUTIONS_APPROVE, P.LOANS_APPROVE, P.CONTRIBUTIONS_VIEW_ALL, P.REPORTS_VIEW] },
  READ_ONLY: { label: 'Read-only Member', description: 'Can view permitted information but cannot apply for loans, vote or take actions.', grants: [] },
};

/** Permissions that only read; the only kind an auditor or a read-only member may hold. */
export const READ_PERMISSIONS: readonly Permission[] = [
  P.GROUP_VIEW,
  P.MEMBERS_VIEW,
  P.MEMBERS_VIEW_FINANCIALS,
  P.CONTRIBUTIONS_VIEW_ALL,
  P.LOANS_VIEW_ALL,
  P.FINES_VIEW_ALL,
  P.EXPENSES_VIEW,
  P.ROTATIONS_VIEW,
  P.MEETINGS_VIEW,
  P.STATEMENTS_VIEW,
  P.REPORTS_VIEW,
  P.AUDIT_VIEW,
  P.AUDIT_VIEW_AREA,
];

/**
 * Platform safeguards on group-configured permissions:
 * - `locked`: always held by the role (the group cannot lock itself out).
 * - `allowed`: the most a group may grant the role.
 */
export const PERMISSION_SAFEGUARDS: Record<GroupRole, { locked: readonly Permission[]; allowed: readonly Permission[] }> = {
  CHAIRPERSON: { locked: [P.GROUP_VIEW, P.GROUP_CONFIGURE, P.PERMISSIONS_CONFIGURE, P.ROLES_ASSIGN], allowed: ALL_PERMISSIONS },
  VICE_CHAIRPERSON: { locked: [P.GROUP_VIEW], allowed: ALL_PERMISSIONS.filter((p) => p !== P.PERMISSIONS_CONFIGURE) },
  TREASURER: { locked: [P.GROUP_VIEW], allowed: ALL_PERMISSIONS.filter((p) => p !== P.PERMISSIONS_CONFIGURE) },
  SECRETARY: { locked: [P.GROUP_VIEW], allowed: ALL_PERMISSIONS.filter((p) => p !== P.PERMISSIONS_CONFIGURE) },
  // Auditors stay read-only so they never verify their own work.
  AUDITOR: { locked: [P.GROUP_VIEW, P.FINDINGS_RAISE], allowed: [...READ_PERMISSIONS, P.FINDINGS_RAISE, P.LOANS_APPLY, P.VOTES_CAST] },
  // Ordinary members can be given more visibility, never write access to group records.
  MEMBER: { locked: [P.GROUP_VIEW], allowed: [...READ_PERMISSIONS.filter((p) => p !== P.AUDIT_VIEW && p !== P.AUDIT_VIEW_AREA), P.LOANS_APPLY, P.VOTES_CAST] },
};

/** A group's overrides: role → full permission list. Missing roles use the default. */
export type RolePolicy = Partial<Record<GroupRole, Permission[]>>;

/** Clamps a requested permission list to the platform safeguards for that role. */
export function sanitizeRolePermissions(role: GroupRole, requested: readonly Permission[]): { permissions: Permission[]; rejected: Permission[] } {
  const guard = PERMISSION_SAFEGUARDS[role];
  const rejected = requested.filter((p) => !guard.allowed.includes(p));
  const permissions = [...new Set([...guard.locked, ...requested.filter((p) => guard.allowed.includes(p))])];
  return { permissions, rejected };
}

/**
 * The single source of truth for what a membership may do in its group:
 * the group's policy for the role (or the default), plus special-role
 * grants, minus everything except reading for read-only members.
 */
export function resolvePermissions(role: GroupRole, policy?: RolePolicy | null, specialRoles: readonly SpecialRole[] = []): Permission[] {
  const base = policy?.[role] ? sanitizeRolePermissions(role, policy[role]!).permissions : [...ROLE_PERMISSIONS[role]];
  const grants = specialRoles.filter((s) => s !== 'READ_ONLY').flatMap((s) => SPECIAL_ROLE_INFO[s].grants);
  let perms = [...new Set([...base, ...grants])];
  if (specialRoles.includes('READ_ONLY')) perms = perms.filter((p) => READ_PERMISSIONS.includes(p));
  return perms.filter((p) => ALL_PERMISSIONS.includes(p));
}

export function permissionsForRole(role: GroupRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function roleHasPermission(role: GroupRole, permission: Permission): boolean {
  return permissionsForRole(role).includes(permission);
}

export const OFFICER_ROLES: readonly GroupRole[] = [GroupRole.CHAIRPERSON, GroupRole.VICE_CHAIRPERSON, GroupRole.TREASURER, GroupRole.SECRETARY, GroupRole.AUDITOR];

export function isOfficer(role: GroupRole): boolean {
  return role !== GroupRole.MEMBER;
}

/**
 * Platform roles govern the SaaS itself. None of them grants access to a
 * group's private finances — that needs a time-boxed, purpose-stated,
 * audited support grant approved by the group's chairperson.
 */
export const PlatformPermission = {
  PLATFORM_VIEW_STATS: 'platform.view_stats',
  PLATFORM_MANAGE_PLANS: 'platform.manage_plans',
  PLATFORM_MANAGE_ACCOUNTS: 'platform.manage_accounts',
  PLATFORM_VIEW_SECURITY: 'platform.view_security',
  PLATFORM_SUPPORT: 'platform.support',
  PLATFORM_MANAGE_ADMINS: 'platform.manage_admins',
  PLATFORM_CONFIGURE: 'platform.configure',
} as const;
export type PlatformPermission = (typeof PlatformPermission)[keyof typeof PlatformPermission];

const PP = PlatformPermission;

export const PLATFORM_ROLE_PERMISSIONS: Record<PlatformRole, readonly PlatformPermission[]> = {
  USER: [],
  SUPPORT: [PP.PLATFORM_SUPPORT],
  PLATFORM_ADMIN: [PP.PLATFORM_VIEW_STATS, PP.PLATFORM_MANAGE_PLANS, PP.PLATFORM_MANAGE_ACCOUNTS, PP.PLATFORM_SUPPORT],
  SUPER_ADMIN: Object.values(PP),
};

export function platformRoleHas(role: PlatformRole, permission: PlatformPermission): boolean {
  return PLATFORM_ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
