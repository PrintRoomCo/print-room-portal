import { describe, it, expect } from 'vitest'
import type { CartLine } from '@/lib/cart/types'
import {
  estimateCartPickingFee,
  isNewZealandShipTo,
  orderPickingFee,
  stockedGoodsValue,
} from './order-picking-fee'

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

function cartLine(over: Partial<CartLine>): CartLine {
  return {
    lineId: 'l1',
    productId: 'p1',
    productName: 'Tee',
    variantId: 'v1',
    variantLabel: 'Black',
    qty: 1,
    unitPrice: 10,
    imageUrl: null,
    decorations: [],
    fulfilmentType: 'stocked',
    ...over,
  }
}

describe('stockedGoodsValue / estimateCartPickingFee', () => {
  it('sums only stocked lines at the all-in unit price', () => {
    const lines = [
      cartLine({ lineId: 'a', qty: 5, unitPrice: 20 }), // stocked: $100
      cartLine({ lineId: 'b', qty: 10, unitPrice: 50, fulfilmentType: 'made_to_order' }),
    ]
    expect(stockedGoodsValue(lines)).toBe(100)
    expect(estimateCartPickingFee(lines)).toBe(30) // $100–$199 band
  })

  it('folds decoration unit prices into the goods value', () => {
    const lines = [
      cartLine({
        qty: 10,
        unitPrice: 8,
        decorations: [
          {
            linkId: 'lk1',
            decorationId: 'd1',
            name: 'Emb',
            method: 'embroidery',
            positionLabel: null,
            unitPrice: 2,
            artworkUrl: null,
            snapshotUrl: null,
          },
        ],
      }),
    ]
    expect(stockedGoodsValue(lines)).toBe(100) // 10 × ($8 + $2)
    expect(estimateCartPickingFee(lines)).toBe(30)
  })

  it('excludes legacy lines without a fulfilmentType (they submit as purchase orders)', () => {
    const lines = [cartLine({ fulfilmentType: undefined, qty: 10, unitPrice: 10 })]
    expect(stockedGoodsValue(lines)).toBe(0)
    expect(estimateCartPickingFee(lines)).toBe(0)
  })

  it('returns 0 fee for an empty or PO-only cart (no fee row shown)', () => {
    expect(estimateCartPickingFee([])).toBe(0)
    expect(
      estimateCartPickingFee([cartLine({ fulfilmentType: 'made_to_order' })]),
    ).toBe(0)
  })
})
