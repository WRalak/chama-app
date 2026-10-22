/**
 * Localisation. Every app string that has moved into a catalogue is looked up with `t()`;
 * a missing key falls back to English, then to the key itself, so a partial translation
 * never breaks a screen. To add a language: add its code to LOCALES and a catalogue below.
 * Swahili strings should be reviewed by a native speaker before launch in Tanzania.
 */

export const LOCALES = {
  en: { code: 'en', name: 'English', nativeName: 'English' },
  sw: { code: 'sw', name: 'Swahili', nativeName: 'Kiswahili' },
} as const;
export type Locale = keyof typeof LOCALES;
export const LOCALE_CODES = Object.keys(LOCALES) as [Locale, ...Locale[]];

const en = {
  'nav.home': 'My home',
  'nav.finances': 'My finances',
  'nav.groups': 'Groups',
  'nav.notifications': 'Notifications',
  'nav.profile': 'Profile',
  'nav.overview': 'Overview',
  'nav.myAccount': 'My account',
  'nav.myContributions': 'My contributions',
  'nav.myLoans': 'My loans',
  'nav.statements': 'Group statements',
  'nav.members': 'Members',
  'nav.contributions': 'Contributions',
  'nav.reconciliation': 'Reconciliation',
  'nav.payouts': 'Payouts',
  'nav.loans': 'Loans',
  'nav.expenses': 'Expenses',
  'nav.reports': 'Reports',
  'nav.audit': 'Audit Logs',
  'nav.settings': 'Settings',
  'nav.billing': 'Plan & billing',
  'nav.platform': 'Platform administration',
  'tab.home': 'Home',
  'tab.chamas': 'My Chamas',
  'tab.finances': 'Finances',
  'tab.activity': 'Activity',
  'tab.profile': 'Profile',
  'common.signOut': 'Sign out',
  'common.language': 'Language',
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'status.CONFIRMED': 'Confirmed',
  'status.PENDING': 'Awaiting verification',
  'status.FAILED': 'Failed',
  'status.REVERSED': 'Reversed',
  'status.DISPUTED': 'Disputed',
  'status.PAID': 'Paid',
  'status.OVERDUE': 'Overdue',
  'status.DUE': 'Due',
  'status.UPCOMING': 'Upcoming',
  'billing.upgradeTitle': 'Available on {plan}',
  'billing.upgradeBody': '{feature} is part of the {plan} plan. Your records stay available on every plan.',
} as const;

export type MessageKey = keyof typeof en;

const sw: Partial<Record<MessageKey, string>> = {
  'nav.home': 'Nyumbani',
  'nav.finances': 'Fedha zangu',
  'nav.groups': 'Vikundi',
  'nav.notifications': 'Arifa',
  'nav.profile': 'Wasifu',
  'nav.overview': 'Muhtasari',
  'nav.myAccount': 'Akaunti yangu',
  'nav.myContributions': 'Michango yangu',
  'nav.myLoans': 'Mikopo yangu',
  'nav.statements': 'Taarifa za kikundi',
  'nav.members': 'Wanachama',
  'nav.contributions': 'Michango',
  'nav.reconciliation': 'Ulinganishaji',
  'nav.payouts': 'Malipo ya mzunguko',
  'nav.loans': 'Mikopo',
  'nav.expenses': 'Matumizi',
  'nav.reports': 'Ripoti',
  'nav.audit': 'Kumbukumbu za ukaguzi',
  'nav.settings': 'Mipangilio',
  'nav.billing': 'Mpango na malipo',
  'nav.platform': 'Usimamizi wa jukwaa',
  'tab.home': 'Nyumbani',
  'tab.chamas': 'Chama zangu',
  'tab.finances': 'Fedha',
  'tab.activity': 'Shughuli',
  'tab.profile': 'Wasifu',
  'common.signOut': 'Toka',
  'common.language': 'Lugha',
  'common.save': 'Hifadhi',
  'common.cancel': 'Ghairi',
  'status.CONFIRMED': 'Imethibitishwa',
  'status.PENDING': 'Inasubiri uthibitisho',
  'status.FAILED': 'Imeshindikana',
  'status.REVERSED': 'Imerejeshwa',
  'status.DISPUTED': 'Inabishaniwa',
  'status.PAID': 'Imelipwa',
  'status.OVERDUE': 'Imechelewa',
  'status.DUE': 'Inadaiwa',
  'status.UPCOMING': 'Inakuja',
  'billing.upgradeTitle': 'Inapatikana kwenye {plan}',
  'billing.upgradeBody': '{feature} ni sehemu ya mpango wa {plan}. Kumbukumbu zenu zinapatikana kwenye kila mpango.',
};

const CATALOGUES: Record<Locale, Partial<Record<MessageKey, string>>> = { en, sw };

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && v in LOCALES;
}

/** Picks the best supported locale from "sw-KE", "en-US", … falling back to English. */
export function normaliseLocale(v: string | null | undefined): Locale {
  const base = (v ?? '').toLowerCase().split(/[-_]/)[0];
  return isLocale(base) ? base : 'en';
}

export function t(locale: string | null | undefined, key: MessageKey | string, vars?: Record<string, string | number>): string {
  const l = normaliseLocale(locale);
  const msg = (CATALOGUES[l] as Record<string, string | undefined>)[key] ?? (en as Record<string, string>)[key] ?? key;
  return vars ? msg.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`)) : msg;
}

/** Keys an existing catalogue has not translated yet (for translators and tests). */
export function missingTranslations(locale: Locale): MessageKey[] {
  return (Object.keys(en) as MessageKey[]).filter((k) => !(k in CATALOGUES[locale]));
}
