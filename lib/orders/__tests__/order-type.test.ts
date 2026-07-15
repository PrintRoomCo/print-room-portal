import { describe, it, expect } from 'vitest'
import { classifyOrderType } from '../order-type'

describe('classifyOrderType', () => {
  it("returns 'stock_on_hand' when every line is stocked", () => {
    expect(
      classifyOrderType([
        { fulfilment_type: 'stocked' },
        { fulfilment_type: 'stocked' },
      ]),
    ).toBe('stock_on_hand')
  })

  it("returns 'purchase_order' when any line is made_to_order", () => {
    expect(
      classifyOrderType([
        { fulfilment_type: 'stocked' },
        { fulfilment_type: 'made_to_order' },
      ]),
    ).toBe('purchase_order')
  })

  it("returns 'purchase_order' when a line has no fulfilment_type (legacy cart)", () => {
    expect(classifyOrderType([{ fulfilment_type: 'stocked' }, {}])).toBe(
      'purchase_order',
    )
  })

  it("returns 'purchase_order' for an empty line list", () => {
    expect(classifyOrderType([])).toBe('purchase_order')
  })
})
