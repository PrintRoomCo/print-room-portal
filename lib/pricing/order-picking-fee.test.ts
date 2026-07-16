import { describe, it, expect } from 'vitest'
import { orderPickingFee, isAustralianShipTo } from './order-picking-fee'

describe('isAustralianShipTo', () => {
  it.each(['AU', 'au', 'AUS', 'Australia', 'australia', ' AU '])('%s → true', (c) =>
    expect(isAustralianShipTo(c)).toBe(true))
  it.each(['NZ', 'New Zealand', '', 'United States'])('%s → false', (c) =>
    expect(isAustralianShipTo(c)).toBe(false))
  it('null/undefined → false', () => {
    expect(isAustralianShipTo(null)).toBe(false)
    expect(isAustralianShipTo(undefined)).toBe(false)
  })
})

describe('orderPickingFee', () => {
  it('applies the NZ band to a stock-on-hand NZ order', () => {
    expect(orderPickingFee({ isStockOnHand: true, shipCountry: 'NZ', goodsSubtotal: 100 })).toBe(30)
    expect(orderPickingFee({ isStockOnHand: true, shipCountry: null, goodsSubtotal: 50 })).toBe(35)
  })
  it('is 0 for a purchase order (not stock-on-hand)', () => {
    expect(orderPickingFee({ isStockOnHand: false, shipCountry: 'NZ', goodsSubtotal: 100 })).toBe(0)
  })
  it('is 0 for an AUS ship-to (region seam)', () => {
    expect(orderPickingFee({ isStockOnHand: true, shipCountry: 'Australia', goodsSubtotal: 100 })).toBe(0)
  })
})
