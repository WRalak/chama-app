import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

/** Events worth a security log line. Never credentials, tokens, codes or financial amounts. */
export type SecurityEventType =
  | 'auth.denied' // 401: missing, expired, revoked or forged token
  | 'authz.denied' // 403: signed in but not allowed
  | 'authz.not_found' // 404 on a group route: a common sign of probing other groups' ids
  | 'rate_limited'
  | 'payment.callback_not_confirmed'
  | 'payment.duplicate_receipt';

export interface SecurityEvent {
  type: SecurityEventType;
  userId?: string | null;
  staffId?: string | null;
  groupId?: string | null;
  ip?: string | null;
  method?: string;
  route?: string;
  requestId?: string;
  detail?: string;
}

/** Thresholds within a 5-minute window that raise an alert (one alert per key per window). */
export const SECURITY_ALERT_RULES = [
  { name: 'cross_tenant_probing', types: ['authz.not_found', 'authz.denied'], by: 'actor', threshold: 25 },
  { name: 'credential_stuffing', types: ['auth.denied'], by: 'ip', threshold: 50 },
  { name: 'rate_limit_abuse', types: ['rate_limited'], by: 'ip', threshold: 30 },
  { name: 'payment_callback_forgery', types: ['payment.callback_not_confirmed'], by: 'any', threshold: 1 },
  { name: 'duplicate_payment_events', types: ['payment.duplicate_receipt'], by: 'any', threshold: 5 },
] as const;
const WINDOW_MS = 5 * 60_000;

/**
 * Structured, privacy-aware security events. Each event is one JSON log line (for the log
 * pipeline); simple sliding-window rules turn patterns into alerts, which are written to the
 * staff audit log (Security view in the portal) and, when configured, sent to SECURITY_WEBHOOK_URL.
 * Alerts are signals for a person to review, never automatic accusations or blocks.
 */
@Injectable()
export class SecurityEventsService {
  private readonly logger = new Logger('Security');
  private readonly windows = new Map<string, number[]>();
  private readonly alerted = new Map<string, number>();

  constructor(private readonly prisma: PrismaService) {}

  record(e: SecurityEvent) {
    this.logger.log(JSON.stringify({ securityEvent: e.type, ...e, type: undefined, at: new Date().toISOString() }));
    for (const rule of SECURITY_ALERT_RULES) {
      if (!(rule.types as readonly string[]).includes(e.type)) continue;
      const subject = rule.by === 'ip' ? e.ip : rule.by === 'actor' ? (e.userId ?? e.staffId) : 'all';
      if (!subject) continue;
      const key = `${rule.name}:${subject}`;
      const now = Date.now();
      const hits = (this.windows.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
      hits.push(now);
      this.windows.set(key, hits);
      if (hits.length >= rule.threshold && now - (this.alerted.get(key) ?? 0) > WINDOW_MS) {
        this.alerted.set(key, now);
        void this.alert(rule.name, subject === 'all' ? null : subject, hits.length, e);
      }
    }
    if (this.windows.size > 10_000) this.windows.clear(); // bounded memory under a flood
  }

  private async alert(rule: string, subject: string | null, count: number, e: SecurityEvent) {
    const summary = { rule, count, windowMinutes: WINDOW_MS / 60_000, lastRoute: e.route, groupId: e.groupId ?? null, userId: e.userId ?? null, staffId: e.staffId ?? null };
    this.logger.warn(`SECURITY_ALERT ${JSON.stringify(summary)}`);
    await this.prisma.platformAuditLog
      .create({ data: { actorLabel: 'security-monitor', action: `security.alert.${rule}`, targetType: e.userId ? 'User' : e.staffId ? 'PlatformAccount' : 'Request', targetId: e.userId ?? e.staffId ?? null, ipAddress: rule === 'credential_stuffing' || rule === 'rate_limit_abuse' ? subject : (e.ip ?? null), requestId: e.requestId ?? null, outcome: 'FAILURE', after: summary } })
      .catch((err) => this.logger.error(`Could not record security alert: ${(err as Error).message}`));
    const url = env().SECURITY_WEBHOOK_URL ?? env().ERROR_WEBHOOK_URL;
    if (url) {
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: `ChamaHub security alert: ${rule} (${count} events in 5 min). Review in the staff portal audit log.`, service: 'chamahub-api', ...summary }), signal: AbortSignal.timeout(3000) }).catch(() => undefined);
    }
  }
}

@Global()
@Module({ providers: [SecurityEventsService], exports: [SecurityEventsService] })
export class SecurityEventsModule {}
