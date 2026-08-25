import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadCatalogueItemDecorations } from './decorations'

/**
 * Pooled decoration pricing (2026-08-13 spec §5) — eligibility is decided
 * server-side, in the loader, from the decoration's shape rather than its price.
 * The $0 "Custom decoration" placeholder is attached catalogue-wide (MTF x28,
 * Anytime Fitness x15, Trades Services x12, Reburger x7), so pooling naively by
 * org_decoration_id would pool whole catalogues into one band.
 */

type Row = Record<string, unknown>

function makeAdmin(rows: Row[], ladderRows: Row[] = []): SupabaseClient {
  function builder(table: string) {
    const data = table === 'org_decoration_pricing_tiers' ? ladderRows : rows
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      in: () => b,
      order: () => b,
      maybeSingle: () =>
        Promise.resolve({
          data: table === 'b2b_catalogue_items' ? { source_product_id: null } : data[0] ?? null,
          error: null,
        }),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve({ data, error: null }).then(resolve, reject),
    }
    return b
  }
  return {
    from: (table: string) => builder(table),
    rpc: async () => ({ data: [], error: null }),
    storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
  } as unknown as SupabaseClient
}

function link(overrides: {
  id: string
  method: string
  artwork: Row | null
}): Row {
  return {
    id: overrides.id,
    is_default: false,
    sort_order: 0,
    unit_price_override: null,
    snapshot_url: null,
    snapshot_color_swatch_id: null,
    print_area_id: null,
    placement_x: null,
    placement_y: null,
    placement_w: null,
    placement_h: null,
    placement_rotation_deg: null,
    print_area: null,
    decoration: {
      id: `dec-${overrides.id}`,
      organization_id: 'org-1',
      name: 'Decoration',
      decoration_method: overrides.method,
      unit_price: 0,
      is_active: true,
      width_mm: null,
      height_mm: null,
      colour_count: null,
      stitch_count: null,
      artwork: overrides.artwork,
      location: null,
    },
  }
}

const ARTWORK = { id: 'art-1', name: 'logo.png', public_url: '/logo.png', variants: [] }

describe('loadCatalogueItemDecorations — poolable eligibility', () => {
  it('marks a real library decoration (artwork + real method) poolable', async () => {
    const admin = makeAdmin([link({ id: 'l1', method: 'embroidery', artwork: ARTWORK })])
    const [dec] = await loadCatalogueItemDecorations(admin, 'item-1')
    expect(dec.poolable).toBe(true)
  })

  it("never pools the method='custom' placeholder, even when it carries artwork", async () => {
    const admin = makeAdmin([link({ id: 'l2', method: 'custom', artwork: ARTWORK })])
    const [dec] = await loadCatalogueItemDecorations(admin, 'item-1')
    expect(dec.poolable).toBe(false)
  })

  it('never pools a decoration with no artwork row (details-only inclusion)', async () => {
    const admin = makeAdmin([link({ id: 'l3', method: 'screenprint', artwork: null })])
    const [dec] = await loadCatalogueItemDecorations(admin, 'item-1')
    expect(dec.poolable).toBe(false)
  })

  it('decides on shape, not price — a $0 real decoration still pools', async () => {
    // unit_price 0 on every fixture above; the placeholder is excluded by its
    // 'custom' method, NOT by being free, so a genuinely free real decoration
    // (all-in / prepaid catalogues) keeps contributing quantity.
    const admin = makeAdmin([
      link({ id: 'l4', method: 'screenprint', artwork: ARTWORK }),
      link({ id: 'l5', method: 'custom', artwork: null }),
    ])
    const out = await loadCatalogueItemDecorations(admin, 'item-1')
    expect(out.map((d) => d.poolable)).toEqual([true, false])
  })

  it('covers every method the DB allows', async () => {
    const admin = makeAdmin(
      ['screenprint', 'embroidery', 'heatpress', 'supacolour', 'dtf', 'custom'].map((m) =>
        link({ id: m, method: m, artwork: ARTWORK }),
      ),
    )
    const out = await loadCatalogueItemDecorations(admin, 'item-1')
    expect(out.map((d) => [d.method, d.poolable])).toEqual([
      ['screenprint', true],
      ['embroidery', true],
      ['heatpress', true],
      ['supacolour', true],
      ['dtf', true],
      ['custom', false],
    ])
  })
})

describe('loadCatalogueItemDecorations — ladder-aware first paint', () => {
  it('leaves the static price and a null ladder when none is authored', () => {
    // Covered by the eligibility cases above, but stated explicitly: no ladder
    // rows => today's engine/flat behaviour, unchanged.
    return loadCatalogueItemDecorations(
      makeAdmin([link({ id: 'l1', method: 'embroidery', artwork: ARTWORK })]),
      'item-1',
    ).then(([dec]) => {
      expect(dec.ladder).toBeNull()
      expect(dec.unitPrice).toBe(0)
    })
  })

  it('seeds first paint from the ladder, beating the flat price AND the link override', () => {
    // effective_decoration_unit_price consults the ladder before anything else,
    // so the PDP's first paint — the one price source that bypasses the RPC —
    // has to agree or the customer sees a number checkout will not charge.
    const row = link({ id: 'l1', method: 'embroidery', artwork: ARTWORK })
    ;(row.decoration as Row).unit_price = 12
    row.unit_price_override = 99
    const admin = makeAdmin(
      [row],
      [
        { org_decoration_id: 'dec-l1', min_quantity: 1, max_quantity: 23, unit_price: 9 },
        { org_decoration_id: 'dec-l1', min_quantity: 24, max_quantity: null, unit_price: 6 },
      ],
    )
    return loadCatalogueItemDecorations(admin, 'item-1').then(([dec]) => {
      expect(dec.unitPrice).toBe(9)
      expect(dec.ladder).toEqual([
        { minQty: 1, maxQty: 23, unitPrice: 9 },
        { minQty: 24, maxQty: null, unitPrice: 6 },
      ])
    })
  })

  it('clamps the first-paint seed up to the lowest band when the ladder starts above 1', () => {
    const admin = makeAdmin(
      [link({ id: 'l1', method: 'screenprint', artwork: ARTWORK })],
      [{ org_decoration_id: 'dec-l1', min_quantity: 50, max_quantity: null, unit_price: 3 }],
    )
    return loadCatalogueItemDecorations(admin, 'item-1').then(([dec]) => {
      expect(dec.unitPrice).toBe(3)
      // Normalised so the cart's exact-band matching reproduces the DB clamp.
      expect(dec.ladder).toEqual([{ minQty: 1, maxQty: null, unitPrice: 3 }])
    })
  })
})
