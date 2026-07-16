export type TenantType = 'franchise' | 'studio_plus_inventory' | 'studio' | null
export type MemberOrderingPermission = 'stock_only' | 'reorder_only' | 'both'

/**
 * Ordering-permission options a self-serve invite may grant, scoped by tenant.
 * Studios keep no stock, so a studio staff member can only ever reorder —
 * offering 'stock_only' would leave them unable to order anything. Inventory
 * tenants (franchise / studio_plus_inventory) get the full set. Mirrors the
 * staff EditRoleDialog's orderingPermissionOptions(tenantType).
 */
export function orderingPermissionOptions(
  tenantType: TenantType,
): MemberOrderingPermission[] {
  if (tenantType === 'studio') return ['reorder_only']
  return ['stock_only', 'reorder_only', 'both']
}

/** The default ordering permission for a new invite on this tenant. */
export function defaultOrderingPermission(
  tenantType: TenantType,
): MemberOrderingPermission {
  return tenantType === 'studio' ? 'reorder_only' : 'stock_only'
}
