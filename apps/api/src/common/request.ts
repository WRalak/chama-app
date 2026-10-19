import type { Request } from 'express';
import type { GroupRole, Permission, PlatformRole } from '@chamahub/shared';

export interface AuthContext {
  id: string;
  sessionId: string;
  platformRole: PlatformRole;
  phoneVerified: boolean;
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
