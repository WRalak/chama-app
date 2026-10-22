import { Ionicons } from '@expo/vector-icons';
import { Pressable, View } from 'react-native';
import { T } from './ui';
import { colors, space } from '@/theme';

/** A payout order the officer rearranges with up/down buttons (works with large text and screen readers). */
export function OrderList({ order, names, onChange, perRound = 1, firstRound = 1 }: { order: string[]; names: Map<string, string>; onChange: (o: string[]) => void; perRound?: number; firstRound?: number }) {
  const move = (i: number, d: -1 | 1) => {
    const next = [...order];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };
  return (
    <View style={{ backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.border, marginBottom: space.lg }}>
      {order.map((id, i) => (
        <View key={id} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: space.md, borderBottomWidth: i === order.length - 1 ? 0 : 1, borderBottomColor: colors.border }}>
          <T variant="small" style={{ width: 64 }}>{`Round ${firstRound + Math.floor(i / perRound)}`}</T>
          <T variant="body" style={{ flex: 1 }}>{names.get(id) ?? id}</T>
          <Pressable onPress={() => move(i, -1)} disabled={i === 0} accessibilityRole="button" accessibilityLabel={`Move ${names.get(id)} earlier`} hitSlop={6} style={{ padding: 10, opacity: i === 0 ? 0.3 : 1 }}>
            <Ionicons name="arrow-up" size={20} color={colors.berry} />
          </Pressable>
          <Pressable onPress={() => move(i, 1)} disabled={i === order.length - 1} accessibilityRole="button" accessibilityLabel={`Move ${names.get(id)} later`} hitSlop={6} style={{ padding: 10, opacity: i === order.length - 1 ? 0.3 : 1 }}>
            <Ionicons name="arrow-down" size={20} color={colors.berry} />
          </Pressable>
        </View>
      ))}
    </View>
  );
}
