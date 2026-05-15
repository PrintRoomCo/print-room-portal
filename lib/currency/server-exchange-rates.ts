import { getSupabaseServer } from '@/lib/supabase';
import type { SupportedCurrency, ExchangeRates } from './types';

const FALLBACK_RATES: ExchangeRates = {
  NZD: 1,
  AUD: 0.92,
  USD: 0.61,
  GBP: 0.48,
  EUR: 0.56,
};

const STALE_THRESHOLD_MS = 36 * 60 * 60 * 1000; // 36 hours

export interface ServerExchangeRateResult {
  rate: number;
  source: 'database' | 'fallback';
  isStale: boolean;
  fetchedAt: string | null;
}

export interface ServerExchangeRatesResult {
  rates: ExchangeRates;
  source: 'database' | 'fallback';
  fetchedAt: string | null;
}

/**
 * Get server-side exchange rate for NZD -> target currency.
 * Falls back to hardcoded rates on DB failure instead of throwing.
 */
export async function getServerExchangeRate(
  targetCurrency: SupportedCurrency,
): Promise<ServerExchangeRateResult> {
  if (targetCurrency === 'NZD') {
    return { rate: 1, source: 'database', isStale: false, fetchedAt: null };
  }

  try {
    const supabase = getSupabaseServer();
    const { data: rateRow, error } = await supabase
      .from('exchange_rates')
      .select('rate, fetched_at')
      .eq('base_currency', 'NZD')
      .eq('target_currency', targetCurrency)
      .single();

    if (error || !rateRow) {
      console.warn(`[FX] DB lookup failed for NZD->${targetCurrency}, using fallback:`, error?.message);
      return {
        rate: FALLBACK_RATES[targetCurrency] ?? 1,
        source: 'fallback',
        isStale: false,
        fetchedAt: null,
      };
    }

    const fetchedAt = rateRow.fetched_at as string | null;
    const isStale = fetchedAt
      ? Date.now() - new Date(fetchedAt).getTime() > STALE_THRESHOLD_MS
      : true;

    if (isStale) {
      console.warn(`[FX] Rate for NZD->${targetCurrency} is stale (fetched: ${fetchedAt})`);
    }

    return {
      rate: Number(rateRow.rate),
      source: 'database',
      isStale,
      fetchedAt,
    };
  } catch (err) {
    console.error(`[FX] Unexpected error for NZD->${targetCurrency}:`, err);
    return {
      rate: FALLBACK_RATES[targetCurrency] ?? 1,
      source: 'fallback',
      isStale: false,
      fetchedAt: null,
    };
  }
}

export async function getServerExchangeRates(): Promise<ServerExchangeRatesResult> {
  try {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from('exchange_rates')
      .select('target_currency, rate, fetched_at')
      .eq('base_currency', 'NZD');

    if (error || !data || data.length === 0) {
      console.warn('[FX] DB lookup failed for NZD exchange rates, using fallback:', error?.message);
      return { rates: FALLBACK_RATES, source: 'fallback', fetchedAt: null };
    }

    const rates: ExchangeRates = { ...FALLBACK_RATES };
    let fetchedAt: string | null = null;
    for (const row of data) {
      const currency = row.target_currency as SupportedCurrency;
      if (currency in rates) {
        rates[currency] = Number(row.rate);
        fetchedAt = fetchedAt ?? (row.fetched_at as string | null);
      }
    }

    return { rates, source: 'database', fetchedAt };
  } catch (err) {
    console.error('[FX] Unexpected error for NZD exchange rates:', err);
    return { rates: FALLBACK_RATES, source: 'fallback', fetchedAt: null };
  }
}
