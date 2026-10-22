import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission, PlatformPermission } from '@chamahub/shared';
import { AppRequest, metaFrom } from './request';

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const REQUIRED_PERMISSION = 'requiredPermission';
/** Requires the caller's membership in `:groupId` to grant ALL listed permissions. */
export const RequirePermission = (...permissions: Permission[]) => SetMetadata(REQUIRED_PERMISSION, permissions);

export const ANY_PERMISSION = 'anyPermission';
/** Requires the caller's membership in `:groupId` to grant AT LEAST ONE of the listed permissions (e.g. preparer or approver). */
export const RequireAnyPermission = (...permissions: Permission[]) => SetMetadata(ANY_PERMISSION, permissions);

export const REQUIRED_PLATFORM_PERMISSION = 'requiredPlatformPermission';
export const RequirePlatform = (permission: PlatformPermission) => SetMetadata(REQUIRED_PLATFORM_PERMISSION, permission);

export const ALLOW_UNVERIFIED = 'allowUnverified';
/** Routes usable before the phone number is verified (profile, OTP, logout). */
export const AllowUnverified = () => SetMetadata(ALLOW_UNVERIFIED, true);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<AppRequest>().user!;
});

export const CurrentMembership = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<AppRequest>().membership!;
});

export const ReqMeta = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return metaFrom(ctx.switchToHttp().getRequest<AppRequest>());
});
