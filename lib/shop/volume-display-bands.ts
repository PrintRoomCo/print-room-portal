export interface DisplayBracket {
  min_quantity: number
  max_quantity: number | null
  unit_price: number
}

/**
 * Hide bands from the customer "Volume pricing" widget by their `min_quantity`
 * (the staff-set per-band Display toggles). DISPLAY ONLY — the cart and
 * checkout keep the full bracket set, so the unit price a customer pays at any
 * qty, and the MOQ, are unchanged; this only changes which bands are shown.
 *
 * A null/empty hidden set returns the bands untouched (full ladder). A hidden
 * min that matches no band is inert.
 */
export function hideVolumeDisplayBands<T extends DisplayBracket>(
  brackets: T[],
  hiddenMins: number[] | null | undefined,
): T[] {
  if (!hiddenMins || hiddenMins.length === 0) return brackets
  const hidden = new Set(hiddenMins)
  return brackets.filter((b) => !hidden.has(b.min_quantity))
}
