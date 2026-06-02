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
