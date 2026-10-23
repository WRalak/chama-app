import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { type MySupportCase, SUPPORT_CATEGORIES, SUPPORT_LABELS, type SupportCategory } from '@chamahub/shared';
import { Badge, Button, Chips, Empty, ErrorView, Field, Loading, Notice, Row, Screen, Section, T } from '@/components/ui';
import { api } from '@/lib/api';
import { useAct, useMyGroups } from '@/lib/queries';
import { colors, radius, space } from '@/theme';

const FAQ: [string, string][] = [
  ['Why is my payment "pending"?', 'A treasurer recorded it, but another officer has not yet confirmed the money arrived. It counts once confirmed.'],
  ['When do I get my merry-go-round payout?', 'On your scheduled date, once the round is collected and officers approve it. You receive what was actually collected.'],
  ['Is a loan counted as income in my statement?', 'No. Loans are borrowed money you repay. Your statement shows them separately.'],
  ['Something on my statement looks wrong', 'Open the payment in My contributions and choose “Query this payment”. Your officers will review it.'],
];

const MEMBER_STATUS: Record<string, string> = { OPEN: 'Received', ASSIGNED: 'Being looked into', IN_PROGRESS: 'Being looked into', ESCALATED: 'Being looked into', WAITING_FOR_USER: 'Waiting for your reply', RESOLVED: 'Resolved', CLOSED: 'Closed' };
const TONE = { OPEN: 'amber', ASSIGNED: 'blue', IN_PROGRESS: 'blue', ESCALATED: 'blue', WAITING_FOR_USER: 'rose', RESOLVED: 'green', CLOSED: 'neutral' } as const;
const MONEY: SupportCategory[] = ['CONTRIBUTIONS_PAYMENTS', 'PAYOUT_ROTATION', 'LOANS_REPAYMENTS'];

/** Help centre: common questions, your support requests and the conversation with ChamaHub support. */
export default function Help() {
  const cases = useQuery({ queryKey: ['my-support-cases'], queryFn: () => api<MySupportCase[]>('me/support-cases') });
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const open = cases.data?.find((c) => c.id === openId);

  if (open) return <Thread c={open} onBack={() => setOpenId(null)} />;
  if (creating) return <NewCase onDone={(id) => { setCreating(false); setOpenId(id); }} onCancel={() => setCreating(false)} />;

  return (
    <Screen refreshing={cases.isRefetching} onRefresh={() => cases.refetch()}>
      <Stack.Screen options={{ title: 'Help and support' }} />
      <Section title="Your support requests" action={<Button title="New" variant="secondary" icon="add" onPress={() => setCreating(true)} />}>
        {cases.error ? <ErrorView error={cases.error} onRetry={() => cases.refetch()} /> : !cases.data ? <Loading /> : !cases.data.length ? (
          <Empty title="No requests yet" body="Ask ChamaHub support about sign-in problems, the app, or your subscription." />
        ) : (
          cases.data.map((c, i) => (
            <Row key={c.id} title={c.subject} subtitle={`${c.number} · ${SUPPORT_LABELS.category[c.category]}${c.groupName ? ` · ${c.groupName}` : ''}`} right={<Badge label={MEMBER_STATUS[c.status]} tone={TONE[c.status]} />} onPress={() => setOpenId(c.id)} last={i === cases.data!.length - 1} />
          ))
        )}
      </Section>
      <Section title="Common questions">
        {FAQ.map(([q, a], i) => <Row key={q} title={q} subtitle={a} last={i === FAQ.length - 1} />)}
      </Section>
      <T variant="small" style={{ textAlign: 'center' }}>For questions about your group's money, talk to your treasurer first: only officers can correct records.</T>
    </Screen>
  );
}

