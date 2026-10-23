import { Injectable } from '@nestjs/common';
import { Prisma, PlatformAuditOutcome } from '@prisma/client';
import { RequestMeta } from '../../common/request';
import { PrismaService } from '../../prisma/prisma.service';

export interface PlatformAuditInput {
  actorAccountId?: string | null;
  /** For actions without an account: the e-mail tried at sign-in, or "system". */
  actorLabel?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  outcome?: PlatformAuditOutcome;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
  meta?: RequestMeta;
}

// Values under these keys are never written to the audit trail, whatever the caller passes.
// (planCode, countryCode and the like are ordinary data and stay.)
const SECRET_PART = /password|passcode|secret|token|otp|api_?key|authorization|cookie|credential/i;
const SECRET_EXACT = /^(pin|code|mfaCode|hash)$|(Hash|Pin)$/;
const isSecretKey = (k: string) => SECRET_PART.test(k) || SECRET_EXACT.test(k);

export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined || depth > 6) return value ?? null;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && typeof (value as { toJSON?: unknown }).toJSON === 'function') return redact((value as { toJSON: () => unknown }).toJSON(), depth + 1);
  if (Array.isArray(value)) return value.slice(0, 100).map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = isSecretKey(k) ? '[redacted]' : redact(v, depth + 1);
    return out;
  }
  if (typeof value === 'string' && value.length > 2000) return `${value.slice(0, 2000)}…`;
  return value;
}

/** The platform's own audit trail: append-only in the database, secrets stripped before writing. */
@Injectable()
export class PlatformAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(input: PlatformAuditInput, tx: Prisma.TransactionClient = this.prisma) {
    const json = (v: unknown) => (v === undefined ? undefined : v === null ? Prisma.JsonNull : (redact(v) as Prisma.InputJsonValue));
    await tx.platformAuditLog.create({
      data: {
        actorAccountId: input.actorAccountId ?? null,
        actorLabel: input.actorLabel?.slice(0, 200) ?? null,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        outcome: input.outcome ?? 'SUCCESS',
        reason: input.reason?.slice(0, 1000) ?? null,
        requestId: input.meta?.requestId ?? null,
        ipAddress: input.meta?.ipAddress ?? null,
        userAgent: input.meta?.userAgent ?? null,
        before: json(input.before),
        after: json(input.after),
      },
    });
  }
}
