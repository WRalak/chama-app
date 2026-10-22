/**
 * The contract every subscription-payment provider implements. Subscription logic (activation,
 * renewal, refunds) only talks to this interface, so adding a provider never changes it.
 *
 * Rules every provider must follow:
 * - `parseWebhook` establishes authenticity (signature, secret token) or throws.
 * - Webhook content is never trusted on its own: the service always confirms with `fetchStatus`
 *   (the provider's own status API) before money is treated as received.
 * - Never ask for, receive or store a PIN, password or one-time code.
 */
export type ProviderPaymentStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'REFUNDED' | 'DISPUTED';

export interface ChargeRequest {
  reference: string;
  amountMinor: number;
  currency: string;
  description: string;
  phone?: string;
  email?: string;
}

export interface InitiateResult {
  providerRef: string | null;
  action: { type: 'STK_PROMPT' | 'REDIRECT' | 'INSTRUCTIONS' | 'SANDBOX'; message: string; url?: string; instructions?: string[] };
}

export interface ProviderStatus {
  status: ProviderPaymentStatus;
  amountMinor?: number;
  currency?: string;
  providerRef?: string;
  feeMinor?: number;
  paidAt?: Date;
  failureReason?: string;
  /** e.g. the M-Pesa receipt code. */
  providerReceipt?: string;
}

export interface WebhookEvent {
  /** Unique per provider; duplicate deliveries share it and are processed once. */
  eventId: string;
  type: string;
  reference?: string;
  providerRef?: string;
  livemode: boolean;
  /** Payload with personal data (phone numbers, names, card details) removed. */
  payload: Record<string, unknown>;
}

export interface WebhookRequest {
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
}

export interface ProviderHealth {
  configured: boolean;
  environment: 'test' | 'live';
  /** Honest status line for the admin page. */
  note: string;
}

export interface BillingProvider {
  readonly code: string;
  readonly displayName: string;
  configured(): boolean;
  livemode(): boolean;
  health(): ProviderHealth;
  initiate(charge: ChargeRequest): Promise<InitiateResult>;
  /** Throws WebhookRejectedError when authenticity cannot be established. Some providers (manual) have no webhooks. */
  parseWebhook?(req: WebhookRequest): WebhookEvent[];
  fetchStatus(payment: { reference: string; providerRef: string | null; amountMinor: number; currency: string }): Promise<ProviderStatus>;
  /** Present only where the provider can refund through its API. */
  refund?(payment: { reference: string; providerRef: string | null; currency: string }, amountMinor: number, reason: string): Promise<{ providerRef: string | null; status: 'PENDING' | 'SUCCEEDED' | 'FAILED' }>;
  /** What the provider expects as the HTTP response to a webhook. */
  webhookAck?(): unknown;
}

export class WebhookRejectedError extends Error {}

export const redactKeys = (obj: unknown, keys: RegExp): unknown => {
  if (Array.isArray(obj)) return obj.map((v) => redactKeys(v, keys));
  if (obj && typeof obj === 'object') {
    return Object.fromEntries(Object.entries(obj as Record<string, unknown>).map(([k, v]) => [k, keys.test(k) ? '[redacted]' : redactKeys(v, keys)]));
  }
  return obj;
};

/** Personal or card data that must never be stored from a provider payload. */
export const PERSONAL_KEYS = /phone|msisdn|email|first_?name|last_?name|middle_?name|customer|authorization|card|bin|last4|account_?name|ip_?address|metadata/i;
