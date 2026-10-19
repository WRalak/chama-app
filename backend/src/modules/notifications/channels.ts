import { Injectable, Logger } from '@nestjs/common';
import { emailConfigured, env, smsConfigured, whatsappConfigured } from '../../config/env';

export interface ChannelResult {
  ok: boolean;
  provider: string;
  error?: string;
  skipped?: boolean;
}

/**
 * SMS via Africa's Talking. When credentials are absent the message is NOT
 * sent; in development it is written to the log so flows can be exercised.
 * This integration has not been verified against a production account.
 */
@Injectable()
export class SmsChannel {
  private readonly logger = new Logger('SMS');

  get configured() {
    return smsConfigured();
  }

  async send(phone: string, message: string): Promise<ChannelResult> {
    const e = env();
    if (!this.configured) {
      if (e.NODE_ENV !== 'production') this.logger.log(`[dev, not sent] to ${phone}: ${message}`);
      return { ok: false, skipped: true, provider: 'none', error: 'SMS provider not configured' };
    }
    const base = e.AT_USERNAME === 'sandbox' ? 'https://api.sandbox.africastalking.com' : 'https://api.africastalking.com';
    const body = new URLSearchParams({ username: e.AT_USERNAME!, to: phone, message });
    if (e.AT_SENDER_ID) body.set('from', e.AT_SENDER_ID);
    try {
      const res = await fetch(`${base}/version1/messaging`, {
        method: 'POST',
        headers: { apiKey: e.AT_API_KEY!, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return { ok: false, provider: 'africastalking', error: `HTTP ${res.status}` };
      const json = (await res.json()) as { SMSMessageData?: { Recipients?: { status: string }[] } };
      const status = json.SMSMessageData?.Recipients?.[0]?.status;
      return status === 'Success' ? { ok: true, provider: 'africastalking' } : { ok: false, provider: 'africastalking', error: status ?? 'Unknown response' };
    } catch (err) {
      return { ok: false, provider: 'africastalking', error: (err as Error).message };
    }
  }
}

/** WhatsApp Business Cloud API. Requires an approved business account and pre-approved templates. */
@Injectable()
export class WhatsAppChannel {
  get configured() {
    return whatsappConfigured();
  }

  async send(phone: string, message: string): Promise<ChannelResult> {
    if (!this.configured) return { ok: false, skipped: true, provider: 'none', error: 'WhatsApp not configured' };
    const e = env();
    try {
      const res = await fetch(`https://graph.facebook.com/v20.0/${e.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${e.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: phone.replace('+', ''), type: 'text', text: { body: message } }),
        signal: AbortSignal.timeout(10000),
      });
      return res.ok ? { ok: true, provider: 'whatsapp-cloud' } : { ok: false, provider: 'whatsapp-cloud', error: `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, provider: 'whatsapp-cloud', error: (err as Error).message };
    }
  }
}

/** Email is delivered by POSTing to a configured relay webhook (e.g. a transactional email service). */
@Injectable()
export class EmailChannel {
  get configured() {
    return emailConfigured();
  }

  async send(to: string, subject: string, text: string): Promise<ChannelResult> {
    if (!this.configured) return { ok: false, skipped: true, provider: 'none', error: 'Email not configured' };
    try {
      const res = await fetch(env().EMAIL_WEBHOOK_URL!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, subject, text }),
        signal: AbortSignal.timeout(10000),
      });
      return res.ok ? { ok: true, provider: 'email-webhook' } : { ok: false, provider: 'email-webhook', error: `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, provider: 'email-webhook', error: (err as Error).message };
    }
  }
}
