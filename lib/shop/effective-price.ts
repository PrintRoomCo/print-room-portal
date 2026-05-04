import type { SupabaseClient } from '@supabase/supabase-js'

export interface EffectivePriceResult {
  unitPrice: number
  status: 'ok' | 'missing'
}

export async function effectiveUnitPrice(
  admin: SupabaseClient,
  productId: string,
  orgId: string,
  qty: number,
): Promise<EffectivePriceResult> {
  const { data, error } = await admin.rpc('effective_unit_price', {
    p_product_id: productId,
    p_org_id: orgId,
    p_qty: qty,
  })

  if (error) {
    console.warn('[shop/pricing] effective_unit_price RPC failed', {
      productId,
      orgId,
      qty,
      error: error.message,
    })
    return { unitPrice: 0, status: 'missing' }
  }

  const value = Number(data ?? 0)
  if (!Number.isFinite(value) || value <= 0) {
    console.warn('[shop/pricing] zero or invalid price for product', {
      productId,
      orgId,
      qty,
      raw: data,
    })
    return { unitPrice: 0, status: 'missing' }
  }

  return { unitPrice: value, status: 'ok' }
}

export async function effectiveUnitPriceNumber(
  admin: SupabaseClient,
  productId: string,
  orgId: string,
  qty: number,
): Promise<number> {
  const result = await effectiveUnitPrice(admin, productId, orgId, qty)
  return result.unitPrice
}
