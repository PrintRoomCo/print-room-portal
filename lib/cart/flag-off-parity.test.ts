import { describe, expect, it } from 'vitest'
import {
  pickBracket,
  recomputeProductTierPrices,
  decorationSignature,
  type CartLine,
  type CartLineDecoration,
} from './types'

/**
 * FLAG-OFF PARITY — the load-bearing guard of the pooled-decoration-pricing
 * release (plan constraint #2).
 *
 * With `decoration_pooling_enabled = false` — the default, and the state of every
 * catalogue at ship time — every code path must produce byte-identical prices to
 * today. This test converts that promise into CI.
 *
 * `legacyRecompute` below is a VERBATIM copy of `recomputeProductTierPrices` as it
 * stood before pooling existed. It is an oracle, not a snapshot: it recomputes the
 * expected answer on every run, so any pooled logic that leaks into the flag-off
 * path diverges here rather than at a customer's checkout. Do not "fix" it to match
 * new behaviour — if this test fails, the production path changed for flag-off
 * carts and that is the bug.
 *
 * Written before the pooled branches were added, and verified green against the
 * pre-pooling implementation.
 */
function legacyRecompute(lines: CartLine[]): CartLine[] {
  const aggKey = (l: CartLine) => `${l.productId}::${decorationSignature(l.decorations)}`
  const totalByKey = new Map<string, number>()
  for (const l of lines) {
    const k = aggKey(l)
    totalByKey.set(k, (totalByKey.get(k) ?? 0) + l.qty)
  }
  return lines.map((l) => {
    const total = totalByKey.get(aggKey(l)) ?? l.qty

    let nextUnitPrice = l.unitPrice
    if (l.brackets && l.brackets.length > 0) {
      const bracket = pickBracket(l.brackets, total)
      if (bracket) nextUnitPrice = bracket.unitPrice
    }

    let nextDecorations: CartLineDecoration[] = l.decorations
    let decorationsChanged = false
    if (l.decorations.length > 0) {
      const remapped = l.decorations.map((d) => {
        if (!d.brackets || d.brackets.length === 0) return d
        const decoBracket = pickBracket(d.brackets, total)
        if (!decoBracket || decoBracket.unitPrice === d.unitPrice) return d
        decorationsChanged = true
        return { ...d, unitPrice: decoBracket.unitPrice }
      })
      if (decorationsChanged) nextDecorations = remapped
    }

    let nextManualDeco = l.manualDecorationPerUnit
    let manualDecoChanged = false
    if (
      l.manualDecorationPerUnit != null &&
      l.manualDecorationBrackets &&
      l.manualDecorationBrackets.length > 0
    ) {
      const manualBracket = pickBracket(l.manualDecorationBrackets, total)
      if (manualBracket && manualBracket.unitPrice !== l.manualDecorationPerUnit) {
        nextManualDeco = manualBracket.unitPrice
        manualDecoChanged = true
      }
    }

    if (nextUnitPrice === l.unitPrice && !decorationsChanged && !manualDecoChanged) return l
    return {
      ...l,
      unitPrice: nextUnitPrice,
      decorations: nextDecorations,
      manualDecorationPerUnit: nextManualDeco,
    }
  })
}

const GARMENT_LADDER = [
  { minQty: 1, maxQty: 23, unitPrice: 42 },
  { minQty: 24, maxQty: 99, unitPrice: 38 },
  { minQty: 100, maxQty: null, unitPrice: 32 },
]
const DECO_LADDER = [
  { minQty: 1, maxQty: 23, unitPrice: 9 },
  { minQty: 24, maxQty: 99, unitPrice: 7 },
  { minQty: 100, maxQty: null, unitPrice: 5 },
]

function deco(over: Partial<CartLineDecoration> = {}): CartLineDecoration {
  return {
    linkId: 'link-a',
    decorationId: 'dec-a',
    name: 'Embroidery — Left Chest',
    method: 'embroidery',
    positionLabel: 'Left chest',
    unitPrice: 9,
    artworkUrl: null,
    snapshotUrl: null,
    brackets: DECO_LADDER,
    ...over,
  }
}

function cartLine(over: Partial<CartLine> & { lineId: string; qty: number }): CartLine {
  return {
    productId: 'prod-tee',
    productName: 'Tee',
    variantId: 'v1',
    variantLabel: 'Black',
    unitPrice: 42,
    imageUrl: null,
    decorations: [],
    brackets: GARMENT_LADDER,
    catalogueItemId: 'item-tee',
    fulfilmentType: 'made_to_order',
    ...over,
  }
}

/**
 * A deliberately awkward cart: every shape the recompute has ever had to handle,
 * in one array. Same-product pooling, cross-product isolation, mismatched
 * decoration signatures, a stocked line sharing a product with a made-to-order
 * line, a manual_final line with its own combined ladder, a bracket-less legacy
 * line, a decoration with no bracket snapshot, and quantities that sit on band
 * edges (23/24, 99/100) where an off-by-one would show.
 */
