import type { Config } from 'tailwindcss';

/** ChamaHub brand tokens. Keep the palette small and purposeful. */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        forest: { DEFAULT: '#14532D', 50: '#F0F7F2', 100: '#DCEFE2', 600: '#166534', 700: '#14532D', 800: '#0F3F22' },
        emerald: { DEFAULT: '#16A34A' },
        navy: { DEFAULT: '#172033', 700: '#243049' },
        canvas: '#F8FAFC',
        muted: '#64748B',
        line: '#E2E8F0',
        success: '#15803D',
        warning: '#D97706',
        danger: '#DC2626',
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      fontSize: { '2xs': ['0.6875rem', '1rem'] },
      borderRadius: { md: '6px', lg: '8px' },
      boxShadow: { drawer: '-8px 0 24px rgba(23, 32, 51, 0.08)' },
    },
  },
  plugins: [],
};
export default config;
