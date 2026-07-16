import type { SupabaseClient } from '@supabase/supabase-js'

// Spec 3a follow-up (2026-07-16): the PDP surfaces, for PREPAID stock, the
// per-unit price of the volume band the stock was ORIGINALLY purchased at —
// informational only (a prepaid draw is $0 at checkout; the pick fee is the
// only charge).
//
// Source of truth (confirmed): the most recent stock intake that is linked to
// an order (variant_inventory_events.reference_quote_item_id →
// quote_items.unit_price — the exact all-in price the org paid per unit).
// Fallback for stock entered without an order link (e.g. the staff review
// grid): the item's CURRENT ladder read at the intake quantity (garment band
// only — decoration isn't reconstructable without the original order).

export interface StockIntakeEvent {
  variant_id: string
  delta_stock: number
  reference_quote_item_id: string | null
  created_at: string
}

export interface PriceBracket {
  min_quantity: number
  max_quantity: number | null
  unit_price: number
}

/** Ladder price at a quantity; null when the ladder has no matching band. */
export function bracketPriceAt(brackets: PriceBracket[], qty: number): number | null {
  for (const b of brackets) {
    if (qty >= b.min_quantity && (b.max_quantity == null || qty <= b.max_quantity)) {
      return b.unit_price
    }
  }
  return null
}

/**
 * variant_id → original-purchase unit price. Events must be newest-first per
 * variant (the resolver orders by created_at desc). Preference per variant:
 * newest ORDER-LINKED intake's quote-item price; else newest intake priced
 * from the ladder at its quantity; else absent.
 */
export function pickStockPurchasePrices(
  events: StockIntakeEvent[],
  priceByQuoteItemId: Map<string, number>,
  brackets: PriceBracket[],
): Map<string, number> {
  const linked = new Map<string, number>()
  const fallback = new Map<string, number>()
  for (const e of events) {
    if (e.delta_stock <= 0) continue
    if (e.reference_quote_item_id && !linked.has(e.variant_id)) {
      const price = priceByQuoteItemId.get(e.reference_quote_item_id)
      if (typeof price === 'number' && Number.isFinite(price)) {
        linked.set(e.variant_id, price)
        continue
      }
    }
    if (!fallback.has(e.variant_id)) {
      const price = bracketPriceAt(brackets, e.delta_stock)
      if (price != null) fallback.set(e.variant_id, price)
    }
  }
  const out = new Map<string, number>(fallback)
  for (const [variantId, price] of linked) out.set(variantId, price)
  return out
}

/** Batch-resolve original-purchase unit prices for an org's prepaid variants. */
export async function resolveStockPurchasePrices(
  admin: SupabaseClient,
  orgId: string,
  variantIds: string[],
  brackets: PriceBracket[],
): Promise<Map<string, number>> {
  if (variantIds.length === 0) return new Map()
  const { data: eventRows } = await admin
    .from('variant_inventory_events')
    .select('variant_id, delta_stock, reference_quote_item_id, created_at')
    .eq('organization_id', orgId)
    .gt('delta_stock', 0)
    .in('variant_id', variantIds)
    .order('created_at', { ascending: false })
  const events = (eventRows ?? []) as StockIntakeEvent[]

  const quoteItemIds = Array.from(
    new Set(
      events
        .map((e) => e.reference_quote_item_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  )
  const priceByQuoteItemId = new Map<string, number>()
  if (quoteItemIds.length > 0) {
    const { data: qiRows } = await admin
      .from('quote_items')
      .select('id, unit_price')
      .in('id', quoteItemIds)
    for (const r of (qiRows ?? []) as Array<{ id: string; unit_price: number | string | null }>) {
      const n = Number(r.unit_price)
      if (Number.isFinite(n)) priceByQuoteItemId.set(r.id, n)
    }
  }

  return pickStockPurchasePrices(events, priceByQuoteItemId, brackets)
}
