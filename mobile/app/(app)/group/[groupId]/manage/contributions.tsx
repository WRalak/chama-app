import { useQuery } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { ContributionLedgerRow, MemberRow, Paginated, parseKes, PaymentItem, Permission, ReconciliationSummary, TRANSACTION_STATUSES } from '@chamahub/shared';
import { PaymentCard } from '@/components/payment';
import { Button, Chips, Empty, ErrorView, Field, KV, Loading, NoAccess, Notice, Row, Screen, Section, StatusBadge, T } from '@/components/ui';
import { api } from '@/lib/api';
import { askToConfirm } from '@/lib/confirm';
import { date, dateTime, kes } from '@/lib/format';
import { useGroupAccess } from '@/lib/group';
import { useAct } from '@/lib/queries';
import { colors, space } from '@/theme';

type Tab = 'verify' | 'search' | 'mpesa' | 'arrears' | 'duplicates' | 'disputes';
interface DisputeRow { id: string; memberName: string; paymentId: string | null; payment: { amountCents: number; reference: string | null; status: string } | null; subject: string; details: string; status: string; resolution: string | null; createdAt: string }

export default function ContributionsManage() {
  const { groupId, group, can, canAny } = useGroupAccess();
  const P = Permission;
  const tabs = [
    ...(can(P.CONTRIBUTIONS_VERIFY) ? [{ value: 'verify' as const, label: 'To verify' }] : []),
    ...(can(P.CONTRIBUTIONS_VIEW_ALL) ? [{ value: 'search' as const, label: 'Search' }] : []),
    ...(can(P.RECONCILIATION_MANAGE) ? [{ value: 'mpesa' as const, label: 'M-Pesa unmatched' }] : []),
    ...(can(P.CONTRIBUTIONS_VIEW_ALL) ? [{ value: 'arrears' as const, label: 'Arrears' }] : []),
    ...(can(P.RECONCILIATION_MANAGE) ? [{ value: 'duplicates' as const, label: 'Duplicates' }] : []),
    ...(canAny(P.CONTRIBUTIONS_VERIFY, P.RECONCILIATION_MANAGE) ? [{ value: 'disputes' as const, label: 'Disputes' }] : []),
  ];
  const [tab, setTab] = useState<Tab>('verify');
  const active = tabs.some((t) => t.value === tab) ? tab : tabs[0]?.value;
  const inv = [['payments', groupId], ['reconciliation', groupId], ['group-dashboard', groupId], ['ledger', groupId], ['disputes', groupId]];

  const verify = useAct(({ id, decision, note }: { id: string; decision: 'CONFIRM' | 'FAIL'; note?: string }) => api(`groups/${groupId}/payments/${id}/verify`, { body: { decision, note } }), { invalidate: inv, successMessage: 'Decision recorded.' });
  const reverse = useAct(({ id, reason }: { id: string; reason: string }) => api(`groups/${groupId}/payments/${id}/reverse`, { body: { reason } }), { invalidate: inv, successMessage: 'Reversed. A reversal entry was added to the ledger; the original stays on record.' });
  const actionsFor = (p: PaymentItem) => ({
    onVerify: can(P.CONTRIBUTIONS_VERIFY) ? (decision: 'CONFIRM' | 'FAIL', note?: string) => askToConfirm(decision === 'CONFIRM' ? 'Confirm this payment?' : 'Mark as not received?', `${kes(p.amountCents)} from ${p.memberName}${p.reference ? `, ref ${p.reference}` : ''}.`, decision === 'CONFIRM' ? 'Confirm' : 'Not received', () => verify.mutate({ id: p.id, decision, note })) : undefined,
    onEscalate: () => router.push(`/(app)/group/${groupId}/manage/dispute?paymentId=${p.id}&label=${encodeURIComponent(`${p.memberName} · ${kes(p.amountCents)}${p.reference ? ` · ${p.reference}` : ''}`)}` as never),
    onReverse: can(P.LEDGER_ADJUST) ? (reason: string) => askToConfirm('Reverse this payment?', 'The payment is reversed with a ledger entry. Nothing is deleted.', 'Reverse', () => reverse.mutate({ id: p.id, reason })) : undefined,
    busy: verify.isPending,
  });

  if (group.data && tabs.length === 0) return <Screen><Stack.Screen options={{ title: 'Contributions' }} /><NoAccess what="managing contributions" /></Screen>;
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Contributions' }} />
      {!group.data ? <Loading /> : (
        <>
          {can(P.CONTRIBUTIONS_RECORD) && <Button title="Record a payment" icon="add-circle-outline" onPress={() => router.push(`/(app)/group/${groupId}/manage/record-payment` as never)} style={{ marginBottom: space.lg }} />}
          <Chips value={active!} onChange={setTab} options={tabs} />
          {active === 'verify' && <VerifyTab groupId={groupId} actionsFor={actionsFor} />}
          {active === 'search' && <SearchTab groupId={groupId} actionsFor={actionsFor} />}
          {active === 'mpesa' && <MpesaTab groupId={groupId} />}
          {active === 'arrears' && <ArrearsTab groupId={groupId} canRecord={can(P.CONTRIBUTIONS_RECORD)} />}
          {active === 'duplicates' && <DuplicatesTab groupId={groupId} actionsFor={actionsFor} />}
          {active === 'disputes' && <DisputesTab groupId={groupId} canResolve={can(P.CONTRIBUTIONS_VERIFY)} />}
        </>
      )}
    </Screen>
  );
}

