import { describe, expect, it } from 'vitest'
import {
  applyUpdatePatch,
  pickBracket,
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

function lineAtQty(qty: number, unitPrice: number): CartLine {
  return {
    lineId: 'l1',
    productId: 'p1',
    productName: 'Tee',
    variantId: '',
    variantLabel: '—',
    qty,
    unitPrice,
    imageUrl: null,
    decorations: [],
    brackets,
  }
}

describe('applyUpdatePatch (tier recalc on qty edit)', () => {
  it('drops to the smaller-tier price when qty falls into a lower bracket', () => {
    const line = lineAtQty(100, 20) // started at 100+ tier
    const next = applyUpdatePatch(line, { qty: 24 })
    expect(next.qty).toBe(24)
    expect(next.unitPrice).toBe(30) // 1–49 tier
  })

  it('lifts to the larger-tier price when qty climbs', () => {
    const line = lineAtQty(24, 30)
    const next = applyUpdatePatch(line, { qty: 60 })
    expect(next.unitPrice).toBe(25) // 50–99 tier
  })

  it('round-trips between tiers', () => {
    let line = lineAtQty(100, 20)
    line = applyUpdatePatch(line, { qty: 24 })
    expect(line.unitPrice).toBe(30)
    line = applyUpdatePatch(line, { qty: 100 })
    expect(line.unitPrice).toBe(20)
  })

  it('does not touch unitPrice when patch has no qty change', () => {
    const line = lineAtQty(100, 20)
    const next = applyUpdatePatch(line, { shipToStoreId: 'store-1' })
    expect(next.unitPrice).toBe(20)
    expect(next.shipToStoreId).toBe('store-1')
  })

  it('respects an explicit unitPrice in the patch (no auto-recalc)', () => {
    const line = lineAtQty(100, 20)
    const next = applyUpdatePatch(line, { qty: 24, unitPrice: 99 })
    expect(next.qty).toBe(24)
    expect(next.unitPrice).toBe(99)
  })

  it('keeps unitPrice frozen for legacy lines without brackets', () => {
    const legacy: CartLine = { ...lineAtQty(100, 20), brackets: undefined }
    const next = applyUpdatePatch(legacy, { qty: 5 })
    expect(next.qty).toBe(5)
    expect(next.unitPrice).toBe(20)
  })
})

