import type { SupportedCurrency, ExchangeRates } from './types';

const LOCALE_MAP: Record<SupportedCurrency, string> = {
  NZD: 'en-NZ',
  AUD: 'en-AU',
  USD: 'en-US',
  GBP: 'en-GB',
  EUR: 'de-DE',
};

export function formatCurrency(amount: number, currency: string): string {
  const locale = LOCALE_MAP[currency as SupportedCurrency] || 'en-NZ';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(amount);
}

export function convertBetween(
  amount: number,
  from: SupportedCurrency,
  to: SupportedCurrency,
  rates: ExchangeRates,
): number {
  if (from === to) return amount;
  const fromRate = rates[from];
  const toRate = rates[to];
  // Fail-safe, matching fetchExchangeRates's posture: a missing or zero rate
  // renders the figure unconverted rather than as Infinity or NaN.
  if (!fromRate || !toRate) return amount;
  return amount * (toRate / fromRate);
}