type ActionsFor = (p: PaymentItem) => Parameters<typeof PaymentCard>[0]['actions'];

function VerifyTab({ groupId, actionsFor }: { groupId: string; actionsFor: ActionsFor }) {
  const q = useQuery({ queryKey: ['payments', groupId, 'PENDING'], queryFn: () => api<Paginated<PaymentItem>>(`groups/${groupId}/payments`, { query: { status: 'PENDING', pageSize: 100 } }) });
  return (
    <>
      <Notice tone="neutral">A payment counts only after an officer other than the recorder and the payer confirms it. You cannot verify your own entries.</Notice>
      <Section title={`Awaiting verification${q.data ? ` (${q.data.total})` : ''}`}>
        {q.error ? <ErrorView error={q.error} onRetry={q.refetch} /> : !q.data ? <Loading /> : q.data.items.length === 0 ? <Empty title="Nothing to verify" icon="checkmark-done-outline" /> : q.data.items.map((p, i) => <PaymentCard key={p.id} p={p} actions={actionsFor(p)} last={i === q.data!.items.length - 1} />)}
      </Section>
    </>
  );
}

function SearchTab({ groupId, actionsFor }: { groupId: string; actionsFor: ActionsFor }) {
  const [text, setText] = useState('');
  const [amount, setAmount] = useState('');
  const [from, setFrom] = useState('');
  const [status, setStatus] = useState<string>('ALL');
  const [submitted, setSubmitted] = useState<Record<string, string | number | undefined>>({});
  let cents: number | undefined;
  try {
    cents = amount ? parseKes(amount) : undefined;
  } catch {
    cents = undefined;
  }
  const q = useQuery({ queryKey: ['payments', groupId, 'search', submitted], queryFn: () => api<Paginated<PaymentItem>>(`groups/${groupId}/payments`, { query: { pageSize: 50, ...submitted } }) });
  const ok = !from || /^\d{4}-\d{2}-\d{2}$/.test(from);
  return (
    <>
      <Field label="Member name or transaction code" value={text} onChangeText={setText} autoCapitalize="characters" placeholder="e.g. Amina or SBK3XYZ" />
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <View style={{ flex: 1 }}><Field label="Exact amount" prefix="KES" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} error={amount && cents === undefined ? 'Invalid' : undefined} /></View>
        <View style={{ flex: 1 }}><Field label="On or after" placeholder="YYYY-MM-DD" value={from} onChangeText={setFrom} error={ok ? undefined : 'Use YYYY-MM-DD'} /></View>
      </View>
      <Chips value={status} onChange={setStatus} options={[{ value: 'ALL', label: 'All' }, ...TRANSACTION_STATUSES.map((s) => ({ value: s, label: s.toLowerCase() }))]} />
      <Button title="Search" icon="search-outline" onPress={() => setSubmitted({ q: text.trim() || undefined, amountCents: cents, from: from || undefined, status: status === 'ALL' ? undefined : status })} disabled={!ok} style={{ marginBottom: space.lg }} />
      <Section title={q.data ? `${q.data.total} payment${q.data.total === 1 ? '' : 's'}` : 'Results'}>
        {q.error ? <ErrorView error={q.error} onRetry={q.refetch} /> : !q.data ? <Loading /> : q.data.items.length === 0 ? <Empty title="No payments match" /> : q.data.items.map((p, i) => <PaymentCard key={p.id} p={p} actions={actionsFor(p)} last={i === q.data!.items.length - 1} />)}
      </Section>
    </>
  );
}

