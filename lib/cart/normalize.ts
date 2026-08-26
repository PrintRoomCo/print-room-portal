import type {
  CartLine,
  CartLineBracket,
  CartLineDecoration,
  CartLineFulfilmentType,
  CartState,
} from './types'
import type { FulfilmentType } from '@/lib/shop/fulfilment-mode'

/**
 * Pure cart-persistence normalizers. Extracted from CartProvider so the
 * localStorage round-trip is unit-testable without importing the 'use client'
 * provider (and its React/context chain). CartProvider re-uses normalizePersisted
 * verbatim — behaviour is identical to the in-provider version it replaced.
 */

export function normalizeBrackets(raw: unknown): CartLineBracket[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: CartLineBracket[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const b = r as Partial<CartLineBracket>
    if (typeof b.minQty !== 'number' || typeof b.unitPrice !== 'number') continue
    const maxQty =
      typeof b.maxQty === 'number' ? b.maxQty : b.maxQty === null ? null : null
    out.push({ minQty: b.minQty, maxQty, unitPrice: b.unitPrice })
  }
  return out.length > 0 ? out : undefined
}

export function normalizeDecorations(raw: unknown): CartLineDecoration[] {
  if (!Array.isArray(raw)) return []
  const out: CartLineDecoration[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const d = r as Partial<CartLineDecoration> & Record<string, unknown>
    if (typeof d.linkId !== 'string' || typeof d.decorationId !== 'string') continue
    if (typeof d.unitPrice !== 'number') continue
    out.push({
      linkId: d.linkId,
      decorationId: d.decorationId,
      name: typeof d.name === 'string' ? d.name : '',
      method: typeof d.method === 'string' ? d.method : '',
      positionLabel:
        typeof d.positionLabel === 'string' ? d.positionLabel : null,
      unitPrice: d.unitPrice,
      artworkUrl: typeof d.artworkUrl === 'string' ? d.artworkUrl : null,
      snapshotUrl: typeof d.snapshotUrl === 'string' ? d.snapshotUrl : null,
      renditionId: typeof d.renditionId === 'string' ? d.renditionId : null,
      renditionLabel: typeof d.renditionLabel === 'string' ? d.renditionLabel : null,
      brackets: normalizeBrackets(d.brackets),
      // Pooled decoration pricing (2026-08-13 spec). Eligibility is a SERVER
      // decision (real artwork + method is not 'custom') that nothing on the
      // client can re-derive, so it has to survive the reload or the line
      // silently stops pooling. `pooledQty` is deliberately NOT carried: it is
      // derived from the other lines in the cart, and persisting it would let a
      // stale pool size outlive the cart that produced it. `recomputeProduct-
      // TierPrices` rebuilds it on hydrate.
      poolable: d.poolable === true,
    })
  }
  return out
}

/**
 * Validate a persisted cart line's fulfilment type. Back-compat: carts saved
 * before the make_to_stock → made_to_order rename still hold the old literal, so
 * map it forward on load (keeping the line's production status). `raw` is typed
 * `unknown` because it comes straight from untrusted localStorage JSON.
 */
export function normalizeFulfilmentType(raw: unknown): CartLineFulfilmentType | undefined {
  if (raw === 'make_to_stock' || raw === 'made_to_order') return 'made_to_order'
  if (raw === 'stocked') return 'stocked'
  return undefined
}

/**
 * Validate a persisted line's product NATURE (Spec B / F1 — drives the cart
 * order-type selector for 'mixed' products). Distinct from fulfilmentType:
 * nature is the product's capability, fulfilmentType the line's chosen mode.
 */
export function normalizeNature(raw: unknown): FulfilmentType | undefined {
  if (raw === 'stocked' || raw === 'made_to_order' || raw === 'mixed') return raw
  return undefined
}

