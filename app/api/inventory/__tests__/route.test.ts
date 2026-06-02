import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase-server-component', () => ({ getSupabaseServerComponent: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getSupabaseServer: vi.fn() }))

import { GET } from '../route'
import { getSupabaseServerComponent } from '@/lib/supabase-server-component'
import { getSupabaseServer } from '@/lib/supabase'

type AnyRow = Record<string, unknown>

/** Minimal chainable Supabase stub: per-table responses; supports eq/in/single + await. */
function makeAdmin(selects: Record<string, { data: unknown; error: { message: string } | null }>) {
  function builder(table: string) {
    const resp = selects[table] ?? { data: [], error: null }
    const b: AnyRow = {
      select: () => b,
      eq: () => b,
      in: () => b,
      single: async () => resp,
      then: (res: (v: unknown) => unknown) => Promise.resolve(resp).then(res),
    }
    return b
  }
  return { from: vi.fn((t: string) => builder(t)) }
}

function mockAuth(user: { id: string } | null) {
  vi.mocked(getSupabaseServerComponent).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user }, error: null }) },
  } as never)
}

beforeEach(() => vi.clearAllMocks())

describe('GET /api/inventory', () => {
  it('401s when unauthenticated', async () => {
    mockAuth(null)
    vi.mocked(getSupabaseServer).mockReturnValue(makeAdmin({}) as never)
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('joins org stock to variant descriptors, reading colour from `label` (not the non-existent `name`)', async () => {
    mockAuth({ id: 'u-1' })
    vi.mocked(getSupabaseServer).mockReturnValue(
      makeAdmin({
        user_organizations: { data: { organization_id: 'org-1' }, error: null },
        variant_availability: {
          data: [{ variant_id: 'v1', stock_qty: 25, committed_qty: 5, available_qty: 20 }],
          error: null,
        },
        product_variants: {
          data: [
            {
              id: 'v1',
              product_id: 'p1',
              updated_at: '2026-05-29T00:40:08Z',
              // product_color_swatches has `label`/`hex` — NOT `name`. The old route
              // selected `name` and 400'd; this asserts colour resolves from `label`.
              product_color_swatches: { label: 'Bone', hex: '#D1CDCA' },
              sizes: { label: 'XS' },
              products: { name: 'Staple Tee' },
            },
          ],
          error: null,
        },
      }) as never,
    )

    const res = await GET()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.rows).toHaveLength(1)
    expect(json.rows[0]).toMatchObject({
      variant_id: 'v1',
      product_id: 'p1',
      product_name: 'Staple Tee',
      colour_name: 'Bone',
      colour_hex: '#D1CDCA',
      size_label: 'XS',
      available_qty: 20,
      stock_qty: 25,
      committed_qty: 5,
    })
  })

  it('returns an empty list (not an error) when the org has no tracked stock', async () => {
    mockAuth({ id: 'u-1' })
    vi.mocked(getSupabaseServer).mockReturnValue(
      makeAdmin({
        user_organizations: { data: { organization_id: 'org-1' }, error: null },
        variant_availability: { data: [], error: null },
      }) as never,
    )
    const res = await GET()
    expect(res.status).toBe(200)
    expect((await res.json()).rows).toHaveLength(0)
  })
})
