import type { BillingMode } from '@/lib/shop/billing-mode'

/** Order needs invoicing iff ANY stocked (stock-on-hand) line is not-paid. */
export function orderNeedsInvoicing(
  lines: Array<{ stocked: boolean; billingMode: BillingMode }>,
): boolean {
  return lines.some((l) => l.stocked && l.billingMode === 'invoice_on_dispatch')
}
