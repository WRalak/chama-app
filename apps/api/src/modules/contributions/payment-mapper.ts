import { Prisma } from '@prisma/client';
import { PaymentItem } from '@chamahub/shared';
import { n } from '../../common/money';
import { isoDate } from '../../common/dates';
import { PrismaService } from '../../prisma/prisma.service';

export const paymentInclude = {
  group: { select: { name: true } },
  membership: { select: { user: { select: { fullName: true } } } },
  allocations: {
    include: {
      obligation: { select: { periodLabel: true } },
      installment: { select: { number: true } },
      fine: { select: { reason: true } },
    },
  },
} satisfies Prisma.PaymentInclude;

export type PaymentWithRelations = Prisma.PaymentGetPayload<{ include: typeof paymentInclude }>;

export async function toPaymentItems(prisma: PrismaService, rows: PaymentWithRelations[]): Promise<PaymentItem[]> {
  const userIds = [...new Set(rows.flatMap((r) => [r.recordedById, r.verifiedById]).filter(Boolean) as string[])];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } });
  const name = new Map(users.map((u) => [u.id, u.fullName]));
  return rows.map((p) => ({
    id: p.id,
    groupId: p.groupId,
    groupName: p.group.name,
    membershipId: p.membershipId,
    memberName: p.membership?.user.fullName ?? null,
    amountCents: n(p.amountCents),
    method: p.method,
    reference: p.reference,
    purpose: p.purpose,
    status: p.status,
    paidAt: isoDate(p.paidAt),
    recordedByName: p.recordedById ? (name.get(p.recordedById) ?? null) : p.source === 'MANUAL' ? null : 'M-Pesa (automatic)',
    verifiedByName: p.verifiedById ? (name.get(p.verifiedById) ?? null) : p.verifiedAt ? 'System (validated callback)' : null,
    verifiedAt: p.verifiedAt?.toISOString() ?? null,
    notes: p.notes,
    createdAt: p.createdAt.toISOString(),
    allocations: p.allocations.map((a) => ({
      label: a.obligation
        ? a.obligation.periodLabel
        : a.installment
          ? `Installment ${a.installment.number}`
          : a.fine
            ? `Fine: ${a.fine.reason}`
            : 'Advance contribution',
      amountCents: n(a.amountCents),
    })),
  }));
}
