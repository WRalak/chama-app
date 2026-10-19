import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { InstallmentStatus, Payment } from '@prisma/client';
import { allocateRepayment, formatKes } from '@chamahub/shared';
import { Tx } from '../../prisma/prisma.service';
import { big, n } from '../../common/money';
import { isoDate, today } from '../../common/dates';
import { LedgerService } from '../ledger/ledger.service';
import { obligationStatus } from './obligations.service';
import { readSettings } from './policies';

export function installmentStatus(
  i: { principalCents: bigint; interestCents: bigint; principalPaidCents: bigint; interestPaidCents: bigint; dueDate: Date },
  todayIso: string,
): InstallmentStatus {
  const due = n(i.principalCents) + n(i.interestCents);
  const paid = n(i.principalPaidCents) + n(i.interestPaidCents);
  if (paid >= due) return 'PAID';
  if (isoDate(i.dueDate) < todayIso) return 'OVERDUE';
  if (paid > 0) return 'PARTIAL';
  return 'UPCOMING';
}

/**
 * Turns a verified payment into ledger entries and applies it to the
 * member's obligations, loan installments or fines. Always runs inside the
 * caller's transaction so the payment status, allocations and journal
 * commit (or fail) together.
 */
@Injectable()
export class PostingService {
  constructor(private readonly ledger: LedgerService) {}

  async confirm(tx: Tx, paymentId: string, verifiedById: string | null): Promise<Payment> {
    // Guarded status transition: only one caller can move PENDING → CONFIRMED.
    const claimed = await tx.payment.updateMany({
      where: { id: paymentId, status: 'PENDING' },
      data: { status: 'CONFIRMED', verifiedById, verifiedAt: new Date() },
    });
    if (claimed.count !== 1) throw new UnprocessableEntityException('Only pending payments can be confirmed');
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (!payment.membershipId) throw new UnprocessableEntityException('Payment is not linked to a member');
    switch (payment.purpose) {
      case 'CONTRIBUTION':
        await this.applyContribution(tx, payment);
        break;
      case 'LOAN_REPAYMENT':
        await this.applyRepayment(tx, payment);
        break;
      case 'FINE':
        await this.applyFine(tx, payment);
        break;
      default:
        throw new UnprocessableEntityException('Unsupported payment purpose');
    }
    return payment;
  }

  private async applyContribution(tx: Tx, p: Payment) {
    const group = await tx.group.findUniqueOrThrow({ where: { id: p.groupId }, select: { settings: true } });
    const { graceDays } = readSettings(group.settings);
    const t = today();
    const open = await tx.contributionObligation.findMany({
      where: { groupId: p.groupId, membershipId: p.membershipId!, status: { notIn: ['PAID', 'WAIVED'] } },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
    });
    const ordered = p.targetId ? [...open.filter((o) => o.id === p.targetId), ...open.filter((o) => o.id !== p.targetId)] : open;
    if (p.targetId && !open.some((o) => o.id === p.targetId)) {
      const exists = await tx.contributionObligation.findFirst({ where: { id: p.targetId, groupId: p.groupId, membershipId: p.membershipId! } });
      if (!exists) throw new UnprocessableEntityException('The selected contribution does not belong to this member');
    }
    let remaining = n(p.amountCents);
    for (const o of ordered) {
      if (remaining === 0) break;
      const owed = n(o.amountCents) - n(o.paidCents);
      const take = Math.min(owed, remaining);
      if (take <= 0) continue;
      remaining -= take;
      const paid = n(o.paidCents) + take;
      await tx.contributionObligation.update({
        where: { id: o.id },
        data: { paidCents: big(paid), status: obligationStatus({ ...o, paidCents: paid }, t, graceDays) },
      });
      await tx.paymentAllocation.create({ data: { paymentId: p.id, obligationId: o.id, amountCents: big(take) } });
    }
    if (remaining > 0) {
      // Paid ahead of any generated obligation: still the member's savings.
      await tx.paymentAllocation.create({ data: { paymentId: p.id, amountCents: big(remaining) } });
    }
    await this.ledger.post(tx, {
      groupId: p.groupId,
      entryDate: isoDate(p.paidAt),
      type: 'CONTRIBUTION',
      description: `Contribution ${formatKes(n(p.amountCents))}`,
      reference: p.reference,
      membershipId: p.membershipId,
      paymentId: p.id,
      createdById: p.verifiedById,
      lines: [
        { account: 'CASH', amountCents: n(p.amountCents) },
        { account: 'MEMBER_CONTRIBUTIONS', amountCents: -n(p.amountCents) },
      ],
    });
  }

