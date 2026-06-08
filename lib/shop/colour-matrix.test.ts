import { describe, it, expect } from 'vitest'
import { resolveColourMatrix, type MatrixVariant } from './colour-matrix'

function v(
  partial: Partial<MatrixVariant> & { variant_id: string; color_swatch_id: string | null },
): MatrixVariant {
  return {
    color_label: null,
    color_hex: null,
    color_image_url: null,
    color_position: 0,
    catalogue_color_sort_order: null,
    catalogue_color_is_default: false,
    size_id: null,
    size_label: null,
    size_order: 0,
    ...partial,
  }
}

describe('resolveColourMatrix', () => {
  it('lists every master colour even when only some are curated', () => {
    const variants = [
      v({ variant_id: '1', color_swatch_id: 'a', color_label: 'Black', color_position: 0, catalogue_color_sort_order: 0 }),
      v({ variant_id: '2', color_swatch_id: 'b', color_label: 'White', color_position: 1 }),
      v({ variant_id: '3', color_swatch_id: 'c', color_label: 'Ecru', color_position: 2 }),
    ]
    const { colourOptions } = resolveColourMatrix(variants)
    expect(colourOptions.map((o) => o.id)).toEqual(['a', 'b', 'c'])
  })

  it('does not drop non-curated variants from the matrix', () => {
    const variants = [
      v({ variant_id: '1', color_swatch_id: 'a', catalogue_color_sort_order: 0 }),
      v({ variant_id: '2', color_swatch_id: 'b' }),
    ]
    const { variants: out } = resolveColourMatrix(variants)
    expect(out.map((x) => x.variant_id).sort()).toEqual(['1', '2'])
  })

  it('orders the default colour first, then everything by master position', () => {
    // Curation is a subset, so it cannot order the full colour list. The default
    // colour leads; the rest follow supplier (master) position order — curated
    // colours are NOT floated to the front.
    const variants = [
      v({ variant_id: '1', color_swatch_id: 'a', color_position: 5, catalogue_color_sort_order: 0 }),
      v({ variant_id: '2', color_swatch_id: 'b', color_position: 9, catalogue_color_is_default: true }),
      v({ variant_id: '3', color_swatch_id: 'c', color_position: 2 }),
    ]
    const { colourOptions } = resolveColourMatrix(variants)
    expect(colourOptions.map((o) => o.id)).toEqual(['b', 'c', 'a'])
  })

  it('dedupes a colour that spans multiple sizes', () => {
    const variants = [
      v({ variant_id: '1', color_swatch_id: 'a', size_id: 1, size_order: 0 }),
      v({ variant_id: '2', color_swatch_id: 'a', size_id: 2, size_order: 1 }),
    ]
    const { colourOptions } = resolveColourMatrix(variants)
    expect(colourOptions).toHaveLength(1)
    expect(colourOptions[0].id).toBe('a')
  })

  it('carries the swatch image url onto the colour option', () => {
    const variants = [
      v({ variant_id: '1', color_swatch_id: 'a', color_image_url: 'https://cdn/a.png' }),
      v({ variant_id: '2', color_swatch_id: 'b', color_image_url: null }),
    ]
    const { colourOptions } = resolveColourMatrix(variants)
    expect(colourOptions.find((o) => o.id === 'a')?.imageUrl).toBe('https://cdn/a.png')
    expect(colourOptions.find((o) => o.id === 'b')?.imageUrl).toBeNull()
  })

  it('ignores variants with no colour swatch when building options', () => {
    const variants = [
      v({ variant_id: '1', color_swatch_id: null }),
      v({ variant_id: '2', color_swatch_id: 'a' }),
    ]
    const { colourOptions } = resolveColourMatrix(variants)
    expect(colourOptions.map((o) => o.id)).toEqual(['a'])
  })
})
