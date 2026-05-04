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
