import { describe, it, expect } from 'vitest'
import {
  lineSignature,
  recomputeProductTierPrices,
  type CartLine,
  type CartLineBracket,
  type CartLineDecoration,
} from '../types'

describe('lineSignature', () => {
  const noDeco: CartLineDecoration[] = []

  it('matches same product + same variantId + same label + same decorations', () => {
    expect(lineSignature('p1', 'v1', 'Black / M', noDeco))
      .toBe(lineSignature('p1', 'v1', 'Black / M', noDeco))
  })

  it('differs when variantId differs', () => {
    expect(lineSignature('p1', 'v1', '—', noDeco))
      .not.toBe(lineSignature('p1', 'v2', '—', noDeco))
  })

  it('differs when label differs even if variantId matches (variantless case)', () => {
    expect(lineSignature('p1', '', 'S', noDeco))
      .not.toBe(lineSignature('p1', '', 'M', noDeco))
  })

  it('differs when decoration set differs', () => {
    const a: CartLineDecoration[] = [{ linkId: 'l1' } as CartLineDecoration]
    const b: CartLineDecoration[] = [{ linkId: 'l2' } as CartLineDecoration]
    expect(lineSignature('p1', 'v1', '—', a))
      .not.toBe(lineSignature('p1', 'v1', '—', b))
  })

  it('differs when fulfilment type differs', () => {
    expect(lineSignature('p1', 'v1', 'Black / M', noDeco, 'stocked'))
      .not.toBe(lineSignature('p1', 'v1', 'Black / M', noDeco, 'make_to_stock'))
  })
})

