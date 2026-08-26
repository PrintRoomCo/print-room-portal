import { describe, expect, it } from 'vitest'
import { buildAccess } from './company'

const input = {
  userId: 'u1',
  email: 'buyer@example.com',
  firstName: 'Buyer',
  lastName: 'One',
  companyId: 'org-1',
  companyName: 'Example Org',
  logoUrl: null,
  locationIds: [] as string[],
  role: 'org_admin' as const,
  tier: '3',
  tierLabel: 'Gold',
  tierDiscount: 0,
  pricingMode: 'catalogue' as const,
  isCompanyUser: true,
  leaversEnabled: false,
  hasTrackedInventory: false,
  defaultStoreId: null,
  tenantType: 'franchise' as const,
}

describe('buildAccess', () => {
  it('keeps billing country data out of the access object', () => {
    const access = buildAccess(input)

    expect(access).not.toHaveProperty('region')
    expect(access).not.toHaveProperty('defaultBillingCountry')
  })
})
