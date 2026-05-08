import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Mirror of the PDP-side recalcInputs gate from lib/shop/decorations.ts.
 * Recompute parity bug 2026-05-08: PDP snapshots screenprint via
 * calculate_screenprint_pricing_api (qty-aware); checkout was reading only
 * the static org_decorations.unit_price, so any qty ≠ tier-base tripped drift.
 *
 * Precedence matches PDP: for screenprint with all four recalc inputs the
 * qty-aware RPC wins. Override-or-base is the fallback when recalc inputs
 * are missing (embroidery, legacy rows) or the RPC errors.
 */
export interface DecorationPriceInput {
  decorationMethod: string
  unitPriceOverride: number | string | null
  baseUnitPrice: number | string
  widthMm: number | null
  heightMm: number | null
  colourCount: number | null
  placementKey: string | null
}

export async function effectiveDecorationPrice(
  admin: SupabaseClient,
  input: DecorationPriceInput,
  qty: number,
): Promise<number> {
  if (
    input.decorationMethod === 'screenprint' &&
    input.widthMm != null &&
    input.heightMm != null &&
    input.colourCount != null &&
    input.placementKey != null
  ) {
    const { data, error } = await admin.rpc('calculate_screenprint_pricing_api', {
      args: {
        qty,
        placements: [{ placement: input.placementKey, colors: input.colourCount }],
        currency: 'NZD',
      },
    })
    if (!error) {
      const row = Array.isArray(data) ? data[0] : data
      const unitPrice = (
        row as { per_placement_costs?: Array<{ unit_price?: number | string }> } | null
      )?.per_placement_costs?.[0]?.unit_price
      if (unitPrice != null) {
        const n = Number(unitPrice)
        if (Number.isFinite(n)) return n
      }
    }
  }

  return input.unitPriceOverride != null
    ? Number(input.unitPriceOverride)
    : Number(input.baseUnitPrice)
}
