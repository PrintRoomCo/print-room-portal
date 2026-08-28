import { describe, it, expect } from 'vitest'
import {
  buildDestinationInputs,
  buildSplitAllocations,
  defaultDestinationRefForRequest,
  removeDestination,
  splitBlockReason,
  splitShipmentComplete,
  type EditorCartLine,
  type SplitShipmentState,
} from './split-shipment-state'

const lines: EditorCartLine[] = [
  { lineId: 'l-s', qty: 12 },
  { lineId: 'l-m', qty: 20 },
]

function state(overrides: Partial<SplitShipmentState> = {}): SplitShipmentState {
  return {
    destinations: [
      { ref: 'd1', storeId: 'store-a', customAddress: null },
      { ref: 'd2', storeId: 'store-b', customAddress: null },
    ],
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

  it('rejects a line nobody allocated: there is no default to catch it', () => {
    expect(
      splitShipmentComplete(
        {
          destinations: [{ ref: 'd1', storeId: 'store-a', customAddress: null }],
          allocations: { 'l-s': { d1: 12 } },
        },
        lines,
      ),
    ).toBe(false)
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
        state({
          allocations: {
            'l-s': { d1: 8, d2: 4 },
            'l-m': { d1: 10, d2: 10 },
            'l-deleted': { d2: 99 },
          },
        }),
        lines,
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
      splitBlockReason(state({ destinations: [], allocations: {} }), lines),
    ).toBe('Add a destination to split this order across.')
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
    ).toBe('Every line has to add up to its cart quantity.')
  })

  it('reports a line nobody has touched at all', () => {
    expect(splitBlockReason(state({ allocations: { 'l-s': { d1: 8, d2: 4 } } }), lines)).toBe(
      'Every line has to add up to its cart quantity.',
    )
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

  it('omits a line with no entries', () => {
    expect(
      buildSplitAllocations(state({ allocations: { 'l-s': { d1: 12 } } }), lines)['l-m'],
    ).toBeUndefined()
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
  it('reports the units it released instead of dropping them silently', () => {
    const { state: next, releasedUnits } = removeDestination(state(), 'd2')
    expect(releasedUnits).toBe(14)
    expect(next.destinations.map((d) => d.ref)).toEqual(['d1'])
    expect(next.allocations).toEqual({ 'l-s': { d1: 8 }, 'l-m': { d1: 10 } })
  })

  it('leaves the released units unallocated rather than re-homing them', () => {
    const { state: next } = removeDestination(state(), 'd2')
    expect(splitBlockReason(next, lines)).toBe('Every line has to add up to its cart quantity.')
  })

  it('drops a line entirely when the removed destination held all of it', () => {
    const { state: next } = removeDestination(
      state({ allocations: { 'l-s': { d1: 12 }, 'l-m': { d2: 20 } } }),
      'd2',
    )
    expect(next.allocations).toEqual({ 'l-s': { d1: 12 } })
  })
})

describe('defaultDestinationRefForRequest', () => {
  it('nominates the first destination for the API field the UI no longer asks about', () => {
    expect(defaultDestinationRefForRequest(state())).toBe('d1')
  })

  it('is null while there is nothing to nominate', () => {
    expect(defaultDestinationRefForRequest(state({ destinations: [] }))).toBeNull()
  })
})
