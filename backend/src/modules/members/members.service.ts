import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { GroupRole, InvitationRow, maskPhone, MemberRow, Permission, SPECIAL_ROLE_INFO, SpecialRole } from '@chamahub/shared';
import { AuditService } from '../../common/audit.service';
import { n } from '../../common/money';
import { isoDate } from '../../common/dates';
import { MembershipContext, RequestMeta } from '../../common/request';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { MemberFinanceService } from '../finance/member-finance.service';
import { ObligationsService } from '../finance/obligations.service';
import { readSettings } from '../finance/policies';
import { EntitlementService } from '../billing/entitlements.service';
import { OfficersService } from '../officers/officers.service';
import { NotificationsService, readPreferences } from '../notifications/notifications.service';

const INVITE_TTL_DAYS = 14;

@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly finance: MemberFinanceService,
    private readonly obligations: ObligationsService,
    private readonly notifications: NotificationsService,
    private readonly officers: OfficersService,
    private readonly entitlements: EntitlementService,
  ) {}

  async list(groupId: string, viewer: MembershipContext, opts: { status?: string; q?: string }): Promise<MemberRow[]> {
    const group = await this.prisma.group.findUniqueOrThrow({ where: { id: groupId }, select: { settings: true, createdById: true } });
    const settings = readSettings(group.settings);
    const memberships = await this.prisma.membership.findMany({
      where: {
        groupId,
        ...(opts.status ? { status: opts.status as never } : { status: { not: 'EXITED' } }),
        ...(opts.q ? { user: { OR: [{ fullName: { contains: opts.q, mode: 'insensitive' } }, { phone: { contains: opts.q } }] } } : {}),
      },
      include: { user: { select: { id: true, fullName: true, phone: true, preferences: true } } },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
    });
    const officerView = viewer.permissions.includes(Permission.MEMBERS_VIEW_FINANCIALS);
    const showFinancials = officerView || settings.membersCanViewMemberBalances;
    const balances = showFinancials ? await this.finance.balances(groupId, memberships.map((m) => m.id)) : null;
    return memberships.map((m) => {
      const self = m.id === viewer.id;
      const hide = readPreferences(m.user.preferences).hidePhoneFromMembers;
      return {
        membershipId: m.id,
        userId: m.user.id,
        fullName: m.user.fullName,
        phone: officerView || self || !hide ? m.user.phone : maskPhone(m.user.phone),
        role: m.role as GroupRole,
        specialRoles: m.specialRoles as SpecialRole[],
        isFounder: m.user.id === group.createdById,
        status: m.status,
        joinedAt: m.joinedAt.toISOString(),
        shares: m.shares,
        ...(balances || self ? { financials: balances?.get(m.id) ?? undefined } : {}),
      };
    });
  }

  async profile(groupId: string, membershipId: string, viewer: MembershipContext) {
    const self = viewer.id === membershipId;
    if (!self && !viewer.permissions.includes(Permission.MEMBERS_VIEW_FINANCIALS)) {
      throw new ForbiddenException("You can only view your own financial profile.");
    }
    const m = await this.prisma.membership.findFirst({
      where: { id: membershipId, groupId },
      include: { user: { select: { fullName: true, phone: true, email: true } } },
    });
    if (!m) throw new NotFoundException('Member not found');
    const [balances, obligations, loans, fines, payments] = await Promise.all([
      this.finance.balances(groupId, [m.id]),
      this.finance.obligationItems({ membershipIds: [m.id] }),
      this.prisma.loan.findMany({ where: { membershipId: m.id }, orderBy: { appliedAt: 'desc' }, select: { id: true, principalCents: true, totalInterestCents: true, status: true, appliedAt: true, disbursedAt: true } }),
      this.prisma.fine.findMany({ where: { membershipId: m.id }, orderBy: { issuedOn: 'desc' } }),
      this.prisma.payment.findMany({ where: { membershipId: m.id }, orderBy: { paidAt: 'desc' }, take: 100 }),
    ]);
    return {
      membershipId: m.id,
      fullName: m.user.fullName,
      phone: m.user.phone,
      email: m.user.email,
      role: m.role,
      status: m.status,
      shares: m.shares,
      joinedAt: m.joinedAt.toISOString(),
      balances: balances.get(m.id),
      obligations,
      loans: loans.map((l) => ({ id: l.id, principalCents: n(l.principalCents), interestCents: n(l.totalInterestCents), status: l.status, appliedAt: l.appliedAt.toISOString(), disbursedAt: isoDate(l.disbursedAt) })),
      fines: fines.map((f) => ({ id: f.id, amountCents: n(f.amountCents), paidCents: n(f.paidCents), reason: f.reason, status: f.status, issuedOn: isoDate(f.issuedOn) })),
      payments: payments.map((p) => ({ id: p.id, amountCents: n(p.amountCents), purpose: p.purpose, method: p.method, status: p.status, reference: p.reference, paidAt: isoDate(p.paidAt) })),
    };
  }

  /** A group that requires a Joint Signatory must keep at least one, or approvals could never complete. */
  private async assertAnotherSignatory(groupId: string, membershipId: string) {
    const group = await this.prisma.group.findUniqueOrThrow({ where: { id: groupId }, select: { settings: true } });
    if (!readSettings(group.settings).requireJointSignatory) return;
    const others = await this.prisma.membership.count({ where: { groupId, status: 'ACTIVE', id: { not: membershipId }, specialRoles: { has: 'JOINT_SIGNATORY' } } });
    if (!others) throw new UnprocessableEntityException('This is the group’s only Joint Signatory, and the group requires one. Appoint another first, or turn the requirement off in settings.');
  }

  private async chairCount(groupId: string) {
    return this.prisma.membership.count({ where: { groupId, role: 'CHAIRPERSON', status: 'ACTIVE' } });
  }

  async changeRole(groupId: string, membershipId: string, role: GroupRole, reason: string, actor: MembershipContext, meta: RequestMeta) {
    const target = await this.prisma.membership.findFirst({ where: { id: membershipId, groupId } });
    if (!target) throw new NotFoundException('Member not found');
    if (target.status !== 'ACTIVE') throw new UnprocessableEntityException('Only active members can hold roles');
    if (target.role === 'CHAIRPERSON' && role !== 'CHAIRPERSON' && (await this.chairCount(groupId)) <= 1) {
      throw new UnprocessableEntityException('Assign another chairperson before changing this role. A group always needs one.');
    }
    if (role === 'CHAIRPERSON' && actor.role !== 'CHAIRPERSON') {
      throw new ForbiddenException('Only a chairperson can appoint a chairperson.');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.membership.update({ where: { id: membershipId }, data: { role } });
      // The outgoing and incoming officer get a permanent record of what changed hands.
      await this.officers.recordRoleChange(tx, groupId, membershipId, target.role, role, actor.userId);
      await this.audit.log({ groupId, actorUserId: actor.userId, action: 'member.role_changed', entityType: 'Membership', entityId: membershipId, before: { role: target.role }, after: { role }, reason, meta }, tx);
      return u;
    });
    return { membershipId: updated.id, role: updated.role };
  }

  async changeStatus(groupId: string, membershipId: string, status: 'ACTIVE' | 'SUSPENDED' | 'EXITED', reason: string, actor: MembershipContext, meta: RequestMeta) {
    const target = await this.prisma.membership.findFirst({ where: { id: membershipId, groupId } });
    if (!target) throw new NotFoundException('Member not found');
    if (target.id === actor.id) throw new ForbiddenException('You cannot change your own membership status.');
    if (status !== 'ACTIVE' && target.role === 'CHAIRPERSON' && (await this.chairCount(groupId)) <= 1) {
      throw new UnprocessableEntityException('Assign another chairperson first.');
    }
    if (status !== 'ACTIVE' && target.specialRoles.includes('JOINT_SIGNATORY')) await this.assertAnotherSignatory(groupId, membershipId);
    if (status === 'EXITED') {
      const loanBalance = (await this.finance.loanBalances(groupId, [membershipId])).get(membershipId) ?? 0;
      if (loanBalance > 0) throw new UnprocessableEntityException('This member has an outstanding loan. Settle it before exiting the member.');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.membership.update({ where: { id: membershipId }, data: { status, exitedAt: status === 'EXITED' ? new Date() : null, role: status === 'EXITED' ? 'MEMBER' : undefined } });
      await this.audit.log({ groupId, actorUserId: actor.userId, action: 'member.status_changed', entityType: 'Membership', entityId: membershipId, before: { status: target.status }, after: { status }, reason, meta }, tx);
    });
    return { membershipId, status };
  }

  /** Adds optional roles (loan committee, payout approver, joint signatory, read-only) to a membership. */
  async setSpecialRoles(groupId: string, membershipId: string, specialRoles: SpecialRole[], reason: string, actor: MembershipContext, meta: RequestMeta) {
    const target = await this.prisma.membership.findFirst({ where: { id: membershipId, groupId } });
    if (!target) throw new NotFoundException('Member not found');
    if (target.status !== 'ACTIVE') throw new UnprocessableEntityException('Only active members can hold roles');
    const roles = [...new Set(specialRoles)];
    if (roles.includes('READ_ONLY') && roles.length > 1) throw new UnprocessableEntityException('A read-only member cannot also hold approval roles');
    if (roles.includes('READ_ONLY') && target.role !== 'MEMBER') throw new UnprocessableEntityException('Only ordinary members can be made read-only; change their role first');
    if (target.specialRoles.includes('JOINT_SIGNATORY') && !roles.includes('JOINT_SIGNATORY')) await this.assertAnotherSignatory(groupId, membershipId);
    await this.prisma.$transaction(async (tx) => {
      await tx.membership.update({ where: { id: membershipId }, data: { specialRoles: roles } });
      await this.audit.log({ groupId, actorUserId: actor.userId, action: 'member.special_roles_changed', entityType: 'Membership', entityId: membershipId, before: { specialRoles: target.specialRoles }, after: { specialRoles: roles }, reason, meta }, tx);
    });
    if (roles.some((r) => !target.specialRoles.includes(r))) {
      await this.notifications.notify([target.userId], { groupId, type: 'ANNOUNCEMENT', title: 'Your role was updated', body: `You are now: ${roles.map((r) => SPECIAL_ROLE_INFO[r].label).join(', ')}.` });
    }
    return { membershipId, specialRoles: roles };
  }

  async setShares(groupId: string, membershipId: string, shares: number, reason: string, actor: MembershipContext, meta: RequestMeta) {
    const target = await this.prisma.membership.findFirst({ where: { id: membershipId, groupId } });
    if (!target) throw new NotFoundException('Member not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.membership.update({ where: { id: membershipId }, data: { shares } });
      await this.audit.log({ groupId, actorUserId: actor.userId, action: 'member.shares_changed', entityType: 'Membership', entityId: membershipId, before: { shares: target.shares }, after: { shares }, reason, meta }, tx);
    });
    return { membershipId, shares };
  }

  /* ---------- invitations ---------- */

  async invite(groupId: string, input: { phone: string; fullName?: string; role: GroupRole }, actor: MembershipContext, meta: RequestMeta) {
    if (input.role !== 'MEMBER' && !actor.permissions.includes(Permission.ROLES_ASSIGN)) {
      throw new ForbiddenException('Only officers who can assign roles may invite officers.');
    }
    if (input.role === 'CHAIRPERSON' && actor.role !== 'CHAIRPERSON') throw new ForbiddenException('Only a chairperson can invite a chairperson.');
    const existingUser = await this.prisma.user.findUnique({ where: { phone: input.phone }, select: { id: true } });
    if (existingUser) {
      const m = await this.prisma.membership.findUnique({ where: { groupId_userId: { groupId, userId: existingUser.id } } });
      if (m && m.status !== 'EXITED') throw new ConflictException('This person is already a member of the group.');
    }
    const pending = await this.prisma.invitation.findFirst({ where: { groupId, phone: input.phone, status: 'PENDING', expiresAt: { gt: new Date() } } });
    if (pending) throw new ConflictException('An invitation is already pending for this number.');
    // The plan's member limit counts pending invitations, so accepted ones never fail later.
    await this.entitlements.assertCanAddMembers(groupId, 1, { countPendingInvitations: true });
    const group = await this.prisma.group.findUniqueOrThrow({ where: { id: groupId }, select: { name: true } });
    const inv = await this.prisma.invitation.create({
      data: { groupId, phone: input.phone, fullName: input.fullName ?? null, role: input.role, invitedById: actor.userId, expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000) },
    });
    await this.audit.log({ groupId, actorUserId: actor.userId, action: 'invitation.created', entityType: 'Invitation', entityId: inv.id, after: { phone: input.phone, role: input.role }, meta });
    if (existingUser) {
      await this.notifications.notify([existingUser.id], { groupId, type: 'INVITATION', title: `Invitation to ${group.name}`, body: 'Open ChamaHub to accept or decline.', data: { invitationId: inv.id } });
    }
    return this.invitationRow(inv.id);
  }

  async invitationRow(id: string): Promise<InvitationRow> {
    const i = await this.prisma.invitation.findUniqueOrThrow({ where: { id }, include: { group: { select: { name: true } }, invitedBy: { select: { fullName: true } } } });
    return {
      id: i.id,
      groupId: i.groupId,
      groupName: i.group.name,
      phone: i.phone,
      fullName: i.fullName,
      role: i.role as GroupRole,
      status: i.expiresAt < new Date() && i.status === 'PENDING' ? 'EXPIRED' : i.status,
      invitedByName: i.invitedBy.fullName,
      expiresAt: i.expiresAt.toISOString(),
      createdAt: i.createdAt.toISOString(),
    };
  }

  async groupInvitations(groupId: string) {
    const rows = await this.prisma.invitation.findMany({ where: { groupId }, orderBy: { createdAt: 'desc' }, take: 200, select: { id: true } });
    return Promise.all(rows.map((r) => this.invitationRow(r.id)));
  }

  async revokeInvitation(groupId: string, id: string, actor: MembershipContext, meta: RequestMeta) {
    const r = await this.prisma.invitation.updateMany({ where: { id, groupId, status: 'PENDING' }, data: { status: 'REVOKED' } });
    if (r.count !== 1) throw new NotFoundException('Pending invitation not found');
    await this.audit.log({ groupId, actorUserId: actor.userId, action: 'invitation.revoked', entityType: 'Invitation', entityId: id, meta });
    return { ok: true };
  }

  async myInvitations(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { phone: true } });
    const rows = await this.prisma.invitation.findMany({ where: { phone: user.phone, status: 'PENDING', expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    return Promise.all(rows.map((r) => this.invitationRow(r.id)));
  }

  async respond(userId: string, invitationId: string, accept: boolean, meta: RequestMeta) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { phone: true } });
    const inv = await this.prisma.invitation.findUnique({ where: { id: invitationId } });
    // Invitations are bound to the verified phone number they were sent to.
    if (!inv || inv.phone !== user.phone) throw new NotFoundException('Invitation not found');
    if (inv.status !== 'PENDING' || inv.expiresAt < new Date()) throw new UnprocessableEntityException('This invitation is no longer valid.');
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.invitation.updateMany({ where: { id: inv.id, status: 'PENDING' }, data: { status: accept ? 'ACCEPTED' : 'DECLINED', respondedAt: new Date() } });
      if (claimed.count !== 1) throw new ConflictException('Invitation already answered');
      if (accept) await this.join(tx, inv.groupId, userId, inv.role as GroupRole);
      await this.audit.log({ groupId: inv.groupId, actorUserId: userId, action: accept ? 'invitation.accepted' : 'invitation.declined', entityType: 'Invitation', entityId: inv.id, meta }, tx);
    });
    if (accept) await this.obligations.ensureForGroup(inv.groupId);
    return { ok: true, groupId: inv.groupId };
  }

  async joinByCode(userId: string, code: string, meta: RequestMeta) {
    const group = await this.prisma.group.findUnique({ where: { inviteCode: code.toUpperCase() }, select: { id: true, name: true, status: true } });
    if (!group || group.status !== 'ACTIVE') throw new BadRequestException('That group code is not valid.');
    await this.prisma.$transaction(async (tx) => {
      await this.join(tx, group.id, userId, 'MEMBER');
      await this.audit.log({ groupId: group.id, actorUserId: userId, action: 'member.joined_with_code', entityType: 'Group', entityId: group.id, meta }, tx);
    });
    await this.obligations.ensureForGroup(group.id);
    return { ok: true, groupId: group.id, name: group.name };
  }

  private async join(tx: Tx, groupId: string, userId: string, role: GroupRole) {
    const existing = await tx.membership.findUnique({ where: { groupId_userId: { groupId, userId } } });
    if (existing && existing.status !== 'EXITED') throw new ConflictException('You are already a member of this group.');
    await this.entitlements.assertCanAddMembers(groupId, 1, { countPendingInvitations: false, tx });
    if (existing) {
      return tx.membership.update({ where: { id: existing.id }, data: { status: 'ACTIVE', role, joinedAt: new Date(), exitedAt: null } });
    }
    return tx.membership.create({ data: { groupId, userId, role } });
  }
}
