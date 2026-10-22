import { Injectable, Logger, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../../config/env';
import { BillingProvider, ChargeRequest, PERSONAL_KEYS, ProviderStatus, redactKeys, WebhookEvent, WebhookRejectedError, WebhookRequest } from './provider';

const API = 'https://api.paystack.co';

/**
 * Paystack hosted checkout: cards and local methods in several African countries
 * (which ones is configured per country/currency in billing_provider_availability).
 * Webhooks are signed (HMAC-SHA512 of the raw body with the secret key) and every payment is
 * confirmed with the Verify Transaction API before activation. Test or live mode follows the
 * secret key (sk_test_ / sk_live_).
 *
 * NOT VERIFIED end to end: needs a Paystack account, keys, the webhook URL registered in the
 * Paystack dashboard and a completed test payment.
 */
@Injectable()
export class PaystackProvider implements BillingProvider {
  readonly code = 'PAYSTACK';
  readonly displayName = 'Paystack (card and local methods)';
  private readonly logger = new Logger('Paystack');

  configured() {
    return !!env().PAYSTACK_SECRET_KEY?.trim();
  }

  livemode() {
    return !!env().PAYSTACK_SECRET_KEY?.startsWith('sk_live_');
  }

  health() {
    return {
      configured: this.configured(),
      environment: this.livemode() ? ('live' as const) : ('test' as const),
      note: this.configured() ? 'Key configured. Not verified end to end until a real payment and webhook have been confirmed.' : 'Not configured: set PAYSTACK_SECRET_KEY and register the webhook URL in Paystack.',
    };
  }

  private headers() {
    return { Authorization: `Bearer ${env().PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' };
  }

  async initiate(charge: ChargeRequest) {
    if (!this.configured()) throw new ServiceUnavailableException('Card payments are not enabled yet.');
    if (!charge.email) throw new UnprocessableEntityException('Enter an e-mail address for the card payment receipt.');
    const res = await fetch(`${API}/transaction/initialize`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ email: charge.email, amount: charge.amountMinor, currency: charge.currency, reference: charge.reference, callback_url: env().PAYSTACK_CALLBACK_URL }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { status?: boolean; message?: string; data?: { authorization_url: string; access_code: string } };
    if (!res.ok || !json.status || !json.data) {
      this.logger.warn(`initialize failed: ${json.message ?? res.status}`);
      throw new ServiceUnavailableException(json.message ?? 'The card payment could not be started.');
    }
    return { providerRef: charge.reference, action: { type: 'REDIRECT' as const, url: json.data.authorization_url, message: 'Continue to the secure Paystack page to pay.' } };
  }

  parseWebhook(req: WebhookRequest): WebhookEvent[] {
    const key = env().PAYSTACK_SECRET_KEY;
    if (!key) throw new WebhookRejectedError('Not configured');
    const sig = String(req.headers['x-paystack-signature'] ?? '');
    const expected = createHmac('sha512', key).update(req.rawBody).digest('hex');
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) throw new WebhookRejectedError('Bad signature');
    const json = JSON.parse(req.rawBody.toString('utf8')) as { event: string; data: { id?: number; reference?: string; transaction?: { reference?: string } } };
    const reference = json.data.reference ?? json.data.transaction?.reference;
    return [{ eventId: `${json.event}:${json.data.id ?? reference}`, type: json.event, reference, providerRef: reference, livemode: this.livemode(), payload: redactKeys(json, PERSONAL_KEYS) as Record<string, unknown> }];
  }

  async fetchStatus(payment: { reference: string }): Promise<ProviderStatus> {
    const res = await fetch(`${API}/transaction/verify/${encodeURIComponent(payment.reference)}`, { headers: this.headers(), signal: AbortSignal.timeout(15_000) });
    const json = (await res.json().catch(() => ({}))) as { status?: boolean; data?: { status: string; amount: number; currency: string; fees?: number; paid_at?: string; gateway_response?: string } };
    if (!res.ok || !json.data) return { status: 'PENDING' };
    const d = json.data;
    const status = d.status === 'success' ? 'SUCCEEDED' : d.status === 'reversed' ? 'REFUNDED' : ['failed', 'abandoned'].includes(d.status) ? 'FAILED' : 'PENDING';
    return { status, amountMinor: d.amount, currency: d.currency, providerRef: payment.reference, feeMinor: d.fees, paidAt: d.paid_at ? new Date(d.paid_at) : undefined, failureReason: status === 'FAILED' ? (d.gateway_response ?? d.status) : undefined };
  }

  async refund(payment: { reference: string }, amountMinor: number) {
    const res = await fetch(`${API}/refund`, { method: 'POST', headers: this.headers(), body: JSON.stringify({ transaction: payment.reference, amount: amountMinor }), signal: AbortSignal.timeout(15_000) });
    const json = (await res.json().catch(() => ({}))) as { status?: boolean; data?: { id?: number; status?: string } };
    if (!res.ok || !json.status) return { providerRef: null, status: 'FAILED' as const };
    return { providerRef: json.data?.id ? String(json.data.id) : null, status: json.data?.status === 'processed' ? ('SUCCEEDED' as const) : ('PENDING' as const) };
  }
}
