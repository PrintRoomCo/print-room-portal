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

/**
 * Apply the staff-authored display ORDER to the Volume-pricing widget bands.
 *
 * `order` (b2b_catalogue_items.volume_display_band_order) is an ordered list of
 * band `min_quantity` values, set by dragging rows in the staff item editor's
 * Pricing table. Bands whose min_quantity appears in it lead, in that order;
 * every other band follows in its incoming order (ascending min_quantity). An
 * empty/absent order returns the bands untouched.
 *
 * DISPLAY ONLY, exactly like {@link hideVolumeDisplayBands} — the cart keeps the
 * full, ascending bracket snapshot, so the price paid at any qty and the MOQ are
 * unchanged by reordering.
 *
 * A min_quantity in `order` matching no band is inert: the array is keyed on
 * From qty and goes stale when staff edit a band's From qty, so a stale entry
 * must degrade to "unordered", never drop a band.
 */
export function orderVolumeDisplayBands<T extends DisplayBracket>(
  brackets: T[],
  order: number[] | null | undefined,
): T[] {
  if (!order || order.length === 0) return brackets
  const rank = new Map<number, number>()
  order.forEach((min, i) => {
    if (!rank.has(min)) rank.set(min, i)
  })
  return brackets
    .map((bracket, i) => ({ bracket, i, rank: rank.get(bracket.min_quantity) ?? Infinity }))
    .sort((a, b) => (a.rank === b.rank ? a.i - b.i : a.rank - b.rank))
    .map((entry) => entry.bracket)
}
