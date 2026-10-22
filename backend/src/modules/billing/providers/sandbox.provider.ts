import { Injectable } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../../../config/env';
import { BillingProvider, ChargeRequest, ProviderStatus, WebhookEvent, WebhookRejectedError, WebhookRequest } from './provider';

type Outcome = 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'DISPUTED' | 'REFUNDED';

/**
 * A fake provider for development and automated tests. It behaves like a real one: signed
 * webhooks (HMAC-SHA256 of the raw body), a status API, refunds, and outcomes that can differ
 * from what a webhook claims. It is never available in production and never counts as revenue.
 */
@Injectable()
export class SandboxProvider implements BillingProvider {
  readonly code = 'SANDBOX';
  readonly displayName = 'Sandbox (test only)';
  private readonly charges = new Map<string, { providerRef: string; amountMinor: number; currency: string; status: ProviderStatus['status']; failureReason?: string }>();

  configured() {
    return env().NODE_ENV !== 'production';
  }

  livemode() {
    return false;
  }

  health() {
    return { configured: this.configured(), environment: 'test' as const, note: this.configured() ? 'Test provider for development and automated tests. Never takes real money.' : 'Disabled in production.' };
  }

  async initiate(charge: ChargeRequest) {
    const providerRef = `sbx_${randomBytes(8).toString('hex')}`;
    this.charges.set(charge.reference, { providerRef, amountMinor: charge.amountMinor, currency: charge.currency, status: 'PENDING' });
    return { providerRef, action: { type: 'SANDBOX' as const, message: 'Test mode: no money moves. Use "Simulate payment" to complete it.' } };
  }

  /** Test control: what the "provider" will report for a charge from now on. */
  settle(reference: string, outcome: Outcome, opts: { amountMinor?: number } = {}) {
    const c = this.charges.get(reference);
    if (!c) throw new Error(`Unknown sandbox charge ${reference}`);
    c.status = outcome;
    if (opts.amountMinor !== undefined) c.amountMinor = opts.amountMinor;
    if (outcome === 'FAILED') c.failureReason = 'Declined in sandbox';
    return c;
  }

  /** Builds a webhook exactly as the sandbox "provider" would send it, signed with the secret. */
  signedWebhook(event: { id: string; type: string; reference: string; status?: string }, secret = env().BILLING_SANDBOX_SECRET) {
    const c = this.charges.get(event.reference);
    const body = Buffer.from(JSON.stringify({ id: event.id, type: event.type, livemode: false, data: { reference: event.reference, providerRef: c?.providerRef ?? null, status: event.status ?? c?.status } }));
    return { body, signature: createHmac('sha256', secret).update(body).digest('hex') };
  }

  parseWebhook(req: WebhookRequest): WebhookEvent[] {
    if (!this.configured()) throw new WebhookRejectedError('Sandbox disabled');
    const sig = String(req.headers['x-sandbox-signature'] ?? '');
    const expected = createHmac('sha256', env().BILLING_SANDBOX_SECRET).update(req.rawBody).digest('hex');
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) throw new WebhookRejectedError('Bad signature');
    const json = JSON.parse(req.rawBody.toString('utf8')) as { id: string; type: string; data: { reference: string; providerRef: string | null } };
    return [{ eventId: json.id, type: json.type, reference: json.data.reference, providerRef: json.data.providerRef ?? undefined, livemode: false, payload: json as unknown as Record<string, unknown> }];
  }

  async fetchStatus(payment: { reference: string }): Promise<ProviderStatus> {
    const c = this.charges.get(payment.reference);
    if (!c) return { status: 'PENDING' };
    return { status: c.status, amountMinor: c.amountMinor, currency: c.currency, providerRef: c.providerRef, feeMinor: c.status === 'SUCCEEDED' ? Math.floor(c.amountMinor / 100) : undefined, paidAt: c.status === 'SUCCEEDED' ? new Date() : undefined, failureReason: c.failureReason, providerReceipt: c.status === 'SUCCEEDED' ? `SBX${c.providerRef.slice(-6).toUpperCase()}` : undefined };
  }

  async refund(payment: { reference: string }, amountMinor: number) {
    const c = this.charges.get(payment.reference);
    if (!c) return { providerRef: null, status: 'FAILED' as const };
    return { providerRef: `sbx_rf_${randomBytes(4).toString('hex')}`, status: 'SUCCEEDED' as const, amountMinor };
  }
}
