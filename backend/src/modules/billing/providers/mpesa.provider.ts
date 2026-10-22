import { Injectable, Logger, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { env } from '../../../config/env';
import { BillingProvider, ChargeRequest, ProviderStatus, redactKeys, WebhookEvent, WebhookRejectedError, WebhookRequest } from './provider';

interface StkCallback {
  Body?: { stkCallback?: { MerchantRequestID?: string; CheckoutRequestID?: string; ResultCode?: number; ResultDesc?: string; CallbackMetadata?: { Item?: { Name: string; Value?: string | number }[] } } };
}

const blank = (v?: string) => !v || !v.trim();

/**
 * Safaricom M-Pesa (Daraja) Lipa na M-Pesa Online for ChamaHub's OWN subscription fees, with
 * ChamaHub's own shortcode and credentials (never a group's).
 *
 * Daraja does not sign callbacks, so a callback is accepted only with the secret token in its
 * URL, and is then confirmed with the STK Query API before anything is activated. The amount is
 * fixed by ChamaHub in the STK request and cannot be changed by the payer.
 *
 * NOT VERIFIED against a live shortcode. Needs Safaricom go-live approval and an end-to-end test.
 */
@Injectable()
export class MpesaBillingProvider implements BillingProvider {
  readonly code = 'MPESA_DARAJA';
  readonly displayName = 'M-Pesa (Daraja STK push)';
  private readonly logger = new Logger('MpesaBilling');
  private token: { value: string; expiresAt: number } | null = null;

  configured() {
    const e = env();
    return ![e.BILLING_MPESA_CONSUMER_KEY, e.BILLING_MPESA_CONSUMER_SECRET, e.BILLING_MPESA_SHORTCODE, e.BILLING_MPESA_PASSKEY, e.BILLING_CALLBACK_BASE_URL, e.BILLING_WEBHOOK_TOKEN].some(blank);
  }

  livemode() {
    return env().BILLING_MPESA_ENV === 'production';
  }

  health() {
    return {
      configured: this.configured(),
      environment: this.livemode() ? ('live' as const) : ('test' as const),
      note: this.configured() ? `Configured (${env().BILLING_MPESA_ENV}). Not verified end to end until a real payment has been completed and confirmed.` : 'Not configured: set BILLING_MPESA_* , BILLING_CALLBACK_BASE_URL and BILLING_WEBHOOK_TOKEN.',
    };
  }

  private base() {
    return this.livemode() ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';
  }

  private async accessToken() {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;
    const e = env();
    const auth = Buffer.from(`${e.BILLING_MPESA_CONSUMER_KEY}:${e.BILLING_MPESA_CONSUMER_SECRET}`).toString('base64');
    const res = await fetch(`${this.base()}/oauth/v1/generate?grant_type=client_credentials`, { headers: { Authorization: `Basic ${auth}` }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new ServiceUnavailableException('M-Pesa is unavailable right now. Try again shortly.');
    const json = (await res.json()) as { access_token: string; expires_in: string };
    this.token = { value: json.access_token, expiresAt: Date.now() + Number(json.expires_in) * 1000 };
    return this.token.value;
  }

  private password() {
    const e = env();
    const timestamp = new Date(Date.now() + 3 * 3600_000).toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    return { timestamp, password: Buffer.from(`${e.BILLING_MPESA_SHORTCODE}${e.BILLING_MPESA_PASSKEY}${timestamp}`).toString('base64') };
  }

  async initiate(charge: ChargeRequest) {
    if (!this.configured()) throw new ServiceUnavailableException('M-Pesa subscription payments are not enabled yet.');
    if (charge.currency !== 'KES') throw new UnprocessableEntityException('M-Pesa only accepts Kenyan shillings.');
    if (charge.amountMinor % 100 !== 0) throw new UnprocessableEntityException('M-Pesa only accepts whole shillings.');
    if (!charge.phone) throw new UnprocessableEntityException('Enter the M-Pesa phone number that should receive the payment prompt.');
    const e = env();
    const { timestamp, password } = this.password();
    const res = await fetch(`${this.base()}/mpesa/stkpush/v1/processrequest`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await this.accessToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        BusinessShortCode: e.BILLING_MPESA_SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        TransactionType: e.BILLING_MPESA_TRANSACTION_TYPE,
        Amount: charge.amountMinor / 100,
        PartyA: charge.phone.replace('+', ''),
        PartyB: e.BILLING_MPESA_PARTY_B || e.BILLING_MPESA_SHORTCODE,
        PhoneNumber: charge.phone.replace('+', ''),
        CallBackURL: `${e.BILLING_CALLBACK_BASE_URL}/${this.code}?token=${encodeURIComponent(e.BILLING_WEBHOOK_TOKEN!)}`,
        AccountReference: charge.reference.slice(0, 12),
        TransactionDesc: 'ChamaHub plan',
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { ResponseCode?: string; CheckoutRequestID?: string; errorMessage?: string; CustomerMessage?: string };
    if (!res.ok || json.ResponseCode !== '0') {
      this.logger.warn(`STK push rejected: ${json.errorMessage ?? res.status}`);
      throw new ServiceUnavailableException(json.errorMessage ?? 'M-Pesa could not start the payment.');
    }
    return { providerRef: json.CheckoutRequestID!, action: { type: 'STK_PROMPT' as const, message: 'Check your phone and enter your M-Pesa PIN there. ChamaHub never asks for your PIN.' } };
  }

  parseWebhook(req: WebhookRequest): WebhookEvent[] {
    const expected = env().BILLING_WEBHOOK_TOKEN;
    const got = typeof req.query.token === 'string' ? req.query.token : '';
    if (!expected || got.length !== expected.length || !timingSafeEqual(Buffer.from(got), Buffer.from(expected))) throw new WebhookRejectedError('Bad callback token');
    const body = JSON.parse(req.rawBody.toString('utf8')) as StkCallback;
    const cb = body.Body?.stkCallback;
    if (!cb?.CheckoutRequestID) throw new WebhookRejectedError('Not an STK callback');
    // Callback metadata is a list of {Name, Value}: remove the payer's phone number by item, not by key.
    const items = cb.CallbackMetadata?.Item?.map((i) => (/phone/i.test(i.Name) ? { Name: i.Name, Value: '[redacted]' } : i));
    const safe = { Body: { stkCallback: { ...cb, ...(items ? { CallbackMetadata: { Item: items } } : {}) } } };
    return [{ eventId: `${cb.CheckoutRequestID}:${cb.ResultCode ?? 'x'}`, type: cb.ResultCode === 0 ? 'stk.success' : 'stk.failed', providerRef: cb.CheckoutRequestID, livemode: this.livemode(), payload: redactKeys(safe, /PhoneNumber|MSISDN/i) as Record<string, unknown> }];
  }

  webhookAck() {
    return { ResultCode: 0, ResultDesc: 'Accepted' };
  }

  /** STK Query: the trusted answer. ResultCode 0 = paid; 1032 = cancelled by the payer. */
  async fetchStatus(payment: { providerRef: string | null; amountMinor: number; currency: string }): Promise<ProviderStatus> {
    if (!payment.providerRef || !this.configured()) return { status: 'PENDING' };
    const e = env();
    const { timestamp, password } = this.password();
    const res = await fetch(`${this.base()}/mpesa/stkpushquery/v1/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await this.accessToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ BusinessShortCode: e.BILLING_MPESA_SHORTCODE, Password: password, Timestamp: timestamp, CheckoutRequestID: payment.providerRef }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { ResultCode?: string; ResultDesc?: string; errorCode?: string; errorMessage?: string };
    if (json.ResultCode === undefined) return { status: 'PENDING' }; // still processing, or Daraja unavailable
    if (json.ResultCode === '0') return { status: 'SUCCEEDED', amountMinor: payment.amountMinor, currency: 'KES', providerRef: payment.providerRef, paidAt: new Date() };
    if (json.ResultCode === '1032') return { status: 'CANCELLED', failureReason: 'Cancelled on the phone' };
    return { status: 'FAILED', failureReason: json.ResultDesc ?? `M-Pesa result ${json.ResultCode}` };
  }

  /** The M-Pesa receipt code from a callback (STK Query does not return it). */
  receiptFromPayload(payload: Record<string, unknown>): string | undefined {
    const items = (payload as StkCallback).Body?.stkCallback?.CallbackMetadata?.Item ?? [];
    const r = items.find((i) => i.Name === 'MpesaReceiptNumber')?.Value;
    return typeof r === 'string' ? r : undefined;
  }
}
