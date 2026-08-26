import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Checkout-side drift guard. Mirrors the PDP/cart path so the price the
 * customer sees in cart matches what we recompute server-side at submit.
 *
 * Resolution (must match /api/shop/decoration-pricing):
 *   1. effective_decoration_unit_price(org_decoration_id, qty) RPC
 *        - screenprint: qty-fed engine ladder
 *        - embroidery: stitch-count ladder (qty-independent). NULL when the
 *          decoration has no stitch_count and no usable dimensions — that soft
 *          gate is why the PDP marks such decorations pricing-pending and
 *          blocks add-to-cart on computed items.
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
  unitPriceOverride: number | string | null
  baseUnitPrice: number | string
}

export interface DecorationPriceOptions {
  countryPartitionEnabled: boolean
  targetCurrency: string
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

export function effectiveDecorationPrice(
  admin: SupabaseClient,
  input: DecorationPriceInput,
  qty: number,
  /**
   * Pre-resolved org tier multiplier. The multiplier depends only on the
   * organization, so callers pricing many decorations (checkout) resolve it
   * once and pass it in; when absent it is loaded per call (legacy behaviour).
   */
  tierMultiplier?: number,
): Promise<number>
export function effectiveDecorationPrice(
  admin: SupabaseClient,
  input: DecorationPriceInput,
  qty: number,
  tierMultiplier: number | undefined,
  options: DecorationPriceOptions,
): Promise<number | null>
export async function effectiveDecorationPrice(
  admin: SupabaseClient,
  input: DecorationPriceInput,
  qty: number,
  tierMultiplier?: number,
  options?: DecorationPriceOptions,
): Promise<number | null> {
  const countryPartitionEnabled = options?.countryPartitionEnabled === true
  const { data, error } = countryPartitionEnabled
    ? await admin.rpc('effective_decoration_unit_price_for_currency', {
        p_org_decoration_id: input.orgDecorationId,
        p_qty: qty,
        p_currency: options.targetCurrency,
      })
    : await admin.rpc('effective_decoration_unit_price', {
        p_org_decoration_id: input.orgDecorationId,
        p_qty: qty,
      })

  if (countryPartitionEnabled && (error || data == null || !Number.isFinite(Number(data)))) {
    // The $0 'custom' placeholder is attached catalogue-wide and never pools
    // (`lib/pricing/decoration-pooling.ts`), so it has no ladder and no engine
    // branch — the RPC returns NULL for it in every currency, its own included.
    // Failing that as "no price in this country" is what surfaced to customers
    // as "<product> is not orderable to NZ yet" on a fully-configured NZ
    // catalogue. Zero has no exchange rate, so a flat $0 decoration is $0
    // anywhere: restore exactly that fallback and nothing wider. A NON-zero flat
    // price still fails — being billed as another currency is the hole the
    // country partition exists to close.
    const flat = Number(input.unitPriceOverride ?? input.baseUnitPrice)
    if (!error && Number.isFinite(flat) && flat === 0) return 0
    return null
  }

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
