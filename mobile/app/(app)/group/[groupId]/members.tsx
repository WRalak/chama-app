import { Stack, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { formatKenyanPhone, LABELS, MemberRow, SPECIAL_ROLE_INFO } from '@chamahub/shared';
import { Badge, ErrorView, Field, Loading, Row, Screen, Section } from '@/components/ui';
import { api } from '@/lib/api';
import { kes } from '@/lib/format';

export default function Members() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const [q, setQ] = useState('');
  const list = useQuery({ queryKey: ['members', groupId], queryFn: () => api<MemberRow[]>(`groups/${groupId}/members`) });
  const rows = (list.data ?? []).filter((m) => m.fullName.toLowerCase().includes(q.toLowerCase()));
  return (
    <Screen refreshing={list.isRefetching} onRefresh={list.refetch}>
      <Stack.Screen options={{ title: `Members${list.data ? ` (${list.data.length})` : ''}` }} />
      <Field label="Search" value={q} onChangeText={setQ} placeholder="Name" />
      {list.error ? <ErrorView error={list.error} onRetry={list.refetch} /> : !list.data ? <Loading /> : (
        <Section>
          {rows.map((m, i) => (
            <Row
              key={m.membershipId}
              title={m.fullName}
              subtitle={[m.phone.startsWith('+') ? formatKenyanPhone(m.phone) : m.phone, ...m.specialRoles.map((r) => SPECIAL_ROLE_INFO[r].label), m.isFounder ? 'Founder' : ''].filter(Boolean).join(' · ')}
              right={m.financials ? kes(m.financials.contributedCents, true) : undefined}
              rightSub={<Badge label={m.specialRoles.length ? `${LABELS.groupRole[m.role]} +${m.specialRoles.length}` : LABELS.groupRole[m.role]} tone={m.role === 'MEMBER' ? 'neutral' : 'green'} />}
              last={i === rows.length - 1}
            />
          ))}
        </Section>
      )}
    </Screen>
  );
}
