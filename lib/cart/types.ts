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
  /** raw artwork thumbnail. */
  artworkUrl: string
  /** designer-rendered mockup if present (Phase 8+); null in Phase 5. */
  snapshotUrl: string | null
  /**
   * Decoration's own qty-band ladder, snapshotted at add-time. When present,
   * `recomputeProductTierPrices` re-picks `unitPrice` from this ladder on cart
   * qty edits — matching how the garment tier already re-picks. Absent for
   * legacy lines + decorations without qty-aware pricing (embroidery, heatpress
   * etc.); in those cases unitPrice stays frozen until checkout re-prices.
   */
  brackets?: CartLineBracket[]
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
  qty: number
  unitPrice: number
  imageUrl: string | null
  shipToStoreId?: string | null
  /**
   * Decorations selected on this line at add-time. Empty array = no decoration.
   * The customer multi-picks decorations on the PDP swatch picker; each entry
   * is an immutable snapshot of the decoration as resolved when the line was
   * added. Re-validated on checkout submit.
   */
  decorations: CartLineDecoration[]
  /**
   * 'stocked' — ships from org's existing inventory.
   * 'make_to_stock' — qty exceeds available stock; goes into production and
   * lands in the org's inventory shelf (not direct ship). Absent on legacy
   * persisted lines; treat as 'stocked' when undefined.
   */
  fulfilmentType?: CartLineFulfilmentType
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
   * catalogue identity", same as before). `catalogueVariantLabel` is the skin's
   * label (e.g. "Design A"), DISTINCT from `variantLabel` (size/colour).
   */
  catalogueItemId?: string | null
  catalogueVariantLabel?: string | null
}

export type CartLineFulfilmentType = 'stocked' | 'make_to_stock'

export interface CartState {
  lines: CartLine[]
}

/** Total decoration price per garment for a given cart line. */
export function decorationPerUnit(line: CartLine): number {
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
}): string | null {
  const snapshotUrl = line.decorations?.find((d) => d.snapshotUrl)?.snapshotUrl
  return snapshotUrl ?? line.imageUrl ?? null
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
): string {
  return `${catalogueItemId ?? productId}::${variantId}::${variantLabel}::${fulfilmentType}::${decorationSignature(decorations)}`
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
  return lines.map((l) => {
    const total = totalByKey.get(aggKey(l)) ?? l.qty

    let nextUnitPrice = l.unitPrice
    if (l.brackets && l.brackets.length > 0) {
      const bracket = pickBracket(l.brackets, total)
      if (bracket) nextUnitPrice = bracket.unitPrice
    }

    let nextDecorations: CartLineDecoration[] = l.decorations
    let decorationsChanged = false
    if (l.decorations.length > 0) {
      const remapped = l.decorations.map((d) => {
        if (!d.brackets || d.brackets.length === 0) return d
        const decoBracket = pickBracket(d.brackets, total)
        if (!decoBracket || decoBracket.unitPrice === d.unitPrice) return d
        decorationsChanged = true
        return { ...d, unitPrice: decoBracket.unitPrice }
      })
      if (decorationsChanged) nextDecorations = remapped
    }

    if (nextUnitPrice === l.unitPrice && !decorationsChanged) return l
    return { ...l, unitPrice: nextUnitPrice, decorations: nextDecorations }
  })
}
