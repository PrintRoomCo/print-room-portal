import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  resolveCatalogueItemForPdp,
  resolvePdpImageContext,
} from './resolve-catalogue-item'

type Row = Record<string, unknown>

// Filter-aware Supabase stub. Unlike the table-keyed stub in member-access.test.ts,
// this one HONOURS `.eq()` / `.in()` on columns that exist on the canned row, so we
// can prove the preview lookup misses (id filter) while the granted lookup hits —
// both querying the same `b2b_catalogue_items` table. Filters on columns absent
// from the canned row (e.g. the embedded `b2b_catalogues.*` or `is_active`) are
// treated as no-ops, keeping fixtures minimal.
function makeStub(byTable: Record<string, Row[]>): SupabaseClient {
  function builder(table: string) {
    const eqs: Array<[string, unknown]> = []
    const ins: Array<[string, unknown[]]> = []
    const rows = () =>
      (byTable[table] ?? []).filter(
        (row) =>
          eqs.every(([c, v]) => !(c in row) || row[c] === v) &&
          ins.every(([c, vs]) => !(c in row) || vs.includes(row[c])),
      )
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (c: string, v: unknown) => {
        eqs.push([c, v])
        return b
      },
      in: (c: string, vs: unknown[]) => {
        ins.push([c, vs])
        return b
      },
      order: () => b,
      limit: () => b,
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve({ data: rows(), error: null }).then(resolve, reject),
    }
    return b
  }
  return { from: (table: string) => builder(table) } as unknown as SupabaseClient
}

const HOOD_PRODUCT = '232b839b-eb86-4c56-8705-da4656c171c2'
const TEE_PRODUCT = 'ac0c6687-87ac-445e-bb89-35a838485bca'
const TEE_ITEM = '0e14faed-0d42-4bfb-b1cf-76926c66a403'
const HOOD_ITEM = '6bf8923b-c38b-428e-b070-916bc35cd70f'
const ORG = '6c65151e-fbd8-49f3-9b66-5e7dd0e13436'

describe('resolveCatalogueItemForPdp', () => {
  it('REGRESSION: a stale preview item for ANOTHER product falls back to granted access (hood 404)', async () => {
    // Preview cookie pins the tee item, but staff navigate to the hood product.
    // Old loader: preview query (id=tee AND source_product_id=hood) → null → 404.
    // Fixed: fall back to the member's normal granted lookup for the hood.
    const admin = makeStub({
      b2b_catalogue_items: [
        { id: HOOD_ITEM, source_product_id: HOOD_PRODUCT, name: 'Hood', price_mode: 'manual_final' },
      ],
    })
    const result = await resolveCatalogueItemForPdp(
      admin,
      {
        productId: HOOD_PRODUCT,
        organizationId: ORG,
        membershipId: 'm1',
        isPreview: true,
        previewItemId: TEE_ITEM,
      },
      { getGrantedItemIds: async () => [HOOD_ITEM] },
    )
    expect(result?.id).toBe(HOOD_ITEM)
  })

  it('exact preview match force-shows the in-edit item without needing a grant', async () => {
    const admin = makeStub({
      b2b_catalogue_items: [
        {
          id: TEE_ITEM,
          source_product_id: TEE_PRODUCT,
          name: 'Tee (draft)',
          price_mode: 'computed',
        },
      ],
    })
    const result = await resolveCatalogueItemForPdp(
      admin,
      {
        productId: TEE_PRODUCT,
        organizationId: ORG,
        membershipId: 'm1',
        isPreview: true,
        previewItemId: TEE_ITEM,
      },
      // No grants — proves the exact preview path does not depend on granted access.
      { getGrantedItemIds: async () => [] },
    )
    expect(result?.id).toBe(TEE_ITEM)
    expect(result?.price_mode).toBe('computed')
  })

  it('non-preview uses the granted lookup', async () => {
    const admin = makeStub({
      b2b_catalogue_items: [{ id: HOOD_ITEM, source_product_id: HOOD_PRODUCT, name: 'Hood' }],
    })
    const result = await resolveCatalogueItemForPdp(
      admin,
      {
        productId: HOOD_PRODUCT,
        organizationId: ORG,
        membershipId: 'm1',
        isPreview: false,
        previewItemId: null,
      },
      { getGrantedItemIds: async () => [HOOD_ITEM] },
    )
    expect(result?.id).toBe(HOOD_ITEM)
  })

  it('non-preview with no grants → null (404)', async () => {
    const admin = makeStub({ b2b_catalogue_items: [] })
    const result = await resolveCatalogueItemForPdp(
      admin,
      {
        productId: HOOD_PRODUCT,
        organizationId: ORG,
        membershipId: 'm1',
        isPreview: false,
        previewItemId: null,
      },
      { getGrantedItemIds: async () => [] },
    )
    expect(result).toBeNull()
  })

  it('preview miss AND no grant for the product → null (unauthorised stays 404)', async () => {
    const admin = makeStub({
      b2b_catalogue_items: [
        { id: HOOD_ITEM, source_product_id: HOOD_PRODUCT, name: 'Hood' },
      ],
    })
    const result = await resolveCatalogueItemForPdp(
      admin,
      {
        productId: HOOD_PRODUCT,
        organizationId: ORG,
        membershipId: 'm1',
        isPreview: true,
        previewItemId: TEE_ITEM,
      },
      { getGrantedItemIds: async () => [] }, // not granted → no fallback row
    )
    expect(result).toBeNull()
  })

  it('threads the item override so the PDP can override or inherit the master layout', async () => {
    const standardOverrideAdmin = makeStub({
      b2b_catalogue_items: [
        {
          id: HOOD_ITEM,
          source_product_id: HOOD_PRODUCT,
          name: 'Hood',
          image_layout_override: 'standard_views',
        },
      ],
    })
    const inheritedAdmin = makeStub({
      b2b_catalogue_items: [
        {
          id: HOOD_ITEM,
          source_product_id: HOOD_PRODUCT,
          name: 'Hood',
          image_layout_override: null,
        },
      ],
    })
    const params = {
      productId: HOOD_PRODUCT,
      organizationId: ORG,
      membershipId: 'm1',
      isPreview: false,
      previewItemId: null,
    }
    const deps = { getGrantedItemIds: async () => [HOOD_ITEM] }

    const overridden = await resolveCatalogueItemForPdp(
      standardOverrideAdmin,
      params,
      deps,
    )
    const inherited = await resolveCatalogueItemForPdp(
      inheritedAdmin,
      params,
      deps,
    )

    const overriddenContext = resolvePdpImageContext(
        'merchandised_gallery',
        overridden?.image_layout_override,
        [
          {
            product_image_id: 'master-1',
            catalogue_item_image_id: null,
            position: 1,
          },
        ],
      )
    const inheritedContext = resolvePdpImageContext(
        'merchandised_gallery',
        inherited?.image_layout_override,
        [
          {
            product_image_id: null,
            catalogue_item_image_id: 'catalogue-1',
            position: 0,
          },
        ],
      )

    expect(overriddenContext.imageLayout).toBe('standard_views')
    expect(overriddenContext.galleryPosition.get('master:master-1')).toBe(1)
    expect(inheritedContext.imageLayout).toBe('merchandised_gallery')
    expect(
      inheritedContext.galleryPosition.get('catalogue:catalogue-1'),
    ).toBe(0)
  })
})
