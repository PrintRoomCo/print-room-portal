import { describe, expect, it } from 'vitest'
import {
  garmentBandQty,
  isPoolingLine,
  poolKey,
  poolSizesForLine,
  pooledDecorationQty,
  pooledQtyByDecoration,
  type PoolingLine,
} from './decoration-pooling'

const CAT = 'cat-1'
const A = 'dec-left-chest-A'
const B = 'dec-back-print-B'

function line(over: Partial<PoolingLine> & { qty: number }): PoolingLine {
  return {
    catalogueId: CAT,
    poolingEnabled: true,
    fulfilmentType: 'made_to_order',
    decorations: [],
    ...over,
  }
}

const dec = (decorationId: string, poolable = true) => ({ decorationId, poolable })

// ───────────────────────────────────────────────────────────────────────────
// Spec §2 worked examples, verbatim.
// ───────────────────────────────────────────────────────────────────────────

describe('spec worked example A — identical decoration set', () => {
  // 500 tees + 100 hoods, both carrying the same left-chest print.
  const tee = line({ qty: 500, decorations: [dec(A)] })
  const hood = line({ qty: 100, decorations: [dec(A)] })
  const pools = pooledQtyByDecoration([tee, hood])

  it('pools decoration A to 600', () => {
    expect(pools.get(poolKey(CAT, A))).toBe(600)
  })

  it('band-selects BOTH lines at 600 — the hood jumps to the 600+ band', () => {
    expect(garmentBandQty(tee, pools, 500)).toBe(600)
    expect(garmentBandQty(hood, pools, 100)).toBe(600)
  })

  it('prices each line’s decoration at the pooled 600, not its own qty', () => {
    expect(pooledDecorationQty(tee, dec(A), pools, 500)).toBe(600)
    expect(pooledDecorationQty(hood, dec(A), pools, 100)).toBe(600)
  })
})

