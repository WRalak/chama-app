import { Injectable } from '@nestjs/common';
import { ObligationStatus } from '@prisma/client';
import { addDays, Frequency, periodDatesUntil, periodLabel } from '@chamahub/shared';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { dbDate, isoDate, today } from '../../common/dates';
import { readSettings } from './policies';

/** How far ahead obligations are generated so members can see what is coming. */
export const OBLIGATION_HORIZON_DAYS = 45;

export function obligationStatus(
  o: { amountCents: bigint | number; paidCents: bigint | number; dueDate: Date; waivedReason?: string | null },
  todayIso: string,
  graceDays: number,
): ObligationStatus {
  if (o.waivedReason) return 'WAIVED';
  const amount = Number(o.amountCents);
  const paid = Number(o.paidCents);
  if (paid >= amount) return 'PAID';
  const due = isoDate(o.dueDate);
  if (addDays(due, graceDays) < todayIso) return 'OVERDUE';
  if (paid > 0) return 'PARTIAL';
  if (due <= todayIso) return 'DUE';
  return 'UPCOMING';
}

@Injectable()
export class ObligationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generates contribution obligations for every active schedule up to the
   * horizon. Idempotent: the (schedule, member, dueDate) unique key means
   * re-running never duplicates. Members are never billed for periods
   * before they joined.
   */
  async ensureForGroup(groupId: string, tx?: Tx): Promise<number> {
    const client = tx ?? this.prisma;
    const horizon = addDays(today(), OBLIGATION_HORIZON_DAYS);
    const schedules = await client.contributionSchedule.findMany({
      where: { groupId, active: true },
      include: {
        members: { select: { membershipId: true } },
        cycle: { include: { rounds: { select: { id: true, round: true, payoutDate: true, membershipId: true } } } },
      },
    });
    if (schedules.length === 0) return 0;
    const memberships = await client.membership.findMany({
      where: { groupId, status: 'ACTIVE' },
      select: { id: true, joinedAt: true },
    });
    let created = 0;
    for (const s of schedules) {
      const until = s.endDate && isoDate(s.endDate) < horizon ? isoDate(s.endDate) : horizon;
      const dates = s.cycle
        ? s.cycle.rounds.map((r) => isoDate(r.payoutDate)).filter((d) => d <= until)
        : periodDatesUntil(isoDate(s.startDate), s.frequency as Frequency, until);
      const eligible = s.allMembers ? memberships : memberships.filter((m) => s.members.some((sm) => sm.membershipId === m.id));
      const rows = [];
      for (const m of eligible) {
        const joined = isoDate(m.joinedAt);
        for (const d of dates) {
          // Cycle members are explicit, so they owe every round of the cycle they were added to.
          if (!s.cycle && d < joined) continue;
          const round = s.cycle?.rounds.find((r) => isoDate(r.payoutDate) === d);
          if (round && s.cycle && !s.cycle.recipientContributes && round.membershipId === m.id) continue;
          rows.push({
            groupId,
            scheduleId: s.id,
            membershipId: m.id,
            dueDate: dbDate(d),
            periodLabel: round ? `Round ${round.round} — ${periodLabel(d, s.frequency as Frequency)}` : periodLabel(d, s.frequency as Frequency),
            amountCents: s.amountCents,
            roundId: round?.id ?? null,
          });
        }
      }
      if (rows.length) {
        const r = await client.contributionObligation.createMany({ data: rows, skipDuplicates: true });
        created += r.count;
      }
    }
    return created;
  }

  /** Re-derives stored statuses (used by jobs; reads always recompute too). */
  async refreshStatuses(groupId: string, tx?: Tx) {
    const client = tx ?? this.prisma;
    const group = await client.group.findUniqueOrThrow({ where: { id: groupId }, select: { settings: true } });
    const { graceDays } = readSettings(group.settings);
    const t = today();
    const open = await client.contributionObligation.findMany({
      where: { groupId, status: { notIn: ['PAID', 'WAIVED'] } },
      select: { id: true, amountCents: true, paidCents: true, dueDate: true, waivedReason: true, status: true },
    });
    let changed = 0;
    for (const o of open) {
      const status = obligationStatus(o, t, graceDays);
      if (status !== o.status) {
        await client.contributionObligation.update({ where: { id: o.id }, data: { status } });
        changed++;
      }
    }
    return changed;
  }
}
