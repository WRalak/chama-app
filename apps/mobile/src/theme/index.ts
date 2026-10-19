import { Platform, TextStyle } from 'react-native';

/** ChamaHub brand tokens — the single source for colours, spacing and type on mobile. */
export const colors = {
  forest: '#14532D',
  emerald: '#16A34A',
  navy: '#172033',
  background: '#F8FAFC',
  white: '#FFFFFF',
  muted: '#64748B',
  border: '#E2E8F0',
  success: '#15803D',
  warning: '#D97706',
  error: '#DC2626',
  forestTint: '#F0F7F2',
  warningTint: '#FFFBEB',
  errorTint: '#FEF2F2',
  infoTint: '#F0F9FF',
  info: '#0369A1',
  slateTint: '#F1F5F9',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 6, md: 8, lg: 12 } as const;

const family = Platform.select({ ios: 'System', android: 'sans-serif', default: 'System' });
const medium = Platform.select({ ios: 'System', android: 'sans-serif-medium', default: 'System' });

export const type: Record<'title' | 'heading' | 'body' | 'label' | 'small' | 'tiny' | 'amount', TextStyle> = {
  title: { fontFamily: medium, fontSize: 22, lineHeight: 28, fontWeight: '700' as const, color: colors.navy },
  heading: { fontFamily: medium, fontSize: 17, lineHeight: 22, fontWeight: '600' as const, color: colors.navy },
  body: { fontFamily: family, fontSize: 15, lineHeight: 21, color: colors.navy },
  label: { fontFamily: medium, fontSize: 13, lineHeight: 18, fontWeight: '600' as const, color: colors.navy },
  small: { fontFamily: family, fontSize: 13, lineHeight: 18, color: colors.muted },
  tiny: { fontFamily: medium, fontSize: 11, lineHeight: 14, fontWeight: '600' as const, letterSpacing: 0.4, color: colors.muted },
  amount: { fontFamily: medium, fontSize: 26, lineHeight: 32, fontWeight: '700' as const, color: colors.navy, fontVariant: ['tabular-nums'] },
};

/** Minimum touch target (Android accessibility guidance is 48dp). */
export const TOUCH = 48;
