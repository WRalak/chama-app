/**
 * Blocks passwords that attackers try first. There is no network check here (no breach API is
 * called): a list of the most common breached passwords and keyboard patterns, plus words a
 * Kenyan attacker would guess, compared after normalising case, look-alike characters and
 * trailing digits/symbols. "Password2026!" and "P@ssw0rd" are both caught.
 */
const COMMON = [
  'password', 'passw0rd', 'pass', 'letmein', 'welcome', 'admin', 'administrator', 'root', 'login', 'master', 'secret', 'qwerty', 'qwertyuiop', 'asdfgh', 'asdfghjkl',
  'zxcvbn', 'zxcvbnm', 'azerty', 'iloveyou', 'love', 'lovely', 'princess', 'sunshine', 'dragon', 'monkey', 'football', 'baseball', 'soccer', 'shadow', 'superman',
  'batman', 'trustno', 'whatever', 'freedom', 'hello', 'hellohello', 'abc', 'abcd', 'abcdef', 'abcdefg', 'abcdefgh', 'changeme', 'default', 'guest', 'test', 'tester',
  'testing', 'user', 'username', 'computer', 'internet', 'samsung', 'iphone', 'android', 'google', 'facebook', 'whatsapp', 'jesus', 'jesuschrist', 'christ', 'god',
  'godisgood', 'blessed', 'blessing', 'amen', 'praise', 'faith', 'grace', 'heaven', 'angel', 'family', 'mother', 'father', 'mama', 'baba', 'mum', 'dad', 'baby',
  'kenya', 'kenyan', 'nairobi', 'mombasa', 'kisumu', 'nakuru', 'eldoret', 'safaricom', 'mpesa', 'airtel', 'equity', 'kcb', 'chama', 'chamahub', 'harambee', 'uhuru',
  'jambo', 'karibu', 'asante', 'pesa', 'money', 'wallet', 'savings', 'loan', 'bank', 'cash', 'treasurer', 'chairperson', 'chairman', 'secretary', 'member', 'group',
  'arsenal', 'chelsea', 'manchester', 'liverpool', 'barcelona', 'madrid', 'gormahia', 'afcleopards', 'michael', 'john', 'james', 'peter', 'paul', 'mary', 'grace',
  'joseph', 'david', 'daniel', 'kevin', 'brian', 'faith', 'mercy', 'joy', 'wanjiku', 'kamau', 'otieno', 'ochieng', 'njeri', 'akinyi', 'mwangi', 'kipchoge',
  'starwars', 'pokemon', 'naruto', 'matrix', 'killer', 'hunter', 'ranger', 'buster', 'tigger', 'charlie', 'jordan', 'michelle', 'jennifer', 'thomas', 'robert',
  'access', 'flower', 'summer', 'winter', 'spring', 'autumn', 'monday', 'friday', 'january', 'december', 'qazwsx', 'qweasd', 'zaq', 'zaqxsw', 'mustang', 'ferrari',
];
const COMMON_SET = new Set(COMMON);

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '!': 'i' };

const letters = (s: string) => s.toLowerCase().replace(/[^a-z0-9@$!]/g, '');
const deLeet = (s: string) => s.replace(/[01345789@$!]/g, (c) => LEET[c] ?? c);

/** All digits, or a run like 123456 / 987654 / 111111 / 121212 with nothing else that matters. */
function isPattern(s: string) {
  const d = s.replace(/[^0-9a-z]/gi, '').toLowerCase();
  if (d.length < 4) return true;
  if (new Set(d).size <= 2) return true;
  const seq = '0123456789012345678901234567890abcdefghijklmnopqrstuvwxyz';
  const rev = [...seq].reverse().join('');
  return seq.includes(d) || rev.includes(d) || 'qwertyuiopasdfghjklzxcvbnm'.includes(d);
}

/**
 * Returns why a password is too guessable, or null. `context` holds the person's own details,
 * which may not appear in their password.
 */
export function passwordWeakness(password: string, context: { name?: string | null; phone?: string | null; email?: string | null } = {}): string | null {
  const plain = letters(password);
  // Strip trailing digits/symbols (Password2026!), then look-alikes (P@ssw0rd).
  const core = plain.replace(/[0-9@$!]+$/, '');
  for (const candidate of new Set([plain, core, deLeet(plain), deLeet(core), deLeet(core).replace(/[0-9]+$/, '')])) {
    if (!candidate) continue;
    if (COMMON_SET.has(candidate)) return 'This password is too common. Use a phrase of three or more unrelated words, e.g. "mango-taxi-river-42".';
    // Common word plus a little padding at the front ("1password", "mypassword").
    for (const w of COMMON) if (w.length >= 6 && candidate.endsWith(w) && candidate.length - w.length <= 3) return 'This password is too common. Use a phrase of three or more unrelated words, e.g. "mango-taxi-river-42".';
  }
  if (isPattern(password) || isPattern(core)) return 'Avoid number runs, keyboard patterns and repeated characters.';
  const lower = password.toLowerCase();
  const digits = password.replace(/\D/g, '');
  const phone = (context.phone ?? '').replace(/\D/g, '');
  if (phone.length >= 6) {
    const local = phone.slice(-9); // 7XXXXXXXX
    if (digits.includes(local.slice(-6)) || digits.includes(local)) return 'Do not use your phone number in your password.';
  }
  for (const part of (context.name ?? '').toLowerCase().split(/\s+/)) if (part.length >= 4 && lower.includes(part)) return 'Do not use your name in your password.';
  const user = (context.email ?? '').toLowerCase().split('@')[0];
  if (user && user.length >= 4 && lower.includes(user)) return 'Do not use your e-mail address in your password.';
  return null;
}
