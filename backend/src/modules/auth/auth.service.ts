import { ConflictException, ForbiddenException, Injectable, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import { hashPassword, needsRehash, verifyPassword } from '../../common/passwords';
import { createHash, randomBytes } from 'node:crypto';
import { passwordWeakness, type AuthResponse, type AuthUser, type LoginInput, type RegisterInput, type SessionInfo } from '@chamahub/shared';
import { env } from '../../config/env';
import { AuditService } from '../../common/audit.service';
import { RequestMeta } from '../../common/request';
import { PrismaService } from '../../prisma/prisma.service';
import { DEFAULT_PREFERENCES, NotificationsService } from '../notifications/notifications.service';
import { OtpService } from './otp.service';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

/** Rejects passwords built from the person's own name, phone number or e-mail (schemas already reject common ones). */
export function assertNotPersonal(password: string, who: { name?: string | null; phone?: string | null; email?: string | null }) {
  const why = passwordWeakness(password, who);
  if (why) throw new UnprocessableEntityException(why);
}

export function toAuthUser(u: User): AuthUser {
  return {
    id: u.id,
    fullName: u.fullName,
    phone: u.phone,
    email: u.email,
    phoneVerified: !!u.phoneVerifiedAt,
    locale: u.locale,
    createdAt: u.createdAt.toISOString(),
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly otp: OtpService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Tells the account holder about a security event, in the app and by SMS. Never includes codes,
   * passwords or links; it says what happened and what to do if it was not them.
   */
  private async securityNotice(userId: string, title: string, body: string, dedupeKey?: string) {
    await this.notifications
      .notify([userId], { type: 'SECURITY', title, body: `${body} If this was not you, reset your password now and sign out other devices in Profile › Security.`, dedupeKey })
      .catch(() => undefined);
  }

  async register(input: RegisterInput, meta: RequestMeta): Promise<AuthResponse> {
    assertNotPersonal(input.password, { name: input.fullName, phone: input.phone, email: input.email });
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ phone: input.phone }, ...(input.email ? [{ email: input.email.toLowerCase() }] : [])] },
      select: { phone: true },
    });
    if (existing) {
      throw new ConflictException(
        existing.phone === input.phone ? 'An account with this phone number already exists. Sign in instead.' : 'This email is already in use.',
      );
    }
    const user = await this.prisma.user.create({
      data: {
        fullName: input.fullName,
        phone: input.phone,
        email: input.email?.toLowerCase() ?? null,
        passwordHash: await hashPassword(input.password),
        preferences: DEFAULT_PREFERENCES,
      },
    });
    await this.audit.log({ actorUserId: user.id, action: 'auth.register', entityType: 'User', entityId: user.id, meta });
    await this.otp.issue(user.phone, 'VERIFY_PHONE');
    return { user: toAuthUser(user), tokens: await this.createSession(user, meta) };
  }

  async login(input: LoginInput, meta: RequestMeta): Promise<AuthResponse> {
    const user = await this.prisma.user.findUnique({ where: { phone: input.phone } });
    const invalid = new UnauthorizedException('Phone number or password is incorrect.');
    if (!user) {
      await verifyPassword(input.password, null);
      throw invalid;
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new ForbiddenException('Too many failed attempts. Try again in 15 minutes or reset your password.');
    }
    if (!(await verifyPassword(input.password, user.passwordHash))) {
      const failed = user.failedLoginCount + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: failed >= MAX_FAILED_LOGINS ? 0 : failed,
          lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : user.lockedUntil,
        },
      });
      await this.audit.log({ actorUserId: user.id, action: 'auth.login_failed', entityType: 'User', entityId: user.id, meta });
      if (failed >= MAX_FAILED_LOGINS) await this.securityNotice(user.id, 'Sign-in paused for 15 minutes', 'Someone entered the wrong password for your ChamaHub account 5 times.');
      throw invalid;
    }
    // Only someone who knows the password learns that an account is disabled.
    if (user.disabledAt) throw new ForbiddenException('This account has been disabled. Contact support.');
    const upgrade = needsRehash(user.passwordHash) ? { passwordHash: await hashPassword(input.password) } : {};
    await this.prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, ...upgrade } });
    await this.audit.log({ actorUserId: user.id, action: 'auth.login', entityType: 'User', entityId: user.id, meta });
    await this.noticeIfNewDevice(user.id, meta, input.deviceName);
    return { user: toAuthUser(user), tokens: await this.createSession(user, { ...meta }, input.deviceName) };
  }

  /** A sign-in from a device this account has not used in the last 180 days. Silent on the first ever sign-in. */
  private async noticeIfNewDevice(userId: string, meta: RequestMeta, deviceName?: string) {
    const since = new Date(Date.now() - 180 * 86_400_000);
    const device = deviceName ?? meta.userAgent?.slice(0, 120) ?? null;
    const [known, any] = await Promise.all([
      this.prisma.session.count({ where: { userId, createdAt: { gte: since }, OR: [{ deviceName: device }, ...(meta.userAgent ? [{ userAgent: meta.userAgent }] : [])] } }),
      this.prisma.session.count({ where: { userId } }),
    ]);
    if (any > 0 && known === 0) await this.securityNotice(userId, 'New sign-in to your account', `Your ChamaHub account was signed in on ${device ? `"${device.slice(0, 60)}"` : 'a new device'}.`);
  }

  private async createSession(user: User, meta: RequestMeta, deviceName?: string) {
    const refreshToken = randomBytes(48).toString('base64url');
    const e = env();
    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        refreshTokenHash: sha256(refreshToken),
        deviceName: deviceName ?? meta.userAgent?.slice(0, 120) ?? null,
        userAgent: meta.userAgent ?? null,
        ipAddress: meta.ipAddress ?? null,
        expiresAt: new Date(Date.now() + e.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
      },
    });
    return {
      accessToken: await this.jwt.signAsync({ sub: user.id, sid: session.id }),
      refreshToken,
      expiresIn: e.ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  /** Rotates the refresh token. Re-use of an old token revokes the whole session (theft signal). */
  async refresh(refreshToken: string, meta: RequestMeta) {
    const hash = sha256(refreshToken);
    const session = await this.prisma.session.findUnique({ where: { refreshTokenHash: hash }, include: { user: true } });
    if (!session) {
      const reused = await this.prisma.session.findUnique({ where: { previousTokenHash: hash } });
      if (reused && !reused.revokedAt) {
        await this.prisma.session.update({ where: { id: reused.id }, data: { revokedAt: new Date(), revokedReason: 'refresh_token_reuse' } });
        await this.audit.log({ actorUserId: reused.userId, action: 'auth.refresh_reuse_detected', entityType: 'Session', entityId: reused.id, meta });
        await this.securityNotice(reused.userId, 'We signed out one of your devices', 'An old sign-in token for your account was used again, which can mean it was copied. That device has been signed out.');
      }
      throw new UnauthorizedException('Your session has ended. Sign in again.');
    }
    if (session.revokedAt || session.expiresAt < new Date() || session.user.disabledAt) {
      throw new UnauthorizedException('Your session has ended. Sign in again.');
    }
    const next = randomBytes(48).toString('base64url');
    const updated = await this.prisma.session.updateMany({
      where: { id: session.id, refreshTokenHash: hash },
      data: { refreshTokenHash: sha256(next), previousTokenHash: hash, lastUsedAt: new Date(), ipAddress: meta.ipAddress ?? session.ipAddress },
    });
    if (updated.count !== 1) throw new UnauthorizedException('Your session has ended. Sign in again.');
    return {
      accessToken: await this.jwt.signAsync({ sub: session.userId, sid: session.id }),
      refreshToken: next,
      expiresIn: env().ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  async logout(sessionId: string) {
    await this.prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'logout' } });
  }

  async requestOtp(phone: string, purpose: 'VERIFY_PHONE' | 'RESET_PASSWORD' | 'LOGIN') {
    // Respond identically whether or not the account exists (no enumeration).
    const user = await this.prisma.user.findUnique({ where: { phone }, select: { id: true, phoneVerifiedAt: true } });
    if (user && !(purpose === 'VERIFY_PHONE' && user.phoneVerifiedAt)) await this.otp.issue(phone, purpose);
    return { ok: true, message: 'If the number is registered, a code has been sent by SMS.' };
  }

  async requestOtpForUser(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.phoneVerifiedAt) await this.otp.issue(user.phone, 'VERIFY_PHONE');
    return { ok: true, message: 'A new code has been sent by SMS.' };
  }

  async verifyPhone(userId: string, code: string, meta: RequestMeta) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.phoneVerifiedAt) return toAuthUser(user);
    await this.otp.consume(user.phone, 'VERIFY_PHONE', code);
    const updated = await this.prisma.user.update({ where: { id: userId }, data: { phoneVerifiedAt: new Date() } });
    await this.audit.log({ actorUserId: userId, action: 'auth.phone_verified', entityType: 'User', entityId: userId, meta });
    return toAuthUser(updated);
  }

  async resetPassword(phone: string, code: string, newPassword: string, meta: RequestMeta) {
    await this.otp.consume(phone, 'RESET_PASSWORD', code);
    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user) throw new UnauthorizedException('The code is invalid or has expired.');
    assertNotPersonal(newPassword, { name: user.fullName, phone: user.phone, email: user.email });
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        // Receiving the SMS code also proves ownership of the phone.
        data: { passwordHash: await hashPassword(newPassword), failedLoginCount: 0, lockedUntil: null, phoneVerifiedAt: user.phoneVerifiedAt ?? new Date() },
      }),
      this.prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'password_reset' } }),
    ]);
    await this.audit.log({ actorUserId: user.id, action: 'auth.password_reset', entityType: 'User', entityId: user.id, meta });
    await this.securityNotice(user.id, 'Your password was reset', 'The password for your ChamaHub account was reset with a code sent to your phone, and every device was signed out.');
    return { ok: true };
  }

  async changePassword(userId: string, sessionId: string, current: string, next: string, meta: RequestMeta) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await verifyPassword(current, user.passwordHash))) throw new UnauthorizedException('Current password is incorrect.');
    assertNotPersonal(next, { name: user.fullName, phone: user.phone, email: user.email });
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(next) } }),
      this.prisma.session.updateMany({
        where: { userId, revokedAt: null, id: { not: sessionId } },
        data: { revokedAt: new Date(), revokedReason: 'password_changed' },
      }),
    ]);
    await this.audit.log({ actorUserId: userId, action: 'auth.password_changed', entityType: 'User', entityId: userId, meta });
    await this.securityNotice(userId, 'Your password was changed', 'The password for your ChamaHub account was changed, and your other devices were signed out.');
    return { ok: true };
  }

  async sessions(userId: string, currentSessionId: string): Promise<SessionInfo[]> {
    const rows = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
    });
    return rows.map((s) => ({
      id: s.id,
      deviceName: s.deviceName,
      ipAddress: s.ipAddress,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      current: s.id === currentSessionId,
    }));
  }

  async revokeSession(userId: string, sessionId: string) {
    await this.prisma.session.updateMany({ where: { id: sessionId, userId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'revoked_by_user' } });
    return { ok: true };
  }

  async revokeOthers(userId: string, currentSessionId: string) {
    const r = await this.prisma.session.updateMany({
      where: { userId, revokedAt: null, id: { not: currentSessionId } },
      data: { revokedAt: new Date(), revokedReason: 'revoked_by_user' },
    });
    return { revoked: r.count };
  }
}
