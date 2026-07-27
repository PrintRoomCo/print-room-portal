import { describe, it, expect } from 'vitest'
import { submitCustomerOrder, BuyerScopeError, MixedShippingAddressError } from '../submit'
import type { B2BCustomerContext } from '../server'

// The guard short-circuits before any DB call, so a never-called stub is fine.
const adminStub = {} as unknown as Parameters<typeof submitCustomerOrder>[0]
const pastGuardAdmin = {
  from: () => {
    throw new Error('past staff ship-to guard')
  },
} as unknown as Parameters<typeof submitCustomerOrder>[0]

function ctx(overrides: Partial<B2BCustomerContext> = {}): B2BCustomerContext {
  return {
    userId: 'u1', membershipId: 'm1', role: 'staff', email: 'a@b.co',
    fullName: 'A', organizationId: 'org1', organizationName: 'Org',
    customerCode: 'PRT', isTest: false, b2bAccountId: 'b1', tierLevel: 1, paymentTerms: 'net20',
    contractNotes: null, pricingMode: null, defaultDepositPercent: null, storeIds: ['s1'],
    defaultStoreId: 's1', branchStoreIds: [], tenantType: 'franchise', allowsMultiStoreOrdering: false,
    moqExempt: false, orderingPermission: 'both', ...overrides,
  }
}

describe('submitCustomerOrder staff ship-to guard', () => {
  it('throws BuyerScopeError when a staff member ships off their default store', async () => {
    await expect(
      submitCustomerOrder(adminStub, {
        context: ctx(),
        idempotency_key: 'k1',
        lines: [{ product_id: 'p1', product_name: 'Tee', qty: 10, ship_to_store_id: 'OTHER' }],
      }),
    ).rejects.toBeInstanceOf(BuyerScopeError)
  })

  it('allows a staff member to use a shared one-time shipping address', async () => {
    await expect(
      submitCustomerOrder(pastGuardAdmin, {
        context: ctx(),
        idempotency_key: 'k2',
        custom_shipping_address: {
          name: 'Sam Buyer',
          address: '12 Queen St',
          city: 'Auckland',
          postal_code: '1010',
          country: 'NZ',
        },
        lines: [{ product_id: 'p1', product_name: 'Tee', qty: 10, ship_to_store_id: null }],
      }),
    ).rejects.toThrow('past staff ship-to guard')
  })

  it('rejects mixing a one-time address line with saved-store lines', async () => {
    await expect(
      submitCustomerOrder(adminStub, {
        context: ctx(),
        idempotency_key: 'k3',
        custom_shipping_address: {
          name: 'Sam Buyer',
          address: '12 Queen St',
          city: 'Auckland',
          postal_code: '1010',
          country: 'NZ',
        },
        lines: [
          { product_id: 'p1', product_name: 'Tee', qty: 10, ship_to_store_id: null },
          { product_id: 'p2', product_name: 'Hoodie', qty: 5, ship_to_store_id: 's1' },
        ],
      }),
    ).rejects.toBeInstanceOf(MixedShippingAddressError)
  })
})
