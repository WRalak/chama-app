import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { env, mpesaConfigured } from '../../config/env';

/**
 * Minimal Safaricom Daraja client (OAuth + Lipa na M-Pesa Online STK push).
 * NOT verified against a live shortcode. Enable only after sandbox testing
 * with real credentials and Safaricom go-live approval.
 */
@Injectable()
export class DarajaClient {
  private readonly logger = new Logger('Daraja');
  private token: { value: string; expiresAt: number } | null = null;

  get configured() {
    return mpesaConfigured();
  }

  private base() {
    return env().MPESA_ENV === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;
    const e = env();
    const auth = Buffer.from(`${e.MPESA_CONSUMER_KEY}:${e.MPESA_CONSUMER_SECRET}`).toString('base64');
    const res = await fetch(`${this.base()}/oauth/v1/generate?grant_type=client_credentials`, { headers: { Authorization: `Basic ${auth}` }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new ServiceUnavailableException('M-Pesa is unavailable right now. Try again shortly.');
    const json = (await res.json()) as { access_token: string; expires_in: string };
    this.token = { value: json.access_token, expiresAt: Date.now() + Number(json.expires_in) * 1000 };
    return this.token.value;
  }

  async stkPush(input: { phone: string; amountCents: number; accountReference: string; description: string }) {
    if (!this.configured) throw new ServiceUnavailableException('M-Pesa payments are not enabled yet.');
    if (input.amountCents % 100 !== 0) throw new ServiceUnavailableException('M-Pesa only accepts whole shillings.');
    const e = env();
    const timestamp = new Date(Date.now() + 3 * 3600_000).toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const password = Buffer.from(`${e.MPESA_SHORTCODE}${e.MPESA_PASSKEY}${timestamp}`).toString('base64');
    const callback = `${e.MPESA_CALLBACK_URL}${e.MPESA_CALLBACK_URL!.includes('?') ? '&' : '?'}token=${encodeURIComponent(e.MPESA_CALLBACK_TOKEN!)}`;
    const res = await fetch(`${this.base()}/mpesa/stkpush/v1/processrequest`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await this.accessToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        BusinessShortCode: e.MPESA_SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: input.amountCents / 100,
        PartyA: input.phone.replace('+', ''),
        PartyB: e.MPESA_SHORTCODE,
        PhoneNumber: input.phone.replace('+', ''),
        CallBackURL: callback,
        AccountReference: input.accountReference.slice(0, 12),
        TransactionDesc: input.description.slice(0, 13),
      }),
      signal: AbortSignal.timeout(15000),
    });
    const json = (await res.json().catch(() => ({}))) as { ResponseCode?: string; CheckoutRequestID?: string; MerchantRequestID?: string; errorMessage?: string; CustomerMessage?: string };
    if (!res.ok || json.ResponseCode !== '0') {
      this.logger.warn(`STK push rejected: ${json.errorMessage ?? res.status}`);
      throw new ServiceUnavailableException(json.errorMessage ?? 'M-Pesa could not start the payment.');
    }
    return { checkoutRequestId: json.CheckoutRequestID!, merchantRequestId: json.MerchantRequestID ?? null, customerMessage: json.CustomerMessage ?? 'Check your phone to enter your M-Pesa PIN.' };
  }
}
