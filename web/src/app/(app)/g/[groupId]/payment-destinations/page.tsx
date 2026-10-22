'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { DESTINATION_LABELS, DESTINATION_TYPES, DestinationType, PaymentDestinationRow, Permission, ShareableSummary } from '@chamahub/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { PageHeader, Panel } from '@/components/ui/layout-parts';
import { EmptyState, ErrorState, LoadingRows } from '@/components/ui/states';
import { MemberSelect } from '@/components/domain/member-select';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useCan, useGroupId } from '@/lib/session';
import { date, dateTime } from '@/lib/utils';

const USES = { CONTRIBUTION: 'Contributions', LOAN_REPAYMENT: 'Loan repayments', FINE: 'Fines' } as const;
const NUMBER_LABEL: Partial<Record<DestinationType, string>> = { PERSONAL_MPESA: 'M-Pesa phone number', OTHER_MOBILE_MONEY: 'Phone number', PAYBILL: 'Paybill number', TILL: 'Till number', BANK_ACCOUNT: 'Account number' };

function statusBadge(d: PaymentDestinationRow) {
  if (d.validNow) return <Badge tone="green">In use</Badge>;
  if (d.status === 'PENDING_APPROVAL') return <Badge tone="amber">Awaiting approval</Badge>;
  if (d.status === 'REJECTED') return <Badge tone="red">Rejected</Badge>;
  if (d.status === 'ACTIVE') return <Badge tone="blue">Starts {date(d.effectiveFrom)}</Badge>;
  return <Badge tone="neutral">No longer valid</Badge>;
}

