import { Prisma, PrismaClient } from '@prisma/client';
import { ALL_PLATFORM_PERMISSIONS, PlatformPermission, SYSTEM_PLATFORM_ROLES } from '@chamahub/shared';

type Db = PrismaClient | Prisma.TransactionClient;

export const OWNER_ROLE = 'OWNER';
const KNOWN = new Set<string>(ALL_PLATFORM_PERMISSIONS);

/**
 * Creates the built-in roles when missing. Existing roles keep the permissions the owner gave them;
 * only OWNER is kept in step with the full permission list so it always holds everything.
 */
export async function ensureSystemRoles(db: Db) {
  for (const def of SYSTEM_PLATFORM_ROLES) {
    const code = def.code;
    const existing = await db.platformStaffRole.findUnique({ where: { code }, select: { id: true } });
    if (!existing) {
      await db.platformStaffRole.create({
        data: { code, name: def.name, description: def.description, system: true, permissions: { create: def.permissions.map((permission) => ({ permission })) } },
      });
    } else if (code === OWNER_ROLE) {
      await db.platformRolePermission.createMany({ data: ALL_PLATFORM_PERMISSIONS.map((permission) => ({ roleId: existing.id, permission })), skipDuplicates: true });
    }
  }
}

export interface ResolvedStaff {
  roles: { code: string; name: string }[];
  permissions: PlatformPermission[];
  isOwner: boolean;
}

/** Effective permissions = union of the account's roles and its individual grants. Read from the database on every request. */
export async function resolveStaff(db: Db, accountId: string): Promise<ResolvedStaff> {
  const [roles, extras] = await Promise.all([
    db.platformAccountRole.findMany({ where: { accountId }, select: { role: { select: { code: true, name: true, permissions: { select: { permission: true } } } } } }),
    db.platformAccountPermission.findMany({ where: { accountId }, select: { permission: true } }),
  ]);
  const set = new Set<string>();
  for (const r of roles) for (const p of r.role.permissions) set.add(p.permission);
  for (const p of extras) set.add(p.permission);
  return {
    roles: roles.map((r) => ({ code: r.role.code, name: r.role.name })),
    permissions: [...set].filter((p) => KNOWN.has(p)).sort() as PlatformPermission[],
    isOwner: roles.some((r) => r.role.code === OWNER_ROLE),
  };
}

/** Owners who can still sign in. The last one can never be removed, suspended or demoted. */
export function activeOwnerCount(db: Db, excludeAccountId?: string) {
  return db.platformAccount.count({
    where: {
      status: 'ACTIVE',
      ...(excludeAccountId ? { id: { not: excludeAccountId } } : {}),
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      roles: { some: { role: { code: OWNER_ROLE } } },
    },
  });
}
