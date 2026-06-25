import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/checkout/server', () => ({
  requireB2BCustomerApi: vi.fn(),
}))

import { POST } from '../route'
import { requireB2BCustomerApi } from '@/lib/checkout/server'

const ORG = 'org-1'
const OTHER_ORG = 'org-2'
const QUOTE = 'quote-1'

type AnyRow = Record<string, unknown>

/** Minimal chainable Supabase stub: per-table select responses + rpc fn. */
function makeAdmin(opts: {
  selects: Record<string, { data: unknown; error: { message: string } | null }>
  rpc?: (name: string, args: AnyRow) => { data: unknown; error: null }
}) {
  function builder(table: string) {
    const resp = opts.selects[table] ?? { data: [], error: null }
    const b: AnyRow = {
      select: () => b,
      eq: () => b,
      in: () => b,
      maybeSingle: async () => resp,
      then: (res: (v: unknown) => unknown) => Promise.resolve(resp).then(res),
    }
    return b
  }
  return {
    from: vi.fn((t: string) => builder(t)),
    rpc: vi.fn(async (name: string, args: AnyRow) =>
      opts.rpc ? opts.rpc(name, args) : { data: 0, error: null },
    ),
  } as unknown as Parameters<typeof POST> // structural only
}

function req(body: unknown): Request {
  return new Request('http://t/api/reorder/rebuild', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

beforeEach(() => vi.clearAllMocks())

describe('POST /api/reorder/rebuild', () => {
  it('404s when the quote belongs to another org', async () => {
    const admin = makeAdmin({
      selects: { quotes: { data: { id: QUOTE, organization_id: OTHER_ORG }, error: null } },
    })
    vi.mocked(requireB2BCustomerApi).mockResolvedValue({
      admin,
      context: { organizationId: ORG },
    } as never)

    const res = await POST(req({ quoteId: QUOTE }))
    expect(res.status).toBe(404)
  })

  it('rebuilds + freshly prices the lines for an in-org quote', async () => {
    const admin = makeAdmin({
      selects: {
        quotes: { data: { id: QUOTE, organization_id: ORG }, error: null },
        quote_items: {
          data: [
            {
              product_id: 'p1',
              variant_id: 'v1',
              product_name: 'Basic Tee',
              quantity: 30,
              decorations: [],
              ship_to_store_id: null,
              catalogue_item_id: null,
              catalogue_variant_label: null,
              qty_from_stock: 0,
              qty_to_make: 30,
              product_variants: { product_color_swatches: { label: 'Bone' }, sizes: { label: 'M' } },
            },
          ],
          error: null,
        },
        products: { data: [{ id: 'p1', image_url: 'https://img/p1.png' }], error: null },
      },
      rpc: (name, args) => {
        expect(name).toBe('effective_unit_price')
        expect(args.p_qty).toBe(30)
        return { data: 12.54, error: null }
      },
    })
    vi.mocked(requireB2BCustomerApi).mockResolvedValue({
      admin,
      context: { organizationId: ORG },
    } as never)

    const res = await POST(req({ quoteId: QUOTE }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.lines).toHaveLength(1)
    expect(json.lines[0]).toMatchObject({
      productId: 'p1',
      variantLabel: 'Bone / M',
      qty: 30,
      unitPrice: 12.54,
      imageUrl: 'https://img/p1.png',
      fulfilmentType: 'made_to_order',
    })
    expect(json.degradedCount).toBe(0)
  })
})
