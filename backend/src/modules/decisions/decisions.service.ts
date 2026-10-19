import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FindingRow, Permission, ProposalRow, resolvePermissions, RolePolicy, SpecialRole, GroupRole } from '@chamahub/shared';
import { AuditService } from '../../common/audit.service';
import { MembershipContext, RequestMeta } from '../../common/request';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

type Choice = 'YES' | 'NO' | 'ABSTAIN';

/** Called when a vote about a subject (e.g. a rotation schedule) closes. */
export type OutcomeHandler = (p: { id: string; groupId: string; subjectId: string; status: 'PASSED' | 'FAILED' | 'CANCELLED' }) => Promise<void>;

/**
 * Group decisions (member votes) and audit findings. Ballots are final and
 * never attributed in API responses: only tallies and the caller's own
 * choice are returned.
 */
@Injectable()
export class DecisionsService {
  private readonly logger = new Logger('Decisions');
  private readonly handlers = new Map<string, OutcomeHandler>();

  /** Lets another module act on the result of votes about its subjects. */
  onOutcome(subjectType: string, handler: OutcomeHandler) {
    this.handlers.set(subjectType, handler);
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Active members whose resolved permissions include votes.cast. */
  private async eligibleMembers(groupId: string) {
    const group = await this.prisma.group.findUniqueOrThrow({ where: { id: groupId }, select: { rolePolicy: true } });
    const members = await this.prisma.membership.findMany({ where: { groupId, status: 'ACTIVE' }, select: { id: true, userId: true, role: true, specialRoles: true } });
    return members.filter((m) => resolvePermissions(m.role as GroupRole, group.rolePolicy as RolePolicy | null, m.specialRoles as SpecialRole[]).includes(Permission.VOTES_CAST));
  }

  async createProposal(groupId: string, input: { title: string; description: string; closesAt: string; quorumPercent: number; passPercent: number; subjectType?: string; subjectId?: string }, actor: MembershipContext, meta: RequestMeta) {
    const closesAt = new Date(input.closesAt);
    if (closesAt.getTime() < Date.now() + 60 * 60_000) throw new UnprocessableEntityException('Give members at least one hour to vote');
    const eligible = await this.eligibleMembers(groupId);
    if (eligible.length === 0) throw new UnprocessableEntityException('No members are eligible to vote');
    const p = await this.prisma.proposal.create({
      data: { groupId, title: input.title, description: input.description, closesAt, quorumPercent: input.quorumPercent, passPercent: input.passPercent, eligibleCount: eligible.length, createdById: actor.userId, subjectType: input.subjectType ?? null, subjectId: input.subjectId ?? null },
    });
    await this.audit.log({ groupId, actorUserId: actor.userId, action: 'vote.opened', entityType: 'Proposal', entityId: p.id, after: input, meta });
    await this.notifications.notify(eligible.map((m) => m.userId), { groupId, type: 'ANNOUNCEMENT', title: `Vote: ${input.title}`, body: 'Open ChamaHub to cast your vote before it closes.', data: { proposalId: p.id } });
    return this.proposal(groupId, p.id, actor);
  }

  private tallyOf(votes: { choice: Choice }[]) {
    const t = { YES: 0, NO: 0, ABSTAIN: 0 };
    for (const v of votes) t[v.choice]++;
    return t;
  }

  private outcome(p: { eligibleCount: number; quorumPercent: number; passPercent: number }, tally: { YES: number; NO: number; ABSTAIN: number }) {
    const turnout = tally.YES + tally.NO + tally.ABSTAIN;
    const quorumMet = turnout * 100 >= p.quorumPercent * p.eligibleCount;
    const decisive = tally.YES + tally.NO;
    const passed = quorumMet && decisive > 0 && tally.YES * 100 >= p.passPercent * decisive && tally.YES > tally.NO;
    return { turnout, quorumMet, passed };
  }

  async proposals(groupId: string, viewer: MembershipContext): Promise<ProposalRow[]> {
    await this.closeExpired(groupId);
    const rows = await this.prisma.proposal.findMany({ where: { groupId }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true } });
    return Promise.all(rows.map((r) => this.proposal(groupId, r.id, viewer)));
  }

