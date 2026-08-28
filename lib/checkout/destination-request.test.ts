import { describe, it, expect } from 'vitest'
import { validateDestinationRequest } from './destination-request'
import type { CheckoutLineInput } from './submit'

const stores = new Map<string, string | null>([
  ['store-albany', 'NZ'],
  ['store-takapuna', 'NZ'],
  ['store-sydney', 'AU'],
  ['store-blank', null],
])

const albany = { ref: 'd1', ship_to_store_id: 'store-albany' }
const adHoc = {
  ref: 'd2',
  custom_address: {
    name: 'Site office',
    address: '1 Wharf Rd',
    city: 'Nelson',
    postal_code: '7010',
    country: 'NZ',
  },
}

function line(overrides: Partial<CheckoutLineInput> = {}): CheckoutLineInput {
  return {
    product_id: 'p1',
    product_name: 'Test tee',
    qty: 12,
    cart_line_id: 'line-1',
    decorations: [],
    ...overrides,
  }
}

function run(overrides: Partial<Parameters<typeof validateDestinationRequest>[0]> = {}) {
  return validateDestinationRequest({
    destinations: [albany],
    defaultDestinationRef: 'd1',
    lines: [line()],
    splitShippingEnabled: true,
    orgStoreCountryById: stores,
    staffScope: null,
    ...overrides,
  })
}

describe('validateDestinationRequest', () => {
  it('accepts a well-formed request and returns exploded lines plus countries', () => {
    const result = run({
      destinations: [albany, adHoc],
      lines: [line({ allocations: [
        { destination_ref: 'd1', qty: 8 },
        { destination_ref: 'd2', qty: 4 },
      ] })],
    })
    if (!result.ok) throw new Error(JSON.stringify(result.body))
    expect(result.lines).toEqual([
      expect.objectContaining({ qty: 8, destination_ref: 'd1', ship_to_store_id: 'store-albany' }),
      expect.objectContaining({ qty: 4, destination_ref: 'd2', ship_to_store_id: null }),
    ])
    expect([...result.countryByRef]).toEqual([['d1', 'NZ'], ['d2', 'NZ']])
  })

  it('refuses an org without the pilot flag before looking at anything else', () => {
    expect(run({ splitShippingEnabled: false, destinations: 'nonsense' })).toMatchObject({
      ok: false,
      status: 400,
      body: { code: 'split_shipping_disabled' },
    })
  })

  it('refuses a store the org does not own', () => {
    expect(run({ destinations: [{ ref: 'd1', ship_to_store_id: 'store-someone-else' }] })).toMatchObject({
      ok: false,
      status: 400,
      body: { code: 'unknown_destination', destinationRef: 'd1' },
    })
  })

  it('refuses an incomplete one-time address', () => {
    const result = run({
      destinations: [{ ref: 'd9', custom_address: { ...adHoc.custom_address, postal_code: '  ' } }],
      defaultDestinationRef: 'd9',
    })
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      body: { code: 'destination_shape', destinationRef: 'd9' },
    })
  })

  it('refuses a destination whose store has no country, rather than defaulting one', () => {
    expect(run({ destinations: [{ ref: 'd1', ship_to_store_id: 'store-blank' }] })).toMatchObject({
      ok: false,
      body: { code: 'destination_country_unresolved', destinationRef: 'd1' },
    })
  })

  it('passes allocation failures straight through with the offending line', () => {
    expect(
      run({ lines: [line({ allocations: [{ destination_ref: 'd1', qty: 5 }] })] }),
    ).toMatchObject({
      ok: false,
      status: 400,
      body: { code: 'allocation_sum_mismatch', cartLineId: 'line-1' },
    })
  })

  describe('branch-scoped buyers', () => {
    const staffScope = { allowedBranchIds: ['store-albany'], defaultStoreId: 'store-albany' }

    it('allows splitting within granted branches', () => {
      const result = run({
        destinations: [albany],
        staffScope,
      })
      expect(result.ok).toBe(true)
    })

    it('refuses a branch outside the grant', () => {
      expect(
        run({
          destinations: [albany, { ref: 'd2', ship_to_store_id: 'store-takapuna' }],
          lines: [line({ allocations: [
            { destination_ref: 'd1', qty: 6 },
            { destination_ref: 'd2', qty: 6 },
          ] })],
          staffScope,
        }),
      ).toMatchObject({
        ok: false,
        status: 403,
        body: { code: 'destination_out_of_branch_scope', detail: { mismatched_store_ids: ['store-takapuna'] } },
      })
    })

    it('refuses ad-hoc addresses outright', () => {
      expect(
        run({
          destinations: [adHoc],
          defaultDestinationRef: 'd2',
          staffScope,
        }),
      ).toMatchObject({ ok: false, status: 403, body: { code: 'destination_out_of_branch_scope' } })
    })
  })
})
