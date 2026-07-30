import { describe, it, expect } from 'vitest'
import {
  isStockOrder,
  deriveFulfilmentStatus,
  fulfilmentStatusLabel,
} from '../fulfilment-status'

describe('isStockOrder', () => {
  it('is true only for the persisted stock_on_hand order_type', () => {
    expect(isStockOrder('stock_on_hand')).toBe(true)
    expect(isStockOrder('purchase_order')).toBe(false)
    expect(isStockOrder(null)).toBe(false)
    expect(isStockOrder(undefined)).toBe(false)
  })
})

describe('deriveFulfilmentStatus', () => {
  it('is unfulfilled for the production statuses a fresh stock order sits at', () => {
    // Real data: stock orders sit at orders.status awaiting-proof-review / tracker need-proof.
    expect(
      deriveFulfilmentStatus({ orderStatus: 'awaiting-proof-review', trackerStatus: 'need-proof' }),
    ).toBe('unfulfilled')
    expect(deriveFulfilmentStatus({ trackerStatus: 'in-production' })).toBe('unfulfilled')
    expect(deriveFulfilmentStatus({})).toBe('unfulfilled')
  })

  it('is fulfilled when the order-grain status is terminal', () => {
    expect(deriveFulfilmentStatus({ orderStatus: 'fulfilled' })).toBe('fulfilled')
    expect(deriveFulfilmentStatus({ orderStatus: 'shipped' })).toBe('fulfilled')
    expect(deriveFulfilmentStatus({ orderStatus: 'Shipped' })).toBe('fulfilled')
  })

  it('is fulfilled when the tracker reaches a terminal state (the reliable mover)', () => {
    expect(deriveFulfilmentStatus({ trackerStatus: 'dispatched' })).toBe('fulfilled')
    expect(deriveFulfilmentStatus({ trackerStatus: 'delivered' })).toBe('fulfilled')
    // Matches isTrackerCompleted's Active/Past bucketing exactly, even when the
    // order-grain status still reads production.
    expect(
      deriveFulfilmentStatus({ orderStatus: 'awaiting-proof-review', trackerStatus: 'dispatched' }),
    ).toBe('fulfilled')
  })

  it('passes cancelled through so a cancelled order never reads as Unfulfilled', () => {
    expect(deriveFulfilmentStatus({ orderStatus: 'cancelled' })).toBe('cancelled')
    // Cancel wins even over a terminal tracker signal.
    expect(
      deriveFulfilmentStatus({ orderStatus: 'cancelled', trackerStatus: 'dispatched' }),
    ).toBe('cancelled')
  })
})

describe('fulfilmentStatusLabel', () => {
  it('maps each state to its human label', () => {
    expect(fulfilmentStatusLabel('fulfilled')).toBe('Fulfilled')
    expect(fulfilmentStatusLabel('unfulfilled')).toBe('Unfulfilled')
    expect(fulfilmentStatusLabel('cancelled')).toBe('Cancelled')
  })
})
