import type { CartLineBracket } from '@/lib/cart/types'

/**
 * Per-decoration price ladders (pooled decoration pricing, spec §3).
 *
 * A decoration's ladder is authored once in the staff org decoration library and
 * read by `effective_decoration_unit_price` at the pooled quantity. When the cart
 * snapshots that ladder as `decorations[].brackets`, cart and server MUST agree at
 * every quantity — a divergence is a 409 at checkout, not a rounding nit.
 *
 * The SQL function does not just match bands, it CLAMPS (mirroring
 * `catalogue_item_decoration_price`):
 *   1. the exact band covering the qty; else
 *   2. the highest band whose min is at or below the qty (qty above a closed top
 *      band, or inside a gap between bands); else
 *   3. the lowest band (qty below the first band).
 *
 * `pickBracket` in the cart does exact-band matching only, so snapshotting raw
 * ladder rows would silently mis-price at exactly the quantities the clamp exists
 * for. Rather than teach the cart a second matching rule, normalise the ladder on
 * the way out so plain exact matching reproduces the clamp: extend the first band
 * down to 1, close every gap by extending the lower band up to the next band's
 * min, and open the top band's tail.
 *
 * That transformation is equivalence-preserving — see decoration-ladder.test.ts,
 * which asserts it against a direct implementation of the SQL's three steps.
 */

export interface DecorationLadderRow {
  min_quantity: number
  max_quantity: number | null
  unit_price: number | string
}

/**
 * Normalise an authored ladder into gapless brackets covering [1, ∞), so that
 * exact-band matching equals the database's clamped lookup at every quantity.
 * Returns null for an empty/absent ladder — the caller then keeps today's
 * engine/flat pricing, which is exactly what the DB function does.
 */
export function normalizeLadderBrackets(
  rows: readonly DecorationLadderRow[] | null | undefined,
): CartLineBracket[] | null {
  if (!rows || rows.length === 0) return null

  const sorted = [...rows]
    .map((r) => ({
      minQty: Number(r.min_quantity),
      maxQty: r.max_quantity == null ? null : Number(r.max_quantity),
      unitPrice: Number(r.unit_price),
    }))
    .filter((r) => Number.isFinite(r.minQty) && Number.isFinite(r.unitPrice))
    .sort((a, b) => a.minQty - b.minQty)

  if (sorted.length === 0) return null

  return sorted.map((row, i) => ({
    // Clamp down: anything below the authored first band prices at that band.
    minQty: i === 0 ? 1 : row.minQty,
    // Close gaps by extending this band up to just under the next one; clamp up
    // by opening the tail of the highest band.
    maxQty: i === sorted.length - 1 ? null : sorted[i + 1].minQty - 1,
    unitPrice: row.unitPrice,
  }))
}

/**
 * The database's lookup, implemented directly. Used for the PDP first-paint price
 * (which bypasses the pricing RPC) and as the oracle the normaliser is tested
 * against. Returns null when there is no ladder.
 */
export function ladderPriceAt(
  rows: readonly DecorationLadderRow[] | null | undefined,
  qty: number,
): number | null {
  if (!rows || rows.length === 0) return null
  const bands = [...rows]
    .map((r) => ({
      minQty: Number(r.min_quantity),
      maxQty: r.max_quantity == null ? null : Number(r.max_quantity),
      unitPrice: Number(r.unit_price),
    }))
    .filter((r) => Number.isFinite(r.minQty) && Number.isFinite(r.unitPrice))
    .sort((a, b) => a.minQty - b.minQty)

  if (bands.length === 0) return null

  // 1. Exact band covering qty (highest such min, matching ORDER BY min DESC).
  const exact = [...bands]
    .reverse()
    .find((b) => b.minQty <= qty && (b.maxQty == null || qty <= b.maxQty))
  if (exact) return exact.unitPrice

  // 2. Highest band at or below qty.
  const below = [...bands].reverse().find((b) => b.minQty <= qty)
  if (below) return below.unitPrice

  // 3. The lowest band.
  return bands[0].unitPrice
}
