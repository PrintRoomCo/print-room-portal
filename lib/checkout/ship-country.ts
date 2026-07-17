export interface ShipCountryLine {
  lineId: string
  fulfilmentType?: 'stocked' | 'made_to_order'
}

/**
 * The order's ship-to country, mirroring the server's single-shipping-address
 * resolution in submit.ts: the one-time address when EVERY line ships custom,
 * otherwise the first STOCKED line's store.
 *
 * Stocked-first, not cart-first: F1 submits the stocked partition as its own
 * stock_on_hand order, so a made-to-order line sitting first in the cart must
 * not decide that order's region. This drives the NZ picking-fee gate, so
 * /checkout, /checkout/review, the Xero draft and the Monday billing note all
 * have to agree on it — hence one shared function rather than a copy per page.
 *
 * Returns null when it cannot be determined (no stocked line, unknown store, or
 * a store with no country recorded). Null fails the NZ gate, so the fee is 0 —
 * under-charging a fee is recoverable; quoting a fee we cannot justify is not.
 */
export function resolveShipCountry(input: {
  lines: ShipCountryLine[]
  perLineShipTo: Record<string, string | null>
  customAddressCountry: string | null | undefined
  countryByStoreId: Map<string, string | null>
}): string | null {
  if (input.lines.length === 0) return null

  const allCustom = input.lines.every((line) => input.perLineShipTo[line.lineId] === null)
  if (allCustom) return input.customAddressCountry ?? null

  for (const line of input.lines) {
    if (line.fulfilmentType !== 'stocked') continue
    const storeId = input.perLineShipTo[line.lineId]
    if (!storeId) continue
    return input.countryByStoreId.get(storeId) ?? null
  }
  return null
}
