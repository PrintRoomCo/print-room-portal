import type { BillingMode } from '@/lib/shop/billing-mode'
import type { FulfilmentType } from '@/lib/shop/fulfilment-mode'
import {
  garmentBandQty,
  isPoolingLine,
  pooledDecorationQty,
  pooledQtyByDecoration,
  poolSizesForLine,
} from '@/lib/pricing/decoration-pooling'

export interface CartLineDecoration {
  /** b2b_catalogue_item_decorations.id — re-validated on submit. */
  linkId: string
  /** org_decorations.id */
  decorationId: string
  /** display name, e.g. "Embroidery — Left Chest" */
  name: string
  /** screenprint | embroidery | heatpress | supacolour | dtf */
  method: string
  /** human-readable position label. */
  positionLabel: string | null
  /** snapshot of resolved unit price at add-time. */
  unitPrice: number
  /** raw artwork thumbnail. Null for details-only included decorations. */
  artworkUrl: string | null
  /** designer-rendered mockup if present (Phase 8+); null in Phase 5. */
  snapshotUrl: string | null
  /** Exact production file identity resolved for this line's colourway. */
  renditionId?: string | null
  /** Staff-facing production label (for example “White ink”). */
  renditionLabel?: string | null
  /**
   * Decoration's own qty-band ladder, snapshotted at add-time. When present,
   * `recomputeProductTierPrices` re-picks `unitPrice` from this ladder on cart
   * qty edits — matching how the garment tier already re-picks. Embroidery
   * snapshots a flat single-band ladder (stitch-priced, qty-independent).
   * Absent for legacy lines + decorations without a recompute path (heatpress
   * etc.); in those cases unitPrice stays frozen until checkout re-prices.
   */
  brackets?: CartLineBracket[]
  /**
   * Pooled decoration pricing (2026-08-13 spec §5) — may this decoration's
   * quantity pool across garments sharing it? Server-computed at add-time as
   * `artwork_id is not null && decoration_method !== 'custom'`, which structurally
   * excludes the $0 "Custom decoration" placeholder that is attached
   * catalogue-wide (MTF x28, Anytime Fitness x15, Trades Services x12,
   * Reburger x7) and would otherwise pool entire catalogues.
   * Absent on legacy persisted lines → treated as not poolable.
   */
  poolable?: boolean
  /**
   * Pooled decoration pricing (spec §8) — how many garments in the cart carry
   * this artwork, set by `recomputeProductTierPrices` on pooled lines. Display
   * input for the "Same artwork savings" pill, so components state the outcome
   * without re-deriving pools. Absent when the line does not pool.
   */
  pooledQty?: number
}

export interface CartLineBracket {
  minQty: number
  /** null = unbounded tail bucket (e.g. 100+). */
  maxQty: number | null
  unitPrice: number
}

