import { cartLineDisplayImageUrl, type CartLine } from './types'

/** View model for the "added to cart" toast — pure, derived from add payloads. */
export interface CartAddedSummary {
  imageUrl: string | null
  title: string
  /** Secondary line under the title; null when there is nothing useful to add. */
  detail: string | null
}

type AddPayload = Omit<CartLine, 'lineId'>

function units(n: number): string {
  return `${n} ${n === 1 ? 'unit' : 'units'}`
}

/**
 * Collapse the cart adds from a single user action into one toast model.
 *
 * One PDP "Add to cart" can call cart.addLine several times (one per size in a
 * colourway grid); Reorder loops it across many products. CartProvider buffers
 * the payloads for a tick and hands the batch here, so the customer sees a
 * single toast instead of a burst.
 */
export function summariseCartAdds(adds: AddPayload[]): CartAddedSummary | null {
  if (adds.length === 0) return null

  const totalQty = adds.reduce((sum, a) => sum + (a.qty || 0), 0)
  const productIds = new Set(adds.map((a) => a.productId))

  // Several distinct products in one action (e.g. Reorder) — summarise by count.
  if (productIds.size > 1) {
    return {
      imageUrl: cartLineDisplayImageUrl(adds[0]),
      title: `${productIds.size} products`,
      detail: units(totalQty),
    }
  }

  const first = adds[0]
  const imageUrl = cartLineDisplayImageUrl(first)
  const labels = new Set(adds.map((a) => a.variantLabel?.trim()).filter(Boolean))

  // One product, one variant label (single add, or the same variant added again).
  if (labels.size <= 1) {
    const label = first.variantLabel?.trim()
    return {
      imageUrl,
      title: first.productName,
      detail: label ? `${totalQty} × ${label}` : units(totalQty),
    }
  }

  // One product across several sizes/variants in one action.
  const sizeCount = new Set(
    adds.map((a) => a.sizeLabel?.trim() || a.variantLabel?.trim()).filter(Boolean),
  ).size
  return {
    imageUrl,
    title: first.productName,
    detail: `${units(totalQty)} · ${sizeCount} ${sizeCount === 1 ? 'size' : 'sizes'}`,
  }
}
