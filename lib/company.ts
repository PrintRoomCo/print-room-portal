import { getSupabaseServer } from '@/lib/supabase'
import type { B2BCustomerAccess } from '@/types/company'

/**
 * Build B2BCustomerAccess from Supabase tables.
 * Replaces the Shopify Admin API-based customer-access.server.ts.
 *
 * Query chain:
 * 1. profiles → identity (name, email)
 * 2. user_organizations + organizations → company membership + role
 * 3. b2b_accounts → tier, payment terms
 * 4. stores → company locations
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
    .select('organization_id, role')
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
      locationIds: [],
      role: 'staff',
      tier: 'bronze',
      isCompanyUser: false,
      leaversEnabled,
    })
  }

  // 3. Get organization details
  const { data: org } = await supabase
    .from('organizations')
    .select('*')
    .eq('id', orgMembership.organization_id)
    .single()

  // 4. Get B2B account details (tier, credit limit, etc.)
  const { data: b2bAccount } = await supabase
    .from('b2b_accounts')
    .select('*')
    .eq('id', orgMembership.organization_id)
    .single()

  // 5. Get company locations (stores)
  const { data: locations } = await supabase
    .from('stores')
    .select('id')
    .eq('organization_id', orgMembership.organization_id)

  const locationIds = (locations || []).map((loc) => loc.id)
  const role = (orgMembership.role as 'admin' | 'manager' | 'staff') || 'staff'
  const tier = b2bAccount?.tier_level?.toString() || 'bronze'

  return buildAccess({
    userId,
    email: userEmail,
    firstName,
    lastName,
    companyId: orgMembership.organization_id,
    companyName: org?.name || profile.company_name || null,
    locationIds,
    role,
    tier,
    isCompanyUser: true,
    leaversEnabled,
  })
}

interface AccessInput {
  userId: string
  email: string
  firstName: string
  lastName: string
  companyId: string | null
  companyName: string | null
  locationIds: string[]
  role: 'admin' | 'manager' | 'staff'
  tier: string
  isCompanyUser: boolean
  leaversEnabled: boolean
}

function buildAccess(input: AccessInput): B2BCustomerAccess {
  const { role, isCompanyUser, leaversEnabled, ...rest } = input

  const isAdmin = role === 'admin'
  const isManager = role === 'manager'
  const isStaff = role === 'staff'

  return {
    ...rest,
    role,
    isCompanyUser,
    isIndividual: !isCompanyUser,
    isAdmin,
    isManager,
    isStaff,
    isCreative: !isCompanyUser || isStaff,

    // Permission flags — same logic as original customer-access.server.ts
    canViewLocations: isCompanyUser && (isAdmin || isManager),
    canViewReports: isCompanyUser && isAdmin,
    canViewAccountRequests: isAdmin,
    canViewAllLocations: isAdmin,
    canApproveDesigns: isAdmin || isManager,
    canManageUsers: isAdmin,
    canUseLeavers: leaversEnabled,
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
    locationIds: [],
    role: 'staff',
    tier: 'bronze',
    isCompanyUser: false,
    leaversEnabled: false,
  })
}
