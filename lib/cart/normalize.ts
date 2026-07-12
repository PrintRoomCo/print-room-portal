import type {
  CartLine,
  CartLineBracket,
  CartLineDecoration,
  CartLineFulfilmentType,
  CartState,
} from './types'

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
      brackets: normalizeBrackets(d.brackets),
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
      imageUrl: typeof l.imageUrl === 'string' ? l.imageUrl : null,
      shipToStoreId:
        typeof l.shipToStoreId === 'string' || l.shipToStoreId === null
          ? (l.shipToStoreId ?? null)
          : null,
      decorations: normalizeDecorations(l.decorations),
      fulfilmentType: normalizeFulfilmentType(l.fulfilmentType),
      brackets: normalizeBrackets(l.brackets),
      // Phase 2 — catalogue identity must survive the localStorage round-trip,
      // else the order line loses which skin sold on reload.
      catalogueItemId:
        typeof l.catalogueItemId === 'string' ? l.catalogueItemId : null,
    })
  }
  return { lines: normalized }
}
