import { describe, it, expect } from 'vitest'
import { summariseDestinations } from './destination-summary'

describe('summariseDestinations', () => {
  it('groups exploded lines under their destination with unit and SKU counts', () => {
    const result = summariseDestinations({
      destinations: [
        { ref: 'd1', label: 'Albany' },
        { ref: 'd2', label: 'Site office' },
      ],
      lines: [
        { destination_ref: 'd1', product_name: 'Hoodie', size_label: 'S', qty: 8 },
        { destination_ref: 'd1', product_name: 'Hoodie', size_label: 'M', qty: 10 },
        { destination_ref: 'd2', product_name: 'Hoodie', size_label: 'S', qty: 4 },
      ],
      feesByRef: { d1: 15, d2: 15 },
    })
    expect(result).toEqual([
      expect.objectContaining({ ref: 'd1', label: 'Albany', unitTotal: 18, fee: 15 }),
      expect.objectContaining({ ref: 'd2', label: 'Site office', unitTotal: 4, fee: 15 }),
    ])
    expect(result[0].lines).toHaveLength(2)
  })

  it('omits destinations with no lines and nulls unknown fees', () => {
    const result = summariseDestinations({
      destinations: [
        { ref: 'd1', label: 'Albany' },
        { ref: 'd9', label: 'Elsewhere' },
      ],
      lines: [{ destination_ref: 'd1', product_name: 'Tee', size_label: null, qty: 2 }],
    })
    expect(result).toEqual([expect.objectContaining({ ref: 'd1', fee: null })])
  })
})
