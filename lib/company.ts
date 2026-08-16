import { cache } from 'react'
import { getSupabaseServer } from '@/lib/supabase'
import { getTierLabel } from '@/lib/pricing/tier-labels'
import type { PricingMode } from '@/lib/pricing/types'
import type { B2BCustomerAccess } from '@/types/company'

/**
 * Build B2BCustomerAccess from Supabase tables.
 * Replaces the Shopify Admin API-based customer-access.server.ts.
 *
 * Resolution is issued in dependency "waves" rather than one query at a time:
 *   Wave A: profile + org membership          (both keyed on userId)
 *   Wave B: org + b2b account + stores + inv.  (all keyed on organization_id)
 *   Wave C: price tier                          (needs b2bAccount.tier_level)
 * Collapsing ~6 sequential round-trips into ~3 waves. Wrapped in React
 * `cache()` so the layout and the page in a single render resolve access once
 * instead of re-running the whole chain per call site.
 */
export const getCompanyAccess = cache(async (
  userId: string,
  email?: string
): Promise<B2BCustomerAccess | null> => {
  const supabase = getSupabaseServer()

  // Wave A — profile + membership resolve together (neither depends on the other).
  const [{ data: profile }, { data: orgMembership }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).single(),
    supabase
      .from('user_organizations')
      .select('organization_id, role, default_store_id')
      .eq('user_id', userId)
      .single(),
  ])

  if (!profile) {
    // Fallback: try to find by email via user_auth_sync
    if (!email) return null

    return buildAccessForIndividual(userId, email)
  }

  const userEmail = email || profile.email || ''
  const fullName = profile.full_name || ''
  const [firstName = '', ...lastParts] = fullName.split(' ')
  const lastName = lastParts.join(' ')

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

  // Wave B — org details, B2B account, stores and inventory presence all key
  // on organization_id, so they issue together. (In the rare soft-deleted-org
  // case the account/stores/inventory results are simply discarded below.)
  const orgId = orgMembership.organization_id
  const [
    { data: org },
    { data: b2bAccount },
    { data: locations },
    { count, error: inventoryError },
  ] = await Promise.all([
    supabase.from('organizations').select('*').eq('id', orgId).is('deleted_at', null).maybeSingle(),
    supabase.from('b2b_accounts').select('*').eq('organization_id', orgId).maybeSingle(),
    supabase.from('stores').select('id').eq('organization_id', orgId),
    // Tolerant of `variant_inventory` not existing yet (Inventory sub-app
    // migration may not have shipped) — PostgREST returns an error and we
    // fall back to false below.
    supabase
      .from('variant_inventory')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId),
  ])

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

  // Wave C — tier discount depends on the account's tier_level from Wave B.
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

  const locationIds = (locations || []).map((loc) => loc.id)
  const role = (orgMembership.role as 'org_admin' | 'staff') || 'org_admin'
  const tier = b2bAccount?.tier_level?.toString() || 'bronze'

  const hasTrackedInventory =
    !inventoryError && typeof count === 'number' && count > 0

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
    region: ((org as { region?: string | null } | null)?.region === 'AU' ? 'AU' : 'NZ'),
  })
})

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
  /** AU Stage 1 — organizations.region. Absent on the individual-user and
   *  soft-deleted-org paths, which have no org row; those default to 'NZ'. */
  region?: 'NZ' | 'AU'
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
    region,
    ...rest
  } = input

  const isOrgAdmin = role === 'org_admin'
  const isBuyer = role === 'staff'

  return {
    ...rest,
    region: region ?? 'NZ',
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
