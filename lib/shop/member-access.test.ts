import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getGrantedCatalogueItemIds, getGrantedCatalogueItems } from './member-access'

type Row = Record<string, unknown>
type Resp = { data: Row[] | null; error: null }

// Minimal chainable Supabase stub keyed by table name (mirrors the pattern in
// lib/checkout/__tests__/submit.demo-monday-group.test.ts). Every builder
// method returns `this`; awaiting the builder (or calling .maybeSingle())
// resolves to the canned rows registered for that table. Filter args are
// accepted but ignored on purpose — these tests exercise the function's
// branching logic; Postgres-level filtering is covered by the RLS migration
// verification (Phase 2) and the manual smoke.
function makeStub(byTable: Record<string, Row[]>): SupabaseClient {
  function builder(table: string) {
    const resp: Resp = { data: byTable[table] ?? [], error: null }
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      in: () => b,
      order: () => b,
      limit: () => b,
      maybeSingle: async () => ({ data: (resp.data ?? [])[0] ?? null, error: null }),
      then: (resolve: (v: Resp) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(resp).then(resolve, reject),
    }
    return b
  }
  return { from: (table: string) => builder(table) } as unknown as SupabaseClient
}

describe('getGrantedCatalogueItemIds', () => {
  it('org_admin sees every active item (bypass) — unchanged', async () => {
    const admin = makeStub({
      user_organizations: [{ role: 'org_admin' }],
      b2b_catalogue_items: [{ id: 'i1' }, { id: 'i2' }],
    })
    expect(await getGrantedCatalogueItemIds(admin, 'm1', 'org1')).toEqual(['i1', 'i2'])
  })

  it('non-admin with ZERO catalogue grants sees ALL active items (new default)', async () => {
    const admin = makeStub({
      user_organizations: [{ role: 'staff' }],
      b2b_member_catalogue_grants: [],
      b2b_catalogues: [{ id: 'c1' }],
      b2b_catalogue_items: [
        { id: 'i1', catalogue_id: 'c1' },
        { id: 'i2', catalogue_id: 'c1' },
      ],
      b2b_member_catalogue_item_grants: [],
    })
    const result = await getGrantedCatalogueItemIds(admin, 'm1', 'org1')
    expect(result.slice().sort()).toEqual(['i1', 'i2'])
  })

  it('non-admin with one catalogue grant is scoped to that catalogue', async () => {
    const admin = makeStub({
      user_organizations: [{ role: 'staff' }],
      b2b_member_catalogue_grants: [{ catalogue_id: 'c1' }],
      b2b_catalogue_items: [{ id: 'i1', catalogue_id: 'c1' }],
      b2b_member_catalogue_item_grants: [],
    })
    expect(await getGrantedCatalogueItemIds(admin, 'm1', 'org1')).toEqual(['i1'])
  })

  it('non-admin with a catalogue grant + item grant is item-whitelisted', async () => {
    const admin = makeStub({
      user_organizations: [{ role: 'staff' }],
      b2b_member_catalogue_grants: [{ catalogue_id: 'c1' }],
      b2b_catalogue_items: [
        { id: 'i1', catalogue_id: 'c1' },
        { id: 'i2', catalogue_id: 'c1' },
      ],
      b2b_member_catalogue_item_grants: [{ catalogue_item_id: 'i1' }],
    })
    expect(await getGrantedCatalogueItemIds(admin, 'm1', 'org1')).toEqual(['i1'])
  })

  it('non-admin, zero grants, org has no active catalogues → empty', async () => {
    const admin = makeStub({
      user_organizations: [{ role: 'staff' }],
      b2b_member_catalogue_grants: [],
      b2b_catalogues: [],
    })
    expect(await getGrantedCatalogueItemIds(admin, 'm1', 'org1')).toEqual([])
  })
})

describe('getGrantedCatalogueItems (full rows)', () => {
  it('org_admin: returns the grid columns for every active item', async () => {
    const admin = makeStub({
      user_organizations: [{ role: 'org_admin' }],
      b2b_catalogue_items: [
        {
          id: 'i1',
          catalogue_id: 'c1',
          source_product_id: 'p1',
          fulfilment_type_override: 'stock',
          card_image_id: 'img1',
          price_mode: 'manual_final',
          image_layout_override: 'merchandised_gallery',
        },
        {
          id: 'i2',
          catalogue_id: 'c1',
          source_product_id: 'p2',
          fulfilment_type_override: null,
          card_image_id: null,
          price_mode: 'computed',
          image_layout_override: null,
        },
      ],
    })
    const rows = await getGrantedCatalogueItems(admin, 'm1', 'org1')
    expect(rows).toEqual([
      {
        id: 'i1',
        catalogue_id: 'c1',
        source_product_id: 'p1',
        fulfilment_type_override: 'stock',
        card_image_id: 'img1',
        price_mode: 'manual_final',
        image_layout_override: 'merchandised_gallery',
        name: null,
        sku_override: null,
      },
      {
        id: 'i2',
        catalogue_id: 'c1',
        source_product_id: 'p2',
        fulfilment_type_override: null,
        card_image_id: null,
        price_mode: 'computed',
        image_layout_override: null,
        name: null,
        sku_override: null,
      },
    ])
  })

  it('non-admin item-whitelist: returns full rows only for granted items', async () => {
    const admin = makeStub({
      user_organizations: [{ role: 'staff' }],
      b2b_member_catalogue_grants: [{ catalogue_id: 'c1' }],
      b2b_catalogue_items: [
        { id: 'i1', catalogue_id: 'c1', source_product_id: 'p1', price_mode: 'computed' },
        { id: 'i2', catalogue_id: 'c1', source_product_id: 'p2', price_mode: 'computed' },
      ],
      b2b_member_catalogue_item_grants: [{ catalogue_item_id: 'i1' }],
    })
    const rows = await getGrantedCatalogueItems(admin, 'm1', 'org1')
    expect(rows.map((r) => r.id)).toEqual(['i1'])
    expect(rows[0].source_product_id).toBe('p1')
  })
})
