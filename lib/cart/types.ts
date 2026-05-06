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
}

export interface CartState {
  lines: CartLine[]
}

/** Total decoration price per garment for a given cart line. */
export function decorationPerUnit(line: CartLine): number {
  return line.decorations.reduce((sum, d) => sum + d.unitPrice, 0)
}

/** Stable signature for matching lines on add: same product+variant+decoration set merges quantity. */
export function decorationSignature(decorations: CartLineDecoration[]): string {
  if (decorations.length === 0) return ''
  return decorations
    .map((d) => d.linkId)
    .slice()
    .sort()
    .join('|')
}
