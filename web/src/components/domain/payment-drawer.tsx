'use client';

import { useState } from 'react';
import { LABELS, Permission, type PaymentItem } from '@chamahub/shared';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/input';
import { KeyValues } from '@/components/ui/layout-parts';
import { StatusBadge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useCan, useGroupId, useMe } from '@/lib/session';
import { date, dateTime, kes } from '@/lib/utils';

export function PaymentDrawer({ payment, onClose }: { payment: PaymentItem | null; onClose: () => void }) {
  const groupId = useGroupId();
  const can = useCan();
  const { data: me } = useMe();
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<'none' | 'fail' | 'reverse'>('none');
  const invalidate = [['payments', groupId], ['ledger', groupId], ['overview', groupId], ['reconciliation', groupId], ['loans', groupId], ['fines', groupId]];
  const verify = useAction((decision: 'CONFIRM' | 'FAIL') => api(`groups/${groupId}/payments/${payment!.id}/verify`, { body: { decision, note: reason || undefined } }), { success: (r) => ((r as PaymentItem).status === 'CONFIRMED' ? 'Payment confirmed and posted to the ledger' : 'Payment marked as failed'), invalidate, onSuccess: onClose });
  const reverse = useAction(() => api(`groups/${groupId}/payments/${payment!.id}/reverse`, { body: { reason } }), { success: 'Payment reversed with a mirror ledger entry', invalidate, onSuccess: onClose });
  if (!payment) return null;
  const recordedByMe = payment.recordedByName === me?.fullName;
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
          ['Notes', payment.notes ?? '—'],
        ]}
      />
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
          <p className="text-sm text-navy">Confirm only after checking the money is in the group account or cash box.</p>
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
          <p className="text-sm text-navy">Reversing posts a mirror entry. The original stays on record.</p>
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
