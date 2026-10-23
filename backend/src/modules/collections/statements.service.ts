import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma, StatementLine } from '@prisma/client';
import { readXlsxGrid } from '../../common/spreadsheet';
import Papa from 'papaparse';
import { createHash } from 'node:crypto';
import {
  guessStatementMapping,
  mappingProblems,
  maskPhone,
  MatchContext,
  matchStatementLine,
  MatchKind,
  MatchResult,
  normalizeStatementRow,
  Permission,
  ResolveStatementLineInput,
  StatementFileInput,
  StatementImportRow,
  StatementLineInput,
  StatementLineRow,
  StatementMapping,
  StatementPreview,
  statementFingerprint,
} from '@chamahub/shared';
import { AuditService } from '../../common/audit.service';
import { dbDate, isoDate } from '../../common/dates';
import { big, n } from '../../common/money';
import { MembershipContext, RequestMeta } from '../../common/request';
import { PrismaService } from '../../prisma/prisma.service';
import { ContributionsService } from '../contributions/contributions.service';
import { PostingService } from '../finance/posting.service';
import { readSettings } from '../finance/policies';
import { NotificationsService } from '../notifications/notifications.service';

const MAX_LINES = 5000;

/** The Nairobi calendar date of a UTC timestamp. */
const nairobiDate = (iso: string) => isoDate(new Date(new Date(iso).getTime() + 3 * 3600_000));

interface Parsed {
  headers: string[];
  rows: { rowNo: number; values: Record<string, string> }[];
  sha256: string;
}

/**
 * Statement import: officers upload a statement they downloaded themselves.
 * Lines are matched to members by the shared engine and wait in a review
 * queue; only an officer's decision turns a line into a payment.
 */
