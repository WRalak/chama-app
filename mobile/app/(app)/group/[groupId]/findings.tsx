import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { FindingRow, Permission } from '@chamahub/shared';
import { Badge, Button, Chips, Empty, ErrorView, Field, Loading, Screen, Section, StatusBadge, T } from '@/components/ui';
import { api } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useAct, useGroup } from '@/lib/queries';
import { colors, space } from '@/theme';

export default function Findings() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const group = useGroup(groupId);
  const perms = group.data?.myMembership.permissions ?? [];
  const canRaise = perms.includes(Permission.FINDINGS_RAISE);
  const canSee = canRaise || perms.includes(Permission.FINDINGS_RESOLVE) || perms.includes(Permission.AUDIT_VIEW);
  const list = useQuery({ queryKey: ['findings', groupId], queryFn: () => api<FindingRow[]>(`groups/${groupId}/findings`), enabled: canSee });
  const [f, setF] = useState({ title: '', details: '', severity: 'MEDIUM' as 'LOW' | 'MEDIUM' | 'HIGH', reference: '' });
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [response, setResponse] = useState('');
  const raise = useAct(() => api(`groups/${groupId}/findings`, { body: { ...f, reference: f.reference || undefined } }), { invalidate: [['findings', groupId]], successMessage: 'Finding raised. Officers were notified.', onSuccess: () => setF({ title: '', details: '', severity: 'MEDIUM', reference: '' }) });
  const respond = useAct((status: 'ACKNOWLEDGED' | 'RESOLVED' | 'REJECTED') => api(`groups/${groupId}/findings/${replyTo}/respond`, { body: { status, response } }), { invalidate: [['findings', groupId]], onSuccess: () => { setReplyTo(null); setResponse(''); } });
  const tone = { HIGH: 'red', MEDIUM: 'amber', LOW: 'neutral' } as const;
  return (
    <Screen refreshing={list.isRefetching} onRefresh={list.refetch}>
      <Stack.Screen options={{ title: 'Audit findings' }} />
      {group.data && !canSee && <Empty title="Audit findings are for officers and auditors" icon="lock-closed-outline" />}
      {canRaise && (
        <Section title="Raise a finding">
          <View style={{ padding: space.lg }}>
            <Field label="Title" value={f.title} onChangeText={(t) => setF({ ...f, title: t })} />
            <Field label="What did you find?" value={f.details} onChangeText={(t) => setF({ ...f, details: t })} multiline style={{ minHeight: 80, textAlignVertical: 'top', paddingTop: 10 }} />
            <Chips value={f.severity} onChange={(v) => setF({ ...f, severity: v })} options={[{ value: 'LOW', label: 'Low' }, { value: 'MEDIUM', label: 'Medium' }, { value: 'HIGH', label: 'High' }]} />
            <Field label="Transaction reference (optional)" autoCapitalize="characters" value={f.reference} onChangeText={(t) => setF({ ...f, reference: t })} />
            <Button title="Raise finding" onPress={() => raise.mutate(undefined)} loading={raise.isPending} disabled={f.title.length < 5 || f.details.length < 10} />
          </View>
        </Section>
      )}
      {!canSee ? null : list.error ? <ErrorView error={list.error} onRetry={list.refetch} /> : !list.data ? <Loading /> : (
        <Section title="Findings">
          {list.data.length === 0 ? <Empty title="No findings" icon="checkmark-done-outline" /> : list.data.map((x, i) => (
            <View key={x.id} style={{ padding: space.lg, borderBottomWidth: i === list.data!.length - 1 ? 0 : 1, borderBottomColor: colors.border }}>
              <View style={{ flexDirection: 'row', gap: 6, marginBottom: 4 }}><Badge label={x.severity} tone={tone[x.severity]} /><StatusBadge status={x.status} /></View>
              <T variant="label">{x.title}</T>
              <T variant="body">{x.details}</T>
              <T variant="small">{`${x.raisedByName} · ${dateTime(x.createdAt)}${x.reference ? ` · ${x.reference}` : ''}`}</T>
              {x.response && <T variant="small" style={{ marginTop: 6, color: colors.text }}>{`${x.respondedByName}: ${x.response}`}</T>}
              {x.canRespond && (replyTo === x.id ? (
                <View style={{ marginTop: space.sm }}>
                  <Field label="Response" value={response} onChangeText={setResponse} />
                  <View style={{ flexDirection: 'row', gap: space.sm }}>
                    <Button title="Resolved" onPress={() => respond.mutate('RESOLVED')} disabled={response.trim().length < 5} style={{ flex: 1 }} />
                    <Button title="Noted" variant="secondary" onPress={() => respond.mutate('ACKNOWLEDGED')} disabled={response.trim().length < 5} style={{ flex: 1 }} />
                  </View>
                </View>
              ) : <Button title="Respond" variant="ghost" onPress={() => setReplyTo(x.id)} />)}
            </View>
          ))}
        </Section>
      )}
    </Screen>
  );
}
