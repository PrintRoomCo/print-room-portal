import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  resolveCatalogueDecorationPrices,
  type CatalogueDecorationRow,
} from './catalogue-decoration-prices'

// Deterministic price(id, qty) oracle standing in for the Postgres RPCs. The
// characterization test asserts the resolved decoLow/decoHigh maps, so it is
// agnostic to HOW the prices are fetched — the batched bulk RPCs and the
// per-pair scalar fallback must both produce byte-identical output here.
const EFFECTIVE: Record<string, number | null> = {
  'decoX|1000': 2,
  'decoX|24': 4,
  'decoY|1000': 1,
  'decoY|24': 3,
  // decoW resolves to 0 -> must never be written to the maps.
  'decoW|1000': 0,
  'decoW|24': 0,
  // decoZ is absent -> unit_price null -> the org_decorations.unit_price
  // fallback path is exercised (the batched RPC returns a null row; the scalar
  // fallback mock returns a transport error — both map to the same fallback).
}
const COMBINED: Record<string, number> = {
  'itemM|1000': 20,
  'itemM|24': 25,
}

// mode 'bulk'   -> the batched *_bulk RPCs answer; scalars must NOT be called.
// mode 'scalar' -> the batched RPCs error (pre-migration), forcing the per-pair
//                  scalar fallback (decoZ errors there, as in production).
function makeAdmin(mode: 'bulk' | 'scalar' = 'bulk') {
  const rpc = vi.fn(async (fn: string, params: Record<string, unknown>) => {
    if (fn === 'effective_decoration_unit_prices_bulk') {
      if (mode === 'scalar') return { data: null, error: { message: 'function does not exist' } }
      const items = params.p_items as Array<{ org_decoration_id: string; qty: number }>
      return {
        data: items.map((i) => ({
          org_decoration_id: i.org_decoration_id,
          qty: i.qty,
          unit_price: EFFECTIVE[`${i.org_decoration_id}|${i.qty}`] ?? null,
        })),
        error: null,
      }
    }
    if (fn === 'catalogue_item_decoration_prices_bulk') {
      if (mode === 'scalar') return { data: null, error: { message: 'function does not exist' } }
      const items = params.p_items as Array<{ catalogue_item_id: string; qty: number }>
      return {
        data: items.map((i) => ({
          catalogue_item_id: i.catalogue_item_id,
          qty: i.qty,
          unit_price: COMBINED[`${i.catalogue_item_id}|${i.qty}`] ?? null,
        })),
        error: null,
      }
    }
    // Scalar fallbacks.
    if (fn === 'effective_decoration_unit_price') {
      const id = params.p_org_decoration_id as string
      // decoZ simulates an RPC failure so the org_decorations.unit_price
      // fallback path is exercised on the scalar route.
      if (id === 'decoZ') return { data: null, error: { message: 'boom' } }
      return { data: EFFECTIVE[`${id}|${params.p_qty}`] ?? null, error: null }
    }
    if (fn === 'catalogue_item_decoration_price') {
      return { data: COMBINED[`${params.p_catalogue_item_id}|${params.p_qty}`] ?? null, error: null }
    }
    return { data: null, error: null }
  })
  return { rpc } as unknown as SupabaseClient
}

const decorationRows: CatalogueDecorationRow[] = [
  // Computed item with two placements -> summed.
  { catalogue_item_id: 'itemA', org_decoration_id: 'decoX', org_decorations: { unit_price: 99 } },
  { catalogue_item_id: 'itemA', org_decoration_id: 'decoY', org_decorations: { unit_price: 99 } },
  // Same decoration appears twice on one item -> added twice.
  { catalogue_item_id: 'itemDup', org_decoration_id: 'decoX', org_decorations: { unit_price: 99 } },
  { catalogue_item_id: 'itemDup', org_decoration_id: 'decoX', org_decorations: { unit_price: 99 } },
  // RPC yields no usable price -> fall back to org_decorations.unit_price (10), tier-multiplied.
  { catalogue_item_id: 'itemFb', org_decoration_id: 'decoZ', org_decorations: { unit_price: 10 } },
  // Resolves to 0 -> not written.
  { catalogue_item_id: 'itemW', org_decoration_id: 'decoW', org_decorations: { unit_price: null } },
  // Null decoration id -> skipped.
  { catalogue_item_id: 'itemA', org_decoration_id: null, org_decorations: null },
  // Computed row on a manual item -> skipped here (its price comes from the manual RPC).
  { catalogue_item_id: 'itemM', org_decoration_id: 'decoX', org_decorations: { unit_price: 99 } },
]

