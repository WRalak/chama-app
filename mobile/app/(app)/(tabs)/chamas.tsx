import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { LABELS } from '@chamahub/shared';
import { Badge, Button, Empty, ErrorView, Field, Loading, Screen, Section, T } from '@/components/ui';
import { api } from '@/lib/api';
import { date, kes } from '@/lib/format';
import { useAct, useMyGroups } from '@/lib/queries';
import { colors, space } from '@/theme';
import { Pressable, StyleSheet } from 'react-native';

export default function Chamas() {
  const groups = useMyGroups();
  const [code, setCode] = useState('');
  const join = useAct((c: string) => api<{ groupId: string; name: string }>('invitations/join-code', { body: { code: c } }), { onSuccess: (r) => { setCode(''); router.push(`/(app)/group/${r.groupId}`); } });
  return (
    <Screen refreshing={groups.isRefetching} onRefresh={groups.refetch}>
      {groups.error ? <ErrorView error={groups.error} onRetry={groups.refetch} /> : !groups.data ? <Loading /> : groups.data.length === 0 ? (
        <Empty title="No Chamas yet" body="Accept an invitation or join with a code from your group officer." icon="people-outline" />
      ) : (
        groups.data.map((g) => (
          <Pressable key={g.groupId} onPress={() => router.push(`/(app)/group/${g.groupId}`)} accessibilityRole="button" accessibilityLabel={`${g.name}, ${LABELS.groupRole[g.role]}`} style={({ pressed }) => [s.item, pressed && { backgroundColor: colors.slateTint }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flex: 1, marginRight: space.sm }}>
                <T variant="heading" numberOfLines={2}>{g.name}</T>
                <T variant="small">{LABELS.groupType[g.type]} · {g.memberCount} members</T>
              </View>
              <Badge label={LABELS.groupRole[g.role]} tone={g.role === 'MEMBER' ? 'neutral' : 'green'} />
            </View>
            <View style={s.facts}>
              <Fact label="Schedule" value={g.schedule ? `${kes(g.schedule.amountCents, true)} ${LABELS.frequency[g.schedule.frequency].toLowerCase()}` : '—'} />
              <Fact label="Next payment" value={date(g.nextDueDate)} />
              <Fact label="Outstanding" value={kes(g.outstandingCents, true)} danger={g.outstandingCents > 0} />
              {g.loanBalanceCents > 0 && <Fact label="Loan balance" value={kes(g.loanBalanceCents, true)} />}
              {g.nextPayoutDate && <Fact label="Your next payout" value={date(g.nextPayoutDate)} />}
            </View>
          </Pressable>
        ))
      )}
      <Section title="Join another Chama" style={{ marginTop: space.md }}>
        <View style={{ padding: space.lg }}>
          <Field label="Group code" placeholder="e.g. 7KQ2MXRP" autoCapitalize="characters" value={code} onChangeText={(t) => setCode(t.toUpperCase().replace(/[^A-Z0-9]/g, ''))} hint="Your chairperson or secretary can share the code." />
          <Button title="Join" onPress={() => join.mutate(code)} loading={join.isPending} disabled={code.length < 6} />
          <Button title="View invitations" variant="ghost" onPress={() => router.push('/(app)/invitations')} style={{ marginTop: space.sm }} />
        </View>
      </Section>
    </Screen>
  );
}

function Fact({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <View style={{ width: '50%', marginTop: space.sm }}>
      <T variant="small">{label}</T>
      <T variant="label" style={{ color: danger ? colors.error : colors.navy, fontVariant: ['tabular-nums'] }}>{value}</T>
    </View>
  );
}

const s = StyleSheet.create({
  item: { backgroundColor: colors.white, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, padding: space.lg, marginBottom: space.md },
  facts: { flexDirection: 'row', flexWrap: 'wrap', marginTop: space.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: space.xs },
});
