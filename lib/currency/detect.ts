import type { SupportedCurrency } from './types';

const LOCALE_CURRENCY_MAP: Record<string, SupportedCurrency> = {
  'en-AU': 'AUD',
  'en-US': 'USD',
  'en-GB': 'GBP',
};

const EUR_LANGUAGE_PREFIXES = ['de', 'fr', 'es', 'it', 'nl'];
const EUR_EXACT_LOCALES = ['pt-PT'];

export function detectCurrencyFromBrowser(): SupportedCurrency {
  if (typeof navigator === 'undefined') return 'NZD';

  const locale =
    (navigator.languages && navigator.languages[0]) || navigator.language || '';

  const exact = LOCALE_CURRENCY_MAP[locale];
  if (exact) return exact;

  if (EUR_EXACT_LOCALES.includes(locale)) return 'EUR';

  const langPrefix = locale.split('-')[0]?.toLowerCase();
  if (langPrefix && EUR_LANGUAGE_PREFIXES.includes(langPrefix)) return 'EUR';

  return 'NZD';
}
