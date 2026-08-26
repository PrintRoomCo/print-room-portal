import { describe, expect, it } from 'vitest'
import {
  cartLineDisplayImageUrl,
  decorationPerUnit,
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

  it('uses an explicitly resolved catalogue front image before older snapshots', () => {
    expect(
      cartLineDisplayImageUrl(
        {
          imageUrl: 'https://cdn.example/marketing.jpg',
          decorations: [{ snapshotUrl: 'https://cdn.example/stale-snapshot.png' }],
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

describe('recomputeProductTierPrices — pooled decoration pricing', () => {
  // Garment ladders differ per product ON PURPOSE: the spec's rule is that a
  // pooled line jumps to the band the combined order earns but reads the price
  // from ITS OWN ladder. A hood is never priced "as a tee".
  const teeLadder: CartLineBracket[] = [
    { minQty: 1, maxQty: 99, unitPrice: 30 },
    { minQty: 100, maxQty: 599, unitPrice: 25 },
    { minQty: 600, maxQty: null, unitPrice: 20 },
  ]
  const hoodLadder: CartLineBracket[] = [
    { minQty: 1, maxQty: 99, unitPrice: 70 },
    { minQty: 100, maxQty: 599, unitPrice: 65 },
    { minQty: 600, maxQty: null, unitPrice: 55 },
  ]
  const ladderA: CartLineBracket[] = [
    { minQty: 1, maxQty: 149, unitPrice: 9 },
    { minQty: 150, maxQty: 599, unitPrice: 6 },
    { minQty: 600, maxQty: null, unitPrice: 4 },
  ]
  const ladderB: CartLineBracket[] = [
    { minQty: 1, maxQty: 149, unitPrice: 8 },
    { minQty: 150, maxQty: null, unitPrice: 5 },
  ]

  function pooled(opts: {
    lineId: string
    productId: string
    qty: number
    unitPrice: number
    brackets: CartLineBracket[]
    decorations?: CartLineDecoration[]
    poolingEnabled?: boolean
    fulfilmentType?: 'stocked' | 'made_to_order'
  }): CartLine {
    return {
      ...line({
        lineId: opts.lineId,
        productId: opts.productId,
        qty: opts.qty,
        unitPrice: opts.unitPrice,
        brackets: opts.brackets,
        decorations: opts.decorations ?? [],
      }),
      catalogueId: 'cat-1',
      poolingEnabled: opts.poolingEnabled ?? true,
      fulfilmentType: opts.fulfilmentType ?? 'made_to_order',
    }
  }

  function placement(
    decorationId: string,
    unitPrice: number,
    brackets: CartLineBracket[] | undefined,
    poolable = true,
  ): CartLineDecoration {
    return {
      linkId: `link-${decorationId}`,
      decorationId,
      name: decorationId,
      method: 'screenprint',
      positionLabel: 'LC',
      unitPrice,
      artworkUrl: '',
      snapshotUrl: null,
      brackets,
      poolable,
    }
  }

  it('spec example A: 500 tees + 100 hoods on one artwork both band at 600', () => {
    const out = recomputeProductTierPrices([
      pooled({ lineId: 'tee', productId: 'p-tee', qty: 500, unitPrice: 25, brackets: teeLadder, decorations: [placement('A', 9, ladderA)] }),
      pooled({ lineId: 'hood', productId: 'p-hood', qty: 100, unitPrice: 65, brackets: hoodLadder, decorations: [placement('A', 9, ladderA)] }),
    ])
    // Garment: each reads the 600+ row of its OWN ladder.
    expect(out[0].unitPrice).toBe(20)
    expect(out[1].unitPrice).toBe(55)
    // Decoration: both at the pooled 600.
    expect(out[0].decorations[0].unitPrice).toBe(4)
    expect(out[1].decorations[0].unitPrice).toBe(4)
  })

  it('spec example B: mismatched sets — per-decoration pools and the max rule', () => {
    const out = recomputeProductTierPrices([
      pooled({ lineId: 'tee', productId: 'p-tee', qty: 500, unitPrice: 25, brackets: teeLadder, decorations: [placement('A', 9, ladderA)] }),
      pooled({
        lineId: 'hood',
        productId: 'p-hood',
        qty: 100,
        unitPrice: 65,
        brackets: hoodLadder,
        decorations: [placement('A', 9, ladderA), placement('B', 8, ladderB)],
      }),
      pooled({ lineId: 'cap', productId: 'p-cap', qty: 50, unitPrice: 30, brackets: teeLadder, decorations: [placement('B', 8, ladderB)] }),
    ])
    const [tee, hood, cap] = out
    // A pools to 600, B to 150.
    expect(tee.decorations[0].unitPrice).toBe(4) // A @600
    expect(hood.decorations[0].unitPrice).toBe(4) // A @600
    expect(hood.decorations[1].unitPrice).toBe(5) // B @150 — its own smaller pool
    expect(cap.decorations[0].unitPrice).toBe(5) // B @150
    // Garment band: max rule. The hood takes 600 (max of 600, 150)...
    expect(hood.unitPrice).toBe(55)
    // ...and the cap does NOT inherit 600 through the hood. 150 → the 100-599 band.
    expect(cap.unitPrice).toBe(25)
  })

  it('re-bands DOWN when the big line is removed', () => {
    const withTee = [
      pooled({ lineId: 'tee', productId: 'p-tee', qty: 500, unitPrice: 25, brackets: teeLadder, decorations: [placement('A', 9, ladderA)] }),
      pooled({ lineId: 'hood', productId: 'p-hood', qty: 100, unitPrice: 65, brackets: hoodLadder, decorations: [placement('A', 9, ladderA)] }),
    ]
    expect(recomputeProductTierPrices(withTee)[1].unitPrice).toBe(55)
    const hoodAlone = recomputeProductTierPrices(withTee.filter((l) => l.lineId === 'hood'))
    expect(hoodAlone[0].unitPrice).toBe(65) // back to its own 100-599 band
    expect(hoodAlone[0].decorations[0].unitPrice).toBe(9) // A pool now 100
  })

  it('re-bands on a qty edit of a sibling line', () => {
    const base = [
      pooled({ lineId: 'tee', productId: 'p-tee', qty: 40, unitPrice: 30, brackets: teeLadder, decorations: [placement('A', 9, ladderA)] }),
      pooled({ lineId: 'hood', productId: 'p-hood', qty: 40, unitPrice: 70, brackets: hoodLadder, decorations: [placement('A', 9, ladderA)] }),
    ]
    expect(recomputeProductTierPrices(base)[1].unitPrice).toBe(70) // 80 pooled → 1-99
    const bumped = base.map((l) => (l.lineId === 'tee' ? { ...l, qty: 560 } : l))
    expect(recomputeProductTierPrices(bumped)[1].unitPrice).toBe(55) // 600 pooled
  })

  it('stocked lines neither contribute to nor receive a pooled band', () => {
    const out = recomputeProductTierPrices([
      pooled({ lineId: 'stock', productId: 'p-tee', qty: 500, unitPrice: 30, brackets: teeLadder, fulfilmentType: 'stocked', decorations: [placement('A', 9, ladderA)] }),
      pooled({ lineId: 'made', productId: 'p-hood', qty: 100, unitPrice: 70, brackets: hoodLadder, decorations: [placement('A', 9, ladderA)] }),
    ])
    // Does not receive: the stocked line keeps its own-qty band (500 → 100-599).
    expect(out[0].unitPrice).toBe(25)
    expect(out[0].decorations[0].unitPrice).toBe(6) // A at its own 500, not a pool
    // Does not contribute: the made-to-order line sees a pool of 100, not 600.
    expect(out[1].unitPrice).toBe(65)
    expect(out[1].decorations[0].unitPrice).toBe(9)
  })

  it('the $0 custom placeholder never pools', () => {
    const out = recomputeProductTierPrices([
      pooled({ lineId: 'tee', productId: 'p-tee', qty: 500, unitPrice: 25, brackets: teeLadder, decorations: [placement('ph', 0, ladderA, false)] }),
      pooled({ lineId: 'hood', productId: 'p-hood', qty: 100, unitPrice: 65, brackets: hoodLadder, decorations: [placement('ph', 0, ladderA, false)] }),
    ])
    expect(out[1].unitPrice).toBe(65) // own 100, not 600
  })

  it('never pools across catalogues', () => {
    const out = recomputeProductTierPrices([
      pooled({ lineId: 'tee', productId: 'p-tee', qty: 500, unitPrice: 25, brackets: teeLadder, decorations: [placement('A', 9, ladderA)] }),
      { ...pooled({ lineId: 'hood', productId: 'p-hood', qty: 100, unitPrice: 65, brackets: hoodLadder, decorations: [placement('A', 9, ladderA)] }), catalogueId: 'cat-2' },
    ])
    expect(out[1].unitPrice).toBe(65)
  })

  it('pooled manual_final: KEEPS its own combined figure, re-picked at the pooled band', () => {
    // 2026-08-26: pooling moves the QUANTITY and nothing else. A manual_final
    // item's decoration figure is a back-solved residual of one all-in price the
    // AM typed — it stays the price source; only the band it reads moves.
    const manualBrackets: CartLineBracket[] = [
      { minQty: 1, maxQty: 149, unitPrice: 12 },
      { minQty: 150, maxQty: 599, unitPrice: 10 },
      { minQty: 600, maxQty: null, unitPrice: 7 },
    ]
    const [out] = recomputeProductTierPrices([
      {
        ...pooled({
          lineId: 'polo',
          productId: 'p-polo',
          qty: 600,
          unitPrice: 20,
          brackets: teeLadder,
          // A manual PDP snapshots $0 placements with NO ladder (Decision #2):
          // an accidental fallback then yields 0, never a wrong positive number.
          decorations: [placement('A', 0, undefined), placement('B', 0, undefined)],
        }),
        manualDecorationPerUnit: 12,
        manualDecorationBrackets: manualBrackets,
      },
    ])
    // The combined figure survives pooling and re-picks at the 600 band.
    expect(out.manualDecorationPerUnit).toBe(7)
    expect(decorationPerUnit(out)).toBe(7)
    // Per-placement figures stay $0 metadata — no per-decoration ladder money
    // leaks onto a manual line, so an accidental fallback yields 0, not a wrong
    // positive number.
    expect(out.decorations.map((d) => d.unitPrice)).toEqual([0, 0])
  })

  it('pooled manual_final worked example: each line reads its OWN item ladder at band 600', () => {
    // The whole feature in one test. 500 tees + 100 hoods, one shared left-chest
    // print, BOTH manual_final. Each line's decoration comes from its own item's
    // combined ladder at the pooled band 600 — and the two legitimately differ,
    // because an all-in price on a sock is not an all-in price on a hoodie.
    const teeManual: CartLineBracket[] = [
      { minQty: 1, maxQty: 599, unitPrice: 8 },
      { minQty: 600, maxQty: null, unitPrice: 3.5 },
    ]
    const hoodManual: CartLineBracket[] = [
      { minQty: 1, maxQty: 599, unitPrice: 22.5 },
      { minQty: 600, maxQty: null, unitPrice: 9.25 },
    ]
    const out = recomputeProductTierPrices([
      {
        ...pooled({ lineId: 'tee', productId: 'p-tee', qty: 500, unitPrice: 25, brackets: teeLadder, decorations: [placement('A', 0, undefined)] }),
        manualDecorationPerUnit: 8,
        manualDecorationBrackets: teeManual,
      },
      {
        ...pooled({ lineId: 'hood', productId: 'p-hood', qty: 100, unitPrice: 65, brackets: hoodLadder, decorations: [placement('A', 0, undefined)] }),
        manualDecorationPerUnit: 22.5,
        manualDecorationBrackets: hoodManual,
      },
    ])
    // Garment: each at the 600+ row of its OWN ladder (unchanged behaviour).
    expect(out.map((l) => l.unitPrice)).toEqual([20, 55])
    // Decoration: each at the 600+ row of its OWN item ladder. Different figures
    // for the same logo is the INTENT of all-in pricing, not a data defect.
    expect(out.map((l) => l.manualDecorationPerUnit)).toEqual([3.5, 9.25])
    expect(out.map((l) => decorationPerUnit(l))).toEqual([3.5, 9.25])
  })

  it('pooled manual_final re-picks when a SIBLING line\u2019s qty changes', () => {
    const hoodManual: CartLineBracket[] = [
      { minQty: 1, maxQty: 599, unitPrice: 22.5 },
      { minQty: 600, maxQty: null, unitPrice: 9.25 },
    ]
    const hood = {
      ...pooled({ lineId: 'hood', productId: 'p-hood', qty: 100, unitPrice: 65, brackets: hoodLadder, decorations: [placement('A', 0, undefined)] }),
      manualDecorationPerUnit: 22.5,
      manualDecorationBrackets: hoodManual,
    }
    const tee = pooled({ lineId: 'tee', productId: 'p-tee', qty: 100, unitPrice: 65, brackets: teeLadder, decorations: [placement('A', 0, undefined)] })
    // 200 pooled → hood still in its 1-599 band.
    expect(recomputeProductTierPrices([tee, hood])[1].manualDecorationPerUnit).toBe(22.5)
    // Bump the sibling to 500 → 600 pooled → the hood's own 600+ figure.
    const bumped = recomputeProductTierPrices([{ ...tee, qty: 500 }, hood])
    expect(bumped[1].manualDecorationPerUnit).toBe(9.25)
    // ...and back DOWN when the sibling shrinks again.
    const shrunk = recomputeProductTierPrices([{ ...tee, qty: 10 }, bumped[1]])
    expect(shrunk[1].manualDecorationPerUnit).toBe(22.5)
  })

  it('a pooled COMPUTED line is untouched — still Σ per-decoration at each own pool', () => {
    const [out] = recomputeProductTierPrices([
      pooled({
        lineId: 'polo',
        productId: 'p-polo',
        qty: 600,
        unitPrice: 20,
        brackets: teeLadder,
        decorations: [placement('A', 9, ladderA), placement('B', 8, ladderB)],
      }),
    ])
    expect(out.manualDecorationPerUnit).toBeUndefined()
    // Σ per-decoration ladder picks at the pooled qty: A@600 = 4, B@600 → tail = 5.
    expect(out.decorations.map((d) => d.unitPrice)).toEqual([4, 5])
    expect(decorationPerUnit(out)).toBe(9)
  })

  it('a NON-pooled manual_final line keeps the combined figure', () => {
    const [out] = recomputeProductTierPrices([
      {
        ...pooled({ lineId: 'polo', productId: 'p-polo', qty: 600, unitPrice: 20, brackets: teeLadder, poolingEnabled: false }),
        manualDecorationPerUnit: 12,
        manualDecorationBrackets: [
          { minQty: 1, maxQty: 99, unitPrice: 12 },
          { minQty: 100, maxQty: null, unitPrice: 8 },
        ],
      },
    ])
    expect(out.manualDecorationPerUnit).toBe(8)
  })
})
