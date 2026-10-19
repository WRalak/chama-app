import { ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AttendanceStatus, formatDate, MeetingDetail, MeetingRow, Permission } from '@chamahub/shared';
import { AuditService } from '../../common/audit.service';
import { dbDate, isoDate } from '../../common/dates';
import { big, n } from '../../common/money';
import { MembershipContext, RequestMeta } from '../../common/request';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

const meetingInclude = {
  group: { select: { name: true } },
  attendance: true,
  minutes: true,
} satisfies Prisma.MeetingInclude;
type MeetingWith = Prisma.MeetingGetPayload<{ include: typeof meetingInclude }>;

@Injectable()
export class MeetingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  private row(m: MeetingWith, viewerMembershipIds: string[]): MeetingRow {
    const counts: Partial<Record<AttendanceStatus, number>> = {};
    for (const a of m.attendance) counts[a.status] = (counts[a.status] ?? 0) + 1;
    return {
      id: m.id,
      groupId: m.groupId,
      groupName: m.group.name,
      title: m.title,
      scheduledAt: m.scheduledAt.toISOString(),
      location: m.location,
      virtualLink: m.virtualLink,
      status: m.status,
      agenda: (m.agenda as string[]) ?? [],
      requiresRsvp: m.requiresRsvp,
      myAttendance: m.attendance.find((a) => viewerMembershipIds.includes(a.membershipId))?.status ?? null,
      attendanceCounts: counts,
      minutesStatus: m.minutes?.status ?? null,
    };
  }

  async list(groupId: string, viewer: MembershipContext, scope: 'upcoming' | 'past' | 'all') {
    const now = new Date();
    const rows = await this.prisma.meeting.findMany({
      where: { groupId, ...(scope === 'upcoming' ? { scheduledAt: { gte: new Date(now.getTime() - 6 * 3600_000) }, status: { not: 'CANCELLED' } } : scope === 'past' ? { scheduledAt: { lt: now } } : {}) },
      include: meetingInclude,
      orderBy: { scheduledAt: scope === 'upcoming' ? 'asc' : 'desc' },
      take: 100,
    });
    return rows.map((m) => this.row(m, [viewer.id]));
  }

  /** Upcoming meetings across all of a user's groups. */
  async mine(userId: string) {
    const memberships = await this.prisma.membership.findMany({ where: { userId, status: 'ACTIVE' }, select: { id: true, groupId: true } });
    const rows = await this.prisma.meeting.findMany({
      where: { groupId: { in: memberships.map((m) => m.groupId) }, scheduledAt: { gte: new Date(Date.now() - 6 * 3600_000) }, status: 'SCHEDULED' },
      include: meetingInclude,
      orderBy: { scheduledAt: 'asc' },
      take: 50,
    });
    return rows.map((m) => this.row(m, memberships.map((x) => x.id)));
  }

  async detail(groupId: string, id: string, viewer: MembershipContext): Promise<MeetingDetail> {
    const m = await this.prisma.meeting.findFirst({
      where: { id, groupId },
      include: {
        ...meetingInclude,
        resolutions: { orderBy: { createdAt: 'asc' } },
        actions: { orderBy: { createdAt: 'asc' }, include: { assignee: { select: { user: { select: { fullName: true } } } } } },
      },
    });
    if (!m) throw new NotFoundException('Meeting not found');
    const manager = viewer.permissions.includes(Permission.MEETINGS_MANAGE);
    const members = await this.prisma.membership.findMany({ where: { groupId, status: 'ACTIVE' }, include: { user: { select: { fullName: true } } }, orderBy: { user: { fullName: 'asc' } } });
    const approver = m.minutes?.approvedById ? await this.prisma.user.findUnique({ where: { id: m.minutes.approvedById }, select: { fullName: true } }) : null;
    // Members only see minutes once approved; officers see drafts.
    const minutesVisible = m.minutes && (m.minutes.status === 'APPROVED' || manager || viewer.permissions.includes(Permission.MINUTES_APPROVE));
    return {
      ...this.row(m, [viewer.id]),
      attendance: members.map((mem) => ({ membershipId: mem.id, name: mem.user.fullName, status: m.attendance.find((a) => a.membershipId === mem.id)?.status ?? null })),
      minutes: minutesVisible && m.minutes ? { body: m.minutes.body, status: m.minutes.status, approvedByName: approver?.fullName ?? null, approvedAt: m.minutes.approvedAt?.toISOString() ?? null } : null,
      resolutions: m.minutes?.status === 'APPROVED' || manager ? m.resolutions.map((r) => ({ id: r.id, title: r.title, details: r.details, isFinancial: r.isFinancial, amountCents: r.amountCents === null ? null : n(r.amountCents) })) : [],
      actions: m.actions.map((a) => ({ id: a.id, description: a.description, assigneeName: a.assignee?.user.fullName ?? null, assigneeMembershipId: a.assigneeMembershipId, dueDate: isoDate(a.dueDate), done: a.done })),
    };
  }

  async create(groupId: string, input: { title: string; scheduledAt: string; location?: string; virtualLink?: string; agenda: string[]; requiresRsvp: boolean }, actor: MembershipContext, meta: RequestMeta) {
    const m = await this.prisma.meeting.create({
      data: { groupId, title: input.title, scheduledAt: new Date(input.scheduledAt), location: input.location ?? null, virtualLink: input.virtualLink ?? null, agenda: input.agenda, requiresRsvp: input.requiresRsvp, createdById: actor.userId },
    });
    await this.audit.log({ groupId, actorUserId: actor.userId, action: 'meeting.scheduled', entityType: 'Meeting', entityId: m.id, after: input, meta });
    const users = await this.notifications.groupUserIds(groupId);
    await this.notifications.notify(users, { groupId, type: 'MEETING_SCHEDULED', title: `Meeting: ${input.title}`, body: `${formatDate(new Date(new Date(input.scheduledAt).getTime() + 3 * 3600_000))}${input.location ? ` at ${input.location}` : ''}.`, data: { meetingId: m.id } });
    return this.detail(groupId, m.id, actor);
  }

  async update(groupId: string, id: string, input: Partial<{ title: string; scheduledAt: string; location: string; virtualLink: string; agenda: string[]; requiresRsvp: boolean; status: 'SCHEDULED' | 'HELD' | 'CANCELLED' }>, actor: MembershipContext, meta: RequestMeta) {
    const before = await this.prisma.meeting.findFirst({ where: { id, groupId } });
    if (!before) throw new NotFoundException('Meeting not found');
    await this.prisma.meeting.update({
      where: { id },
      data: { title: input.title, scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : undefined, location: input.location, virtualLink: input.virtualLink, agenda: input.agenda, requiresRsvp: input.requiresRsvp, status: input.status },
    });
    await this.audit.log({ groupId, actorUserId: actor.userId, action: 'meeting.updated', entityType: 'Meeting', entityId: id, before, after: input, meta });
    return this.detail(groupId, id, actor);
  }

  async rsvp(groupId: string, id: string, status: AttendanceStatus, actor: MembershipContext) {
    const m = await this.prisma.meeting.findFirst({ where: { id, groupId } });
    if (!m || m.status !== 'SCHEDULED') throw new UnprocessableEntityException('You can only respond to upcoming meetings');
    await this.prisma.attendance.upsert({ where: { meetingId_membershipId: { meetingId: id, membershipId: actor.id } }, create: { meetingId: id, membershipId: actor.id, status }, update: { status } });
    return this.detail(groupId, id, actor);
  }

  async register(groupId: string, id: string, entries: { memberId: string; status: 'PRESENT' | 'ABSENT' | 'APOLOGY' }[], actor: MembershipContext, meta: RequestMeta) {
    const m = await this.prisma.meeting.findFirst({ where: { id, groupId } });
    if (!m) throw new NotFoundException('Meeting not found');
    const valid = await this.prisma.membership.count({ where: { groupId, id: { in: entries.map((e) => e.memberId) } } });
    if (valid !== new Set(entries.map((e) => e.memberId)).size) throw new UnprocessableEntityException('Attendance includes people who are not members');
    await this.prisma.$transaction([
      ...entries.map((e) => this.prisma.attendance.upsert({ where: { meetingId_membershipId: { meetingId: id, membershipId: e.memberId } }, create: { meetingId: id, membershipId: e.memberId, status: e.status }, update: { status: e.status } })),
      this.prisma.meeting.update({ where: { id }, data: { status: 'HELD' } }),
    ]);
    await this.audit.log({ groupId, actorUserId: actor.userId, action: 'meeting.attendance_recorded', entityType: 'Meeting', entityId: id, after: entries, meta });
    return this.detail(groupId, id, actor);
  }

  async saveMinutes(groupId: string, id: string, body: string, actor: MembershipContext, meta: RequestMeta) {
    const m = await this.prisma.meeting.findFirst({ where: { id, groupId }, include: { minutes: true } });
    if (!m) throw new NotFoundException('Meeting not found');
    if (m.minutes?.status === 'APPROVED') throw new UnprocessableEntityException('Approved minutes are final and cannot be edited');
    await this.prisma.minutes.upsert({ where: { meetingId: id }, create: { meetingId: id, body, recordedById: actor.userId }, update: { body, recordedById: actor.userId } });
    await this.audit.log({ groupId, actorUserId: actor.userId, action: 'minutes.saved', entityType: 'Meeting', entityId: id, meta });
    return this.detail(groupId, id, actor);
  }

  async approveMinutes(groupId: string, id: string, actor: MembershipContext, meta: RequestMeta) {
    const m = await this.prisma.meeting.findFirst({ where: { id, groupId }, include: { minutes: true } });
    if (!m?.minutes) throw new NotFoundException('No minutes recorded for this meeting');
    if (m.minutes.status === 'APPROVED') throw new UnprocessableEntityException('Minutes already approved');
    if (m.minutes.recordedById === actor.userId) throw new ForbiddenException('Minutes must be approved by someone other than the person who wrote them.');
    await this.prisma.minutes.update({ where: { meetingId: id }, data: { status: 'APPROVED', approvedById: actor.userId, approvedAt: new Date() } });
    await this.audit.log({ groupId, actorUserId: actor.userId, action: 'minutes.approved', entityType: 'Meeting', entityId: id, approvalStatus: 'APPROVED', meta });
    const users = await this.notifications.groupUserIds(groupId);
    await this.notifications.notify(users, { groupId, type: 'ANNOUNCEMENT', title: 'Minutes published', body: `Approved minutes for "${m.title}" are now available.`, data: { meetingId: id } });
    return this.detail(groupId, id, actor);
  }

  async addResolution(groupId: string, id: string, input: { title: string; details?: string; isFinancial: boolean; amountCents?: number }, actor: MembershipContext, meta: RequestMeta) {
    const m = await this.prisma.meeting.findFirst({ where: { id, groupId }, include: { minutes: true } });
    if (!m) throw new NotFoundException('Meeting not found');
    if (m.minutes?.status === 'APPROVED') throw new UnprocessableEntityException('Minutes are approved; resolutions are final');
    const r = await this.prisma.resolution.create({ data: { meetingId: id, title: input.title, details: input.details ?? null, isFinancial: input.isFinancial, amountCents: input.amountCents !== undefined ? big(input.amountCents) : null } });
    await this.audit.log({ groupId, actorUserId: actor.userId, action: 'resolution.added', entityType: 'Resolution', entityId: r.id, after: input, meta });
    return this.detail(groupId, id, actor);
  }

  async addAction(groupId: string, id: string, input: { description: string; assigneeMemberId?: string; dueDate?: string }, actor: MembershipContext, meta: RequestMeta) {
    const m = await this.prisma.meeting.findFirst({ where: { id, groupId } });
    if (!m) throw new NotFoundException('Meeting not found');
    if (input.assigneeMemberId && !(await this.prisma.membership.findFirst({ where: { id: input.assigneeMemberId, groupId } }))) throw new UnprocessableEntityException('Assignee is not a member');
    const a = await this.prisma.actionItem.create({ data: { meetingId: id, description: input.description, assigneeMembershipId: input.assigneeMemberId ?? null, dueDate: input.dueDate ? dbDate(input.dueDate) : null } });
    await this.audit.log({ groupId, actorUserId: actor.userId, action: 'action_item.added', entityType: 'ActionItem', entityId: a.id, after: input, meta });
    return this.detail(groupId, id, actor);
  }

  async toggleAction(groupId: string, meetingId: string, actionId: string, done: boolean, actor: MembershipContext) {
    const a = await this.prisma.actionItem.findFirst({ where: { id: actionId, meetingId, meeting: { groupId } } });
    if (!a) throw new NotFoundException('Action not found');
    if (a.assigneeMembershipId !== actor.id && !actor.permissions.includes(Permission.MEETINGS_MANAGE)) throw new ForbiddenException('Only the assignee or a meeting manager can update this action');
    await this.prisma.actionItem.update({ where: { id: a.id }, data: { done, doneAt: done ? new Date() : null } });
    return this.detail(groupId, meetingId, actor);
  }

  async myActions(userId: string) {
    const rows = await this.prisma.actionItem.findMany({
      where: { assignee: { userId }, done: false },
      include: { meeting: { select: { id: true, title: true, groupId: true, group: { select: { name: true } } } } },
      orderBy: { dueDate: 'asc' },
    });
    return rows.map((a) => ({ id: a.id, description: a.description, dueDate: isoDate(a.dueDate), meetingId: a.meeting.id, meetingTitle: a.meeting.title, groupId: a.meeting.groupId, groupName: a.meeting.group.name }));
  }

  /* announcements */
  async announce(groupId: string, input: { title: string; body: string }, actor: MembershipContext, meta: RequestMeta) {
    const a = await this.prisma.announcement.create({ data: { groupId, title: input.title, body: input.body, createdById: actor.userId } });
    await this.audit.log({ groupId, actorUserId: actor.userId, action: 'announcement.sent', entityType: 'Announcement', entityId: a.id, meta });
    const users = await this.notifications.groupUserIds(groupId);
    await this.notifications.notify(users, { groupId, type: 'ANNOUNCEMENT', title: input.title, body: input.body });
    return { id: a.id };
  }

  async announcements(groupId: string) {
    const rows = await this.prisma.announcement.findMany({ where: { groupId }, orderBy: { createdAt: 'desc' }, take: 50 });
    return rows.map((a) => ({ id: a.id, title: a.title, body: a.body, createdAt: a.createdAt.toISOString() }));
  }
}
