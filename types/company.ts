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
  role: 'admin' | 'manager' | 'staff'
  tier: string

  isCompanyUser: boolean
  isIndividual: boolean

  isAdmin: boolean
  isManager: boolean
  isStaff: boolean
  isCreative: boolean

  canViewLocations: boolean
  canViewReports: boolean
  canViewAccountRequests: boolean
  canViewAllLocations: boolean
  canApproveDesigns: boolean
  canManageUsers: boolean
}
