import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { formatDate, formatKes, GroupStatement, LABELS, PersonalStatement } from '@chamahub/shared';

const GREEN = '#14532D';
const NAVY = '#172033';
const MUTED = '#64748B';
const BORDER = '#E2E8F0';

type Doc = InstanceType<typeof PDFDocument>;

function render(build: (doc: Doc) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: { Producer: 'ChamaHub', Creator: 'ChamaHub' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    build(doc);
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fillColor(MUTED).text(`ChamaHub · Every Chama. Every Contribution. One Place. · Page ${i + 1} of ${range.count}`, 48, doc.page.height - 36, { align: 'center', width: doc.page.width - 96, lineBreak: false });
    }
    doc.end();
  });
}

function header(doc: Doc, title: string, subtitle: string) {
  doc.fillColor(GREEN).fontSize(18).font('Helvetica-Bold').text('ChamaHub', { continued: false });
  doc.moveDown(0.2).fillColor(NAVY).fontSize(14).text(title);
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(subtitle);
  doc.moveDown(0.6);
  doc.strokeColor(BORDER).moveTo(48, doc.y).lineTo(doc.page.width - 48, doc.y).stroke();
  doc.moveDown(0.6);
}

function keyValues(doc: Doc, rows: [string, string, boolean?][]) {
  const x = 48;
  const w = doc.page.width - 96;
  for (const [k, v, bold] of rows) {
    const y = doc.y;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor(NAVY).text(k, x, y, { width: w * 0.6 });
    doc.text(v, x + w * 0.6, y, { width: w * 0.4, align: 'right' });
    doc.moveDown(0.25);
  }
  doc.moveDown(0.5);
}

function table(doc: Doc, headers: string[], widths: number[], rows: string[][], alignRight: number[] = []) {
  const x0 = 48;
  const drawRow = (cells: string[], bold: boolean) => {
    if (doc.y > doc.page.height - 80) doc.addPage();
    const y = doc.y;
    let x = x0;
    let h = 0;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).fillColor(bold ? MUTED : NAVY);
    cells.forEach((c, i) => {
      doc.text(c, x + 2, y, { width: widths[i] - 4, align: alignRight.includes(i) ? 'right' : 'left' });
      h = Math.max(h, doc.y - y);
      x += widths[i];
    });
    doc.y = y + h + 3;
    doc.strokeColor(BORDER).moveTo(x0, doc.y - 1).lineTo(x0 + widths.reduce((a, b) => a + b, 0), doc.y - 1).stroke();
    doc.x = x0;
  };
  drawRow(headers, true);
  rows.forEach((r) => drawRow(r, false));
  doc.moveDown(0.8);
}

const k = (c: number) => formatKes(c);

@Injectable()
export class PdfService {
  groupStatement(s: GroupStatement): Promise<Buffer> {
    return render((doc) => {
      header(doc, `${s.groupName} — Financial statement`, `Period ${formatDate(s.from)} to ${formatDate(s.to)} · Generated ${formatDate(new Date(s.generatedAt))}`);
      keyValues(doc, [
        ['Opening cash balance', k(s.openingBalanceCents), true],
        ['Contributions received', k(s.contributionsCents)],
        ['Loan repayments (principal)', k(s.loanRepaymentsCents)],
        ['Interest received', k(s.interestReceivedCents)],
        ['Fines received', k(s.finesReceivedCents)],
        ['Other income and opening balances', k(s.otherIncomeCents)],
        ['Expenses', `(${k(s.expensesCents)})`],
        ['Loans disbursed', `(${k(s.loansDisbursedCents)})`],
        ['Rotation payouts', `(${k(s.payoutsCents)})`],
        ['Distributions to members', `(${k(s.distributionsCents)})`],
        ['Closing cash balance', k(s.closingBalanceCents), true],
        ['Loans outstanding (not cash)', k(s.loansOutstandingCents)],
      ]);
      doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY).text('Transactions');
      doc.moveDown(0.3);
      table(
        doc,
        ['Date', 'Type', 'Description', 'Reference', 'In', 'Out', 'Balance'],
        [58, 72, 140, 60, 56, 56, 57],
        s.transactions.map((t) => [formatDate(t.date), t.type, t.memberName ? `${t.description} — ${t.memberName}` : t.description, t.reference ?? '', t.inflowCents ? k(t.inflowCents) : '', t.outflowCents ? k(t.outflowCents) : '', k(t.balanceCents)]),
        [4, 5, 6],
      );
    });
  }

  personalStatement(s: PersonalStatement): Promise<Buffer> {
    return render((doc) => {
      header(doc, `Consolidated statement — ${s.userName}`, `Period ${formatDate(s.from)} to ${formatDate(s.to)} · ${s.groups.length} Chama(s) · Generated ${formatDate(new Date(s.generatedAt))}`);
      keyValues(doc, [
        ['Contributions paid', k(s.totals.contributionsCents), true],
        ['Outstanding contributions', k(s.totals.outstandingContributionsCents)],
        ['Loans received (borrowed, not income)', k(s.totals.loansReceivedCents)],
        ['Loan principal repaid', k(s.totals.loanRepaymentsCents)],
        ['Loan interest paid', k(s.totals.interestPaidCents)],
        ['Current loan balance', k(s.totals.loanBalanceCents)],
        ['Fines paid', k(s.totals.finesPaidCents)],
        ['Payouts received', k(s.totals.payoutsReceivedCents)],
        ['Distributions received', k(s.totals.distributionsReceivedCents)],
      ]);
      doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY).text('By Chama');
      doc.moveDown(0.3);
      table(
        doc,
        ['Chama', 'Role', 'Contributed', 'Outstanding', 'Loan bal.', 'Payouts', 'Distrib.', 'Shares'],
        [110, 62, 62, 60, 56, 56, 56, 37],
        s.groups.map((g) => [g.groupName, LABELS.groupRole[g.role], k(g.contributionsCents), k(g.outstandingContributionsCents), k(g.loanBalanceCents), k(g.payoutsReceivedCents), k(g.distributionsReceivedCents), String(g.shares)]),
        [2, 3, 4, 5, 6, 7],
      );
      if (s.upcoming.length) {
        doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY).text('Upcoming obligations');
        doc.moveDown(0.3);
        table(doc, ['Due', 'Chama', 'Item', 'Amount'], [80, 160, 160, 99], s.upcoming.map((u) => [formatDate(u.dueDate), u.groupName, `${u.scheduleName} · ${u.periodLabel}`, k(u.outstandingCents)]), [3]);
      }
      doc.font('Helvetica').fontSize(8).fillColor(MUTED);
      s.notes.forEach((note) => doc.text(`• ${note}`));
    });
  }
}
