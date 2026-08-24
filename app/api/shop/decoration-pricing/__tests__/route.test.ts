import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/checkout/server', () => ({ requireB2BCustomerApi: vi.fn() }))

import { requireB2BCustomerApi } from '@/lib/checkout/server'
import { POST } from '../route'

type AnyRow = Record<string, unknown>

const ORG_ID = '00000000-0000-0000-0000-0000000000ff'
const CAT_ITEM_ID = '00000000-0000-0000-0000-0000000000aa'

function makeAdminStub() {
  const rpcCalls: Array<{ name: string; args: AnyRow | undefined }> = []

  function builderFor(table: string) {
    const builder = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: async () => ({ data: null, error: null }),
      then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
        resolve({
          data:
            table === 'organization_countries'
              ? [
                  {
                    country_code: 'AU',
                    is_default: true,
                    countries: {
                      name: 'Australia',
                      currency: 'AUD',
                      tax_rate: 0.1,
                      tax_label: 'GST 10%',
                    },
                  },
                ]
              : table === 'b2b_catalogue_item_decorations'
                ? [
                    {
                      id: 'link-1',
                      org_decoration_id: 'decoration-1',
                      catalogue_item_id: CAT_ITEM_ID,
                      org_decorations: { unit_price: 99 },
                    },
                  ]
                : [],
          error: null,
        }),
    }
    return builder
  }

  const admin = {
    from: vi.fn((table: string) => builderFor(table)),
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
  delete process.env.CHECKOUT_COUNTRY_PARTITION_ENABLED
})

afterEach(() => {
  delete process.env.CHECKOUT_COUNTRY_PARTITION_ENABLED
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

  it('prices computed and manual decorations only in the org default currency when enabled', async () => {
    process.env.CHECKOUT_COUNTRY_PARTITION_ENABLED = 'true'
    const { admin, rpcCalls } = makeAdminStub()
    admin.rpc.mockImplementation(async (name: string, args?: AnyRow) => {
      rpcCalls.push({ name, args })
      if (name === 'effective_decoration_unit_price_for_currency') {
        return { data: 0, error: null }
      }
      if (name === 'catalogue_item_decoration_price_for_currency') {
        return { data: 7.5, error: null }
      }
      return { data: null, error: null }
    })
    vi.mocked(requireB2BCustomerApi).mockResolvedValue({
      admin: admin as never,
      context: { organizationId: ORG_ID } as never,
    })

    const response = await POST(
      new Request('http://localhost/api/shop/decoration-pricing', {
        method: 'POST',
        body: JSON.stringify({
          qty: 10,
          items: [{ linkId: 'link-1' }],
          catalogueItemId: CAT_ITEM_ID,
          currency: 'NZD',
        }),
      }),
    )

    await expect(response.json()).resolves.toEqual({
      prices: { 'link-1': 0 },
      manual: 7.5,
      currency: 'AUD',
    })
    expect(rpcCalls).toEqual([
      {
        name: 'effective_decoration_unit_price_for_currency',
        args: { p_org_decoration_id: 'decoration-1', p_qty: 10, p_currency: 'AUD' },
      },
      {
        name: 'catalogue_item_decoration_price_for_currency',
        args: { p_catalogue_item_id: CAT_ITEM_ID, p_qty: 10, p_currency: 'AUD' },
      },
    ])
  })
})
