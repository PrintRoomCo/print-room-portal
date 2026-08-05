// lib/starshipit/items.ts
//
// quote_items -> Starshipit items[] (design D5). Line items are enrichment:
// they make the printed ticket/packing slip complete, but a failed load must
// never lose the push — loadStarshipitOrderItems degrades to [] on error.
//
// No sku: quote_items carries none, and the products(sku) embed is unverified
// (product_id is inserted untyped by submit_b2b_order). No weight: verified
// 2026-08-06 that no weight column exists anywhere in the schema — staff enter
// weight in Starshipit at print time.
import type { SupabaseClient } from '@supabase/supabase-js'

export interface StarshipitOrderItem {
  description: string
  sku?: string
  quantity: number
  value?: number
}

type SwatchEmbed = { label?: string | null } | Array<{ label?: string | null }> | null | undefined
type VariantEmbed =
  | { product_color_swatches?: SwatchEmbed }
  | Array<{ product_color_swatches?: SwatchEmbed }>
  | null
  | undefined

export interface StarshipitQuoteItemRow {
  product_name: string | null
  quantity: number | null
  unit_price: number | null
  size_label: string | null
  product_variants?: VariantEmbed
}

function first<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function colourLabel(row: StarshipitQuoteItemRow): string | null {
  const variant = first(row.product_variants)
  const swatch = first(variant?.product_color_swatches)
  const label = swatch?.label
  return typeof label === 'string' && label.trim().length > 0 ? label.trim() : null
}

export function mapQuoteItemsToStarshipitItems(
  rows: StarshipitQuoteItemRow[],
): StarshipitOrderItem[] {
  return rows.map((row) => {
    const description =
      [row.product_name, row.size_label, colourLabel(row)]
        .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
        .map((part) => part.trim())
        .join(' — ') || 'Item'
    const quantity =
      typeof row.quantity === 'number' && Number.isFinite(row.quantity) && row.quantity > 0
        ? row.quantity
        : 1
    const item: StarshipitOrderItem = { description, quantity }
    if (typeof row.unit_price === 'number' && Number.isFinite(row.unit_price)) {
      item.value = row.unit_price
    }
    return item
  })
}

export async function loadStarshipitOrderItems(
  admin: SupabaseClient,
  quoteId: string,
): Promise<StarshipitOrderItem[]> {
  const { data, error } = await admin
    .from('quote_items')
    .select(
      'product_name, quantity, unit_price, size_label, product_variants ( product_color_swatches ( label ) )',
    )
    .eq('quote_id', quoteId)
  if (error || !data) return []
  return mapQuoteItemsToStarshipitItems(data as unknown as StarshipitQuoteItemRow[])
}
