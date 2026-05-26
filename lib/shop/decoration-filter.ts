export interface SwatchFilterable {
  decorationId: string
  snapshotColorSwatchId: string | null
}

export interface PricedDecorationFilterable extends SwatchFilterable {
  isDefault?: boolean
  sortOrder?: number
}

/**
 * Picks decorations visible for the customer's selected colour and collapses
 * duplicates per `decorationId`: a swatch-specific row beats the "All colours"
 * (null) fallback row when both exist for the same decoration. Without this
 * the same artwork would render twice on swatches that have an override.
 */
export function filterDecorationsBySwatch<T extends SwatchFilterable>(
  decorations: readonly T[],
  selectedSwatchId: string | null,
): T[] {
  const grouped = new Map<string, T[]>()
  for (const d of decorations) {
    if (
      d.snapshotColorSwatchId !== selectedSwatchId &&
      d.snapshotColorSwatchId !== null
    ) {
      continue
    }
    const bucket = grouped.get(d.decorationId)
    if (bucket) bucket.push(d)
    else grouped.set(d.decorationId, [d])
  }

  const result: T[] = []
  for (const rows of grouped.values()) {
    const specific = rows.find((r) => r.snapshotColorSwatchId === selectedSwatchId)
    result.push(specific ?? rows[0])
  }
  return result
}

/**
 * Pricing follows the catalogue decoration attachment, not the availability of
 * a rendered mockup for the active colour. When the same org decoration has
 * multiple swatch-specific snapshot rows, count it once and prefer the row that
 * best matches the active swatch for cart metadata.
 */
export function resolveDecorationsForPricing<T extends PricedDecorationFilterable>(
  decorations: readonly T[],
  selectedSwatchId: string | null,
): T[] {
  const grouped = new Map<string, T[]>()
  for (const d of decorations) {
    const bucket = grouped.get(d.decorationId)
    if (bucket) bucket.push(d)
    else grouped.set(d.decorationId, [d])
  }

  const result: T[] = []
  for (const rows of grouped.values()) {
    const ordered = [...rows].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    result.push(
      ordered.find((r) => r.snapshotColorSwatchId === selectedSwatchId) ??
        ordered.find((r) => r.snapshotColorSwatchId === null) ??
        ordered.find((r) => r.isDefault) ??
        ordered[0],
    )
  }

  return result.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
}