@Injectable()
export class StatementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly contributions: ContributionsService,
    private readonly posting: PostingService,
    private readonly notifications: NotificationsService,
  ) {}

  private assertCanView(viewer: MembershipContext) {
    if (!viewer.permissions.includes(Permission.RECONCILIATION_MANAGE) && !viewer.permissions.includes(Permission.AUDIT_VIEW)) {
      throw new ForbiddenException('Your role in this group cannot view statement imports.');
    }
  }

  private async parse(input: StatementFileInput): Promise<Parsed> {
    let grid: string[][];
    let raw: Buffer;
    if (input.csv !== undefined) {
      raw = Buffer.from(input.csv);
      const r = Papa.parse<string[]>(input.csv.replace(/^﻿/, ''), { skipEmptyLines: 'greedy' });
      grid = r.data.map((row) => row.map((c) => (c ?? '').toString().trim()));
    } else {
      raw = Buffer.from(input.xlsxBase64!, 'base64');
      grid = await readXlsxGrid(raw, { maxRows: MAX_LINES });
    }
    // Statements often start with a title block; the header is the first row that looks like one.
    let headerIdx = grid.slice(0, 30).findIndex((row) => {
      const g = guessStatementMapping(row);
      return !!g.date && (!!g.paidIn || !!g.amount);
    });
    if (headerIdx < 0) headerIdx = 0;
    const headers = (grid[headerIdx] ?? []).map((h, i) => h || `Column ${i + 1}`);
    if (!headers.length) throw new UnprocessableEntityException('The file is empty');
    const body = grid.slice(headerIdx + 1).filter((r) => r.some((c) => c));
    if (body.length > MAX_LINES) throw new UnprocessableEntityException(`Import at most ${MAX_LINES} lines at a time; split the statement by month`);
    return {
      headers,
      rows: body.map((r, i) => ({ rowNo: headerIdx + i + 2, values: Object.fromEntries(headers.map((h, c) => [h, r[c] ?? ''])) })),
      sha256: createHash('sha256').update(raw).digest('hex'),
    };
  }

  private async matchContext(groupId: string): Promise<MatchContext> {
    const [members, reports, refs, lines, group] = await Promise.all([
      this.prisma.membership.findMany({ where: { groupId, status: { not: 'EXITED' } }, select: { id: true, user: { select: { fullName: true, phone: true } } } }),
      this.prisma.payment.findMany({ where: { groupId, status: 'PENDING', reference: { not: null }, membershipId: { not: null } }, select: { id: true, membershipId: true, reference: true, amountCents: true } }),
      this.prisma.payment.findMany({ where: { groupId, reference: { not: null }, status: { in: ['CONFIRMED', 'REVERSED', 'DISPUTED'] } }, select: { reference: true } }),
      this.prisma.statementLine.findMany({ where: { groupId, statementImport: { status: { not: 'DISCARDED' } } }, select: { fingerprint: true } }),
      this.prisma.group.findUniqueOrThrow({ where: { id: groupId }, select: { settings: true } }),
    ]);
    return {
      members: members.map((m) => ({ membershipId: m.id, fullName: m.user.fullName, phones: [m.user.phone] })),
      reports: reports.map((r) => ({ paymentId: r.id, membershipId: r.membershipId!, reference: r.reference!, amountCents: n(r.amountCents) })),
      knownReferences: new Set(refs.map((r) => r.reference!)),
      knownFingerprints: new Set(lines.map((l) => l.fingerprint)),
      accountReferencePrefix: readSettings(group.settings).accountReferencePrefix,
    };
  }

  /** Runs the whole file through parsing and matching without saving anything. */
  private async analyse(groupId: string, input: StatementFileInput) {
    const parsed = await this.parse(input);
    const mapping = { ...guessStatementMapping(parsed.headers), ...(input.mapping ?? {}) } as Partial<StatementMapping>;
    for (const [k, v] of Object.entries(mapping)) if (v && !parsed.headers.includes(v)) delete (mapping as Record<string, unknown>)[k];
    const problems = mappingProblems(mapping);
    const ctx = await this.matchContext(groupId);
    const results: ({ ok: true; line: StatementLineInput; fingerprint: string; match: MatchResult } | { ok: false; rowNo: number; error: string; skipped?: boolean })[] = [];
    if (!problems.length) {
      for (const r of parsed.rows) {
        const norm = normalizeStatementRow(r.values, mapping as StatementMapping, r.rowNo);
        if (!norm.ok) {
          results.push(norm);
          continue;
        }
        const fingerprint = statementFingerprint(norm.line);
        const match = matchStatementLine(norm.line, ctx);
        // The same transaction twice in one file is a duplicate too.
        ctx.knownFingerprints.add(fingerprint);
        if (norm.line.reference) ctx.knownReferences.add(norm.line.reference);
        results.push({ ok: true, line: norm.line, fingerprint, match });
      }
    }
    return { parsed, mapping, problems, results };
  }

  async preview(groupId: string, input: StatementFileInput, viewer: MembershipContext): Promise<StatementPreview> {
    const { parsed, mapping, problems, results } = await this.analyse(groupId, input);
    const counts: StatementPreview['counts'] = {};
    for (const r of results) {
      const k = r.ok ? r.match.kind : r.skipped ? 'SKIPPED' : 'ERROR';
      counts[k] = (counts[k] ?? 0) + 1;
    }
    const manage = viewer.permissions.includes(Permission.RECONCILIATION_MANAGE);
    return {
      headers: parsed.headers,
      mapping,
      problems,
      rowCount: parsed.rows.length,
      counts,
      sample: results.slice(0, 25).map((r) =>
        r.ok
          ? { rowNo: r.line.rowNo, ok: true, transactionAt: r.line.transactionAt, amountCents: r.line.amountCents, reference: r.line.reference, payer: [r.line.payerName, r.line.payerPhone && (manage ? r.line.payerPhone : maskPhone(r.line.payerPhone))].filter(Boolean).join(' · ') || null, match: r.match.kind, explanation: r.match.explanation }
          : { rowNo: r.rowNo, ok: false, error: r.error, skipped: r.skipped },
      ),
    };
  }

  async create(groupId: string, input: StatementFileInput, actor: MembershipContext, meta: RequestMeta) {
    if (input.destinationId) {
      const d = await this.prisma.paymentDestination.findFirst({ where: { id: input.destinationId, groupId } });
      if (!d) throw new UnprocessableEntityException('Unknown payment destination');
    }
    const { parsed, mapping, problems, results } = await this.analyse(groupId, input);
    if (problems.length) throw new UnprocessableEntityException(problems.join('. '));
    const lines = results.filter((r): r is Extract<(typeof results)[number], { ok: true }> => r.ok);
    if (!lines.length) throw new UnprocessableEntityException('No transactions could be read from this file. Check the column mapping.');
    const again = await this.prisma.statementImport.findFirst({ where: { groupId, fileSha256: parsed.sha256, status: { not: 'DISCARDED' } } });
    if (again) throw new ConflictException(`This exact file was already imported on ${isoDate(again.createdAt)}`);
    const dates = lines.map((l) => nairobiDate(l.line.transactionAt)!).sort();
    const imp = await this.prisma.$transaction(async (tx) => {
      const created = await tx.statementImport.create({
        data: {
          groupId,
          destinationId: input.destinationId ?? null,
          fileName: input.fileName,
          fileSha256: parsed.sha256,
          mapping: mapping as Prisma.InputJsonValue,
          lineCount: lines.length,
          duplicateCount: lines.filter((l) => l.match.kind === 'DUPLICATE').length,
          periodFrom: dbDate(dates[0]),
          periodTo: dbDate(dates[dates.length - 1]),
          uploadedById: actor.userId,
        },
      });
      await tx.statementLine.createMany({
        data: lines.map((l) => ({
          importId: created.id,
          groupId,
          rowNo: l.line.rowNo,
          transactionAt: new Date(l.line.transactionAt),
          amountCents: big(l.line.amountCents),
          reference: l.line.reference,
          payerName: l.line.payerName,
          payerPhone: l.line.payerPhone,
          accountReference: l.line.accountReference,
          description: l.line.description,
          fingerprint: l.fingerprint,
          match: l.match.kind,
          candidates: { explanation: l.match.explanation, list: l.match.candidates } as unknown as Prisma.InputJsonValue,
          suggestedMembershipId: l.match.membershipId,
          reportPaymentId: l.match.reportPaymentId,
        })),
      });
      await this.audit.log({ groupId, actorUserId: actor.userId, action: 'statement.imported', entityType: 'StatementImport', entityId: created.id, after: { fileName: input.fileName, sha256: parsed.sha256, lines: lines.length, skipped: results.length - lines.length }, meta }, tx);
      return created;
    });
    return { id: imp.id, lineCount: imp.lineCount };
  }

  async list(groupId: string, viewer: MembershipContext): Promise<StatementImportRow[]> {
    this.assertCanView(viewer);
    const rows = await this.prisma.statementImport.findMany({ where: { groupId }, orderBy: { createdAt: 'desc' }, take: 50, include: { destination: { select: { displayName: true } } } });
    const [counts, open, users] = await Promise.all([
      this.prisma.statementLine.groupBy({ by: ['importId', 'match'], where: { importId: { in: rows.map((r) => r.id) } }, _count: { _all: true } }),
      this.prisma.statementLine.groupBy({ by: ['importId'], where: { importId: { in: rows.map((r) => r.id) }, state: 'OPEN' }, _count: { _all: true } }),
      this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.uploadedById) } }, select: { id: true, fullName: true } }),
    ]);
    const name = new Map(users.map((u) => [u.id, u.fullName]));
    return rows.map((r) => ({
      id: r.id,
      fileName: r.fileName,
      destinationName: r.destination?.displayName ?? null,
      status: r.status,
      lineCount: r.lineCount,
      duplicateCount: r.duplicateCount,
      openCount: open.find((o) => o.importId === r.id)?._count._all ?? 0,
      periodFrom: isoDate(r.periodFrom),
      periodTo: isoDate(r.periodTo),
      uploadedByName: name.get(r.uploadedById) ?? '',
      createdAt: r.createdAt.toISOString(),
      counts: Object.fromEntries(counts.filter((c) => c.importId === r.id).map((c) => [c.match, c._count._all])),
    }));
  }

  async lines(groupId: string, importId: string, viewer: MembershipContext, filter: { state?: string; match?: string }): Promise<StatementLineRow[]> {
    this.assertCanView(viewer);
    const imp = await this.prisma.statementImport.findFirst({ where: { id: importId, groupId } });
    if (!imp) throw new NotFoundException('Statement import not found');
    const rows = await this.prisma.statementLine.findMany({
      where: { importId, ...(filter.state ? { state: filter.state as never } : {}), ...(filter.match ? { match: filter.match as never } : {}) },
      orderBy: { rowNo: 'asc' },
    });
    return this.toRows(rows, viewer);
  }

  /** Every open line in the group that needs a person, across imports. */
  async reviewQueue(groupId: string, viewer: MembershipContext): Promise<StatementLineRow[]> {
    this.assertCanView(viewer);
    const rows = await this.prisma.statementLine.findMany({
      where: { groupId, state: 'OPEN', statementImport: { status: 'REVIEWING' } },
      orderBy: [{ transactionAt: 'desc' }],
      take: 200,
    });
    return this.toRows(rows, viewer);
  }

  private async toRows(rows: StatementLine[], viewer: MembershipContext): Promise<StatementLineRow[]> {
    const manage = viewer.permissions.includes(Permission.RECONCILIATION_MANAGE);
    const memberIds = [...new Set(rows.map((r) => r.resolvedMembershipId).filter((x): x is string => !!x))];
    const paymentIds = rows.map((r) => r.resolvedPaymentId).filter((x): x is string => !!x);
    const userIds = [...new Set(rows.map((r) => r.resolvedById).filter((x): x is string => !!x))];
    const [members, payments, users] = await Promise.all([
      this.prisma.membership.findMany({ where: { id: { in: memberIds } }, select: { id: true, user: { select: { fullName: true } } } }),
      this.prisma.payment.findMany({ where: { id: { in: paymentIds } }, select: { id: true, status: true } }),
      this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } }),
    ]);
    const memberName = new Map(members.map((m) => [m.id, m.user.fullName]));
    const payStatus = new Map(payments.map((p) => [p.id, p.status]));
    const userName = new Map(users.map((u) => [u.id, u.fullName]));
    return rows.map((r) => {
      const c = r.candidates as unknown as { explanation: string; list: StatementLineRow['candidates'] };
      return {
        id: r.id,
        rowNo: r.rowNo,
        transactionAt: r.transactionAt.toISOString(),
        amountCents: n(r.amountCents),
        reference: r.reference,
        payerName: r.payerName,
        payerPhone: r.payerPhone ? (manage ? r.payerPhone : maskPhone(r.payerPhone)) : null,
        accountReference: r.accountReference,
        description: r.description,
        match: r.match as MatchKind,
        explanation: c.explanation ?? '',
        candidates: c.list ?? [],
        suggestedMemberId: r.suggestedMembershipId,
        reportPaymentId: r.reportPaymentId,
        state: r.state,
        resolvedMemberName: r.resolvedMembershipId ? (memberName.get(r.resolvedMembershipId) ?? null) : null,
        resolvedPaymentId: r.resolvedPaymentId,
        resolvedPaymentStatus: r.resolvedPaymentId ? (payStatus.get(r.resolvedPaymentId) ?? null) : null,
        resolvedByName: r.resolvedById ? (userName.get(r.resolvedById) ?? null) : null,
        resolutionNote: r.resolutionNote,
      };
    });
  }

  async resolve(groupId: string, lineId: string, input: ResolveStatementLineInput, actor: MembershipContext, meta: RequestMeta) {
    const line = await this.prisma.statementLine.findFirst({ where: { id: lineId, groupId }, include: { statementImport: { include: { destination: true } } } });
    if (!line) throw new NotFoundException('Statement line not found');
    if (line.statementImport.status !== 'REVIEWING') throw new UnprocessableEntityException('This statement is no longer open for review');
    if (line.state !== 'OPEN') throw new ConflictException('This line has already been dealt with');

    if (input.action === 'IGNORE') {
      const r = await this.prisma.statementLine.updateMany({ where: { id: line.id, state: 'OPEN' }, data: { state: 'IGNORED', resolvedById: actor.userId, resolvedAt: new Date(), resolutionNote: input.reason } });
      if (r.count !== 1) throw new ConflictException('This line has already been dealt with');
      await this.audit.log({ groupId, actorUserId: actor.userId, action: 'statement.line_ignored', entityType: 'StatementLine', entityId: line.id, reason: input.reason, reference: line.reference, meta });
      return { ok: true, state: 'IGNORED' };
    }

    if (line.match === 'DUPLICATE') throw new UnprocessableEntityException('This transaction is already recorded. Ignore the line instead.');
    if (line.match === 'OUTGOING') throw new UnprocessableEntityException('Money out cannot be recorded as a member payment.');
    const amountCents = n(line.amountCents);
    const member = await this.prisma.membership.findFirst({ where: { id: input.memberId, groupId } });
    if (!member) throw new UnprocessableEntityException('Choose a member of this group');
    if (member.id === actor.id) throw new ForbiddenException('Another officer must confirm a payment from you.');
    const ref = line.reference;
    const note = `Statement ${line.statementImport.fileName}, row ${line.rowNo}`;

    // Case 1: the member already reported this payment. The statement is the proof that confirms it.
    const report = ref ? await this.prisma.payment.findFirst({ where: { groupId, reference: ref, status: 'PENDING' } }) : null;
    if (report) {
      if (report.membershipId !== member.id) throw new UnprocessableEntityException(`${ref} was reported by another member. Resolve that report first.`);
      if (n(report.amountCents) !== amountCents) throw new UnprocessableEntityException('The amount on the statement differs from the member’s report. Mark the report as not received (with the reason) or ask the member to correct it, then confirm this line.');
      const settings = readSettings((await this.prisma.group.findUniqueOrThrow({ where: { id: groupId }, select: { settings: true } })).settings);
      if (report.recordedById === actor.userId && !settings.allowSelfVerification) throw new ForbiddenException('You recorded this payment yourself; another officer must confirm it.');
      await this.prisma.financial(async (tx) => {
        const claimed = await tx.statementLine.updateMany({ where: { id: line.id, state: 'OPEN' }, data: { state: 'CONFIRMED', resolvedMembershipId: member.id, resolvedPaymentId: report.id, resolvedById: actor.userId, resolvedAt: new Date(), resolutionNote: input.note ?? null } });
        if (claimed.count !== 1) throw new ConflictException('This line has already been dealt with');
        await tx.paymentEvent.create({ data: { groupId, paymentId: report.id, kind: 'STATEMENT_MATCHED', actorUserId: actor.userId, note } });
        await this.posting.confirm(tx, report.id, actor.userId);
        await this.audit.log({ groupId, actorUserId: actor.userId, action: 'payment.confirmed', entityType: 'Payment', entityId: report.id, before: { status: 'PENDING' }, after: { status: 'CONFIRMED', statementLineId: line.id }, reason: note, reference: ref, approvalStatus: 'APPROVED', meta }, tx);
      });
      const u = await this.prisma.membership.findUniqueOrThrow({ where: { id: member.id }, select: { userId: true } });
      await this.notifications.notify([u.userId], { groupId, type: 'PAYMENT_CONFIRMED', title: 'Payment confirmed', body: `Your payment${ref ? ` ${ref}` : ''} was found on the group’s statement and is confirmed.`, data: { paymentId: report.id } });
      return { ok: true, state: 'CONFIRMED', paymentId: report.id, paymentStatus: 'CONFIRMED' };
    }

    // Case 2: nobody reported it. Record it for the member; a second officer verifies it as usual.
    await this.contributions.validateTarget(groupId, member.id, input.purpose, input.targetId, amountCents);
    if (ref) {
      const dup = await this.prisma.payment.findFirst({ where: { groupId, reference: ref, status: { not: 'FAILED' } } });
      if (dup) throw new ConflictException(`${ref} is already recorded in the group.`);
    }
    const d = line.statementImport.destination;
    const method = d && ['BANK_ACCOUNT', 'BANK_TRANSFER'].includes(d.type) ? 'BANK_TRANSFER' : 'MPESA';
    const payment = await this.prisma.$transaction(async (tx) => {
      const p = await tx.payment.create({
        data: {
          groupId, membershipId: member.id, amountCents: line.amountCents, method, source: 'STATEMENT', purpose: input.purpose, status: 'PENDING',
          reference: ref, paidAt: dbDate(nairobiDate(line.transactionAt.toISOString())!), idempotencyKey: `stmt:${line.id}`, targetId: input.targetId ?? null,
          notes: [note, line.payerName && `Payer: ${line.payerName}`, input.note].filter(Boolean).join('. '), destinationId: line.statementImport.destinationId, recordedById: actor.userId,
        },
      });
      const claimed = await tx.statementLine.updateMany({ where: { id: line.id, state: 'OPEN' }, data: { state: 'CONFIRMED', resolvedMembershipId: member.id, resolvedPaymentId: p.id, resolvedById: actor.userId, resolvedAt: new Date(), resolutionNote: input.note ?? null } });
      if (claimed.count !== 1) throw new ConflictException('This line has already been dealt with');
      await tx.paymentEvent.create({ data: { groupId, paymentId: p.id, kind: 'STATEMENT_MATCHED', actorUserId: actor.userId, note } });
      await this.audit.log({ groupId, actorUserId: actor.userId, action: 'statement.line_assigned', entityType: 'StatementLine', entityId: line.id, after: { paymentId: p.id, memberId: member.id, match: line.match, suggested: line.suggestedMembershipId }, reference: ref, approvalStatus: 'PENDING', meta }, tx);
      return p;
    });
    const verifiers = (await this.notifications.groupUserIds(groupId, ['CHAIRPERSON', 'TREASURER'])).filter((id) => id !== actor.userId);
    if (verifiers.length) await this.notifications.notify(verifiers, { groupId, type: 'APPROVAL_REQUIRED', title: 'Payment to verify', body: `Statement payment assigned to a member — needs a second officer`, data: { paymentId: payment.id } });
    return { ok: true, state: 'CONFIRMED', paymentId: payment.id, paymentStatus: 'PENDING' };
  }

  /** Accepts the engine's clear matches in one go. Ambiguous or weak lines are never included. */
  async confirmMatches(groupId: string, lineIds: string[], actor: MembershipContext, meta: RequestMeta) {
    const lines = await this.prisma.statementLine.findMany({ where: { id: { in: lineIds }, groupId, state: 'OPEN', match: { in: ['REPORT_MATCH', 'STRONG'] }, suggestedMembershipId: { not: null } } });
    const done: string[] = [];
    const failed: { lineId: string; error: string }[] = lineIds.filter((id) => !lines.some((l) => l.id === id)).map((lineId) => ({ lineId, error: 'Not an open clear match' }));
    for (const l of lines) {
      try {
        await this.resolve(groupId, l.id, { action: 'CONFIRM', memberId: l.suggestedMembershipId!, purpose: 'CONTRIBUTION' }, actor, meta);
        done.push(l.id);
      } catch (e) {
        failed.push({ lineId: l.id, error: e instanceof Error ? e.message : 'Failed' });
      }
    }
    return { confirmed: done.length, failed };
  }

  async setStatus(groupId: string, importId: string, status: 'CLOSED' | 'DISCARDED', actor: MembershipContext, meta: RequestMeta) {
    const imp = await this.prisma.statementImport.findFirst({ where: { id: importId, groupId } });
    if (!imp) throw new NotFoundException('Statement import not found');
    if (imp.status !== 'REVIEWING') throw new UnprocessableEntityException('This statement is already closed');
    if (status === 'DISCARDED' && (await this.prisma.statementLine.count({ where: { importId, state: 'CONFIRMED' } }))) {
      throw new UnprocessableEntityException('Lines from this statement were already confirmed. Close it instead of discarding it.');
    }
    if (status === 'CLOSED' && (await this.prisma.statementLine.count({ where: { importId, state: 'OPEN', match: { notIn: ['DUPLICATE', 'OUTGOING'] } } }))) {
      throw new UnprocessableEntityException('Some lines still need a decision: confirm or ignore each one first.');
    }
    await this.prisma.statementImport.update({ where: { id: imp.id }, data: { status } });
    await this.audit.log({ groupId, actorUserId: actor.userId, action: `statement.${status.toLowerCase()}`, entityType: 'StatementImport', entityId: imp.id, meta });
    return { ok: true };
  }
}
