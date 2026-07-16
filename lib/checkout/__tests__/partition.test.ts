import { describe, it, expect } from 'vitest'
import { partitionCheckoutLines } from '../partition'
import type { CheckoutLineInput } from '../submit'

function line(overrides: Partial<CheckoutLineInput> = {}): CheckoutLineInput {
  return { product_id: 'p1', product_name: 'Tee', qty: 10, ...overrides }
}

describe('partitionCheckoutLines', () => {
  it('returns a single purchase_order partition when every line is made_to_order', () => {
    const parts = partitionCheckoutLines([
      line({ fulfilment_type: 'made_to_order' }),
      line({ product_id: 'p2', fulfilment_type: 'made_to_order' }),
    ])
    expect(parts).toHaveLength(1)
    expect(parts[0].orderType).toBe('purchase_order')
    expect(parts[0].lines).toHaveLength(2)
  })

  it('returns a single stock_on_hand partition when every line is stocked', () => {
    const parts = partitionCheckoutLines([line({ fulfilment_type: 'stocked' })])
    expect(parts).toHaveLength(1)
    expect(parts[0].orderType).toBe('stock_on_hand')
  })

  it('splits a mixed cart into purchase_order (first) then stock_on_hand', () => {
    const mto = line({ product_id: 'mto', fulfilment_type: 'made_to_order' })
    const stk = line({ product_id: 'stk', fulfilment_type: 'stocked' })
    const parts = partitionCheckoutLines([stk, mto])
    expect(parts.map((p) => p.orderType)).toEqual(['purchase_order', 'stock_on_hand'])
    expect(parts[0].lines).toEqual([mto])
    expect(parts[1].lines).toEqual([stk])
  })

  it('treats an absent fulfilment_type as purchase_order (legacy-conservative)', () => {
    const parts = partitionCheckoutLines([line()])
    expect(parts).toHaveLength(1)
    expect(parts[0].orderType).toBe('purchase_order')
  })

  it('returns [] for empty input', () => {
    expect(partitionCheckoutLines([])).toEqual([])
  })

  it('preserves input order within a partition', () => {
    const a = line({ product_id: 'a', fulfilment_type: 'stocked' })
    const b = line({ product_id: 'b', fulfilment_type: 'stocked' })
    expect(partitionCheckoutLines([a, b])[0].lines).toEqual([a, b])
  })
})
