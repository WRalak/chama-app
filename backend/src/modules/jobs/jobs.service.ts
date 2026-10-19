import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { addDays, formatDate, formatKes } from '@chamahub/shared';
import { env } from '../../config/env';
import { dbDate, isoDate, today } from '../../common/dates';
import { big, n } from '../../common/money';
import { PrismaService } from '../../prisma/prisma.service';
import { ObligationsService } from '../finance/obligations.service';
import { readSettings } from '../finance/policies';
import { installmentStatus } from '../finance/posting.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DecisionsService } from '../decisions/decisions.service';

export const SYSTEM_ACTOR = 'system';

@Injectable()
export class JobsService {
  private readonly logger = new Logger('Jobs');
  private running = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly obligations: ObligationsService,
    private readonly notifications: NotificationsService,
    private readonly decisions: DecisionsService,
  ) {}

  /** Runs a job once at a time and records the outcome for platform health monitoring. */
  private async track(name: string, fn: () => Promise<Record<string, unknown>>) {
    if (env().DISABLE_JOBS || this.running.has(name)) return;
    this.running.add(name);
    const startedAt = new Date();
    try {
      const details = await fn();
      await this.prisma.jobRun.create({ data: { name, status: 'SUCCEEDED', startedAt, finishedAt: new Date(), details: details as Prisma.InputJsonValue } });
    } catch (err) {
      this.logger.error(`${name} failed: ${(err as Error).message}`);
      await this.prisma.jobRun.create({ data: { name, status: 'FAILED', startedAt, finishedAt: new Date(), error: (err as Error).message.slice(0, 2000) } }).catch(() => undefined);
    } finally {
      this.running.delete(name);
    }
  }

  @Cron(CronExpression.EVERY_30_MINUTES)
  scheduledMaintenance() {
    return this.track('maintenance', () => this.maintenance());
  }

  // 05:00 UTC = 08:00 in Nairobi.
  @Cron('0 5 * * *')
  scheduledReminders() {
    return this.track('reminders', () => this.reminders());
  }

  @Cron(CronExpression.EVERY_MINUTE)
  scheduledDispatch() {
    return this.track('notification-dispatch', async () => ({ ...(await this.notifications.dispatchQueued()) }));
  }

  /** Generates obligations, refreshes statuses and applies configured late fines. */
  async maintenance() {
    const groups = await this.prisma.group.findMany({ where: { status: 'ACTIVE' }, select: { id: true, settings: true } });
    let created = 0;
    let fines = 0;
    const t = today();
    for (const g of groups) {
      created += await this.obligations.ensureForGroup(g.id);
      await this.obligations.refreshStatuses(g.id);
      const settings = readSettings(g.settings);
      if (settings.lateContributionFineCents > 0) {
        const overdue = await this.prisma.contributionObligation.findMany({ where: { groupId: g.id, status: 'OVERDUE', fines: { none: {} } }, select: { id: true, membershipId: true, periodLabel: true } });
        for (const o of overdue) {
          await this.prisma.fine
            .create({ data: { groupId: g.id, membershipId: o.membershipId, amountCents: big(settings.lateContributionFineCents), reason: `Late contribution: ${o.periodLabel}`, issuedOn: dbDate(t), obligationId: o.id, issuedById: SYSTEM_ACTOR } })
            .then(() => fines++)
            .catch(() => undefined); // unique obligationId: already fined
        }
      }
    }
    const installments = await this.prisma.loanInstallment.findMany({ where: { status: { not: 'PAID' }, loan: { status: 'DISBURSED' } } });
    let instChanged = 0;
    for (const i of installments) {
      const s = installmentStatus(i, t);
      if (s !== i.status) {
        await this.prisma.loanInstallment.update({ where: { id: i.id }, data: { status: s } });
        instChanged++;
      }
    }
    const votesClosed = await this.decisions.closeExpired();
    return { groups: groups.length, obligationsCreated: created, finesIssued: fines, installmentsUpdated: instChanged, votesClosed };
  }

  /** Daily reminders, de-duplicated per item so nobody is messaged twice for the same thing. */
  async reminders() {
    const t = today();
    const soon = addDays(t, 3);
    let sent = 0;
    const due = await this.prisma.contributionObligation.findMany({
      where: { status: { notIn: ['PAID', 'WAIVED'] }, dueDate: { lte: dbDate(soon) }, group: { status: 'ACTIVE' }, membership: { status: 'ACTIVE' } },
      include: { group: { select: { name: true } }, membership: { select: { userId: true } } },
    });
    for (const o of due) {
      const dueIso = isoDate(o.dueDate);
      const overdue = dueIso < t;
      const owed = n(o.amountCents) - n(o.paidCents);
      sent += await this.notifications.notify([o.membership.userId], {
        groupId: o.groupId,
        type: overdue ? 'CONTRIBUTION_OVERDUE' : 'CONTRIBUTION_DUE',
        title: overdue ? `Overdue: ${o.group.name}` : `Contribution due: ${o.group.name}`,
        body: `${formatKes(owed)} for ${o.periodLabel} ${overdue ? 'was due' : 'is due'} on ${formatDate(dueIso)}.`,
        dedupeKey: overdue ? `overdue:${o.id}:${t.slice(0, 7)}-${Math.floor(Number(t.slice(8)) / 7)}` : `due:${o.id}`,
      });
    }
    const installments = await this.prisma.loanInstallment.findMany({
      where: { status: { not: 'PAID' }, dueDate: { lte: dbDate(soon) }, loan: { status: 'DISBURSED' } },
      include: { loan: { select: { groupId: true, group: { select: { name: true } }, membership: { select: { userId: true } } } } },
    });
    for (const i of installments) {
      const owed = n(i.principalCents) + n(i.interestCents) - n(i.principalPaidCents) - n(i.interestPaidCents);
      sent += await this.notifications.notify([i.loan.membership.userId], { groupId: i.loan.groupId, type: 'REPAYMENT_DUE', title: `Loan installment: ${i.loan.group.name}`, body: `${formatKes(owed)} (installment ${i.number}) due ${formatDate(isoDate(i.dueDate))}.`, dedupeKey: `inst:${i.id}:${isoDate(i.dueDate) < t ? 'late' : 'due'}` });
    }
    const rounds = await this.prisma.payoutRound.findMany({
      where: { status: { notIn: ['COMPLETED', 'CANCELLED'] }, payoutDate: { gte: dbDate(t), lte: dbDate(addDays(t, 7)) }, cycle: { status: 'ACTIVE' } },
      include: { cycle: { select: { name: true, groupId: true } }, membership: { select: { userId: true } } },
    });
    for (const r of rounds) {
      sent += await this.notifications.notify([r.membership.userId], { groupId: r.cycle.groupId, type: 'PAYOUT_UPCOMING', title: 'Your payout is coming up', body: `${r.cycle.name} round ${r.round} is scheduled for ${formatDate(isoDate(r.payoutDate))}. It is paid once collections are confirmed and officers approve.`, dedupeKey: `payout:${r.id}` });
    }
    const meetings = await this.prisma.meeting.findMany({ where: { status: 'SCHEDULED', reminderSentAt: null, scheduledAt: { gte: new Date(), lte: new Date(Date.now() + 36 * 3600_000) } } });
    for (const m of meetings) {
      const users = await this.notifications.groupUserIds(m.groupId);
      sent += await this.notifications.notify(users, { groupId: m.groupId, type: 'MEETING_REMINDER', title: `Meeting tomorrow: ${m.title}`, body: `${m.location ?? m.virtualLink ?? ''}`.trim() || 'See ChamaHub for details.', dedupeKey: `meeting:${m.id}` });
      await this.prisma.meeting.update({ where: { id: m.id }, data: { reminderSentAt: new Date() } });
    }
    return { remindersCreated: sent };
  }
}
