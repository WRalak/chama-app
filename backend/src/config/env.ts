import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  OTP_SECRET: z.string().min(32, 'OTP_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(30),
  CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:8081'),
  DEV_LOG_OTP: bool,
  // ---- Platform administration portal (staff accounts; separate from member sign-in) ----
  /** Signs staff tokens. If unset, a separate key is derived from JWT_ACCESS_SECRET, so member tokens never work on the portal. */
  PLATFORM_JWT_SECRET: z.string().min(32, 'PLATFORM_JWT_SECRET must be at least 32 characters').optional().or(z.literal('').transform(() => undefined)),
  PLATFORM_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(600),
  /** A staff session ends after this long without activity… */
  PLATFORM_SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(24 * 60).default(30),
  /** …and always after this long. */
  PLATFORM_SESSION_MAX_HOURS: z.coerce.number().int().min(1).max(7 * 24).default(12),
  PLATFORM_INVITE_TTL_HOURS: z.coerce.number().int().min(1).max(14 * 24).default(72),
  PLATFORM_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(24 * 60).default(30),
  /** Where invitation and reset links point (the web app's origin). */
  PLATFORM_PORTAL_URL: z.string().url().default('http://localhost:3000'),
  /** Optional: receives a small JSON report (no request data) for every 5xx, e.g. a Slack/Teams/alerting webhook. */
  // ---- Subscription billing (ChamaHub's own fees; separate from groups' M-Pesa) ----
  /** Public base URL providers call back, e.g. https://api.example.co.ke/v1/billing/webhooks */
  BILLING_CALLBACK_BASE_URL: z.string().url().optional().or(z.literal('').transform(() => undefined)),
  /** Secret in M-Pesa callback URLs (Daraja does not sign callbacks). */
  BILLING_WEBHOOK_TOKEN: z.string().min(24).optional().or(z.literal('').transform(() => undefined)),
  BILLING_MPESA_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  BILLING_MPESA_CONSUMER_KEY: z.string().optional(),
  BILLING_MPESA_CONSUMER_SECRET: z.string().optional(),
  BILLING_MPESA_SHORTCODE: z.string().optional(),
  BILLING_MPESA_PASSKEY: z.string().optional(),
  BILLING_MPESA_TRANSACTION_TYPE: z.enum(['CustomerPayBillOnline', 'CustomerBuyGoodsOnline']).default('CustomerPayBillOnline'),
  /** Till number for Buy Goods; defaults to the shortcode. */
  BILLING_MPESA_PARTY_B: z.string().optional(),
  PAYSTACK_SECRET_KEY: z.string().optional(),
  /** Where Paystack sends the payer back after checkout (the web billing page). */
  PAYSTACK_CALLBACK_URL: z.string().url().optional().or(z.literal('').transform(() => undefined)),
  /** HMAC secret for the development/test sandbox provider. Ignored in production. */
  BILLING_SANDBOX_SECRET: z.string().default('chamahub-sandbox-secret-not-for-production'),
  /** Bank transfer instructions shown for manual (invoice) payments. */
  BILLING_MANUAL_INSTRUCTIONS: z.string().optional(),
  /** Shown on subscription receipts. Add a tax registration (e.g. KRA PIN) only once registered. */
  BILLING_SELLER_NAME: z.string().default('ChamaHub'),
  BILLING_SELLER_ADDRESS: z.string().optional(),
  BILLING_SELLER_EMAIL: z.string().optional(),
  BILLING_SELLER_TAX_ID: z.string().optional(),
  ERROR_WEBHOOK_URL: z.string().url().optional().or(z.literal('').transform(() => undefined)),
  AT_USERNAME: z.string().optional(),
  AT_API_KEY: z.string().optional(),
  AT_SENDER_ID: z.string().optional(),
  EMAIL_WEBHOOK_URL: z.string().optional(),
  WHATSAPP_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  MPESA_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  MPESA_CONSUMER_KEY: z.string().optional(),
  MPESA_CONSUMER_SECRET: z.string().optional(),
  MPESA_SHORTCODE: z.string().optional(),
  MPESA_PASSKEY: z.string().optional(),
  MPESA_CALLBACK_URL: z.string().optional(),
  MPESA_CALLBACK_TOKEN: z.string().optional(),
  DISABLE_JOBS: bool,
  /** AI assistant. Without a provider the assistant is off and its record cards still work. */
  AI_PROVIDER: z.enum(['anthropic', 'disabled']).default('anthropic'),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('claude-opus-5-5'),
  AI_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('medium'),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600_000).default(60_000),
  AI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  AI_MAX_TOOL_ROUNDS: z.coerce.number().int().min(1).max(12).default(6),
  AI_DAILY_REQUESTS_PER_USER: z.coerce.number().int().min(0).default(40),
  AI_MONTHLY_BUDGET_USD_PER_GROUP: z.coerce.number().min(0).default(10),
  AI_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  if (parsed.data.NODE_ENV === 'production' && parsed.data.DEV_LOG_OTP) {
    throw new Error('DEV_LOG_OTP must not be enabled in production');
  }
  if (parsed.data.NODE_ENV === 'production' && process.env.DISABLE_THROTTLE === 'true') {
    throw new Error('DISABLE_THROTTLE must not be set in production');
  }
  cached = parsed.data;
  return cached;
}

/** Test helper — forces env() to re-read process.env. */
export function resetEnvCache() {
  cached = null;
}

const blank = (v?: string) => !v || v.trim() === '';

export function mpesaConfigured(e: Env = env()): boolean {
  return ![e.MPESA_CONSUMER_KEY, e.MPESA_CONSUMER_SECRET, e.MPESA_SHORTCODE, e.MPESA_PASSKEY, e.MPESA_CALLBACK_URL, e.MPESA_CALLBACK_TOKEN].some(blank);
}
export function smsConfigured(e: Env = env()): boolean {
  return !blank(e.AT_USERNAME) && !blank(e.AT_API_KEY);
}
export function whatsappConfigured(e: Env = env()): boolean {
  return !blank(e.WHATSAPP_TOKEN) && !blank(e.WHATSAPP_PHONE_NUMBER_ID);
}
export function emailConfigured(e: Env = env()): boolean {
  return !blank(e.EMAIL_WEBHOOK_URL);
}
export function aiConfigured(e: Env = env()): boolean {
  return e.AI_PROVIDER === 'anthropic' && !blank(e.ANTHROPIC_API_KEY);
}
