import { convertBetween } from '@/lib/currency/format'
import { isSupportedCurrency } from '@/lib/currency/detect'
import type { ExchangeRates, SupportedCurrency } from '@/lib/currency/types'
import type { CurrencyTotal } from '@/lib/pricing/order-billing-shape'

/**
 * Collapse per-billing-currency totals into one display-currency estimate for
 * the /checkout sticky bar. Billing surfaces never call this: /checkout/review
 * passes its exact totals straight through.
 *
 * Fail-safe: when rates are absent or any currency cannot be cross-rated, the
 * exact billing totals are returned unchanged rather than mislabelled.
 */
export function displayCurrencyTotals(
  totals: CurrencyTotal[],
  displayCurrency: SupportedCurrency,
  rates: ExchangeRates | null,
): CurrencyTotal[] {
  if (totals.length === 0 || !rates) return totals
  let sum = 0
  for (const { currency, total } of totals) {
    if (!isSupportedCurrency(currency)) return totals
    sum += convertBetween(total, currency, displayCurrency, rates)
  }
  return [{ currency: displayCurrency, total: sum }]
}
