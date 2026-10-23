import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Feature, GroupRole, Permission, PlatformPermission, resolvePermissions, RolePolicy, SpecialRole } from '@chamahub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ALLOW_BEFORE_MFA, ALLOW_UNVERIFIED, ANY_PERMISSION, ANY_PLATFORM_PERMISSION, IS_PUBLIC, PLATFORM_API, RECENT_AUTH, REQUIRED_FEATURE, REQUIRED_PERMISSION, REQUIRED_PLATFORM_PERMISSION } from './decorators';
import { EntitlementService } from '../modules/billing/entitlements.service';
import { PlatformAuthService } from '../modules/platform-auth/platform-auth.service';
import { PlatformAuditService } from '../modules/platform-auth/platform-audit.service';
import { AppRequest, metaFrom } from './request';
import { env } from '../config/env';

export interface AccessTokenPayload {
  sub: string;
  sid: string;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly staffAuth: PlatformAuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Sign in to continue');
    // Staff and members are different identities signed with different keys: neither token works on the other's routes.
    if (this.reflector.getAllAndOverride<boolean>(PLATFORM_API, targets)) {
      req.staff = await this.staffAuth.authenticate(header.slice(7));
      if (req.staff.mfaPending && !this.reflector.getAllAndOverride<boolean>(ALLOW_BEFORE_MFA, targets)) {
        throw new ForbiddenException({ message: 'Turn on two-step sign-in to continue (Security Settings).', details: { code: 'MFA_SETUP_REQUIRED' } });
      }
      return true;
    }
    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(header.slice(7));
    } catch {
      throw new UnauthorizedException('Your session has expired. Sign in again.');
    }
    // Checking the session on every request lets "sign out other devices"
    // and account suspension take effect immediately.
    const session = await this.prisma.session.findUnique({
      where: { id: payload.sid },
      select: { revokedAt: true, expiresAt: true, user: { select: { id: true, disabledAt: true, phoneVerifiedAt: true } } },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date() || session.user.id !== payload.sub) {
      throw new UnauthorizedException('Your session has ended. Sign in again.');
    }
    if (session.user.disabledAt) throw new ForbiddenException('This account has been disabled.');
    req.user = {
      id: session.user.id,
      sessionId: payload.sid,
      phoneVerified: !!session.user.phoneVerifiedAt,
    };
    if (!req.user.phoneVerified && !this.reflector.getAllAndOverride<boolean>(ALLOW_UNVERIFIED, targets)) {
      throw new ForbiddenException({ message: 'Verify your phone number to continue', details: { code: 'PHONE_NOT_VERIFIED' } });
    }
    return true;
  }
}

/**
 * Resolves the caller's membership for any route with a `:groupId` param
 * and enforces @RequirePermission against THAT group's role only.
 */
@Injectable()
export class GroupAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    const required = this.reflector.getAllAndOverride<Permission[]>(REQUIRED_PERMISSION, targets);
    const anyOf = this.reflector.getAllAndOverride<Permission[]>(ANY_PERMISSION, targets);
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const groupId = typeof req.params?.groupId === 'string' ? req.params.groupId : undefined;
    if (!groupId) {
      if (required?.length || anyOf?.length) throw new InternalServerErrorException('Permission check on a route without :groupId');
      return true;
    }
    if (!req.user) return true; // public route; nothing group-scoped is exposed

    const membership = await this.prisma.membership.findUnique({
      where: { groupId_userId: { groupId, userId: req.user.id } },
      select: { id: true, role: true, status: true, specialRoles: true, group: { select: { status: true, rolePolicy: true } } },
    });

    if (membership && membership.status !== 'EXITED') {
      // Suspended by ChamaHub staff: records stay readable, nothing can change until reactivated.
      if (membership.group.status === 'SUSPENDED' && req.method !== 'GET') {
        throw new ForbiddenException({ message: 'This group is paused by ChamaHub. Records stay readable; contact support from the Help screen.', details: { code: 'GROUP_SUSPENDED' } });
      }
      if (membership.status === 'SUSPENDED' && req.method !== 'GET') {
        throw new ForbiddenException('Your membership in this group is suspended.');
      }
      req.membership = {
        id: membership.id,
        groupId,
        userId: req.user.id,
        role: membership.role as GroupRole,
        // Suspended members keep read access to their own records only.
        permissions:
          membership.status === 'SUSPENDED'
            ? resolvePermissions('MEMBER', null, ['READ_ONLY'])
            : resolvePermissions(membership.role as GroupRole, membership.group.rolePolicy as RolePolicy | null, membership.specialRoles as SpecialRole[]),
      };
    } else {
      // Platform staff never pass this guard: approved support access goes through the portal's own read-only endpoints.
      throw new NotFoundException('Group not found');
    }

    if (required?.length) {
      const missing = required.filter((p) => !req.membership!.permissions.includes(p));
      if (missing.length) {
        throw new ForbiddenException('Your role in this group does not allow this action.');
      }
    }
    if (anyOf?.length && !anyOf.some((p) => req.membership!.permissions.includes(p))) {
      throw new ForbiddenException('Your role in this group does not allow this action.');
    }
    // Paid features: checked after permissions, so a caller without the role gets 403, not an upsell.
    const feature = this.reflector.getAllAndOverride<Feature>(REQUIRED_FEATURE, targets);
    if (feature) await this.entitlements.assertFeature(groupId, feature);
    return true;
  }
}

/** Enforces @RequirePlatform / @RequireAnyPlatform against the permissions loaded from the database; denials are audited. */
@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: PlatformAuditService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    const all = this.reflector.getAllAndOverride<PlatformPermission[]>(REQUIRED_PLATFORM_PERMISSION, targets);
    const any = this.reflector.getAllAndOverride<PlatformPermission[]>(ANY_PLATFORM_PERMISSION, targets);
    if (!all?.length && !any?.length && !this.reflector.getAllAndOverride<boolean>(RECENT_AUTH, targets)) return true;
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const staff = req.staff;
    const allowed = !!staff && (!all?.length || all.every((p) => staff.permissions.includes(p))) && (!any?.length || any.some((p) => staff.permissions.includes(p)));
    if (!allowed) {
      if (staff) {
        await this.audit.log({ actorAccountId: staff.accountId, action: 'platform.permission_denied', outcome: 'DENIED', targetType: 'Route', targetId: `${req.method} ${req.route?.path ?? req.path}`.slice(0, 200), reason: [...(all ?? []), ...(any ?? [])].join(','), meta: metaFrom(req) });
      }
      throw new ForbiddenException('You do not have permission to do this.');
    }
    if (staff && this.reflector.getAllAndOverride<boolean>(RECENT_AUTH, targets) && Date.now() - staff.reauthAt.getTime() > env().PLATFORM_REAUTH_MINUTES * 60_000) {
      throw new ForbiddenException({ message: 'Confirm it is you to continue: enter your password (and authenticator code).', details: { code: 'REAUTH_REQUIRED' } });
    }
    return true;
  }
}
