/**
 * Pricing visibility types — WS4.
 *
 * `tiered`   = org has tier_level + price_tiers.discount, no active catalogue.
 *              effective_unit_price applies the discount; UI shows base → tier discount line → total.
 * `catalogue`= org has an active catalogue. effective_unit_price returns the catalogue price absolute,
 *              no tier discount applied. UI shows "Catalogue pricing" badge, no fake discount line.
 * `standard` = no b2b_account or tier_level=null. UI shows no badge, no discount line.
 */
export type PricingMode = 'tiered' | 'catalogue' | 'standard'

export interface PricingContext {
  pricingMode: PricingMode
  tierLabel: string | null      // 'Wholesale' | 'Trade' | 'Standard' | null
  tierDiscount: number          // 0 for catalogue/standard, fractional otherwise (0.10 = 10%)
}

export interface LineBreakdown {
  qty: number
  unitEffective: number    // post-discount unit price as returned by effective_unit_price
  unitGross: number        // pre-discount unit price (= effective when catalogue/standard)
  decorationPerUnit: number
  lineGross: number        // qty × (unitGross + decorationPerUnit)
  lineDiscount: number     // qty × (unitGross - unitEffective). 0 in catalogue/standard mode.
  lineNet: number          // lineGross - lineDiscount  (== qty × (unitEffective + decorationPerUnit))
}

export interface OrderBreakdown {
  lines: LineBreakdown[]
  grossSubtotal: number    // sum(lineGross)
  decorationTotal: number  // sum(qty × decorationPerUnit)
  discountAmount: number   // sum(lineDiscount)
  netSubtotal: number      // grossSubtotal - discountAmount  (== sum(lineNet))
  gstRate: number          // 0.15 for NZ
  gst: number              // round2(netSubtotal × gstRate)
  total: number            // netSubtotal + gst
}
