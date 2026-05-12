import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { B2BCustomerAccess } from '@/types/company'

const useCompanyMock = vi.fn()
vi.mock('@/contexts/CompanyContext', () => ({
  useCompany: () => useCompanyMock(),
}))

import { usePricingContext } from './usePricingContext'

function makeAccess(overrides: Partial<B2BCustomerAccess>): B2BCustomerAccess {
  return {
    userId: 'u',
    email: '',
    firstName: '',
    lastName: '',
    companyId: null,
    companyName: null,
    locationIds: [],
    role: 'org_admin',
    tier: 'bronze',
    isCompanyUser: false,
    isIndividual: true,
    isOrgAdmin: false,
    isBuyer: false,
    isCreative: true,
    canViewLocations: false,
    canViewReports: false,
    canViewAccountRequests: false,
    canViewAllLocations: false,
    canApproveDesigns: false,
    canManageUsers: false,
    canUseLeavers: false,
    canPlaceOrderForOtherStores: false,
    canSeeAllOrgOrders: false,
    tierLabel: null,
    tierDiscount: 0,
    pricingMode: 'catalogue',
    hasTrackedInventory: false,
    defaultStoreId: null,
    tenantType: null,
    allowsMultiStoreOrdering: false,
    ...overrides,
  }
}

describe('usePricingContext', () => {
  it('returns catalogue mode with null label when no access', () => {
    useCompanyMock.mockReturnValue({ access: null, loading: false })
    const { result } = renderHook(() => usePricingContext())
    expect(result.current.pricingMode).toBe('catalogue')
    expect(result.current.tierLabel).toBeNull()
    expect(result.current.tierDiscount).toBe(0)
  })

  it('returns catalogue mode with the tier label from access', () => {
    useCompanyMock.mockReturnValue({
      access: makeAccess({
        tierLabel: 'Wholesale',
        tierDiscount: 0.1,
        pricingMode: 'catalogue',
      }),
      loading: false,
    })
    const { result } = renderHook(() => usePricingContext())
    expect(result.current.pricingMode).toBe('catalogue')
    expect(result.current.tierLabel).toBe('Wholesale')
    expect(result.current.tierDiscount).toBe(0.1)
  })
})
