import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Checkout-side drift guard. Mirrors the PDP/cart path so the price the
 * customer sees in cart matches what we recompute server-side at submit.
 *
 * Resolution (must match /api/shop/decoration-pricing):
 *   1. effective_decoration_unit_price(org_decoration_id, qty) RPC
 *        - includes decoration_price_overrides + engine rate
 *   2. fall back to b2b_catalogue_item_decorations.unit_price_override
 *      (per-link AM override) when the RPC returns NULL
 *   3. fall back to org_decorations.unit_price (flat)
 *   4. apply tier multiplier (with per-org override) — same multiplier the
 *      API applies before returning to the PDP. Math is identical to
 *      discounting the (garment + decoration) sum.
 */
export interface DecorationPriceInput {
  orgDecorationId: string
  organizationId: string
  /** org_decorations.decoration_method (server-authoritative). Embroidery is not
   *  priced through the qty-fed engine ladder — see effectiveDecorationPrice. */
  method: string
  unitPriceOverride: number | string | null
  baseUnitPrice: number | string
}

export async function loadTierMultiplier(admin: SupabaseClient, organizationId: string): Promise<number> {
  const { data } = await admin
    .from('b2b_accounts')
    .select('tier_discount_override, customer_pricing_tiers!inner(multiplier)')
    .eq('organization_id', organizationId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data) return 1
  if (data.tier_discount_override != null) return Number(data.tier_discount_override)
  const tier = Array.isArray(data.customer_pricing_tiers)
    ? data.customer_pricing_tiers[0]
    : data.customer_pricing_tiers
  return Number((tier as { multiplier?: number | string } | null)?.multiplier ?? 1)
}

export async function effectiveDecorationPrice(
  admin: SupabaseClient,
  input: DecorationPriceInput,
  qty: number,
  /**
   * Pre-resolved org tier multiplier. The multiplier depends only on the
   * organization, so callers pricing many decorations (checkout) resolve it
   * once and pass it in; when absent it is loaded per call (legacy behaviour).
   */
  tierMultiplier?: number,
): Promise<number> {
  // Embroidery is NOT priced through the qty-fed engine ladder. The RPC's
  // embroidery branch calls pick_embroidery_unit(family, qty), which expects the
  // second arg to be thousands-of-stitches, not the order quantity — so it
  // returns a meaningless ~$1/garment. The PDP never fetches embroidery either
  // (recalcInputs is screenprint-only), so the cart carries the RAW static
  // override/base with no tier multiplier applied. Mirror that exactly here:
  // resolve to the static override/base, no RPC, no multiplier — otherwise the
  // client's $14 vs the server's ~$1 (or 14×tier) trips the zero-tolerance drift
  // guard and blocks checkout on every embroidery line.
  if (input.method === 'embroidery') {
    const staticBase =
      input.unitPriceOverride != null
        ? Number(input.unitPriceOverride)
        : Number(input.baseUnitPrice)
    return Number(staticBase.toFixed(2))
  }

  const { data, error } = await admin.rpc('effective_decoration_unit_price', {
    p_org_decoration_id: input.orgDecorationId,
    p_qty: qty,
  })

  let base: number
  if (!error && data != null) {
    const n = Number(data)
    base = Number.isFinite(n) ? n : Number(input.baseUnitPrice)
  } else if (input.unitPriceOverride != null) {
    base = Number(input.unitPriceOverride)
  } else {
    base = Number(input.baseUnitPrice)
  }

  const tierMult = tierMultiplier ?? (await loadTierMultiplier(admin, input.organizationId))
  return Number((base * tierMult).toFixed(2))
}
