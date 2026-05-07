export interface SwatchFilterable {
  snapshotColorSwatchId: string | null
}

/**
 * Picks decorations that are visible for the customer's selected colour:
 * a row matches when its swatch id equals the selection, OR when the row
 * predates per-variant scoping (snapshot_color_swatch_id is null).
 */
export function filterDecorationsBySwatch<T extends SwatchFilterable>(
  decorations: readonly T[],
  selectedSwatchId: string | null,
): T[] {
  return decorations.filter(
    (d) =>
      d.snapshotColorSwatchId === selectedSwatchId ||
      d.snapshotColorSwatchId === null,
  )
}
