import { ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { DESTINATION_LABELS, formatDate, formatKenyanPhone, formatKes, Permission, ShareableSummary } from '@chamahub/shared';
import { dbDate, isoDate, today } from '../../common/dates';
import { n } from '../../common/money';
import { MembershipContext } from '../../common/request';
import { PrismaService } from '../../prisma/prisma.service';
import { readSettings } from '../finance/policies';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "Jane Wanjiru Kamau" → "Jane K." for group-wide messages. */
function shortName(full: string) {
  const parts = full.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
}

const footer = () => `_From ChamaHub records, ${formatDate(today())}. Confirmed payments only._`;

/**
 * Text summaries officers paste into the group's WhatsApp. Every figure is
 * read from confirmed records at the moment of sharing. Group-wide messages
 * never include anyone's loan, fine or personal balance; who has not paid is
 * listed only when the group has agreed members may see each other's
 * contribution status.
 */
@Injectable()
export class SummariesService {
  constructor(private readonly prisma: PrismaService) {}

  async collections(groupId: string, viewer: MembershipContext, month?: string): Promise<ShareableSummary> {
    if (!viewer.permissions.includes(Permission.CONTRIBUTIONS_VIEW_ALL)) throw new ForbiddenException('Only officers who see all contributions can share collection summaries.');
    const t = today();
    const ym = month && /^\d{4}-\d{2}$/.test(month) ? month : t.slice(0, 7);
    const [y, m] = ym.split('-').map(Number);
    const from = `${ym}-01`;
    const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    // In the current month only what has fallen due counts; later weeks are not yet owed.
    const to = monthEnd > t ? t : monthEnd;
    const partial = to !== monthEnd;
    const group = await this.prisma.group.findUniqueOrThrow({ where: { id: groupId }, select: { name: true, settings: true } });
    const obligations = await this.prisma.contributionObligation.findMany({
      where: { groupId, waivedReason: null, dueDate: { gte: dbDate(from), lte: dbDate(to) } },
      select: { membershipId: true, amountCents: true, paidCents: true, membership: { select: { user: { select: { fullName: true } } } } },
    });
    const byMember = new Map<string, { name: string; due: number; paid: number }>();
    for (const o of obligations) {
      const e = byMember.get(o.membershipId) ?? { name: o.membership.user.fullName, due: 0, paid: 0 };
      e.due += n(o.amountCents);
      e.paid += n(o.paidCents);
      byMember.set(o.membershipId, e);
    }
    const expected = [...byMember.values()].reduce((a, b) => a + b.due, 0);
    const collected = [...byMember.values()].reduce((a, b) => a + Math.min(b.paid, b.due), 0);
    const full = [...byMember.values()].filter((b) => b.paid >= b.due).length;
    const showNames = readSettings(group.settings).membersCanViewMemberBalances;
    const owing = [...byMember.values()].filter((b) => b.paid < b.due).map((b) => shortName(b.name)).sort();
    const next = await this.prisma.payoutRound.findFirst({
      where: { cycle: { groupId, status: 'ACTIVE' }, status: { notIn: ['COMPLETED', 'CANCELLED'] }, payoutDate: { gte: dbDate(t) } },
      orderBy: [{ payoutDate: 'asc' }, { slot: 'asc' }],
      select: { round: true, payoutDate: true, membership: { select: { user: { select: { fullName: true } } } } },
    });
    const lines = [
      `*${group.name.toUpperCase()}* — ${MONTHS[m - 1]} ${y} contributions`,
      expected ? `Collected: ${formatKes(collected, { compact: true })} of ${formatKes(expected, { compact: true })} due${partial ? ' so far' : ''} (${Math.floor((collected * 100) / expected)}%)` : `No contributions ${partial ? 'have fallen' : 'were'} due this month${partial ? ' yet' : ''}.`,
      expected ? `Members up to date: ${full} of ${byMember.size}` : null,
      showNames && owing.length ? `Still to pay: ${owing.join(', ')}` : null,
      next ? `Next payout: round ${next.round}, ${shortName(next.membership.user.fullName)} on ${formatDate(isoDate(next.payoutDate)!)}` : null,
      '',
      footer(),
    ].filter((l): l is string => l !== null);
    return { kind: 'collections', title: `${MONTHS[m - 1]} collections`, text: lines.join('\n'), namesMembers: showNames && owing.length > 0 };
  }

  /** A receipt the member (or an officer) can forward. Only for confirmed payments. */
  async receipt(groupId: string, paymentId: string, viewer: MembershipContext): Promise<ShareableSummary> {
    const p = await this.prisma.payment.findFirst({ where: { id: paymentId, groupId }, include: { group: { select: { name: true } }, membership: { select: { user: { select: { fullName: true } } } } } });
    if (!p || (p.membershipId !== viewer.id && !viewer.permissions.includes(Permission.CONTRIBUTIONS_VIEW_ALL))) throw new NotFoundException('Payment not found');
    if (p.status !== 'CONFIRMED') throw new UnprocessableEntityException('Only confirmed payments have a receipt. This one is not confirmed yet.');
    const what = p.purpose === 'LOAN_REPAYMENT' ? 'loan repayment' : p.purpose === 'FINE' ? 'fine payment' : 'contribution';
    const text = `${p.group.name.toUpperCase()}: ${formatKes(n(p.amountCents), { compact: true })} ${what} from ${p.membership?.user.fullName ?? 'a member'} confirmed${p.verifiedAt ? ` on ${formatDate(isoDate(p.verifiedAt)!)}` : ''}.${p.reference ? ` Ref ${p.reference}.` : ''} Thank you.`;
    return { kind: 'receipt', title: 'Payment receipt', text, namesMembers: true };
  }

  /** Announces a payout once it is confirmed received or completed — never when it is only approved or sent. */
  async payout(groupId: string, roundId: string, viewer: MembershipContext): Promise<ShareableSummary> {
    if (!viewer.permissions.includes(Permission.ROTATIONS_VIEW)) throw new ForbiddenException('Your role cannot view payouts.');
    const r = await this.prisma.payoutRound.findFirst({
      where: { id: roundId, cycle: { groupId } },
      include: { cycle: { select: { name: true, group: { select: { name: true } } } }, membership: { select: { user: { select: { fullName: true } } } }, disbursements: { where: { status: 'CONFIRMED' }, orderBy: { attempt: 'desc' }, take: 1 } },
    });
    if (!r) throw new NotFoundException('Payout not found');
    const d = r.disbursements[0];
    if (r.status !== 'COMPLETED' || !d) throw new UnprocessableEntityException('Share a payout only after it is confirmed as received.');
    const text = [
      `*${r.cycle.group.name.toUpperCase()}* — ${r.cycle.name}, round ${r.round}`,
      `Payout of ${formatKes(n(d.amountCents), { compact: true })} to ${shortName(r.membership.user.fullName)} sent on ${formatDate(isoDate(d.sentOn)!)} and confirmed${d.confirmationKind === 'RECIPIENT' ? ' by the recipient' : ''}.`,
      d.reference ? `Ref ${d.reference}.` : null,
      '',
      footer(),
    ].filter((l): l is string => l !== null).join('\n');
    return { kind: 'payout', title: `Round ${r.round} payout`, text, namesMembers: true };
  }

  async howToPay(groupId: string): Promise<ShareableSummary> {
    const group = await this.prisma.group.findUniqueOrThrow({ where: { id: groupId }, select: { name: true } });
    const t = today();
    const ds = await this.prisma.paymentDestination.findMany({ where: { groupId, status: 'ACTIVE', effectiveFrom: { lte: dbDate(t) } }, orderBy: { effectiveFrom: 'asc' } });
    const live = ds.filter((d) => !d.effectiveTo || isoDate(d.effectiveTo)! > t);
    if (!live.length) throw new UnprocessableEntityException('The group has no approved payment destinations yet.');
    const describe = (d: (typeof live)[number]) => {
      const acct = d.accountNumber && ['PERSONAL_MPESA', 'OTHER_MOBILE_MONEY'].includes(d.type) ? formatKenyanPhone(d.accountNumber) : d.accountNumber;
      return [
        `• *${d.displayName}* (${DESTINATION_LABELS.type[d.type]})`,
        d.type === 'PAYBILL' ? `  Paybill ${acct}, account: ${d.accountReference ?? 'your phone number'}` : d.type === 'TILL' ? `  Till ${acct}` : acct ? `  ${d.provider ? `${d.provider} ` : ''}${acct}` : null,
        d.accountName ? `  Name shown: ${d.accountName}` : null,
        d.branch ? `  Branch: ${d.branch}` : null,
        d.instructions ? `  ${d.instructions}` : null,
      ].filter(Boolean).join('\n');
    };
    const text = [`*${group.name.toUpperCase()}* — how to pay`, ...live.map(describe), '', 'Only pay to the details above. If anyone sends you different details, check in the ChamaHub app first.', 'Never share your M-Pesa PIN with anyone.'].join('\n');
    return { kind: 'how-to-pay', title: 'How to pay', text, namesMembers: false };
  }
}