describe('recomputeProductTierPrices', () => {
  // Canonical garment ladder used by every test below. Maps the price drop
  // pattern from the live engine: small qty = high amortization, qty 1000+ = cheap.
  const ladder: CartLineBracket[] = [
    { minQty: 24, maxQty: 49, unitPrice: 14.14 },
    { minQty: 50, maxQty: 99, unitPrice: 12.54 },
    { minQty: 100, maxQty: 249, unitPrice: 11.24 },
    { minQty: 250, maxQty: 499, unitPrice: 10.44 },
    { minQty: 500, maxQty: 999, unitPrice: 9.79 },
    { minQty: 1000, maxQty: null, unitPrice: 9.43 },
  ]

  const decoLadder: CartLineBracket[] = [
    { minQty: 24, maxQty: 49, unitPrice: 5.0 },
    { minQty: 50, maxQty: 99, unitPrice: 4.0 },
    { minQty: 100, maxQty: 499, unitPrice: 3.0 },
    { minQty: 500, maxQty: null, unitPrice: 2.5 },
  ]

  function deco(linkId: string, unitPrice = 5.0, brackets?: CartLineBracket[]): CartLineDecoration {
    return {
      linkId,
      decorationId: `od:${linkId}`,
      name: `deco-${linkId}`,
      method: 'screenprint',
      positionLabel: 'LC',
      unitPrice,
      artworkUrl: 'https://example/art.png',
      snapshotUrl: null,
      brackets,
    }
  }

  function line(over: Partial<CartLine>): CartLine {
    return {
      lineId: over.lineId ?? `l-${Math.random()}`,
      productId: over.productId ?? 'p-staple',
      productName: over.productName ?? 'Staple Tee',
      variantId: over.variantId ?? 'v1',
      variantLabel: over.variantLabel ?? 'Bone / XS',
      qty: over.qty ?? 25,
      unitPrice: over.unitPrice ?? 14.14,
      imageUrl: null,
      decorations: over.decorations ?? [],
      // Preserve explicit `brackets: undefined` so legacy-line tests work.
      brackets: 'brackets' in over ? over.brackets : ladder,
      fulfilmentType: over.fulfilmentType,
    }
  }

  it('same product + same signature + different variantLabel: aggregate qty for tier', () => {
    const lines = [
      line({ lineId: 'a', qty: 25, variantLabel: 'Bone / XS', unitPrice: 14.14 }),
      line({ lineId: 'b', qty: 1000, variantLabel: 'Bone / 2XL', unitPrice: 9.43 }),
    ]
    const out = recomputeProductTierPrices(lines)
    expect(out[0].unitPrice).toBe(9.43)
    expect(out[1].unitPrice).toBe(9.43)
  })

  it('same product + same signature + different fulfilmentType: aggregate qty for tier', () => {
    const lines = [
      line({ lineId: 'a', qty: 50, fulfilmentType: 'stocked', unitPrice: 12.54 }),
      line({ lineId: 'b', qty: 50, fulfilmentType: 'make_to_stock', unitPrice: 12.54 }),
    ]
    const out = recomputeProductTierPrices(lines)
    expect(out[0].unitPrice).toBe(11.24)
    expect(out[1].unitPrice).toBe(11.24)
  })

  it('same product + different decoration signatures: do not aggregate', () => {
    const lines = [
      line({ lineId: 'a', qty: 25, decorations: [deco('l1')], unitPrice: 14.14 }),
      line({ lineId: 'b', qty: 1000, decorations: [deco('l2')], unitPrice: 9.43 }),
    ]
    const out = recomputeProductTierPrices(lines)
    // qty 25 alone → 24-tier; qty 1000 alone → 1000-tier.
    expect(out[0].unitPrice).toBe(14.14)
    expect(out[1].unitPrice).toBe(9.43)
  })

  it('multi-decoration combos: byte-identical signature → aggregate; subset → split', () => {
    const both = [deco('lA'), deco('lB')]
    const subset = [deco('lA')]
    const lines = [
      line({ lineId: 'a', qty: 50, decorations: both, unitPrice: 12.54 }),
      line({ lineId: 'b', qty: 50, decorations: both, unitPrice: 12.54 }),
      line({ lineId: 'c', qty: 50, decorations: subset, unitPrice: 12.54 }),
    ]
    const out = recomputeProductTierPrices(lines)
    // lines a+b share signature → aggregate 100 → 100-tier; c is alone at qty 50.
    expect(out[0].unitPrice).toBe(11.24)
    expect(out[1].unitPrice).toBe(11.24)
    expect(out[2].unitPrice).toBe(12.54)
  })

  it('garment-only lines (empty signature) aggregate with each other', () => {
    const lines = [
      line({ lineId: 'a', qty: 50, unitPrice: 12.54 }),
      line({ lineId: 'b', qty: 50, unitPrice: 12.54 }),
    ]
    const out = recomputeProductTierPrices(lines)
    expect(out[0].unitPrice).toBe(11.24)
    expect(out[1].unitPrice).toBe(11.24)
  })

  it('different products never aggregate, even with identical signature', () => {
    const sharedDeco = [deco('l1')]
    const lines = [
      line({ lineId: 'a', productId: 'p-staple', qty: 25, decorations: sharedDeco, unitPrice: 14.14 }),
      line({ lineId: 'b', productId: 'p-hoodie', qty: 1000, decorations: sharedDeco, unitPrice: 9.43 }),
    ]
    const out = recomputeProductTierPrices(lines)
    expect(out[0].unitPrice).toBe(14.14)
    expect(out[1].unitPrice).toBe(9.43)
  })

  it('decoration without brackets stays frozen even as aggregate qty changes', () => {
    const frozenDeco = deco('l1', 3.5) // no brackets
    const lines = [
      line({ lineId: 'a', qty: 50, decorations: [frozenDeco], unitPrice: 12.54 }),
      line({ lineId: 'b', qty: 50, decorations: [frozenDeco], unitPrice: 12.54 }),
    ]
    const out = recomputeProductTierPrices(lines)
    // Garment re-tiers, decoration stays at 3.5.
    expect(out[0].unitPrice).toBe(11.24)
    expect(out[0].decorations[0].unitPrice).toBe(3.5)
    expect(out[1].decorations[0].unitPrice).toBe(3.5)
  })

  it('decoration with brackets re-tiers on aggregate qty', () => {
    const tieredDeco = deco('l1', 5.0, decoLadder)
    const lines = [
      line({ lineId: 'a', qty: 60, decorations: [tieredDeco], unitPrice: 12.54 }),
      line({ lineId: 'b', qty: 60, decorations: [tieredDeco], unitPrice: 12.54 }),
    ]
    const out = recomputeProductTierPrices(lines)
    // Aggregate qty 120 → garment 100-tier ($11.24), deco 100-tier ($3.0).
    expect(out[0].unitPrice).toBe(11.24)
    expect(out[0].decorations[0].unitPrice).toBe(3.0)
    expect(out[1].decorations[0].unitPrice).toBe(3.0)
  })

  it('aggregate qty crossing tier boundary mid-mutation re-tiers correctly', () => {
    // Simulate a user editing one line's qty from 24 → 1000. We just run
    // recomputeProductTierPrices on the post-mutation state and confirm both
    // lines land on the qty-1025 band.
    const before = [
      line({ lineId: 'a', qty: 25, unitPrice: 14.14 }),
      line({ lineId: 'b', qty: 24, unitPrice: 14.14 }),
    ]
    const beforeOut = recomputeProductTierPrices(before)
    // Aggregate 49 → 24-tier on both.
    expect(beforeOut[0].unitPrice).toBe(14.14)
    expect(beforeOut[1].unitPrice).toBe(14.14)

    const afterEdit = [
      { ...beforeOut[0] },
      { ...beforeOut[1], qty: 1000 },
    ]
    const out = recomputeProductTierPrices(afterEdit)
    // Aggregate 1025 → 1000-tier on both.
    expect(out[0].unitPrice).toBe(9.43)
    expect(out[1].unitPrice).toBe(9.43)
  })

  it('removing a line re-tiers survivors back down', () => {
    const lines = [
      line({ lineId: 'a', qty: 25, unitPrice: 9.43 }),
      line({ lineId: 'b', qty: 1000, unitPrice: 9.43 }),
    ]
    // Pre-removal: both at 1025-tier.
    const pre = recomputeProductTierPrices(lines)
    expect(pre[0].unitPrice).toBe(9.43)

    // Remove line b, keep only the qty-25 line. Survivor falls back to 24-tier.
    const survivors = recomputeProductTierPrices([pre[0]])
    expect(survivors[0].unitPrice).toBe(14.14)
  })

  it('no-op on lines with no brackets snapshot (legacy persisted lines)', () => {
    const lines = [
      line({ lineId: 'a', qty: 1000, unitPrice: 12.0, brackets: undefined }),
    ]
    const out = recomputeProductTierPrices(lines)
    expect(out[0].unitPrice).toBe(12.0)
    expect(out[0]).toBe(lines[0]) // unchanged reference
  })
})
