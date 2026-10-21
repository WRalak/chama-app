import { Text, View } from 'react-native';
import { T } from './ui';
import { colors } from '@/theme';

/**
 * The ChamaHub mark: members (dots) around a shared pot (ring) on a forest
 * tile. Same geometry as the web dashboard's SVG (a 32-unit grid), drawn with
 * plain views so it needs no SVG library and scales to any size.
 */
export function BrandMark({ size = 52, tile = colors.forest }: { size?: number; tile?: string }) {
  const u = size / 32;
  const dot = (cx: number, cy: number, fill: string, ring?: string) => (
    <View
      style={{
        position: 'absolute',
        left: (cx - 2.6) * u - (ring ? 1.2 * u : 0),
        top: (cy - 2.6) * u - (ring ? 1.2 * u : 0),
        width: 5.2 * u + (ring ? 2.4 * u : 0),
        height: 5.2 * u + (ring ? 2.4 * u : 0),
        borderRadius: 4 * u,
        backgroundColor: fill,
        borderWidth: ring ? 1.2 * u : 0,
        borderColor: ring,
      }}
    />
  );
  return (
    <View style={{ width: size, height: size, borderRadius: 7 * u, backgroundColor: tile }} accessibilityElementsHidden importantForAccessibility="no">
      <View style={{ position: 'absolute', left: (16 - 8.5 - 1.1) * u, top: (16 - 8.5 - 1.1) * u, width: 19.2 * u, height: 19.2 * u, borderRadius: 9.6 * u, borderWidth: 2.2 * u, borderColor: colors.white }} />
      {dot(16, 7.5, colors.emerald, tile)}
      {dot(23.4, 20.3, colors.white)}
      {dot(8.6, 20.3, colors.white)}
    </View>
  );
}

/** "ChamaHub" with the mark, for welcome and splash-like screens. */
export function BrandLockup({ size = 64, tagline = true, light = false }: { size?: number; tagline?: boolean; light?: boolean }) {
  return (
    <View style={{ alignItems: 'center' }} accessible accessibilityRole="header" accessibilityLabel="ChamaHub">
      <BrandMark size={size} tile={light ? colors.white : colors.forest} />
      <Text style={{ marginTop: size * 0.22, fontSize: size * 0.44, fontWeight: '800', letterSpacing: -0.5, color: light ? colors.white : colors.navy }}>
        Chama<Text style={{ color: light ? '#86EFAC' : colors.emerald }}>Hub</Text>
      </Text>
      {tagline && <Text style={{ marginTop: 4, fontSize: 14, color: light ? '#D1FAE5' : colors.muted, textAlign: 'center' }}>Every Chama. Every Contribution. One Place.</Text>}
    </View>
  );
}

export function BrandHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={{ alignItems: 'center', marginTop: 24, marginBottom: 28 }}>
      <BrandMark size={56} />
      <T variant="title" style={{ marginTop: 14, textAlign: 'center' }} accessibilityRole="header">
        {title}
      </T>
      {subtitle && <T variant="small" style={{ marginTop: 4, textAlign: 'center' }}>{subtitle}</T>}
    </View>
  );
}