export function normalizePersisted(raw: unknown): CartState {
  if (!raw || typeof raw !== 'object') return { lines: [] }
  const lines = (raw as { lines?: unknown }).lines
  if (!Array.isArray(lines)) return { lines: [] }
  const normalized: CartLine[] = []
  for (const line of lines) {
    if (!line || typeof line !== 'object') continue
    const l = line as Partial<CartLine> & Record<string, unknown>
    if (typeof l.lineId !== 'string' || typeof l.productId !== 'string') continue
    normalized.push({
      lineId: l.lineId,
      productId: l.productId,
      productName: typeof l.productName === 'string' ? l.productName : '',
      variantId: typeof l.variantId === 'string' ? l.variantId : '',
      variantLabel: typeof l.variantLabel === 'string' ? l.variantLabel : '—',
      sizeId:
        typeof l.sizeId === 'number' ? l.sizeId : null,
      sizeLabel:
        typeof l.sizeLabel === 'string' ? l.sizeLabel : null,
      qty: typeof l.qty === 'number' && l.qty > 0 ? l.qty : 1,
      unitPrice: typeof l.unitPrice === 'number' ? l.unitPrice : 0,
      priceCurrency:
        typeof l.priceCurrency === 'string' && /^[A-Z]{3}$/.test(l.priceCurrency)
          ? l.priceCurrency
          : undefined,
      imageUrl: typeof l.imageUrl === 'string' ? l.imageUrl : null,
      shipToStoreId:
        typeof l.shipToStoreId === 'string' || l.shipToStoreId === null
          ? (l.shipToStoreId ?? null)
          : null,
      // Feature 1 — the chosen PDP location label must survive the localStorage
      // round-trip or two different-location lines silently re-merge after reload.
      locationLabel:
        typeof l.locationLabel === 'string' || l.locationLabel === null
          ? (l.locationLabel ?? null)
          : null,
      // Feature 2 — the chosen custom name must survive the localStorage
      // round-trip or two differently-named lines silently re-merge on reload.
      customName:
        typeof l.customName === 'string' || l.customName === null
          ? (l.customName ?? null)
          : null,
      decorations: normalizeDecorations(l.decorations),
      fulfilmentType: normalizeFulfilmentType(l.fulfilmentType),
      // F1 — nature must survive the round-trip or the mixed-cart order-type
      // selector silently disappears after any page reload.
      nature: normalizeNature(l.nature),
      // Spec 3a — the per-variant billing snapshot must survive the round-trip
      // or the review page's Pre-paid badge silently disappears after a reload
      // (billing itself is safe: submit re-resolves per variant server-side).
      billingMode:
        l.billingMode === 'prepaid' || l.billingMode === 'invoice_on_dispatch'
          ? l.billingMode
          : undefined,
      brackets: normalizeBrackets(l.brackets),
      // Phase 2 — catalogue identity must survive the localStorage round-trip,
      // else the order line loses which skin sold on reload.
      catalogueItemId:
        typeof l.catalogueItemId === 'string' ? l.catalogueItemId : null,
      // Pooled decoration pricing (2026-08-13 spec) — the owning catalogue and
      // its opt-in flag, snapshotted at add-time. Both are add-time facts the
      // cart cannot re-derive, so dropping them here left the line unable to
      // pool EVER again: `isPoolingLine` needs both, and no later add restores
      // them. That is what made "Same artwork savings" vanish on reload.
      catalogueId: typeof l.catalogueId === 'string' ? l.catalogueId : null,
      poolingEnabled: l.poolingEnabled === true,
      // manual_final — the item's ONE combined decoration figure and its own
      // qty ladder. Placements on a manual line are $0 metadata, so without
      // these the reloaded cart shows no decoration cost at all while checkout
      // still bills the combined figure.
      manualDecorationPerUnit:
        typeof l.manualDecorationPerUnit === 'number' ? l.manualDecorationPerUnit : null,
      manualDecorationBrackets: normalizeBrackets(l.manualDecorationBrackets),
    })
  }
  return { lines: normalized }
}
