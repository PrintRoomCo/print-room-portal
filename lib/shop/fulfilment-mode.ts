/**
 * Catalogue-item fulfilment nature (mirrors the product_fulfilment_type enum +
 * the staff src/types/products.ts FulfilmentType). Stored as
 * b2b_catalogue_items.fulfilment_type_override, base on products.fulfilment_type.
 */
export type FulfilmentType = 'stocked' | 'made_to_order' | 'mixed'

/** The two customer-facing ordering modes (pills). */
export type Pill = 'from_inventory' | 'reorder'

/** Catalogue filter value, including the unfiltered default. */
export type OrderingMode = 'all' | 'from_inventory' | 'reorder'

export const PILL_LABELS: Record<Pill, string> = {
  from_inventory: 'From inventory',
  reorder: 'Reorder',
}

/** Effective mode = catalogue override ?? master base ?? made_to_order. */
export function effectiveFulfilment(
  override: FulfilmentType | null | undefined,
  base: FulfilmentType | null | undefined,
): FulfilmentType {
  return override ?? base ?? 'made_to_order'
}

/**
 * Which pills apply for a product, given its effective mode and whether the
 * viewer is an org_admin. Restricted members (staff) never get Reorder — they
 * are inventory-only by role (spec Cross-cutting).
 */
export function pillsFor(effective: FulfilmentType, isOrgAdmin: boolean): Pill[] {
  const all: Pill[] =
    effective === 'stocked'
      ? ['from_inventory']
      : effective === 'made_to_order'
        ? ['reorder']
        : ['from_inventory', 'reorder'] // mixed
  return isOrgAdmin ? all : all.filter((p) => p !== 'reorder')
}

/** Catalogue mode filter: does a product's effective mode match the selected filter? */
export function matchesMode(effective: FulfilmentType, mode: OrderingMode): boolean {
  if (mode === 'all') return true
  if (mode === 'from_inventory') return effective === 'stocked' || effective === 'mixed'
  return effective === 'made_to_order' || effective === 'mixed' // reorder
}

/** Layer-2: per-member ordering permission (user_organizations.ordering_permission). */
export type MemberPermission = 'stock_only' | 'reorder_only' | 'both'

/** Customer-portal role discriminator (lib/checkout/server.ts). */
export type CustomerRole = 'org_admin' | 'staff'

/**
 * The permission actually in force for a viewer. org_admin is ALWAYS unrestricted
 * ('both') by role; staff use their stored permission, defaulting to least-privilege.
 */
export function effectivePermission(
  role: CustomerRole,
  stored: MemberPermission | null | undefined,
): MemberPermission {
  if (role === 'org_admin') return 'both'
  return stored ?? 'stock_only'
}

export interface OrderingOptions {
  /** May this viewer draw this product from existing stock? */
  canDrawStock: boolean
  /** May this viewer trigger a production run (order beyond / without stock)? */
  canReorder: boolean
  /** Neither path is available — structural dead-zone (show disabled + contact message). */
  deadZone: boolean
}

/**
 * Intersection of the product's nature (the ceiling of what is POSSIBLE) and the
 * member's permission (the cap on what they may DO). Product nature: stocked→{draw},
 * made_to_order→{reorder}, mixed→{draw,reorder}. Permission: stock_only→{draw},
 * reorder_only→{reorder}, both→{draw,reorder}. Live-stock gating of the draw path is
 * applied by the caller (zero stock = transient out-of-stock, NOT a dead-zone).
 */
export function orderingOptions(
  nature: FulfilmentType,
  permission: MemberPermission,
): OrderingOptions {
  const productDraw = nature === 'stocked' || nature === 'mixed'
  const productReorder = nature === 'made_to_order' || nature === 'mixed'
  const memberDraw = permission === 'stock_only' || permission === 'both'
  const memberReorder = permission === 'reorder_only' || permission === 'both'
  const canDrawStock = productDraw && memberDraw
  const canReorder = productReorder && memberReorder
  return { canDrawStock, canReorder, deadZone: !canDrawStock && !canReorder }
}
