import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  resolveCatalogueDecorationPrices,
  type CatalogueDecorationRow,
} from './catalogue-decoration-prices'

// Deterministic price(id, qty) oracle standing in for the two Postgres RPCs.
// The characterization test asserts the resolved decoLow/decoHigh maps, so it
// is agnostic to HOW MANY times the RPC is called — an optimization that dedupes
// or batches the calls must still produce byte-identical output here.
function makeAdmin() {
  const effective: Record<string, number | null> = {
    'decoX|1000': 2,
    'decoX|24': 4,
    'decoY|1000': 1,
    'decoY|24': 3,
    // decoW resolves to 0 -> must never be written to the maps.
    'decoW|1000': 0,
    'decoW|24': 0,
  }
  const combined: Record<string, number> = {
    'itemM|1000': 20,
    'itemM|24': 25,
  }
  const rpc = vi.fn(
    async (fn: string, params: { p_org_decoration_id?: string; p_catalogue_item_id?: string; p_qty: number }) => {
      if (fn === 'effective_decoration_unit_price') {
        const id = params.p_org_decoration_id as string
        // decoZ simulates an RPC failure so the org_decorations.unit_price
        // fallback path is exercised.
        if (id === 'decoZ') return { data: null, error: { message: 'boom' } }
        return { data: effective[`${id}|${params.p_qty}`] ?? null, error: null }
      }
      if (fn === 'catalogue_item_decoration_price') {
        return { data: combined[`${params.p_catalogue_item_id}|${params.p_qty}`] ?? null, error: null }
      }
      return { data: null, error: null }
    },
  )
  return { rpc } as unknown as SupabaseClient
}

const decorationRows: CatalogueDecorationRow[] = [
  // Computed item with two placements -> summed.
  { catalogue_item_id: 'itemA', org_decoration_id: 'decoX', org_decorations: { unit_price: 99 } },
  { catalogue_item_id: 'itemA', org_decoration_id: 'decoY', org_decorations: { unit_price: 99 } },
  // Same decoration appears twice on one item -> added twice.
  { catalogue_item_id: 'itemDup', org_decoration_id: 'decoX', org_decorations: { unit_price: 99 } },
  { catalogue_item_id: 'itemDup', org_decoration_id: 'decoX', org_decorations: { unit_price: 99 } },
  // RPC fails -> fall back to org_decorations.unit_price (10), tier-multiplied.
  { catalogue_item_id: 'itemFb', org_decoration_id: 'decoZ', org_decorations: { unit_price: 10 } },
  // Resolves to 0 -> not written.
  { catalogue_item_id: 'itemW', org_decoration_id: 'decoW', org_decorations: { unit_price: null } },
  // Null decoration id -> skipped.
  { catalogue_item_id: 'itemA', org_decoration_id: null, org_decorations: null },
  // Computed row on a manual item -> skipped here (its price comes from the manual RPC).
  { catalogue_item_id: 'itemM', org_decoration_id: 'decoX', org_decorations: { unit_price: 99 } },
]

describe('resolveCatalogueDecorationPrices (characterization)', () => {
  it('sums computed placements × tier, honours fallback, and sets manual figures without tier', async () => {
    const admin = makeAdmin()
    const { decoLowByItem, decoHighByItem } = await resolveCatalogueDecorationPrices(admin, {
      decorationRows,
      manualScopedItemIds: ['itemM'],
      priceModeByItemId: new Map([
        ['itemA', 'computed'],
        ['itemDup', 'computed'],
        ['itemFb', 'computed'],
        ['itemW', 'computed'],
        ['itemM', 'manual_final'],
      ]),
      floorQty: 1000,
      entryQty: 24,
      tierMultiplier: 1.5,
    })

    // itemA: (decoX@1000=2 + decoY@1000=1)×1.5 = 4.5 ; (decoX@24=4 + decoY@24=3)×1.5 = 10.5
    expect(decoLowByItem.get('itemA')).toBe(4.5)
    expect(decoHighByItem.get('itemA')).toBe(10.5)
    // itemDup: decoX twice -> (2×1.5)×2 = 6 ; (4×1.5)×2 = 12
    expect(decoLowByItem.get('itemDup')).toBe(6)
    expect(decoHighByItem.get('itemDup')).toBe(12)
    // itemFb: RPC fails -> fallback 10×1.5 = 15 at both bands (fallback ignores qty)
    expect(decoLowByItem.get('itemFb')).toBe(15)
    expect(decoHighByItem.get('itemFb')).toBe(15)
    // itemM: manual figure, no tier
    expect(decoLowByItem.get('itemM')).toBe(20)
    expect(decoHighByItem.get('itemM')).toBe(25)
    // itemW resolved to 0 -> never written
    expect(decoLowByItem.has('itemW')).toBe(false)
    expect(decoHighByItem.has('itemW')).toBe(false)
  })

  it('resolves each unique decoration once per band instead of once per placement row', async () => {
    const admin = makeAdmin()
    await resolveCatalogueDecorationPrices(admin, {
      decorationRows,
      manualScopedItemIds: ['itemM'],
      priceModeByItemId: new Map([
        ['itemA', 'computed'],
        ['itemDup', 'computed'],
        ['itemFb', 'computed'],
        ['itemW', 'computed'],
        ['itemM', 'manual_final'],
      ]),
      floorQty: 1000,
      entryQty: 24,
      tierMultiplier: 1.5,
    })

    // decoX appears in 3 computed rows (itemA once, itemDup twice). Naively that
    // is 6 RPC calls (3 rows × 2 bands); deduped it is 2 (1 id × 2 bands).
    const rpc = admin.rpc as unknown as ReturnType<typeof vi.fn>
    const decoXCalls = rpc.mock.calls.filter(
      ([fn, params]) =>
        fn === 'effective_decoration_unit_price' && params.p_org_decoration_id === 'decoX',
    )
    expect(decoXCalls).toHaveLength(2)
  })
})
