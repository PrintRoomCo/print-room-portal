import { describe, it, expect } from 'vitest'
import { explodeCheckoutLines, type CheckoutDestinationInput } from './destinations'
import type { CheckoutLineInput } from './submit'

const albany: CheckoutDestinationInput = { ref: 'd1', ship_to_store_id: 'store-albany' }
const takapuna: CheckoutDestinationInput = { ref: 'd2', ship_to_store_id: 'store-takapuna' }
const adHoc: CheckoutDestinationInput = {
  ref: 'd3',
  custom_address: {
    name: 'Site office', address: '1 Wharf Rd', city: 'Nelson',
    postal_code: '7010', country: 'NZ',
  },
}

function line(overrides: Partial<CheckoutLineInput> = {}): CheckoutLineInput {
  return {
    product_id: 'p1', product_name: 'Test tee', variant_id: 'v1',
    size_id: 1, size_label: 'S', qty: 12, cart_line_id: 'line-1',
    decorations: [], ...overrides,
  }
}

describe('explodeCheckoutLines', () => {
  it('sends an unallocated line whole to the default destination', () => {
    const r = explodeCheckoutLines({
      lines: [line()], destinations: [albany], defaultDestinationRef: 'd1',
    })
    if (!r.ok) throw new Error(r.code)
    expect(r.lines).toEqual([
      expect.objectContaining({
        cart_line_id: 'line-1', qty: 12,
        destination_ref: 'd1', ship_to_store_id: 'store-albany',
      }),
    ])
  })

  it('explodes an allocated line into one row per destination, denormalising ship_to_store_id', () => {
    const r = explodeCheckoutLines({
      lines: [line({ allocations: [
        { destination_ref: 'd1', qty: 8 },
        { destination_ref: 'd3', qty: 4 },
      ] })],
      destinations: [albany, adHoc], defaultDestinationRef: 'd1',
    })
    if (!r.ok) throw new Error(r.code)
    expect(r.lines).toEqual([
      expect.objectContaining({ qty: 8, destination_ref: 'd1', ship_to_store_id: 'store-albany' }),
      expect.objectContaining({ qty: 4, destination_ref: 'd3', ship_to_store_id: null }),
    ])
    // every non-destination field survives the explosion
    expect(r.lines[1]).toMatchObject({
      product_id: 'p1', variant_id: 'v1', size_id: 1, size_label: 'S',
      cart_line_id: 'line-1', decorations: [],
    })
  })

  it.each([
    [[{ destination_ref: 'd1', qty: 8 }], 'allocation_sum_mismatch'],           // 8 ≠ 12
    [[{ destination_ref: 'd1', qty: 8 }, { destination_ref: 'd2', qty: 5 }], 'allocation_sum_mismatch'], // 13 ≠ 12
    [[{ destination_ref: 'd1', qty: 12 }, { destination_ref: 'd2', qty: 0 }], 'invalid_allocation_qty'],
    [[{ destination_ref: 'd1', qty: 11.5 }, { destination_ref: 'd2', qty: 0.5 }], 'invalid_allocation_qty'],
    [[{ destination_ref: 'nope', qty: 12 }], 'unknown_destination'],
  ] as const)('rejects bad allocations (%j -> %s)', (allocations, code) => {
    const r = explodeCheckoutLines({
      lines: [line({ allocations: [...allocations] })],
      destinations: [albany, takapuna], defaultDestinationRef: 'd1',
    })
    expect(r).toMatchObject({ ok: false, code, cartLineId: 'line-1' })
  })

  it('rejects duplicate refs, malformed destinations, and a missing default', () => {
    expect(explodeCheckoutLines({
      lines: [line()], destinations: [albany, { ...takapuna, ref: 'd1' }],
      defaultDestinationRef: 'd1',
    })).toMatchObject({ ok: false, code: 'duplicate_ref' })

    expect(explodeCheckoutLines({
      lines: [line()],
      destinations: [{ ref: 'd9', ship_to_store_id: 'store-x', custom_address: adHoc.custom_address }],
      defaultDestinationRef: 'd9',
    })).toMatchObject({ ok: false, code: 'destination_shape', destinationRef: 'd9' })

    expect(explodeCheckoutLines({
      lines: [line()], destinations: [{ ref: 'd9' }], defaultDestinationRef: 'd9',
    })).toMatchObject({ ok: false, code: 'destination_shape' })

    expect(explodeCheckoutLines({
      lines: [line()], destinations: [albany], defaultDestinationRef: 'd2',
    })).toMatchObject({ ok: false, code: 'unknown_destination' })

    expect(explodeCheckoutLines({
      lines: [line()], destinations: [], defaultDestinationRef: 'd1',
    })).toMatchObject({ ok: false, code: 'no_destinations' })
  })

  it('rejects a destination that ends up with nothing allocated to it', () => {
    const r = explodeCheckoutLines({
      lines: [line({ allocations: [{ destination_ref: 'd1', qty: 12 }] })],
      destinations: [albany, takapuna], defaultDestinationRef: 'd1',
    })
    expect(r).toMatchObject({ ok: false, code: 'empty_destination', destinationRef: 'd2' })
  })
})
