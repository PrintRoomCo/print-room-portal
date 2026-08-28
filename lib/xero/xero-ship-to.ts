import type { CheckoutLineInput } from '@/lib/checkout/submit'

/**
 * Which store's Xero contact an order's draft invoice is made out to, or null
 * for the organisation's own contact (draft-invoice.ts already falls back to
 * the org when this is null).
 *
 * Split orders always invoice the ORG: the spec's decision is one invoice per
 * order, and no single destination store can speak for the others.
 *
 * Otherwise the store contact is used only when EVERY line agrees on the same
 * store — the behaviour location-manager and DOC orders rely on. A mixed or
 * custom-address order resolves to the org rather than silently adopting
 * whichever store happened to sort first.
 */
export function xeroShipToStoreId(input: {
  splitShipment: boolean
  lines: Array<Pick<CheckoutLineInput, 'ship_to_store_id'>>
}): string | null {
  if (input.splitShipment) return null
  if (input.lines.length === 0) return null

  const distinctStoreIds = new Set(input.lines.map((line) => line.ship_to_store_id ?? null))
  if (distinctStoreIds.size !== 1) return null

  const [onlyStoreId] = distinctStoreIds
  return onlyStoreId ?? null
}
