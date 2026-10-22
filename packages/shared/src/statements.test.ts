import { describe, expect, it } from 'vitest';
import { extractPayer, guessStatementMapping, mappingProblems, matchStatementLine, MatchContext, normalizeStatementRow, parseStatementDate, StatementLineInput, StatementMapping, statementFingerprint } from './statements';

const members = [
  { membershipId: 'm-jane', fullName: 'Jane Wanjiru Kamau', phones: ['+254712345678'] },
  { membershipId: 'm-john', fullName: 'John Otieno', phones: ['+254722000111'] },
  { membershipId: 'm-jane2', fullName: 'Jane Achieng', phones: ['+254733000222'] },
];
const ctx = (over: Partial<MatchContext> = {}): MatchContext => ({ members, reports: [], knownReferences: new Set(), knownFingerprints: new Set(), accountReferencePrefix: 'UPENDO', ...over });
const line = (over: Partial<StatementLineInput> = {}): StatementLineInput => ({ rowNo: 1, transactionAt: '2026-10-01T07:00:00.000Z', amountCents: 200_000, reference: 'SJK12ABC34', payerName: null, payerPhone: null, accountReference: null, description: null, ...over });

describe('statement mapping', () => {
  it('recognises an M-Pesa Paybill export', () => {
    const m = guessStatementMapping(['Receipt No.', 'Completion Time', 'Initiation Time', 'Details', 'Transaction Status', 'Paid In', 'Withdrawn', 'Balance', 'Other Party Info', 'A/C No.']);
    expect(m).toEqual({ reference: 'Receipt No.', date: 'Completion Time', description: 'Details', status: 'Transaction Status', paidIn: 'Paid In', withdrawn: 'Withdrawn', payer: 'Other Party Info', accountReference: 'A/C No.' });
    expect(mappingProblems(m)).toEqual([]);
  });
  it('recognises a bank statement', () => {
    const m = guessStatementMapping(['Transaction Date', 'Narration', 'Reference', 'Debit', 'Credit', 'Balance']);
    expect(m).toMatchObject({ date: 'Transaction Date', description: 'Narration', reference: 'Reference', paidIn: 'Credit', withdrawn: 'Debit' });
  });
  it('says what is missing', () => {
    expect(mappingProblems({ payer: 'x' })).toEqual(['Choose the date column', 'Choose the amount or "paid in" column']);
  });
});

describe('parsing rows', () => {
  it('reads Kenyan date formats as Nairobi time', () => {
    expect(parseStatementDate('2026-10-01 10:15:00')).toBe('2026-10-01T07:15:00.000Z');
    expect(parseStatementDate('01/10/2026', '1:05 PM')).toBe('2026-10-01T10:05:00.000Z');
    expect(parseStatementDate('1 Oct 2026')).toBe('2026-09-30T21:00:00.000Z');
    expect(parseStatementDate('31/02/2026')).toBeNull();
    expect(parseStatementDate('yesterday')).toBeNull();
  });
  it('pulls the payer out of M-Pesa text', () => {
    expect(extractPayer('254712345678 - JANE KAMAU')).toEqual({ phone: '+254712345678', name: 'JANE KAMAU' });
    expect(extractPayer('Funds received from 0722000111 - John Otieno')).toEqual({ phone: '+254722000111', name: 'JOHN OTIENO' });
    expect(extractPayer('Transfer from MARY NJERI acc 445')).toEqual({ phone: null, name: 'MARY NJERI' });
    expect(extractPayer('')).toEqual({ phone: null, name: null });
  });
  const mapping: StatementMapping = { date: 'Completion Time', reference: 'Receipt No.', paidIn: 'Paid In', withdrawn: 'Withdrawn', payer: 'Other Party Info', status: 'Transaction Status', accountReference: 'A/C No.' };
  it('normalises a completed payment in', () => {
    const r = normalizeStatementRow({ 'Completion Time': '2026-10-01 10:00:00', 'Receipt No.': 'sjk12abc34', 'Paid In': '2,000.00', Withdrawn: '', 'Other Party Info': '254712345678 - JANE KAMAU', 'Transaction Status': 'Completed', 'A/C No.': 'upendo-0712345678' }, mapping, 2);
    expect(r).toEqual({ ok: true, line: { rowNo: 2, transactionAt: '2026-10-01T07:00:00.000Z', amountCents: 200_000, reference: 'SJK12ABC34', payerName: 'JANE KAMAU', payerPhone: '+254712345678', accountReference: 'UPENDO-0712345678', description: null } });
  });
  it('treats withdrawals as money out and skips failed rows', () => {
    const out = normalizeStatementRow({ 'Completion Time': '2026-10-01 10:00', 'Paid In': '', Withdrawn: '-500.00', 'Transaction Status': 'Completed' }, mapping, 3);
    expect(out.ok && out.line.amountCents).toBe(-50_000);
    expect(normalizeStatementRow({ 'Completion Time': '2026-10-01', 'Paid In': '100', 'Transaction Status': 'Failed' }, mapping, 4)).toMatchObject({ ok: false, skipped: true });
    expect(normalizeStatementRow({ 'Completion Time': 'soon', 'Paid In': '100' }, mapping, 5)).toMatchObject({ ok: false, error: expect.stringContaining('date') });
    expect(normalizeStatementRow({ 'Completion Time': '2026-10-01', 'Paid In': 'abc' }, mapping, 6)).toMatchObject({ ok: false, error: 'Cannot read the amount' });
  });
});

