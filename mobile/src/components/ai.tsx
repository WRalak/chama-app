import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import type { AiCard, AiLink } from '@chamahub/shared';
import { Badge, Button, KV, T } from './ui';
import { dateTime } from '@/lib/format';
import { copy, shareToWhatsApp } from '@/lib/share';
import { colors, radius, space } from '@/theme';

const PATH: Record<AiLink['target'], (id?: string) => string> = {
  payment: (id) => `payments/${id}`,
  loan: (id) => `loans/${id}`,
  'my-contributions': () => 'contributions',
  contributions: () => 'manage/contributions',
  rotation: () => 'rotation',
  payouts: () => 'manage/payouts',
  meeting: (id) => `meetings/${id}`,
  'statement-import': () => 'manage/statements',
  reports: () => 'manage/reports',
  'how-to-pay': () => 'how-to-pay',
  destinations: () => 'manage/destinations',
};

/**
 * Figures read from ChamaHub's records by a server tool. Marked as verified
 * records (or as a draft to review), apart from anything the AI wrote.
 */
export function AiCardView({ card, groupId }: { card: AiCard; groupId: string }) {
  const draft = card.kind === 'DRAFT';
  return (
    <View style={{ backgroundColor: colors.white, borderRadius: radius.lg, borderWidth: 1, borderColor: draft ? '#FCD34D' : colors.border, padding: space.md, marginTop: space.sm }} accessibilityRole="summary">
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: space.sm }}>
        <T variant="label" style={{ flex: 1 }}>{card.title}</T>
        <Badge label={draft ? 'Draft — review' : 'From records'} tone={draft ? 'amber' : 'green'} />
      </View>
      <T variant="small" style={{ marginBottom: space.xs }}>{`${card.period ? `Period ${card.period.from} – ${card.period.to} · ` : ''}read ${dateTime(card.asOf)}`}</T>
      {card.facts.map((f, i) => <KV key={`${f.label}${i}`} label={f.label} value={f.value} last={i === card.facts.length - 1 && !card.table} />)}
      {card.table && card.table.rows.length > 0 && (
        <ScrollView horizontal style={{ marginTop: space.sm }} accessibilityLabel={`${card.title} table`}>
          <View>
            <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border }}>
              {card.table.columns.map((c) => <T key={c} variant="small" style={{ width: 120, fontWeight: '700', paddingVertical: 4 }}>{c}</T>)}
            </View>
            {card.table.rows.map((r, i) => (
              <View key={i} style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.slateTint }}>
                {r.map((c, j) => <T key={j} variant="small" style={{ width: 120, paddingVertical: 4, color: colors.navy }}>{c}</T>)}
              </View>
            ))}
          </View>
        </ScrollView>
      )}
      {card.table?.truncated && <T variant="small">Showing the first rows only.</T>}
      {card.text ? <T variant="body" style={{ marginTop: space.sm, backgroundColor: colors.slateTint, padding: space.sm, borderRadius: radius.sm }}>{card.text}</T> : null}
      {card.notes.filter(Boolean).map((n) => <T key={n} variant="small" style={{ marginTop: 4 }}>{n}</T>)}
      {card.text && draft && (
        <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
          <Button title="Copy" variant="secondary" icon="copy-outline" onPress={() => copy(card.text!, 'Copied')} style={{ flex: 1 }} />
          <Button title="WhatsApp" variant="secondary" icon="logo-whatsapp" onPress={() => shareToWhatsApp(card.text!)} style={{ flex: 1 }} />
        </View>
      )}
      {card.links.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginTop: space.sm }}>
          {card.links.map((l, i) => (
            <Pressable key={`${l.target}${l.id ?? ''}${i}`} accessibilityRole="link" hitSlop={6} onPress={() => router.push(`/(app)/group/${groupId}/${PATH[l.target](l.id)}` as never)}>
              <T variant="small" style={{ color: colors.forest, fontWeight: '600' }}>{`${l.label} ›`}</T>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}
