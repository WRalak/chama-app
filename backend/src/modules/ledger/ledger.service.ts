import { Global, Injectable, Module, UnprocessableEntityException } from '@nestjs/common';
import { LedgerAccount, LedgerEntryType, Prisma } from '@prisma/client';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { big, n } from '../../common/money';
import { dbDate } from '../../common/dates';

export interface PostLine {
  account: LedgerAccount;
  /** Debit positive, credit negative. */
  amountCents: number;
}

export interface PostEntry {
  groupId: string;
  entryDate: string;
  type: LedgerEntryType;
  description: string;
  reference?: string | null;
  membershipId?: string | null;
  paymentId?: string | null;
  loanId?: string | null;
  expenseId?: string | null;
  fineId?: string | null;
  roundId?: string | null;
  allocationId?: string | null;
  reason?: string | null;
  createdById?: string | null;
  lines: PostLine[];
}

/**
 * The group's books. Every money movement is a balanced journal entry; the
 * database refuses unbalanced entries and any UPDATE/DELETE of posted rows.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async post(tx: Tx, entry: PostEntry) {
    const lines = entry.lines.filter((l) => l.amountCents !== 0);
    const total = lines.reduce((a, l) => a + l.amountCents, 0);
    if (lines.length < 2 || total !== 0) {
      throw new UnprocessableEntityException('Ledger entry does not balance');
    }
    return tx.journalEntry.create({
      data: {
        groupId: entry.groupId,
        entryDate: dbDate(entry.entryDate),
        type: entry.type,
        description: entry.description,
        reference: entry.reference ?? null,
        membershipId: entry.membershipId ?? null,
        paymentId: entry.paymentId ?? null,
        loanId: entry.loanId ?? null,
        expenseId: entry.expenseId ?? null,
        fineId: entry.fineId ?? null,
        roundId: entry.roundId ?? null,
        allocationId: entry.allocationId ?? null,
        reason: entry.reason ?? null,
        createdById: entry.createdById ?? null,
        lines: { create: lines.map((l) => ({ account: l.account, amountCents: big(l.amountCents) })) },
      },
    });
  }

  /** Posts a mirror-image entry. A journal entry can only ever be reversed once. */
  async reverse(tx: Tx, entryId: string, opts: { reason: string; date: string; createdById: string }) {
    const original = await tx.journalEntry.findUniqueOrThrow({ where: { id: entryId }, include: { lines: true, reversedBy: true } });
    if (original.reversedBy) throw new UnprocessableEntityException('This entry has already been reversed');
    if (original.type === 'REVERSAL') throw new UnprocessableEntityException('A reversal cannot itself be reversed');
    return tx.journalEntry.create({
      data: {
        groupId: original.groupId,
        entryDate: new Date(`${opts.date}T00:00:00.000Z`),
        type: 'REVERSAL',
        description: `Reversal: ${original.description}`,
        reference: original.reference,
        membershipId: original.membershipId,
        paymentId: original.paymentId,
        loanId: original.loanId,
        expenseId: original.expenseId,
        fineId: original.fineId,
        roundId: original.roundId,
        allocationId: original.allocationId,
        reversesId: original.id,
        reason: opts.reason,
        createdById: opts.createdById,
        lines: { create: original.lines.map((l) => ({ account: l.account, amountCents: -l.amountCents })) },
      },
    });
  }

  /** Reverses every not-yet-reversed entry linked to a record (e.g. a payment). */
  async reverseWhere(tx: Tx, where: Prisma.JournalEntryWhereInput, opts: { reason: string; date: string; createdById: string }) {
    const entries = await tx.journalEntry.findMany({
      where: { ...where, type: { not: 'REVERSAL' }, reversedBy: null },
      select: { id: true },
    });
    for (const e of entries) await this.reverse(tx, e.id, opts);
    return entries.length;
  }

  async accountBalance(groupId: string, account: LedgerAccount, opts: { before?: string; until?: string } = {}, tx?: Tx) {
    const client = tx ?? this.prisma;
    const result = await client.journalLine.aggregate({
      _sum: { amountCents: true },
      where: {
        account,
        entry: {
          groupId,
          entryDate: {
            ...(opts.before ? { lt: dbDate(opts.before) } : {}),
            ...(opts.until ? { lte: dbDate(opts.until) } : {}),
          },
        },
      },
    });
    return n(result._sum.amountCents);
  }

  cashBalance(groupId: string, opts: { before?: string; until?: string } = {}, tx?: Tx) {
    return this.accountBalance(groupId, 'CASH', opts, tx);
  }
}

@Global()
@Module({ providers: [LedgerService], exports: [LedgerService] })
export class LedgerModule {}
