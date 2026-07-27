import { describe, expect, it } from 'vitest'
import { submitCustomerOrder, BuyerScopeError, MixedShippingAddressError } from '../submit'
import type { B2BCustomerContext } from '../server'
import { checkStaffBranchScope } from '@/lib/checkout/branch-scope'
import { resolveBranchStoreIds } from '@/lib/orders/branch-grants'

// ── Contract test: submit.ts must translate checkStaffBranchScope results into the
// existing error classes. Pins the mapping the guard implements. ──────────────
function mapToError(res: ReturnType<typeof checkStaffBranchScope>, defaultStoreId: string | null) {
  if (res.ok) return null
  if (res.kind === 'out_of_scope') return new BuyerScopeError(res.mismatched, defaultStoreId)
  return new MixedShippingAddressError()
}

describe('submit guard mapping (contract)', () => {
  it('ungranted branch => BuyerScopeError', () => {
    const allowed = resolveBranchStoreIds([], 'home') // plain staff
    const res = checkStaffBranchScope({ shipToStoreIds: ['other'], allowedBranches: allowed, allOneTimeLines: false, hasCustomShippingAddress: false })
    expect(mapToError(res, 'home')).toBeInstanceOf(BuyerScopeError)
  })
  it('two branches => MixedShippingAddressError', () => {
    const allowed = resolveBranchStoreIds(['b', 'c'], 'home')
    const res = checkStaffBranchScope({ shipToStoreIds: ['b', 'c'], allowedBranches: allowed, allOneTimeLines: false, hasCustomShippingAddress: false })
    expect(mapToError(res, 'home')).toBeInstanceOf(MixedShippingAddressError)
  })
})

// ── Real guard tests: drive submitCustomerOrder itself. The buyer-scope guard runs
// before any DB call, so a stub that throws on .from proves the guard passed. ──
const noDbAdmin = {} as unknown as Parameters<typeof submitCustomerOrder>[0]
const pastGuardAdmin = {
  from: () => {
    throw new Error('past staff ship-to guard')
  },
} as unknown as Parameters<typeof submitCustomerOrder>[0]

function managerCtx(overrides: Partial<B2BCustomerContext> = {}): B2BCustomerContext {
  return {
    userId: 'u1', membershipId: 'm1', role: 'staff', email: 'a@b.co',
    fullName: 'A', organizationId: 'org1', organizationName: 'Org',
    customerCode: 'PRT', isTest: false, b2bAccountId: 'b1', tierLevel: 1, paymentTerms: 'net20',
    contractNotes: null, pricingMode: null, defaultDepositPercent: null, storeIds: ['s1', 'b', 'c'],
    defaultStoreId: 's1', branchStoreIds: ['b', 'c'], tenantType: 'franchise',
    allowsMultiStoreOrdering: false, moqExempt: false, orderingPermission: 'both', ...overrides,
  }
}

describe('submitCustomerOrder manager branch scope', () => {
  it('manager ordering for a granted branch (all lines) passes the guard', async () => {
    await expect(
      submitCustomerOrder(pastGuardAdmin, {
        context: managerCtx(),
        idempotency_key: 'k1',
        lines: [
          { product_id: 'p1', product_name: 'Tee', qty: 10, ship_to_store_id: 'b' },
          { product_id: 'p2', product_name: 'Cap', qty: 5, ship_to_store_id: 'b' },
        ],
      }),
    ).rejects.toThrow('past staff ship-to guard')
  })

  it('manager ordering for an UNgranted branch => BuyerScopeError', async () => {
    await expect(
      submitCustomerOrder(noDbAdmin, {
        context: managerCtx(),
        idempotency_key: 'k2',
        lines: [{ product_id: 'p1', product_name: 'Tee', qty: 10, ship_to_store_id: 'x' }],
      }),
    ).rejects.toBeInstanceOf(BuyerScopeError)
  })

  it('manager mixing two granted branches in one order => MixedShippingAddressError', async () => {
    await expect(
      submitCustomerOrder(noDbAdmin, {
        context: managerCtx(),
        idempotency_key: 'k3',
        lines: [
          { product_id: 'p1', product_name: 'Tee', qty: 10, ship_to_store_id: 'b' },
          { product_id: 'p2', product_name: 'Cap', qty: 5, ship_to_store_id: 'c' },
        ],
      }),
    ).rejects.toBeInstanceOf(MixedShippingAddressError)
  })

  it('manager ordering for their home (default) branch passes the guard', async () => {
    await expect(
      submitCustomerOrder(pastGuardAdmin, {
        context: managerCtx(),
        idempotency_key: 'k4',
        lines: [{ product_id: 'p1', product_name: 'Tee', qty: 10, ship_to_store_id: 's1' }],
      }),
    ).rejects.toThrow('past staff ship-to guard')
  })
})