function ProposeDialog({ open, onClose, replacing }: { open: boolean; onClose: () => void; replacing: PaymentDestinationRow | null }) {
  const groupId = useGroupId();
  const [type, setType] = useState<DestinationType>(replacing?.type ?? 'PAYBILL');
  const [f, setF] = useState({ displayName: '', provider: '', accountNumber: '', accountReference: '', accountName: '', branch: '', instructions: '', reason: '' });
  const [uses, setUses] = useState<string[]>([]);
  const [responsible, setResponsible] = useState('');
  const [verification, setVerification] = useState('MANUAL_REVIEW');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const opt = (v: string) => v.trim() || undefined;
  const submit = useAction(
    () => api(`groups/${groupId}/payment-destinations`, { body: { type, displayName: f.displayName.trim(), provider: opt(f.provider), accountNumber: opt(f.accountNumber), accountReference: opt(f.accountReference), accountName: opt(f.accountName), branch: opt(f.branch), instructions: opt(f.instructions), intendedUse: uses, responsibleMemberId: responsible || undefined, verification, replacesId: replacing?.id, reason: f.reason.trim() } }),
    { success: 'Sent for approval. Members keep the current details until another officer approves.', invalidate: [['destinations', groupId]], onSuccess: onClose },
  );
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={replacing ? `Change “${replacing.displayName}”` : 'Add payment destination'} description="Never enter a PIN, password or OTP. ChamaHub only needs the details members pay to.">
        <div className="space-y-3">
          {replacing && <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800">The current details stay in use until these are approved. Then the old ones are marked no longer valid and every member is told.</p>}
          <Field label="Type" htmlFor="d-type"><Select id="d-type" value={type} onChange={(e) => setType(e.target.value as DestinationType)}>{DESTINATION_TYPES.map((t) => <option key={t} value={t}>{DESTINATION_LABELS.type[t]}</option>)}</Select></Field>
          <Field label="Name members will see" htmlFor="d-name"><Input id="d-name" value={f.displayName} onChange={set('displayName')} placeholder="e.g. Upendo Paybill" /></Field>
          {['BANK_ACCOUNT', 'OTHER_MOBILE_MONEY', 'PROVIDER', 'BANK_TRANSFER'].includes(type) && <Field label={type.startsWith('BANK') ? 'Bank' : 'Provider'} htmlFor="d-prov"><Input id="d-prov" value={f.provider} onChange={set('provider')} /></Field>}
          {NUMBER_LABEL[type] && <Field label={NUMBER_LABEL[type]!} htmlFor="d-num"><Input id="d-num" value={f.accountNumber} onChange={set('accountNumber')} /></Field>}
          {type === 'PAYBILL' && <Field label="Account number members enter" htmlFor="d-ref" hint="e.g. UPENDO-<your phone>. Matching uses it to recognise members."><Input id="d-ref" value={f.accountReference} onChange={set('accountReference')} /></Field>}
          {['PERSONAL_MPESA', 'OTHER_MOBILE_MONEY', 'BANK_ACCOUNT', 'PAYBILL', 'TILL'].includes(type) && <Field label="Registered name shown to payers" htmlFor="d-acn"><Input id="d-acn" value={f.accountName} onChange={set('accountName')} /></Field>}
          {type === 'BANK_ACCOUNT' && <Field label="Branch" htmlFor="d-br"><Input id="d-br" value={f.branch} onChange={set('branch')} /></Field>}
          <Field label={['BANK_TRANSFER', 'PROVIDER', 'OTHER', 'CASH'].includes(type) ? 'How members should pay' : 'Extra instructions (optional)'} htmlFor="d-ins"><Textarea id="d-ins" rows={2} value={f.instructions} onChange={set('instructions')} /></Field>
          <fieldset className="text-sm">
            <legend className="mb-1 text-xs font-medium text-muted">Use for (none = any purpose)</legend>
            <div className="flex gap-3">{Object.entries(USES).map(([k, l]) => <label key={k} className="flex items-center gap-1"><input type="checkbox" checked={uses.includes(k)} onChange={() => setUses((x) => (x.includes(k) ? x.filter((y) => y !== k) : [...x, k]))} />{l}</label>)}</div>
          </fieldset>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Payments confirmed by" htmlFor="d-ver"><Select id="d-ver" value={verification} onChange={(e) => setVerification(e.target.value)}><option value="MANUAL_REVIEW">Officer check</option><option value="STATEMENT_IMPORT">Imported statements</option></Select></Field>
            <Field label="Responsible officer" htmlFor="d-resp"><MemberSelect id="d-resp" value={responsible} onChange={setResponsible} /></Field>
          </div>
          <Field label="Reason (kept in the audit log)" htmlFor="d-reason"><Input id="d-reason" value={f.reason} onChange={set('reason')} /></Field>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => submit.mutate(undefined)} loading={submit.isPending} disabled={f.displayName.trim().length < 3 || f.reason.trim().length < 5}>Send for approval</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function PaymentDestinationsPage() {
  const groupId = useGroupId();
  const can = useCan();
  const q = useQuery({ queryKey: ['destinations', groupId], queryFn: () => api<PaymentDestinationRow[]>(`groups/${groupId}/payment-destinations`) });
  const [dialog, setDialog] = useState<{ replacing: PaymentDestinationRow | null } | null>(null);
  const [acting, setActing] = useState<{ d: PaymentDestinationRow; mode: 'reject' | 'retire' } | null>(null);
  const [text, setText] = useState('');
  const inv = [['destinations', groupId], ['overview', groupId]];
  const decide = useAction((v: { id: string; decision: 'APPROVE' | 'REJECT' }) => api<{ status: string }>(`groups/${groupId}/payment-destinations/${v.id}/decision`, { body: { decision: v.decision, comment: text.trim() || undefined } }), { success: (r) => (r.status === 'ACTIVE' ? 'Approved — members have been told' : r.status === 'REJECTED' ? 'Rejected' : 'Approval recorded; another is still needed'), invalidate: inv, onSuccess: () => { setActing(null); setText(''); } });
  const retire = useAction((id: string) => api(`groups/${groupId}/payment-destinations/${id}/retire`, { body: { reason: text.trim() } }), { success: 'Retired — members have been told to stop paying there', invalidate: inv, onSuccess: () => { setActing(null); setText(''); } });
  const share = useAction(() => api<ShareableSummary>(`groups/${groupId}/share/how-to-pay`), { onSuccess: (s) => window.open(`https://wa.me/?text=${encodeURIComponent(s.text)}`, '_blank') });
  const rows = q.data ?? [];
  return (
    <>
      <PageHeader
        title="Payment destinations"
        description="Where members send money. New or changed details need another officer’s approval, and old details stay on record as no longer valid. ChamaHub does not log into these accounts."
        actions={<>
          <Button variant="secondary" onClick={() => share.mutate(undefined)} loading={share.isPending}>Share “how to pay” on WhatsApp</Button>
          {can(Permission.DESTINATIONS_MANAGE) && <Button onClick={() => setDialog({ replacing: null })}>Add destination</Button>}
        </>}
      />
      {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !q.data ? <LoadingRows /> : rows.length === 0 ? <EmptyState title="No payment destinations yet" description="Add the group’s Paybill, Till, bank account or the treasurer’s M-Pesa number so members know where to pay." /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {rows.map((d) => (
            <Panel key={d.id} title={<span className="flex items-center gap-2">{d.displayName} {statusBadge(d)}</span>}>
              <dl className="grid grid-cols-[9rem_1fr] gap-y-1 text-sm">
                <dt className="text-muted">Type</dt><dd>{DESTINATION_LABELS.type[d.type]}{d.provider ? ` · ${d.provider}` : ''}</dd>
                {d.accountNumber && <><dt className="text-muted">Number</dt><dd className="font-mono">{d.accountNumber}</dd></>}
                {d.accountReference && <><dt className="text-muted">Account to enter</dt><dd className="font-mono">{d.accountReference}</dd></>}
                {d.accountName && <><dt className="text-muted">Registered name</dt><dd>{d.accountName}</dd></>}
                {d.branch && <><dt className="text-muted">Branch</dt><dd>{d.branch}</dd></>}
                {d.instructions && <><dt className="text-muted">Instructions</dt><dd>{d.instructions}</dd></>}
                <dt className="text-muted">For</dt><dd>{d.intendedUse.length ? d.intendedUse.map((u) => USES[u]).join(', ') : 'Any payment'}</dd>
                <dt className="text-muted">Confirmed by</dt><dd>{DESTINATION_LABELS.verification[d.verification]}</dd>
                <dt className="text-muted">Responsible</dt><dd>{d.responsibleName ?? '—'}</dd>
                <dt className="text-muted">Effective</dt><dd>{date(d.effectiveFrom)}{d.effectiveTo ? ` – ${date(d.effectiveTo)}` : ''}{d.replacedByName ? ` · replaced by ${d.replacedByName}` : ''}</dd>
                <dt className="text-muted">Proposed by</dt><dd>{d.proposedByName}{d.proposalReason ? ` — “${d.proposalReason}”` : ''}</dd>
              </dl>
              {d.approvals.length > 0 && <ul className="mt-2 space-y-0.5 text-xs text-muted">{d.approvals.map((a) => <li key={a.id}>{a.decision === 'APPROVED' ? '✓ Approved' : '✕ Rejected'} by {a.approverName} · {dateTime(a.createdAt)}{a.comment ? ` — “${a.comment}”` : ''}</li>)}</ul>}
              {d.status === 'PENDING_APPROVAL' && <p className="mt-1 text-xs text-muted">{d.approvals.filter((a) => a.decision === 'APPROVED').length} of {d.approvalsRequired} approvals</p>}
              {d.rejectionReason && <p className="mt-1 text-xs text-danger">Rejected: {d.rejectionReason}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                {d.can.approve && <Button size="sm" onClick={() => { if (confirm('Approve these payment details? Check the number, name and reference with the account holder first.')) decide.mutate({ id: d.id, decision: 'APPROVE' }); }}>Approve</Button>}
                {d.can.approve && <Button size="sm" variant="secondary" onClick={() => setActing({ d, mode: 'reject' })}>Reject…</Button>}
                {d.can.replace && <Button size="sm" variant="secondary" onClick={() => setDialog({ replacing: d })}>Change details…</Button>}
                {d.can.retire && <Button size="sm" variant="ghost" onClick={() => setActing({ d, mode: 'retire' })}>Stop using…</Button>}
              </div>
            </Panel>
          ))}
        </div>
      )}
      {dialog && <ProposeDialog key={dialog.replacing?.id ?? 'new'} open onClose={() => setDialog(null)} replacing={dialog.replacing} />}
      <Dialog open={!!acting} onOpenChange={(o) => !o && setActing(null)}>
        <DialogContent title={acting?.mode === 'reject' ? 'Reject destination' : 'Stop using this destination'} description={acting?.d.displayName}>
          <div className="space-y-3">
            <Field label={acting?.mode === 'reject' ? 'Why are you rejecting it?' : 'Why? Members will be told to stop paying here.'} htmlFor="d-text"><Input id="d-text" value={text} onChange={(e) => setText(e.target.value)} /></Field>
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setActing(null)}>Cancel</Button><Button variant="danger" disabled={text.trim().length < 5} loading={decide.isPending || retire.isPending} onClick={() => (acting!.mode === 'reject' ? decide.mutate({ id: acting!.d.id, decision: 'REJECT' }) : retire.mutate(acting!.d.id))}>{acting?.mode === 'reject' ? 'Reject' : 'Stop using'}</Button></div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
