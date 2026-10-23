/**
 * Cryptography for platform staff accounts: password hashing (scrypt, memory-hard, built into
 * Node), single-use tokens stored only as hashes, TOTP for MFA, and encryption of TOTP secrets.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env';

const SCRYPT_LOG_N = 15; // N = 32768
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;

function scrypt(password: string, salt: Buffer, logN: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password.normalize('NFKC'), salt, KEY_LEN, { N: 2 ** logN, r, p, maxmem: 256 * 2 ** logN * r }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

/** Format: scrypt$logN$r$p$salt$hash (base64url). */
export async function hashStaffPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT_LOG_N, SCRYPT_R, SCRYPT_P);
  return ['scrypt', SCRYPT_LOG_N, SCRYPT_R, SCRYPT_P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

// Verifying against this keeps the response time the same whether or not the e-mail exists.
let dummyHash: Promise<string> | null = null;

export async function verifyStaffPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) {
    dummyHash ??= hashStaffPassword(randomBytes(16).toString('hex'));
    await verifyStaffPassword(password, await dummyHash);
    return false;
  }
  const [scheme, logN, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = await scrypt(password, Buffer.from(salt, 'base64url'), Number(logN), Number(r), Number(p));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

/** A random, URL-safe token. Only its SHA-256 is stored. */
export const newToken = () => randomBytes(32).toString('base64url');

/** The key that signs staff JWTs: never the member key, so member tokens cannot reach the portal. */
export function platformTokenSecret(): string {
  const e = env();
  return e.PLATFORM_JWT_SECRET ?? createHmac('sha256', e.JWT_ACCESS_SECRET).update('chamahub-platform-portal-v1').digest('base64url');
}

/* ---------------- TOTP (RFC 6238: SHA-1, 30 s, 6 digits) ---------------- */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, '').replace(/\s/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const newTotpSecret = () => base32Encode(randomBytes(20));

export function totpAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0xf;
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, '0');
}

/**
 * Accepts the current code and one step either side (clock drift) and returns the time step it
 * matched, so the caller can refuse a step that was already used (replay). Null when wrong.
 */
export function matchTotpStep(secret: string, code: string, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const step = Math.floor(now / 30_000);
  let found: number | null = null;
  for (const d of [-1, 0, 1]) if (timingSafeEqual(Buffer.from(totpAt(secret, step + d)), Buffer.from(code))) found = step + d;
  return found;
}

export function verifyTotp(secret: string, code: string, now = Date.now()): boolean {
  return matchTotpStep(secret, code, now) !== null;
}

/* ---------------- recovery codes ---------------- */

export const RECOVERY_CODE_COUNT = 10;

/** Ten single-use codes like K7QXM-2RTPA (50 bits each). Shown once; only hashes are stored. */
export function newRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const raw = base32Encode(randomBytes(7)).slice(0, 10);
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

export const normalizeRecoveryCode = (code: string) => code.replace(/[\s-]/g, '').toUpperCase();
export const hashRecoveryCode = (code: string) => sha256(`recovery:${normalizeRecoveryCode(code)}`);

/* ---------------- TOTP secrets at rest (AES-256-GCM) ---------------- */

const mfaKey = () => createHash('sha256').update(`${platformTokenSecret()}:mfa-secret`).digest();

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', mfaKey(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

export function decryptSecret(stored: string): string {
  const [v, iv, tag, data] = stored.split('.');
  if (v !== 'v1') throw new Error('Unknown secret format');
  const decipher = createDecipheriv('aes-256-gcm', mfaKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}
