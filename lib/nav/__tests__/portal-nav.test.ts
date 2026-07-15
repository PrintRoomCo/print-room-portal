import { describe, it, expect } from 'vitest'
import { getNavigationItems, type NavAccess } from '../portal-nav'

function access(over: Partial<NavAccess> = {}): NavAccess {
  return {
    isCompanyUser: over.isCompanyUser ?? true,
    canUseLeavers: over.canUseLeavers ?? false,
    isOrgAdmin: over.isOrgAdmin ?? false,
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

describe('getNavigationItems — Track my Project gating (Item 5)', () => {
  it('shows Track my Project to an org_admin', () => {
    expect(hrefs(access({ isOrgAdmin: true }))).toContain('/tracking')
  })
  it('hides Track my Project from a non-admin (staff)', () => {
    expect(hrefs(access({ isOrgAdmin: false }))).not.toContain('/tracking')
  })
})
