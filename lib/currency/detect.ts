import type { SupportedCurrency } from './types';
import { SUPPORTED_CURRENCIES } from './types';

export function isSupportedCurrency(value: string | null | undefined): value is SupportedCurrency {
  return !!value && (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

// ISO 3166-1 alpha-2 country code -> display currency. Driven by the visitor's
// physical location (e.g. Vercel's `x-vercel-ip-country` header) so the currency
// is accurate to where they're viewing from, not their browser language.
const COUNTRY_CURRENCY_MAP: Record<string, SupportedCurrency> = {
  NZ: 'NZD',
  AU: 'AUD',
  US: 'USD',
  GB: 'GBP',
  // Eurozone members
  AT: 'EUR', BE: 'EUR', HR: 'EUR', CY: 'EUR', EE: 'EUR', FI: 'EUR',
  FR: 'EUR', DE: 'EUR', GR: 'EUR', IE: 'EUR', IT: 'EUR', LV: 'EUR',
  LT: 'EUR', LU: 'EUR', MT: 'EUR', NL: 'EUR', PT: 'EUR', SK: 'EUR',
  SI: 'EUR', ES: 'EUR',
};

/**
 * Map a visitor's country code to a display currency, defaulting to NZD for
 * unknown countries and when the country is unavailable (local dev, bots,
 * regions we don't price).
 */
export function currencyForCountry(country: string | null | undefined): SupportedCurrency {
  if (!country) return 'NZD';
  return COUNTRY_CURRENCY_MAP[country.toUpperCase()] ?? 'NZD';
}

/**
 * Resolve the currency a visitor should land on, in priority order:
 *   1. their saved preference (if valid)
 *   2. the geo-detected country
 *   3. NZD (default)
 */
export function resolveCurrency({
  saved,
  country,
}: {
  saved: string | null | undefined;
  country: string | null | undefined;
}): SupportedCurrency {
  if (isSupportedCurrency(saved)) return saved;
  return currencyForCountry(country);
}

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