export interface CartLine {
  lineId: string
  productId: string
  productName: string
  variantId: string
  variantLabel: string
  /** Runtime size pick (colourway model). sizeId is the `sizes.id`; sizeLabel is
   *  the denormalised snapshot shown in the cart and sent to the order line.
   *  Null/absent on genuinely sizeless (one-size) products + legacy lines. */
  sizeId?: number | null
  sizeLabel?: string | null
  qty: number
  unitPrice: number
  /** Canonical authored list currency. Absent only on legacy persisted carts. */
  priceCurrency?: string
  imageUrl: string | null
  shipToStoreId?: string | null
  /**
   * Feature 1 — the required PDP "location" dropdown label chosen for this line
   * (e.g. "MTF Avalon"). Splits the cart line (into lineSignature) but not the
   * pricing pool (kept out of tierAggregationKey, like sizeId). Absent on legacy
   * persisted lines and products without a location dataset.
   */
  locationLabel?: string | null
  /**
   * Feature 2 — the optional free-text "custom name" typed on the PDP (e.g. a
   * player/staff name). Splits the cart line (into lineSignature) but not the
   * pricing pool (kept out of the aggregation key, like locationLabel/sizeId).
   * Null/absent = no name (merges). Absent on legacy persisted lines.
   */
  customName?: string | null
  /**
   * Decorations selected on this line at add-time. Empty array = no decoration.
   * The customer multi-picks decorations on the PDP swatch picker; each entry
   * is an immutable snapshot of the decoration as resolved when the line was
   * added. Re-validated on checkout submit.
   */
  decorations: CartLineDecoration[]
  /**
   * 'stocked' — drawn from the org's existing on-hand stock.
   * 'made_to_order' — qty exceeds available stock, so the line is PRODUCED
   * (backorder; MOQ-applicable). This is a production signal only — it does NOT
   * decide the destination. Whether the order ships to the customer or lands on
   * the inventory shelf is the order-level checkout `intent` ('customer' default
   * vs 'inventory'). Absent on legacy persisted lines; treat as 'stocked'.
   */
  fulfilmentType?: CartLineFulfilmentType
  /**
   * Spec B / F1 — the product's EFFECTIVE fulfilment nature (catalogue override
   * ?? product base), snapshotted at add-time. Distinct from `fulfilmentType`
   * (the CHOSEN mode): a 'stocked' line from a 'mixed' product can be flipped to
   * a purchase order in the cart, but a line from a pure 'made_to_order' product
   * cannot. The cart's per-line order-type selector shows only when
   * nature === 'mixed' (pillsFor returns both pills). Absent on legacy/reorder
   * lines → treated as 'made_to_order' (no selector).
   */
  nature?: FulfilmentType
  /**
   * Volume-tier brackets snapshotted at add-time. Used by CartProvider to
   * re-derive unitPrice when qty changes (so a 100→24 edit drops back to the
   * smaller-tier price). Absent on legacy persisted lines; in that case
   * unitPrice stays frozen until checkout submit re-prices server-side.
   */
  brackets?: CartLineBracket[]
  /**
   * Phase 2 — catalogue-item identity. The b2b_catalogue_items.id this line was
   * added from, threaded through checkout into submit_b2b_order so the order
   * records WHICH skin sold and resolves MOQ/fulfilment on the exact item.
   * Optional + nullable: absent on legacy persisted lines (treated as "no
   * catalogue identity", same as before).
   */
  catalogueItemId?: string | null
  /**
   * Per customer×product billing tag, snapshotted from the PDP at add-time so the
   * checkout summary can show the "Pre-paid" indicator per line. Optional +
   * nullable: absent on legacy persisted lines (treated as not-prepaid).
   */
  billingMode?: BillingMode
  /**
   * Manual-final pricing (2026-06-10). When the catalogue item's price_mode is
   * 'manual_final' the decoration is ONE combined figure per qty band for the
   * whole item, not a per-placement sum. This holds that combined per-unit
   * figure; when set (non-null) it IS the line's decoration cost and the
   * per-placement `decorations[].unitPrice` sum is ignored (see decorationPerUnit).
   * `manualDecorationBrackets` is its own qty ladder so a cart qty edit re-picks
   * it the same way the garment + per-placement ladders re-pick. Absent/null for
   * computed items (today's per-placement path, unchanged).
   */
  manualDecorationPerUnit?: number | null
  manualDecorationBrackets?: CartLineBracket[]
  /**
   * Pooled decoration pricing (2026-08-13 spec §5) — the b2b_catalogues.id this
   * line was added from. Pools never cross catalogues, so this is the pool scope.
   * Absent on legacy persisted lines → the line never pools.
   */
  catalogueId?: string | null
  /**
   * Snapshot of the catalogue's `decoration_pooling_enabled` flag at add-time.
   * Falsy (the default, and the state of every catalogue at ship time) keeps the
   * line on today's per-product band selection, byte-identical. Old persisted
   * carts lack the field and so simply never pool — correct degradation.
   */
  poolingEnabled?: boolean
}

export type CartLineFulfilmentType = 'stocked' | 'made_to_order'

export interface CartState {
  lines: CartLine[]
}

/**
 * Total decoration price per garment for a given cart line.
 *
 * Manual-final items (price_mode='manual_final') carry ONE combined decoration
 * figure for the whole item in `manualDecorationPerUnit`; when present that is
 * authoritative and the per-placement `decorations[].unitPrice` entries are NOT
 * summed (they remain on the line as metadata — real placement names/artwork —
 * but are not individually billed). Computed items fall back to the per-placement
 * sum, unchanged.
 */
