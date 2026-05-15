import { describe, expect, it } from 'vitest'
import {
  pickBracket,
  recomputeProductTierPrices,
  type CartLine,
  type CartLineBracket,
} from './types'

const brackets: CartLineBracket[] = [
  { minQty: 1, maxQty: 49, unitPrice: 30 },
  { minQty: 50, maxQty: 99, unitPrice: 25 },
  { minQty: 100, maxQty: null, unitPrice: 20 },
]

describe('pickBracket', () => {
  it('matches the exact min of a bracket', () => {
    expect(pickBracket(brackets, 1)?.unitPrice).toBe(30)
    expect(pickBracket(brackets, 50)?.unitPrice).toBe(25)
    expect(pickBracket(brackets, 100)?.unitPrice).toBe(20)
  })

  it('matches the exact max of a bracket', () => {
    expect(pickBracket(brackets, 49)?.unitPrice).toBe(30)
    expect(pickBracket(brackets, 99)?.unitPrice).toBe(25)
  })

  it('matches qty in the middle of a bracket', () => {
    expect(pickBracket(brackets, 24)?.unitPrice).toBe(30)
    expect(pickBracket(brackets, 75)?.unitPrice).toBe(25)
    expect(pickBracket(brackets, 500)?.unitPrice).toBe(20)
  })

  it('honours the unbounded tail bucket (maxQty = null)', () => {
    expect(pickBracket(brackets, 100)?.unitPrice).toBe(20)
    expect(pickBracket(brackets, 100_000)?.unitPrice).toBe(20)
  })

  it('returns null when no bracket covers the qty', () => {
    // qty=0 falls below the first bracket's minQty=1
    expect(pickBracket(brackets, 0)).toBeNull()
  })

  it('returns null for undefined / empty brackets (legacy cart line)', () => {
    expect(pickBracket(undefined, 50)).toBeNull()
    expect(pickBracket([], 50)).toBeNull()
  })
})

function line(opts: {
  lineId: string
  productId: string
  variantId?: string
  variantLabel?: string
  qty: number
  unitPrice: number
  brackets?: CartLineBracket[] | undefined
}): CartLine {
  return {
    lineId: opts.lineId,
    productId: opts.productId,
    productName: 'Tee',
    variantId: opts.variantId ?? '',
    variantLabel: opts.variantLabel ?? '—',
    qty: opts.qty,
    unitPrice: opts.unitPrice,
    imageUrl: null,
    decorations: [],
    brackets: opts.brackets,
  }
}

describe('recomputeProductTierPrices', () => {
  it('drops a single-line product to the lower tier when qty falls', () => {
    const before = [line({ lineId: 'l1', productId: 'p1', qty: 24, unitPrice: 20, brackets })]
    const after = recomputeProductTierPrices(before)
    expect(after[0].unitPrice).toBe(30) // 24 in 1-49
  })

  it('lifts a single-line product when qty climbs', () => {
    const before = [line({ lineId: 'l1', productId: 'p1', qty: 60, unitPrice: 30, brackets })]
    const after = recomputeProductTierPrices(before)
    expect(after[0].unitPrice).toBe(25) // 60 in 50-99
  })

  it('prices multi-size lines off the SUM qty across the same productId', () => {
    // 1 + 7 + 5 + 110 = 123 -> 100+ bucket -> all four lines $20.
    const before = [
      line({ lineId: 'a', productId: 'p1', variantId: 'S', qty: 1, unitPrice: 99, brackets }),
      line({ lineId: 'b', productId: 'p1', variantId: 'M', qty: 7, unitPrice: 99, brackets }),
      line({ lineId: 'c', productId: 'p1', variantId: 'L', qty: 5, unitPrice: 99, brackets }),
      line({ lineId: 'd', productId: 'p1', variantId: 'XL', qty: 110, unitPrice: 99, brackets }),
    ]
    const after = recomputeProductTierPrices(before)
    for (const l of after) expect(l.unitPrice).toBe(20)
  })

  it('re-tiers every same-product line when one line edits qty down', () => {
    // Start: 1+7+5+110 = 123 -> 100+ tier @ $20. User edits XL from 110 -> 26.
    // New total: 1+7+5+26 = 39 -> 1-49 tier @ $30. All four lines should be $30.
    const before = [
      line({ lineId: 'a', productId: 'p1', variantId: 'S', qty: 1, unitPrice: 20, brackets }),
      line({ lineId: 'b', productId: 'p1', variantId: 'M', qty: 7, unitPrice: 20, brackets }),
      line({ lineId: 'c', productId: 'p1', variantId: 'L', qty: 5, unitPrice: 20, brackets }),
      line({ lineId: 'd', productId: 'p1', variantId: 'XL', qty: 26, unitPrice: 20, brackets }),
    ]
    const after = recomputeProductTierPrices(before)
    for (const l of after) expect(l.unitPrice).toBe(30)
  })

  it('does not mix tiers across distinct productIds', () => {
    // p1 totals 100 -> $20. p2 totals 5 -> $30.
    const before = [
      line({ lineId: 'a', productId: 'p1', qty: 100, unitPrice: 99, brackets }),
      line({ lineId: 'b', productId: 'p2', qty: 5, unitPrice: 99, brackets }),
    ]
    const after = recomputeProductTierPrices(before)
    expect(after[0].unitPrice).toBe(20)
    expect(after[1].unitPrice).toBe(30)
  })

  it('leaves legacy lines without brackets untouched', () => {
    const before = [
      line({ lineId: 'a', productId: 'p1', qty: 100, unitPrice: 99, brackets: undefined }),
    ]
    const after = recomputeProductTierPrices(before)
    expect(after[0].unitPrice).toBe(99)
  })

  it('returns the same line reference when no recalc is needed (referential equality)', () => {
    const stable = line({ lineId: 'a', productId: 'p1', qty: 100, unitPrice: 20, brackets })
    const after = recomputeProductTierPrices([stable])
    expect(after[0]).toBe(stable)
  })
})
