import { parseKes } from './money';
import { normalizeKenyanPhone } from './phone';

/**
 * Statement import and matching.
 *
 * Officers download a statement from M-Pesa, a Paybill/Till portal or their
 * bank and upload it. ChamaHub never logs into those accounts. Each line is
 * matched to a member only when the evidence is clear; anything else goes to
 * a person to decide. A line is never assigned to a member silently.
 */

/** Which spreadsheet column holds each field. Values are header names as they appear in the file. */
export interface StatementMapping {
  date: string;
  /** Optional when the date column already contains the time. */
  time?: string;
  reference?: string;
  /** A single signed amount column, or… */
  amount?: string;
  /** …separate money-in and money-out columns. */
  paidIn?: string;
  withdrawn?: string;
  /** Payer name and/or phone, e.g. "254712345678 - JANE DOE". */
  payer?: string;
  phone?: string;
  accountReference?: string;
  description?: string;
  /** Rows whose status is not "Completed" (or similar) are skipped. */
  status?: string;
}

export const STATEMENT_FIELDS: { key: keyof StatementMapping; label: string; required?: boolean }[] = [
  { key: 'date', label: 'Date / completion time', required: true },
  { key: 'time', label: 'Time (if separate)' },
  { key: 'reference', label: 'Transaction code / receipt no.' },
  { key: 'amount', label: 'Amount (one column)' },
  { key: 'paidIn', label: 'Paid in / credit' },
  { key: 'withdrawn', label: 'Withdrawn / debit' },
  { key: 'payer', label: 'Payer / other party' },
  { key: 'phone', label: 'Payer phone' },
  { key: 'accountReference', label: 'Account no. entered by payer' },
  { key: 'description', label: 'Details / narration' },
  { key: 'status', label: 'Transaction status' },
];

const GUESSES: Record<keyof StatementMapping, RegExp[]> = {
  date: [/^completion time$/, /^(transaction |value |posting |txn )?date( ?(&|and) ?time)?$/, /^date$/, /^initiation time$/],
  time: [/^time$/],
  reference: [/^receipt( no\.?| number)?$/, /^(transaction )?(code|ref(erence)?|id)( no\.?)?$/, /^mpesa (code|ref)/],
  amount: [/^amount$/, /^transaction amount$/],
  paidIn: [/^paid in$/, /^credit( amount)?$/, /^money in$/, /^deposits?$/, /^cr$/],
  withdrawn: [/^withdrawn?$/, /^debit( amount)?$/, /^money out$/, /^withdrawals?$/, /^dr$/],
  payer: [/^other party info$/, /^other party$/, /^(payer|sender|customer)( name)?$/, /^name$/],
  phone: [/^(payer |sender |msisdn|phone)( ?no\.?| number)?$/, /^msisdn$/],
  accountReference: [/^a\/c no\.?$/, /^account( no\.?| number| reference)?$/, /^bill ?ref(erence)?( number)?$/],
  description: [/^details$/, /^(narration|narrative|description|particulars)$/],
  status: [/^(transaction )?status$/],
};

/** Guesses the mapping from a file's headers (M-Pesa, Paybill and common bank layouts). */
export function guessStatementMapping(headers: string[]): Partial<StatementMapping> {
  const norm = headers.map((h) => h.trim().toLowerCase().replace(/\s+/g, ' '));
  const taken = new Set<number>();
  const out: Partial<StatementMapping> = {};
  for (const key of Object.keys(GUESSES) as (keyof StatementMapping)[]) {
    for (const re of GUESSES[key]) {
      const i = norm.findIndex((h, idx) => !taken.has(idx) && re.test(h));
      if (i >= 0) {
        out[key] = headers[i];
        taken.add(i);
        break;
      }
    }
  }
  if (out.paidIn && out.amount) delete out.amount;
  return out;
}

export function mappingProblems(m: Partial<StatementMapping>): string[] {
  const problems: string[] = [];
  if (!m.date) problems.push('Choose the date column');
  if (!m.amount && !m.paidIn) problems.push('Choose the amount or "paid in" column');
  if (!m.reference && !m.payer && !m.phone && !m.description) problems.push('Choose at least one of: transaction code, payer or details');
  return problems;
}

