import { describe, it, expect } from 'vitest'
import { submitCustomerOrder, BuyerScopeError } from '../submit'
import type { B2BCustomerContext } from '../server'

// The guard short-circuits before any DB call, so a never-called stub is fine.
const adminStub = {} as unknown as Parameters<typeof submitCustomerOrder>[0]

function ctx(overrides: Partial<B2BCustomerContext> = {}): B2BCustomerContext {
  return {
    userId: 'u1', membershipId: 'm1', role: 'staff', email: 'a@b.co',
    fullName: 'A', organizationId: 'org1', organizationName: 'Org',
    customerCode: 'PRT', b2bAccountId: 'b1', tierLevel: 1, paymentTerms: 'net20',
    contractNotes: null, defaultDepositPercent: null, storeIds: ['s1'],
    defaultStoreId: 's1', tenantType: 'franchise', allowsMultiStoreOrdering: false,
    moqExempt: false, ...overrides,
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
})
