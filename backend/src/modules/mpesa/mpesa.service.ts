import { ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { timingSafeEqual } from 'node:crypto';
import { formatKes } from '@chamahub/shared';
import { AuditService } from '../../common/audit.service';
import { dbDate, today } from '../../common/dates';
import { big, n } from '../../common/money';
import { MembershipContext, RequestMeta } from '../../common/request';
import { env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { readSettings } from '../finance/policies';
import { PostingService } from '../finance/posting.service';
import { ContributionsService } from '../contributions/contributions.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DarajaClient } from './daraja.client';
import { SecurityEventsService } from '../../common/security-events';

interface StkCallbackBody {
  Body?: {
    stkCallback?: {
      MerchantRequestID?: string;
      CheckoutRequestID?: string;
      ResultCode?: number;
      ResultDesc?: string;
      CallbackMetadata?: { Item?: { Name: string; Value?: string | number }[] };
    };
  };
}

export const STK_LIMITS = { perPhonePerHour: 5, perMemberPerHour: 10 };

export function callbackTokenValid(token: string | undefined): boolean {
  const expected = env().MPESA_CALLBACK_TOKEN;
  if (!expected || !token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

@Injectable()
export class MpesaService {
  private readonly logger = new Logger('MpesaCallbacks');

  constructor(
    private readonly prisma: PrismaService,
    private readonly daraja: DarajaClient,
    private readonly posting: PostingService,
    private readonly contributions: ContributionsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly security: SecurityEventsService,
  ) {}

  /** Member-initiated STK push. The payment stays PENDING until Safaricom's callback confirms it. */
  async initiate(groupId: string, input: { amountCents: number; phone: string; purpose: 'CONTRIBUTION' | 'LOAN_REPAYMENT' | 'FINE'; targetId?: string; idempotencyKey: string }, actor: MembershipContext, meta: RequestMeta) {
    if (!this.daraja.configured) throw new ServiceUnavailableException('M-Pesa payments are not enabled for ChamaHub yet. Pay your treasurer and they will record it.');
    if (!actor.id) throw new ForbiddenException('Only members can pay');
    const existing = await this.prisma.payment.findUnique({ where: { groupId_idempotencyKey: { groupId, idempotencyKey: input.idempotencyKey } }, include: { mpesaRequest: true } });
    if (existing) {
      if (existing.membershipId !== actor.id) throw new ConflictException('This request was already used. Start a new payment.');
      return { paymentId: existing.id, status: existing.status, replayed: true };
    }
    await this.contributions.validateTarget(groupId, actor.id, input.purpose, input.targetId, input.amountCents);
    // Every STK push makes a real phone ring for a PIN. Cap them so the feature cannot be used to
    // pester or trick someone else's phone, even within the per-minute request limit.
    const hourAgo = new Date(Date.now() - 3600_000);
    const [toPhone, byMember] = await Promise.all([
      this.prisma.mpesaRequest.count({ where: { phone: input.phone, createdAt: { gt: hourAgo } } }),
      this.prisma.mpesaRequest.count({ where: { payment: { membershipId: actor.id }, createdAt: { gt: hourAgo } } }),
    ]);
    if (toPhone >= STK_LIMITS.perPhonePerHour || byMember >= STK_LIMITS.perMemberPerHour) {
      throw new HttpException('Too many M-Pesa prompts in the last hour. Wait a while, or pay your treasurer directly.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const group = await this.prisma.group.findUniqueOrThrow({ where: { id: groupId }, select: { name: true, settings: true } });
    const payment = await this.prisma.payment.create({
      data: { groupId, membershipId: actor.id, amountCents: big(input.amountCents), method: 'MPESA', source: 'MPESA_STK', purpose: input.purpose, status: 'PENDING', paidAt: dbDate(today()), idempotencyKey: input.idempotencyKey, targetId: input.targetId ?? null, recordedById: null, notes: 'M-Pesa STK push' },
    });
    try {
      const r = await this.daraja.stkPush({ phone: input.phone, amountCents: input.amountCents, accountReference: readSettings(group.settings).accountReferencePrefix ?? 'CHAMAHUB', description: 'Contribution' });
      await this.prisma.mpesaRequest.create({ data: { groupId, paymentId: payment.id, checkoutRequestId: r.checkoutRequestId, merchantRequestId: r.merchantRequestId, phone: input.phone, amountCents: big(input.amountCents) } });
      await this.audit.log({ groupId, actorUserId: actor.userId, action: 'mpesa.stk_initiated', entityType: 'Payment', entityId: payment.id, after: { amountCents: input.amountCents, checkoutRequestId: r.checkoutRequestId }, meta });
      return { paymentId: payment.id, status: 'PENDING', message: r.customerMessage };
    } catch (err) {
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', failureReason: (err as Error).message } });
      throw err;
    }
  }

  /**
   * Handles Safaricom's STK callback. Idempotent: repeated callbacks for the
   * same CheckoutRequestID, or a reused receipt number, never post twice.
   */
  async handleStkCallback(body: StkCallbackBody): Promise<{ ResultCode: number; ResultDesc: string }> {
    const cb = body.Body?.stkCallback;
    if (!cb?.CheckoutRequestID) return { ResultCode: 0, ResultDesc: 'Ignored' };
    const req = await this.prisma.mpesaRequest.findUnique({ where: { checkoutRequestId: cb.CheckoutRequestID }, include: { payment: true } });
    if (!req) {
      this.logger.warn(`Callback for unknown CheckoutRequestID ${cb.CheckoutRequestID}`);
      return { ResultCode: 0, ResultDesc: 'Accepted' };
    }
    if (req.status !== 'INITIATED') return { ResultCode: 0, ResultDesc: 'Already processed' };
    const items = new Map((cb.CallbackMetadata?.Item ?? []).map((i) => [i.Name, i.Value]));
    const receipt = items.get('MpesaReceiptNumber') ? String(items.get('MpesaReceiptNumber')) : null;
    const amountCents = Math.round(Number(items.get('Amount') ?? 0)) * 100;
    const raw = body as unknown as Prisma.InputJsonValue;

    if (cb.ResultCode !== 0) {
      await this.prisma.$transaction([
        this.prisma.mpesaRequest.update({ where: { id: req.id }, data: { status: 'FAILED', resultCode: cb.ResultCode ?? null, resultDesc: cb.ResultDesc ?? null, rawCallback: raw } }),
        this.prisma.payment.updateMany({ where: { id: req.paymentId, status: 'PENDING' }, data: { status: 'FAILED', failureReason: cb.ResultDesc ?? 'Cancelled' } }),
      ]);
      return { ResultCode: 0, ResultDesc: 'Accepted' };
    }
    // Backend validation: the confirmed amount must match what was requested.
    if (amountCents !== n(req.amountCents) || !receipt) {
      await this.prisma.mpesaRequest.update({ where: { id: req.id }, data: { status: 'FAILED', resultCode: cb.ResultCode, resultDesc: `Validation failed: expected ${formatKes(n(req.amountCents))}, got ${formatKes(amountCents)}`, rawCallback: raw } });
      await this.prisma.payment.updateMany({ where: { id: req.paymentId, status: 'PENDING' }, data: { status: 'DISPUTED', failureReason: 'M-Pesa amount mismatch' } });
      return { ResultCode: 0, ResultDesc: 'Accepted' };
    }
    return this.confirmWithProvider(req.id, raw);
  }

  /**
   * Safaricom does not sign callbacks, so a "success" callback alone is never enough to move money
   * in the ledger: the outcome is confirmed with Daraja's STK query first. If Safaricom is still
   * processing or cannot be reached, the callback is kept and retried by `retryUnconfirmed`.
   */
  private async confirmWithProvider(requestId: string, raw: Prisma.InputJsonValue): Promise<{ ResultCode: number; ResultDesc: string }> {
    const req = await this.prisma.mpesaRequest.findUniqueOrThrow({ where: { id: requestId }, include: { payment: true } });
    if (req.status !== 'INITIATED' || !req.checkoutRequestId) return { ResultCode: 0, ResultDesc: 'Already processed' };
    const items = new Map((((raw as StkCallbackBody).Body?.stkCallback?.CallbackMetadata?.Item) ?? []).map((i) => [i.Name, i.Value]));
    const receipt = String(items.get('MpesaReceiptNumber'));
    const amountCents = n(req.amountCents);

    let verdict: Awaited<ReturnType<DarajaClient['stkQuery']>>;
    if (this.daraja.configured) verdict = await this.daraja.stkQuery(req.checkoutRequestId);
    else if (env().NODE_ENV === 'production') verdict = { state: 'PENDING', resultCode: null, resultDesc: 'M-Pesa is not configured, so the callback cannot be confirmed' };
    else verdict = { state: 'SUCCESS', resultCode: '0', resultDesc: 'Not verified: Daraja is not configured (development/test only)' };

    if (verdict.state === 'PENDING') {
      await this.prisma.mpesaRequest.updateMany({ where: { id: req.id, status: 'INITIATED' }, data: { rawCallback: raw, resultDesc: `Awaiting confirmation from M-Pesa (${verdict.resultDesc ?? 'processing'})` } });
      return { ResultCode: 0, ResultDesc: 'Accepted' };
    }
    if (verdict.state === 'FAILED') {
      // A success callback that Safaricom does not confirm is a forgery signal: never post it.
      this.logger.warn(`STK callback for ${req.checkoutRequestId} not confirmed by M-Pesa (code ${verdict.resultCode})`);
      await this.prisma.$transaction([
        this.prisma.mpesaRequest.updateMany({ where: { id: req.id, status: 'INITIATED' }, data: { status: 'FAILED', resultCode: Number(verdict.resultCode) || null, resultDesc: `M-Pesa did not confirm this payment: ${verdict.resultDesc ?? verdict.resultCode}`, rawCallback: raw } }),
        this.prisma.payment.updateMany({ where: { id: req.paymentId, status: 'PENDING' }, data: { status: 'FAILED', failureReason: 'M-Pesa did not confirm the payment' } }),
      ]);
      await this.audit.log({ groupId: req.groupId, action: 'mpesa.callback_not_confirmed', entityType: 'Payment', entityId: req.paymentId, after: { resultCode: verdict.resultCode } });
      this.security.record({ type: 'payment.callback_not_confirmed', groupId: req.groupId, route: 'mpesa/stk-callback', detail: `checkout ${req.checkoutRequestId}` });
      return { ResultCode: 0, ResultDesc: 'Accepted' };
    }
    try {
      await this.prisma.financial(async (tx) => {
        const claimed = await tx.mpesaRequest.updateMany({ where: { id: req.id, status: 'INITIATED' }, data: { status: 'SUCCESS', resultCode: 0, resultDesc: verdict.resultDesc, receiptNumber: receipt, rawCallback: raw } });
        if (claimed.count !== 1) return;
        await tx.payment.update({ where: { id: req.paymentId }, data: { reference: receipt } });
        await this.posting.confirm(tx, req.paymentId, null);
        await this.audit.log({ groupId: req.groupId, action: 'mpesa.payment_confirmed', entityType: 'Payment', entityId: req.paymentId, reference: receipt, after: { amountCents, providerConfirmed: this.daraja.configured } }, tx);
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        this.logger.warn(`Duplicate M-Pesa receipt ${receipt} ignored`);
        this.security.record({ type: 'payment.duplicate_receipt', groupId: req.groupId, route: 'mpesa/stk-callback' });
        return { ResultCode: 0, ResultDesc: 'Duplicate' };
      }
      throw err;
    }
    if (req.payment.membershipId) {
      const m = await this.prisma.membership.findUnique({ where: { id: req.payment.membershipId }, select: { userId: true } });
      if (m) await this.notifications.notify([m.userId], { groupId: req.groupId, type: 'PAYMENT_CONFIRMED', title: 'M-Pesa payment received', body: `${formatKes(amountCents)} confirmed, receipt ${receipt}.` });
    }
    return { ResultCode: 0, ResultDesc: 'Accepted' };
  }

  /** Re-checks success callbacks M-Pesa had not confirmed yet; gives up after 24 hours (officers then check the statement). */
  @Cron(CronExpression.EVERY_5_MINUTES)
  scheduledRetry() {
    if (env().DISABLE_JOBS) return;
    return this.retryUnconfirmed().catch((err) => this.logger.error(`M-Pesa confirmation retry failed: ${(err as Error).message}`));
  }

  async retryUnconfirmed(minAgeMs = 60_000) {
    const waiting = await this.prisma.mpesaRequest.findMany({ where: { status: 'INITIATED', rawCallback: { not: Prisma.AnyNull }, updatedAt: { lt: new Date(Date.now() - minAgeMs) } }, take: 100, orderBy: { updatedAt: 'asc' } });
    for (const r of waiting) {
      if (r.createdAt < new Date(Date.now() - 24 * 3600_000)) {
        await this.prisma.mpesaRequest.updateMany({ where: { id: r.id, status: 'INITIATED' }, data: { status: 'TIMEOUT', resultDesc: 'M-Pesa never confirmed this payment. Check the M-Pesa statement before recording it.' } });
        continue;
      }
      await this.confirmWithProvider(r.id, r.rawCallback as Prisma.InputJsonValue).catch((err) => this.logger.warn(`Retry for ${r.id} failed: ${(err as Error).message}`));
    }
    return { checked: waiting.length };
  }

  /** C2B (paybill) confirmations land in reconciliation for officers to match. */
  async handleC2bConfirmation(body: { TransID?: string; TransAmount?: string; MSISDN?: string; FirstName?: string; BillRefNumber?: string; TransTime?: string }) {
    if (!body.TransID || !body.TransAmount) return { ResultCode: 0, ResultDesc: 'Accepted' };
    const groups = await this.prisma.group.findMany({ where: { status: 'ACTIVE' }, select: { id: true, settings: true } });
    const ref = (body.BillRefNumber ?? '').toUpperCase();
    const group = groups.find((g) => {
      const prefix = readSettings(g.settings).accountReferencePrefix?.toUpperCase();
      return prefix && ref.startsWith(prefix);
    });
    const t = body.TransTime && /^\d{14}$/.test(body.TransTime) ? new Date(`${body.TransTime.slice(0, 4)}-${body.TransTime.slice(4, 6)}-${body.TransTime.slice(6, 8)}T${body.TransTime.slice(8, 10)}:${body.TransTime.slice(10, 12)}:${body.TransTime.slice(12, 14)}+03:00`) : new Date();
    await this.prisma.unmatchedPayment
      .create({
        data: { groupId: group?.id ?? null, source: 'MPESA_C2B', amountCents: big(Math.round(Number(body.TransAmount) * 100)), reference: body.TransID.toUpperCase(), payerPhone: body.MSISDN ? `+${body.MSISDN.replace(/^\+/, '')}` : null, payerName: body.FirstName ?? null, accountReference: body.BillRefNumber ?? null, receivedAt: t, raw: body as Prisma.InputJsonValue },
      })
      .catch((err) => {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null; // duplicate notification
        throw err;
      });
    return { ResultCode: 0, ResultDesc: 'Accepted' };
  }
}