export function decorationPerUnit(line: CartLine): number {
  if (line.manualDecorationPerUnit != null) return line.manualDecorationPerUnit
  return line.decorations.reduce((sum, d) => sum + d.unitPrice, 0)
}

/** Customer-facing all-in unit price: garment unit plus any selected decoration. */
export function allInUnitPrice(line: CartLine): number {
  return line.unitPrice + decorationPerUnit(line)
}

/** Customer-facing line total based on the all-in unit price. */
export function allInLineTotal(line: CartLine): number {
  return line.qty * allInUnitPrice(line)
}

export function cartLineDisplayImageUrl(line: {
  imageUrl?: string | null
  decorations?: Array<{ snapshotUrl?: string | null }>
}, options: { catalogueFrontImageUrl?: string | null } = {}): string | null {
  const snapshotUrl = line.decorations?.find((d) => d.snapshotUrl)?.snapshotUrl
  return options.catalogueFrontImageUrl ?? snapshotUrl ?? line.imageUrl ?? null
}

export function isGenericCustomDecorationName(name: string | null | undefined): boolean {
  return (name ?? '').trim().toLowerCase() === 'custom decoration'
}

/**
 * Stable signature for matching lines on add AND for keying tier aggregation.
 * Keyed on `decorationId` (org_decorations.id — the canonical artwork+method
 * identity) rather than `linkId` (b2b_catalogue_item_decorations.id, which has
 * one row per snapshot swatch). Per-swatch routing must not split the bucket:
 * a Bone variant and an Arctic-blue variant carrying the same Screen-print —
 * Left Chest must pool into one tier bracket. Server-side mirror lives in
 * lib/checkout/submit.ts `tierAggregationKey` — keep them in step.
 */
export function decorationSignature(decorations: CartLineDecoration[]): string {
  if (decorations.length === 0) return ''
  return decorations
    .map((d) => d.decorationId)
    .slice()
    .sort()
    .join('|')
}

/**
 * Stable signature for matching cart lines on add. Same product + variant +
 * variantLabel + decoration set merges quantity. Includes variantLabel so
 * variantless lines (variantId = '') with different sizes stay separate, and
 * fulfilment type so stock and bulk-mode lines remain independently editable.
 *
 * Phase 2: `catalogueItemId` is the FIRST discriminator in the string — two
 * skins of one master product (same productId, different catalogue item) never
 * merge. `catalogueItemId` is a trailing param so the ~dozen existing call
 * sites keep working unchanged; passing null reproduces the pre-phase-2
 * signature exactly (legacy parity).
 */
export function lineSignature(
  productId: string,
  variantId: string,
  variantLabel: string,
  decorations: CartLineDecoration[],
  fulfilmentType: CartLineFulfilmentType = 'stocked',
  catalogueItemId: string | null = null,
  sizeId: number | null = null,
  locationLabel: string | null = null,
  customName: string | null = null,
  priceCurrency?: string,
): string {
  return `${catalogueItemId ?? productId}::${variantId}::${sizeId ?? ''}::${locationLabel ?? ''}::${variantLabel}::${fulfilmentType}::${decorationSignature(decorations)}::${customName ?? ''}::${priceCurrency ?? ''}`
}

/**
 * Pick the volume bracket that applies to a given qty, or null when the line
 * has no bracket snapshot (legacy persisted lines). Tail bracket has maxQty
 * null to mean "qty and above"; assumes ascending sort.
 */
export function pickBracket(
  brackets: CartLineBracket[] | undefined,
  qty: number,
): CartLineBracket | null {
  if (!brackets || brackets.length === 0) return null
  return (
    brackets.find(
      (b) => qty >= b.minQty && (b.maxQty == null || qty <= b.maxQty),
    ) ?? null
  )
}

/**
 * Recompute every line's unitPrice against the qty SUM across every line that
 * shares BOTH productId AND decorationSignature. Variant and fulfilmentType
 * are NOT part of the aggregation key — two sizes of the same product with
 * the same decoration set still pool. Same product with different decoration
 * methods or artworks does NOT pool (signatures differ → different engine
 * setup amortization curves). Mirrors the server-side recompute in
 * lib/checkout/submit.ts so cart display equals what submit will recompute.
 *
 * Called after every cart mutation (add merge / update / remove) so editing
 * one line correctly re-tiers every same-product-and-signature line. No-op
 * on lines that have no brackets snapshot (legacy) or whose total qty falls
 * outside every bracket.
 */
