export type TenantType = 'franchise' | 'studio_plus_inventory' | 'studio'

export type NavIconKey =
  | 'tracking'
  | 'catalogue'
  | 'orders'
  | 'proofs'
  | 'leavers'
  | 'inventory'

export interface PortalNavItem {
  name: string
  href: string
  iconKey: NavIconKey
  requiresCompany: boolean
  requiresLeavers: boolean
  requiresOrgAdmin: boolean
  requiredTenantTypes: ReadonlyArray<TenantType> | null
}

/** Subset of B2BCustomerAccess the nav filter needs. */
export interface NavAccess {
  isCompanyUser: boolean
  canUseLeavers: boolean
  isOrgAdmin: boolean
  tenantType: TenantType | null
}

// Display order. Items whose iconKey is NOT a hand-drawn SVG row
// (tracking/catalogue/orders/proofs) render as classic Link rows in the
// Sidebar's extraItems list — that's the path Leavers Quotes and Inventory take.
export const PORTAL_NAV_ITEMS: ReadonlyArray<PortalNavItem> = [
  {
    name: 'Catalogue',
    href: '/catalogue',
    iconKey: 'catalogue',
    requiresCompany: true,
    requiresLeavers: false,
    requiresOrgAdmin: false,
    requiredTenantTypes: null,
  },
  {
    name: 'Track my Project',
    href: '/tracking',
    iconKey: 'tracking',
    requiresCompany: false,
    requiresLeavers: false,
    requiresOrgAdmin: true,
    requiredTenantTypes: null,
  },
  {
    name: 'Past orders',
    href: '/my-collections',
    iconKey: 'orders',
    requiresCompany: false,
    requiresLeavers: false,
    requiresOrgAdmin: false,
    requiredTenantTypes: null,
  },
  // Proofs tab hidden for now (2026-06-26) — re-enable by uncommenting.
  // Sidebar's hand-drawn 'proofs' row is gated on this nav item, so it goes
  // inert automatically while this is commented out. The /proofs route still
  // exists; this only removes the tab from the customer portal navigation.
  // {
  //   name: 'Proofs',
  //   href: '/proofs',
  //   iconKey: 'proofs',
  //   requiresCompany: true,
  //   requiresLeavers: false,
  //   requiresOrgAdmin: false,
  //   requiredTenantTypes: null,
  // },
  {
    name: 'Inventory',
    href: '/inventory',
    iconKey: 'inventory',
    requiresCompany: true,
    requiresLeavers: false,
    requiresOrgAdmin: true,
    requiredTenantTypes: ['franchise', 'studio_plus_inventory'],
  },
  {
    name: 'Leavers Quotes',
    href: '/leavers-quotes',
    iconKey: 'leavers',
    requiresCompany: false,
    requiresLeavers: true,
    requiresOrgAdmin: false,
    requiredTenantTypes: null,
  },
]

export function getNavigationItems(access: NavAccess): PortalNavItem[] {
  return PORTAL_NAV_ITEMS.filter((item) => {
    if (item.requiresCompany && !access.isCompanyUser) return false
    if (item.requiresLeavers && !access.canUseLeavers) return false
    if (item.requiresOrgAdmin && !access.isOrgAdmin) return false
    if (item.requiredTenantTypes) {
      if (!access.tenantType) return false
      if (!item.requiredTenantTypes.includes(access.tenantType)) return false
    }
    return true
  })
}
