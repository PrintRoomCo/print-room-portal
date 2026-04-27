import type { SupabaseClient } from '@supabase/supabase-js'

export async function effectiveUnitPrice(
  admin: SupabaseClient,
  productId: string,
  orgId: string,
  qty: number,
): Promise<number> {
  const { data } = await admin.rpc('effective_unit_price', {
    p_product_id: productId,
    p_org_id: orgId,
    p_qty: qty,
  })
  return Number(data ?? 0)
}
