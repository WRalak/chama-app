/**
 * Member password hashing. New hashes use scrypt (memory-hard, built into Node; the same scheme as
 * staff accounts). Older bcrypt hashes still verify and are upgraded at the next successful
 * sign-in: bcrypt silently ignores everything after 72 bytes, which matters for long passphrases.
 */
import * as bcrypt from 'bcryptjs';
import { hashStaffPassword, verifyStaffPassword } from '../modules/platform-auth/staff-crypto';

const SCRYPT_PREFIX = 'scrypt$15$8$1$';

export const hashPassword = (password: string) => hashStaffPassword(password);

/** Constant-ish time: an unknown account still pays for a full scrypt run. */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (stored?.startsWith('$2')) return bcrypt.compare(password, stored);
  return verifyStaffPassword(password, stored);
}

/** True for hashes made with an older scheme or weaker parameters. */
export const needsRehash = (stored: string) => !stored.startsWith(SCRYPT_PREFIX);
