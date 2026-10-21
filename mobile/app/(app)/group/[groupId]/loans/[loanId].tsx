import { useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { addMonths, LABELS, LoanDetail, Permission, todayInNairobi } from '@chamahub/shared';
import { Button, Chips, ErrorView, Field, KV, Loading, Notice, Row, Screen, Section, Stat, StatGrid, StatusBadge, T } from '@/components/ui';
import { api } from '@/lib/api';
import { askToConfirm } from '@/lib/confirm';
import { date, dateTime, kes, newKey } from '@/lib/format';
import { useGroupAccess } from '@/lib/group';
import { useAct } from '@/lib/queries';
import { space } from '@/theme';

export default function LoanScreen() {
  const { loanId } = useLocalSearchParams<{ loanId: string }>();
  const { groupId, can, myMembershipId } = useGroupAccess();
  const loan = useQuery({ queryKey: ['loan', groupId, loanId], queryFn: () => api<LoanDetail>(`groups/${groupId}/loans/${loanId}`) });
  const l = loan.data;
  const officerView = !!l && l.membershipId !== myMembershipId && (can(Permission.LOANS_APPROVE) || can(Permission.LOANS_DISBURSE) || can(Permission.LOANS_VIEW_ALL));
  const inv = [['loan', groupId, loanId], ['loans', groupId], ['loans', groupId, 'mine'], ['group-dashboard', groupId]];
  const cancel = useAct(() => api(`groups/${groupId}/loans/${loanId}/cancel`, { method: 'POST' }), { invalidate: inv });
  const [comment, setComment] = useState('');
  const decide = useAct((decision: 'APPROVE' | 'REJECT') => api(`groups/${groupId}/loans/${loanId}/decision`, { body: { decision, comment: comment.trim() || undefined } }), { invalidate: inv, successMessage: 'Your decision and recommendation are recorded.' });
  const [method, setMethod] = useState<'MPESA' | 'BANK_TRANSFER' | 'CASH'>('MPESA');
  const [reference, setReference] = useState('');
  const [firstDue, setFirstDue] = useState(addMonths(todayInNairobi(), 1));
  const [key] = useState(newKey);
  const disburse = useAct(() => api(`groups/${groupId}/loans/${loanId}/disburse`, { body: { method, reference: reference.trim() || undefined, disbursedAt: todayInNairobi(), firstDueDate: firstDue, idempotencyKey: key } }), { invalidate: inv, successMessage: 'Disbursement recorded and the repayment schedule set.' });
  // Eligibility facts for reviewers: the borrower's savings, arrears and other debts in this group.
  const f = l?.borrowerPosition;
  return (
    <Screen refreshing={loan.isRefetching} onRefresh={loan.refetch} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: officerView && l ? `Loan · ${l.memberName}` : 'Loan' }} />
      {loan.error ? <ErrorView error={loan.error} onRetry={loan.refetch} /> : !l ? <Loading /> : (
        <>
          <StatGrid>
            <Stat label="Principal" value={kes(l.principalCents, true)} />
            <Stat label="Interest" value={kes(l.interestCents, true)} />
            <Stat label="Paid" value={kes(l.paidCents, true)} tone="success" />
            <Stat label="Outstanding" value={kes(l.outstandingCents, true)} tone={l.overdueCents ? 'danger' : undefined} sub={l.overdueCents ? `${kes(l.overdueCents, true)} overdue` : undefined} />
          </StatGrid>
          {l.status === 'PENDING_APPROVAL' && <Notice tone="amber" icon="time-outline">{`Waiting for approval: ${l.approvalsReceived} of ${l.approvalsRequired}.`}</Notice>}
          {l.status === 'APPROVED' && !officerView && <Notice tone="green" icon="checkmark-circle-outline">Approved. The treasurer will disburse it and set your repayment dates.</Notice>}

          {officerView && f && (
            <Section title="Borrower’s position in this group">
              <KV label="Contributed (verified)" value={kes(f.contributedCents)} />
              <KV label="Contributions in arrears" value={kes(f.arrearsCents)} />
              <KV label="Other loan balances" value={kes(f.otherLoansCents)} />
              <KV label="Unpaid fines" value={kes(f.finesOutstandingCents)} />
              <KV label="Member since" value={date(f.memberSince)} last />
            </Section>
          )}

          {l.canApprove && (
            <Section title="Your review">
              <View style={{ padding: space.lg, gap: space.sm }}>
                <T variant="small">{`${LABELS.interestMethod[l.interestMethod]} at ${(l.rateBps / 100).toFixed(2)}% · ${l.installments} installments · total ${kes(l.totalRepayableCents)}. The method is fixed before approval.`}</T>
                <Field label="Recommendation / comment (required to reject)" value={comment} onChangeText={setComment} multiline />
                <View style={{ flexDirection: 'row', gap: space.sm }}>
                  <Button title="Approve" onPress={() => askToConfirm('Approve this loan?', `${kes(l.principalCents)} to ${l.memberName}. Your approval is recorded in your name.`, 'Approve', () => decide.mutate('APPROVE'))} style={{ flex: 1 }} loading={decide.isPending} />
                  <Button title="Reject" variant="secondary" onPress={() => decide.mutate('REJECT')} style={{ flex: 1 }} disabled={comment.trim().length < 5} />
                </View>
              </View>
            </Section>
          )}
          {l.canDisburse && (
            <Section title="Disburse">
              <View style={{ padding: space.lg }}>
                <Notice tone="neutral">{`Send ${kes(l.principalCents)} to ${l.memberName} first, then record it here with the transaction reference.`}</Notice>
                <Chips value={method} onChange={setMethod} options={[{ value: 'MPESA', label: 'M-Pesa' }, { value: 'BANK_TRANSFER', label: 'Bank' }, { value: 'CASH', label: 'Cash' }]} />
                {method !== 'CASH' && <Field label="Transaction code" autoCapitalize="characters" value={reference} onChangeText={setReference} />}
                <Field label="First repayment date" value={firstDue} onChangeText={setFirstDue} placeholder="YYYY-MM-DD" />
                <Button title="Record disbursement" onPress={() => askToConfirm('Record disbursement?', `${kes(l.principalCents)} to ${l.memberName}${reference ? `, ref ${reference.toUpperCase()}` : ''}. This posts to the ledger.`, 'Record', () => disburse.mutate(undefined))} disabled={(method !== 'CASH' && reference.trim().length < 4) || !/^\d{4}-\d{2}-\d{2}$/.test(firstDue)} loading={disburse.isPending} />
              </View>
            </Section>
          )}
          {officerView && l.status === 'DISBURSED' && can(Permission.REPAYMENTS_RECORD) && (
            <Button title="Record a repayment" variant="secondary" icon="add-circle-outline" onPress={() => router.push(`/(app)/group/${groupId}/manage/record-payment?memberId=${l.membershipId}` as never)} style={{ marginBottom: space.lg }} />
          )}

          <Section title="Details">
            <Row title="Status" rightSub={<StatusBadge status={l.status} />} />
            <Row title="Purpose" right={l.purpose} />
            <Row title="Interest method" right={LABELS.interestMethod[l.interestMethod]} />
            <Row title="Rate" right={`${(l.rateBps / 100).toFixed(2)}%`} />
            <Row title="Disbursed" right={l.disbursedAt ? date(l.disbursedAt) : '—'} rightSub={l.disbursementReference ?? undefined} last />
          </Section>
          {l.schedule.length > 0 && (
            <Section title="Repayment schedule">
              {l.schedule.map((i, idx) => <Row key={i.id} title={`Installment ${i.number} · ${date(i.dueDate)}`} subtitle={`Paid ${kes(i.paidCents)}`} right={kes(i.totalCents)} rightSub={<StatusBadge status={i.status} />} last={idx === l.schedule.length - 1} />)}
            </Section>
          )}
          {l.repayments.length > 0 && (
            <Section title="Repayment history">
              {l.repayments.map((p, idx) => <Row key={p.id} title={kes(p.amountCents)} subtitle={`${date(p.paidAt)}${p.reference ? ` · ${p.reference}` : ''}`} rightSub={<StatusBadge status={p.status} />} last={idx === l.repayments.length - 1} />)}
            </Section>
          )}
          {l.approvals.length > 0 && (
            <Section title="Approvals and recommendations">
              {l.approvals.map((a, idx) => <Row key={a.id} title={a.approverName} subtitle={`${LABELS.groupRole[a.approverRole]} · ${dateTime(a.createdAt)}${a.comment ? ` · ${a.comment}` : ''}`} rightSub={<StatusBadge status={a.decision} />} last={idx === l.approvals.length - 1} />)}
            </Section>
          )}
          {l.membershipId === myMembershipId && ['PENDING_APPROVAL', 'APPROVED'].includes(l.status) && <Button title="Cancel application" variant="secondary" onPress={() => askToConfirm('Cancel your application?', 'You can apply again later.', 'Cancel application', () => cancel.mutate(undefined))} loading={cancel.isPending} />}
        </>
      )}
    </Screen>
  );
}
