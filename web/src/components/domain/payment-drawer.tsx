'use client';

import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { EVIDENCE_MIME_TYPES, LABELS, Permission, type PaymentHistory, type PaymentItem, type ShareableSummary } from '@chamahub/shared';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/input';
import { KeyValues } from '@/components/ui/layout-parts';
import { StatusBadge } from '@/components/ui/badge';
import { api, fileUrl } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useCan, useGroupId, useMe, useMyGroups } from '@/lib/session';
import { readEvidence } from '@/lib/files';
import { date, dateTime, kes } from '@/lib/utils';

/**
 * One payment: details, evidence, status history and the actions the viewer may take.
 * Outside a group page (e.g. My finances) the payment's own group is used, and officer
 * actions are hidden — the API enforces the same rules either way.
 */
export function PaymentDrawer({ payment, onClose }: { payment: PaymentItem | null; onClose: () => void }) {
  const routeGroupId = useGroupId();
  const groupId = routeGroupId || payment?.groupId || '';
  const routeCan = useCan();
  const can = (p: Permission) => !!routeGroupId && routeCan(p);
  const fileInput = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState('');
  const { data: me } = useMe();
  const { data: myGroups } = useMyGroups();
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<'none' | 'fail' | 'reverse'>('none');
  const invalidate = [['payment-history', payment?.id], ['payments', groupId], ['ledger', groupId], ['overview', groupId], ['reconciliation', groupId], ['loans', groupId], ['fines', groupId]];
  const verify = useAction((decision: 'CONFIRM' | 'FAIL') => api(`groups/${groupId}/payments/${payment!.id}/verify`, { body: { decision, note: reason || undefined } }), { success: (r) => ((r as PaymentItem).status === 'CONFIRMED' ? 'Payment confirmed and posted to the ledger' : 'Payment marked as failed'), invalidate, onSuccess: onClose });
  const reverse = useAction(() => api(`groups/${groupId}/payments/${payment!.id}/reverse`, { body: { reason } }), { success: 'Payment reversed with a mirror ledger entry', invalidate, onSuccess: onClose });
  const history = useQuery({ queryKey: ['payment-history', payment?.id], queryFn: () => api<PaymentHistory>(`groups/${groupId}/payments/${payment!.id}/history`), enabled: !!payment });
  const share = useAction(() => api<ShareableSummary>(`groups/${groupId}/share/receipt/${payment!.id}`), { onSuccess: (s) => window.open(`https://wa.me/?text=${encodeURIComponent(s.text)}`, '_blank') });
  const attach = useAction(
    async (file: File) => api<{ reusedOnAnotherPayment: boolean }>(`groups/${groupId}/payments/${payment!.id}/evidence`, { body: { ...(await readEvidence(file)), note: note.trim() || undefined } }),
    { success: (r) => (r.reusedOnAnotherPayment ? 'Attached. The same file is on another payment; officers will see this.' : 'Evidence attached'), invalidate: [['payment-history', payment?.id]], onSuccess: () => setNote('') },
  );
  const query = useAction(
    () => api(`groups/${groupId}/disputes`, { body: { paymentId: payment!.id, subject: `Query on payment ${payment!.reference ?? ''}`.trim(), details: `Please review this ${payment!.status.toLowerCase()} payment of ${kes(payment!.amountCents)}.` } }),
    { success: 'Your officers have been asked to review this payment', invalidate: [['payment-history', payment?.id], ['payments', groupId], ['my-payments']] },
  );
  if (!payment) return null;
  const recordedByMe = payment.recordedByName === me?.fullName;
  const mine = !!payment.membershipId && myGroups?.some((g) => g.membershipId === payment.membershipId);
  return (
    <Sheet open={!!payment} onOpenChange={(o) => !o && onClose()} title={`${kes(payment.amountCents)} · ${payment.memberName ?? 'Unattributed'}`} subtitle={<StatusBadge status={payment.status} />}>
      <KeyValues
        items={[
          ['Purpose', payment.purpose.replace('_', ' ').toLowerCase()],
          ['Date paid', date(payment.paidAt)],
          ['Method', LABELS.paymentMethod[payment.method]],
          ['Reference', payment.reference ?? '—'],
          ['Recorded by', payment.recordedByName ?? '—'],
          ['Recorded at', dateTime(payment.createdAt)],
          ['Verified by', payment.verifiedByName ?? '—'],
          ['Verified at', dateTime(payment.verifiedAt)],
          ['Sent to', payment.destinationName ?? '—'],
          ['Notes', payment.notes ?? '—'],
        ]}
      />
      {history.data && (
        <div className="mt-5 space-y-4">
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Evidence</h3>
            {history.data.evidence.length === 0 ? <p className="text-sm text-muted">None attached.</p> : (
              <ul className="divide-y divide-line rounded-md border border-line text-sm">
                {history.data.evidence.map((e) => (
                  <li key={e.id} className="flex justify-between gap-2 px-3 py-2">
                    <a className="text-berry hover:underline" href={fileUrl(`groups/${groupId}/payments/${payment.id}/evidence/${e.id}`)} target="_blank" rel="noreferrer">{e.fileName}</a>
                    <span className="text-xs text-muted">{e.uploadedByName} · {dateTime(e.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
            {history.data.canAddEvidence && (
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <Field label="Note (optional)" htmlFor="ev-note" className="min-w-0 flex-1">
                  <input id="ev-note" className="h-9 w-full rounded-md border border-line px-3 text-sm focus:border-rose focus:outline-none focus:ring-1 focus:ring-rose" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. M-Pesa message screenshot" />
                </Field>
                <input ref={fileInput} type="file" accept={EVIDENCE_MIME_TYPES.join(',')} className="sr-only" aria-label="Choose evidence file" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) attach.mutate(f); }} />
                <Button size="sm" variant="secondary" onClick={() => fileInput.current?.click()} loading={attach.isPending}>Attach receipt or screenshot</Button>
                <p className="w-full text-xs text-muted">JPG, PNG, WebP, HEIC or PDF, up to 3 MB.</p>
              </div>
            )}
          </div>
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">History</h3>
            <ol className="space-y-1.5 border-l border-line pl-3 text-sm">
              {history.data.events.map((e) => (
                <li key={e.id}><span className="font-medium text-plum">{e.label}</span><span className="text-xs text-muted"> · {dateTime(e.at)}{e.actorName ? ` · ${e.actorName}` : ''}</span>{e.note && <p className="text-xs text-muted">{e.note}</p>}</li>
              ))}
            </ol>
          </div>
        </div>
      )}
      {payment.status === 'PENDING' && mine && <p className="mt-4 rounded-md bg-pending-50 px-3 py-2 text-sm text-pending-ink">Not counted yet. It counts once an officer, the group’s statement or M-Pesa confirms the money arrived.</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        {payment.status === 'CONFIRMED' && <Button variant="secondary" size="sm" onClick={() => share.mutate(undefined)} loading={share.isPending}>Share receipt on WhatsApp</Button>}
        {mine && ['PENDING', 'CONFIRMED', 'FAILED'].includes(payment.status) && <Button variant="ghost" size="sm" onClick={() => query.mutate(undefined)} loading={query.isPending}>Query this payment</Button>}
      </div>
      {payment.status === 'DISPUTED' && <p className="mt-3 rounded-md bg-danger-50 px-3 py-2 text-sm text-danger-ink">This payment is being reviewed by your officers.</p>}
      {payment.allocations && payment.allocations.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Applied to</h3>
          <ul className="divide-y divide-line rounded-md border border-line text-sm">
            {payment.allocations.map((a, i) => (
              <li key={i} className="flex justify-between px-3 py-2">
                <span>{a.label}</span>
                <span className="tabular-nums">{kes(a.amountCents)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {payment.status === 'PENDING' && can(Permission.CONTRIBUTIONS_VERIFY) && (
        <div className="mt-6 space-y-3 rounded-md border border-line bg-canvas p-3">
          <p className="text-sm text-plum">Confirm only after checking the money is in the group account or cash box.</p>
          {recordedByMe && <p className="text-xs text-warning">You recorded this payment, so another officer must verify it.</p>}
          {mode === 'fail' && (
            <Field label="Why did it fail?" htmlFor="fail">
              <Textarea id="fail" rows={2} className="min-h-0" value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          )}
          <div className="flex gap-2">
            <Button onClick={() => verify.mutate('CONFIRM')} loading={verify.isPending} disabled={recordedByMe}>
              Confirm received
            </Button>
            {mode === 'fail' ? (
              <Button variant="danger" onClick={() => verify.mutate('FAIL')} loading={verify.isPending} disabled={recordedByMe}>
                Mark failed
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => setMode('fail')} disabled={recordedByMe}>
                Not received…
              </Button>
            )}
          </div>
        </div>
      )}
      {payment.status === 'CONFIRMED' && can(Permission.LEDGER_ADJUST) && (
        <div className="mt-6 space-y-3 rounded-md border border-line p-3">
          <p className="text-sm text-plum">Reversing posts a mirror entry. The original stays on record.</p>
          {mode === 'reverse' ? (
            <>
              <Field label="Reason for reversal" htmlFor="rev" hint="Required. This is written to the audit log.">
                <Textarea id="rev" rows={2} className="min-h-0" value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
              <Button variant="danger" onClick={() => reverse.mutate(undefined)} loading={reverse.isPending} disabled={reason.trim().length < 5}>
                Reverse payment
              </Button>
            </>
          ) : (
            <Button variant="secondary" onClick={() => setMode('reverse')}>
              Reverse…
            </Button>
          )}
        </div>
      )}
    </Sheet>
  );
}
