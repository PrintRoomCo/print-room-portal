import { describe, expect, it } from 'vitest'
import {
  PURCHASE_ORDER_MINIMUM,
  allLinesArePreOrder,
  evaluateCartMinimumOrder,
  evaluateMinimumOrder,
  pooledMinimumNotional,
  type MinimumOrderExemptions,
} from './minimum-order'

const NO_EXEMPTIONS: MinimumOrderExemptions = {
  orgExempt: false,
  isTest: false,
  isInventoryIntent: false,
  allPreOrder: false,
}

function evaluate(
  notionalValue: number,
  overrides: Partial<MinimumOrderExemptions> = {},
  orderType: 'purchase_order' | 'stock_on_hand' = 'purchase_order',
  currency = 'NZD',
) {
  return evaluateMinimumOrder({
    orderType,
    notionalValue,
    currency,
    exemptions: { ...NO_EXEMPTIONS, ...overrides },
  })
}

describe('evaluateMinimumOrder', () => {
  it('exposes the threshold as 500', () => {
    expect(PURCHASE_ORDER_MINIMUM).toBe(500)
  })

  it('gates a purchase order below the minimum', () => {
    const status = evaluate(380)
    expect(status.applies).toBe(true)
    expect(status.met).toBe(false)
    expect(status.threshold).toBe(500)
    expect(status.value).toBe(380)
    expect(status.shortfall).toBe(120)
  })

  it('treats exactly 500.00 as met', () => {
    expect(evaluate(500).met).toBe(true)
    expect(evaluate(500).shortfall).toBe(0)
  })

  it('treats 499.99 as gated', () => {
    const status = evaluate(499.99)
    expect(status.met).toBe(false)
    expect(status.shortfall).toBe(0.01)
  })

  it('rounds the shortfall to cents', () => {
    expect(evaluate(379.99).shortfall).toBe(120.01)
  })

  it('never applies to a stock-on-hand order', () => {
    const status = evaluate(10, {}, 'stock_on_hand')
    expect(status.applies).toBe(false)
    expect(status.met).toBe(true)
    expect(status.shortfall).toBe(0)
  })

  it.each([
    ['orgExempt', { orgExempt: true }],
    ['isTest', { isTest: true }],
    ['isInventoryIntent', { isInventoryIntent: true }],
    ['allPreOrder', { allPreOrder: true }],
  ] as const)('clears the gate when %s is set', (_label, overrides) => {
    const status = evaluate(10, overrides)
    expect(status.applies).toBe(false)
    expect(status.met).toBe(true)
  })

  it('stays cleared when several exemptions combine', () => {
    expect(evaluate(10, { orgExempt: true, isTest: true }).met).toBe(true)
  })

  it('passes the currency through untouched and does not convert', () => {
    const status = evaluate(380, {}, 'purchase_order', 'AUD')
    expect(status.currency).toBe('AUD')
    expect(status.threshold).toBe(500)
    expect(status.shortfall).toBe(120)
  })
})

describe('allLinesArePreOrder', () => {
  it('is true only when every line is a period item', () => {
    const ids = new Set(['a', 'b'])
    expect(allLinesArePreOrder([{ catalogueItemId: 'a' }, { catalogueItemId: 'b' }], ids)).toBe(true)
  })

  it('is false when one line is outside the period — the mixed-cart loophole', () => {
    const ids = new Set(['a'])
    expect(allLinesArePreOrder([{ catalogueItemId: 'a' }, { catalogueItemId: 'z' }], ids)).toBe(false)
  })

  it('is false when a line carries no catalogue identity', () => {
    const ids = new Set(['a'])
    expect(allLinesArePreOrder([{ catalogueItemId: 'a' }, { catalogueItemId: null }], ids)).toBe(false)
  })

  it('is false with no open period and false for an empty cart', () => {
    expect(allLinesArePreOrder([{ catalogueItemId: 'a' }], new Set())).toBe(false)
    expect(allLinesArePreOrder([], new Set(['a']))).toBe(false)
  })
})

