import { Platform, StyleSheet, TextStyle } from 'react-native';
import { SATOSHI_AVAILABLE } from './fonts.generated';

/**
 * ChamaHub design tokens — the single source for colours, spacing and type on
 * mobile. Rose is the brand accent (selection, highlights, progress); Berry
 * carries white text on filled buttons because white on Rose (3.6:1) is below
 * the WCAG AA 4.5:1 minimum. Status colours always come with a text label and
 * an icon (see StatusBadge), never colour alone.
 */
export const colors = {
  rose: '#E84D8A',
  blush: '#FCE7F0',
  plum: '#42213D',
  berry: '#B83270',
  berryPressed: '#9A2A5E',
  background: '#FFFAFC',
  white: '#FFFFFF',
  text: '#42213D',
  muted: '#806B7B',
  placeholder: '#A8949F',
  border: '#F0DCE6',
  neutralTint: '#F8F0F4',
  success: '#16845B',
  successText: '#0F6B49',
  successTint: '#E7F5EE',
  pending: '#D97706',
  pendingText: '#92400E',
  pendingTint: '#FEF3C7',
  error: '#DC3545',
  errorText: '#A71D2A',
  errorTint: '#FDECEE',
  info: '#5C3A57',
  infoTint: '#F6EEF5',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

/** Restrained elevation for cards; flat on Android below the elevation level. */
export const shadow = Platform.select({
  ios: { shadowColor: '#42213D', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  android: { elevation: 1 },
  default: { shadowColor: '#42213D', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
});

const system = Platform.select({ ios: 'System', android: 'sans-serif', default: 'System' });
const systemMedium = Platform.select({ ios: 'System', android: 'sans-serif-medium', default: 'System' });

type Weight = '400' | '500' | '600' | '700' | '800';

/**
 * Font for a weight. Satoshi ships one file per weight, and Android ignores
 * fontWeight on custom fonts, so the weight selects the file. Without Satoshi
 * the system font and fontWeight are used.
 */
export function font(weight: Weight = '400'): TextStyle {
  const n = Number(weight);
  if (SATOSHI_AVAILABLE) return { fontFamily: n >= 600 ? 'Satoshi-Bold' : n >= 500 ? 'Satoshi-Medium' : 'Satoshi-Regular', fontWeight: 'normal' };
  return { fontFamily: n >= 500 ? systemMedium : system, fontWeight: weight };
}

/** Rewrites an inline fontWeight into the matching Satoshi file (no-op without Satoshi). */
export function withFont(style: TextStyle | undefined | null | false | (TextStyle | undefined | null | false)[]): TextStyle {
  const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  if (!SATOSHI_AVAILABLE || !flat.fontWeight || (flat.fontFamily && !flat.fontFamily.startsWith('Satoshi'))) return flat;
  return { ...flat, ...font(String(flat.fontWeight) as Weight) };
}

export const type: Record<'title' | 'heading' | 'body' | 'label' | 'small' | 'tiny' | 'amount', TextStyle> = {
  title: { ...font('700'), fontSize: 24, lineHeight: 30, color: colors.text, letterSpacing: -0.2 },
  heading: { ...font('700'), fontSize: 17, lineHeight: 23, color: colors.text },
  body: { ...font('400'), fontSize: 16, lineHeight: 22, color: colors.text },
  label: { ...font('600'), fontSize: 14, lineHeight: 19, color: colors.text },
  small: { ...font('400'), fontSize: 13, lineHeight: 18, color: colors.muted },
  tiny: { ...font('700'), fontSize: 11, lineHeight: 14, letterSpacing: 0.4, color: colors.muted },
  amount: { ...font('700'), fontSize: 28, lineHeight: 34, color: colors.text, fontVariant: ['tabular-nums'], letterSpacing: -0.3 },
};

/** Minimum touch target (Android accessibility guidance is 48dp). */
export const TOUCH = 48;