const input = {
  decorationRows,
  manualScopedItemIds: ['itemM'],
  priceModeByItemId: new Map<string, 'computed' | 'manual_final' | null>([
    ['itemA', 'computed'],
    ['itemDup', 'computed'],
    ['itemFb', 'computed'],
    ['itemW', 'computed'],
    ['itemM', 'manual_final'],
  ]),
  floorQty: 1000,
  entryQty: 24,
  tierMultiplier: 1.5,
}

// The expected overlay — identical regardless of batched vs scalar routing.
function expectOverlay(decoLowByItem: Map<string, number>, decoHighByItem: Map<string, number>) {
  // itemA: (decoX@1000=2 + decoY@1000=1)×1.5 = 4.5 ; (decoX@24=4 + decoY@24=3)×1.5 = 10.5
  expect(decoLowByItem.get('itemA')).toBe(4.5)
  expect(decoHighByItem.get('itemA')).toBe(10.5)
  // itemDup: decoX twice -> (2×1.5)×2 = 6 ; (4×1.5)×2 = 12
  expect(decoLowByItem.get('itemDup')).toBe(6)
  expect(decoHighByItem.get('itemDup')).toBe(12)
  // itemFb: no usable RPC price -> fallback 10×1.5 = 15 at both bands (fallback ignores qty)
  expect(decoLowByItem.get('itemFb')).toBe(15)
  expect(decoHighByItem.get('itemFb')).toBe(15)
  // itemM: manual figure, no tier
  expect(decoLowByItem.get('itemM')).toBe(20)
  expect(decoHighByItem.get('itemM')).toBe(25)
  // itemW resolved to 0 -> never written
  expect(decoLowByItem.has('itemW')).toBe(false)
  expect(decoHighByItem.has('itemW')).toBe(false)
}

describe('resolveCatalogueDecorationPrices (characterization)', () => {
  it('sums computed placements × tier, honours fallback, and sets manual figures without tier', async () => {
    const admin = makeAdmin('bulk')
    const { decoLowByItem, decoHighByItem } = await resolveCatalogueDecorationPrices(admin, input)
    expectOverlay(decoLowByItem, decoHighByItem)
  })

  it('produces byte-identical output via the scalar fallback when the batched RPC is unavailable', async () => {
    const admin = makeAdmin('scalar')
    const { decoLowByItem, decoHighByItem } = await resolveCatalogueDecorationPrices(admin, input)
    expectOverlay(decoLowByItem, decoHighByItem)
  })

  it('resolves the whole overlay in ONE batched RPC per source (no per-id fan-out)', async () => {
    const admin = makeAdmin('bulk')
    await resolveCatalogueDecorationPrices(admin, input)
    const rpc = admin.rpc as unknown as ReturnType<typeof vi.fn>

    // Exactly one batched call per source; the per-id scalar RPCs are not touched.
    const effectiveBulk = rpc.mock.calls.filter(([fn]) => fn === 'effective_decoration_unit_prices_bulk')
    const manualBulk = rpc.mock.calls.filter(([fn]) => fn === 'catalogue_item_decoration_prices_bulk')
    expect(effectiveBulk).toHaveLength(1)
    expect(manualBulk).toHaveLength(1)
    expect(rpc.mock.calls.some(([fn]) => fn === 'effective_decoration_unit_price')).toBe(false)
    expect(rpc.mock.calls.some(([fn]) => fn === 'catalogue_item_decoration_price')).toBe(false)

    // decoX appears in 3 computed rows (itemA once, itemDup twice). Naively that
    // is 6 scalar calls (3 rows × 2 bands); batched it is 2 array entries
    // (1 id × 2 bands) inside the single bulk call.
    const items = effectiveBulk[0][1].p_items as Array<{ org_decoration_id: string; qty: number }>
    const decoXEntries = items.filter((i) => i.org_decoration_id === 'decoX')
    expect(decoXEntries).toHaveLength(2)
    expect(decoXEntries.map((i) => i.qty).sort((a, b) => a - b)).toEqual([24, 1000])
  })
})