function MpesaTab({ groupId }: { groupId: string }) {
  const rec = useQuery({ queryKey: ['reconciliation', groupId], queryFn: () => api<ReconciliationSummary>(`groups/${groupId}/reconciliation`) });
  const members = useQuery({ queryKey: ['members', groupId, 'ACTIVE'], queryFn: () => api<MemberRow[]>(`groups/${groupId}/members`, { query: { status: 'ACTIVE' } }) });
  const [openId, setOpenId] = useState<string | null>(null);
  const [memberId, setMemberId] = useState('');
  const [reason, setReason] = useState('');
  const inv = [['reconciliation', groupId], ['payments', groupId], ['group-dashboard', groupId]];
  const match = useAct(({ id }: { id: string }) => api(`groups/${groupId}/unmatched/${id}/match`, { body: { memberId, purpose: 'CONTRIBUTION' } }), { invalidate: inv, successMessage: 'Matched. It now waits for a second officer to verify the allocation.', onSuccess: () => setOpenId(null) });
  const ignore = useAct(({ id }: { id: string }) => api(`groups/${groupId}/unmatched/${id}/ignore`, { body: { reason } }), { invalidate: inv, successMessage: 'Marked as not for this group.', onSuccess: () => setOpenId(null) });
  return (
    <>
      <Notice tone="neutral">These M-Pesa payments reached the group's paybill and were confirmed by Safaricom, but could not be linked to a member automatically. Match each one to the member who paid.</Notice>
      <Section title="Unmatched M-Pesa payments">
        {rec.error ? <ErrorView error={rec.error} onRetry={rec.refetch} /> : !rec.data ? <Loading /> : rec.data.unmatched.length === 0 ? <Empty title="Everything is matched" icon="checkmark-done-outline" /> : rec.data.unmatched.map((u, i) => (
          <View key={u.id} style={{ padding: space.lg, borderBottomWidth: i === rec.data!.unmatched.length - 1 ? 0 : 1, borderBottomColor: colors.border }}>
            <T variant="label">{`${kes(u.amountCents)} · ${u.reference}`}</T>
            <T variant="small">{`${dateTime(u.receivedAt)} · from ${u.payerName ?? 'unknown'}${u.payerPhone ? ` (${u.payerPhone})` : ''} · account "${u.accountReference ?? ''}"`}</T>
            {openId === u.id ? (
              <View style={{ marginTop: space.sm }}>
                <T variant="label" style={{ marginBottom: 6 }}>Who paid?</T>
                <Chips value={memberId} onChange={setMemberId} options={(members.data ?? []).map((m) => ({ value: m.membershipId, label: m.fullName }))} />
                <Button title="Match to this member" onPress={() => match.mutate({ id: u.id })} disabled={!memberId} loading={match.isPending} />
                <Field label="Or: why this is not the group's money" value={reason} onChangeText={setReason} />
                <Button title="Not for this group" variant="secondary" onPress={() => ignore.mutate({ id: u.id })} disabled={reason.trim().length < 5} />
              </View>
            ) : (
              <Button title="Match" variant="secondary" onPress={() => { setOpenId(u.id); setMemberId(''); setReason(''); }} style={{ marginTop: space.sm }} />
            )}
          </View>
        ))}
      </Section>
    </>
  );
}

function ArrearsTab({ groupId, canRecord }: { groupId: string; canRecord: boolean }) {
  const q = useQuery({ queryKey: ['ledger', groupId, 'OUTSTANDING'], queryFn: () => api<Paginated<ContributionLedgerRow>>(`groups/${groupId}/contributions/ledger`, { query: { status: 'OUTSTANDING', pageSize: 100 } }) });
  const total = q.data?.items.reduce((a, r) => a + r.outstandingCents, 0) ?? 0;
  return (
    <Section title={q.data ? `Outstanding · ${kes(total)}` : 'Outstanding'}>
      {q.error ? <ErrorView error={q.error} onRetry={q.refetch} /> : !q.data ? <Loading /> : q.data.items.length === 0 ? <Empty title="Nobody is behind" icon="happy-outline" /> : q.data.items.map((r, i) => (
        <Row
          key={r.obligationId}
          title={`${r.memberName} · ${r.period}`}
          subtitle={`Due ${date(r.dueDate)} · paid ${kes(r.receivedCents)}${r.pendingCents ? ` · ${kes(r.pendingCents)} awaiting verification` : ''}`}
          right={kes(r.outstandingCents)}
          rightSub={<StatusBadge status={r.status} />}
          onPress={canRecord ? () => router.push(`/(app)/group/${groupId}/manage/record-payment?memberId=${r.membershipId}&targetId=${r.obligationId}&amount=${r.outstandingCents}&label=${encodeURIComponent(`${r.memberName} · ${r.period}`)}` as never) : undefined}
          last={i === q.data!.items.length - 1}
        />
      ))}
    </Section>
  );
}

