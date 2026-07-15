import type { BillingMode } from './billing-mode'
type Fulfilment = 'stocked' | 'made_to_order' | 'mixed'

/** Customer "Pre-paid" indicator: prepaid tag AND the product can draw stock. */
export function showsPrepaidTag(fulfilment: Fulfilment, billingMode: BillingMode | null): boolean {
  if (billingMode !== 'prepaid') return false
  return fulfilment === 'stocked' || fulfilment === 'mixed'
}
