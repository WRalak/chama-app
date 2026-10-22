import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { LABELS } from '@chamahub/shared';
import { EvidencePicker } from '@/components/evidence';
import { SourceBadge } from '@/components/payment';
import { Button, ErrorView, KV, Loading, Notice, Row, Screen, Section, StatusBadge, T } from '@/components/ui';
import { api } from '@/lib/api';
import { uploadEvidence, usePaymentHistory } from '@/lib/collections';
import { downloadFile } from '@/lib/download';
import type { PickedFile } from '@/lib/files';
import { date, dateTime, kes } from '@/lib/format';
import { useGroupAccess } from '@/lib/group';
import { useAct } from '@/lib/queries';
import { shareSummary } from '@/lib/share';
import { colors, space } from '@/theme';

/** One payment: where it was sent, the evidence, and every status change in order. */
export default function PaymentDetail() {
  const { groupId } = useGroupAccess();
  const { paymentId } = useLocalSearchParams<{ paymentId: string }>();
  const q = usePaymentHistory(groupId, paymentId);
  const [file, setFile] = useState<PickedFile | null>(null);
  const add = useAct(() => uploadEvidence(groupId, paymentId, file!), { invalidate: [['payment-history', paymentId]], successMessage: 'Evidence attached.', onSuccess: (r) => { setFile(null); if (r.reusedOnAnotherPayment) setTimeout(() => alert('Note: the same file is attached to another payment. Officers will see this.'), 50); } });
  const query = useAct(() => api(`groups/${groupId}/disputes`, { body: { paymentId, subject: `Query on payment ${q.data?.payment.reference ?? ''}`.trim(), details: `Please review this ${q.data?.payment.status.toLowerCase()} payment of ${kes(q.data?.payment.amountCents)}.` } }), { invalidate: [['payment-history', paymentId], ['my-payments', groupId]], successMessage: 'Your officers have been asked to review this payment.' });
  const p = q.data?.payment;
  return (
    <Screen refreshing={q.isRefetching} onRefresh={q.refetch}>
      <Stack.Screen options={{ title: 'Payment' }} />
      {q.error ? <ErrorView error={q.error} onRetry={q.refetch} /> : !q.data || !p ? <Loading /> : (
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: space.md }}>
            <View>
              <T variant="amount">{kes(p.amountCents)}</T>
              <T variant="small">{`${p.memberName ?? ''} · ${p.purpose === 'CONTRIBUTION' ? 'Contribution' : p.purpose === 'LOAN_REPAYMENT' ? 'Loan repayment' : 'Fine'}`}</T>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              <StatusBadge status={p.status} />
              <SourceBadge p={p} />
            </View>
          </View>
          {p.status === 'PENDING' && <Notice tone="amber" icon="time-outline">Not counted yet. It counts once an officer, the group’s statement or M-Pesa confirms the money arrived.</Notice>}
          <Section title="Details">
            <KV label="Paid on" value={date(p.paidAt)} />
            <KV label="Method" value={LABELS.paymentMethod[p.method]} />
            {p.reference && <KV label="Reference" value={p.reference} />}
            <KV label="Sent to" value={q.data.destination ? `${q.data.destination.displayName}${q.data.destination.validNow ? '' : ' (no longer valid)'}` : '—'} />
            {(p.allocations ?? []).map((a) => <KV key={a.label} label={a.label} value={kes(a.amountCents)} />)}
            <KV label="Recorded by" value={p.recordedByName ?? '—'} last={!p.verifiedByName} />
            {p.verifiedByName && <KV label="Confirmed by" value={p.verifiedByName} last />}
          </Section>

          <Section title="Evidence">
            {q.data.evidence.length === 0 && <Row title="No evidence attached" subtitle="A receipt or M-Pesa screenshot helps the officer check quickly." last={!q.data.canAddEvidence} />}
            {q.data.evidence.map((e, i) => (
              <Row key={e.id} icon={e.mimeType === 'application/pdf' ? 'document-outline' : 'image-outline'} title={e.fileName} subtitle={`${e.uploadedByName} · ${dateTime(e.createdAt)}${e.note ? ` · ${e.note}` : ''}`} onPress={() => downloadFile(`groups/${groupId}/payments/${paymentId}/evidence/${e.id}`, e.fileName, e.mimeType)} last={i === q.data!.evidence.length - 1 && !q.data!.canAddEvidence} />
            ))}
            {q.data.canAddEvidence && (
              <View style={{ padding: space.lg }}>
                <EvidencePicker value={file} onChange={setFile} />
                {file && <Button title="Attach" onPress={() => add.mutate(undefined)} loading={add.isPending} />}
              </View>
            )}
          </Section>

          <Section title="History">
            {q.data.events.map((e, i) => (
              <View key={e.id} style={{ flexDirection: 'row', gap: space.md, padding: space.lg, borderBottomWidth: i === q.data!.events.length - 1 ? 0 : 1, borderBottomColor: colors.border }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, marginTop: 5, backgroundColor: e.toStatus === 'CONFIRMED' ? colors.success : e.toStatus === 'FAILED' || e.toStatus === 'REVERSED' ? colors.error : colors.muted }} />
                <View style={{ flex: 1 }}>
                  <T variant="label">{e.label}</T>
                  <T variant="small">{`${dateTime(e.at)}${e.actorName ? ` · ${e.actorName}` : ''}`}</T>
                  {e.note && <T variant="small">{e.note}</T>}
                </View>
              </View>
            ))}
          </Section>

          {p.status === 'CONFIRMED' && <Button title="Share receipt on WhatsApp" icon="logo-whatsapp" variant="secondary" onPress={() => shareSummary(`groups/${groupId}/share/receipt/${paymentId}`)} style={{ marginBottom: space.sm }} />}
          {['PENDING', 'CONFIRMED', 'FAILED'].includes(p.status) && <Button title="Query this payment" variant="ghost" icon="help-circle-outline" onPress={() => query.mutate(undefined)} loading={query.isPending} />}
          {p.status === 'DISPUTED' && <Notice tone="red" icon="flag-outline">This payment is being reviewed by your officers.</Notice>}
        </>
      )}
    </Screen>
  );
}
