import { describe, expect, it } from 'vitest'
import { getEffectiveMaxQty } from './effective-max-qty'

describe('getEffectiveMaxQty', () => {
  it('override wins over product', () => {
    expect(getEffectiveMaxQty({ max_order_qty: 50 }, { max_order_qty_override: 20 })).toBe(20)
  })
  it('falls back to the product cap', () => {
    expect(getEffectiveMaxQty({ max_order_qty: 50 }, { max_order_qty_override: null })).toBe(50)
    expect(getEffectiveMaxQty({ max_order_qty: 50 }, null)).toBe(50)
  })
  it('null everywhere = no cap', () => {
    expect(getEffectiveMaxQty({ max_order_qty: null }, null)).toBeNull()
    expect(getEffectiveMaxQty({ max_order_qty: null }, { max_order_qty_override: null })).toBeNull()
  })
})
