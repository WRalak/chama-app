import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ALL_PLATFORM_PERMISSIONS, InviteResult, PlatformPermission, PlatformRoleRow, PRIVILEGED_PLATFORM_PERMISSIONS, StaffRow } from '@chamahub/shared';
import { env } from '../../config/env';
import { paginate, skipTake } from '../../common/pagination';
import { RequestMeta, StaffContext } from '../../common/request';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformAuditService } from '../platform-auth/platform-audit.service';
import { inviteEmail, PlatformAuthService } from '../platform-auth/platform-auth.service';
import { newToken, sha256 } from '../platform-auth/staff-crypto';
import { StaffMailerService } from '../platform-auth/staff-mailer.service';
import { activeOwnerCount, OWNER_ROLE, resolveStaff } from '../platform-auth/staff-roles';

const PRIVILEGED = new Set<string>(PRIVILEGED_PLATFORM_PERMISSIONS);
const KNOWN = new Set<string>(ALL_PLATFORM_PERMISSIONS);

const accountInclude = {
  roles: { include: { role: { select: { code: true, name: true } } } },
  permissions: { select: { permission: true } },
  invitations: { orderBy: { createdAt: 'desc' as const }, take: 1 },
  _count: { select: { assignedCases: { where: { status: { notIn: ['RESOLVED', 'CLOSED'] as ('RESOLVED' | 'CLOSED')[] } } } } },
} satisfies Prisma.PlatformAccountInclude;
type AccountWithAll = Prisma.PlatformAccountGetPayload<{ include: typeof accountInclude }>;

export interface StaffListQuery {
  page: number;
  pageSize: number;
  q?: string;
  status?: 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
  role?: string;
  sort?: 'name' | 'created' | 'lastLogin';
}

/**
 * Staff and role administration. The rules that stop privilege escalation live here, on the server:
 *  - nobody grants a permission they do not hold themselves;
 *  - privileged permissions (and managing accounts that hold them) need platform.manage_admins;
 *  - only an owner can make, change or remove an owner, and the last active owner cannot be removed;
 *  - nobody changes their own access, status or sessions through these routes.
 */
