import { describe, it, expect } from 'vitest'
import type { CartLine } from '@/lib/cart/types'
import {
  checkoutPickingFee,
  estimateCartPickingFee,
  orderPickingFee,
  stockedGoodsValue,
} from './order-picking-fee'

describe('orderPickingFee exact bill-country rule', () => {
  it.each([
    { orderType: 'stock_on_hand' as const, billCountry: 'NZ', expected: 30 },
    { orderType: 'stock_on_hand' as const, billCountry: 'AU', expected: 0 },
    { orderType: 'purchase_order' as const, billCountry: 'NZ', expected: 0 },
    { orderType: 'purchase_order' as const, billCountry: 'AU', expected: 0 },
  ])('$orderType / $billCountry → $expected', ({ orderType, billCountry, expected }) => {
    expect(orderPickingFee({ orderType, billCountry, goodsSubtotal: 100 })).toBe(expected)
  })

  it.each(['nz', 'NZL', 'New Zealand', '', null, undefined])(
    'does not fuzzy-match %j',
    (billCountry) => {
      expect(
        orderPickingFee({
          orderType: 'stock_on_hand',
          billCountry: billCountry as string,
          goodsSubtotal: 100,
        }),
      ).toBe(0)
    },
  )
})

describe('checkoutPickingFee flag compatibility', () => {
  it('changes AU-org → NZ-stock only when the country cutover is enabled', () => {
    const input = {
      orderType: 'stock_on_hand' as const,
      billCountry: 'NZ',
      goodsSubtotal: 100,
      legacyShipCountry: 'NZ',
      legacyOrgRegion: 'AU',
    }

    expect(checkoutPickingFee({ ...input, countryPartitionEnabled: false })).toBe(0)
    expect(checkoutPickingFee({ ...input, countryPartitionEnabled: true })).toBe(30)
  })

  it.each(['NZ', 'nz', 'NZL', 'New Zealand', 'new-zealand', ' NZ '])(
    'retains the old fuzzy NZ result only in the flag-off adapter for %j',
    (legacyShipCountry) => {
      expect(
        checkoutPickingFee({
          countryPartitionEnabled: false,
          orderType: 'stock_on_hand',
          billCountry: '',
          goodsSubtotal: 100,
          legacyShipCountry,
          legacyOrgRegion: 'NZ',
        }),
      ).toBe(30)
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

  it('uses the exact default country when enabled and the frozen region gate when off', () => {
    const lines = [cartLine({ qty: 5, unitPrice: 20 })]
    expect(
      estimateCartPickingFee(lines, {
        countryPartitionEnabled: true,
        defaultBillCountry: 'NZ',
        legacyOrgRegion: 'AU',
      }),
    ).toBe(30)
    expect(
      estimateCartPickingFee(lines, {
        countryPartitionEnabled: true,
        defaultBillCountry: 'AU',
        legacyOrgRegion: 'NZ',
      }),
    ).toBe(0)
    expect(
      estimateCartPickingFee(lines, {
        countryPartitionEnabled: false,
        defaultBillCountry: 'NZ',
        legacyOrgRegion: 'AU',
      }),
    ).toBe(0)
  })
})
