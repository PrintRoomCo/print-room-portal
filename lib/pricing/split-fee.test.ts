import { describe, it, expect } from 'vitest'
  import { splitFeeForSkuCount, distinctSkuCount } from './split-fee'

  describe('splitFeeForSkuCount (per-destination band table, NZD)', () => {
    it.each([
      [1, 15], [10, 15],
      [11, 17.5], [20, 17.5],
      [21, 20], [30, 20],
      [31, 22.5], [40, 22.5],
      [41, 30], [47, 30], [50, 30],
      [51, 32.5], [60, 32.5],
      [61, 35],
      [100, 42.5], // extrapolation: 30 + 2.50 per block of 10 past 50
    ])('%d SKUs -> $%d', (skus, fee) => {
      expect(splitFeeForSkuCount(skus)).toBe(fee)
    })

    it('returns 0 for zero/negative/NaN — a destination with no SKUs has no fee', () => {
      expect(splitFeeForSkuCount(0)).toBe(0)
      expect(splitFeeForSkuCount(-3)).toBe(0)
      expect(splitFeeForSkuCount(Number.NaN)).toBe(0)
    })
  })

  describe('distinctSkuCount', () => {
    it('counts distinct product+colourway+size; qty and duplicate lines never matter', () => {
      expect(
        distinctSkuCount([
          { product_id: 'p1', variant_id: 'v1', size_id: 1 },
          { product_id: 'p1', variant_id: 'v1', size_id: 1 }, // same SKU on a second line
          { product_id: 'p1', variant_id: 'v1', size_id: 2 }, // new size
          { product_id: 'p1', variant_id: 'v2', size_id: 1 }, // new colourway
          { product_id: 'p2', variant_id: null, size_id: null }, // sizeless product
        ]),
      ).toBe(4)
    })

    it('treats absent and null identity parts as the same SKU', () => {
      expect(
        distinctSkuCount([
          { product_id: 'p1', variant_id: null, size_id: null },
          { product_id: 'p1' },
        ]),
      ).toBe(1)
    })

    it('returns 0 for an empty destination', () => {
      expect(distinctSkuCount([])).toBe(0)
    })
  })