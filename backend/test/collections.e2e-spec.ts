import { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { todayInNairobi } from '@chamahub/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { as, createGroupWith, createTestApp, idem, registerUser, resetDatabase, TestUser } from './helpers';

const today = todayInNairobi();
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5f4c8e70000000049454e44ae426082', 'hex').toString('base64');

/**
 * Phase 1 collections: payment destinations under maker-checker, evidence and
 * payment history, statement import with a review queue that never assigns an
 * ambiguous line, and WhatsApp summaries built only from confirmed records.
 */
describe('Collections', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let chair: TestUser, vice: TestUser, treasurer: TestUser, secretary: TestUser, auditor: TestUser, jane: TestUser, john: TestUser, outsider: TestUser;
  let groupId: string;
  let ids: Record<string, string>;
  let paybillId: string;
  const g = (path: string) => `/v1/groups/${groupId}/${path}`;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await resetDatabase(prisma);
    chair = await registerUser(app, 'Grace Chair');
    vice = await registerUser(app, 'Victor Vice');
    treasurer = await registerUser(app, 'Tom Treasurer');
    secretary = await registerUser(app, 'Sam Secretary');
    auditor = await registerUser(app, 'Aud Auditor');
    jane = await registerUser(app, 'Jane Wanjiru Kamau');
    john = await registerUser(app, 'John Otieno');
    outsider = await registerUser(app, 'Olive Outsider');
    const grp = await createGroupWith(app, chair, [
      { user: vice, role: 'VICE_CHAIRPERSON' },
      { user: treasurer, role: 'TREASURER' },
      { user: secretary, role: 'SECRETARY' },
      { user: auditor, role: 'AUDITOR' },
      { user: jane, role: 'MEMBER' },
      { user: john, role: 'MEMBER' },
    ]);
    groupId = grp.groupId;
    ids = grp.membershipIds;
    await createGroupWith(app, outsider, []);
    await as(app, treasurer).post(g('schedules'), { name: 'Monthly', amountCents: 200_000, frequency: 'MONTHLY', startDate: today }).expect(201);
  });
  afterAll(async () => app.close());

  describe('payment destinations', () => {
    it('validates details for each type', async () => {
      const bad = await as(app, treasurer).post(g('payment-destinations'), { type: 'PAYBILL', displayName: 'Group Paybill', accountNumber: '12', reason: 'Collect contributions' }).expect(400);
      expect(JSON.stringify(bad.body)).toContain('5–7 digits');
      await as(app, treasurer).post(g('payment-destinations'), { type: 'PERSONAL_MPESA', displayName: 'Tom M-Pesa', accountNumber: '0712', reason: 'Collect contributions' }).expect(400);
    });

    it('a proposal is invisible to members and cannot be approved by its proposer', async () => {
      const r = await as(app, treasurer).post(g('payment-destinations'), { type: 'PAYBILL', displayName: 'Upendo Paybill', accountNumber: '522533', accountReference: 'UPENDO-<your phone>', accountName: 'UPENDO WOMEN GROUP', intendedUse: ['CONTRIBUTION'], verification: 'STATEMENT_IMPORT', reason: 'Group Paybill opened at the bank' }).expect(201);
      paybillId = r.body.id;
      expect(r.body.status).toBe('PENDING_APPROVAL');
      expect((await as(app, jane).get(g('payment-destinations')).expect(200)).body).toEqual([]);
      const forChair = (await as(app, chair).get(g('payment-destinations')).expect(200)).body;
      expect(forChair[0]).toMatchObject({ status: 'PENDING_APPROVAL', approvalsRequired: 2, can: { approve: true } });
      expect((await as(app, treasurer).get(g('payment-destinations')).expect(200)).body[0].can.approve).toBe(false);
      await as(app, treasurer).post(g(`payment-destinations/${paybillId}/decision`), { decision: 'APPROVE' }).expect(403);
      await as(app, secretary).post(g(`payment-destinations/${paybillId}/decision`), { decision: 'APPROVE' }).expect(403);
      await as(app, jane).post(g('payment-destinations'), { type: 'CASH', displayName: 'Cash to Jane', reason: 'I will collect it' }).expect(403);
    });

    it('needs the group’s financial approvals, then every member is told', async () => {
      await as(app, chair).post(g(`payment-destinations/${paybillId}/decision`), { decision: 'APPROVE' }).expect(200);
      await as(app, chair).post(g(`payment-destinations/${paybillId}/decision`), { decision: 'APPROVE' }).expect(409);
      expect((await as(app, jane).get(g('payment-destinations')).expect(200)).body).toEqual([]);
      const done = await as(app, vice).post(g(`payment-destinations/${paybillId}/decision`), { decision: 'APPROVE' }).expect(200);
      expect(done.body.status).toBe('ACTIVE');
      const forJane = (await as(app, jane).get(g('payment-destinations')).expect(200)).body;
      expect(forJane).toHaveLength(1);
      expect(forJane[0]).toMatchObject({ displayName: 'Upendo Paybill', accountNumber: '522533', accountReference: 'UPENDO-<your phone>', validNow: true, approvals: [], proposalReason: null });
      const notes = (await as(app, john).get('/v1/notifications').expect(200)).body;
      expect(JSON.stringify(notes)).toContain('New way to pay the group');
    });

    it('details cannot be edited in the database, and destinations cannot be deleted', async () => {
      await expect(prisma.paymentDestination.update({ where: { id: paybillId }, data: { accountNumber: '999999' } })).rejects.toThrow(/cannot be changed/);
      await expect(prisma.paymentDestination.delete({ where: { id: paybillId } })).rejects.toThrow(/never deleted/);
    });

    it('a replacement retires the old destination only when approved, and old details are masked for members', async () => {
      const r = await as(app, treasurer).post(g('payment-destinations'), { type: 'PERSONAL_MPESA', displayName: 'Treasurer M-Pesa', accountNumber: '0711222333', accountName: 'TOM TREASURER', replacesId: paybillId, reason: 'Bank closed the Paybill' }).expect(201);
      await as(app, treasurer).post(g('payment-destinations'), { type: 'TILL', displayName: 'Till', accountNumber: '123456', replacesId: paybillId, reason: 'Second attempt' }).expect(409);
      // Until the change is approved, members still pay to the Paybill.
      expect((await as(app, jane).get(g('payment-destinations')).expect(200)).body.map((d: { displayName: string }) => d.displayName)).toEqual(['Upendo Paybill']);
      await as(app, chair).post(g(`payment-destinations/${r.body.id}/decision`), { decision: 'APPROVE' }).expect(200);
      await as(app, vice).post(g(`payment-destinations/${r.body.id}/decision`), { decision: 'APPROVE' }).expect(200);
      const forJane = (await as(app, jane).get(g('payment-destinations')).expect(200)).body;
      const old = forJane.find((d: { id: string }) => d.id === paybillId);
      const now = forJane.find((d: { id: string }) => d.id === r.body.id);
      expect(now).toMatchObject({ status: 'ACTIVE', validNow: true, accountNumber: '0711 222 333' });
      expect(old).toMatchObject({ status: 'RETIRED', validNow: false, accountNumber: '**2533', accountReference: null, replacedByName: 'Treasurer M-Pesa' });
      // Officers still see the full history.
      const forAuditor = (await as(app, auditor).get(g('payment-destinations')).expect(200)).body;
      expect(forAuditor.find((d: { id: string }) => d.id === paybillId).accountNumber).toBe('522533');
      const notes = (await as(app, john).get('/v1/notifications').expect(200)).body;
      expect(JSON.stringify(notes)).toContain('payment details have changed');
    });

    it('a member cannot report paying to a retired or unapproved destination', async () => {
      const res = await as(app, jane).post(g('payments'), { memberId: ids[jane.id], amountCents: 200_000, method: 'MPESA', reference: 'SJK0OLD001', paidAt: today, destinationId: paybillId, idempotencyKey: idem() }).expect(422);
      expect(res.body.message).toContain('not valid');
      const rejected = await as(app, treasurer).post(g('payment-destinations'), { type: 'CASH', displayName: 'Cash at meetings', reason: 'For members without M-Pesa' }).expect(201);
      await as(app, jane).post(g('payments'), { memberId: ids[jane.id], amountCents: 200_000, method: 'CASH', paidAt: today, destinationId: rejected.body.id, idempotencyKey: idem() }).expect(422);
      await as(app, chair).post(g(`payment-destinations/${rejected.body.id}/decision`), { decision: 'REJECT' }).expect(422);
      await as(app, chair).post(g(`payment-destinations/${rejected.body.id}/decision`), { decision: 'REJECT', comment: 'We agreed no cash' }).expect(200);
    });
  });

  describe('evidence and payment history', () => {
    let payId: string;
    it('a member reports a payment to the current destination and attaches a receipt', async () => {
      const dests = (await as(app, jane).get(g('payment-destinations')).expect(200)).body;
      const current = dests.find((d: { validNow: boolean }) => d.validNow);
      const rep = await as(app, jane).post(g('payments'), { memberId: ids[jane.id], amountCents: 200_000, method: 'MPESA', reference: 'SJK12ABC34', paidAt: today, destinationId: current.id, idempotencyKey: idem() }).expect(201);
      payId = rep.body.id;
      expect(rep.body).toMatchObject({ status: 'PENDING', destinationName: 'Treasurer M-Pesa' });
      const up = await as(app, jane).post(g(`payments/${payId}/evidence`), { fileName: 'mpesa.png', mimeType: 'image/png', dataBase64: PNG, note: 'M-Pesa message screenshot' }).expect(201);
      expect(up.body.reusedOnAnotherPayment).toBe(false);
      await as(app, jane).post(g(`payments/${payId}/evidence`), { fileName: 'again.png', mimeType: 'image/png', dataBase64: PNG }).expect(409);
      // A renamed file is not accepted as a photo.
      await as(app, jane).post(g(`payments/${payId}/evidence`), { fileName: 'x.png', mimeType: 'image/png', dataBase64: Buffer.from('this is not really a png file').toString('base64') }).expect(422);
    });

    it('only the member and officers can see the history and the file', async () => {
      const h = (await as(app, treasurer).get(g(`payments/${payId}/history`)).expect(200)).body;
      expect(h.destination).toMatchObject({ displayName: 'Treasurer M-Pesa', validNow: true });
      expect(h.evidence).toHaveLength(1);
      expect(h.events.map((e: { kind: string }) => e.kind)).toEqual(['CREATED', 'EVIDENCE_ADDED']);
      expect(h.events[0].label).toBe('Reported by the member');
      const file = await as(app, jane).get(g(`payments/${payId}/evidence/${h.evidence[0].id}`)).expect(200);
      expect(file.headers['content-type']).toBe('image/png');
      await as(app, john).get(g(`payments/${payId}/history`)).expect(404);
      await as(app, john).get(g(`payments/${payId}/evidence/${h.evidence[0].id}`)).expect(404);
      await as(app, john).post(g(`payments/${payId}/evidence`), { fileName: 'a.png', mimeType: 'image/png', dataBase64: PNG }).expect(404);
      await as(app, outsider).get(g(`payments/${payId}/history`)).expect(404);
    });

    it('history and evidence cannot be altered', async () => {
      await expect(prisma.paymentEvent.deleteMany({ where: { paymentId: payId } })).rejects.toThrow(/append-only/);
      await expect(prisma.paymentEvidence.updateMany({ where: { paymentId: payId }, data: { note: 'edited' } })).rejects.toThrow(/append-only/);
    });
  });

  describe('statement import', () => {
    const csv = (rows: string[]) =>
      ['UPENDO GROUP M-PESA STATEMENT', 'Period: this month', '', 'Receipt No.,Completion Time,Details,Transaction Status,Paid In,Withdrawn,Other Party Info,A/C No.', ...rows].join('\n');
    const at = `${today} 09:30:00`;
    let file = '';
    const buildFile = () => csv([
      `SJK12ABC34,${at},Funds received,Completed,"2,000.00",,254700000000 - SOMEONE,`, // Jane's own report
      `SJK55PHN01,${at},Funds received,Completed,2000.00,,${john.phone} - J OTIENO,`, // John's registered phone
      `SJK77NME02,${at},Funds received,Completed,2000.00,,254799000111 - JOHN OTIENO,`, // name only
      `SJK88AMB03,${at},Funds received,Completed,2000.00,,254799000222 - JANE JOHN OTIENO KAMAU,`, // two members
      `SJK99OUT04,${at},Pay to supplier,Completed,,-500.00,SUPPLIER LTD,`,
      `SJK00FAI05,${at},Funds received,Failed,2000.00,,254799000333 - X,`,
      `SJK12ABC34,${at},Funds received,Completed,"2,000.00",,254700000000 - SOMEONE,`, // same code twice in the file
    ]);
    let importId: string;
    let lines: { id: string; reference: string; match: string; state: string; suggestedMemberId: string | null; candidates: { membershipId: string }[] }[];

    // John's phone is only known once the users exist.
    beforeAll(() => {
      file = buildFile();
    });

    it('previews the file with the detected columns, without saving anything', async () => {
      const p = (await as(app, treasurer).post(g('statement-imports/preview'), { fileName: 'october.csv', csv: file }).expect(200)).body;
      expect(p.mapping).toMatchObject({ reference: 'Receipt No.', date: 'Completion Time', paidIn: 'Paid In', payer: 'Other Party Info' });
      expect(p.problems).toEqual([]);
      expect(p.counts).toEqual({ REPORT_MATCH: 1, STRONG: 1, SUGGESTED: 1, AMBIGUOUS: 1, OUTGOING: 1, SKIPPED: 1, DUPLICATE: 1 });
      expect(await prisma.statementImport.count()).toBe(0);
      await as(app, secretary).post(g('statement-imports/preview'), { fileName: 'october.csv', csv: file }).expect(403);
    });

    it('imports the lines into a review queue; nothing is assigned yet', async () => {
      const r = await as(app, treasurer).post(g('statement-imports'), { fileName: 'october.csv', csv: file }).expect(201);
      importId = r.body.id;
      expect(r.body.lineCount).toBe(6);
      await as(app, treasurer).post(g('statement-imports'), { fileName: 'october-again.csv', csv: file }).expect(409);
      lines = (await as(app, treasurer).get(g(`statement-imports/${importId}/lines`)).expect(200)).body;
      expect(lines.every((l) => l.state === 'OPEN')).toBe(true);
      const amb = lines.find((l) => l.reference === 'SJK88AMB03')!;
      expect(amb).toMatchObject({ match: 'AMBIGUOUS', suggestedMemberId: null });
      expect(amb.candidates.map((c) => c.membershipId).sort()).toEqual([ids[jane.id], ids[john.id]].sort());
      expect(lines.find((l) => l.reference === 'SJK77NME02')).toMatchObject({ match: 'SUGGESTED', suggestedMemberId: null });
      expect((await as(app, auditor).get(g('statement-imports')).expect(200)).body[0]).toMatchObject({ lineCount: 6, openCount: 6 });
      await as(app, jane).get(g('statement-imports')).expect(403);
    });

    it('bulk confirmation takes only clear matches', async () => {
      const res = (await as(app, treasurer).post(g('statement-lines/confirm-matches'), { lineIds: lines.map((l) => l.id) }).expect(200)).body;
      expect(res.confirmed).toBe(2);
      expect(res.failed).toHaveLength(4);
      // Jane's own report is now confirmed by the statement.
      const janePay = await prisma.payment.findFirstOrThrow({ where: { reference: 'SJK12ABC34' } });
      expect(janePay.status).toBe('CONFIRMED');
      const h = (await as(app, jane).get(g(`payments/${janePay.id}/history`)).expect(200)).body;
      expect(h.events.map((e: { kind: string }) => e.kind)).toEqual(['CREATED', 'EVIDENCE_ADDED', 'STATEMENT_MATCHED', 'STATUS_CHANGED']);
      expect(h.events[3]).toMatchObject({ fromStatus: 'PENDING', toStatus: 'CONFIRMED', actorName: 'Tom Treasurer' });
      // John's unreported payment becomes a payment that a second officer must verify.
      const johnPay = await prisma.payment.findFirstOrThrow({ where: { reference: 'SJK55PHN01' } });
      expect(johnPay).toMatchObject({ status: 'PENDING', source: 'STATEMENT', membershipId: ids[john.id] });
      await as(app, treasurer).post(g(`payments/${johnPay.id}/verify`), { decision: 'CONFIRM' }).expect(403);
      await as(app, chair).post(g(`payments/${johnPay.id}/verify`), { decision: 'CONFIRM' }).expect(200);
    });

    it('an ambiguous line is assigned only when an officer chooses the member', async () => {
      const amb = lines.find((l) => l.reference === 'SJK88AMB03')!;
      const dup = lines.find((l) => l.match === 'DUPLICATE');
      const out = lines.find((l) => l.match === 'OUTGOING')!;
      await as(app, treasurer).post(g(`statement-lines/${out.id}/resolve`), { action: 'CONFIRM', memberId: ids[jane.id] }).expect(422);
      if (dup) await as(app, treasurer).post(g(`statement-lines/${dup.id}/resolve`), { action: 'CONFIRM', memberId: ids[jane.id] }).expect(422);
      await as(app, treasurer).post(g(`statement-lines/${amb.id}/resolve`), { action: 'CONFIRM', memberId: ids[treasurer.id] }).expect(403);
      const r = (await as(app, treasurer).post(g(`statement-lines/${amb.id}/resolve`), { action: 'CONFIRM', memberId: ids[jane.id], note: 'Jane confirmed by phone' }).expect(200)).body;
      expect(r).toMatchObject({ state: 'CONFIRMED', paymentStatus: 'PENDING' });
      await as(app, treasurer).post(g(`statement-lines/${amb.id}/resolve`), { action: 'CONFIRM', memberId: ids[jane.id] }).expect(409);
      await as(app, treasurer).post(g(`statement-imports/${importId}/close`)).expect(422);
      await as(app, treasurer).post(g(`statement-imports/${importId}/discard`)).expect(422);
      const name = lines.find((l) => l.reference === 'SJK77NME02')!;
      await as(app, treasurer).post(g(`statement-lines/${name.id}/resolve`), { action: 'IGNORE', reason: 'Not a member; refunded' }).expect(200);
      await as(app, treasurer).post(g(`statement-imports/${importId}/close`)).expect(200);
      const audit = await prisma.auditEvent.findMany({ where: { groupId, action: { startsWith: 'statement.' } } });
      expect(audit.map((a) => a.action).sort()).toEqual(['statement.closed', 'statement.imported', 'statement.line_assigned', 'statement.line_assigned', 'statement.line_ignored']);
    });

    it('a re-imported transaction is flagged as a duplicate', async () => {
      const again = csv([`SJK55PHN01,${at},Funds received,Completed,2000.00,,${john.phone} - J OTIENO,`]);
      const p = (await as(app, treasurer).post(g('statement-imports/preview'), { fileName: 'nov.csv', csv: again }).expect(200)).body;
      expect(p.counts).toEqual({ DUPLICATE: 1 });
    });

    it('reads an .xlsx bank statement with a title block and real dates', async () => {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Statement');
      ws.addRow(['EQUITY BANK — ACCOUNT STATEMENT']);
      ws.addRow([]);
      ws.addRow(['Transaction Date', 'Narration', 'Reference', 'Debit', 'Credit', 'Balance']);
      const [y, m, d] = today.split('-').map(Number);
      ws.addRow([new Date(Date.UTC(y, m - 1, d, 11, 0, 0)), `MPESA DEPOSIT FROM ${john.phone} JOHN OTIENO`, 'FT26BANK0001', null, 3500, 100000]);
      ws.addRow([new Date(Date.UTC(y, m - 1, d, 12, 0, 0)), 'LEDGER FEE', 'FT26BANK0002', 50, null, 99950]);
      const xlsxBase64 = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
      const p = (await as(app, treasurer).post(g('statement-imports/preview'), { fileName: 'equity.xlsx', xlsxBase64 }).expect(200)).body;
      expect(p.mapping).toMatchObject({ date: 'Transaction Date', reference: 'Reference', paidIn: 'Credit', withdrawn: 'Debit', description: 'Narration' });
      expect(p.counts).toEqual({ STRONG: 1, OUTGOING: 1 });
      expect(p.sample[0]).toMatchObject({ amountCents: 350_000, reference: 'FT26BANK0001', transactionAt: `${today}T08:00:00.000Z` });
      await as(app, treasurer).post(g('statement-imports/preview'), { fileName: 'broken.xlsx', xlsxBase64: Buffer.from('not a spreadsheet at all').toString('base64') }).expect(422);
    });

    it('statements from another group are out of reach', async () => {
      const other = (await as(app, outsider).get('/v1/groups').expect(200)).body[0].id;
      await as(app, outsider).get(`/v1/groups/${other}/statement-imports/${importId}/lines`).expect(404);
      await as(app, outsider).post(`/v1/groups/${other}/statement-lines/${lines[0].id}/resolve`, { action: 'IGNORE', reason: 'tampering attempt' }).expect(404);
    });
  });

  describe('WhatsApp summaries', () => {
    it('the collections summary uses group figures and no names by default', async () => {
      const s = (await as(app, treasurer).get(g('share/collections')).expect(200)).body;
      expect(s.text).toContain('*TEST CHAMA*');
      expect(s.text).toMatch(/Collected: KES [\d,]+ of KES [\d,]+ due/);
      expect(s.text).not.toContain('Still to pay');
      expect(s.namesMembers).toBe(false);
      await as(app, jane).get(g('share/collections')).expect(403);
      await as(app, chair).patch(`/v1/groups/${groupId}`, { settings: { membersCanViewMemberBalances: true } }).expect(200);
      const named = (await as(app, treasurer).get(g('share/collections')).expect(200)).body;
      expect(named.text).toContain('Still to pay:');
      expect(named.text).not.toMatch(/loan/i);
    });

    it('receipts exist only for confirmed payments and only for their member or officers', async () => {
      const confirmed = await prisma.payment.findFirstOrThrow({ where: { reference: 'SJK12ABC34' } });
      const r = (await as(app, jane).get(g(`share/receipt/${confirmed.id}`)).expect(200)).body;
      expect(r.text).toMatch(/^TEST CHAMA: KES 2,000 contribution from Jane Wanjiru Kamau confirmed on .+ Ref SJK12ABC34\. Thank you\.$/);
      await as(app, john).get(g(`share/receipt/${confirmed.id}`)).expect(404);
      const pending = await prisma.payment.findFirstOrThrow({ where: { reference: 'SJK88AMB03' } });
      await as(app, treasurer).get(g(`share/receipt/${pending.id}`)).expect(422);
    });

    it('how-to-pay lists only what is valid now and warns about PINs', async () => {
      const s = (await as(app, jane).get(g('share/how-to-pay')).expect(200)).body;
      expect(s.text).toContain('Treasurer M-Pesa');
      expect(s.text).toContain('0711 222 333');
      expect(s.text).not.toContain('522533');
      expect(s.text).toContain('Never share your M-Pesa PIN');
    });
  });
});