describe('matching', () => {
  it('matches a member’s own report only when the amount agrees', () => {
    const reports = [{ paymentId: 'p1', membershipId: 'm-john', reference: 'SJK12ABC34', amountCents: 200_000 }];
    expect(matchStatementLine(line(), ctx({ reports }))).toMatchObject({ kind: 'REPORT_MATCH', membershipId: 'm-john', reportPaymentId: 'p1' });
    const off = matchStatementLine(line({ amountCents: 150_000 }), ctx({ reports }));
    expect(off).toMatchObject({ kind: 'SUGGESTED', membershipId: null, reportPaymentId: 'p1' });
  });
  it('a registered phone is a clear match', () => {
    expect(matchStatementLine(line({ payerPhone: '+254712345678', payerName: 'JANE KAMAU' }), ctx())).toMatchObject({ kind: 'STRONG', membershipId: 'm-jane' });
  });
  it('the account reference can name the member', () => {
    expect(matchStatementLine(line({ accountReference: 'UPENDO-0722000111' }), ctx())).toMatchObject({ kind: 'STRONG', membershipId: 'm-john' });
  });
  it('a name alone is never more than a suggestion', () => {
    const r = matchStatementLine(line({ payerName: 'JOHN OTIENO' }), ctx());
    expect(r).toMatchObject({ kind: 'SUGGESTED', membershipId: null });
    expect(r.candidates[0].membershipId).toBe('m-john');
  });
  it('two plausible members make the line ambiguous, never assigned', () => {
    const r = matchStatementLine(line({ payerName: 'JANE' }), ctx());
    expect(r.kind).toBe('UNMATCHED'); // one shared first name is too weak for either
    const r2 = matchStatementLine(line({ payerName: 'JANE ACHIENG KAMAU' }), ctx());
    expect(r2).toMatchObject({ kind: 'AMBIGUOUS', membershipId: null });
    expect(r2.candidates.map((c) => c.membershipId).sort()).toEqual(['m-jane', 'm-jane2']);
  });
  it('a phone match plus another member’s name is ambiguous', () => {
    const r = matchStatementLine(line({ payerPhone: '+254712345678', payerName: 'JOHN OTIENO' }), ctx());
    expect(r).toMatchObject({ kind: 'AMBIGUOUS', membershipId: null });
  });
  it('flags duplicates and money out', () => {
    expect(matchStatementLine(line(), ctx({ knownReferences: new Set(['SJK12ABC34']) })).kind).toBe('DUPLICATE');
    expect(matchStatementLine(line(), ctx({ knownFingerprints: new Set([statementFingerprint(line())]) })).kind).toBe('DUPLICATE');
    expect(matchStatementLine(line({ amountCents: -100 }), ctx()).kind).toBe('OUTGOING');
    expect(matchStatementLine(line({ payerPhone: '+254799999999' }), ctx()).kind).toBe('UNMATCHED');
  });
  it('fingerprints without a code use time, amount and payer', () => {
    expect(statementFingerprint(line({ reference: null, payerPhone: '+254712345678' }))).toBe('row:2026-10-01T07:00|200000|+254712345678');
  });
});