  async proposal(groupId: string, id: string, viewer: MembershipContext): Promise<ProposalRow> {
    const p = await this.prisma.proposal.findFirst({ where: { id, groupId }, include: { votes: { select: { choice: true, membershipId: true } } } });
    if (!p) throw new NotFoundException('Vote not found');
    const creator = await this.prisma.user.findUnique({ where: { id: p.createdById }, select: { fullName: true } });
    const mine = p.votes.find((v) => v.membershipId === viewer.id);
    const open = p.status === 'OPEN' && p.closesAt > new Date();
    return {
      id: p.id,
      title: p.title,
      description: p.description,
      status: p.status,
      createdByName: creator?.fullName ?? '',
      createdAt: p.createdAt.toISOString(),
      closesAt: p.closesAt.toISOString(),
      closedAt: p.closedAt?.toISOString() ?? null,
      quorumPercent: p.quorumPercent,
      passPercent: p.passPercent,
      eligibleCount: p.eligibleCount,
      tally: this.tallyOf(p.votes as { choice: Choice }[]),
      myVote: (mine?.choice as Choice) ?? null,
      canVote: open && !mine && viewer.permissions.includes(Permission.VOTES_CAST),
      canClose: p.status === 'OPEN' && viewer.permissions.includes(Permission.VOTES_CREATE),
    };
  }

  async cast(groupId: string, id: string, choice: Choice, actor: MembershipContext, meta: RequestMeta) {
    const p = await this.prisma.proposal.findFirst({ where: { id, groupId } });
    if (!p) throw new NotFoundException('Vote not found');
    if (p.status !== 'OPEN' || p.closesAt <= new Date()) throw new UnprocessableEntityException('Voting has closed');
    try {
      await this.prisma.vote.create({ data: { proposalId: id, membershipId: actor.id, choice } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new ConflictException('You have already voted. Votes cannot be changed.');
      throw err;
    }
    // Record participation, not the choice, so ballots stay secret even in the audit log.
    await this.audit.log({ groupId, actorUserId: actor.userId, action: 'vote.cast', entityType: 'Proposal', entityId: id, meta });
    return this.proposal(groupId, id, actor);
  }

  async close(groupId: string, id: string, cancel: boolean, actor: MembershipContext | null, meta?: RequestMeta) {
    const p = await this.prisma.proposal.findFirst({ where: { id, groupId }, include: { votes: { select: { choice: true } } } });
    if (!p) throw new NotFoundException('Vote not found');
    if (p.status !== 'OPEN') throw new UnprocessableEntityException('This vote is already closed');
    const tally = this.tallyOf(p.votes as { choice: Choice }[]);
    const result = this.outcome(p, tally);
    const status = cancel ? 'CANCELLED' : result.passed ? 'PASSED' : 'FAILED';
    const claimed = await this.prisma.proposal.updateMany({ where: { id, status: 'OPEN' }, data: { status, closedAt: new Date(), result: { ...tally, ...result } } });
    if (claimed.count !== 1) throw new UnprocessableEntityException('This vote is already closed');
    await this.audit.log({ groupId, actorUserId: actor?.userId ?? null, action: cancel ? 'vote.cancelled' : 'vote.closed', entityType: 'Proposal', entityId: id, after: { status, ...tally, ...result }, meta });
    if (!cancel) {
      // Publish the decision to the whole group.
      const users = (await this.prisma.membership.findMany({ where: { groupId, status: 'ACTIVE' }, select: { userId: true } })).map((m) => m.userId);
      await this.notifications.notify(users, { groupId, type: 'ANNOUNCEMENT', title: `Decision: ${p.title}`, body: `${status === 'PASSED' ? 'Passed' : 'Not passed'} — ${tally.YES} yes, ${tally.NO} no, ${tally.ABSTAIN} abstain (${result.turnout} of ${p.eligibleCount} voted${result.quorumMet ? '' : ', quorum not met'}).` });
    }
    const handler = p.subjectType && p.subjectId ? this.handlers.get(p.subjectType) : undefined;
    if (handler) {
      // The vote result stands even if acting on it fails; the failure is audited for officers.
      await handler({ id, groupId, subjectId: p.subjectId!, status }).catch(async (err: Error) => {
        this.logger.warn(`Acting on vote ${id} failed: ${err.message}`);
        await this.audit.log({ groupId, actorUserId: null, action: 'vote.outcome_failed', entityType: 'Proposal', entityId: id, reason: err.message });
      });
    }
    return actor ? this.proposal(groupId, id, actor) : null;
  }

  /** Votes past their closing time are closed lazily on read (and by the scheduler). */
  async closeExpired(groupId?: string) {
    const due = await this.prisma.proposal.findMany({ where: { status: 'OPEN', closesAt: { lte: new Date() }, ...(groupId ? { groupId } : {}) }, select: { id: true, groupId: true } });
    for (const p of due) await this.close(p.groupId, p.id, false, null).catch(() => undefined);
    return due.length;
  }

  /* ---------- audit findings ---------- */

  async findings(groupId: string, viewer: MembershipContext): Promise<FindingRow[]> {
    const canSeeAll = [Permission.FINDINGS_RAISE, Permission.FINDINGS_RESOLVE, Permission.AUDIT_VIEW].some((p) => viewer.permissions.includes(p));
    if (!canSeeAll) throw new ForbiddenException('Audit findings are visible to officers and auditors.');
    const rows = await this.prisma.auditFinding.findMany({ where: { groupId }, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }] });
    const ids = [...new Set(rows.flatMap((r) => [r.raisedByMembershipId, r.respondedByMembershipId]).filter(Boolean) as string[])];
    const ms = await this.prisma.membership.findMany({ where: { id: { in: ids } }, select: { id: true, user: { select: { fullName: true } } } });
    const name = new Map(ms.map((m) => [m.id, m.user.fullName]));
    return rows.map((f) => ({
      id: f.id,
      title: f.title,
      details: f.details,
      severity: f.severity,
      status: f.status,
      entityType: f.entityType,
      entityId: f.entityId,
      reference: f.reference,
      raisedByName: name.get(f.raisedByMembershipId) ?? '',
      response: f.response,
      respondedByName: f.respondedByMembershipId ? (name.get(f.respondedByMembershipId) ?? null) : null,
      createdAt: f.createdAt.toISOString(),
      resolvedAt: f.resolvedAt?.toISOString() ?? null,
      canRespond: viewer.permissions.includes(Permission.FINDINGS_RESOLVE) && f.raisedByMembershipId !== viewer.id && !['RESOLVED', 'REJECTED'].includes(f.status),
    }));
  }

