/**
 * DEVELOPMENT ONLY: creates (or re-passwords) a staff account directly in the local database, so a
 * developer can sign in to /platform without the invitation link. Refuses to run in production.
 *
 *   PowerShell:
 *     $env:DEV_ADMIN_EMAIL="you@example.com"; $env:DEV_ADMIN_NAME="Your Name"
 *     $env:DEV_ADMIN_PASSWORD="<12+ chars, a letter and a number>"; $env:DEV_ADMIN_ROLE="OWNER"
 *     npm run platform:dev-admin -- --confirm
 *
 * The password comes from you (never from code) and is stored only as a scrypt hash. Add
 * --reset-password to change the password of an existing account. Two-step sign-in is still
 * required at the first sign-in when PLATFORM_REQUIRE_MFA is on.
 */
import { PrismaClient } from '@prisma/client';
import { passwordWeakness, staffEmailSchema, staffPasswordSchema } from '@chamahub/shared';
import { env } from '../config/env';
import { hashStaffPassword } from '../modules/platform-auth/staff-crypto';
import { ensureSystemRoles } from '../modules/platform-auth/staff-roles';

async function main() {
  const e = env();
  if (e.NODE_ENV === 'production') {
    console.error('Refusing: this command is for local development only. In production, use npm run platform:bootstrap and invitations.');
    process.exit(2);
  }
  if (!process.argv.includes('--confirm')) {
    console.error('Refusing to run without --confirm.');
    process.exit(2);
  }
  const email = staffEmailSchema.safeParse(process.env.DEV_ADMIN_EMAIL ?? '');
  const password = staffPasswordSchema.safeParse(process.env.DEV_ADMIN_PASSWORD ?? '');
  const fullName = (process.env.DEV_ADMIN_NAME ?? '').trim();
  const roleCode = (process.env.DEV_ADMIN_ROLE ?? 'OWNER').trim().toUpperCase();
  if (!email.success) return fail('Set DEV_ADMIN_EMAIL to a valid e-mail address.');
  if (!password.success) return fail(`DEV_ADMIN_PASSWORD: ${password.error.issues.map((i) => i.message).join('; ')} (at least 12 characters, a letter and a number).`);
  if (fullName.length < 2) return fail('Set DEV_ADMIN_NAME to the person’s name.');
  const personal = passwordWeakness(password.data, { name: fullName, email: email.data });
  if (personal) return fail(`DEV_ADMIN_PASSWORD: ${personal}`);

  const prisma = new PrismaClient();
  try {
    await ensureSystemRoles(prisma);
    const role = await prisma.platformStaffRole.findUnique({ where: { code: roleCode } });
    if (!role) {
      const codes = (await prisma.platformStaffRole.findMany({ select: { code: true } })).map((r) => r.code);
      return fail(`Unknown DEV_ADMIN_ROLE "${roleCode}". Use one of: ${codes.join(', ')}.`);
    }
    const passwordHash = await hashStaffPassword(password.data);
    const existing = await prisma.platformAccount.findUnique({ where: { email: email.data } });
    if (existing && !process.argv.includes('--reset-password')) {
      return fail(`${email.data} already exists (${existing.status}). Add --reset-password to set a new password for it.`);
    }
    await prisma.$transaction(async (tx) => {
      const account = existing
        ? await tx.platformAccount.update({ where: { id: existing.id }, data: { passwordHash, status: 'ACTIVE', failedLoginCount: 0, lockedUntil: null, passwordChangedAt: new Date(), fullName } })
        : await tx.platformAccount.create({ data: { email: email.data, fullName, passwordHash, status: 'ACTIVE', passwordChangedAt: new Date(), roles: { create: { roleId: role.id } } } });
      if (existing) {
        await tx.platformAccountRole.upsert({ where: { accountId_roleId: { accountId: account.id, roleId: role.id } }, create: { accountId: account.id, roleId: role.id }, update: {} });
        await tx.platformSession.updateMany({ where: { accountId: account.id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'dev_admin_password_reset' } });
        await tx.platformInvitation.updateMany({ where: { accountId: account.id, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      await tx.platformAuditLog.create({ data: { actorLabel: 'dev-admin-cli', action: existing ? 'platform.dev_admin_password_set' : 'platform.dev_admin_created', targetType: 'PlatformAccount', targetId: account.id, after: { email: email.data, role: roleCode, environment: e.NODE_ENV } } });
    });
    console.log(`${existing ? 'Updated' : 'Created'} ${roleCode} account ${email.data}.`);
    console.log(`Sign in at ${e.PLATFORM_PORTAL_URL.replace(/\/$/, '')}/platform/login with that e-mail and the password you set.`);
    if (e.PLATFORM_REQUIRE_MFA) console.log('You will be asked to set up two-step sign-in (authenticator app) on first sign-in.');
  } finally {
    await prisma.$disconnect();
  }
}

function fail(message: string): never {
  console.error(`Not done: ${message}`);
  process.exit(1);
}

main().catch((err) => {
  console.error(`Failed: ${(err as Error).message}`);
  process.exit(1);
});
