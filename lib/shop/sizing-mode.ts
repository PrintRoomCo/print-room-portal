export type SizingMode = 'multi_size_with_variants' | 'multi_size_variantless' | 'one_size'

/**
 * Which PDP sizing UI to render for a product.
 * - 'one_size': single quantity input, ordered straight off the colourway
 *   variant — needs NO `sizes` row.
 * - 'multi_size_with_variants': per-size quantity grid driven by the `sizes` list.
 * - 'multi_size_variantless': default_sizes grid (no product_variants at all).
 *
 * A product that HAS colourway variants but NO `sizes` rows is treated as
 * one-size: the per-size grid would be empty and un-orderable, whereas a
 * sizeless colourway orders fine through the single-quantity path. This is the
 * 2026-06-30 promo fix (Panama Stylus Pen et al. went live un-orderable because
 * they were `multi_size` with no size row).
 */
export function resolveSizingMode(
  sizingType: string | null | undefined,
  variantCount: number,
  sizeCount: number,
): SizingMode {
  if (sizingType === 'one_size') return 'one_size'
  if (variantCount > 0 && sizeCount === 0) return 'one_size'
  if (variantCount > 0) return 'multi_size_with_variants'
  return 'multi_size_variantless'
}