export interface StatementLineInput {
  rowNo: number;
  /** ISO timestamp in UTC. */
  transactionAt: string;
  /** Positive is money in, negative money out. */
  amountCents: number;
  reference: string | null;
  payerName: string | null;
  payerPhone: string | null;
  accountReference: string | null;
  description: string | null;
}

export type NormalizedRow = { ok: true; line: StatementLineInput } | { ok: false; rowNo: number; error: string; skipped?: boolean };

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** Parses the date formats M-Pesa and Kenyan banks export, as Nairobi time (UTC+3). */
export function parseStatementDate(raw: string, time?: string): string | null {
  const s = `${raw} ${time ?? ''}`.trim().replace(/\s+/g, ' ');
  let y: number, mo: number, d: number;
  let rest = '';
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](.*))?$/.exec(s))) [y, mo, d, rest] = [+m[1], +m[2], +m[3], m[4] ?? ''];
  else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?: (.*))?$/.exec(s))) [d, mo, y, rest] = [+m[1], +m[2], +m[3], m[4] ?? ''];
  else if ((m = /^(\d{1,2})[ -]([A-Za-z]{3})[a-z]*[ -,]*(\d{4})(?: (.*))?$/.exec(s)) && MONTHS[m[2].toLowerCase()]) [d, mo, y, rest] = [+m[1], MONTHS[m[2].toLowerCase()], +m[3], m[4] ?? ''];
  else return null;
  let hh = 0, mm = 0, ss = 0;
  const t = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*([AaPp][Mm])?(?:Z|[+-]\d{2}:?\d{2})?$/.exec(rest.trim());
  if (rest.trim() && !t) return null;
  if (t) {
    hh = +t[1]; mm = +t[2]; ss = +(t[3] ?? 0);
    if (t[4]) hh = (hh % 12) + (t[4].toLowerCase() === 'pm' ? 12 : 0);
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || hh > 23 || mm > 59 || ss > 59) return null;
  const utc = Date.UTC(y, mo - 1, d, hh - 3, mm, ss);
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCMonth() !== mo - 1) return null;
  return new Date(utc).toISOString();
}

