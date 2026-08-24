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
 *
 * Round-trips: each unique (id, band) price is fetched via ONE batched
 * set-returning RPC per source (effective_decoration_unit_prices_bulk /
 * catalogue_item_decoration_prices_bulk — see db/perf-debt/D1_*). When those
 * functions are absent (pre-migration) or error, we transparently fall back to
 * the per-(id, band) scalar RPCs — byte-identical prices either way; the batch
 * only collapses N network round-trips into one.
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
  /** Exact authored currency for the SP3 country-partition path. */
  targetCurrency?: string
  /** False preserves the byte-identical SP2 bulk/scalar RPC path. */
  countryPartitionEnabled?: boolean
}

export interface CatalogueDecorationPrices {
  decoLowByItem: Map<string, number>
  decoHighByItem: Map<string, number>
}

const key = (id: string, qty: number) => `${id}|${qty}`

/**
 * Raw effective_decoration_unit_price for every (org_decoration_id, qty) pair.
 * Value is Number(scalar) or null (not-found / unpriced / transport error) —
 * the caller maps null to the decoration's static fallback, exactly as the
 * per-call path did. One batched RPC; falls back to per-pair scalar calls.
 */
async function resolveEffectiveRaw(
  admin: SupabaseClient,
  ids: string[],
  qtys: number[],
  targetCurrency?: string,
  countryPartitionEnabled = false,
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>()
  if (ids.length === 0) return out
  const items = ids.flatMap((id) => qtys.map((qty) => ({ org_decoration_id: id, qty })))

  if (countryPartitionEnabled) {
    await Promise.all(
      items.map(async ({ org_decoration_id, qty }) => {
        const { data, error } = await admin.rpc('effective_decoration_unit_price_for_currency', {
          p_org_decoration_id: org_decoration_id,
          p_qty: qty,
          p_currency: targetCurrency,
        })
        out.set(
          key(org_decoration_id, qty),
          !error && data != null && Number.isFinite(Number(data)) ? Number(data) : null,
        )
      }),
    )
    return out
  }

  const { data, error } = await admin.rpc('effective_decoration_unit_prices_bulk', {
    p_items: items,
  })
  if (!error && Array.isArray(data)) {
    for (const row of data as Array<{
      org_decoration_id: string
      qty: number
      unit_price: number | string | null
    }>) {
      out.set(key(row.org_decoration_id, row.qty), row.unit_price != null ? Number(row.unit_price) : null)
    }
    // Defensive: a pair with no returned row resolves to null (→ fallback).
    for (const id of ids) for (const qty of qtys) if (!out.has(key(id, qty))) out.set(key(id, qty), null)
    return out
  }

  // Batched RPC unavailable (pre-migration) or errored → per-pair scalar path.
  await Promise.all(
    items.map(async ({ org_decoration_id, qty }) => {
      const { data: d, error: e } = await admin.rpc('effective_decoration_unit_price', {
        p_org_decoration_id: org_decoration_id,
        p_qty: qty,
      })
      out.set(key(org_decoration_id, qty), !e && d != null ? Number(d) : null)
    }),
  )
  return out
}

/**
 * Cleaned catalogue_item_decoration_price for every (catalogue_item_id, qty)
 * pair: a usable positive figure, else 0 (no static fallback — mirrors the old
 * resolveManual `>0` guard). One batched RPC; falls back to per-pair scalar.
 */
async function resolveManualRaw(
  admin: SupabaseClient,
  itemIds: string[],
  qtys: number[],
  targetCurrency?: string,
  countryPartitionEnabled = false,
): Promise<Map<string, number | null>> {
  const clean = (raw: number | string | null | undefined): number | null => {
    if (countryPartitionEnabled && raw == null) return null
    const v = raw != null ? Number(raw) : 0
    if (countryPartitionEnabled) return Number.isFinite(v) && v >= 0 ? v : null
    return Number.isFinite(v) && v > 0 ? v : 0
  }
  const out = new Map<string, number | null>()
  if (itemIds.length === 0) return out
  const items = itemIds.flatMap((id) => qtys.map((qty) => ({ catalogue_item_id: id, qty })))

  if (countryPartitionEnabled) {
    await Promise.all(
      items.map(async ({ catalogue_item_id, qty }) => {
        const { data, error } = await admin.rpc('catalogue_item_decoration_price_for_currency', {
          p_catalogue_item_id: catalogue_item_id,
          p_qty: qty,
          p_currency: targetCurrency,
        })
        out.set(key(catalogue_item_id, qty), clean(!error ? data : null))
      }),
    )
    return out
  }

  const { data, error } = await admin.rpc('catalogue_item_decoration_prices_bulk', {
    p_items: items,
  })
  if (!error && Array.isArray(data)) {
    for (const row of data as Array<{
      catalogue_item_id: string
      qty: number
      unit_price: number | string | null
    }>) {
      out.set(key(row.catalogue_item_id, row.qty), clean(row.unit_price))
    }
    for (const id of itemIds) for (const qty of qtys) if (!out.has(key(id, qty))) out.set(key(id, qty), 0)
    return out
  }

  await Promise.all(
    items.map(async ({ catalogue_item_id, qty }) => {
      const { data: d, error: e } = await admin.rpc('catalogue_item_decoration_price', {
        p_catalogue_item_id: catalogue_item_id,
        p_qty: qty,
      })
      out.set(key(catalogue_item_id, qty), clean(!e ? d : null))
    }),
  )
  return out
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
    targetCurrency,
    countryPartitionEnabled = false,
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

  // Two bands (dedup when the low/high quantities coincide).
  const bands = floorQty === entryQty ? [floorQty] : [floorQty, entryQty]

  // One batched round-trip per source, concurrently.
  const [effectiveByKey, manualByKey] = await Promise.all([
    resolveEffectiveRaw(
      admin,
      Array.from(fallbackById.keys()),
      bands,
      targetCurrency,
      countryPartitionEnabled,
    ),
    resolveManualRaw(
      admin,
      manualScopedItemIds,
      bands,
      targetCurrency,
      countryPartitionEnabled,
    ),
  ])

  // Computed: base = scalar price, else the decoration's static fallback; then
  // guard (>0, finite) and apply the tier multiplier. Identical to the old
  // resolveComputed, just reading the pre-fetched value instead of awaiting.
  const computeBand = (id: string, qty: number): number => {
    const raw = effectiveByKey.get(key(id, qty)) ?? null
    const base = raw != null ? raw : countryPartitionEnabled ? null : fallbackById.get(id) ?? null
    if (base == null || !Number.isFinite(base) || base < 0) return 0
    return Number((base * tierMultiplier).toFixed(2))
  }
  const computedPriceById = new Map<string, { low: number; high: number }>()
  for (const id of fallbackById.keys()) {
    computedPriceById.set(id, { low: computeBand(id, floorQty), high: computeBand(id, entryQty) })
  }

  const manualPriceById = new Map<string, { low: number | null; high: number | null }>()
  for (const itemId of manualScopedItemIds) {
    manualPriceById.set(itemId, {
      low: manualByKey.get(key(itemId, floorQty)) ?? null,
      high: manualByKey.get(key(itemId, entryQty)) ?? null,
    })
  }

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
    if (price.low != null && (countryPartitionEnabled || price.low > 0)) {
      decoLowByItem.set(itemId, price.low)
    }
    if (price.high != null && (countryPartitionEnabled || price.high > 0)) {
      decoHighByItem.set(itemId, price.high)
    }
  }

  return { decoLowByItem, decoHighByItem }
}