function DuplicatesTab({ groupId, actionsFor }: { groupId: string; actionsFor: ActionsFor }) {
  const rec = useQuery({ queryKey: ['reconciliation', groupId], queryFn: () => api<ReconciliationSummary>(`groups/${groupId}/reconciliation`) });
  return (
    <>
      <Notice tone="amber" icon="copy-outline">The same transaction code recorded more than once usually means a payment was entered twice. Escalate or reverse the extra entry; never delete it.</Notice>
      {rec.error ? <ErrorView error={rec.error} onRetry={rec.refetch} /> : !rec.data ? <Loading /> : rec.data.duplicateReferences.length === 0 ? <Section><Empty title="No duplicate references" icon="checkmark-done-outline" /></Section> : rec.data.duplicateReferences.map((d) => <DuplicateGroup key={d.reference} groupId={groupId} reference={d.reference} actionsFor={actionsFor} />)}
    </>
  );
}

function DuplicateGroup({ groupId, reference, actionsFor }: { groupId: string; reference: string; actionsFor: ActionsFor }) {
  const q = useQuery({ queryKey: ['payments', groupId, 'ref', reference], queryFn: () => api<Paginated<PaymentItem>>(`groups/${groupId}/payments`, { query: { q: reference, pageSize: 20 } }) });
  return (
    <Section title={`Code ${reference}`}>
      {!q.data ? <Loading /> : q.data.items.filter((p) => p.reference === reference).map((p, i, arr) => <PaymentCard key={p.id} p={p} duplicate actions={actionsFor(p)} last={i === arr.length - 1} />)}
    </Section>
  );
}

function DisputesTab({ groupId, canResolve }: { groupId: string; canResolve: boolean }) {
  const q = useQuery({ queryKey: ['disputes', groupId], queryFn: () => api<DisputeRow[]>(`groups/${groupId}/disputes`) });
  const [openId, setOpenId] = useState<string | null>(null);
  const [resolution, setResolution] = useState('');
  const resolve = useAct(({ id, status }: { id: string; status: 'RESOLVED' | 'REJECTED' }) => api(`groups/${groupId}/disputes/${id}/resolve`, { body: { status, resolution } }), { invalidate: [['disputes', groupId], ['payments', groupId], ['group-dashboard', groupId]], successMessage: 'Recorded. The member has been told.', onSuccess: () => setOpenId(null) });
  const open = q.data?.filter((d) => d.status === 'OPEN') ?? [];
  const closed = q.data?.filter((d) => d.status !== 'OPEN') ?? [];
  return (
    <>
      <Section title={`Open (${open.length})`}>
        {q.error ? <ErrorView error={q.error} onRetry={q.refetch} /> : !q.data ? <Loading /> : open.length === 0 ? <Empty title="No open disputes" icon="checkmark-done-outline" /> : open.map((d, i) => (
          <View key={d.id} style={{ padding: space.lg, borderBottomWidth: i === open.length - 1 ? 0 : 1, borderBottomColor: colors.border }}>
            <T variant="label">{d.subject}</T>
            <T variant="small">{`${d.memberName} · ${dateTime(d.createdAt)}${d.payment ? ` · ${kes(d.payment.amountCents)}${d.payment.reference ? ` ${d.payment.reference}` : ''}` : ''}`}</T>
            <T variant="body" style={{ marginTop: 4 }}>{d.details}</T>
            {canResolve && (openId === d.id ? (
              <View style={{ marginTop: space.sm }}>
                <Field label="Resolution (sent to the member)" value={resolution} onChangeText={setResolution} />
                <View style={{ flexDirection: 'row', gap: space.sm }}>
                  <Button title="Resolve" onPress={() => resolve.mutate({ id: d.id, status: 'RESOLVED' })} style={{ flex: 1 }} disabled={resolution.trim().length < 5} />
                  <Button title="Reject" variant="secondary" onPress={() => resolve.mutate({ id: d.id, status: 'REJECTED' })} style={{ flex: 1 }} disabled={resolution.trim().length < 5} />
                </View>
              </View>
            ) : <Button title="Respond" variant="secondary" onPress={() => { setOpenId(d.id); setResolution(''); }} style={{ marginTop: space.sm }} />)}
          </View>
        ))}
      </Section>
      {closed.length > 0 && (
        <Section title="Closed">
          {closed.slice(0, 20).map((d, i, arr) => <KV key={d.id} label={`${d.subject} · ${d.memberName}`} value={d.status.toLowerCase()} last={i === arr.length - 1} />)}
        </Section>
      )}
    </>
  );
}
