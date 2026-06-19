import type { PricingMode } from '@/lib/pricing/types'

/**
 * B2B Customer Access — ported from customer-access.server.ts
 *
 * Stripped Shopify-only fields: catalogId, catalogTitle, publicationId
 * customerId renamed to userId (Supabase auth.users.id)
 */
export interface B2BCustomerAccess {
  userId: string
  email: string
  firstName: string
  lastName: string
  companyId: string | null
  companyName: string | null
  locationIds: string[]
  role: 'org_admin' | 'staff'
  tier: string

  isCompanyUser: boolean
  isIndividual: boolean

  isOrgAdmin: boolean
  isBuyer: boolean
  isCreative: boolean

  canViewLocations: boolean
  canViewReports: boolean
  canViewAccountRequests: boolean
  canViewAllLocations: boolean
  canApproveDesigns: boolean
  canManageUsers: boolean
  canUseLeavers: boolean

  /** Buyer is locked to defaultStoreId for ship-to. org_admin can pick any org store. */
  canPlaceOrderForOtherStores: boolean

  /** org_admin sees the full org order list; buyer sees only own orders. */
  canSeeAllOrgOrders: boolean

  /** WS4 — friendly tier name from TIER_LABELS map. Null when no b2b_account or unknown tier. */
  tierLabel: string | null
  /** WS4 — fractional discount (0.10 = 10%). 0 when no b2b_account or no price_tiers row. */
  tierDiscount: number
  /** WS4 — pricing mode for the org. See lib/pricing/types.ts. */
  pricingMode: PricingMode

  /**
   * True if the organization has any rows in `variant_inventory` (Inventory sub-app).
   * Gates Sidebar link visibility and /inventory page behaviour.
   * Tolerant of the table not existing yet — falls back to false.
   */
  hasTrackedInventory: boolean

  /** Per-buyer default ship-to store, set by staff. Null = no default. */
  defaultStoreId: string | null

  /**
   * Customer-shape discriminator from b2b_accounts.tenant_type.
   * Null when isIndividual (no b2b_account row).
   * Consumers should prefer the named permission flags below over raw enum reads.
   */
  tenantType: 'franchise' | 'studio_plus_inventory' | 'studio' | null

  /**
   * Derived from tenantType. True only for studio_plus_inventory tenants
   * (catalogue + inventory shape; admins can place orders across stores).
   */
  allowsMultiStoreOrdering: boolean

  /** True when this access was built for a staff preview (read-only). */
  isPreview?: boolean
  /** Banner copy source — who/what is being previewed. Set only in preview. */
  previewAs?: {
    name: string
    role: 'org_admin' | 'staff'
    orderingPermission: 'stock_only' | 'reorder_only' | 'both'
  }
}
