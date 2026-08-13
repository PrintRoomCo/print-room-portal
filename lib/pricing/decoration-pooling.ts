/**
 * Pooled decoration pricing — the one implementation of the rule.
 *
 * Spec: docs/2026-08-13-pooled-decoration-pricing.md
 *
 *   Lines in the same catalogue that share a decoration pool their quantities.
 *   Every pooled line band-selects at the combined quantity, but each line reads
 *   the selected band from its own item's price ladder.
 *
 * Two rules, both here:
 *
 *  1. **Per-decoration pooling for decoration price.** A line's decoration cost is
 *     the sum over its decorations of `ladder(decoration, that decoration's pooled
 *     qty)`. A garment carrying an extra placement is automatically "the sequential
 *     difference added on".
 *
 *  2. **Max rule for the garment band.** A line's garment band quantity is the
 *     LARGEST pool among its own decorations, never below its own group qty. Taking
 *     the max — rather than the transitive closure of everything connected — is what
 *     stops a garment bridging two artwork groups from dragging the third garment up
 *     with it. See the worked example in `decoration-pooling.test.ts`.
 *
 * Cart (`lib/cart/types.ts`) and checkout (`lib/checkout/submit.ts`) both call this,
 * so the "keep them in step" contract those two files carry in comments is shared
 * code here. Their line shapes differ (cart is camelCase throughout; checkout input
 * lines are snake_case except `catalogueItemId`), so each caller adapts into
 * `PoolingLine` and the rule itself exists exactly once.
 *
 * IMPORTANT: everything here produces a *band-selection* quantity. It is never a
 * real quantity. It may only ever be passed as the qty argument to a price lookup —
 * never into MOQ, billed totals, picking fee, or order-type classification.
 */

export type PoolingFulfilmentType = 'stocked' | 'made_to_order'

export interface PoolingLineDecoration {
  /** org_decorations.id — the canonical artwork+method+placement identity. */
  decorationId: string
  /**
   * Server-decided eligibility: a real library decoration (has artwork, method
   * is not 'custom'). The $0 'custom' placeholder is attached catalogue-wide, so
   * pooling by decoration id without this would pool entire catalogues.
   * Absent (legacy persisted cart lines) = not poolable.
   */
  poolable?: boolean
}

export interface PoolingLine {
  /** b2b_catalogues.id — pools never cross catalogues. Absent = never pools. */
  catalogueId?: string | null
  /** Snapshot of that catalogue's opt-in flag. Falsy = today's behaviour. */
  poolingEnabled?: boolean
  qty: number
  /**
   * 'stocked' lines are pre-decorated units at a fixed stock price. They neither
   * contribute to a pool nor receive a pooled band (spec §5).
   */
  fulfilmentType?: PoolingFulfilmentType | null
  decorations?: PoolingLineDecoration[]
}

/**
 * Pool identity. Scoped to the catalogue because pooling never crosses one, and
 * two catalogues may legitimately attach the same org decoration.
 */
export function poolKey(catalogueId: string, decorationId: string): string {
  return `${catalogueId}::${decorationId}`
}

/** Can this line take part in pooling at all — in either direction? */
export function isPoolingLine(line: PoolingLine): boolean {
  return (
    line.poolingEnabled === true &&
    typeof line.catalogueId === 'string' &&
    line.catalogueId.length > 0 &&
    line.fulfilmentType !== 'stocked'
  )
}

function poolableDecorations(line: PoolingLine): PoolingLineDecoration[] {
  return (line.decorations ?? []).filter((d) => d.poolable === true && d.decorationId)
}

/**
 * Total quantity behind each poolable decoration, per catalogue.
 *
 * Prepaid / all-in lines DO contribute (spec §5) — they are genuinely decorated
 * garments; only their own line pricing is special, and that is handled elsewhere.
 * Stocked lines contribute nothing.
 *
 * Callers pass the widest set of lines they know about — for checkout that is
 * `pricing_pool_lines` (the full, unpartitioned cart), which is why the stocked
 * filter above is load-bearing rather than incidental.
 */
export function pooledQtyByDecoration(lines: readonly PoolingLine[]): Map<string, number> {
  const pools = new Map<string, number>()
  for (const line of lines) {
    if (!isPoolingLine(line)) continue
    const catalogueId = line.catalogueId as string
    const qty = Number(line.qty)
    if (!Number.isFinite(qty) || qty <= 0) continue
    // A decoration appearing twice on one line must not double-count the line.
    const seen = new Set<string>()
    for (const dec of poolableDecorations(line)) {
      if (seen.has(dec.decorationId)) continue
      seen.add(dec.decorationId)
      const key = poolKey(catalogueId, dec.decorationId)
      pools.set(key, (pools.get(key) ?? 0) + qty)
    }
  }
  return pools
}

/**
 * The quantity to price ONE decoration of ONE line at.
 *
 * `fallbackQty` is whatever the caller would have used before pooling existed
 * (today's per-product-and-signature aggregate), so a non-pooling line, a
 * non-poolable decoration, or a decoration with no pool entry all reproduce
 * today's behaviour exactly.
 */
export function pooledDecorationQty(
  line: PoolingLine,
  decoration: PoolingLineDecoration,
  pools: Map<string, number>,
  fallbackQty: number,
): number {
  if (!isPoolingLine(line)) return fallbackQty
  if (decoration.poolable !== true) return fallbackQty
  const pooled = pools.get(poolKey(line.catalogueId as string, decoration.decorationId))
  return pooled == null ? fallbackQty : Math.max(pooled, fallbackQty)
}

/**
 * The quantity a line's GARMENT price band-selects at — the max rule.
 *
 * `ownGroupQty` is the line's existing (pre-pooling) group quantity, so this can
 * only ever move a band up, never down, and a line with no poolable decoration
 * returns `ownGroupQty` unchanged.
 *
 * Deliberately NOT transitive: we take the max over THIS line's decorations, not
 * over everything reachable through shared garments. A cap carrying only back-print
 * B does not inherit the 600 band merely because a hood carries both A and B.
 */
export function garmentBandQty(
  line: PoolingLine,
  pools: Map<string, number>,
  ownGroupQty: number,
): number {
  if (!isPoolingLine(line)) return ownGroupQty
  const catalogueId = line.catalogueId as string
  let best = ownGroupQty
  for (const dec of poolableDecorations(line)) {
    const pooled = pools.get(poolKey(catalogueId, dec.decorationId))
    if (pooled != null && pooled > best) best = pooled
  }
  return best
}

/**
 * Pool size behind each of a line's decorations, for display (spec §8 — the
 * "Same artwork savings" pill states the outcome: "this artwork appears on N
 * garments in your order"). Only poolable decorations of a pooling line appear.
 */
export function poolSizesForLine(
  line: PoolingLine,
  pools: Map<string, number>,
): Map<string, number> {
  const out = new Map<string, number>()
  if (!isPoolingLine(line)) return out
  const catalogueId = line.catalogueId as string
  for (const dec of poolableDecorations(line)) {
    const pooled = pools.get(poolKey(catalogueId, dec.decorationId))
    if (pooled != null) out.set(dec.decorationId, pooled)
  }
  return out
}