export function recomputeProductTierPrices(lines: CartLine[]): CartLine[] {
  const aggKey = (l: CartLine) => `${l.productId}::${decorationSignature(l.decorations)}`
  const totalByKey = new Map<string, number>()
  for (const l of lines) {
    const k = aggKey(l)
    totalByKey.set(k, (totalByKey.get(k) ?? 0) + l.qty)
  }

  // Pooled decoration pricing (spec 2026-08-13). Built from ALL lines, but only
  // lines in a pooling-enabled catalogue contribute or receive — so with every
  // catalogue's flag false (the ship-time state) `pools` is empty and every
  // branch below collapses to the pre-pooling code path, byte for byte. Pinned
  // by lib/cart/flag-off-parity.test.ts.
  const pools = pooledQtyByDecoration(lines)

  return lines.map((l) => {
    const total = totalByKey.get(aggKey(l)) ?? l.qty
    const pooling = pools.size > 0 && isPoolingLine(l)
    // Band-selection quantity ONLY. `total` remains the real group quantity and
    // is what every non-pricing consumer keeps reading.
    const garmentQty = pooling ? garmentBandQty(l, pools, total) : total

    let nextUnitPrice = l.unitPrice
    if (l.brackets && l.brackets.length > 0) {
      const bracket = pickBracket(l.brackets, garmentQty)
      if (bracket) nextUnitPrice = bracket.unitPrice
    }

    let nextDecorations: CartLineDecoration[] = l.decorations
    let decorationsChanged = false
    if (l.decorations.length > 0) {
      const poolSizes = pooling ? poolSizesForLine(l, pools) : null
      const remapped = l.decorations.map((d) => {
        // Pool size rides on the decoration for display (spec §8) whether or not
        // the price moved — a pooled line still says so when its band did not
        // change. Only ever set on pooled lines, so flag-off is untouched.
        const pooledQty = poolSizes?.get(d.decorationId)
        let next = d
        if (pooledQty != null && pooledQty !== d.pooledQty) {
          next = { ...d, pooledQty }
          decorationsChanged = true
        }
        if (!next.brackets || next.brackets.length === 0) return next
        // Each placement prices at ITS OWN pool, so a garment carrying an extra
        // back print picks that print's smaller band independently.
        const decoQty = pooling ? pooledDecorationQty(l, next, pools, total) : total
        const decoBracket = pickBracket(next.brackets, decoQty)
        if (!decoBracket || decoBracket.unitPrice === next.unitPrice) return next
        decorationsChanged = true
        return { ...next, unitPrice: decoBracket.unitPrice }
      })
      if (decorationsChanged) nextDecorations = remapped
    }

    // Manual-final: re-pick the line-level combined decoration from its own
    // ladder on a qty edit (mirrors the garment + per-placement re-pick above).
    //
    // Pooled lines do NOT use the combined figure at all: the item's per-band
    // decoration_unit_price cannot express a per-placement delta, which is the
    // whole reason pooling moves decoration price onto per-decoration ladders
    // (spec §3). Clearing it makes decorationPerUnit() fall through to the
    // per-placement sum, matching what the checkout server bills for these lines.
    let nextManualDeco = l.manualDecorationPerUnit
    let manualDecoChanged = false
    if (pooling && l.manualDecorationPerUnit != null) {
      nextManualDeco = null
      manualDecoChanged = true
    } else if (
      l.manualDecorationPerUnit != null &&
      l.manualDecorationBrackets &&
      l.manualDecorationBrackets.length > 0
    ) {
      const manualBracket = pickBracket(l.manualDecorationBrackets, total)
      if (manualBracket && manualBracket.unitPrice !== l.manualDecorationPerUnit) {
        nextManualDeco = manualBracket.unitPrice
        manualDecoChanged = true
      }
    }

    if (nextUnitPrice === l.unitPrice && !decorationsChanged && !manualDecoChanged) return l
    return {
      ...l,
      unitPrice: nextUnitPrice,
      decorations: nextDecorations,
      manualDecorationPerUnit: nextManualDeco,
    }
  })
}
