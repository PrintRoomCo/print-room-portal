import { describe, it, expect } from 'vitest'
import { getNavigationItems, PORTAL_NAV_ITEMS, type NavAccess } from '../portal-nav'

function access(over: Partial<NavAccess> = {}): NavAccess {
  return {
    isCompanyUser: over.isCompanyUser ?? true,
    canUseLeavers: over.canUseLeavers ?? false,
    isOrgAdmin: over.isOrgAdmin ?? false,
    canManageUsers: over.canManageUsers ?? false,
    tenantType: 'tenantType' in over ? over.tenantType! : 'franchise',
  }
}

const hrefs = (a: NavAccess) => getNavigationItems(a).map((i) => i.href)

describe('getNavigationItems — Inventory gating', () => {
  it('shows Inventory to an org_admin of a franchise tenant', () => {
    expect(hrefs(access({ isOrgAdmin: true, tenantType: 'franchise' }))).toContain('/inventory')
  })

  it('shows Inventory to an org_admin of a studio_plus_inventory tenant', () => {
    expect(hrefs(access({ isOrgAdmin: true, tenantType: 'studio_plus_inventory' }))).toContain('/inventory')
  })

  it('hides Inventory from a non-admin (staff/buyer) even on an inventory tenant', () => {
    expect(hrefs(access({ isOrgAdmin: false, tenantType: 'franchise' }))).not.toContain('/inventory')
  })

  it('hides Inventory from an org_admin of a plain studio tenant', () => {
    expect(hrefs(access({ isOrgAdmin: true, tenantType: 'studio' }))).not.toContain('/inventory')
  })

  it('does NOT gate Inventory on tracked-inventory presence (admins see the empty state)', () => {
    // NavAccess has no hasTrackedInventory field — proves the gate ignores it.
    expect(hrefs(access({ isOrgAdmin: true, tenantType: 'franchise' }))).toContain('/inventory')
  })

  it('keeps the existing rows working: Catalogue needs a company, Leavers needs the flag', () => {
    expect(hrefs(access({ isCompanyUser: false }))).not.toContain('/catalogue')
    expect(hrefs(access({ canUseLeavers: false }))).not.toContain('/leavers-quotes')
    expect(hrefs(access({ canUseLeavers: true }))).toContain('/leavers-quotes')
  })
})

describe('getNavigationItems — Current Orders gating (Item 5)', () => {
  it('shows Current Orders (the order tracker) to an org_admin', () => {
    expect(hrefs(access({ isOrgAdmin: true }))).toContain('/current-orders')
  })
  it('hides Current Orders from a non-admin (staff)', () => {
    expect(hrefs(access({ isOrgAdmin: false }))).not.toContain('/current-orders')
  })
  it('no longer exposes the old /tracking href', () => {
    expect(hrefs(access({ isOrgAdmin: true }))).not.toContain('/tracking')
  })
})

describe('Orders → Order history rename (Item 10)', () => {
  it('labels the /my-collections item "Order history" (frees "Current Orders" for the tracker)', () => {
    const item = PORTAL_NAV_ITEMS.find((i) => i.href === '/my-collections')
    expect(item?.name).toBe('Order history')
  })
})

describe('getNavigationItems — Team gating (canManageUsers)', () => {
  it('shows Team to a company org_admin who can manage users', () => {
    expect(hrefs(access({ canManageUsers: true }))).toContain('/team')
  })
  it('hides Team from a member who cannot manage users', () => {
    expect(hrefs(access({ canManageUsers: false }))).not.toContain('/team')
  })
  it('hides Team from an individual with no company', () => {
    expect(hrefs(access({ isCompanyUser: false, canManageUsers: true }))).not.toContain('/team')
  })
})
