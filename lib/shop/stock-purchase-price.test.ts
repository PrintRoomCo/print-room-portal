import { describe, it, expect } from 'vitest'
import {
  bracketPriceAt,
  pickStockPurchasePrices,
  type StockIntakeEvent,
} from './stock-purchase-price'

const BRACKETS = [
  { min_quantity: 1, max_quantity: 49, unit_price: 12 },
  { min_quantity: 50, max_quantity: 99, unit_price: 10 },
  { min_quantity: 100, max_quantity: null, unit_price: 8.5 },
]

const ev = (over: Partial<StockIntakeEvent> = {}): StockIntakeEvent => ({
  variant_id: 'v1',
  delta_stock: 100,
  reference_quote_item_id: null,
  created_at: '2026-07-01T00:00:00Z',
  ...over,
})

describe('bracketPriceAt', () => {
  it('reads the band containing the qty, open-ended top band included', () => {
    expect(bracketPriceAt(BRACKETS, 10)).toBe(12)
    expect(bracketPriceAt(BRACKETS, 50)).toBe(10)
    expect(bracketPriceAt(BRACKETS, 500)).toBe(8.5)
  })
  it('returns null when no band matches', () => {
    expect(bracketPriceAt([{ min_quantity: 10, max_quantity: 20, unit_price: 5 }], 5)).toBeNull()
    expect(bracketPriceAt([], 10)).toBeNull()
  })
})

describe('pickStockPurchasePrices', () => {
  it('prefers the newest ORDER-LINKED intake and reads its quote-item price', () => {
    const events = [
      // newest-first, as the resolver orders them
      ev({ created_at: '2026-07-10T00:00:00Z', delta_stock: 20 }), // unlinked top-up
      ev({ created_at: '2026-07-01T00:00:00Z', delta_stock: 100, reference_quote_item_id: 'qi-1' }),
    ]
    const prices = pickStockPurchasePrices(events, new Map([['qi-1', 8.5]]), BRACKETS)
    expect(prices.get('v1')).toBe(8.5)
  })

  it('falls back to the ladder at the intake qty when no intake is linked', () => {
    const prices = pickStockPurchasePrices(
      [ev({ delta_stock: 100 })],
      new Map(),
      BRACKETS,
    )
    expect(prices.get('v1')).toBe(8.5)
  })

  it('newest linked intake wins over an older linked one', () => {
    const events = [
      ev({ created_at: '2026-07-10T00:00:00Z', delta_stock: 50, reference_quote_item_id: 'qi-2' }),
      ev({ created_at: '2026-07-01T00:00:00Z', delta_stock: 100, reference_quote_item_id: 'qi-1' }),
    ]
    const prices = pickStockPurchasePrices(
      events,
      new Map([
        ['qi-1', 8.5],
        ['qi-2', 10],
      ]),
      BRACKETS,
    )
    expect(prices.get('v1')).toBe(10)
  })

  it('ignores non-positive deltas and unmatched ladders; absent when nothing prices', () => {
    const prices = pickStockPurchasePrices(
      [ev({ delta_stock: -5 }), ev({ variant_id: 'v2', delta_stock: 10 })],
      new Map(),
      [], // empty ladder — fallback cannot price
    )
    expect(prices.has('v1')).toBe(false)
    expect(prices.has('v2')).toBe(false)
  })

  it('resolves per variant independently', () => {
    const events = [
      ev({ variant_id: 'v1', reference_quote_item_id: 'qi-1' }),
      ev({ variant_id: 'v2', delta_stock: 50 }),
    ]
    const prices = pickStockPurchasePrices(events, new Map([['qi-1', 8.5]]), BRACKETS)
    expect(prices.get('v1')).toBe(8.5)
    expect(prices.get('v2')).toBe(10)
  })
})
