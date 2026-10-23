import { Injectable, Logger } from '@nestjs/common';
import { env } from '../../config/env';
import { EmailChannel } from '../notifications/channels';

/** Tests read staff e-mails here instead of sending them. Never populated outside NODE_ENV=test. */
export const testStaffMailbox: { to: string; subject: string; text: string }[] = [];

export interface MailResult {
  sent: boolean;
  error?: string;
}

/**
 * E-mail to platform staff (invitations, password resets). Messages contain single-use links, so
 * neither the body nor the link is ever logged: only the outcome.
 */
@Injectable()
export class StaffMailerService {
  private readonly logger = new Logger('StaffMailer');

  constructor(private readonly email: EmailChannel) {}

  get configured() {
    return env().NODE_ENV === 'test' || this.email.configured;
  }

  async send(to: string, subject: string, text: string): Promise<MailResult> {
    if (env().NODE_ENV === 'test') {
      testStaffMailbox.push({ to, subject, text });
      return { sent: true };
    }
    const r = await this.email.send(to, subject, text);
    if (!r.ok) {
      this.logger.warn(`Staff e-mail "${subject}" not sent: ${r.skipped ? 'e-mail is not configured' : 'delivery failed'}`);
      return { sent: false, error: r.skipped ? 'E-mail is not configured on this server (EMAIL_WEBHOOK_URL).' : 'The e-mail provider did not accept the message.' };
    }
    return { sent: true };
  }

  link(path: string, token: string) {
    return `${env().PLATFORM_PORTAL_URL.replace(/\/$/, '')}${path}?token=${encodeURIComponent(token)}`;
  }
}
