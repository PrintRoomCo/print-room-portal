import { describe, it, expect } from 'vitest'
import {
  buildDestinationInputs,
  buildSplitAllocations,
  removeDestination,
  splitBlockReason,
  splitShipmentComplete,
  type EditorCartLine,
  type SplitShipmentState,
} from './split-shipment-state'

const lines: EditorCartLine[] = [
  { lineId: 'l-s', qty: 12 },
  { lineId: 'l-m', qty: 20 },
  { lineId: 'l-other', qty: 10 },
]

function state(overrides: Partial<SplitShipmentState> = {}): SplitShipmentState {
  return {
    destinations: [
      { ref: 'd1', storeId: 'store-a', customAddress: null },
      { ref: 'd2', storeId: 'store-b', customAddress: null },
    ],
    defaultDestinationRef: 'd1',
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

  it('sends a line with no entries whole to the default', () => {
    expect(
      splitShipmentComplete(
        {
          destinations: [{ ref: 'd1', storeId: 'store-a', customAddress: null }],
          defaultDestinationRef: 'd1',
          allocations: {},
        },
        lines,
      ),
    ).toBe(true)
  })

  it('rejects an under- or over-allocated line', () => {
    expect(
      splitShipmentComplete(
        state({ allocations: { 'l-s': { d1: 8 }, 'l-m': { d1: 10, d2: 10 } } }),
        lines,
      ),
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

  it('ignores an allocation whose cart line is gone', () => {
    expect(
      splitShipmentComplete(
        state({ allocations: { 'l-s': { d1: 8, d2: 4 }, 'l-deleted': { d2: 99 } } }),
        [lines[0], { lineId: 'l-m', qty: 20 }, lines[2]],
      ),
    ).toBe(true)
  })

  it('rejects a destination nothing was allocated to', () => {
    expect(
      splitShipmentComplete(state({ allocations: { 'l-s': { d1: 12 }, 'l-m': { d1: 20 } } }), lines),
    ).toBe(false)
  })
})

describe('splitBlockReason', () => {
  it('is null when the order is submittable', () => {
    expect(splitBlockReason(state(), lines)).toBeNull()
  })

  it('asks for a destination before anything else', () => {
    expect(
      splitBlockReason(
        state({ destinations: [], defaultDestinationRef: null, allocations: {} }),
        lines,
      ),
    ).toBe('Add a destination to split this order across.')
  })

  it('asks for a default when the current one is not among the destinations', () => {
    expect(splitBlockReason(state({ defaultDestinationRef: 'gone' }), lines)).toBe(
      'Choose which destination is the default.',
    )
  })

  it('asks for the address before counting units', () => {
    expect(
      splitBlockReason(
        state({
          destinations: [
            { ref: 'd1', storeId: 'store-a', customAddress: null },
            { ref: 'd2', storeId: null, customAddress: null },
          ],
          allocations: {},
        }),
        lines,
      ),
    ).toBe('Finish the address for every destination.')
  })

  it('names a stale destination ref rather than the arithmetic', () => {
    expect(
      splitBlockReason(
        state({ allocations: { 'l-s': { d1: 8, d9: 4 }, 'l-m': { d1: 10, d2: 10 } } }),
        lines,
      ),
    ).toBe('Some units are assigned to a destination that no longer exists.')
  })

  it('reports an unfinished line', () => {
    expect(
      splitBlockReason(state({ allocations: { 'l-s': { d1: 8 }, 'l-m': { d2: 20 } } }), lines),
    ).toBe('Every split line has to add up to its cart quantity.')
  })

  it('reports an untouched destination last', () => {
    expect(
      splitBlockReason(state({ allocations: { 'l-s': { d1: 12 }, 'l-m': { d1: 20 } } }), lines),
    ).toBe('Every destination needs at least one item.')
  })
})

describe('buildSplitAllocations', () => {
  it('emits request-shaped allocations for every line holding entries', () => {
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

  it('omits a line with no entries, so the server sends it whole to the default', () => {
    expect(buildSplitAllocations(state(), lines)['l-other']).toBeUndefined()
  })

  it('drops allocations pointing at destinations that no longer exist', () => {
    const result = buildSplitAllocations(state({ allocations: { 'l-s': { d1: 8, d9: 4 } } }), lines)
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
  it('moves the removed destination units to the default instead of dropping them', () => {
    const { state: next, movedUnits } = removeDestination(
      state({ allocations: { 'l-s': { d1: 8, d2: 4 }, 'l-m': { d1: 10, d2: 10 } } }),
      'd2',
    )
    expect(movedUnits).toBe(14)
    expect(next.destinations.map((d) => d.ref)).toEqual(['d1'])
    // Everything now goes to the default, so the lines read as untouched again.
    expect(next.allocations).toEqual({})
    expect(splitShipmentComplete(next, lines)).toBe(true)
  })

  it('keeps a line split when it still reaches another destination', () => {
    const three = state({
      destinations: [
        { ref: 'd1', storeId: 'store-a', customAddress: null },
        { ref: 'd2', storeId: 'store-b', customAddress: null },
        { ref: 'd3', storeId: 'store-c', customAddress: null },
      ],
      allocations: { 'l-s': { d2: 4, d3: 8 } },
    })
    const { state: next, movedUnits } = removeDestination(three, 'd2')
    expect(movedUnits).toBe(4)
    expect(next.allocations).toEqual({ 'l-s': { d3: 8, d1: 4 } })
  })

  it('moves the default when the default itself is removed', () => {
    const { state: next } = removeDestination(state(), 'd1')
    expect(next.defaultDestinationRef).toBe('d2')
    expect(next.allocations).toEqual({})
  })

  it('clears every allocation when the last destination goes', () => {
    const one = state({
      destinations: [{ ref: 'd1', storeId: 'store-a', customAddress: null }],
      allocations: { 'l-s': { d1: 12 } },
    })
    const { state: next } = removeDestination(one, 'd1')
    expect(next.destinations).toEqual([])
    expect(next.defaultDestinationRef).toBeNull()
    expect(next.allocations).toEqual({})
  })
})
