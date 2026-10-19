import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { OtpPurpose } from '@prisma/client';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { SmsChannel } from '../notifications/channels';

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_REQUESTS_PER_WINDOW = 3;
const WINDOW_MS = 15 * 60 * 1000;

/** Exposed to the e2e test-suite only (NODE_ENV=test), never in other environments. */
export const testOtpOutbox = new Map<string, string>();

@Injectable()
export class OtpService {
  private readonly logger = new Logger('OTP');

  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: SmsChannel,
  ) {}

  private hash(phone: string, purpose: OtpPurpose, code: string) {
    return createHmac('sha256', env().OTP_SECRET).update(`${phone}:${purpose}:${code}`).digest('hex');
  }

  async issue(phone: string, purpose: OtpPurpose): Promise<void> {
    const recent = await this.prisma.otpCode.count({
      where: { phone, purpose, createdAt: { gt: new Date(Date.now() - WINDOW_MS) } },
    });
    if (recent >= MAX_REQUESTS_PER_WINDOW) {
      throw new HttpException('Too many codes requested. Wait 15 minutes and try again.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.prisma.otpCode.updateMany({ where: { phone, purpose, consumedAt: null }, data: { consumedAt: new Date() } });
    await this.prisma.otpCode.create({
      data: { phone, purpose, codeHash: this.hash(phone, purpose, code), expiresAt: new Date(Date.now() + OTP_TTL_MS) },
    });
    const e = env();
    if (e.NODE_ENV === 'test') testOtpOutbox.set(`${phone}:${purpose}`, code);
    const result = await this.sms.send(phone, `Your ChamaHub code is ${code}. It expires in 10 minutes. Do not share it with anyone.`);
    if (!result.ok && e.DEV_LOG_OTP && e.NODE_ENV !== 'production') {
      this.logger.warn(`DEV ONLY — OTP for ${phone} (${purpose}): ${code}`);
    } else if (!result.ok && e.NODE_ENV !== 'test') {
      this.logger.error(`OTP delivery failed for ${phone}: ${result.error}`);
    }
  }

  /** Verifies and consumes a code. Throws on failure without revealing which part was wrong. */
  async consume(phone: string, purpose: OtpPurpose, code: string): Promise<void> {
    const otp = await this.prisma.otpCode.findFirst({
      where: { phone, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    const invalid = new HttpException('The code is invalid or has expired.', HttpStatus.BAD_REQUEST);
    if (!otp || otp.attempts >= MAX_ATTEMPTS) throw invalid;
    const expected = Buffer.from(otp.codeHash, 'hex');
    const actual = Buffer.from(this.hash(phone, purpose, code), 'hex');
    if (!timingSafeEqual(expected, actual)) {
      await this.prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      throw invalid;
    }
    const claimed = await this.prisma.otpCode.updateMany({ where: { id: otp.id, consumedAt: null }, data: { consumedAt: new Date() } });
    if (claimed.count !== 1) throw invalid;
  }
}
