/**
 * Pricing visibility — only `catalogue` is supported. After the global
 * B2B fallback removal (2026-05-05), every B2B-active org has an active
 * catalogue or shows the empty state.
 */
export type PricingMode = 'catalogue'

export interface PricingContext {
  pricingMode: PricingMode
  tierLabel: string | null      // 'Wholesale' | 'Trade' | 'Standard' | null
  tierDiscount: number          // always 0 in catalogue mode; kept on the shape so existing callers still typecheck
}

export interface LineBreakdown {
  qty: number
  unitEffective: number    // catalogue unit price
  unitGross: number        // == unitEffective in catalogue mode
  decorationPerUnit: number
  lineGross: number        // qty × (unitGross + decorationPerUnit)
  lineDiscount: number     // always 0 in catalogue mode
  lineNet: number          // lineGross - lineDiscount  (== qty × (unitEffective + decorationPerUnit))
}

export interface OrderBreakdown {
  lines: LineBreakdown[]
  grossSubtotal: number    // sum(lineGross)
  decorationTotal: number  // sum(qty × decorationPerUnit)
  discountAmount: number   // always 0 in catalogue mode
  netSubtotal: number      // grossSubtotal - discountAmount
  pickingFee: number       // separate NZ picking-fee line; 0 when no fee applies
  gstRate: number          // 0.15 for NZ
  gst: number              // round2((netSubtotal + pickingFee) × gstRate)
  total: number            // netSubtotal + pickingFee + gst
}
