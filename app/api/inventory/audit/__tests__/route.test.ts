import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/checkout/server', () => ({ requireB2BCustomerApi: vi.fn() }))

import { GET } from '../route'
import { requireB2BCustomerApi } from '@/lib/checkout/server'

const ORG = 'org-1'
type AnyRow = Record<string, unknown>

function makeAdmin(selects: Record<string, { data: unknown; error: null }>) {
  function builder(table: string) {
    const resp = selects[table] ?? { data: [], error: null }
    const b: AnyRow = {
      select: () => b,
      eq: () => b,
      in: () => b,
      order: () => b,
      limit: () => b,
      then: (res: (v: unknown) => unknown) => Promise.resolve(resp).then(res),
    }
    return b
  }
  return { from: vi.fn((t: string) => builder(t)) } as unknown
}

beforeEach(() => vi.clearAllMocks())

describe('GET /api/inventory/audit', () => {
  it('403s for a non-admin member', async () => {
    vi.mocked(requireB2BCustomerApi).mockResolvedValue({
      admin: makeAdmin({}),
      context: { organizationId: ORG, role: 'staff' },
    } as never)
    const res = await GET()
    expect(res.status).toBe(403)
  })

  it('returns resolved audit entries for an org_admin', async () => {
    vi.mocked(requireB2BCustomerApi).mockResolvedValue({
      admin: makeAdmin({
        variant_inventory_events: {
          data: [
            {
              id: 'e1',
              variant_id: 'v1',
              reason: 'order_commit',
              delta_stock: -5,
              delta_committed: 0,
              note: null,
              reference_quote_item_id: 'qi-1',
              staff_user_id: null,
              created_at: '2026-06-01T00:00:00Z',
            },
          ],
          error: null,
        },
        quote_items: { data: [{ id: 'qi-1', quote_id: 'q-1', ship_to_store_id: 's-1' }], error: null },
        quotes: { data: [{ id: 'q-1', created_by: 'u-1' }], error: null },
        profiles: { data: [{ id: 'u-1', full_name: 'Jane Buyer', email: 'jane@b.test' }], error: null },
        stores: { data: [{ id: 's-1', name: 'Queen St Store' }], error: null },
      }),
      context: { organizationId: ORG, role: 'org_admin' },
    } as never)

    const res = await GET()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.entries).toHaveLength(1)
    expect(json.entries[0]).toMatchObject({
      who: 'Jane Buyer',
      where: 'Queen St Store',
      source: 'order',
    })
  })
})
