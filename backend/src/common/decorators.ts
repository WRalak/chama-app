import { applyDecorators, createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Feature, Permission, PlatformPermission } from '@chamahub/shared';
import { AppRequest, metaFrom } from './request';

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const REQUIRED_PERMISSION = 'requiredPermission';
/** Requires the caller's membership in `:groupId` to grant ALL listed permissions. */
export const RequirePermission = (...permissions: Permission[]) => SetMetadata(REQUIRED_PERMISSION, permissions);

export const ANY_PERMISSION = 'anyPermission';
/** Requires the caller's membership in `:groupId` to grant AT LEAST ONE of the listed permissions (e.g. preparer or approver). */
export const RequireAnyPermission = (...permissions: Permission[]) => SetMetadata(ANY_PERMISSION, permissions);

export const REQUIRED_FEATURE = 'requiredFeature';
/** The group's plan must include this feature (checked on the server; 402 otherwise). Never put this on read-only record routes. */
export const RequireFeature = (feature: Feature) => SetMetadata(REQUIRED_FEATURE, feature);

export const PLATFORM_API = 'platformApi';
/**
 * Marks a controller (or route) as part of the staff portal: it accepts only staff tokens, which a
 * Chama member's sign-in can never produce.
 */
export const PlatformApi = () => SetMetadata(PLATFORM_API, true);

export const ALLOW_BEFORE_MFA = 'allowBeforeMfa';
/** Staff routes usable before two-step sign-in is set up (enrolment, profile, sign-out). */
export const AllowBeforeMfa = () => SetMetadata(ALLOW_BEFORE_MFA, true);

export const RECENT_AUTH = 'recentAuth';
/**
 * Sensitive staff action: the person must have signed in or re-authenticated (password, plus
 * the authenticator code when two-step is on) within PLATFORM_REAUTH_MINUTES. A stolen session
 * cookie alone is then not enough.
 */
export const RequireRecentAuth = () => SetMetadata(RECENT_AUTH, true);

export const REQUIRED_PLATFORM_PERMISSION = 'requiredPlatformPermission';
/** Staff-only route; the caller's database-backed permissions must include ALL of these. */
export const RequirePlatform = (...permissions: PlatformPermission[]) => applyDecorators(PlatformApi(), SetMetadata(REQUIRED_PLATFORM_PERMISSION, permissions));

export const ANY_PLATFORM_PERMISSION = 'anyPlatformPermission';
/** Staff-only route; the caller needs AT LEAST ONE of these permissions. */
export const RequireAnyPlatform = (...permissions: PlatformPermission[]) => applyDecorators(PlatformApi(), SetMetadata(ANY_PLATFORM_PERMISSION, permissions));

export const ALLOW_UNVERIFIED = 'allowUnverified';
/** Routes usable before the phone number is verified (profile, OTP, logout). */
export const AllowUnverified = () => SetMetadata(ALLOW_UNVERIFIED, true);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<AppRequest>().user!;
});

export const CurrentStaff = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<AppRequest>().staff!;
});

export const CurrentMembership = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<AppRequest>().membership!;
});

export const ReqMeta = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return metaFrom(ctx.switchToHttp().getRequest<AppRequest>());
});
