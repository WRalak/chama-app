import { View } from 'react-native';
import { T } from './ui';
import { colors } from '@/theme';

export function BrandHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={{ alignItems: 'center', marginTop: 24, marginBottom: 28 }}>
      <View style={{ width: 52, height: 52, borderRadius: 12, backgroundColor: colors.forest, alignItems: 'center', justifyContent: 'center' }} accessibilityElementsHidden importantForAccessibility="no">
        <View style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 3, borderColor: colors.white }} />
        <View style={{ position: 'absolute', top: 9, width: 10, height: 10, borderRadius: 5, backgroundColor: colors.emerald }} />
      </View>
      <T variant="title" style={{ marginTop: 14, textAlign: 'center' }} accessibilityRole="header">
        {title}
      </T>
      {subtitle && <T variant="small" style={{ marginTop: 4, textAlign: 'center' }}>{subtitle}</T>}
    </View>
  );
}
