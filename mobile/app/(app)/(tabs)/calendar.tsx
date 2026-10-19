import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { addDays, CalendarEntry, MONTHS, todayInNairobi } from '@chamahub/shared';
import { Chips, Empty, ErrorView, Loading, Row, Screen, Section, StatusBadge, T } from '@/components/ui';
import { api } from '@/lib/api';
import { kes, relativeDay } from '@/lib/format';
import { useMyGroups } from '@/lib/queries';
import { space } from '@/theme';

const KIND_ICON = { CONTRIBUTION: 'wallet-outline', LOAN_INSTALLMENT: 'cash-outline', PAYOUT: 'gift-outline', MEETING: 'calendar-outline' } as const;
const RANGES = { '30': 30, '90': 90, past: -60 } as const;

export default function Calendar() {
  const groups = useMyGroups();
  const [groupId, setGroupId] = useState('all');
  const [range, setRange] = useState<keyof typeof RANGES>('30');
  const t = todayInNairobi();
  const days = RANGES[range];
  const from = days < 0 ? addDays(t, days) : addDays(t, -3);
  const to = days < 0 ? t : addDays(t, days);
  const cal = useQuery({ queryKey: ['calendar', groupId, from, to], queryFn: () => api<CalendarEntry[]>('me/calendar', { query: { from, to, groupId: groupId === 'all' ? undefined : groupId } }) });
  const byMonth = useMemo(() => {
    const m = new Map<string, CalendarEntry[]>();
    for (const e of (cal.data ?? []).slice().sort((a, b) => (days < 0 ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)))) {
      const k = e.date.slice(0, 7);
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    return [...m.entries()];
  }, [cal.data, days]);
  return (
    <Screen refreshing={cal.isRefetching} onRefresh={cal.refetch}>
      <Chips value={groupId} onChange={setGroupId} options={[{ value: 'all', label: 'All Chamas' }, ...(groups.data ?? []).map((g) => ({ value: g.groupId, label: g.name }))]} />
      <Chips value={range} onChange={setRange} options={[{ value: '30', label: 'Next 30 days' }, { value: '90', label: 'Next 90 days' }, { value: 'past', label: 'Past 60 days' }]} />
      {cal.error ? <ErrorView error={cal.error} onRetry={cal.refetch} /> : !cal.data ? <Loading /> : byMonth.length === 0 ? <Empty title="Nothing scheduled" icon="calendar-clear-outline" /> : (
        byMonth.map(([month, entries]) => (
          <Section key={month} title={`${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`}>
            {entries.map((e, i) => (
              <Row
                key={`${e.kind}-${e.id}`}
                icon={KIND_ICON[e.kind]}
                title={e.title}
                subtitle={`${e.groupName} · ${relativeDay(e.date)} (${Number(e.date.slice(8))} ${MONTHS[Number(e.date.slice(5, 7)) - 1]})`}
                right={e.amountCents !== null ? kes(e.amountCents) : undefined}
                rightSub={<StatusBadge status={e.status} />}
                onPress={() => router.push(e.kind === 'MEETING' ? `/(app)/group/${e.groupId}/meetings` : e.kind === 'PAYOUT' ? `/(app)/group/${e.groupId}/rotation` : e.kind === 'LOAN_INSTALLMENT' ? `/(app)/group/${e.groupId}/loans` : `/(app)/group/${e.groupId}/contributions`)}
                last={i === entries.length - 1}
              />
            ))}
          </Section>
        ))
      )}
      <View style={{ height: space.lg }} />
      <T variant="small" style={{ textAlign: 'center' }}>Reminders are sent by SMS three days before each due date when SMS is enabled in Profile → Notifications.</T>
    </Screen>
  );
}
