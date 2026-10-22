import type { Config } from 'tailwindcss';

/**
 * ChamaHub design tokens (same values as mobile/src/theme).
 * Rose is the brand accent; Berry fills buttons and colours links, because
 * white on Rose (3.6:1) is below the WCAG AA 4.5:1 minimum for text.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        rose: { DEFAULT: '#E84D8A', 50: '#FDF2F7', 100: '#FCE7F0', 200: '#F9CBDD', 600: '#D9407E' },
        blush: '#FCE7F0',
        berry: { DEFAULT: '#B83270', 700: '#9A2A5E' },
        plum: { DEFAULT: '#42213D', 600: '#57304F', 700: '#4A2645', 900: '#2E1529' },
        canvas: '#FFFAFC',
        muted: '#806B7B',
        line: '#F0DCE6',
        success: { DEFAULT: '#16845B', ink: '#0F6B49', 50: '#E7F5EE' },
        pending: { DEFAULT: '#D97706', ink: '#92400E', 50: '#FEF3C7' },
        // Text-safe amber (5:1 on white) for warnings written as text.
        warning: '#B45309',
        danger: { DEFAULT: '#DC3545', ink: '#A71D2A', 50: '#FDECEE' },
      },
      fontFamily: {
        sans: ['Satoshi', '"Inter Variable"', 'Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      fontSize: { '2xs': ['0.6875rem', '1rem'] },
      borderRadius: { md: '8px', lg: '12px', xl: '16px' },
      boxShadow: {
        card: '0 1px 2px rgba(66, 33, 61, 0.04), 0 4px 12px rgba(66, 33, 61, 0.04)',
        drawer: '-8px 0 24px rgba(66, 33, 61, 0.10)',
      },
    },
  },
  plugins: [],
};
export default config;
