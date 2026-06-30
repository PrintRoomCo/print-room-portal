import { describe, it, expect } from 'vitest'
import { resolveSizingMode } from '../sizing-mode'

describe('resolveSizingMode', () => {
  it('explicit one_size always wins', () => {
    expect(resolveSizingMode('one_size', 5, 9)).toBe('one_size')
  })
  it('variants but ZERO sizes → one_size (the 2026-06-30 promo bug shape)', () => {
    expect(resolveSizingMode('multi_size', 1, 0)).toBe('one_size')
  })
  it('variants AND sizes → multi_size_with_variants', () => {
    expect(resolveSizingMode('multi_size', 1, 3)).toBe('multi_size_with_variants')
  })
  it('no variants → multi_size_variantless', () => {
    expect(resolveSizingMode('multi_size', 0, 0)).toBe('multi_size_variantless')
  })
  it('null sizing_type with variants + no sizes → one_size', () => {
    expect(resolveSizingMode(null, 2, 0)).toBe('one_size')
  })
})
