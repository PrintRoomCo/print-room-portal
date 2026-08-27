// Customer-facing copy for the $500 purchase-order minimum. One module so the
// cart banner, the checkout banner and the API error message cannot drift apart.
import { formatCurrency } from '@/lib/currency/format'
import type { MinimumOrderStatus } from '@/lib/checkout/minimum-order'

export const MINIMUM_ORDER_CONTACT_EMAIL = 'hello@theprint-room.co.nz'

export interface MinimumOrderCopy {
  /** The complete sentence. Use where a link cannot render (API message, aria-label). */
  sentence: string
  /** Everything before the CTA, so the CTA can be an inline <a>. Ends with ", or ". */
  lead: string
  ctaLabel: string
  mailto: string
}

/**
 * "$500.00 minimum" reads badly, "$379.50" must keep its cents. Whole amounts
 * drop the decimals; fractional amounts keep them. Guarded on Number.isInteger
 * rather than string-matching, so it is locale-safe.
 */
function money(amount: number, currency: string): string {
  const formatted = formatCurrency(amount, currency)
  return Number.isInteger(amount) ? formatted.replace(/[.,]00\b/, '') : formatted
}

export function minimumOrderCopy(
  status: MinimumOrderStatus,
  options: { tentative?: boolean } = {},
): MinimumOrderCopy {
  const threshold = money(status.threshold, status.currency)
  const value = money(status.value, status.currency)
  const shortfall = money(status.shortfall, status.currency)
  const lead = options.tentative
    ? `Made-to-order orders have a ${threshold} minimum (excl. GST). This order may be ` +
      `below the minimum at ${value} — add ${shortfall}, or `
    : `Made-to-order orders have a ${threshold} minimum (excl. GST). This order is ` +
      `${value} — add ${shortfall} to continue, or `
  const ctaLabel = 'talk to us about smaller runs'
  return {
    sentence: `${lead}${ctaLabel}.`,
    lead,
    ctaLabel,
    mailto:
      `mailto:${MINIMUM_ORDER_CONTACT_EMAIL}` +
      `?subject=${encodeURIComponent(`Order below ${threshold} minimum`)}`,
  }
}
