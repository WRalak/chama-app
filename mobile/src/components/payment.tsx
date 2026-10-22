import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { LABELS, PaymentItem } from '@chamahub/shared';
import { Badge, Button, Field, StatusBadge, T } from './ui';
import { date, kes } from '@/lib/format';
import { colors, space } from '@/theme';

/** Makes the origin of a payment explicit: a validated M-Pesa callback is not the same as a hand-recorded entry. */
export function SourceBadge({ p }: { p: Pick<PaymentItem, 'source' | 'method'> }) {
  if (p.source === 'MPESA_STK' || p.source === 'MPESA_C2B') return <Badge label="M-Pesa confirmed" tone="green" />;
  if (p.source === 'IMPORT') return <Badge label="Imported" tone="neutral" />;
  if (p.source === 'STATEMENT') return <Badge label="From statement" tone="blue" />;
  return <Badge label={`Manual · ${LABELS.paymentMethod[p.method]}`} tone="blue" />;
}

export interface PaymentActions {
  onVerify?: (decision: 'CONFIRM' | 'FAIL', note?: string) => void;
  onEscalate?: () => void;
  onReverse?: (reason: string) => void;
  busy?: boolean;
}

/** A payment with its audit facts and the actions the viewer may take. */
export function PaymentCard({ p, actions, last, duplicate }: { p: PaymentItem; actions?: PaymentActions; last?: boolean; duplicate?: boolean }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const hasActions = !!actions && (actions.onVerify || actions.onEscalate || actions.onReverse);
  return (
    <View style={{ padding: space.lg, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <T variant="label">{`${p.memberName ?? 'Unknown member'} · ${kes(p.amountCents)}`}</T>
          <T variant="small">{`${date(p.paidAt)} · ${LABELS.paymentMethod[p.method]}${p.reference ? ` · ${p.reference}` : ''} · ${p.purpose.replace('_', ' ').toLowerCase()}`}</T>
          <T variant="small">{`Recorded by ${p.recordedByName ?? '—'}${p.verifiedByName ? ` · verified by ${p.verifiedByName}` : ''}`}</T>
          {p.notes && <T variant="small" style={{ fontStyle: 'italic' }}>{`“${p.notes}”`}</T>}
          {(p.destinationName || p.evidenceCount > 0) && <T variant="small">{[p.destinationName && `Sent to ${p.destinationName}`, p.evidenceCount > 0 && `${p.evidenceCount} evidence file${p.evidenceCount > 1 ? 's' : ''}`].filter(Boolean).join(' · ')}</T>}
          <Pressable onPress={() => router.push(`/(app)/group/${p.groupId}/payments/${p.id}`)} accessibilityRole="link" hitSlop={8}>
            <T variant="small" style={{ color: colors.forest, fontWeight: '600', marginTop: 2 }}>History & evidence ›</T>
          </Pressable>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <StatusBadge status={p.status} />
          <SourceBadge p={p} />
          {duplicate && <Badge label="Duplicate ref" tone="red" />}
        </View>
      </View>
      {hasActions && !open && <Button title="Actions" variant="secondary" onPress={() => setOpen(true)} style={{ marginTop: space.sm }} />}
      {hasActions && open && (
        <View style={{ marginTop: space.sm, gap: space.sm }}>
          {actions!.onVerify && p.status === 'PENDING' && (
            <>
              <T variant="small">Confirm only after checking the money is in the group's account or cash box.</T>
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <Button title="Confirm received" onPress={() => actions!.onVerify!('CONFIRM')} style={{ flex: 1 }} loading={actions!.busy} />
                <Button title="Not received" variant="secondary" onPress={() => actions!.onVerify!('FAIL', reason || undefined)} style={{ flex: 1 }} />
              </View>
            </>
          )}
          {actions!.onEscalate && <Button title="Escalate a discrepancy" variant="secondary" icon="flag-outline" onPress={actions!.onEscalate} />}
          {actions!.onReverse && p.status === 'CONFIRMED' && (
            <>
              <Field label="Reason for reversal (kept in the audit log)" value={reason} onChangeText={setReason} />
              <Button title="Reverse this payment" variant="danger" onPress={() => actions!.onReverse!(reason)} disabled={reason.trim().length < 5} />
            </>
          )}
          <Button title="Close" variant="ghost" onPress={() => setOpen(false)} />
        </View>
      )}
    </View>
  );
}