@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
    private readonly mailer: StaffMailerService,
    private readonly auth: PlatformAuthService,
  ) {}

  /* ---------------- reading ---------------- */

  async list(q: StaffListQuery) {
    const where: Prisma.PlatformAccountWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.role ? { roles: { some: { role: { code: q.role } } } } : {}),
      ...(q.q ? { OR: [{ fullName: { contains: q.q, mode: 'insensitive' } }, { email: { contains: q.q.toLowerCase() } }] } : {}),
    };
    const orderBy: Prisma.PlatformAccountOrderByWithRelationInput =
      q.sort === 'name' ? { fullName: 'asc' } : q.sort === 'lastLogin' ? { lastLoginAt: { sort: 'desc', nulls: 'last' } } : { createdAt: 'desc' };
    const [rows, total] = await Promise.all([
      this.prisma.platformAccount.findMany({ where, include: accountInclude, orderBy, ...skipTake(q.page, q.pageSize) }),
      this.prisma.platformAccount.count({ where }),
    ]);
    const creators = await this.names(rows.map((r) => r.createdById));
    return paginate(rows.map((r) => this.row(r, creators)), total, q.page, q.pageSize);
  }

  async get(id: string): Promise<StaffRow> {
    const a = await this.prisma.platformAccount.findUnique({ where: { id }, include: accountInclude });
    if (!a) throw new NotFoundException('Staff account not found');
    return this.row(a, await this.names([a.createdById]));
  }

  async activity(id: string, page: number, pageSize: number) {
    await this.get(id);
    const where: Prisma.PlatformAuditLogWhereInput = { OR: [{ actorAccountId: id }, { targetType: 'PlatformAccount', targetId: id }] };
    const [rows, total] = await Promise.all([
      this.prisma.platformAuditLog.findMany({ where, orderBy: { createdAt: 'desc' }, ...skipTake(page, pageSize) }),
      this.prisma.platformAuditLog.count({ where }),
    ]);
    const actors = await this.names(rows.map((r) => r.actorAccountId));
    return paginate(rows.map((r) => ({ id: r.id, at: r.createdAt.toISOString(), actor: r.actorAccountId ? (actors.get(r.actorAccountId) ?? 'Staff') : r.actorLabel, action: r.action, outcome: r.outcome, reason: r.reason, targetType: r.targetType, targetId: r.targetId })), total, page, pageSize);
  }

  /* ---------------- inviting ---------------- */

  async invite(actor: StaffContext, input: { fullName: string; email: string; roleCodes: string[]; extraPermissions: PlatformPermission[]; team?: string; expiresAt?: string }, meta: RequestMeta): Promise<InviteResult> {
    const roles = await this.loadRoles(input.roleCodes);
    this.assertCanGrant(actor, roles, input.extraPermissions);
    if (input.expiresAt && new Date(input.expiresAt) <= new Date()) throw new BadRequestException('The end date must be in the future.');
    if (await this.prisma.platformAccount.findUnique({ where: { email: input.email }, select: { id: true } })) {
      throw new ConflictException('A staff account with this e-mail already exists.');
    }
    const token = newToken();
    const hours = env().PLATFORM_INVITE_TTL_HOURS;
    const account = await this.prisma.$transaction(async (tx) => {
      const a = await tx.platformAccount.create({
        data: {
          email: input.email,
          fullName: input.fullName,
          team: input.team ?? null,
          status: 'INVITED',
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          createdById: actor.accountId,
          roles: { create: roles.map((r) => ({ roleId: r.id, grantedById: actor.accountId })) },
          permissions: { create: input.extraPermissions.map((permission) => ({ permission, grantedById: actor.accountId })) },
        },
      });
      await tx.platformInvitation.create({ data: { accountId: a.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + hours * 3_600_000), createdById: actor.accountId } });
      await this.audit.log({ actorAccountId: actor.accountId, action: 'platform.staff_invited', targetType: 'PlatformAccount', targetId: a.id, after: { email: a.email, roles: input.roleCodes, extraPermissions: input.extraPermissions, expiresAt: input.expiresAt ?? null }, meta }, tx);
      return a;
    });
    return { account: await this.get(account.id), ...(await this.deliverInvite(actor, account.id, account.email, account.fullName, token, hours, meta)) };
  }

  async resendInvite(actor: StaffContext, id: string, meta: RequestMeta) {
    const target = await this.assertCanManage(actor, id);
    if (target.status !== 'INVITED') throw new BadRequestException('This person has already set up their account.');
    const token = newToken();
    const hours = env().PLATFORM_INVITE_TTL_HOURS;
    await this.prisma.$transaction([
      this.prisma.platformInvitation.updateMany({ where: { accountId: id, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } }),
      this.prisma.platformInvitation.create({ data: { accountId: id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + hours * 3_600_000), createdById: actor.accountId } }),
    ]);
    await this.audit.log({ actorAccountId: actor.accountId, action: 'platform.invitation_resent', targetType: 'PlatformAccount', targetId: id, meta });
    return { account: await this.get(id), ...(await this.deliverInvite(actor, id, target.email, target.fullName, token, hours, meta)) };
  }

  /**
   * Sends the link by e-mail. If e-mail is not working, the link is returned once to the person
   * who created it (it is not stored anywhere readable and never logged) so they can pass it on
   * securely; resending revokes it.
   */
  private async deliverInvite(actor: StaffContext, accountId: string, email: string, name: string, token: string, hours: number, meta: RequestMeta): Promise<Omit<InviteResult, 'account'>> {
    const url = this.mailer.link('/platform/accept-invite', token);
    const sent = await this.mailer.send(email, 'You are invited to the ChamaHub staff portal', inviteEmail(name, actor.fullName, url, hours));
    if (sent.sent) return { delivery: { sent: true } };
    await this.audit.log({ actorAccountId: actor.accountId, action: 'platform.invitation_email_failed', outcome: 'FAILURE', targetType: 'PlatformAccount', targetId: accountId, reason: sent.error, meta });
    return { delivery: sent, inviteUrl: url };
  }

  /* ---------------- changing accounts ---------------- */

  async update(actor: StaffContext, id: string, input: { fullName?: string; team?: string | null; expiresAt?: string | null }, meta: RequestMeta) {
    const target = await this.assertCanManage(actor, id);
    if (input.expiresAt && new Date(input.expiresAt) <= new Date()) throw new BadRequestException('The end date must be in the future.');
    if (input.expiresAt && (await this.isLastOwner(id))) throw new ForbiddenException('The last active owner cannot have an end date.');
    const after = await this.prisma.platformAccount.update({
      where: { id },
      data: { fullName: input.fullName, team: input.team === undefined ? undefined : input.team, expiresAt: input.expiresAt === undefined ? undefined : input.expiresAt ? new Date(input.expiresAt) : null },
    });
    await this.audit.log({ actorAccountId: actor.accountId, action: 'platform.staff_updated', targetType: 'PlatformAccount', targetId: id, before: { fullName: target.fullName, team: target.team, expiresAt: target.expiresAt }, after: { fullName: after.fullName, team: after.team, expiresAt: after.expiresAt }, meta });
    return this.get(id);
  }

  async setAccess(actor: StaffContext, id: string, input: { roleCodes: string[]; extraPermissions: PlatformPermission[]; reason: string }, meta: RequestMeta) {
    const target = await this.assertCanManage(actor, id);
    const roles = await this.loadRoles(input.roleCodes);
    this.assertCanGrant(actor, roles, input.extraPermissions);
    const before = await resolveStaff(this.prisma, id);
    const losingOwner = before.isOwner && !roles.some((r) => r.code === OWNER_ROLE);
    if (losingOwner && target.status === 'ACTIVE' && (await activeOwnerCount(this.prisma, id)) === 0) {
      throw new ForbiddenException('This is the last active owner. Make someone else an owner first.');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.platformAccountRole.deleteMany({ where: { accountId: id } });
      await tx.platformAccountPermission.deleteMany({ where: { accountId: id } });
      await tx.platformAccountRole.createMany({ data: roles.map((r) => ({ accountId: id, roleId: r.id, grantedById: actor.accountId })) });
      await tx.platformAccountPermission.createMany({ data: input.extraPermissions.map((permission) => ({ accountId: id, permission, grantedById: actor.accountId })) });
      // Guard against a concurrent change removing the last owner.
      if (losingOwner && (await activeOwnerCount(tx)) === 0) throw new ForbiddenException('This is the last active owner. Make someone else an owner first.');
      await this.audit.log({ actorAccountId: actor.accountId, action: 'platform.staff_access_changed', targetType: 'PlatformAccount', targetId: id, reason: input.reason, before: { roles: before.roles.map((r) => r.code), permissions: before.permissions }, after: { roles: input.roleCodes, extraPermissions: input.extraPermissions }, meta }, tx);
    });
    return this.get(id);
  }

  async setStatus(actor: StaffContext, id: string, status: 'SUSPENDED' | 'ACTIVE' | 'DEACTIVATED', reason: string, meta: RequestMeta) {
    const target = await this.assertCanManage(actor, id);
    if (status === 'ACTIVE') {
      if (target.status !== 'SUSPENDED') throw new BadRequestException('Only a suspended account can be reactivated.');
    } else {
      if (target.status === 'DEACTIVATED') throw new BadRequestException('This account is already deactivated.');
      if (target.status === status) throw new BadRequestException('Nothing to change.');
    }
    const wasOwner = (await resolveStaff(this.prisma, id)).isOwner;
    await this.prisma.$transaction(async (tx) => {
      await tx.platformAccount.update({ where: { id }, data: { status: status === 'ACTIVE' && !target.passwordHash ? 'INVITED' : status } });
      if (status !== 'ACTIVE') {
        await tx.platformSession.updateMany({ where: { accountId: id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: `account_${status.toLowerCase()}` } });
        await tx.platformInvitation.updateMany({ where: { accountId: id, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
        await tx.platformPasswordReset.updateMany({ where: { accountId: id, usedAt: null }, data: { usedAt: new Date() } });
        if (wasOwner && (await activeOwnerCount(tx)) === 0) throw new ForbiddenException('This is the last active owner and cannot be suspended or deactivated.');
      }
      const action = status === 'ACTIVE' ? 'platform.staff_reactivated' : status === 'SUSPENDED' ? 'platform.staff_suspended' : 'platform.staff_deactivated';
      await this.audit.log({ actorAccountId: actor.accountId, action, targetType: 'PlatformAccount', targetId: id, reason, before: { status: target.status }, after: { status }, meta }, tx);
    });
    return this.get(id);
  }

  async revokeSessions(actor: StaffContext, id: string, reason: string, meta: RequestMeta) {
    await this.assertCanManage(actor, id);
    const r = await this.prisma.platformSession.updateMany({ where: { accountId: id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'revoked_by_admin' } });
    await this.audit.log({ actorAccountId: actor.accountId, action: 'platform.staff_sessions_revoked', targetType: 'PlatformAccount', targetId: id, reason, after: { revoked: r.count }, meta });
    return { revoked: r.count };
  }

  /**
   * For a lost or replaced phone: removes the person's two-step setup and signs them out. They
   * must set it up again (and get new recovery codes) at their next sign-in.
   */
  async resetMfa(actor: StaffContext, id: string, reason: string, meta: RequestMeta) {
    const target = await this.assertCanManage(actor, id);
    if (!target.mfaEnabled) throw new BadRequestException('Two-step sign-in is not on for this account.');
    await this.prisma.$transaction(async (tx) => {
      await this.auth.clearMfa(id, tx);
      await tx.platformSession.updateMany({ where: { accountId: id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'mfa_reset' } });
      await this.audit.log({ actorAccountId: actor.accountId, action: 'platform.staff_mfa_reset', targetType: 'PlatformAccount', targetId: id, reason, meta }, tx);
    });
    return this.get(id);
  }

  /** Starts a reset for someone else. The admin never sees or sets the password; the link goes to the account's e-mail. */
  async sendPasswordReset(actor: StaffContext, id: string, reason: string, meta: RequestMeta) {
    const target = await this.assertCanManage(actor, id);
    if (target.status !== 'ACTIVE') throw new BadRequestException('Only active accounts can reset a password. Resend the invitation instead.');
    const { url } = await this.auth.issueReset(id);
    const sent = await this.mailer.send(target.email, 'Reset your ChamaHub staff password', `Hello ${target.fullName},\n\n${actor.fullName} started a password reset for your ChamaHub staff account.\nOpen this link to choose a new password. It works once and expires in ${env().PLATFORM_RESET_TTL_MINUTES} minutes:\n${url}\n`);
    await this.audit.log({ actorAccountId: actor.accountId, action: 'platform.staff_password_reset_sent', outcome: sent.sent ? 'SUCCESS' : 'FAILURE', targetType: 'PlatformAccount', targetId: id, reason: sent.sent ? reason : `${reason} (e-mail not delivered)`, meta });
    return sent.sent ? { delivery: { sent: true } } : { delivery: sent, resetUrl: url };
  }

  /* ---------------- roles ---------------- */

  async roles(): Promise<PlatformRoleRow[]> {
    const rows = await this.prisma.platformStaffRole.findMany({ include: { permissions: true, _count: { select: { accounts: true } } }, orderBy: [{ system: 'desc' }, { name: 'asc' }] });
    return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, description: r.description, system: r.system, permissions: r.permissions.map((p) => p.permission).filter((p) => KNOWN.has(p)).sort() as PlatformPermission[], accounts: r._count.accounts }));
  }

  async upsertRole(actor: StaffContext, input: { code: string; name: string; description?: string; permissions: PlatformPermission[] }, meta: RequestMeta) {
    if (input.code === OWNER_ROLE) throw new ForbiddenException('The owner role always has every permission and cannot be edited.');
    const missing = input.permissions.filter((p) => !actor.permissions.includes(p));
    if (missing.length) throw new ForbiddenException(`You cannot put permissions you do not have into a role: ${missing.join(', ')}`);
    const existing = await this.prisma.platformStaffRole.findUnique({ where: { code: input.code }, include: { permissions: true } });
    if (existing && !actor.isOwner) {
      // Changing a role changes everyone who holds it; a non-owner must not be able to alter a role that grants more than they hold.
      const beyond = existing.permissions.map((p) => p.permission).filter((p) => !actor.permissions.includes(p as PlatformPermission));
      if (beyond.length) throw new ForbiddenException('This role grants permissions you do not hold. Ask an owner to change it.');
    }
    const role = await this.prisma.$transaction(async (tx) => {
      const r = existing
        ? await tx.platformStaffRole.update({ where: { id: existing.id }, data: { name: input.name, description: input.description ?? null } })
        : await tx.platformStaffRole.create({ data: { code: input.code, name: input.name, description: input.description ?? null } });
      await tx.platformRolePermission.deleteMany({ where: { roleId: r.id } });
      await tx.platformRolePermission.createMany({ data: input.permissions.map((permission) => ({ roleId: r.id, permission })) });
      await this.audit.log({ actorAccountId: actor.accountId, action: existing ? 'platform.role_updated' : 'platform.role_created', targetType: 'PlatformRole', targetId: r.code, before: existing ? { name: existing.name, permissions: existing.permissions.map((p) => p.permission) } : null, after: { name: input.name, permissions: input.permissions }, meta }, tx);
      return r;
    });
    return (await this.roles()).find((r) => r.id === role.id)!;
  }

  async deleteRole(actor: StaffContext, code: string, meta: RequestMeta) {
    const role = await this.prisma.platformStaffRole.findUnique({ where: { code }, include: { _count: { select: { accounts: true } } } });
    if (!role) throw new NotFoundException('Role not found');
    if (role.system) throw new ForbiddenException('Built-in roles cannot be deleted.');
    if (role._count.accounts) throw new ConflictException('Move everyone off this role before deleting it.');
    await this.prisma.platformStaffRole.delete({ where: { id: role.id } });
    await this.audit.log({ actorAccountId: actor.accountId, action: 'platform.role_deleted', targetType: 'PlatformRole', targetId: code, meta });
    return { ok: true };
  }

  /* ---------------- rules ---------------- */

  private async loadRoles(codes: string[]) {
    const unique = [...new Set(codes)];
    const roles = await this.prisma.platformStaffRole.findMany({ where: { code: { in: unique } }, include: { permissions: true } });
    if (roles.length !== unique.length) throw new BadRequestException('One or more roles do not exist.');
    return roles;
  }

  private assertCanGrant(actor: StaffContext, roles: { code: string; permissions: { permission: string }[] }[], extras: PlatformPermission[]) {
    if (roles.some((r) => r.code === OWNER_ROLE) && !actor.isOwner) throw new ForbiddenException('Only an owner can make someone an owner.');
    const granted = new Set<string>([...extras, ...roles.flatMap((r) => r.permissions.map((p) => p.permission))]);
    const missing = [...granted].filter((p) => !actor.permissions.includes(p as PlatformPermission));
    if (missing.length) throw new ForbiddenException(`You cannot grant permissions you do not have: ${missing.join(', ')}`);
    if ([...granted].some((p) => PRIVILEGED.has(p)) && !actor.permissions.includes('platform.manage_admins')) {
      throw new ForbiddenException('Granting administrative or financial permissions needs the "Manage administrators" permission.');
    }
  }

  /** Loads the target and checks the actor may manage it. */
  private async assertCanManage(actor: StaffContext, id: string) {
    if (id === actor.accountId) throw new ForbiddenException('You cannot change your own access or status. Ask another administrator.');
    const target = await this.prisma.platformAccount.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('Staff account not found');
    const t = await resolveStaff(this.prisma, id);
    if (t.isOwner && !actor.isOwner) throw new ForbiddenException('Only an owner can change an owner account.');
    if (t.permissions.some((p) => PRIVILEGED.has(p)) && !actor.permissions.includes('platform.manage_admins')) {
      throw new ForbiddenException('This account has administrative permissions; changing it needs the "Manage administrators" permission.');
    }
    return target;
  }

  private async isLastOwner(id: string) {
    const t = await resolveStaff(this.prisma, id);
    return t.isOwner && (await activeOwnerCount(this.prisma, id)) === 0;
  }

  private row(a: AccountWithAll, creators: Map<string, string>): StaffRow {
    const inv = a.invitations[0];
    const invitation = a.status !== 'INVITED' ? (inv?.acceptedAt ? 'ACCEPTED' : null) : !inv || inv.revokedAt || inv.expiresAt < new Date() ? 'EXPIRED' : 'PENDING';
    return {
      id: a.id,
      fullName: a.fullName,
      email: a.email,
      team: a.team,
      status: a.status,
      invitation,
      roles: a.roles.map((r) => ({ code: r.role.code, name: r.role.name })),
      extraPermissions: a.permissions.map((p) => p.permission).filter((p) => KNOWN.has(p)) as PlatformPermission[],
      mfaEnabled: a.mfaEnabled,
      openCases: a._count.assignedCases,
      lastLoginAt: a.lastLoginAt?.toISOString() ?? null,
      expiresAt: a.expiresAt?.toISOString() ?? null,
      createdAt: a.createdAt.toISOString(),
      createdBy: a.createdById ? (creators.get(a.createdById) ?? null) : null,
    };
  }

  async names(ids: (string | null | undefined)[]) {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return new Map<string, string>();
    const rows = await this.prisma.platformAccount.findMany({ where: { id: { in: unique } }, select: { id: true, fullName: true } });
    return new Map(rows.map((r) => [r.id, r.fullName]));
  }
}
