/**
 * Roles a customer-portal org_admin may CREATE via self-serve invite.
 * Deliberately staff-only: an org_admin can NEVER mint another org_admin
 * (F2 hard guard). Pure module so the rule is unit-testable without the route.
 */
export const INVITABLE_ROLES = new Set<'staff'>(['staff'])

export function isInvitableRole(role: string): role is 'staff' {
  return INVITABLE_ROLES.has(role as 'staff')
}
