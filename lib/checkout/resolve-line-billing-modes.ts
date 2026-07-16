import type { SupabaseClient } from '@supabase/supabase-js'
import type { BillingMode } from '@/lib/shop/billing-mode'

/**
 * variant_id → billing class. variant_inventory is per (variant, size); a
 * variant counts as prepaid for billing if ANY of its size rows is prepaid
 * (the drawn portion is what gets zeroed downstream, gated by qty_from_stock).
 * Unknown/null → invoice_on_dispatch (conservative: bill the customer).
 */
export function buildBillingModeMap(
  rows: Array<{ variant_id: string; billing_mode: string | null }>,
): Map<string, BillingMode> {
  const out = new Map<string, BillingMode>()
  for (const r of rows) {
    const mode: BillingMode = r.billing_mode === 'prepaid' ? 'prepaid' : 'invoice_on_dispatch'
    if (mode === 'prepaid' || !out.has(r.variant_id)) out.set(r.variant_id, mode)
  }
  return out
}

/** Batch-read variant_inventory.billing_mode for an org's variants. */
export async function resolveLineBillingModes(
  admin: SupabaseClient,
  orgId: string,
  variantIds: string[],
): Promise<Map<string, BillingMode>> {
  if (variantIds.length === 0) return new Map()
  const { data } = await admin
    .from('variant_inventory')
    .select('variant_id, billing_mode')
    .eq('organization_id', orgId)
    .in('variant_id', variantIds)
  return buildBillingModeMap(
    (data ?? []) as Array<{ variant_id: string; billing_mode: string | null }>,
  )
}
