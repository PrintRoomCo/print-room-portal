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

export interface BulkPriceResult {
  prices: Map<string, { unitPrice: number; status: 'ok' | 'missing'; hasStock: boolean }>
}

export async function effectiveUnitPricesBulk(
  admin: SupabaseClient,
  productIds: string[],
  orgId: string,
  qtyByProduct: Record<string, number>,
): Promise<BulkPriceResult> {
  if (productIds.length === 0) return { prices: new Map() }
  const { data, error } = await admin.rpc('effective_unit_prices_bulk', {
    p_product_ids: productIds,
    p_org_id: orgId,
    p_qty_by_product: qtyByProduct,
  })
  if (error) {
    console.warn('[shop/pricing] effective_unit_prices_bulk failed', error.message)
    return { prices: new Map() }
  }
  const map = new Map<string, { unitPrice: number; status: 'ok' | 'missing'; hasStock: boolean }>()
  for (const row of (data ?? []) as Array<{ product_id: string; unit_price: number | null; has_stock: boolean }>) {
    const value = Number(row.unit_price ?? 0)
    map.set(row.product_id, {
      unitPrice: Number.isFinite(value) && value > 0 ? value : 0,
      status: Number.isFinite(value) && value > 0 ? 'ok' : 'missing',
      hasStock: row.has_stock ?? false,
    })
  }
  return { prices: map }
}
