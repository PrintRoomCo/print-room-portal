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

function makeAdmin(rows: Row[]): SupabaseClient {
  const b: Record<string, unknown> = {
    select: () => b,
    eq: () => b,
    order: () => b,
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(resolve, reject),
  }
  return {
    from: () => b,
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
