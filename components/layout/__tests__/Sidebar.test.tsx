import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Sidebar } from '../Sidebar'
import { PortalTopBarProvider } from '../PortalTopBarContext'
import type { B2BCustomerAccess } from '@/types/company'

vi.mock('next/navigation', () => ({
  usePathname: () => '/catalogue',
}))

function customer(over: Partial<B2BCustomerAccess> = {}): B2BCustomerAccess {
  return {
    userId: 'user-1',
    email: 'buyer@example.com',
    firstName: 'Test',
    lastName: 'Buyer',
    companyId: 'company-1',
    companyName: 'Test Company',
    logoUrl: null,
    locationIds: [],
    role: 'org_admin',
    tier: 'standard',
    isCompanyUser: true,
    isIndividual: false,
    isOrgAdmin: true,
    isBuyer: false,
    isCreative: false,
    canViewLocations: true,
    canViewReports: true,
    canViewAccountRequests: true,
    canViewAllLocations: true,
    canApproveDesigns: true,
    canManageUsers: true,
    canUseLeavers: false,
    canPlaceOrderForOtherStores: true,
    canSeeAllOrgOrders: true,
    tierLabel: 'Standard',
    tierDiscount: 0,
    pricingMode: 'catalogue',
    hasTrackedInventory: true,
    defaultStoreId: null,
    tenantType: 'franchise',
    allowsMultiStoreOrdering: false,
    ...over,
  }
}

describe('Sidebar', () => {
  it('renders Catalogue as the first primary navigation row', () => {
    const { container } = render(
      <PortalTopBarProvider>
        <Sidebar customer={customer()}>content</Sidebar>
      </PortalTopBarProvider>,
    )

    const rows = Array.from(container.querySelectorAll('a[data-row]')).map(
      (link) => link.getAttribute('aria-label'),
    )

    expect(rows).toEqual([
      'Catalogue',
      'Current Orders',
      'Order history',
      'Inventory',
      'Users',
    ])
  })
})
