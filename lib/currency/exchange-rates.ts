import { getSupabaseBrowser } from '@/lib/supabase-browser';
import type { SupportedCurrency, ExchangeRates } from './types';

const FALLBACK_RATES: ExchangeRates = {
  NZD: 1,
  AUD: 0.92,
  USD: 0.61,
  GBP: 0.48,
  EUR: 0.56,
};

const CACHE_TTL_MS = 3_600_000; // 1 hour

let cached: { rates: ExchangeRates; ts: number } | null = null;

export async function fetchExchangeRates(): Promise<ExchangeRates> {
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.rates;
  }

  try {
    const supabase = getSupabaseBrowser();
    const { data, error } = await supabase
      .from('exchange_rates')
      .select('target_currency, rate')
      .eq('base_currency', 'NZD');

    if (error || !data || data.length === 0) {
      return FALLBACK_RATES;
    }

    const rates: ExchangeRates = { ...FALLBACK_RATES };
    for (const row of data) {
      const currency = row.target_currency as SupportedCurrency;
      if (currency in rates) {
        rates[currency] = Number(row.rate);
      }
    }

    cached = { rates, ts: Date.now() };
    return rates;
  } catch {
    return FALLBACK_RATES;
  }
}
