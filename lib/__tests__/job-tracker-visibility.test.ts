import { describe, it, expect } from 'vitest'
import { isCustomerVisibleTracker } from '../job-tracker-queries'

describe('isCustomerVisibleTracker', () => {
  it('hides stock_on_hand', () => {
    expect(isCustomerVisibleTracker({ order_type: 'stock_on_hand' })).toBe(false)
  })
  it('shows purchase_order', () => {
    expect(isCustomerVisibleTracker({ order_type: 'purchase_order' })).toBe(true)
  })
  it('shows legacy NULL / missing order_type', () => {
    expect(isCustomerVisibleTracker({ order_type: null })).toBe(true)
    expect(isCustomerVisibleTracker({})).toBe(true)
  })
})