describe('spec worked example B — mismatched decoration sets', () => {
  // Tee x500 (A), Hood x100 (A + B), Cap x50 (B only).
  const tee = line({ qty: 500, decorations: [dec(A)] })
  const hood = line({ qty: 100, decorations: [dec(A), dec(B)] })
  const cap = line({ qty: 50, decorations: [dec(B)] })
  const pools = pooledQtyByDecoration([tee, hood, cap])

  it('pools A to 600 and B to 150', () => {
    expect(pools.get(poolKey(CAT, A))).toBe(600)
    expect(pools.get(poolKey(CAT, B))).toBe(150)
  })

  it('gives the tee band 600, the hood band 600 (max of 600, 150)', () => {
    expect(garmentBandQty(tee, pools, 500)).toBe(600)
    expect(garmentBandQty(hood, pools, 100)).toBe(600)
  })

  it('ANTI-TRANSITIVITY: the cap stays at 150 — it never inherits 600', () => {
    // The hood bridges groups A and B. If the rule were the transitive closure
    // rather than the max over the line's OWN decorations, the cap would ride
    // the tee's 600 band. It must not.
    expect(garmentBandQty(cap, pools, 50)).toBe(150)
  })

  it("prices the hood's two placements at their own pools: A@600 + B@150", () => {
    expect(pooledDecorationQty(hood, dec(A), pools, 100)).toBe(600)
    expect(pooledDecorationQty(hood, dec(B), pools, 100)).toBe(150)
    expect(pooledDecorationQty(cap, dec(B), pools, 50)).toBe(150)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Eligibility (spec §5).
// ───────────────────────────────────────────────────────────────────────────

describe('eligibility — what pools and what does not', () => {
  it('a line in a catalogue with pooling off neither contributes nor receives', () => {
    const off = line({ qty: 500, poolingEnabled: false, decorations: [dec(A)] })
    const on = line({ qty: 100, decorations: [dec(A)] })
    const pools = pooledQtyByDecoration([off, on])
    expect(pools.get(poolKey(CAT, A))).toBe(100)
    expect(garmentBandQty(off, pools, 500)).toBe(500)
    expect(garmentBandQty(on, pools, 100)).toBe(100)
  })

  it('never pools across catalogues', () => {
    const here = line({ qty: 500, decorations: [dec(A)] })
    const elsewhere = line({ qty: 100, catalogueId: 'cat-2', decorations: [dec(A)] })
    const pools = pooledQtyByDecoration([here, elsewhere])
    expect(pools.get(poolKey(CAT, A))).toBe(500)
    expect(pools.get(poolKey('cat-2', A))).toBe(100)
    expect(garmentBandQty(here, pools, 500)).toBe(500)
  })

  it('a non-poolable decoration (the $0 custom placeholder) pools nothing', () => {
    const tee = line({ qty: 500, decorations: [dec('placeholder', false)] })
    const hood = line({ qty: 100, decorations: [dec('placeholder', false)] })
    const pools = pooledQtyByDecoration([tee, hood])
    expect(pools.size).toBe(0)
    expect(garmentBandQty(hood, pools, 100)).toBe(100)
    expect(pooledDecorationQty(hood, dec('placeholder', false), pools, 100)).toBe(100)
  })

  it('legacy lines whose decorations carry no poolable flag never pool', () => {
    const legacy = line({ qty: 500, decorations: [{ decorationId: A }] })
    const modern = line({ qty: 100, decorations: [dec(A)] })
    const pools = pooledQtyByDecoration([legacy, modern])
    expect(pools.get(poolKey(CAT, A))).toBe(100)
  })

  it('stocked lines neither contribute to nor receive a pool', () => {
    const stocked = line({ qty: 500, fulfilmentType: 'stocked', decorations: [dec(A)] })
    const made = line({ qty: 100, decorations: [dec(A)] })
    const pools = pooledQtyByDecoration([stocked, made])
    // Does not contribute: the pool is 100, not 600.
    expect(pools.get(poolKey(CAT, A))).toBe(100)
    // Does not receive: its own band qty is untouched.
    expect(garmentBandQty(stocked, pools, 500)).toBe(500)
    expect(pooledDecorationQty(stocked, dec(A), pools, 500)).toBe(500)
  })

  it('prepaid / all-in lines DO contribute — they are decorated garments', () => {
    // Prepaid is a billing class, not a fulfilment mode; nothing in this module
    // distinguishes it, which is exactly the spec §5 rule.
    const prepaid = line({ qty: 400, decorations: [dec(A)] })
    const normal = line({ qty: 200, decorations: [dec(A)] })
    expect(pooledQtyByDecoration([prepaid, normal]).get(poolKey(CAT, A))).toBe(600)
  })

  it('a line with no catalogue identity never pools', () => {
    const orphan = line({ qty: 500, catalogueId: null, decorations: [dec(A)] })
    const pools = pooledQtyByDecoration([orphan])
    expect(pools.size).toBe(0)
    expect(garmentBandQty(orphan, pools, 500)).toBe(500)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Never-below-own-qty and other invariants.
// ───────────────────────────────────────────────────────────────────────────

describe('invariants', () => {
  it('never returns below the line’s own group qty', () => {
    // Pool smaller than the group can happen when the group spans a stocked
    // sibling (which is excluded from the pool but included in today's group).
    const l = line({ qty: 10, decorations: [dec(A)] })
    const pools = pooledQtyByDecoration([l])
    expect(garmentBandQty(l, pools, 900)).toBe(900)
    expect(pooledDecorationQty(l, dec(A), pools, 900)).toBe(900)
  })

  it('a pooling line with no poolable decorations band-selects at its own qty', () => {
    const l = line({ qty: 40, decorations: [] })
    expect(garmentBandQty(l, new Map(), 40)).toBe(40)
  })

  it('counts a line once even if the same decoration is listed twice', () => {
    const l = line({ qty: 100, decorations: [dec(A), dec(A)] })
    expect(pooledQtyByDecoration([l]).get(poolKey(CAT, A))).toBe(100)
  })

  it('ignores zero and non-finite quantities', () => {
    const zero = line({ qty: 0, decorations: [dec(A)] })
    const nan = line({ qty: Number.NaN, decorations: [dec(A)] })
    const real = line({ qty: 25, decorations: [dec(A)] })
    expect(pooledQtyByDecoration([zero, nan, real]).get(poolKey(CAT, A))).toBe(25)
  })

  it('isPoolingLine gates on flag, catalogue and fulfilment together', () => {
    expect(isPoolingLine(line({ qty: 1, decorations: [dec(A)] }))).toBe(true)
    expect(isPoolingLine(line({ qty: 1, poolingEnabled: false }))).toBe(false)
    expect(isPoolingLine(line({ qty: 1, catalogueId: '' }))).toBe(false)
    expect(isPoolingLine(line({ qty: 1, fulfilmentType: 'stocked' }))).toBe(false)
  })
})

describe('poolSizesForLine — display input', () => {
  it('reports the pool behind each of the line’s poolable decorations', () => {
    const tee = line({ qty: 500, decorations: [dec(A)] })
    const hood = line({ qty: 100, decorations: [dec(A), dec(B)] })
    const cap = line({ qty: 50, decorations: [dec(B)] })
    const pools = pooledQtyByDecoration([tee, hood, cap])
    expect([...poolSizesForLine(hood, pools)]).toEqual([
      [A, 600],
      [B, 150],
    ])
  })

  it('reports nothing for a non-pooling line', () => {
    const stocked = line({ qty: 500, fulfilmentType: 'stocked', decorations: [dec(A)] })
    const pools = pooledQtyByDecoration([line({ qty: 100, decorations: [dec(A)] })])
    expect(poolSizesForLine(stocked, pools).size).toBe(0)
  })
})
