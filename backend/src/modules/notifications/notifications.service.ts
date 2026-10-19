import { Injectable, Logger } from '@nestjs/common';
import { NotificationChannel, NotificationType, Prisma } from '@prisma/client';
import { NotificationPreferences, notificationPreferencesSchema } from '@chamahub/shared';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { EmailChannel, SmsChannel, WhatsAppChannel } from './channels';
import { PlatformSettingsService } from '../platform/platform-settings.service';

export const DEFAULT_PREFERENCES: NotificationPreferences = {
  sms: true,
  email: false,
  whatsapp: false,
  push: true,
  contributionReminders: true,
  loanReminders: true,
  meetingReminders: true,
  announcements: true,
  hidePhoneFromMembers: true,
};

export function readPreferences(raw: Prisma.JsonValue): NotificationPreferences {
  const parsed = notificationPreferencesSchema.partial().safeParse(raw ?? {});
  return { ...DEFAULT_PREFERENCES, ...(parsed.success ? parsed.data : {}) };
}

const TOPIC: Partial<Record<NotificationType, keyof NotificationPreferences>> = {
  CONTRIBUTION_DUE: 'contributionReminders',
  CONTRIBUTION_OVERDUE: 'contributionReminders',
  REPAYMENT_DUE: 'loanReminders',
  MEETING_REMINDER: 'meetingReminders',
  MEETING_SCHEDULED: 'meetingReminders',
  ANNOUNCEMENT: 'announcements',
};

export interface NotifyInput {
  groupId?: string | null;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** Prevents duplicate reminders (unique per user). */
  dedupeKey?: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('Notifications');

  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: SmsChannel,
    private readonly whatsapp: WhatsAppChannel,
    private readonly email: EmailChannel,
    private readonly platform: PlatformSettingsService,
  ) {}

  /** Creates in-app notifications and queues external deliveries per user preferences. */
  async notify(userIds: string[], input: NotifyInput, tx?: Tx) {
    const client = tx ?? this.prisma;
    const users = await client.user.findMany({
      where: { id: { in: [...new Set(userIds)] }, disabledAt: null },
      select: { id: true, preferences: true, email: true },
    });
    let created = 0;
    for (const u of users) {
      const prefs = readPreferences(u.preferences);
      const topic = TOPIC[input.type];
      const channels: NotificationChannel[] = [];
      if (!topic || prefs[topic]) {
        if (prefs.sms) channels.push('SMS');
        if (prefs.whatsapp) channels.push('WHATSAPP');
        if (prefs.email && u.email) channels.push('EMAIL');
      }
      const dedupeKey = input.dedupeKey ? `${input.dedupeKey}:${u.id}` : null;
      if (dedupeKey && (await client.notification.findUnique({ where: { dedupeKey }, select: { id: true } }))) continue;
      await client.notification.create({
        data: {
          userId: u.id,
          groupId: input.groupId ?? null,
          type: input.type,
          title: input.title,
          body: input.body,
          data: (input.data ?? undefined) as Prisma.InputJsonValue | undefined,
          dedupeKey,
          deliveries: { create: channels.map((channel) => ({ channel })) },
        },
      });
      created++;
    }
    return created;
  }

  /** Sends queued external deliveries. Called by the background dispatcher. */
  async dispatchQueued(limit = 100) {
    const queued = await this.prisma.notificationDelivery.findMany({
      where: { status: 'QUEUED', attempts: { lt: 3 } },
      take: limit,
      orderBy: { createdAt: 'asc' },
      include: { notification: { include: { user: { select: { phone: true, email: true } } } } },
    });
    let sent = 0;
    let failed = 0;
    const switches = await this.platform.get();
    const enabled = { SMS: switches.smsEnabled, WHATSAPP: switches.whatsappEnabled, EMAIL: switches.emailEnabled } as Record<string, boolean>;
    for (const d of queued) {
      const { notification: note } = d;
      if (enabled[d.channel] === false) {
        await this.prisma.notificationDelivery.update({ where: { id: d.id }, data: { status: 'SKIPPED', error: 'Channel disabled by platform administrators' } });
        continue;
      }
      const text = `ChamaHub: ${note.title}. ${note.body}`.slice(0, 459);
      const result =
        d.channel === 'SMS'
          ? await this.sms.send(note.user.phone, text)
          : d.channel === 'WHATSAPP'
            ? await this.whatsapp.send(note.user.phone, text)
            : d.channel === 'EMAIL' && note.user.email
              ? await this.email.send(note.user.email, note.title, note.body)
              : { ok: false, skipped: true, provider: 'none', error: 'Channel unavailable' };
      await this.prisma.notificationDelivery.update({
        where: { id: d.id },
        data: {
          attempts: { increment: 1 },
          provider: result.provider,
          error: result.error ?? null,
          status: result.ok ? 'SENT' : result.skipped ? 'SKIPPED' : d.attempts + 1 >= 3 ? 'FAILED' : 'QUEUED',
          sentAt: result.ok ? new Date() : null,
        },
      });
      if (result.ok) sent++;
      else if (!result.skipped) failed++;
    }
    if (queued.length) this.logger.log(`Dispatched ${queued.length} deliveries: ${sent} sent, ${failed} failed`);
    return { processed: queued.length, sent, failed };
  }

  /** User ids of active members of a group, optionally limited to some roles. */
  async groupUserIds(groupId: string, roles?: string[], tx?: Tx) {
    const client = tx ?? this.prisma;
    const rows = await client.membership.findMany({
      where: { groupId, status: 'ACTIVE', ...(roles ? { role: { in: roles as never } } : {}) },
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  }
}
