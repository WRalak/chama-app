import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { EVIDENCE_MAX_BYTES, PaymentEventRow, PaymentHistory, Permission, TransactionStatus } from '@chamahub/shared';
import { AuditService } from '../../common/audit.service';
import { isoDate, today } from '../../common/dates';
import { MembershipContext, RequestMeta } from '../../common/request';
import { PrismaService } from '../../prisma/prisma.service';
import { paymentInclude, toPaymentItems } from '../contributions/payment-mapper';

/** Checks the first bytes so a renamed file cannot pass as a photo or PDF. */
function looksLike(mime: string, b: Buffer) {
  switch (mime) {
    case 'image/jpeg':
      return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case 'image/png':
      return b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/webp':
      return b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP';
    case 'image/heic':
      return b.subarray(4, 8).toString('latin1') === 'ftyp';
    case 'application/pdf':
      return b.subarray(0, 5).toString('latin1') === '%PDF-';
    default:
      return false;
  }
}

const STATUS_LABEL: Record<TransactionStatus, string> = {
  SCHEDULED: 'Scheduled',
  PENDING: 'Waiting for confirmation',
  CONFIRMED: 'Confirmed — money received',
  FAILED: 'Marked as not received',
  REVERSED: 'Reversed',
  DISPUTED: 'Disputed',
};

/**
 * Evidence (receipt photos, screenshots, bank slips) and the full history of a
 * payment. Evidence helps an officer decide; it is not proof on its own, and a
 * payment counts only once an officer, a statement or the provider confirms it.
 */
