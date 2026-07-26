/**
 * Customer-effective soft per-order cap: b2b_catalogue_items.max_order_qty_override
 * ?? products.max_order_qty ?? null. Null = no cap. WARN-ONLY — callers must
 * never gate add-to-cart/checkout on this (unlike getEffectiveMoq).
 */
export function getEffectiveMaxQty(
  product: { max_order_qty: number | null },
  catalogueItem: { max_order_qty_override: number | null } | null,
): number | null {
  return catalogueItem?.max_order_qty_override ?? product.max_order_qty ?? null
}
