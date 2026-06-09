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
  it('shows only the colours added to the product, not all master colours', () => {
    const variants = [
      v({ variant_id: '1', color_swatch_id: 'a', color_label: 'Black', color_position: 0 }),
      v({ variant_id: '2', color_swatch_id: 'b', color_label: 'White', color_position: 1 }),
      v({ variant_id: '3', color_swatch_id: 'c', color_label: 'Ecru', color_position: 2 }),
    ]
    const { colourOptions, variants: out } = resolveColourMatrix(variants, new Set(['a', 'c']))
    expect(colourOptions.map((o) => o.id)).toEqual(['a', 'c'])
    expect(out.map((x) => x.variant_id).sort()).toEqual(['1', '3'])
  })

  it('returns no colours when the product has none added', () => {
    const variants = [v({ variant_id: '1', color_swatch_id: 'a', color_position: 0 })]
    const { colourOptions, variants: out } = resolveColourMatrix(variants, new Set())
    expect(colourOptions).toEqual([])
    expect(out).toEqual([])
  })

  it('orders the added default colour first, then by master position', () => {
    const variants = [
      v({ variant_id: '1', color_swatch_id: 'a', color_position: 5 }),
      v({ variant_id: '2', color_swatch_id: 'b', color_position: 9, catalogue_color_is_default: true }),
      v({ variant_id: '3', color_swatch_id: 'c', color_position: 2 }),
    ]
    const { colourOptions } = resolveColourMatrix(variants, new Set(['a', 'b', 'c']))
    expect(colourOptions.map((o) => o.id)).toEqual(['b', 'c', 'a'])
  })

  it('dedupes an added colour that spans multiple sizes', () => {
    const variants = [
      v({ variant_id: '1', color_swatch_id: 'a', size_id: 1, size_order: 0 }),
      v({ variant_id: '2', color_swatch_id: 'a', size_id: 2, size_order: 1 }),
    ]
    const { colourOptions } = resolveColourMatrix(variants, new Set(['a']))
    expect(colourOptions).toHaveLength(1)
    expect(colourOptions[0]!.id).toBe('a')
  })

  it('carries the swatch image url onto the added colour option', () => {
    const variants = [
      v({ variant_id: '1', color_swatch_id: 'a', color_image_url: 'https://cdn/a.png' }),
      v({ variant_id: '2', color_swatch_id: 'b', color_image_url: null }),
    ]
    const { colourOptions } = resolveColourMatrix(variants, new Set(['a', 'b']))
    expect(colourOptions.find((o) => o.id === 'a')?.imageUrl).toBe('https://cdn/a.png')
    expect(colourOptions.find((o) => o.id === 'b')?.imageUrl).toBeNull()
  })

  it('ignores variants with no colour swatch', () => {
    const variants = [
      v({ variant_id: '1', color_swatch_id: null }),
      v({ variant_id: '2', color_swatch_id: 'a' }),
    ]
    const { colourOptions } = resolveColourMatrix(variants, new Set(['a']))
    expect(colourOptions.map((o) => o.id)).toEqual(['a'])
  })
})