  private async applyRepayment(tx: Tx, p: Payment) {
    if (!p.targetId) throw new UnprocessableEntityException('Select the loan this repayment is for');
    const loan = await tx.loan.findFirst({
      where: { id: p.targetId, groupId: p.groupId, membershipId: p.membershipId! },
      include: { installments: { orderBy: { number: 'asc' } } },
    });
    if (!loan || loan.status !== 'DISBURSED') throw new UnprocessableEntityException('Repayments can only be made to an active, disbursed loan of this member');
    const { allocations, unallocatedCents } = allocateRepayment(
      loan.installments.map((i) => ({
        id: i.id,
        principalDueCents: n(i.principalCents),
        interestDueCents: n(i.interestCents),
        principalPaidCents: n(i.principalPaidCents),
        interestPaidCents: n(i.interestPaidCents),
      })),
      n(p.amountCents),
    );
    if (unallocatedCents > 0) {
      throw new UnprocessableEntityException(`Repayment exceeds the loan balance by ${formatKes(unallocatedCents)}`);
    }
    const t = today();
    let principal = 0;
    let interest = 0;
    for (const a of allocations) {
      const inst = loan.installments.find((i) => i.id === a.installmentId)!;
      const next = {
        ...inst,
        principalPaidCents: inst.principalPaidCents + big(a.principalCents),
        interestPaidCents: inst.interestPaidCents + big(a.interestCents),
      };
      await tx.loanInstallment.update({
        where: { id: inst.id },
        data: { principalPaidCents: next.principalPaidCents, interestPaidCents: next.interestPaidCents, status: installmentStatus(next, t) },
      });
      await tx.paymentAllocation.create({
        data: {
          paymentId: p.id,
          installmentId: inst.id,
          principalCents: big(a.principalCents),
          interestCents: big(a.interestCents),
          amountCents: big(a.principalCents + a.interestCents),
        },
      });
      principal += a.principalCents;
      interest += a.interestCents;
    }
    await this.ledger.post(tx, {
      groupId: p.groupId,
      entryDate: isoDate(p.paidAt),
      type: 'LOAN_REPAYMENT_PRINCIPAL',
      description: `Loan repayment ${formatKes(n(p.amountCents))}`,
      reference: p.reference,
      membershipId: p.membershipId,
      paymentId: p.id,
      loanId: loan.id,
      createdById: p.verifiedById,
      lines: [
        { account: 'CASH', amountCents: principal + interest },
        { account: 'LOANS_RECEIVABLE', amountCents: -principal },
        { account: 'INTEREST_INCOME', amountCents: -interest },
      ],
    });
    const remaining = await tx.loanInstallment.count({ where: { loanId: loan.id, status: { not: 'PAID' } } });
    if (remaining === 0) await tx.loan.update({ where: { id: loan.id }, data: { status: 'REPAID', closedAt: new Date() } });
  }

  private async applyFine(tx: Tx, p: Payment) {
    if (!p.targetId) throw new UnprocessableEntityException('Select the fine this payment is for');
    const fine = await tx.fine.findFirst({ where: { id: p.targetId, groupId: p.groupId, membershipId: p.membershipId! } });
    if (!fine || fine.status === 'WAIVED' || fine.status === 'PAID') throw new UnprocessableEntityException('This fine is not payable');
    const outstanding = n(fine.amountCents) - n(fine.paidCents);
    if (n(p.amountCents) > outstanding) throw new UnprocessableEntityException(`Payment exceeds the fine balance of ${formatKes(outstanding)}`);
    const paid = n(fine.paidCents) + n(p.amountCents);
    await tx.fine.update({ where: { id: fine.id }, data: { paidCents: big(paid), status: paid >= n(fine.amountCents) ? 'PAID' : 'PARTIAL' } });
    await tx.paymentAllocation.create({ data: { paymentId: p.id, fineId: fine.id, amountCents: p.amountCents } });
    await this.ledger.post(tx, {
      groupId: p.groupId,
      entryDate: isoDate(p.paidAt),
      type: 'FINE_PAYMENT',
      description: `Fine payment: ${fine.reason}`,
      reference: p.reference,
      membershipId: p.membershipId,
      paymentId: p.id,
      fineId: fine.id,
      createdById: p.verifiedById,
      lines: [
        { account: 'CASH', amountCents: n(p.amountCents) },
        { account: 'FINE_INCOME', amountCents: -n(p.amountCents) },
      ],
    });
  }

  /**
   * Reverses a confirmed payment: posts mirror ledger entries and rolls back
   * what it paid. The original payment and allocations stay on record.
   */
  async reverse(tx: Tx, paymentId: string, reason: string, userId: string) {
    const claimed = await tx.payment.updateMany({
      where: { id: paymentId, status: 'CONFIRMED' },
      data: { status: 'REVERSED', reversedById: userId, reversedAt: new Date(), reversalReason: reason },
    });
    if (claimed.count !== 1) throw new UnprocessableEntityException('Only confirmed payments can be reversed');
    const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { allocations: true } });
    const group = await tx.group.findUniqueOrThrow({ where: { id: p.groupId }, select: { settings: true } });
    const { graceDays } = readSettings(group.settings);
    const t = today();
    for (const a of p.allocations) {
      if (a.obligationId) {
        const o = await tx.contributionObligation.findUniqueOrThrow({ where: { id: a.obligationId } });
        const paid = n(o.paidCents) - n(a.amountCents);
        await tx.contributionObligation.update({
          where: { id: o.id },
          data: { paidCents: big(paid), status: obligationStatus({ ...o, paidCents: paid }, t, graceDays) },
        });
      }
      if (a.installmentId) {
        const i = await tx.loanInstallment.findUniqueOrThrow({ where: { id: a.installmentId } });
        const next = { ...i, principalPaidCents: i.principalPaidCents - a.principalCents, interestPaidCents: i.interestPaidCents - a.interestCents };
        await tx.loanInstallment.update({
          where: { id: i.id },
          data: { principalPaidCents: next.principalPaidCents, interestPaidCents: next.interestPaidCents, status: installmentStatus(next, t) },
        });
        await tx.loan.updateMany({ where: { id: i.loanId, status: 'REPAID' }, data: { status: 'DISBURSED', closedAt: null } });
      }
      if (a.fineId) {
        const f = await tx.fine.findUniqueOrThrow({ where: { id: a.fineId } });
        const paid = n(f.paidCents) - n(a.amountCents);
        await tx.fine.update({ where: { id: f.id }, data: { paidCents: big(paid), status: paid <= 0 ? 'OUTSTANDING' : 'PARTIAL' } });
      }
    }
    await this.ledger.reverseWhere(tx, { paymentId }, { reason, date: t, createdById: userId });
    return p;
  }
}