function NewCase({ onDone, onCancel }: { onDone: (id: string) => void; onCancel: () => void }) {
  const groups = useMyGroups();
  const [category, setCategory] = useState<SupportCategory>('TECHNICAL');
  const [groupId, setGroupId] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const send = useAct(() => api<MySupportCase>('me/support-cases', { body: { category, subject, description, groupId: groupId || undefined } }), { invalidate: [['my-support-cases']], successMessage: 'Request sent', onSuccess: (c) => onDone(c.id) });
  return (
    <Screen keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'New support request' }} />
      <Section title="Topic">
        <View style={{ padding: space.md }}>
          <Chips options={SUPPORT_CATEGORIES.map((c) => ({ value: c, label: SUPPORT_LABELS.category[c] }))} value={category} onChange={setCategory} />
        </View>
      </Section>
      {!!groups.data?.length && (
        <Section title="Which Chama? (optional)">
          <View style={{ padding: space.md }}>
            <Chips options={[{ value: '', label: 'Not about a Chama' }, ...groups.data.map((g) => ({ value: g.groupId, label: g.name }))]} value={groupId} onChange={setGroupId} />
          </View>
        </Section>
      )}
      {MONEY.includes(category) && <Notice tone="amber">Support can explain and check, but only your group’s officers can correct contributions, loans or payouts.</Notice>}
      <Section>
        <View style={{ padding: space.lg }}>
          <Field label="Subject" value={subject} onChangeText={setSubject} maxLength={200} />
          <Field label="What happened?" hint="Include dates and M-Pesa codes if relevant. Never include your PIN, password or a verification code." value={description} onChangeText={setDescription} multiline numberOfLines={5} maxLength={5000} style={{ minHeight: 110, textAlignVertical: 'top', paddingTop: 10 }} />
          <Button title="Send request" onPress={() => send.mutate(undefined)} loading={send.isPending} disabled={subject.trim().length < 3 || description.trim().length < 10} />
          <Button title="Cancel" variant="ghost" onPress={onCancel} />
        </View>
      </Section>
    </Screen>
  );
}

function Thread({ c, onBack }: { c: MySupportCase; onBack: () => void }) {
  const [body, setBody] = useState('');
  const reply = useAct(() => api(`me/support-cases/${c.id}/messages`, { body: { body } }), { invalidate: [['my-support-cases']], onSuccess: () => setBody('') });
  const close = useAct(() => api(`me/support-cases/${c.id}/close`, { body: {} }), { invalidate: [['my-support-cases']], successMessage: 'Request closed' });
  return (
    <Screen keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: c.number }} />
      <Section title={c.subject} action={<Badge label={MEMBER_STATUS[c.status]} tone={TONE[c.status]} />}>
        <View style={{ padding: space.md, gap: space.sm }}>
          {c.messages.map((m) => (
            <View key={m.id} style={{ alignSelf: m.from === 'YOU' ? 'flex-end' : 'flex-start', maxWidth: '88%', backgroundColor: m.from === 'YOU' ? colors.blush : colors.background, borderRadius: radius.lg, padding: space.md, borderWidth: m.from === 'YOU' ? 0 : 1, borderColor: colors.border }}>
              <T variant="small">{m.authorName} · {new Date(m.createdAt).toLocaleString('en-KE')}</T>
              <T>{m.body}</T>
            </View>
          ))}
        </View>
      </Section>
      {c.resolution && <Notice tone="green" icon="checkmark-circle-outline">{`Resolved: ${c.resolution}`}</Notice>}
      {c.status !== 'CLOSED' && (
        <Section>
          <View style={{ padding: space.lg }}>
            <Field label={c.status === 'RESOLVED' ? 'Still need help? Reply to reopen' : 'Reply'} value={body} onChangeText={setBody} multiline numberOfLines={3} maxLength={5000} style={{ minHeight: 80, textAlignVertical: 'top', paddingTop: 10 }} />
            <Button title="Send" onPress={() => reply.mutate(undefined)} loading={reply.isPending} disabled={!body.trim()} />
            <Button title="Close request" variant="ghost" onPress={() => close.mutate(undefined)} loading={close.isPending} />
          </View>
        </Section>
      )}
      <Button title="Back to my requests" variant="secondary" onPress={onBack} />
    </Screen>
  );
}
