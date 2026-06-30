export interface DisplayBracket {
  min_quantity: number
  max_quantity: number | null
  unit_price: number
}

/**
 * Relabel the customer-facing "Volume pricing" widget so its ladder appears to
 * start at `floorQty` (e.g. advertise from 100). DISPLAY ONLY — the cart and
 * checkout keep the full bracket set, so the unit price a customer pays at any
 * qty, and the MOQ, are unchanged; this only changes which/how bands are shown.
 *
 * Bands entirely below the floor are hidden; the band that straddles the floor
 * has its shown lower bound clamped up to it (24–249 with floor 100 → 100–249).
 * A null/0 floor returns the bands untouched.
 */
export function applyVolumeDisplayFloor<T extends DisplayBracket>(
  brackets: T[],
  floorQty: number | null | undefined,
): T[] {
  if (floorQty == null || floorQty <= 0) return brackets
  return brackets
    .filter((b) => b.max_quantity == null || b.max_quantity >= floorQty)
    .map((b) => (b.min_quantity < floorQty ? { ...b, min_quantity: floorQty } : b))
}