  async raiseFinding(groupId: string, input: { title: string; details: string; severity: 'LOW' | 'MEDIUM' | 'HIGH'; entityType?: string; entityId?: string; reference?: string }, actor: MembershipContext, meta: RequestMeta) {
    const f = await this.prisma.auditFinding.create({ data: { groupId, raisedByMembershipId: actor.id, ...input } });
    await this.audit.log({ groupId, actorUserId: actor.userId, action: 'finding.raised', entityType: 'AuditFinding', entityId: f.id, after: input, meta });
    const officers = (await this.notifications.groupUserIds(groupId, ['CHAIRPERSON', 'TREASURER', 'VICE_CHAIRPERSON'])).filter((u) => u !== actor.userId);
    await this.notifications.notify(officers, { groupId, type: 'APPROVAL_REQUIRED', title: `Audit finding (${input.severity.toLowerCase()})`, body: input.title });
    return { id: f.id };
  }

  async respondFinding(groupId: string, id: string, status: 'ACKNOWLEDGED' | 'RESOLVED' | 'REJECTED', response: string, actor: MembershipContext, meta: RequestMeta) {
    const f = await this.prisma.auditFinding.findFirst({ where: { id, groupId } });
    if (!f) throw new NotFoundException('Finding not found');
    if (f.raisedByMembershipId === actor.id) throw new ForbiddenException('You cannot respond to a finding you raised.');
    if (['RESOLVED', 'REJECTED'].includes(f.status)) throw new UnprocessableEntityException('This finding is closed');
    await this.prisma.auditFinding.update({ where: { id }, data: { status, response, respondedByMembershipId: actor.id, resolvedAt: status === 'ACKNOWLEDGED' ? null : new Date() } });
    await this.audit.log({ groupId, actorUserId: actor.userId, action: 'finding.responded', entityType: 'AuditFinding', entityId: id, before: { status: f.status }, after: { status }, reason: response, meta });
    const raiser = await this.prisma.membership.findUniqueOrThrow({ where: { id: f.raisedByMembershipId }, select: { userId: true } });
    await this.notifications.notify([raiser.userId], { groupId, type: 'ANNOUNCEMENT', title: `Finding ${status.toLowerCase()}`, body: `${f.title}: ${response}` });
    return { ok: true };
  }
}
