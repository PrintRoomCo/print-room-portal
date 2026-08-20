export interface VariantAvailability {
  available_qty: number
}

export const NO_AVAILABILITY: VariantAvailability = {
  available_qty: 0,
}

/** Availability map key (colourway model). One stock row per (colourway
 *  variant_id, size_id), so consumers look up `${variant_id}::${size_id}` —
 *  size_id renders as '' when null (sizeless colourway). */
export function availabilityKey(variantId: string, sizeId: number | null): string {
  return `${variantId}::${sizeId ?? ''}`
}
