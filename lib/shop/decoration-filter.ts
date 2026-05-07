export interface SwatchFilterable {
  decorationId: string
  snapshotColorSwatchId: string | null
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
