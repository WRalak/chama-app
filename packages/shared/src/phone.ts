/**
 * Normalises Kenyan mobile numbers to E.164 (+2547XXXXXXXX / +2541XXXXXXXX).
 * Accepts 07…, 01…, 7…, 2547…, +2547… with spaces or dashes.
 */
export function normalizeKenyanPhone(input: string): string | null {
  const digits = input.replace(/[\s\-()]/g, '').replace(/^\+/, '');
  let national: string;
  if (/^254[17]\d{8}$/.test(digits)) national = digits.slice(3);
  else if (/^0[17]\d{8}$/.test(digits)) national = digits.slice(1);
  else if (/^[17]\d{8}$/.test(digits)) national = digits;
  else return null;
  return `+254${national}`;
}

/** "+254712345678" → "0712 345 678" */
export function formatKenyanPhone(e164: string): string {
  const m = /^\+254(\d{3})(\d{3})(\d{3})$/.exec(e164);
  return m ? `0${m[1]} ${m[2]} ${m[3]}` : e164;
}

/** "+254712345678" → "0712 *** 678" for display in shared contexts. */
export function maskPhone(e164: string): string {
  const m = /^\+254(\d{3})\d{3}(\d{3})$/.exec(e164);
  return m ? `0${m[1]} *** ${m[2]}` : '***';
}
