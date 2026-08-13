import { describe, expect, it } from 'vitest'
import type { CartLine, CartLineBracket, CartLineDecoration } from '@/lib/cart/types'
import {
  nextArtworkBand,
  nextArtworkBandMessage,
  sameArtworkSavings,
  sameArtworkTooltip,
} from './same-artwork-savings'

const GARMENT: CartLineBracket[] = [
  { minQty: 1, maxQty: 99, unitPrice: 70 },
  { minQty: 100, maxQty: 599, unitPrice: 65 },
  { minQty: 600, maxQty: null, unitPrice: 55 },
]
const ARTWORK: CartLineBracket[] = [
  { minQty: 1, maxQty: 149, unitPrice: 9 },
  { minQty: 150, maxQty: 599, unitPrice: 6 },
  { minQty: 600, maxQty: null, unitPrice: 4 },
]

function deco(over: Partial<CartLineDecoration> = {}): CartLineDecoration {
  return {
    linkId: 'link-a',
    decorationId: 'dec-a',
    name: 'Embroidery — Left Chest',
    method: 'embroidery',
    positionLabel: 'Left chest',
    unitPrice: 4,
    artworkUrl: null,
    snapshotUrl: null,
    brackets: ARTWORK,
    poolable: true,
    ...over,
  }
}

function line(over: Partial<CartLine> = {}): CartLine {
  return {
    lineId: 'l1',
    productId: 'p-hood',
    productName: 'Hood',
    variantId: 'v1',
    variantLabel: 'Black',
    qty: 100,
    unitPrice: 55,
    imageUrl: null,
    decorations: [deco({ pooledQty: 600 })],
    brackets: GARMENT,
    catalogueId: 'cat-1',
    poolingEnabled: true,
    ...over,
  }
}

describe('sameArtworkSavings', () => {
  it('reports the pool and the band the line landed in', () => {
    expect(sameArtworkSavings(line())).toEqual({
      pooledQty: 600,
      bandMinQty: 600,
      decorationName: 'Embroidery — Left Chest',
    })
  })

  it('is silent when the pool is only this line — nothing was earned', () => {
    expect(sameArtworkSavings(line({ qty: 600 }))).toBeNull()
    expect(sameArtworkSavings(line({ qty: 601 }))).toBeNull()
  })

  it('is silent on a line that does not pool at all', () => {
    expect(sameArtworkSavings(line({ decorations: [deco()] }))).toBeNull()
    expect(sameArtworkSavings(line({ decorations: [] }))).toBeNull()
  })

  it('picks the LARGEST pool — the one that actually set the band', () => {
    const savings = sameArtworkSavings(
      line({
        decorations: [
          deco({ decorationId: 'a', name: 'Back print', pooledQty: 150 }),
          deco({ decorationId: 'b', name: 'Left chest', pooledQty: 600 }),
        ],
      }),
    )
    expect(savings?.pooledQty).toBe(600)
    expect(savings?.decorationName).toBe('Left chest')
  })

  it('reports a null band when the line has no garment ladder (legacy line)', () => {
    expect(sameArtworkSavings(line({ brackets: undefined }))?.bandMinQty).toBeNull()
  })
})

describe('sameArtworkTooltip — the specced copy, outcome not formula', () => {
  it('states the outcome verbatim per spec §8', () => {
    expect(sameArtworkTooltip(sameArtworkSavings(line())!)).toBe(
      'This artwork appears on 600 garments in your order, so this line is priced at the 600+ rate. Removing other garments may change this price.',
    )
  })

  it('never exposes per-placement math', () => {
    const copy = sameArtworkTooltip(sameArtworkSavings(line())!)
    expect(copy).not.toMatch(/\$/)
    expect(copy).not.toMatch(/\+ ?\d+\.\d\d/)
  })

  it('degrades gracefully when there is no band to name', () => {
    const savings = sameArtworkSavings(line({ brackets: undefined }))!
    expect(sameArtworkTooltip(savings)).toContain('a better rate')
  })
})

describe('nextArtworkBand', () => {
  it('measures the distance to the nearest cheaper band on EITHER ladder', () => {
    // Pool 120: the artwork ladder next drops at 150, the garment ladder at 600.
    const next = nextArtworkBand(line({ qty: 40, decorations: [deco({ pooledQty: 120 })] }))
    expect(next).toEqual({ unitsToNext: 30, decorationName: 'Embroidery — Left Chest' })
  })

  it('uses the garment ladder when it is the nearer break', () => {
    // Pool 560: artwork already at its 150-599 band, next drop 600 on both.
    const next = nextArtworkBand(line({ qty: 40, decorations: [deco({ pooledQty: 560 })] }))
    expect(next?.unitsToNext).toBe(40)
  })

  it('is silent at the top band — there is nothing left to reach', () => {
    expect(nextArtworkBand(line({ decorations: [deco({ pooledQty: 600 })] }))).toBeNull()
    expect(nextArtworkBand(line({ decorations: [deco({ pooledQty: 5000 })] }))).toBeNull()
  })

  it('skips same-price band boundaries, which are not a saving', () => {
    const flat: CartLineBracket[] = [
      { minQty: 1, maxQty: 99, unitPrice: 10 },
      { minQty: 100, maxQty: 199, unitPrice: 10 },
      { minQty: 200, maxQty: null, unitPrice: 8 },
    ]
    const next = nextArtworkBand(
      line({ qty: 10, brackets: flat, decorations: [deco({ pooledQty: 50, brackets: flat })] }),
    )
    expect(next?.unitsToNext).toBe(150)
  })

  it('is silent on a line that does not pool', () => {
    expect(nextArtworkBand(line({ decorations: [deco()] }))).toBeNull()
  })
})

describe('nextArtworkBandMessage', () => {
  it('matches the specced nudge copy', () => {
    expect(nextArtworkBandMessage({ unitsToNext: 30, decorationName: 'x' })).toBe(
      'Add 30 more garments with this artwork to reach the next price break',
    )
  })

  it('says garment, singular, for one', () => {
    expect(nextArtworkBandMessage({ unitsToNext: 1, decorationName: 'x' })).toBe(
      'Add 1 more garment with this artwork to reach the next price break',
    )
  })
})
