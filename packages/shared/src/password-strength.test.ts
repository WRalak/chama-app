import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { passwordWeakness } from './password-strength';
import { passwordSchema } from './schemas';
import { staffPasswordSchema } from './platform';

describe('password strength', () => {
  it('rejects common passwords and their usual disguises', () => {
    for (const p of ['password', 'Password2026!', 'P@ssw0rd', 'Passw0rd!', 'qwerty123', 'Safaricom2025', 'Kenya@254', 'Chama1234', 'iloveyou1', 'Mpesa2026!', 'Jesus1234', 'Welcome1']) {
      expect(passwordWeakness(p)).not.toBeNull();
    }
  });

  it('rejects number runs, keyboard patterns and repeats', () => {
    for (const p of ['12345678', '87654321', '11111111', 'abcdefgh1', 'aaaa1111', '121212121212']) expect(passwordWeakness(p)).not.toBeNull();
  });

  it("rejects the person's own name, phone number and e-mail", () => {
    expect(passwordWeakness('Wanjiru-2026x', { name: 'Jane Wanjiru' })).toMatch(/name/);
    expect(passwordWeakness('Pin700111222x', { phone: '+254700111222' })).toMatch(/phone/);
    expect(passwordWeakness('janewanjiru-9!', { email: 'janewanjiru@example.com' })).toMatch(/name|e-mail/);
  });

  it('accepts passphrases and strong random passwords, including long ones', () => {
    // Generated at run time: no password-like literals in the repository.
    const random = () => `${randomBytes(6).toString('base64url')}-${randomBytes(3).toString('hex')}7`;
    for (const p of [random(), random(), 'a'.repeat(5) + ' long passphrase with 3 numbers 4 5 and spaces that goes on']) {
      expect(passwordWeakness(p)).toBeNull();
    }
  });

  it('is enforced by the member and staff password schemas', () => {
    expect(passwordSchema.safeParse('Password2026!').success).toBe(false);
    expect(passwordSchema.safeParse(`river ${randomBytes(4).toString('hex')} taxi 42`).success).toBe(true);
    expect(staffPasswordSchema.safeParse('Password-2026!').success).toBe(false);
    expect(staffPasswordSchema.safeParse(`river ${randomBytes(4).toString('hex')} taxi 42`).success).toBe(true);
  });
});
