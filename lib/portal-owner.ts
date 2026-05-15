import type { B2BCustomerAccess } from '@/types/company'

export function getPortalOwnerKey(
  access: Pick<B2BCustomerAccess, 'companyId' | 'userId'> | null,
): string | null {
  if (!access) return null
  return access.companyId ? `org:${access.companyId}` : `user:${access.userId}`
}
