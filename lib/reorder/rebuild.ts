import type { CartLineDecoration, CartLineFulfilmentType } from '@/lib/cart/types'

/**
 * A `quote_items` row joined to its variant labels + product image, as fetched
 * by the rebuild route. Flat + serializable so the mapping is trivially testable
 * without a Supabase client.
 */
export interface QuoteItemRebuildRow {
  product_id: string | null
  variant_id: string | null
  product_name: string
  quantity: number
  decorations: unknown
  ship_to_store_id: string | null
  catalogue_item_id: string | null
  catalogue_variant_label: string | null
  qty_from_stock: number
  qty_to_make: number
  /** joined: product_variants.product_color_swatches.label */
  colour_label: string | null
  /** joined: product_variants.sizes.label */
  size_label: string | null
  /** resolved separately: products.image_url (product_id is text → no PostgREST embed) */
  image_url: string | null
}

/**
 * The cart-add payload. Matches the object shape passed to `cart.addLine` in
 * ProductDetailClient.tsx EXACTLY — minus `brackets`, which we deliberately
 * omit so the rebuilt line behaves like a legacy line (unitPrice stays until
 * checkout re-prices). `unitPrice` is filled with a fresh effective price by the
 * route; the mapper sets it to 0.
 */
export interface RebuildLine {
  productId: string
  productName: string
  variantId: string
  variantLabel: string
  qty: number
  unitPrice: number
  imageUrl: string | null
  shipToStoreId: string | null
  decorations: CartLineDecoration[]
  fulfilmentType: CartLineFulfilmentType
  catalogueItemId: string | null
  catalogueVariantLabel: string | null
}

export interface BuildRebuildResult {
  lines: RebuildLine[]
  /** Lines whose `variant_id` was null — surfaced so the UI can warn. */
  degradedCount: number
}

/**
 * A line is 'made_to_order' if any quantity is destined for a new production
 * run; otherwise it draws purely from existing stock ('stocked'). Mixed lines
 * (both > 0) collapse to 'made_to_order' — the conservative choice that keeps
 * MOQ applicable, matching submit.ts's MOQ treatment.
 */
export function deriveFulfilmentType(row: { qty_to_make: number }): CartLineFulfilmentType {
  return row.qty_to_make > 0 ? 'made_to_order' : 'stocked'
}

function variantLabelFrom(row: QuoteItemRebuildRow): string {
  const parts = [row.colour_label, row.size_label].filter(Boolean)
  if (parts.length > 0) return parts.join(' / ')
  return row.catalogue_variant_label ?? '—'
}

function decorationsFrom(raw: unknown): CartLineDecoration[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (d): d is CartLineDecoration =>
      !!d && typeof d === 'object' && typeof (d as { linkId?: unknown }).linkId === 'string',
  )
}

export function buildRebuildLines(rows: QuoteItemRebuildRow[]): BuildRebuildResult {
  let degradedCount = 0
  const lines: RebuildLine[] = rows
    .filter((r) => typeof r.product_id === 'string' && r.product_id.length > 0)
    .map((r) => {
      if (!r.variant_id) degradedCount++
      return {
        productId: r.product_id as string,
        productName: r.product_name,
        variantId: r.variant_id ?? '',
        variantLabel: variantLabelFrom(r),
        qty: r.quantity,
        unitPrice: 0,
        imageUrl: r.image_url,
        shipToStoreId: r.ship_to_store_id,
        decorations: decorationsFrom(r.decorations),
        fulfilmentType: deriveFulfilmentType(r),
        catalogueItemId: r.catalogue_item_id,
        catalogueVariantLabel: r.catalogue_variant_label,
      }
    })
  return { lines, degradedCount }
}
