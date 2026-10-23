import { ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ImportKind, Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import Papa from 'papaparse';
import { readXlsxGrid } from '../../common/spreadsheet';
import { randomBytes } from 'node:crypto';
import { GROUP_ROLES, ImportBatchDetail, ImportBatchRow, ImportRowResult, isIsoDate, normalizeKenyanPhone, parseKes } from '@chamahub/shared';
import { AuditService } from '../../common/audit.service';
import { dbDate, today } from '../../common/dates';
import { big } from '../../common/money';
import { MembershipContext, RequestMeta } from '../../common/request';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { PostingService } from '../finance/posting.service';
import { LedgerService } from '../ledger/ledger.service';
import { EntitlementService, PaymentRequiredException } from '../billing/entitlements.service';
import { DEFAULT_PREFERENCES } from '../notifications/notifications.service';

export const IMPORT_TEMPLATES: Record<ImportKind, { required: string[]; optional: string[]; example: string[] }> = {
  MEMBERS: { required: ['full_name', 'phone'], optional: ['role', 'shares', 'joined_on'], example: ['Mary Wanjiru', '0712345678', 'MEMBER', '2', '2024-01-15'] },
  CONTRIBUTIONS: { required: ['phone', 'date', 'amount'], optional: ['method', 'reference'], example: ['0712345678', '2024-02-01', '2000', 'MPESA', 'QBC12XYZ9'] },
  LOANS: { required: ['phone', 'principal', 'interest', 'balance', 'disbursed_on', 'due_date'], optional: ['purpose'], example: ['0712345678', '10000', '1000', '5500', '2024-03-01', '2024-09-01', 'School fees'] },
  REPAYMENTS: { required: ['phone', 'date', 'amount'], optional: ['reference'], example: ['0712345678', '2024-04-01', '1500', 'QBC13ABC1'] },
  FINES: { required: ['phone', 'date', 'amount', 'reason'], optional: ['paid'], example: ['0712345678', '2024-02-10', '200', 'Late contribution', 'yes'] },
  PAYOUTS: { required: ['phone', 'date', 'amount'], optional: ['reference', 'cycle'], example: ['0712345678', '2024-02-28', '20000', 'QBC14DEF2', 'Cycle 2024'] },
  OPENING_BALANCE: { required: ['date', 'amount'], optional: ['description'], example: ['2024-01-01', '150000', 'Cash at bank per passbook'] },
};

const METHODS = ['CASH', 'MPESA', 'BANK_TRANSFER', 'CHEQUE', 'OTHER'];

interface Context {
  groupId: string;
  membersByPhone: Map<string, { id: string; status: string }>;
  existingRefs: Set<string>;
  openLoansByMember: Map<string, number>;
}

@Injectable()
export class ImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly ledger: LedgerService,
    private readonly entitlements: EntitlementService,
  ) {}

  template(kind: ImportKind) {
    const t = IMPORT_TEMPLATES[kind];
    return `${[...t.required, ...t.optional].join(',')}\r\n${t.example.join(',')}\r\n`;
  }

  private parse(csv: string): Record<string, string>[] {
    const result = Papa.parse<Record<string, string>>(csv.replace(/^﻿/, ''), {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'),
      transform: (v) => v.trim(),
    });
    if (result.errors.length && !result.data.length) throw new UnprocessableEntityException(`Could not read the file: ${result.errors[0].message}`);
    if (result.data.length > 5000) throw new UnprocessableEntityException('Import at most 5,000 rows at a time');
    return result.data;
  }

  private async context(groupId: string): Promise<Context> {
    const [members, refs, loans] = await Promise.all([
      this.prisma.membership.findMany({ where: { groupId }, select: { id: true, status: true, user: { select: { phone: true } } } }),
      this.prisma.payment.findMany({ where: { groupId, reference: { not: null }, status: { not: 'FAILED' } }, select: { reference: true } }),
      this.prisma.loan.groupBy({ by: ['membershipId'], where: { groupId, status: 'DISBURSED' }, _count: { _all: true } }),
    ]);
    return {
      groupId,
      membersByPhone: new Map(members.map((m) => [m.user.phone, { id: m.id, status: m.status }])),
      existingRefs: new Set(refs.map((r) => r.reference!)),
      openLoansByMember: new Map(loans.map((l) => [l.membershipId, l._count._all])),
    };
  }

  private validate(kind: ImportKind, rows: Record<string, string>[], ctx: Context): ImportRowResult[] {
    const t = IMPORT_TEMPLATES[kind];
    const seen = new Map<string, number>();
    const fileRefs = new Set<string>();
    const filePhones = new Set<string>();
    const todayIso = today();
    return rows.map((data, i) => {
      const errors: string[] = [];
      const warnings: string[] = [];
      for (const col of t.required) if (!data[col]) errors.push(`Missing ${col}`);
      const money = (col: string, allowZero = false) => {
        if (!data[col]) return 0;
        try {
          const v = parseKes(data[col]);
          if (v < 0 || (!allowZero && v === 0)) errors.push(`${col} must be greater than zero`);
          return v;
        } catch {
          errors.push(`${col} "${data[col]}" is not a valid amount`);
          return 0;
        }
      };
      const date = (col: string) => {
        if (!data[col]) return;
        if (!isIsoDate(data[col])) errors.push(`${col} must be a date like 2024-03-31`);
        else if (data[col] > todayIso) errors.push(`${col} is in the future`);
      };
      let phone: string | null = null;
      if (data.phone) {
        phone = normalizeKenyanPhone(data.phone);
        if (!phone) errors.push(`Phone "${data.phone}" is not a valid Kenyan mobile number`);
      }
      const member = phone ? ctx.membersByPhone.get(phone) : undefined;
      if (kind !== 'MEMBERS' && kind !== 'OPENING_BALANCE' && phone && !member) errors.push('No member with this phone number. Import the member register first.');
      if (kind !== 'MEMBERS' && member?.status === 'EXITED') warnings.push('Member has exited the group');

      switch (kind) {
        case 'MEMBERS': {
          if (data.full_name && data.full_name.length < 3) errors.push('Full name is too short');
          if (data.role && !GROUP_ROLES.includes(data.role.toUpperCase() as never)) errors.push(`Unknown role "${data.role}"`);
          if (data.shares && !/^\d+$/.test(data.shares)) errors.push('Shares must be a whole number');
          date('joined_on');
          if (phone && member && member.status !== 'EXITED') warnings.push('Already a member — row will be skipped');
          if (phone && filePhones.has(phone)) errors.push('Phone appears more than once in this file');
          if (phone) filePhones.add(phone);
          break;
        }
        case 'CONTRIBUTIONS':
        case 'REPAYMENTS':
        case 'PAYOUTS': {
          date('date');
          money('amount');
          if (data.method && !METHODS.includes(data.method.toUpperCase())) errors.push(`Unknown method "${data.method}"`);
          if (data.reference) {
            const ref = data.reference.toUpperCase();
            if (ctx.existingRefs.has(ref)) errors.push(`Reference ${ref} already exists in this group`);
            if (fileRefs.has(ref)) errors.push(`Reference ${ref} appears more than once in this file`);
            fileRefs.add(ref);
          }
          if (kind === 'REPAYMENTS' && member && (ctx.openLoansByMember.get(member.id) ?? 0) !== 1) {
            errors.push('Member must have exactly one active loan to import repayments (import the loan book first)');
          }
          const key = `${phone}|${data.date}|${data.amount}`;
          if (seen.has(key)) warnings.push(`Same member, date and amount as row ${seen.get(key)} — check for a duplicate`);
          seen.set(key, i + 2);
          break;
        }
        case 'LOANS': {
          const p = money('principal');
          const interest = money('interest', true);
          const bal = money('balance', true);
          date('disbursed_on');
          if (data.due_date && !isIsoDate(data.due_date)) errors.push('due_date must be a date like 2024-03-31');
          if (data.disbursed_on && data.due_date && data.due_date <= data.disbursed_on) errors.push('due_date must be after disbursed_on');
          if (bal > p + interest) errors.push('Balance is larger than principal plus interest');
          if (bal === 0) warnings.push('Balance is zero — the loan will be recorded as fully repaid');
          break;
        }
        case 'FINES': {
          date('date');
          money('amount');
          if (data.paid && !['yes', 'no', 'y', 'n', 'true', 'false'].includes(data.paid.toLowerCase())) errors.push('paid must be yes or no');
          break;
        }
        case 'OPENING_BALANCE': {
          date('date');
          money('amount');
          break;
        }
      }
      return { rowNumber: i + 2, data, errors, warnings };
    });
  }

  async create(groupId: string, input: { kind: ImportKind; fileName: string; csv?: string; xlsxBase64?: string }, actor: MembershipContext, meta: RequestMeta) {
    // Spreadsheets are read here (not in the browser), behind the zip-bomb and size checks, then treated like CSV.
    const csv = input.csv ?? Papa.unparse(await readXlsxGrid(Buffer.from(input.xlsxBase64!, 'base64'), { maxRows: 5000, dateOnlyAtMidnight: true }));
    const rows = this.parse(csv);
    if (!rows.length) throw new UnprocessableEntityException('The file has no data rows');
    const missing = IMPORT_TEMPLATES[input.kind].required.filter((c) => !(c in rows[0]));
    if (missing.length) throw new UnprocessableEntityException(`Missing column(s): ${missing.join(', ')}. Download the template for the expected format.`);
    const results = this.validate(input.kind, rows, await this.context(groupId));
    if (input.kind === 'OPENING_BALANCE') {
      const existing = await this.prisma.journalEntry.count({ where: { groupId, type: 'OPENING_BALANCE', lines: { some: { account: 'CASH' } } } });
      if (existing) results.forEach((r) => r.warnings.push('This group already has a cash opening balance; this adds to it'));
    }
    const errorCount = results.filter((r) => r.errors.length).length;
    const warningCount = results.filter((r) => r.warnings.length).length;
    const batch = await this.prisma.importBatch.create({
      data: {
        groupId,
        kind: input.kind,
        fileName: input.fileName,
        status: errorCount ? 'HAS_ERRORS' : 'VALIDATED',
        rows: results as unknown as Prisma.InputJsonValue,
        summary: this.summarize(input.kind, results),
        rowCount: results.length,
        errorCount,
        warningCount,
        uploadedById: actor.userId,
      },
    });
    await this.audit.log({ groupId, actorUserId: actor.userId, action: 'import.uploaded', entityType: 'ImportBatch', entityId: batch.id, after: { kind: input.kind, fileName: input.fileName, rows: results.length, errorCount }, meta });
    return this.detail(groupId, batch.id);
  }

  private summarize(kind: ImportKind, rows: ImportRowResult[]) {
    const ok = rows.filter((r) => !r.errors.length);
    const total = (col: string) => ok.reduce((a, r) => { try { return a + parseKes(r.data[col] ?? '0'); } catch { return a; } }, 0);
    const s: Record<string, number> = { validRows: ok.length };
    if (['CONTRIBUTIONS', 'REPAYMENTS', 'PAYOUTS', 'FINES', 'OPENING_BALANCE'].includes(kind)) s.totalAmountCents = total('amount');
    if (kind === 'LOANS') {
      s.totalPrincipalCents = total('principal');
      s.totalBalanceCents = total('balance');
    }
    return s;
  }

  async list(groupId: string): Promise<ImportBatchRow[]> {
    const rows = await this.prisma.importBatch.findMany({ where: { groupId }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    return Promise.all(rows.map(async (r) => { const { rows: _rows, summary: _s, ...rest } = await this.detail(groupId, r.id); return rest; }));
  }

  async detail(groupId: string, id: string): Promise<ImportBatchDetail> {
    const b = await this.prisma.importBatch.findFirst({ where: { id, groupId } });
    if (!b) throw new NotFoundException('Import not found');
    const users = await this.prisma.user.findMany({ where: { id: { in: [b.uploadedById, b.reviewedById].filter(Boolean) as string[] } }, select: { id: true, fullName: true } });
    const name = new Map(users.map((u) => [u.id, u.fullName]));
    return {
      id: b.id,
      kind: b.kind,
      fileName: b.fileName,
      status: b.status,
      rowCount: b.rowCount,
      errorCount: b.errorCount,
      warningCount: b.warningCount,
      uploadedByName: name.get(b.uploadedById) ?? '',
      reviewedByName: b.reviewedById ? (name.get(b.reviewedById) ?? null) : null,
      createdAt: b.createdAt.toISOString(),
      committedAt: b.committedAt?.toISOString() ?? null,
      rows: b.rows as unknown as ImportRowResult[],
      summary: b.summary as Record<string, number>,
    };
  }

  async discard(groupId: string, id: string, actor: MembershipContext, meta: RequestMeta) {
    const r = await this.prisma.importBatch.updateMany({ where: { id, groupId, status: { in: ['VALIDATED', 'HAS_ERRORS'] } }, data: { status: 'DISCARDED' } });
    if (r.count !== 1) throw new NotFoundException('Import not found or already committed');
    await this.audit.log({ groupId, actorUserId: actor.userId, action: 'import.discarded', entityType: 'ImportBatch', entityId: id, meta });
    return { ok: true };
  }

  /** Commits a reviewed import. A different officer from the uploader must approve. */
  async commit(groupId: string, id: string, actor: MembershipContext, meta: RequestMeta) {
    const b = await this.prisma.importBatch.findFirst({ where: { id, groupId } });
    if (!b) throw new NotFoundException('Import not found');
    if (b.status !== 'VALIDATED') throw new UnprocessableEntityException(b.status === 'HAS_ERRORS' ? 'Fix the errors and upload again before committing' : 'This import cannot be committed');
    if (b.uploadedById === actor.userId) throw new ForbiddenException('Imported records must be reviewed and committed by a different officer.');
    // Re-validate: records may have changed since upload.
    const rows = (b.rows as unknown as ImportRowResult[]).map((r) => r.data);
    const results = this.validate(b.kind, rows, await this.context(groupId));
    if (results.some((r) => r.errors.length)) {
      await this.prisma.importBatch.update({ where: { id }, data: { status: 'HAS_ERRORS', rows: results as unknown as Prisma.InputJsonValue, errorCount: results.filter((r) => r.errors.length).length } });
      throw new UnprocessableEntityException('Records changed since this file was checked and some rows are no longer valid. Review the errors.');
    }
    let created = 0;
    await this.prisma.financial(async (tx) => {
      const claimed = await tx.importBatch.updateMany({ where: { id, status: 'VALIDATED' }, data: { status: 'COMMITTED', reviewedById: actor.userId, committedAt: new Date() } });
      if (claimed.count !== 1) throw new UnprocessableEntityException('Already committed');
      for (const r of results) {
        if (await this.commitRow(tx, b.kind, groupId, id, r, actor)) created++;
      }
      if (b.kind === 'MEMBERS') {
        const max = (await this.entitlements.access(groupId)).plan.entitlements.limits.maxMembers;
        const active = await tx.membership.count({ where: { groupId, status: 'ACTIVE' } });
        if (active > max) throw new PaymentRequiredException(`This import would take the group to ${active} members; its plan allows ${max}. Nothing was imported.`, { code: 'MEMBER_LIMIT', limit: max, current: active });
      }
      await this.audit.log({ groupId, actorUserId: actor.userId, action: 'import.committed', entityType: 'ImportBatch', entityId: id, after: { kind: b.kind, created }, approvalStatus: 'APPROVED', meta }, tx);
    }, 1);
    return { ...(await this.detail(groupId, id)), created };
  }

  private async memberId(tx: Tx, groupId: string, phoneRaw: string) {
    const phone = normalizeKenyanPhone(phoneRaw)!;
    const m = await tx.membership.findFirst({ where: { groupId, user: { phone } } });
    if (!m) throw new UnprocessableEntityException(`Member ${phone} not found`);
    return m.id;
  }

  private async commitRow(tx: Tx, kind: ImportKind, groupId: string, batchId: string, r: ImportRowResult, actor: MembershipContext): Promise<boolean> {
    const d = r.data;
    const key = `import:${batchId}:${r.rowNumber}`;
    const note = `Imported from paper records (batch ${batchId.slice(-6)}, row ${r.rowNumber})`;
    switch (kind) {
      case 'MEMBERS': {
        const phone = normalizeKenyanPhone(d.phone)!;
        let user = await tx.user.findUnique({ where: { phone } });
        if (!user) {
          // The person claims the account later via "Forgot password" (SMS code to this phone).
          user = await tx.user.create({ data: { fullName: d.full_name, phone, passwordHash: await bcrypt.hash(randomBytes(24).toString('hex'), 10), preferences: DEFAULT_PREFERENCES } });
        }
        const existing = await tx.membership.findUnique({ where: { groupId_userId: { groupId, userId: user.id } } });
        if (existing && existing.status !== 'EXITED') return false;
        const data = { role: (d.role?.toUpperCase() || 'MEMBER') as never, shares: d.shares ? Number(d.shares) : 0, joinedAt: d.joined_on ? dbDate(d.joined_on) : new Date(), status: 'ACTIVE' as const };
        if (existing) await tx.membership.update({ where: { id: existing.id }, data: { ...data, exitedAt: null } });
        else await tx.membership.create({ data: { groupId, userId: user.id, ...data } });
        return true;
      }
      case 'CONTRIBUTIONS':
      case 'REPAYMENTS': {
        const membershipId = await this.memberId(tx, groupId, d.phone);
        const loan = kind === 'REPAYMENTS' ? await tx.loan.findFirst({ where: { groupId, membershipId, status: 'DISBURSED' } }) : null;
        const p = await tx.payment.create({
          data: { groupId, membershipId, amountCents: big(parseKes(d.amount)), method: (d.method?.toUpperCase() || 'CASH') as never, source: 'IMPORT', purpose: kind === 'CONTRIBUTIONS' ? 'CONTRIBUTION' : 'LOAN_REPAYMENT', status: 'PENDING', reference: d.reference?.toUpperCase() || null, paidAt: dbDate(d.date), idempotencyKey: key, targetId: loan?.id ?? null, recordedById: actor.userId, notes: note },
        });
        await this.posting.confirm(tx, p.id, actor.userId);
        return true;
      }
      case 'LOANS': {
        const membershipId = await this.memberId(tx, groupId, d.phone);
        const principal = parseKes(d.principal);
        const interest = parseKes(d.interest);
        const balance = parseKes(d.balance);
        const paid = principal + interest - balance;
        const interestPaid = Math.min(paid, interest);
        const principalPaid = paid - interestPaid;
        const loan = await tx.loan.create({
          data: {
            groupId, membershipId, principalCents: big(principal), rateBps: 0, interestMethod: 'ONE_OFF', installmentsCount: 1, frequency: 'MONTHLY', totalInterestCents: big(interest), purpose: d.purpose || 'Imported loan', status: balance === 0 ? 'REPAID' : 'DISBURSED', requiredApprovals: 1, policySnapshot: { imported: true, batchId, row: r.rowNumber }, decidedAt: new Date(), disbursedAt: dbDate(d.disbursed_on), disbursementReference: 'IMPORTED', disbursedById: actor.userId, closedAt: balance === 0 ? new Date() : null,
            installments: { create: [{ number: 1, dueDate: dbDate(d.due_date), principalCents: big(principal), interestCents: big(interest), principalPaidCents: big(principalPaid), interestPaidCents: big(interestPaid), status: balance === 0 ? 'PAID' : 'UPCOMING' }] },
          },
        });
        const outstandingPrincipal = principal - principalPaid;
        if (outstandingPrincipal > 0) {
          // Historical loan book: the receivable is carried in against opening equity, not cash.
          await this.ledger.post(tx, { groupId, entryDate: d.disbursed_on, type: 'OPENING_BALANCE', description: `Imported loan balance (${note})`, membershipId, loanId: loan.id, createdById: actor.userId, lines: [{ account: 'LOANS_RECEIVABLE', amountCents: outstandingPrincipal }, { account: 'OPENING_BALANCE', amountCents: -outstandingPrincipal }] });
        }
        return true;
      }
      case 'FINES': {
        const membershipId = await this.memberId(tx, groupId, d.phone);
        const amount = parseKes(d.amount);
        const fine = await tx.fine.create({ data: { groupId, membershipId, amountCents: big(amount), reason: d.reason, issuedOn: dbDate(d.date), issuedById: actor.userId } });
        if (['yes', 'y', 'true'].includes((d.paid ?? '').toLowerCase())) {
          const p = await tx.payment.create({ data: { groupId, membershipId, amountCents: big(amount), method: 'CASH', source: 'IMPORT', purpose: 'FINE', status: 'PENDING', paidAt: dbDate(d.date), idempotencyKey: key, targetId: fine.id, recordedById: actor.userId, notes: note } });
          await this.posting.confirm(tx, p.id, actor.userId);
        }
        return true;
      }
      case 'PAYOUTS': {
        const membershipId = await this.memberId(tx, groupId, d.phone);
        const amount = parseKes(d.amount);
        await this.ledger.post(tx, { groupId, entryDate: d.date, type: 'PAYOUT', description: `Historical payout${d.cycle ? ` — ${d.cycle}` : ''} (${note})`, reference: d.reference?.toUpperCase() || null, membershipId, createdById: actor.userId, lines: [{ account: 'PAYOUTS', amountCents: amount }, { account: 'CASH', amountCents: -amount }] });
        return true;
      }
      case 'OPENING_BALANCE': {
        const amount = parseKes(d.amount);
        await this.ledger.post(tx, { groupId, entryDate: d.date, type: 'OPENING_BALANCE', description: d.description || 'Opening balance', createdById: actor.userId, reason: note, lines: [{ account: 'CASH', amountCents: amount }, { account: 'OPENING_BALANCE', amountCents: -amount }] });
        return true;
      }
    }
  }
}
