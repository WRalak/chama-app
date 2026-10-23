import type { Request } from 'express';
import type { GroupRole, Permission, PlatformPermission } from '@chamahub/shared';

export interface AuthContext {
  id: string;
  sessionId: string;
  phoneVerified: boolean;
}

/** A signed-in platform staff member. Loaded from the database on every request; never from the token alone. */
export interface StaffContext {
  accountId: string;
  sessionId: string;
  fullName: string;
  email: string;
  roleCodes: string[];
  permissions: readonly PlatformPermission[];
  isOwner: boolean;
}

export interface MembershipContext {
  id: string;
  groupId: string;
  userId: string;
  role: GroupRole;
  permissions: readonly Permission[];
  /** Set when access comes from a time-boxed platform support grant (read-only). */
  supportGrantId?: string;
}

export interface AppRequest extends Request {
  user?: AuthContext;
  staff?: StaffContext;
  membership?: MembershipContext;
  requestId?: string;
}

export interface RequestMeta {
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

export function metaFrom(req: AppRequest): RequestMeta {
  return {
    ipAddress: req.ip,
    userAgent: req.headers['user-agent']?.slice(0, 300),
    requestId: req.requestId,
  };
}
