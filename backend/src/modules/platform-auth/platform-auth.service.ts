import { BadRequestException, ForbiddenException, Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PlatformAccount } from '@prisma/client';
import type { PlatformMe } from '@chamahub/shared';
import { env } from '../../config/env';
import { RequestMeta, StaffContext } from '../../common/request';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformAuditService } from './platform-audit.service';
import { decryptSecret, encryptSecret, hashStaffPassword, newToken, newTotpSecret, platformTokenSecret, sha256, verifyStaffPassword, verifyTotp } from './staff-crypto';
import { StaffMailerService } from './staff-mailer.service';
import { ensureSystemRoles, resolveStaff } from './staff-roles';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
/** One message for every sign-in failure, so the portal reveals nothing about which accounts exist. */
const SIGN_IN_FAILED = 'We could not sign you in with those details. Check them and try again, or reset your password.';
const SESSION_ENDED = 'Your session has ended. Sign in again.';

export interface StaffTokenPayload {
  sub: string;
  sid: string;
  typ: 'platform';
}

interface MfaTokenPayload {
  sub: string;
  typ: 'platform_mfa';
}

export type StaffTokens = { accessToken: string; refreshToken: string; expiresIn: number };
export type StaffLoginResult = { mfaRequired: true; mfaToken: string } | { mfaRequired: false; me: PlatformMe; tokens: StaffTokens };

const usable = (a: Pick<PlatformAccount, 'status' | 'expiresAt'>) => a.status === 'ACTIVE' && (!a.expiresAt || a.expiresAt > new Date());

