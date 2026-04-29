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
    role: 'staff',
    tier: 'bronze',
    isCompanyUser: false,
    isIndividual: true,
    isAdmin: false,
    isManager: false,
    isStaff: true,
    isCreative: true,
    canViewLocations: false,
    canViewReports: false,
    canViewAccountRequests: false,
    canViewAllLocations: false,
    canApproveDesigns: false,
    canManageUsers: false,
    canUseLeavers: false,
    tierLabel: null,
    tierDiscount: 0,
    pricingMode: 'standard',
    hasTrackedInventory: false,
    ...overrides,
  }
}

describe('usePricingContext', () => {
  it('returns standard mode when no access', () => {
    useCompanyMock.mockReturnValue({ access: null, loading: false })
    const { result } = renderHook(() => usePricingContext())
    expect(result.current.pricingMode).toBe('standard')
    expect(result.current.tierLabel).toBeNull()
    expect(result.current.tierDiscount).toBe(0)
  })

  it('returns catalogue mode for PRT-like access', () => {
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

  it('returns tiered mode for non-catalogue tier-2', () => {
    useCompanyMock.mockReturnValue({
      access: makeAccess({
        tierLabel: 'Trade',
        tierDiscount: 0.05,
        pricingMode: 'tiered',
      }),
      loading: false,
    })
    const { result } = renderHook(() => usePricingContext())
    expect(result.current.pricingMode).toBe('tiered')
    expect(result.current.tierLabel).toBe('Trade')
    expect(result.current.tierDiscount).toBe(0.05)
  })
})
