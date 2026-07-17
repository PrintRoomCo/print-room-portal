import { describe, it, expect } from 'vitest'
import { billedFigures } from './billed-figures'

describe('billedFigures', () => {
  // Chris's case, read back off the persisted order: 120 tees @ $12.21 drawn
  // from prepaid stock. Goods $1,465.20, billed just the $15 fee.
  it('recovers the zeroed goods for a wholly prepaid draw', () => {
    expect(billedFigures({ goodsExGst: 1465.2, billedTotal: 15, pickingFee: 15 })).toEqual({
      billedGoods: 0,
      billedExGst: 15,
      pickingFee: 15,
      prepaidGoodsValue: 1465.2,
    })
  })

  it('reports no prepaid value for a normal stock order', () => {
    expect(billedFigures({ goodsExGst: 500, billedTotal: 515, pickingFee: 15 })).toEqual({
      billedGoods: 500,
      billedExGst: 515,
      pickingFee: 15,
      prepaidGoodsValue: 0,
    })
  })

  it('reports no prepaid value for a purchase order with no fee', () => {
    expect(billedFigures({ goodsExGst: 2000, billedTotal: 2000, pickingFee: 0 })).toEqual({
      billedGoods: 2000,
      billedExGst: 2000,
      pickingFee: 0,
      prepaidGoodsValue: 0,
    })
  })

  it('handles a partly-prepaid order (one line zeroed, one billed)', () => {
    // Goods 450 (200 prepaid + 250 billed), billed 250 + 15 fee.
    expect(billedFigures({ goodsExGst: 450, billedTotal: 265, pickingFee: 15 })).toEqual({
      billedGoods: 250,
      billedExGst: 265,
      pickingFee: 15,
      prepaidGoodsValue: 200,
    })
  })

  // Orders placed before the column existed had no zeroing and no fee line, so
  // the goods value IS what was billed. Reporting $0 here would tell a customer
  // their old order was free.
  it('falls back to the goods value when billed_total is NULL (pre-deploy order)', () => {
    expect(billedFigures({ goodsExGst: 1465.2, billedTotal: null, pickingFee: null })).toEqual({
      billedGoods: 1465.2,
      billedExGst: 1465.2,
      pickingFee: 0,
      prepaidGoodsValue: 0,
    })
  })

  it('treats undefined the same as null', () => {
    expect(
      billedFigures({ goodsExGst: 100, billedTotal: undefined, pickingFee: undefined }),
    ).toEqual({
      billedGoods: 100,
      billedExGst: 100,
      pickingFee: 0,
      prepaidGoodsValue: 0,
    })
  })

  // A real free order must stay distinguishable from a missing snapshot.
  it('honours a genuine billed_total of 0', () => {
    expect(billedFigures({ goodsExGst: 500, billedTotal: 0, pickingFee: 0 })).toEqual({
      billedGoods: 0,
      billedExGst: 0,
      pickingFee: 0,
      prepaidGoodsValue: 500,
    })
  })

  it('never reports a negative prepaid value', () => {
    // billed exceeds goods (shouldn't happen; must not render as a credit).
    expect(
      billedFigures({ goodsExGst: 100, billedTotal: 200, pickingFee: 0 }).prepaidGoodsValue,
    ).toBe(0)
  })

  it('rounds to cents rather than leaking float drift', () => {
    expect(billedFigures({ goodsExGst: 0.3, billedTotal: 0.1, pickingFee: 0 })).toEqual({
      billedGoods: 0.1,
      billedExGst: 0.1,
      pickingFee: 0,
      prepaidGoodsValue: 0.2,
    })
  })

  it('coerces non-finite input to 0 rather than rendering NaN', () => {
    expect(
      billedFigures({ goodsExGst: Number.NaN, billedTotal: null, pickingFee: null }).billedExGst,
    ).toBe(0)
  })
})
