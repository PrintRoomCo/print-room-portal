import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/lib/checkout/server', () => ({ requireB2BCustomerApi: vi.fn() }))

import { requireB2BCustomerApi } from '@/lib/checkout/server'
import { POST } from '../route'

type AnyRow = Record<string, unknown>

const ORG_ID = '00000000-0000-0000-0000-0000000000ff'
const CAT_ITEM_ID = '00000000-0000-0000-0000-0000000000aa'

function makeAdminStub() {
  const rpcCalls: Array<{ name: string; args: AnyRow | undefined }> = []

  function builderFor() {
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: async () => ({ data: null, error: null }),
    }
    return builder
  }

  const admin = {
    from: vi.fn(() => builderFor()),
    rpc: vi.fn(async (name: string, args?: AnyRow) => {
      rpcCalls.push({ name, args })
      if (name === 'catalogue_item_decoration_price') {
        return { data: 7.5, error: null }
      }
      return { data: null, error: null }
    }),
  }

  return { admin, rpcCalls }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/shop/decoration-pricing', () => {
  it('resolves manual combined pricing by catalogueItemId even when items is empty', async () => {
    const { admin, rpcCalls } = makeAdminStub()
    vi.mocked(requireB2BCustomerApi).mockResolvedValue({
      admin: admin as never,
      context: { organizationId: ORG_ID } as never,
    })

    const response = await POST(
      new Request('http://localhost/api/shop/decoration-pricing', {
        method: 'POST',
        body: JSON.stringify({
          qtys: [10],
          items: [],
          catalogueItemId: CAT_ITEM_ID,
        }),
      }),
    )
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toEqual({
      pricesByQty: {},
      manualByQty: { '10': 7.5 },
    })
    expect(rpcCalls).toEqual([
      {
        name: 'catalogue_item_decoration_price',
        args: { p_catalogue_item_id: CAT_ITEM_ID, p_qty: 10 },
      },
    ])
  })
})
