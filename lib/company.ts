import { getSupabaseServer } from '@/lib/supabase'
import { getTierLabel } from '@/lib/pricing/tier-labels'
import type { PricingMode } from '@/lib/pricing/types'
import type { B2BCustomerAccess } from '@/types/company'

/**
 * Build B2BCustomerAccess from Supabase tables.
 * Replaces the Shopify Admin API-based customer-access.server.ts.
 *
 * Query chain:
 * 1. profiles → identity (name, email)
 * 2. user_organizations + organizations → company membership + role
 * 3. b2b_accounts → tier, payment terms
 * 4. price_tiers + b2b_catalogues → WS4 tier discount + pricing mode
 * 5. stores → company locations
 * 6. variant_inventory → tracked-inventory presence
 */
export async function getCompanyAccess(
  userId: string,
  email?: string
): Promise<B2BCustomerAccess | null> {
  const supabase = getSupabaseServer()

  // 1. Get user profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()

  if (!profile) {
    // Fallback: try to find by email via user_auth_sync
    if (!email) return null

    return buildAccessForIndividual(userId, email)
  }

  const userEmail = email || profile.email || ''
  const fullName = profile.full_name || ''
  const [firstName = '', ...lastParts] = fullName.split(' ')
  const lastName = lastParts.join(' ')

  // 2. Get organization membership
  const { data: orgMembership } = await supabase
    .from('user_organizations')
    .select('organization_id, role, default_store_id')
    .eq('user_id', userId)
    .single()

  const leaversEnabled = Boolean(profile.leavers_enabled)

  // No company — individual user
  if (!orgMembership) {
    return buildAccess({
      userId,
      email: userEmail,
      firstName,
      lastName,
      companyId: null,
      companyName: profile.company_name || null,
      logoUrl: null,
      locationIds: [],
      role: 'org_admin',
      tier: 'bronze',
      tierLabel: null,
      tierDiscount: 0,
      pricingMode: 'catalogue',
      isCompanyUser: false,
      leaversEnabled,
      hasTrackedInventory: false,
      defaultStoreId: null,
      tenantType: null,
    })
  }

  // 3. Get organization details (soft-deleted orgs return null → no_org gate)
  const { data: org } = await supabase
    .from('organizations')
    .select('*')
    .eq('id', orgMembership.organization_id)
    .is('deleted_at', null)
    .maybeSingle()

  // Org was soft-deleted (or never existed) — treat as individual user, not a
  // phantom B2B session against a deleted company.
  if (!org) {
    return buildAccess({
      userId,
      email: userEmail,
      firstName,
      lastName,
      companyId: null,
      companyName: profile.company_name || null,
      logoUrl: null,
      locationIds: [],
      role: 'org_admin',
      tier: 'bronze',
      tierLabel: null,
      tierDiscount: 0,
      pricingMode: 'catalogue',
      isCompanyUser: false,
      leaversEnabled,
      hasTrackedInventory: false,
      defaultStoreId: null,
      tenantType: null,
    })
  }

  // 4. Get B2B account details (tier, credit limit, etc.)
  const { data: b2bAccount } = await supabase
    .from('b2b_accounts')
    .select('*')
    .eq('organization_id', orgMembership.organization_id)
    .maybeSingle()

  // 4b. Tier discount + active catalogue presence (WS4)
  const tierLevel = b2bAccount?.tier_level ?? null
  const tierLevelStr = tierLevel != null ? String(tierLevel) : null

  const { data: priceTier } = tierLevelStr
    ? await supabase
        .from('price_tiers')
        .select('discount')
        .eq('tier_id', tierLevelStr)
        .maybeSingle()
    : { data: null as { discount: number | null } | null }

  const tierDiscount = Number(priceTier?.discount ?? 0)
  const tierLabel = getTierLabel(tierLevel)
  const pricingMode: PricingMode = 'catalogue'

  // 5. Get company locations (stores)
  const { data: locations } = await supabase
    .from('stores')
    .select('id')
    .eq('organization_id', orgMembership.organization_id)

  const locationIds = (locations || []).map((loc) => loc.id)
  const role = (orgMembership.role as 'org_admin' | 'staff') || 'org_admin'
  const tier = b2bAccount?.tier_level?.toString() || 'bronze'

  // 6. Check if the organization has any tracked inventory.
  //    Tolerant of `variant_inventory` not existing yet (Inventory sub-app
  //    migration may not have shipped) — PostgREST returns an error and we
  //    fall back to false.
  let hasTrackedInventory = false
  const { count, error: inventoryError } = await supabase
    .from('variant_inventory')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgMembership.organization_id)

  if (!inventoryError && typeof count === 'number' && count > 0) {
    hasTrackedInventory = true
  }

  return buildAccess({
    userId,
    email: userEmail,
    firstName,
    lastName,
    companyId: orgMembership.organization_id,
    companyName: org?.name || profile.company_name || null,
    logoUrl: (org as { logo_url?: string | null } | null)?.logo_url ?? null,
    locationIds,
    role,
    tier,
    tierLabel,
    tierDiscount,
    pricingMode,
    isCompanyUser: true,
    leaversEnabled,
    hasTrackedInventory,
    defaultStoreId: orgMembership.default_store_id ?? null,
    tenantType: (b2bAccount?.tenant_type as B2BCustomerAccess['tenantType']) ?? null,
  })
}

