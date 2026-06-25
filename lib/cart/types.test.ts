import { describe, expect, it } from 'vitest'
import {
  cartLineDisplayImageUrl,
  isGenericCustomDecorationName,
  pickBracket,
  recomputeProductTierPrices,
  type CartLine,
  type CartLineBracket,
  type CartLineDecoration,
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
  decorations?: CartLineDecoration[]
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
    decorations: opts.decorations ?? [],
    brackets: opts.brackets,
  }
}

function deco(opts: {
  linkId?: string
  unitPrice: number
  brackets?: CartLineBracket[]
}): CartLineDecoration {
  return {
    linkId: opts.linkId ?? 'link-1',
    decorationId: 'deco-1',
    name: 'Screen print — Front',
    method: 'screenprint',
    positionLabel: 'Front',
    unitPrice: opts.unitPrice,
    artworkUrl: '',
    snapshotUrl: null,
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

  it("re-tiers a decoration's unitPrice from its own brackets at total product qty", () => {
    // TPRC scenario: garment is flat (no brackets), decoration has qty bands.
    // Line was added at qty 50 (deco $6.62/unit); user edits qty down to 24.
    // Decoration should re-pick the 1-23/24-49 band ($12.49), not stay frozen.
    const decoBrackets: CartLineBracket[] = [
      { minQty: 1, maxQty: 23, unitPrice: 12.49 },
      { minQty: 24, maxQty: 49, unitPrice: 12.49 },
      { minQty: 50, maxQty: 99, unitPrice: 6.62 },
      { minQty: 100, maxQty: null, unitPrice: 4.79 },
    ]
    const before = [
      line({
        lineId: 'a',
        productId: 'p1',
        qty: 24,
        unitPrice: 7.25,
        brackets: undefined, // flat-price garment, no item-tier ladder
        decorations: [deco({ unitPrice: 6.62, brackets: decoBrackets })],
      }),
    ]
    const after = recomputeProductTierPrices(before)
    expect(after[0].decorations[0].unitPrice).toBe(12.49)
    // Garment side stays put (no brackets to re-pick from).
    expect(after[0].unitPrice).toBe(7.25)
  })

  it('re-tiers a decoration when qty climbs into a cheaper band', () => {
    const decoBrackets: CartLineBracket[] = [
      { minQty: 1, maxQty: 49, unitPrice: 12.49 },
      { minQty: 50, maxQty: 99, unitPrice: 6.62 },
      { minQty: 100, maxQty: null, unitPrice: 4.79 },
    ]
    const before = [
      line({
        lineId: 'a',
        productId: 'p1',
        qty: 120,
        unitPrice: 20,
        brackets,
        decorations: [deco({ unitPrice: 12.49, brackets: decoBrackets })],
      }),
    ]
    const after = recomputeProductTierPrices(before)
    expect(after[0].unitPrice).toBe(20) // 120 in 100+ garment bucket
    expect(after[0].decorations[0].unitPrice).toBe(4.79)
  })

  it('uses summed cross-line product qty when re-tiering decoration price', () => {
    // Mirrors the existing garment-side behaviour: a multi-size order
    // tiers on the run total, not the per-size qty.
    const decoBrackets: CartLineBracket[] = [
      { minQty: 1, maxQty: 49, unitPrice: 12.49 },
      { minQty: 50, maxQty: 99, unitPrice: 6.62 },
      { minQty: 100, maxQty: null, unitPrice: 4.79 },
    ]
    const before = [
      line({
        lineId: 'a',
        productId: 'p1',
        variantId: 'S',
        qty: 30,
        unitPrice: 99,
        decorations: [deco({ unitPrice: 12.49, brackets: decoBrackets })],
      }),
      line({
        lineId: 'b',
        productId: 'p1',
        variantId: 'M',
        qty: 80,
        unitPrice: 99,
        decorations: [deco({ unitPrice: 12.49, brackets: decoBrackets })],
      }),
    ]
    const after = recomputeProductTierPrices(before)
    // Total 110 → 100+ band → both decoration lines $4.79.
    for (const l of after) expect(l.decorations[0].unitPrice).toBe(4.79)
  })

  it('leaves decorations without brackets frozen (legacy / non-tiered methods)', () => {
    const before = [
      line({
        lineId: 'a',
        productId: 'p1',
        qty: 200,
        unitPrice: 20,
        brackets,
        decorations: [deco({ unitPrice: 8.5, brackets: undefined })],
      }),
    ]
    const after = recomputeProductTierPrices(before)
    expect(after[0].decorations[0].unitPrice).toBe(8.5)
  })

  it('returns the same line reference when only a no-op decoration check runs', () => {
    const decoBrackets: CartLineBracket[] = [
      { minQty: 1, maxQty: 49, unitPrice: 12.49 },
    ]
    // qty=10 sits in the 1-49 garment band (unitPrice 30) and the 1-49 deco
    // band (12.49). Both checks are no-ops → same reference returned.
    const stable = line({
      lineId: 'a',
      productId: 'p1',
      qty: 10,
      unitPrice: 30,
      brackets,
      decorations: [deco({ unitPrice: 12.49, brackets: decoBrackets })],
    })
    const after = recomputeProductTierPrices([stable])
    expect(after[0]).toBe(stable)
  })
})

describe('cartLineDisplayImageUrl', () => {
  it('prefers the designer snapshot over the stored blank product image', () => {
    expect(
      cartLineDisplayImageUrl({
        imageUrl: 'https://cdn.example/blank-tee.jpg',
        decorations: [{ snapshotUrl: 'https://cdn.example/designer-snapshot.png' }],
      }),
    ).toBe('https://cdn.example/designer-snapshot.png')
  })

  it('uses the catalogue front image before the stored product fallback', () => {
    expect(
      cartLineDisplayImageUrl(
        {
          imageUrl: 'https://cdn.example/marketing.jpg',
          decorations: [],
        },
        { catalogueFrontImageUrl: 'https://cdn.example/front.png' },
      ),
    ).toBe('https://cdn.example/front.png')
  })
})

describe('isGenericCustomDecorationName', () => {
  it('matches only the generic custom decoration label', () => {
    expect(isGenericCustomDecorationName('Custom decoration')).toBe(true)
    expect(isGenericCustomDecorationName(' custom decoration ')).toBe(true)
    expect(isGenericCustomDecorationName('Front logo')).toBe(false)
    expect(isGenericCustomDecorationName(null)).toBe(false)
  })
})
