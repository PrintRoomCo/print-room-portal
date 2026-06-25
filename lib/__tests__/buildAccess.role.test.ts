import { describe, it, expect } from 'vitest'
import { buildAccess } from '../company'

const base = {
  userId: 'u1',
  email: 'a@b.co',
  firstName: 'A',
  lastName: 'B',
  companyId: 'org1',
  companyName: 'Org',
  logoUrl: null,
  locationIds: [] as string[],
  tier: 'bronze',
  tierLabel: null,
  tierDiscount: 0,
  pricingMode: 'catalogue' as const,
  isCompanyUser: true,
  leaversEnabled: false,
  hasTrackedInventory: false,
  defaultStoreId: null,
  tenantType: 'franchise' as const,
}

describe('buildAccess role derivation', () => {
  it("treats 'staff' as the restricted role", () => {
    const a = buildAccess({ ...base, role: 'staff' })
    expect(a.role).toBe('staff')
    expect(a.isOrgAdmin).toBe(false)
    expect(a.isBuyer).toBe(true) // internal flag name unchanged; semantics = "restricted"
    expect(a.canApproveDesigns).toBe(false)
    expect(a.canSeeAllOrgOrders).toBe(false)
  })

  it("treats 'org_admin' as the privileged role", () => {
    const a = buildAccess({ ...base, role: 'org_admin' })
    expect(a.isOrgAdmin).toBe(true)
    expect(a.isBuyer).toBe(false)
    expect(a.canApproveDesigns).toBe(true)
  })
})