interface AccessInput {
  userId: string
  email: string
  firstName: string
  lastName: string
  companyId: string | null
  companyName: string | null
  logoUrl: string | null
  locationIds: string[]
  role: 'org_admin' | 'staff'
  tier: string
  tierLabel: string | null
  tierDiscount: number
  pricingMode: PricingMode
  isCompanyUser: boolean
  leaversEnabled: boolean
  hasTrackedInventory: boolean
  defaultStoreId: string | null
  tenantType: B2BCustomerAccess['tenantType']
}

export function buildAccess(input: AccessInput): B2BCustomerAccess {
  const {
    role,
    isCompanyUser,
    leaversEnabled,
    hasTrackedInventory,
    tierLabel,
    tierDiscount,
    pricingMode,
    tenantType,
    ...rest
  } = input

  const isOrgAdmin = role === 'org_admin'
  const isBuyer = role === 'staff'

  return {
    ...rest,
    role,
    isCompanyUser,
    isIndividual: !isCompanyUser,
    isOrgAdmin,
    isBuyer,
    isCreative: !isCompanyUser,

    canViewLocations: isCompanyUser && isOrgAdmin,
    canViewReports: isCompanyUser && isOrgAdmin,
    canViewAccountRequests: isOrgAdmin,
    canViewAllLocations: isOrgAdmin,
    canApproveDesigns: isOrgAdmin,
    canManageUsers: isOrgAdmin,
    canUseLeavers: leaversEnabled,

    canPlaceOrderForOtherStores: isOrgAdmin,
    canSeeAllOrgOrders: isOrgAdmin,

    tierLabel,
    tierDiscount,
    pricingMode,

    hasTrackedInventory,

    tenantType,
    allowsMultiStoreOrdering: tenantType === 'studio_plus_inventory',
  }
}

async function buildAccessForIndividual(
  userId: string,
  email: string
): Promise<B2BCustomerAccess> {
  return buildAccess({
    userId,
    email,
    firstName: '',
    lastName: '',
    companyId: null,
    companyName: null,
    logoUrl: null,
    locationIds: [],
    role: 'org_admin',
    tier: 'bronze',
    tierLabel: null,
    tierDiscount: 0,
    pricingMode: 'catalogue',
    isCompanyUser: false,
    leaversEnabled: false,
    hasTrackedInventory: false,
    defaultStoreId: null,
    tenantType: null,
  })
}
