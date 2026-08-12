// lib/starshipit/items.ts
//
// quote_items -> Starshipit items[] (design D5). Line items are enrichment:
// they make the printed ticket/packing slip complete, but a failed load must
// never lose the push — loadStarshipitOrderItems degrades to [] on error.
//
// SKU: resolved from products.sku via quote_items.source_product_id (a clean
// uuid FK) with a deterministic second lookup — NOT a PostgREST embed, and NOT
// the stale product_variants.sku_suffix (post-SKUCOLLAPSE one colourway variant
// now spans many sizes, so its suffix would misprint). Lines whose product has
// no sku ship SKU-blank (accepted). No weight: verified 2026-08-06 that no
// weight column exists anywhere in the schema — staff enter weight in Starshipit
// at print time.
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
  /** products.id for this line — the key we resolve products.sku through. */
  source_product_id?: string | null
  /** Resolved from products.sku by loadStarshipitOrderItems; not selected directly. */
  sku?: string | null
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
    if (typeof row.sku === 'string' && row.sku.trim().length > 0) {
      item.sku = row.sku.trim()
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
      'product_name, quantity, unit_price, size_label, source_product_id, product_variants ( product_color_swatches ( label ) )',
    )
    .eq('quote_id', quoteId)
  if (error || !data) return []
  const rows = data as unknown as StarshipitQuoteItemRow[]

  // Resolve products.sku with a deterministic second lookup (the source_product_id
  // FK is not guaranteed embeddable). Best-effort: a failed or empty products read
  // leaves every line SKU-blank while the push still carries descriptions. No throw.
  const ids = [...new Set(rows.map((r) => r.source_product_id).filter((x): x is string => !!x))]
  const skuById = new Map<string, string>()
  if (ids.length > 0) {
    const { data: prods } = await admin.from('products').select('id, sku').in('id', ids)
    for (const p of (prods ?? []) as Array<{ id: string; sku: unknown }>) {
      const sku = typeof p.sku === 'string' ? p.sku.trim() : ''
      if (sku) skuById.set(p.id, sku)
    }
  }

  return mapQuoteItemsToStarshipitItems(
    rows.map((r) => ({
      ...r,
      sku: r.source_product_id ? skuById.get(r.source_product_id) ?? null : null,
    })),
  )
}