@Injectable()
export class PlatformAuthService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: PlatformAuditService,
    private readonly mailer: StaffMailerService,
  ) {}

  async onModuleInit() {
    await ensureSystemRoles(this.prisma);
  }

  /* ---------------- sign in ---------------- */

  async login(email: string, password: string, meta: RequestMeta): Promise<StaffLoginResult> {
    const account = await this.prisma.platformAccount.findUnique({ where: { email } });
    const fail = async (reason: string, accountId?: string) => {
      await this.audit.log({ actorAccountId: accountId ?? null, actorLabel: email, action: 'platform.login', outcome: 'FAILURE', reason, meta });
      return new UnauthorizedException(SIGN_IN_FAILED);
    };
    // Always hash, so an unknown e-mail takes as long as a wrong password.
    const ok = await verifyStaffPassword(password, account?.passwordHash);
    if (!account) throw await fail('unknown_email');
    if (account.lockedUntil && account.lockedUntil > new Date()) throw await fail('locked', account.id);
    if (!ok) {
      await this.recordFailure(account);
      throw await fail('bad_password', account.id);
    }
    if (!usable(account)) throw await fail(account.status === 'ACTIVE' ? 'account_expired' : `status_${account.status.toLowerCase()}`, account.id);

    if (account.mfaEnabled) {
      const mfaToken = await this.jwt.signAsync({ sub: account.id, typ: 'platform_mfa' } satisfies MfaTokenPayload, { secret: platformTokenSecret(), expiresIn: 300 });
      await this.audit.log({ actorAccountId: account.id, action: 'platform.login_password_ok', reason: 'mfa_required', meta });
      return { mfaRequired: true, mfaToken };
    }
    return this.completeLogin(account, meta);
  }

  async loginMfa(mfaToken: string, code: string, meta: RequestMeta): Promise<StaffLoginResult> {
    let payload: MfaTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<MfaTokenPayload>(mfaToken, { secret: platformTokenSecret() });
    } catch {
      throw new UnauthorizedException('This sign-in has expired. Start again.');
    }
    if (payload.typ !== 'platform_mfa') throw new UnauthorizedException(SIGN_IN_FAILED);
    const account = await this.prisma.platformAccount.findUnique({ where: { id: payload.sub } });
    if (!account || !usable(account) || !account.mfaEnabled || !account.mfaSecret || (account.lockedUntil && account.lockedUntil > new Date())) {
      await this.audit.log({ actorAccountId: account?.id ?? null, action: 'platform.login', outcome: 'FAILURE', reason: 'mfa_unavailable', meta });
      throw new UnauthorizedException(SIGN_IN_FAILED);
    }
    if (!verifyTotp(decryptSecret(account.mfaSecret), code)) {
      await this.recordFailure(account);
      await this.audit.log({ actorAccountId: account.id, action: 'platform.login', outcome: 'FAILURE', reason: 'bad_mfa_code', meta });
      throw new UnauthorizedException('That code is not right. Check your authenticator app and try again.');
    }
    return this.completeLogin(account, meta);
  }

  private async recordFailure(account: PlatformAccount) {
    const failed = account.failedLoginCount + 1;
    const lock = failed >= MAX_FAILED;
    await this.prisma.platformAccount.update({
      where: { id: account.id },
      data: { failedLoginCount: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : account.lockedUntil },
    });
    if (lock) await this.audit.log({ actorAccountId: account.id, action: 'platform.account_locked', targetType: 'PlatformAccount', targetId: account.id, reason: `${MAX_FAILED} failed sign-in attempts` });
  }

  private async completeLogin(account: PlatformAccount, meta: RequestMeta): Promise<StaffLoginResult> {
    await this.prisma.platformAccount.update({ where: { id: account.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
    const tokens = await this.createSession(account.id, meta);
    await this.audit.log({ actorAccountId: account.id, action: 'platform.login', meta });
    return { mfaRequired: false, me: await this.me(account.id), tokens };
  }

  private async createSession(accountId: string, meta: RequestMeta): Promise<StaffTokens> {
    const e = env();
    const refreshToken = newToken();
    const session = await this.prisma.platformSession.create({
      data: {
        accountId,
        refreshTokenHash: sha256(refreshToken),
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent ?? null,
        expiresAt: new Date(Date.now() + e.PLATFORM_SESSION_MAX_HOURS * 3_600_000),
      },
    });
    return { accessToken: await this.sign(accountId, session.id), refreshToken, expiresIn: e.PLATFORM_ACCESS_TOKEN_TTL_SECONDS };
  }

  private sign(accountId: string, sessionId: string) {
    return this.jwt.signAsync({ sub: accountId, sid: sessionId, typ: 'platform' } satisfies StaffTokenPayload, { secret: platformTokenSecret(), expiresIn: env().PLATFORM_ACCESS_TOKEN_TTL_SECONDS });
  }

  private idleCutoff() {
    return new Date(Date.now() - env().PLATFORM_SESSION_IDLE_MINUTES * 60_000);
  }

  /** Rotates the refresh token. A stale or reused token ends the session. */
  async refresh(refreshToken: string, meta: RequestMeta): Promise<StaffTokens> {
    const hash = sha256(refreshToken);
    const session = await this.prisma.platformSession.findUnique({ where: { refreshTokenHash: hash }, include: { account: true } });
    if (!session || session.revokedAt || session.expiresAt < new Date() || !usable(session.account)) throw new UnauthorizedException(SESSION_ENDED);
    if (session.lastUsedAt < this.idleCutoff()) {
      await this.prisma.platformSession.update({ where: { id: session.id }, data: { revokedAt: new Date(), revokedReason: 'idle_timeout' } });
      throw new UnauthorizedException(SESSION_ENDED);
    }
    const next = newToken();
    const r = await this.prisma.platformSession.updateMany({
      where: { id: session.id, refreshTokenHash: hash, revokedAt: null },
      data: { refreshTokenHash: sha256(next), lastUsedAt: new Date(), ipAddress: meta.ipAddress ?? session.ipAddress },
    });
    if (r.count !== 1) throw new UnauthorizedException(SESSION_ENDED);
    return { accessToken: await this.sign(session.accountId, session.id), refreshToken: next, expiresIn: env().PLATFORM_ACCESS_TOKEN_TTL_SECONDS };
  }

  /**
   * Called by the guard on every portal request: the token is only a pointer; the account,
   * its status, the session and the permissions all come from the database each time.
   */
  async authenticate(token: string): Promise<StaffContext> {
    let payload: StaffTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<StaffTokenPayload>(token, { secret: platformTokenSecret() });
    } catch {
      throw new UnauthorizedException('Your session has expired. Sign in again.');
    }
    if (payload.typ !== 'platform') throw new UnauthorizedException(SESSION_ENDED);
    const session = await this.prisma.platformSession.findUnique({ where: { id: payload.sid }, include: { account: true } });
    if (!session || session.accountId !== payload.sub || session.revokedAt || session.expiresAt < new Date() || session.lastUsedAt < this.idleCutoff()) {
      throw new UnauthorizedException(SESSION_ENDED);
    }
    if (!usable(session.account)) throw new UnauthorizedException(SESSION_ENDED);
    if (Date.now() - session.lastUsedAt.getTime() > 60_000) {
      await this.prisma.platformSession.update({ where: { id: session.id }, data: { lastUsedAt: new Date() } });
    }
    const r = await resolveStaff(this.prisma, session.accountId);
    return { accountId: session.accountId, sessionId: session.id, fullName: session.account.fullName, email: session.account.email, roleCodes: r.roles.map((x) => x.code), permissions: r.permissions, isOwner: r.isOwner };
  }

  async logout(staff: StaffContext, meta: RequestMeta) {
    await this.prisma.platformSession.updateMany({ where: { id: staff.sessionId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'logout' } });
    await this.audit.log({ actorAccountId: staff.accountId, action: 'platform.logout', meta });
    return { ok: true };
  }

  async me(accountId: string): Promise<PlatformMe> {
    const a = await this.prisma.platformAccount.findUniqueOrThrow({ where: { id: accountId } });
    const r = await resolveStaff(this.prisma, accountId);
    return { id: a.id, fullName: a.fullName, email: a.email, team: a.team, roles: r.roles, permissions: r.permissions, mfaEnabled: a.mfaEnabled, lastLoginAt: a.lastLoginAt?.toISOString() ?? null };
  }

  /* ---------------- invitations ---------------- */

  /** Shows who the invitation is for, so the person can confirm before choosing a password. */
  async invitation(token: string) {
    const inv = await this.prisma.platformInvitation.findUnique({ where: { tokenHash: sha256(token) }, include: { account: true } });
    if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date() || inv.account.status !== 'INVITED') {
      throw new BadRequestException('This invitation link is invalid or has expired. Ask for a new one.');
    }
    return { fullName: inv.account.fullName, email: inv.account.email, expiresAt: inv.expiresAt.toISOString() };
  }

  async acceptInvitation(token: string, password: string, meta: RequestMeta) {
    const hash = sha256(token);
    const passwordHash = await hashStaffPassword(password);
    const accountId = await this.prisma.$transaction(async (tx) => {
      // Single use: only one request can flip acceptedAt.
      const inv = await tx.platformInvitation.findUnique({ where: { tokenHash: hash }, include: { account: true } });
      const claimed = await tx.platformInvitation.updateMany({ where: { tokenHash: hash, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, data: { acceptedAt: new Date() } });
      if (!inv || claimed.count !== 1 || inv.account.status !== 'INVITED') return null;
      await tx.platformAccount.update({ where: { id: inv.accountId }, data: { passwordHash, status: 'ACTIVE', passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null } });
      await tx.platformInvitation.updateMany({ where: { accountId: inv.accountId, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.log({ actorAccountId: inv.accountId, action: 'platform.invitation_accepted', targetType: 'PlatformAccount', targetId: inv.accountId, meta }, tx);
      return inv.accountId;
    });
    if (!accountId) {
      await this.audit.log({ action: 'platform.invitation_accepted', actorLabel: 'unknown', outcome: 'FAILURE', reason: 'invalid_or_used_token', meta });
      throw new BadRequestException('This invitation link is invalid or has expired. Ask for a new one.');
    }
    return { ok: true };
  }

  /* ---------------- password reset ---------------- */

  /** Same answer whatever the e-mail, so this cannot be used to discover staff accounts. */
  async forgotPassword(email: string, meta: RequestMeta) {
    const answer = { ok: true, message: 'If that e-mail belongs to an active staff account, a reset link is on its way. It expires soon and works once.' };
    const account = await this.prisma.platformAccount.findUnique({ where: { email } });
    if (!account || !usable(account)) {
      await this.audit.log({ actorAccountId: account?.id ?? null, actorLabel: email, action: 'platform.password_reset_requested', outcome: 'FAILURE', reason: account ? 'account_not_active' : 'unknown_email', meta });
      return answer;
    }
    const { url } = await this.issueReset(account.id);
    const sent = await this.mailer.send(account.email, 'Reset your ChamaHub staff password', resetEmail(account.fullName, url));
    await this.audit.log({ actorAccountId: account.id, action: 'platform.password_reset_requested', outcome: sent.sent ? 'SUCCESS' : 'FAILURE', reason: sent.sent ? null : 'email_not_delivered', meta });
    return answer;
  }

  /** Creates a reset link (older unused links stop working). Returned only to the caller; never logged. */
  async issueReset(accountId: string) {
    const token = newToken();
    await this.prisma.$transaction([
      this.prisma.platformPasswordReset.updateMany({ where: { accountId, usedAt: null }, data: { usedAt: new Date() } }),
      this.prisma.platformPasswordReset.create({ data: { accountId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + env().PLATFORM_RESET_TTL_MINUTES * 60_000) } }),
    ]);
    return { url: this.mailer.link('/platform/reset-password', token) };
  }

  async resetPassword(token: string, password: string, meta: RequestMeta) {
    const hash = sha256(token);
    const passwordHash = await hashStaffPassword(password);
    const accountId = await this.prisma.$transaction(async (tx) => {
      const row = await tx.platformPasswordReset.findUnique({ where: { tokenHash: hash }, include: { account: true } });
      const claimed = await tx.platformPasswordReset.updateMany({ where: { tokenHash: hash, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
      if (!row || claimed.count !== 1 || !usable(row.account)) return null;
      await tx.platformAccount.update({ where: { id: row.accountId }, data: { passwordHash, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null } });
      await tx.platformSession.updateMany({ where: { accountId: row.accountId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'password_reset' } });
      await this.audit.log({ actorAccountId: row.accountId, action: 'platform.password_reset', targetType: 'PlatformAccount', targetId: row.accountId, meta }, tx);
      return row.accountId;
    });
    if (!accountId) {
      await this.audit.log({ actorLabel: 'unknown', action: 'platform.password_reset', outcome: 'FAILURE', reason: 'invalid_or_used_token', meta });
      throw new BadRequestException('This reset link is invalid or has expired. Ask for a new one.');
    }
    return { ok: true };
  }

  async changePassword(staff: StaffContext, current: string, next: string, meta: RequestMeta) {
    const account = await this.prisma.platformAccount.findUniqueOrThrow({ where: { id: staff.accountId } });
    if (!(await verifyStaffPassword(current, account.passwordHash))) {
      await this.audit.log({ actorAccountId: staff.accountId, action: 'platform.password_changed', outcome: 'FAILURE', reason: 'wrong_current_password', meta });
      throw new ForbiddenException('Your current password is not right.');
    }
    const passwordHash = await hashStaffPassword(next);
    await this.prisma.$transaction([
      this.prisma.platformAccount.update({ where: { id: staff.accountId }, data: { passwordHash, passwordChangedAt: new Date() } }),
      this.prisma.platformSession.updateMany({ where: { accountId: staff.accountId, revokedAt: null, id: { not: staff.sessionId } }, data: { revokedAt: new Date(), revokedReason: 'password_changed' } }),
    ]);
    await this.audit.log({ actorAccountId: staff.accountId, action: 'platform.password_changed', meta });
    return { ok: true };
  }

  /* ---------------- MFA (TOTP) ---------------- */

  async mfaSetup(staff: StaffContext) {
    const account = await this.prisma.platformAccount.findUniqueOrThrow({ where: { id: staff.accountId } });
    if (account.mfaEnabled) throw new BadRequestException('Two-step sign-in is already on. Turn it off first to change devices.');
    const secret = newTotpSecret();
    await this.prisma.platformAccount.update({ where: { id: staff.accountId }, data: { mfaSecret: encryptSecret(secret) } });
    const label = encodeURIComponent(`ChamaHub Staff:${account.email}`);
    return { secret, otpauthUrl: `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent('ChamaHub Staff')}&algorithm=SHA1&digits=6&period=30` };
  }

  async mfaEnable(staff: StaffContext, code: string, meta: RequestMeta) {
    const account = await this.prisma.platformAccount.findUniqueOrThrow({ where: { id: staff.accountId } });
    if (account.mfaEnabled) return { ok: true };
    if (!account.mfaSecret || !verifyTotp(decryptSecret(account.mfaSecret), code)) throw new BadRequestException('That code is not right. Check the time on your phone and try again.');
    await this.prisma.platformAccount.update({ where: { id: staff.accountId }, data: { mfaEnabled: true } });
    await this.audit.log({ actorAccountId: staff.accountId, action: 'platform.mfa_enabled', targetType: 'PlatformAccount', targetId: staff.accountId, meta });
    return { ok: true };
  }

  async mfaDisable(staff: StaffContext, password: string, code: string, meta: RequestMeta) {
    const account = await this.prisma.platformAccount.findUniqueOrThrow({ where: { id: staff.accountId } });
    if (!account.mfaEnabled || !account.mfaSecret) return { ok: true };
    const ok = (await verifyStaffPassword(password, account.passwordHash)) && verifyTotp(decryptSecret(account.mfaSecret), code);
    if (!ok) {
      await this.audit.log({ actorAccountId: staff.accountId, action: 'platform.mfa_disabled', outcome: 'FAILURE', meta });
      throw new ForbiddenException('Your password or code is not right.');
    }
    await this.prisma.platformAccount.update({ where: { id: staff.accountId }, data: { mfaEnabled: false, mfaSecret: null } });
    await this.audit.log({ actorAccountId: staff.accountId, action: 'platform.mfa_disabled', targetType: 'PlatformAccount', targetId: staff.accountId, meta });
    return { ok: true };
  }

  /* ---------------- own sessions ---------------- */

  async sessions(staff: StaffContext) {
    const rows = await this.prisma.platformSession.findMany({ where: { accountId: staff.accountId, revokedAt: null, expiresAt: { gt: new Date() }, lastUsedAt: { gt: this.idleCutoff() } }, orderBy: { lastUsedAt: 'desc' } });
    return rows.map((s) => ({ id: s.id, ipAddress: s.ipAddress, userAgent: s.userAgent, createdAt: s.createdAt.toISOString(), lastUsedAt: s.lastUsedAt.toISOString(), expiresAt: s.expiresAt.toISOString(), current: s.id === staff.sessionId }));
  }

  async revokeOwnSession(staff: StaffContext, sessionId: string, meta: RequestMeta) {
    const r = await this.prisma.platformSession.updateMany({ where: { id: sessionId, accountId: staff.accountId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'revoked_by_self' } });
    if (r.count) await this.audit.log({ actorAccountId: staff.accountId, action: 'platform.session_revoked', targetType: 'PlatformSession', targetId: sessionId, meta });
    return { ok: true };
  }
}

export function inviteEmail(name: string, inviter: string, url: string, hours: number) {
  return [
    `Hello ${name},`,
    '',
    `${inviter} has invited you to the ChamaHub staff portal.`,
    `Open this link to choose your own password. It works once and expires in ${hours} hours:`,
    url,
    '',
    'Nobody at ChamaHub will ever ask you for this link or your password. If you did not expect this e-mail, ignore it.',
  ].join('\n');
}

function resetEmail(name: string, url: string) {
  return [
    `Hello ${name},`,
    '',
    'Someone asked to reset the password for your ChamaHub staff account.',
    `Open this link to choose a new one. It works once and expires in ${env().PLATFORM_RESET_TTL_MINUTES} minutes:`,
    url,
    '',
    'If this was not you, ignore this e-mail; your password stays the same.',
  ].join('\n');
}