function cartView(overrides: Partial<Parameters<typeof evaluateCartMinimumOrder>[0]> = {}) {
  return evaluateCartMinimumOrder({
    orderType: 'purchase_order',
    notionalValue: 380,
    currency: 'NZD',
    orgExempt: false,
    isTest: false,
    canRouteToInventory: false,
    periodLookupPending: false,
    preOrderItemIdsInCart: new Set<string>(),
    lineCatalogueItemIds: ['item-1'],
    ...overrides,
  })
}

describe('evaluateCartMinimumOrder', () => {
  it('blocks when no exemption is still possible', () => {
    const view = cartView()
    expect(view.blocks).toBe(true)
    expect(view.tentative).toBe(false)
    expect(view.status.shortfall).toBe(120)
  })

  it('warns without blocking when the org can route to inventory', () => {
    const view = cartView({ canRouteToInventory: true })
    expect(view.blocks).toBe(false)
    expect(view.tentative).toBe(true)
  })

  it('warns without blocking when a cart line is a pre-order item', () => {
    const view = cartView({
      preOrderItemIdsInCart: new Set(['item-1']),
      lineCatalogueItemIds: ['item-1', 'item-2'],
    })
    expect(view.blocks).toBe(false)
    expect(view.tentative).toBe(true)
  })

  it('warns without blocking while the period lookup is still in flight', () => {
    const view = cartView({ periodLookupPending: true })
    expect(view.blocks).toBe(false)
    expect(view.tentative).toBe(true)
  })

  it('shows nothing when every line is a pre-order item', () => {
    const view = cartView({
      preOrderItemIdsInCart: new Set(['item-1']),
      lineCatalogueItemIds: ['item-1'],
    })
    expect(view.status.applies).toBe(false)
    expect(view.blocks).toBe(false)
    expect(view.tentative).toBe(false)
  })

  it('shows nothing for an exempt org, even under the minimum', () => {
    const view = cartView({ orgExempt: true })
    expect(view.status.applies).toBe(false)
    expect(view.blocks).toBe(false)
    expect(view.tentative).toBe(false)
  })

  it('shows nothing for a test org', () => {
    expect(cartView({ isTest: true }).status.applies).toBe(false)
  })

  it('shows nothing at or over the minimum', () => {
    const view = cartView({ notionalValue: 500 })
    expect(view.blocks).toBe(false)
    expect(view.tentative).toBe(false)
  })

  it('shows nothing for a stock-on-hand cart', () => {
    const view = cartView({ orderType: 'stock_on_hand', notionalValue: 10 })
    expect(view.status.applies).toBe(false)
    expect(view.blocks).toBe(false)
  })
})

describe('pooledMinimumNotional', () => {
  const rates = { NZD: 1, AUD: 0.9, USD: 0.6, GBP: 0.5, EUR: 0.55 }
  const partitions = [
    { currency: 'NZD', orderType: 'purchase_order' as const, notionalValue: 300 },
    { currency: 'AUD', orderType: 'purchase_order' as const, notionalValue: 270 }, // = 300 NZD at 0.9
  ]

  it('sums purchase_order partitions into the target currency', () => {
    expect(pooledMinimumNotional({ partitions, targetCurrency: 'NZD', ratesFromNzd: rates })).toBe(600)
    expect(pooledMinimumNotional({ partitions, targetCurrency: 'AUD', ratesFromNzd: rates })).toBe(540)
  })

  it('ignores stock_on_hand partitions — the minimum never applied to them', () => {
    expect(
      pooledMinimumNotional({
        partitions: [...partitions, { currency: 'NZD', orderType: 'stock_on_hand', notionalValue: 5000 }],
        targetCurrency: 'NZD',
        ratesFromNzd: rates,
      }),
    ).toBe(600)
  })

  it('falls back to face value for a currency with no rate', () => {
    expect(
      pooledMinimumNotional({
        partitions: [{ currency: 'XXX', orderType: 'purchase_order', notionalValue: 200 }],
        targetCurrency: 'NZD',
        ratesFromNzd: rates,
      }),
    ).toBe(200)
  })
})
