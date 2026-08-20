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
  from_inventory: 'Stock on hand',
  reorder: 'Purchase order',
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

/**
 * Does this member's permission ever grant a reorder (production-run) path?
 * True for 'reorder_only' and 'both'; false for 'stock_only'. This is the
 * member-side factor of orderingOptions().canReorder — the SAME condition that
 * hides the PDP order-mode pill for a stock_only member. The catalogue
 * FilterRail ordering-mode filter reuses it so a stock_only member never sees a
 * "Purchase order" filter option they could never act on.
 */
export function memberCanReorder(permission: MemberPermission): boolean {
  return permission === 'reorder_only' || permission === 'both'
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
  const memberReorder = memberCanReorder(permission)
  const canDrawStock = productDraw && memberDraw
  const canReorder = productReorder && memberReorder
  return { canDrawStock, canReorder, deadZone: !canDrawStock && !canReorder }
}

/** Context for the per-line fulfilment decision on the PDP add-to-cart paths. */
export interface LineFulfilmentContext {
  /** orderingOptions().canDrawStock — product nature × member permission. */
  canDrawStock: boolean
  /** True when the PDP offers the From-inventory / Reorder toggle for this selection. */
  canChooseOrderIntent: boolean
  /** The toggle's current value; ignored when there is no toggle. */
  orderIntent: 'inventory' | 'bulk'
  /** This (colourway, size) cell has an inventory row (variant_inventory). */
  tracked: boolean
  /** Available qty for the cell; 0 when untracked. */
  available: number
  /** Requested quantity for this line. */
  lineQty: number
}

/**
 * Which fulfilment a cart line should claim. 'stocked' is a stock-DRAW claim:
 * it exempts the line from MOQ at submit (Spec A no longer gates Xero on it),
 * so it may only be claimed when a draw is actually possible — the viewer can
 * draw this product (nature stocked/mixed × member permission) AND either the
 * org_admin toggle chose From-inventory or the cell is tracked with enough
 * stock. Everything else is a production run. Mirrors submit_b2b_order, which
 * never draws on-hand stock for made_to_order/pre_order natures. (Fix 2026-07-06:
 * the old inline ternary DEFAULTED to 'stocked', mis-tagging untracked
 * made_to_order lines and blocking Xero auto-drafts.)
 */
export function lineFulfilment(ctx: LineFulfilmentContext): 'stocked' | 'made_to_order' {
  if (ctx.canChooseOrderIntent) {
    return ctx.orderIntent === 'bulk' ? 'made_to_order' : 'stocked'
  }
  if (!ctx.canDrawStock) return 'made_to_order'
  if (ctx.tracked) return ctx.lineQty > ctx.available ? 'made_to_order' : 'stocked'
  return 'made_to_order'
}

/**
 * Can this viewer actually order this (colourway, size) cell?
 *
 * `lineFulfilment` resolves a line to a stock draw or a production run, but its
 * two-value return can't say "no valid path" — so a stock_only member (a viewer
 * who cannot reorder) got an untracked or over-stock cell silently
 * tagged `made_to_order`, added at full price, and only rejected at the final
 * checkout click with "not stocked for your account" (submit_b2b_order coerces
 * their line to `stocked` and raises NO_INVENTORY / PERMISSION_DENIED).
 *
 * The rule: a viewer who can't reorder may only take a genuine `stocked` draw.
 * This mirrors the server one-to-one (stock_only + made_to_order →
 * member_cannot_produce), so the cell is blocked up front instead of failing
 * late. Viewers who CAN reorder are unaffected — a production run is valid for
 * them.
 */
export function lineIsOrderable(ctx: LineFulfilmentContext, canReorder: boolean): boolean {
  return lineFulfilment(ctx) === 'stocked' || canReorder
}

/**
 * The `quote_items.fulfilment_route` value for a line's fulfilment claim.
 *
 * The claim and the route are the same fact under two names: this repo's cart
 * and pricing code has said 'stocked' / 'made_to_order' since long before the
 * column existed. Converting HERE, at the RPC boundary, keeps one name in the
 * cart and one in the database without a second field to drift.
 *
 * null when the line made no claim at all (legacy carts), which the RPC answers
 * with the item's own mode — the same conservative treatment
 * partitionCheckoutLines gives an absent fulfilment_type.
 */
export function routeForFulfilmentType(
  t: 'stocked' | 'made_to_order' | null | undefined,
): 'stock_draw' | 'purchase_order' | null {
  if (t === 'stocked') return 'stock_draw'
  if (t === 'made_to_order') return 'purchase_order'
  return null
}
