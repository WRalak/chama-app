import { PrismaClient } from '@prisma/client';
import { staffEmailSchema } from '@chamahub/shared';
import { z } from 'zod';
import { env } from '../../config/env';
import { newToken, sha256 } from './staff-crypto';
import { ensureSystemRoles, OWNER_ROLE } from './staff-roles';

export type BootstrapResult =
  | { ok: true; accountId: string; email: string; setupUrl: string; expiresAt: Date; reissued: boolean }
  | { ok: false; reason: string };

const input = z.object({ email: staffEmailSchema, fullName: z.string().trim().min(2).max(120) });

const BOOTSTRAP_TTL_HOURS = 24;

/**
 * Creates the first platform owner. There is no password here: the result is a single-use setup
 * link the owner opens to choose their own password. It refuses as soon as an owner has finished
 * setting up, so it cannot be used to add owners later (owners invite people from the portal).
 * While the first owner has not yet accepted, running it again for the SAME e-mail replaces the link.
 */
export async function bootstrapOwner(prisma: PrismaClient, raw: { email?: string; fullName?: string }): Promise<BootstrapResult> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: 'Set PLATFORM_BOOTSTRAP_EMAIL and PLATFORM_BOOTSTRAP_NAME to a valid e-mail and full name.' };
  const { email, fullName } = parsed.data;
  await ensureSystemRoles(prisma);

  return prisma.$transaction(async (tx) => {
    // Serialise concurrent runs.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('chamahub_platform_bootstrap'))`;
    const owners = await tx.platformAccount.findMany({ where: { roles: { some: { role: { code: OWNER_ROLE } } } }, select: { id: true, email: true, status: true } });
    if (owners.some((o) => o.status !== 'INVITED')) {
      await tx.platformAuditLog.create({ data: { actorLabel: 'bootstrap-cli', action: 'platform.owner_bootstrap', outcome: 'DENIED', reason: 'owner_already_exists' } });
      return { ok: false as const, reason: 'A platform owner already exists. Bootstrap is disabled; existing owners invite new staff from the portal.' };
    }
    if (owners.length && owners.some((o) => o.email !== email)) {
      return { ok: false as const, reason: 'An owner invitation is already pending for a different e-mail. Run again with that e-mail to replace its link.' };
    }
    const role = await tx.platformStaffRole.findUniqueOrThrow({ where: { code: OWNER_ROLE } });
    const pending = owners[0];
    const account = pending
      ? await tx.platformAccount.update({ where: { id: pending.id }, data: { fullName } })
      : await tx.platformAccount.create({ data: { email, fullName, status: 'INVITED', roles: { create: { roleId: role.id } } } });
    await tx.platformInvitation.updateMany({ where: { accountId: account.id, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    const token = newToken();
    const expiresAt = new Date(Date.now() + BOOTSTRAP_TTL_HOURS * 3_600_000);
    await tx.platformInvitation.create({ data: { accountId: account.id, tokenHash: sha256(token), expiresAt } });
    await tx.platformAuditLog.create({
      data: { actorLabel: 'bootstrap-cli', action: 'platform.owner_bootstrap', targetType: 'PlatformAccount', targetId: account.id, after: { email, fullName, reissued: !!pending } },
    });
    const setupUrl = `${env().PLATFORM_PORTAL_URL.replace(/\/$/, '')}/platform/accept-invite?token=${encodeURIComponent(token)}`;
    return { ok: true as const, accountId: account.id, email, setupUrl, expiresAt, reissued: !!pending };
  });
}
