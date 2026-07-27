import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Decoration price overlay for the catalogue grid.
 *
 * Two sources, keyed on each catalogue item's price_mode:
 *   * manual_final → the ONE combined per-band figure
 *     (catalogue_item_decoration_price RPC, no tier multiplier) — the same
 *     source the PDP/cart use for manual items.
 *   * computed → sum of default per-placement decorations
 *     (effective_decoration_unit_price RPC × tier) — the rate-sheet path.
 *
 * Extracted from the catalogue page so the pricing is unit-testable and the
 * RPC fan-out can be optimised behind a stable, characterised interface.
 */

export interface CatalogueDecorationRow {
  catalogue_item_id: string
  org_decoration_id: string | null
  org_decorations:
    | { unit_price: number | string | null }
    | { unit_price: number | string | null }[]
    | null
}

export interface CatalogueDecorationPriceInput {
  /** Default per-placement decoration rows for the scoped catalogue items. */
  decorationRows: CatalogueDecorationRow[]
  /** Catalogue item ids whose price_mode is manual_final (already scoped). */
  manualScopedItemIds: string[]
  /** price_mode per catalogue item id — computed rows on a manual item are skipped. */
  priceModeByItemId: Map<string, 'computed' | 'manual_final' | null>
  /** Cheapest-volume quantity (low end of the card price range). */
  floorQty: number
  /** Entry quantity (high end of the card price range). */
  entryQty: number
  /** Tier multiplier applied to computed decorations (never to manual). */
  tierMultiplier: number
}

export interface CatalogueDecorationPrices {
  decoLowByItem: Map<string, number>
  decoHighByItem: Map<string, number>
}

export async function resolveCatalogueDecorationPrices(
  admin: SupabaseClient,
  input: CatalogueDecorationPriceInput,
): Promise<CatalogueDecorationPrices> {
  const {
    decorationRows,
    manualScopedItemIds,
    priceModeByItemId,
    floorQty,
    entryQty,
    tierMultiplier,
  } = input

  const decoLowByItem = new Map<string, number>()
  const decoHighByItem = new Map<string, number>()

  // Computed items only. Manual items are summed from their combined figure
  // below, so skip their per-placement rows here (otherwise the card would bill
  // the rate sheet, not the typed combined). Manual items never overlap with
  // computed rows, so the two writes below can't collide.
  const computedRows = decorationRows.filter(
    (r) => r.org_decoration_id && priceModeByItemId.get(r.catalogue_item_id) !== 'manual_final',
  )

  // The RPC price for effective_decoration_unit_price is a pure function of
  // (org_decoration_id, qty), and the fallback is the decoration's own
  // unit_price — identical for every row sharing that id. So resolve each
  // unique decoration ONCE per band instead of once per placement row, then sum
  // per row below (preserving the per-row / duplicate-row summation semantics).
  const fallbackById = new Map<string, number | null>()
  for (const r of computedRows) {
    const id = r.org_decoration_id as string
    if (fallbackById.has(id)) continue
    const orgDec = Array.isArray(r.org_decorations) ? r.org_decorations[0] : r.org_decorations
    fallbackById.set(id, orgDec?.unit_price != null ? Number(orgDec.unit_price) : null)
  }

  const resolveComputed = async (
    orgDecorationId: string,
    qty: number,
    fallback: number | null,
  ): Promise<number> => {
    const { data, error } = await admin.rpc('effective_decoration_unit_price', {
      p_org_decoration_id: orgDecorationId,
      p_qty: qty,
    })
    const base = !error && data != null ? Number(data) : fallback
    if (base == null || !Number.isFinite(base) || base <= 0) return 0
    return Number((base * tierMultiplier).toFixed(2))
  }

  const resolveManual = async (itemId: string, qty: number): Promise<number> => {
    const { data, error } = await admin.rpc('catalogue_item_decoration_price', {
      p_catalogue_item_id: itemId,
      p_qty: qty,
    })
    const v = !error && data != null ? Number(data) : 0
    return Number.isFinite(v) && v > 0 ? v : 0
  }

  const computedPriceById = new Map<string, { low: number; high: number }>()
  const manualPriceById = new Map<string, { low: number; high: number }>()

  // One concurrent wave: unique computed decorations + manual items together.
  await Promise.all([
    ...Array.from(fallbackById.entries()).map(async ([id, fallback]) => {
      const [low, high] = await Promise.all([
        resolveComputed(id, floorQty, fallback),
        resolveComputed(id, entryQty, fallback),
      ])
      computedPriceById.set(id, { low, high })
    }),
    ...manualScopedItemIds.map(async (itemId) => {
      const [low, high] = await Promise.all([
        resolveManual(itemId, floorQty),
        resolveManual(itemId, entryQty),
      ])
      manualPriceById.set(itemId, { low, high })
    }),
  ])

  // Computed: sum per placement row (duplicate rows add twice, as before).
  for (const r of computedRows) {
    const price = computedPriceById.get(r.org_decoration_id as string)
    if (!price) continue
    if (price.low > 0)
      decoLowByItem.set(r.catalogue_item_id, (decoLowByItem.get(r.catalogue_item_id) ?? 0) + price.low)
    if (price.high > 0)
      decoHighByItem.set(r.catalogue_item_id, (decoHighByItem.get(r.catalogue_item_id) ?? 0) + price.high)
  }

  // Manual: one figure per band, set (not summed), no tier.
  for (const [itemId, price] of manualPriceById) {
    if (price.low > 0) decoLowByItem.set(itemId, price.low)
    if (price.high > 0) decoHighByItem.set(itemId, price.high)
  }

  return { decoLowByItem, decoHighByItem }
}
