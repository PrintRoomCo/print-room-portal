import { describe, it, expect } from 'vitest'
import {
  buildDestinationInputs,
  buildSplitAllocations,
  itemKey,
  removeDestination,
  splitShipmentComplete,
  type EditorCartLine,
  type SplitShipmentState,
} from './split-shipment-state'

const lines: EditorCartLine[] = [
  { lineId: 'l-s', productId: 'p1', variantId: 'v1', qty: 12 },
  { lineId: 'l-m', productId: 'p1', variantId: 'v1', qty: 20 },
  { lineId: 'l-other', productId: 'p2', variantId: null, qty: 10 },
]

function state(overrides: Partial<SplitShipmentState> = {}): SplitShipmentState {
  return {
    destinations: [
      { ref: 'd1', storeId: 'store-a', customAddress: null },
      { ref: 'd2', storeId: 'store-b', customAddress: null },
    ],
    defaultDestinationRef: 'd1',
    splitItemKeys: [itemKey('p1', 'v1')],
    allocations: {
      'l-s': { d1: 8, d2: 4 },
      'l-m': { d1: 10, d2: 10 },
    },
    ...overrides,
  }
}

describe('splitShipmentComplete', () => {
  it('accepts a fully allocated split with every destination used', () => {
    expect(splitShipmentComplete(state(), lines)).toBe(true)
  })

  it('rejects an under- or over-allocated line', () => {
    expect(
      splitShipmentComplete(state({ allocations: { 'l-s': { d1: 8 }, 'l-m': { d1: 10, d2: 10 } } }), lines),
    ).toBe(false)
    expect(
      splitShipmentComplete(
        state({ allocations: { 'l-s': { d1: 9, d2: 4 }, 'l-m': { d1: 10, d2: 10 } } }),
        lines,
      ),
    ).toBe(false)
  })

  it('re-validates against the LIVE cart, so a qty edit invalidates', () => {
    const edited = lines.map((l) => (l.lineId === 'l-s' ? { ...l, qty: 14 } : l))
    expect(splitShipmentComplete(state(), edited)).toBe(false)
  })

  it('rejects a stale allocation whose destination was removed', () => {
    expect(
      splitShipmentComplete(
        state({ allocations: { 'l-s': { d1: 8, d9: 4 }, 'l-m': { d1: 10, d2: 10 } } }),
        lines,
      ),
    ).toBe(false)
  })

  it('rejects a destination nothing was allocated to', () => {
    expect(
      splitShipmentComplete(
        state({ allocations: { 'l-s': { d1: 12 }, 'l-m': { d1: 20 } } }),
        lines,
      ),
    ).toBe(false)
  })

  it('counts the default destination as used by unsplit items alone', () => {
    expect(
      splitShipmentComplete(
        {
          destinations: [{ ref: 'd1', storeId: 'store-a', customAddress: null }],
          defaultDestinationRef: 'd1',
          splitItemKeys: [],
          allocations: {},
        },
        lines,
      ),
    ).toBe(true)
  })

  it('rejects a destination with neither a store nor an address', () => {
    expect(
      splitShipmentComplete(
        state({
          destinations: [
            { ref: 'd1', storeId: 'store-a', customAddress: null },
            { ref: 'd2', storeId: null, customAddress: null },
          ],
        }),
        lines,
      ),
    ).toBe(false)
  })
})

describe('buildSplitAllocations', () => {
  it('emits request-shaped allocations for split items only', () => {
    expect(buildSplitAllocations(state(), lines)).toEqual({
      'l-s': [
        { destination_ref: 'd1', qty: 8 },
        { destination_ref: 'd2', qty: 4 },
      ],
      'l-m': [
        { destination_ref: 'd1', qty: 10 },
        { destination_ref: 'd2', qty: 10 },
      ],
    })
  })

  it('drops allocations pointing at destinations that no longer exist', () => {
    const result = buildSplitAllocations(
      state({ allocations: { 'l-s': { d1: 8, d9: 4 } } }),
      lines,
    )
    expect(result['l-s']).toEqual([{ destination_ref: 'd1', qty: 8 }])
  })
})

describe('buildDestinationInputs', () => {
  it('sends a store OR an address, never both', () => {
    const custom = {
      name: 'Site office',
      address: '1 Wharf Rd',
      city: 'Nelson',
      postal_code: '7010',
      country: 'NZ',
    }
    expect(
      buildDestinationInputs(
        state({
          destinations: [
            { ref: 'd1', storeId: 'store-a', customAddress: custom },
            { ref: 'd2', storeId: null, customAddress: custom },
          ],
        }),
      ),
    ).toEqual([
      { ref: 'd1', ship_to_store_id: 'store-a', custom_address: null },
      { ref: 'd2', ship_to_store_id: null, custom_address: custom },
    ])
  })
})

describe('removeDestination', () => {
  it('reports the units it discarded instead of dropping them silently', () => {
    const { state: next, discardedUnits } = removeDestination(state(), 'd2')
    expect(discardedUnits).toBe(14)
    expect(next.destinations.map((d) => d.ref)).toEqual(['d1'])
    expect(next.allocations).toEqual({ 'l-s': { d1: 8 }, 'l-m': { d1: 10 } })
  })

  it('moves the default when the default itself is removed', () => {
    const { state: next } = removeDestination(state(), 'd1')
    expect(next.defaultDestinationRef).toBe('d2')
  })
})