@Injectable()
export class EvidenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async payment(groupId: string, paymentId: string, viewer: MembershipContext) {
    const p = await this.prisma.payment.findFirst({ where: { id: paymentId, groupId } });
    if (!p) throw new NotFoundException('Payment not found');
    const own = !!p.membershipId && p.membershipId === viewer.id;
    if (!own && !viewer.permissions.includes(Permission.CONTRIBUTIONS_VIEW_ALL)) throw new NotFoundException('Payment not found');
    return { p, own };
  }

  async upload(groupId: string, paymentId: string, input: { fileName: string; mimeType: string; dataBase64: string; note?: string }, actor: MembershipContext, meta: RequestMeta) {
    const { p, own } = await this.payment(groupId, paymentId, actor);
    if (!own && !this.isTreasuryOfficer(actor)) throw new ForbiddenException('Only the member or a treasury officer can add evidence to this payment.');
    if (actor.supportGrantId) throw new ForbiddenException('Support access is read-only.');
    const data = Buffer.from(input.dataBase64, 'base64');
    if (!data.length || data.length > EVIDENCE_MAX_BYTES) throw new UnprocessableEntityException('Evidence files must be under 3 MB');
    if (!looksLike(input.mimeType, data)) throw new UnprocessableEntityException('The file does not look like the image or PDF it claims to be');
    const sha256 = createHash('sha256').update(data).digest('hex');
    const dup = await this.prisma.paymentEvidence.findUnique({ where: { paymentId_sha256: { paymentId: p.id, sha256 } } });
    if (dup) throw new ConflictException('This file is already attached to the payment');
    // The same receipt used for a different payment is a red flag worth surfacing.
    const reused = await this.prisma.paymentEvidence.findFirst({ where: { groupId, sha256, paymentId: { not: p.id } }, select: { paymentId: true } });
    const ev = await this.prisma.$transaction(async (tx) => {
      const created = await tx.paymentEvidence.create({
        data: { groupId, paymentId: p.id, fileName: input.fileName.replace(/[^\w.\- ]+/g, '_'), mimeType: input.mimeType, sizeBytes: data.length, sha256, data, note: input.note ?? null, uploadedById: actor.userId },
      });
      await tx.paymentEvent.create({ data: { groupId, paymentId: p.id, kind: 'EVIDENCE_ADDED', actorUserId: actor.userId, note: reused ? `${created.fileName} — the same file is attached to another payment` : created.fileName } });
      await this.audit.log({ groupId, actorUserId: actor.userId, action: 'payment.evidence_added', entityType: 'Payment', entityId: p.id, after: { evidenceId: created.id, fileName: created.fileName, sizeBytes: created.sizeBytes, sha256, reusedFrom: reused?.paymentId ?? null }, reference: p.reference, meta }, tx);
      return created;
    });
    return { id: ev.id, reusedOnAnotherPayment: !!reused };
  }

  private isTreasuryOfficer(v: MembershipContext) {
    return [Permission.CONTRIBUTIONS_RECORD, Permission.CONTRIBUTIONS_VERIFY, Permission.RECONCILIATION_MANAGE].some((x) => v.permissions.includes(x));
  }

  async file(groupId: string, paymentId: string, evidenceId: string, viewer: MembershipContext) {
    await this.payment(groupId, paymentId, viewer);
    const ev = await this.prisma.paymentEvidence.findFirst({ where: { id: evidenceId, paymentId, groupId } });
    if (!ev) throw new NotFoundException('Evidence not found');
    return ev;
  }

  async history(groupId: string, paymentId: string, viewer: MembershipContext): Promise<PaymentHistory> {
    const { p, own } = await this.payment(groupId, paymentId, viewer);
    const [item] = await toPaymentItems(this.prisma, [await this.prisma.payment.findUniqueOrThrow({ where: { id: p.id }, include: paymentInclude })]);
    const [events, evidence, destination] = await Promise.all([
      this.prisma.paymentEvent.findMany({ where: { paymentId: p.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
      this.prisma.paymentEvidence.findMany({ where: { paymentId: p.id }, orderBy: { createdAt: 'asc' }, select: { id: true, fileName: true, mimeType: true, sizeBytes: true, note: true, uploadedById: true, createdAt: true } }),
      p.destinationId ? this.prisma.paymentDestination.findUnique({ where: { id: p.destinationId } }) : null,
    ]);
    const userIds = [...new Set([...events.map((e) => e.actorUserId), ...evidence.map((e) => e.uploadedById)].filter((x): x is string => !!x))];
    const users = await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } });
    const name = new Map(users.map((u) => [u.id, u.fullName]));
    const memberUser = p.membershipId ? (await this.prisma.membership.findUnique({ where: { id: p.membershipId }, select: { userId: true } }))?.userId : null;
    const label = (e: (typeof events)[number]): string => {
      if (e.kind === 'CREATED') {
        if (p.source === 'MPESA_STK') return 'M-Pesa payment request sent to the member’s phone (not yet proof of payment)';
        if (p.source === 'MPESA_C2B') return 'Received through M-Pesa';
        if (p.source === 'STATEMENT') return 'Assigned from an imported statement';
        return e.actorUserId && e.actorUserId === memberUser ? 'Reported by the member' : 'Recorded by an officer';
      }
      if (e.kind === 'EVIDENCE_ADDED') return 'Evidence added';
      if (e.kind === 'STATEMENT_MATCHED') return 'Found on an imported statement';
      if (e.kind === 'DISPUTE_OPENED') return 'Dispute opened';
      return e.toStatus ? STATUS_LABEL[e.toStatus] : e.kind;
    };
    const today_ = today();
    return {
      paymentId: p.id,
      payment: item,
      canAddEvidence: !viewer.supportGrantId && (own || this.isTreasuryOfficer(viewer)),
      destination: destination ? { id: destination.id, displayName: destination.displayName, validNow: destination.status === 'ACTIVE' && (!destination.effectiveTo || isoDate(destination.effectiveTo)! > today_) } : null,
      evidence: evidence.map((e) => ({ id: e.id, fileName: e.fileName, mimeType: e.mimeType, sizeBytes: e.sizeBytes, note: e.note, uploadedByName: name.get(e.uploadedById) ?? '', createdAt: e.createdAt.toISOString() })),
      events: events.map((e): PaymentEventRow => ({
        id: e.id,
        kind: e.kind,
        label: label(e),
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        actorName: e.actorUserId ? (name.get(e.actorUserId) ?? null) : e.kind === 'STATUS_CHANGED' && e.toStatus === 'CONFIRMED' ? 'System (validated provider callback)' : null,
        note: e.note,
        at: e.createdAt.toISOString(),
      })),
    };
  }
}
