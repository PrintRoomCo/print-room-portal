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

export function convertNZD(
  nzdAmount: number,
  currency: SupportedCurrency,
  rates: ExchangeRates,
): number {
  return nzdAmount * (rates[currency] ?? 1);
}
