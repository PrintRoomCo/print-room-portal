import { describe, it, expect } from 'vitest'
import { orderPickingFee, isNewZealandShipTo } from './order-picking-fee'

describe('isNewZealandShipTo', () => {
  it.each(['NZ', 'nz', 'NZL', 'New Zealand', 'new-zealand', ' NZ '])('%s → true', (c) =>
    expect(isNewZealandShipTo(c)).toBe(true))
  it.each(['', 'AU', 'Australia', 'United States'])('%s → false', (c) =>
    expect(isNewZealandShipTo(c)).toBe(false))
  it('null/undefined → false', () => {
    expect(isNewZealandShipTo(null)).toBe(false)
    expect(isNewZealandShipTo(undefined)).toBe(false)
  })
})

describe('orderPickingFee', () => {
  it('applies the NZ band to a stock-on-hand NZ order', () => {
    expect(orderPickingFee({ isStockOnHand: true, shipCountry: 'NZ', goodsSubtotal: 100 })).toBe(30)
  })
  it('is 0 for a purchase order (not stock-on-hand)', () => {
    expect(orderPickingFee({ isStockOnHand: false, shipCountry: 'NZ', goodsSubtotal: 100 })).toBe(0)
  })
  it('is 0 for an AUS ship-to (region seam)', () => {
    expect(orderPickingFee({ isStockOnHand: true, shipCountry: 'Australia', goodsSubtotal: 100 })).toBe(0)
  })
  it.each([null, undefined, '', 'United States', 'United Kingdom'])(
    'is 0 for a non-NZ or unknown ship-to (%s)',
    (shipCountry) => {
      expect(orderPickingFee({ isStockOnHand: true, shipCountry, goodsSubtotal: 100 })).toBe(0)
    },
  )
})