const FIXTURE: CartLine[] = [
  cartLine({ lineId: 'l1', qty: 20, decorations: [deco()] }),
  cartLine({ lineId: 'l2', qty: 4, variantId: 'v2', variantLabel: 'White', decorations: [deco()] }),
  // Same product, DIFFERENT signature — must not pool with l1/l2.
  cartLine({
    lineId: 'l3',
    qty: 80,
    decorations: [deco({ linkId: 'link-b', decorationId: 'dec-b', name: 'Back print' })],
  }),
  // Different product entirely, same decoration.
  cartLine({
    lineId: 'l4',
    productId: 'prod-hood',
    catalogueItemId: 'item-hood',
    qty: 100,
    unitPrice: 60,
    decorations: [deco()],
    brackets: [
      { minQty: 1, maxQty: 23, unitPrice: 60 },
      { minQty: 24, maxQty: null, unitPrice: 55 },
    ],
  }),
  // Stocked line sharing a product with a made-to-order line — today these DO
  // pool into one tier key, and flag-off parity depends on that staying true.
  cartLine({ lineId: 'l5', productId: 'prod-cap', catalogueItemId: 'item-cap', qty: 3, fulfilmentType: 'stocked', decorations: [] }),
  cartLine({ lineId: 'l6', productId: 'prod-cap', catalogueItemId: 'item-cap', qty: 21, decorations: [] }),
  // manual_final: combined decoration figure with its own ladder.
  cartLine({
    lineId: 'l7',
    productId: 'prod-polo',
    catalogueItemId: 'item-polo',
    qty: 24,
    decorations: [deco({ unitPrice: 0, brackets: undefined })],
    manualDecorationPerUnit: 12,
    manualDecorationBrackets: [
      { minQty: 1, maxQty: 23, unitPrice: 12 },
      { minQty: 24, maxQty: null, unitPrice: 8 },
    ],
  }),
  // Legacy line: no bracket snapshot at all — price must stay frozen.
  cartLine({ lineId: 'l8', productId: 'prod-legacy', qty: 250, unitPrice: 19.5, brackets: undefined, decorations: [] }),
  // Decoration with no bracket snapshot on a line that does have one.
  cartLine({
    lineId: 'l9',
    productId: 'prod-bag',
    catalogueItemId: 'item-bag',
    qty: 100,
    decorations: [deco({ linkId: 'link-c', decorationId: 'dec-c', unitPrice: 4.25, brackets: undefined })],
  }),
]

describe('flag-off parity — cart recompute', () => {
  it('is byte-identical to the pre-pooling implementation when pooling is off', () => {
    expect(recomputeProductTierPrices(FIXTURE)).toEqual(legacyRecompute(FIXTURE))
  })

  it('stays identical with pooling explicitly false and pool fields present', () => {
    // The realistic post-deploy cart: fields ARE snapshotted, flag is off.
    const withFields = FIXTURE.map((l) => ({
      ...l,
      catalogueId: 'cat-1',
      poolingEnabled: false,
      decorations: l.decorations.map((d) => ({ ...d, poolable: true })),
    }))
    expect(recomputeProductTierPrices(withFields)).toEqual(legacyRecompute(withFields))
  })

  it('stays identical for a cart that predates the pool fields entirely', () => {
    // Old persisted cart mid-deploy: no catalogueId, no poolingEnabled, no
    // poolable. Must degrade to today's pricing, not to zero or to pooled.
    const legacyCart = FIXTURE.map((l) => {
      const { catalogueId: _c, poolingEnabled: _p, ...rest } = l as CartLine & {
        catalogueId?: string | null
        poolingEnabled?: boolean
      }
      return rest as CartLine
    })
    expect(recomputeProductTierPrices(legacyCart)).toEqual(legacyRecompute(legacyCart))
  })

  it('preserves referential identity for untouched lines, as today', () => {
    // The recompute returns the SAME object when nothing changed. React consumers
    // depend on this; a pooled rewrite that always spreads would churn renders.
    const out = recomputeProductTierPrices(FIXTURE)
    const legacy = legacyRecompute(FIXTURE)
    for (let i = 0; i < FIXTURE.length; i++) {
      expect(out[i] === FIXTURE[i]).toBe(legacy[i] === FIXTURE[i])
    }
  })

  it('parity holds across qty edits on every band edge', () => {
    for (const qty of [1, 23, 24, 25, 99, 100, 101, 600]) {
      const edited = FIXTURE.map((l) => (l.lineId === 'l1' ? { ...l, qty } : l))
      expect(recomputeProductTierPrices(edited)).toEqual(legacyRecompute(edited))
    }
  })

  it('parity holds after removing each line in turn', () => {
    for (let i = 0; i < FIXTURE.length; i++) {
      const shortened = FIXTURE.filter((_, j) => j !== i)
      expect(recomputeProductTierPrices(shortened)).toEqual(legacyRecompute(shortened))
    }
  })
})
