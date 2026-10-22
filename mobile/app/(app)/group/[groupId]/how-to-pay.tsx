import { router, Stack } from 'expo-router';
import { DestinationCard } from '@/components/destination';
import { Button, Empty, ErrorView, Loading, Notice, Screen, Section } from '@/components/ui';
import { useDestinations } from '@/lib/collections';
import { useGroupAccess } from '@/lib/group';
import { shareSummary } from '@/lib/share';
import { space } from '@/theme';

/** Where to send money to the group, as approved by its officers. */
export default function HowToPay() {
  const { groupId } = useGroupAccess();
  const q = useDestinations(groupId);
  const live = (q.data ?? []).filter((d) => d.validNow);
  const old = (q.data ?? []).filter((d) => d.status === 'RETIRED');
  return (
    <Screen refreshing={q.isRefetching} onRefresh={q.refetch}>
      <Stack.Screen options={{ title: 'How to pay' }} />
      <Notice tone="blue" icon="shield-checkmark-outline">Only pay to details shown here. Any change must be approved by another officer and is announced in the app. Never share your M-Pesa PIN with anyone, including officers.</Notice>
      {q.error ? <ErrorView error={q.error} onRetry={q.refetch} /> : !q.data ? <Loading /> : (
        <>
          <Section title="Pay to">
            {live.length === 0 ? <Empty title="No payment details yet" body="Your officers have not set up where to pay. Ask your treasurer." icon="wallet-outline" /> : live.map((d, i) => <DestinationCard key={d.id} d={d} last={i === live.length - 1} />)}
          </Section>
          {live.length > 0 && (
            <>
              <Button title="I have paid — report it" icon="checkmark-circle-outline" onPress={() => router.push(`/(app)/group/${groupId}/pay`)} style={{ marginBottom: space.sm }} />
              <Button title="Share on WhatsApp" variant="secondary" icon="logo-whatsapp" onPress={() => shareSummary(`groups/${groupId}/share/how-to-pay`)} style={{ marginBottom: space.lg }} />
            </>
          )}
          {old.length > 0 && <Section title="No longer valid — do not pay here">{old.map((d, i) => <DestinationCard key={d.id} d={d} last={i === old.length - 1} />)}</Section>}
        </>
      )}
    </Screen>
  );
}
