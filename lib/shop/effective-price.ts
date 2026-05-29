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

/**
 * Item-keyed price for a SPECIFIC catalogue item (Phase 1 multi-skin).
 * Prefer this over {@link effectiveUnitPrice} whenever a catalogue_item_id is in
 * hand — it has no LIMIT 1 product lookup, so it cannot silently misprice once a
 * product has multiple active skins. Routes through `catalogue_unit_price`
 * server-side (never `get_unit_price`). Throws on RPC error.
 */
export async function effectiveUnitPriceForItem(
  admin: SupabaseClient,
  catalogueItemId: string,
  orgId: string,
  qty: number,
): Promise<number> {
  const { data, error } = await admin.rpc('effective_unit_price_for_item', {
    p_catalogue_item_id: catalogueItemId,
    p_org_id: orgId,
    p_qty: qty,
  })
  if (error) throw error
  return Number(data ?? 0)
}

/**
 * Batched item-keyed pricing — symmetric with {@link effectiveUnitPricesBulk} but
 * keyed on catalogue_item_id. Returns a Map<catalogueItemId, unitPrice>. Throws on
 * RPC error.
 */
export async function effectiveUnitPricesForItemsBulk(
  admin: SupabaseClient,
  catalogueItemIds: string[],
  orgId: string,
  qtyByItem: Record<string, number>,
): Promise<Map<string, number>> {
  const { data, error } = await admin.rpc('effective_unit_prices_for_items_bulk', {
    p_catalogue_item_ids: catalogueItemIds,
    p_org_id: orgId,
    p_qty_by_item: qtyByItem,
  })
  if (error) throw error
  return new Map(
    ((data ?? []) as Array<{ catalogue_item_id: string; unit_price: number }>).map((r) => [
      r.catalogue_item_id,
      Number(r.unit_price),
    ]),
  )
}
