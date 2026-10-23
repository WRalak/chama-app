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
    expect(passwordWeakness('Wallace-2026x', { name: 'Wallace Ralak' })).toMatch(/name/);
    expect(passwordWeakness('Pin718600199x', { phone: '+254718600199' })).toMatch(/phone/);
    expect(passwordWeakness('wallaceralak-9!', { email: 'wallaceralak@gmail.com' })).toMatch(/name|e-mail/);
  });

  it('accepts passphrases and strong random passwords, including long ones', () => {
    for (const p of ['mango-taxi-river-42', 'Kahawa-Tamu-2026', 'Correct-Horse-42-battery', 'v8#Qm2!zLp0r', 'Demo1234', 'a'.repeat(5) + ' long passphrase with 3 numbers 4 5 and spaces that goes on']) {
      expect(passwordWeakness(p)).toBeNull();
    }
  });

  it('is enforced by the member and staff password schemas', () => {
    expect(passwordSchema.safeParse('Password2026!').success).toBe(false);
    expect(passwordSchema.safeParse('mango-taxi-river-42').success).toBe(true);
    expect(staffPasswordSchema.safeParse('Password-2026!').success).toBe(false);
    expect(staffPasswordSchema.safeParse('Kahawa-Tamu-2026').success).toBe(true);
  });
});
