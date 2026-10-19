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
import {
  GroupRole,
  Permission,
  PlatformPermission,
  PlatformRole,
  platformRoleHas,
  resolvePermissions,
  RolePolicy,
  SpecialRole,
} from '@chamahub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from './audit.service';
import { ALLOW_UNVERIFIED, IS_PUBLIC, REQUIRED_PERMISSION, REQUIRED_PLATFORM_PERMISSION } from './decorators';
import { AppRequest, metaFrom } from './request';

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  role: PlatformRole;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Sign in to continue');
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
      select: { revokedAt: true, expiresAt: true, user: { select: { id: true, platformRole: true, disabledAt: true, phoneVerifiedAt: true } } },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date() || session.user.id !== payload.sub) {
      throw new UnauthorizedException('Your session has ended. Sign in again.');
    }
    if (session.user.disabledAt) throw new ForbiddenException('This account has been disabled.');
    req.user = {
      id: session.user.id,
      sessionId: payload.sid,
      platformRole: session.user.platformRole,
      phoneVerified: !!session.user.phoneVerifiedAt,
    };
    if (!req.user.phoneVerified && !this.reflector.getAllAndOverride<boolean>(ALLOW_UNVERIFIED, targets)) {
      throw new ForbiddenException({ message: 'Verify your phone number to continue', details: { code: 'PHONE_NOT_VERIFIED' } });
    }
    return true;
  }
}

/** Permissions granted to an approved, time-boxed platform support session: read-only, no member contact data. */
const SUPPORT_PERMISSIONS: readonly Permission[] = [
  Permission.GROUP_VIEW,
  Permission.MEMBERS_VIEW,
  Permission.CONTRIBUTIONS_VIEW_ALL,
  Permission.LOANS_VIEW_ALL,
  Permission.REPORTS_VIEW,
  Permission.AUDIT_VIEW,
  Permission.STATEMENTS_VIEW,
  Permission.ROTATIONS_VIEW,
  Permission.MEETINGS_VIEW,
  Permission.EXPENSES_VIEW,
  Permission.FINES_VIEW_ALL,
];

/**
 * Resolves the caller's membership for any route with a `:groupId` param
 * and enforces @RequirePermission against THAT group's role only.
 */
@Injectable()
export class GroupAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    const required = this.reflector.getAllAndOverride<Permission[]>(REQUIRED_PERMISSION, targets);
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const groupId = typeof req.params?.groupId === 'string' ? req.params.groupId : undefined;
    if (!groupId) {
      if (required?.length) throw new InternalServerErrorException('Permission check on a route without :groupId');
      return true;
    }
    if (!req.user) return true; // public route; nothing group-scoped is exposed

    const membership = await this.prisma.membership.findUnique({
      where: { groupId_userId: { groupId, userId: req.user.id } },
      select: { id: true, role: true, status: true, specialRoles: true, group: { select: { status: true, rolePolicy: true } } },
    });

    if (membership && membership.status !== 'EXITED') {
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
      const grant = await this.supportGrant(req, groupId);
      if (!grant) throw new NotFoundException('Group not found');
      req.membership = { id: '', groupId, userId: req.user.id, role: 'AUDITOR', permissions: SUPPORT_PERMISSIONS, supportGrantId: grant };
    }

    if (required?.length) {
      const missing = required.filter((p) => !req.membership!.permissions.includes(p));
      if (missing.length) {
        throw new ForbiddenException('Your role in this group does not allow this action.');
      }
    }
    return true;
  }

  /** Platform support may read a group only with an approved, unexpired grant; every use is audited. */
  private async supportGrant(req: AppRequest, groupId: string): Promise<string | null> {
    if (!req.user || req.method !== 'GET' || !platformRoleHas(req.user.platformRole, 'platform.support')) return null;
    const grant = await this.prisma.supportAccessGrant.findFirst({
      where: { groupId, requestedByUserId: req.user.id, status: 'APPROVED', expiresAt: { gt: new Date() } },
      select: { id: true, purpose: true },
    });
    if (!grant) return null;
    await this.audit.log({
      groupId,
      actorUserId: req.user.id,
      action: 'support.access',
      entityType: 'SupportAccessGrant',
      entityId: grant.id,
      reason: grant.purpose,
      after: { path: req.originalUrl },
      meta: metaFrom(req),
    });
    return grant.id;
  }
}

@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PlatformPermission>(REQUIRED_PLATFORM_PERMISSION, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required) return true;
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    if (!req.user || !platformRoleHas(req.user.platformRole, required)) {
      throw new ForbiddenException('Platform administrator access required.');
    }
    return true;
  }
}
