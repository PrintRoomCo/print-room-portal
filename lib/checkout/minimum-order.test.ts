import { describe, expect, it } from 'vitest'
import {
  PURCHASE_ORDER_MINIMUM,
  allLinesArePreOrder,
  evaluateMinimumOrder,
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
