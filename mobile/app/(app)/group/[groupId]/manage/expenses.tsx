import { useQuery } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { ExpenseRow, Permission, todayInNairobi } from '@chamahub/shared';
import { Button, Chips, Empty, ErrorView, Field, Loading, NoAccess, Screen, Section, StatusBadge, T } from '@/components/ui';
import { api } from '@/lib/api';
import { askToConfirm } from '@/lib/confirm';
import { date, kes, newKey } from '@/lib/format';
import { useGroupAccess } from '@/lib/group';
import { useAct } from '@/lib/queries';
import { colors, space } from '@/theme';

type Filter = 'PENDING_APPROVAL' | 'APPROVED' | 'PAID' | 'ALL';

/** Expenses: the treasurer records, another officer approves, the treasurer pays with a reference. */
export default function ExpensesManage() {
  const { groupId, group, can } = useGroupAccess();
  const P = Permission;
  const [filter, setFilter] = useState<Filter>('PENDING_APPROVAL');
  const list = useQuery({ queryKey: ['expenses', groupId, filter], queryFn: () => api<ExpenseRow[]>(`groups/${groupId}/expenses`, { query: filter === 'ALL' ? {} : { status: filter } }), enabled: can(P.EXPENSES_VIEW) });
  if (group.data && !can(P.EXPENSES_VIEW)) return <Screen><Stack.Screen options={{ title: 'Expenses' }} /><NoAccess what="expenses" /></Screen>;
  const rows = list.data ?? [];
  return (
    <Screen refreshing={list.isRefetching} onRefresh={list.refetch}>
      <Stack.Screen options={{ title: 'Expenses' }} />
      {can(P.EXPENSES_RECORD) && <Button title="Add an expense" icon="add-circle-outline" onPress={() => router.push(`/(app)/group/${groupId}/manage/expense-new` as never)} style={{ marginBottom: space.lg }} />}
      <Chips value={filter} onChange={setFilter} options={[{ value: 'PENDING_APPROVAL', label: 'Awaiting approval' }, { value: 'APPROVED', label: 'To pay' }, { value: 'PAID', label: 'Paid' }, { value: 'ALL', label: 'All' }]} />
      {list.error ? <ErrorView error={list.error} onRetry={list.refetch} /> : !list.data ? <Loading /> : (
        <Section title={`${rows.length} expense${rows.length === 1 ? '' : 's'} · ${kes(rows.reduce((a, e) => a + e.amountCents, 0))}`}>
          {rows.length === 0 ? <Empty title="Nothing here" icon="receipt-outline" /> : rows.map((e, i) => <ExpenseCard key={e.id} groupId={groupId} e={e} canPay={can(P.EXPENSES_RECORD)} last={i === rows.length - 1} />)}
        </Section>
      )}
    </Screen>
  );
}

function ExpenseCard({ groupId, e, canPay, last }: { groupId: string; e: ExpenseRow; canPay: boolean; last: boolean }) {
  const [comment, setComment] = useState('');
  const [method, setMethod] = useState<'MPESA' | 'BANK_TRANSFER' | 'CASH'>('MPESA');
  const [reference, setReference] = useState('');
  const [key] = useState(newKey);
  const inv = [['expenses', groupId], ['group-dashboard', groupId]];
  const decide = useAct((decision: 'APPROVE' | 'REJECT') => api(`groups/${groupId}/expenses/${e.id}/decision`, { body: { decision, comment: comment.trim() || undefined } }), { invalidate: inv, successMessage: 'Decision recorded.' });
  const pay = useAct(() => api(`groups/${groupId}/expenses/${e.id}/pay`, { body: { method, reference: reference.trim() || undefined, paidAt: todayInNairobi(), idempotencyKey: key } }), { invalidate: inv, successMessage: 'Payment recorded and posted to the ledger.' });
  const approvals = e.approvals.filter((a) => a.decision === 'APPROVED').length;
  return (
    <View style={{ padding: space.lg, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border, gap: 4 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <T variant="label" style={{ flex: 1 }}>{`${kes(e.amountCents)} · ${e.category}`}</T>
        <StatusBadge status={e.status} />
      </View>
      <T variant="small">{`${e.description}${e.payee ? ` · to ${e.payee}` : ''}`}</T>
      <T variant="small">{`Incurred ${date(e.incurredOn)} · recorded by ${e.recordedByName} · ${approvals}/${e.approvalsRequired} approvals${e.paymentReference ? ` · ref ${e.paymentReference}` : ''}`}</T>
      {e.approvals.map((a) => <T key={a.id} variant="small">{`${a.decision === 'APPROVED' ? '✓' : '✗'} ${a.approverName}${a.comment ? `: ${a.comment}` : ''}`}</T>)}
      {e.canApprove && (
        <View style={{ marginTop: space.sm }}>
          <Field label="Comment (required to reject)" value={comment} onChangeText={setComment} />
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button title="Approve" onPress={() => askToConfirm('Approve this expense?', `${kes(e.amountCents)} for ${e.description}.`, 'Approve', () => decide.mutate('APPROVE'))} style={{ flex: 1 }} loading={decide.isPending} />
            <Button title="Reject" variant="secondary" onPress={() => decide.mutate('REJECT')} style={{ flex: 1 }} disabled={comment.trim().length < 5} />
          </View>
        </View>
      )}
      {canPay && e.status === 'APPROVED' && (
        <View style={{ marginTop: space.sm }}>
          <Chips value={method} onChange={setMethod} options={[{ value: 'MPESA', label: 'M-Pesa' }, { value: 'BANK_TRANSFER', label: 'Bank' }, { value: 'CASH', label: 'Cash' }]} />
          {method !== 'CASH' && <Field label="Transaction code" autoCapitalize="characters" value={reference} onChangeText={setReference} />}
          <Button title="Record payment" onPress={() => askToConfirm('Record this payment?', `${kes(e.amountCents)} to ${e.payee ?? 'the payee'}. This posts to the ledger.`, 'Record', () => pay.mutate(undefined))} disabled={method !== 'CASH' && reference.trim().length < 4} loading={pay.isPending} />
        </View>
      )}
    </View>
  );
}