/** Pulls a phone and name out of text like "254712345678 - JANE DOE" or "Funds received from 0712345678 - Jane Doe". */
export function extractPayer(text: string | null | undefined): { phone: string | null; name: string | null } {
  if (!text) return { phone: null, name: null };
  const phoneMatch = /(?:\+?254|\b0)[17]\d{8}\b/.exec(text);
  const phone = phoneMatch ? normalizeKenyanPhone(phoneMatch[0]) : null;
  // The name is what follows the phone ("… 0712345678 - JANE DOE"), or else the text after "from".
  let rest = phoneMatch ? text.slice(phoneMatch.index + phoneMatch[0].length) : (/\bfrom\b(.*)$/i.exec(text)?.[1] ?? (/^[A-Za-z' .-]+$/.test(text) ? text : ''));
  rest = rest.replace(/\b(acc(ount)?\.?|a\/c)\b.*$/i, '').replace(/[^A-Za-z' .-]/g, ' ').replace(/^[\s.-]+|[\s.-]+$/g, '').replace(/\s+/g, ' ');
  return { phone, name: rest.length >= 3 ? rest.toUpperCase() : null };
}

function money(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const v = raw.trim().replace(/^\((.*)\)$/, '-$1');
  if (!v || v === '-') return null;
  try {
    return parseKes(v);
  } catch {
    return Number.NaN;
  }
}

const COMPLETED = /^(completed?|success(ful)?|posted|cleared|ok)$/i;

/** Turns one spreadsheet row into a statement line, or says why it cannot. */
export function normalizeStatementRow(row: Record<string, string>, mapping: StatementMapping, rowNo: number): NormalizedRow {
  const get = (k?: string) => (k ? (row[k] ?? '').toString().trim() : '');
  if (mapping.status && get(mapping.status) && !COMPLETED.test(get(mapping.status))) return { ok: false, rowNo, error: `Status is "${get(mapping.status)}"`, skipped: true };
  const when = parseStatementDate(get(mapping.date), mapping.time ? get(mapping.time) : undefined);
  if (!when) return { ok: false, rowNo, error: `Cannot read the date "${get(mapping.date)}"` };
  let amount: number | null;
  if (mapping.paidIn) {
    const inn = money(get(mapping.paidIn));
    const out = money(mapping.withdrawn ? get(mapping.withdrawn) : undefined);
    if (Number.isNaN(inn) || Number.isNaN(out)) return { ok: false, rowNo, error: 'Cannot read the amount' };
    amount = (inn ?? 0) > 0 ? inn : out ? -Math.abs(out) : inn;
  } else {
    amount = money(get(mapping.amount));
    if (Number.isNaN(amount)) return { ok: false, rowNo, error: 'Cannot read the amount' };
  }
  if (!amount) return { ok: false, rowNo, error: 'No amount', skipped: true };
  const payerText = get(mapping.payer);
  const description = get(mapping.description) || null;
  const fromPayer = extractPayer(payerText);
  const fromDetails = extractPayer(description);
  const explicitPhone = mapping.phone ? normalizeKenyanPhone(get(mapping.phone)) : null;
  const reference = get(mapping.reference).toUpperCase().replace(/\s+/g, '') || null;
  return {
    ok: true,
    line: {
      rowNo,
      transactionAt: when,
      amountCents: amount,
      reference,
      payerName: fromPayer.name ?? fromDetails.name,
      payerPhone: explicitPhone ?? fromPayer.phone ?? fromDetails.phone,
      accountReference: get(mapping.accountReference).toUpperCase() || null,
      description,
    },
  };
}

/** Identity of a transaction across imports: the provider's code when there is one. */
export function statementFingerprint(l: Pick<StatementLineInput, 'reference' | 'transactionAt' | 'amountCents' | 'payerPhone' | 'payerName'>): string {
  if (l.reference) return `ref:${l.reference}`;
  return `row:${l.transactionAt.slice(0, 16)}|${l.amountCents}|${l.payerPhone ?? l.payerName ?? ''}`;
}

/* ---------- matching ---------- */

export interface MatchMember {
  membershipId: string;
  fullName: string;
  /** E.164 phones registered to the member. */
  phones: string[];
}

export interface MatchReport {
  paymentId: string;
  membershipId: string;
  reference: string;
  amountCents: number;
}

export interface MatchContext {
  members: MatchMember[];
  /** Pending payments members reported themselves, awaiting a statement or an officer. */
  reports: MatchReport[];
  /** References already recorded in the group (other than open reports), plus earlier imported lines. */
  knownReferences: Set<string>;
  knownFingerprints: Set<string>;
  /** e.g. "UPENDO" when members are asked to enter "UPENDO-0712345678" as the account. */
  accountReferencePrefix?: string | null;
}

export type MatchKind = 'REPORT_MATCH' | 'STRONG' | 'SUGGESTED' | 'AMBIGUOUS' | 'UNMATCHED' | 'DUPLICATE' | 'OUTGOING';

export interface MatchCandidate {
  membershipId: string;
  fullName: string;
  score: number;
  reasons: string[];
}

export interface MatchResult {
  kind: MatchKind;
  candidates: MatchCandidate[];
  /** Set only for REPORT_MATCH and STRONG. */
  membershipId: string | null;
  reportPaymentId: string | null;
  explanation: string;
}

const STRONG_SCORE = 50;
const WEAK_SCORE = 20;

function tokens(name: string) {
  return name.toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/).filter((t) => t.length >= 2);
}

function nameScore(payer: string, member: string): { score: number; reason: string } | null {
  const p = new Set(tokens(payer));
  const m = tokens(member);
  if (!p.size || !m.length) return null;
  const hits = m.filter((t) => p.has(t)).length;
  if (hits === 0) return null;
  if (hits >= 2 && hits >= Math.min(m.length, p.size)) return { score: 30, reason: 'Payer name matches the member’s name' };
  return { score: 10 * hits, reason: `Payer name partly matches (${hits} of ${m.length} names)` };
}

/**
 * Scores one incoming line against the group's members.
 *
 * STRONG needs a single member with independent identifying evidence (their
 * registered phone, or an account reference that names them). A name alone is
 * only ever a suggestion, and two plausible members make the line ambiguous.
 */
export function matchStatementLine(line: StatementLineInput, ctx: MatchContext): MatchResult {
  const none = (kind: MatchKind, explanation: string, candidates: MatchCandidate[] = []): MatchResult => ({ kind, candidates, membershipId: null, reportPaymentId: null, explanation });
  if (line.amountCents <= 0) return none('OUTGOING', 'Money left the account; this is not a member payment.');
  const fp = statementFingerprint(line);
  if (ctx.knownFingerprints.has(fp)) return none('DUPLICATE', 'This transaction was already imported from an earlier statement.');

  if (line.reference) {
    const report = ctx.reports.find((r) => r.reference.toUpperCase() === line.reference);
    if (report) {
      const member = ctx.members.find((m) => m.membershipId === report.membershipId);
      const c: MatchCandidate = { membershipId: report.membershipId, fullName: member?.fullName ?? '', score: 100, reasons: ['The member reported this transaction code'] };
      if (report.amountCents === line.amountCents) {
        return { kind: 'REPORT_MATCH', candidates: [c], membershipId: report.membershipId, reportPaymentId: report.paymentId, explanation: `Matches ${c.fullName}’s own report of this payment.` };
      }
      c.score = 40;
      c.reasons.push(`but they reported ${report.amountCents / 100} and the statement shows ${line.amountCents / 100}`);
      return { ...none('SUGGESTED', 'The code matches a member’s report but the amount does not. Check before confirming.', [c]), reportPaymentId: report.paymentId };
    }
    if (ctx.knownReferences.has(line.reference)) return none('DUPLICATE', `${line.reference} is already recorded in the group.`);
  }

  const prefix = ctx.accountReferencePrefix?.toUpperCase().trim();
  const acc = line.accountReference?.toUpperCase().replace(prefix ? new RegExp(`^${prefix.replace(/[^A-Z0-9]/g, '')}[-\\s#:]*`) : /^$/, '') ?? '';
  const accPhone = acc ? normalizeKenyanPhone(acc.replace(/[^0-9+]/g, '')) : null;

  const candidates: MatchCandidate[] = [];
  for (const m of ctx.members) {
    let score = 0;
    const reasons: string[] = [];
    if (line.payerPhone && m.phones.includes(line.payerPhone)) {
      score += 60;
      reasons.push('Paid from the member’s registered phone');
    }
    if (accPhone && m.phones.includes(accPhone)) {
      score += 50;
      reasons.push('Account reference is the member’s phone number');
    }
    if (line.payerName) {
      const ns = nameScore(line.payerName, m.fullName);
      if (ns) {
        score += ns.score;
        reasons.push(ns.reason);
      }
    }
    if (score > 0) candidates.push({ membershipId: m.membershipId, fullName: m.fullName, score, reasons });
  }
  candidates.sort((a, b) => b.score - a.score || a.fullName.localeCompare(b.fullName));
  const top = candidates.slice(0, 5);
  const strong = candidates.filter((c) => c.score >= STRONG_SCORE);
  const plausible = candidates.filter((c) => c.score >= WEAK_SCORE);

  if (strong.length === 1 && plausible.length === 1) {
    return { kind: 'STRONG', candidates: top, membershipId: strong[0].membershipId, reportPaymentId: null, explanation: `${strong[0].reasons.join('; ')}.` };
  }
  if (plausible.length > 1) return none('AMBIGUOUS', `${plausible.length} members could have made this payment. Choose the right one.`, top);
  if (plausible.length === 1) return none('SUGGESTED', `Possibly ${plausible[0].fullName}: ${plausible[0].reasons.join('; ').toLowerCase()}. Confirm before assigning.`, top);
  return none('UNMATCHED', 'No member could be identified from this line.', top);
}

export const STATEMENT_MATCH_LABELS: Record<MatchKind, string> = {
  REPORT_MATCH: 'Matches a member’s report',
  STRONG: 'Clear match',
  SUGGESTED: 'Possible match — check',
  AMBIGUOUS: 'Several possible members',
  UNMATCHED: 'No member found',
  DUPLICATE: 'Already recorded',
  OUTGOING: 'Money out',
};
