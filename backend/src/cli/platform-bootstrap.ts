/**
 * One-time creation of the first ChamaHub platform owner.
 *
 *   PLATFORM_BOOTSTRAP_EMAIL=owner@example.com PLATFORM_BOOTSTRAP_NAME="Jane Owner" \
 *     npm run platform:bootstrap -- --confirm
 *
 * No password is set or printed. The owner receives a single-use setup link (24 h) to choose their
 * own password. With e-mail configured the link is e-mailed; otherwise it is printed once to this
 * terminal only (never to the application log). The command refuses once an owner has set up.
 */
import { PrismaClient } from '@prisma/client';
import { env } from '../config/env';
import { EmailChannel } from '../modules/notifications/channels';
import { inviteEmail } from '../modules/platform-auth/platform-auth.service';
import { bootstrapOwner } from '../modules/platform-auth/staff-bootstrap';

async function main() {
  if (!process.argv.includes('--confirm')) {
    console.error('Refusing to run without --confirm. This creates the first platform owner; read docs/PLATFORM_ADMIN.md first.');
    process.exit(2);
  }
  env(); // validates configuration before touching the database
  const prisma = new PrismaClient();
  try {
    const r = await bootstrapOwner(prisma, { email: process.env.PLATFORM_BOOTSTRAP_EMAIL, fullName: process.env.PLATFORM_BOOTSTRAP_NAME });
    if (!r.ok) {
      console.error(`Not done: ${r.reason}`);
      process.exit(1);
    }
    const email = new EmailChannel();
    const sent = email.configured ? await email.send(r.email, 'Set up your ChamaHub owner account', inviteEmail(process.env.PLATFORM_BOOTSTRAP_NAME ?? '', 'ChamaHub setup', r.setupUrl, 24)) : { ok: false };
    console.log(`${r.reissued ? 'Replaced the pending' : 'Created the'} owner invitation for ${r.email}. It expires ${r.expiresAt.toISOString()}.`);
    if (sent.ok) {
      console.log('The single-use setup link was e-mailed to the owner.');
    } else {
      console.log('E-mail is not configured, so here is the single-use setup link. Give it only to the owner, over a secure channel, and do not paste it into tickets or chat logs:');
      console.log(`\n  ${r.setupUrl}\n`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(`Bootstrap failed: ${(err as Error).message}`);
  process.exit(1);
});
