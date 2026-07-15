import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ admin: { from: vi.fn() }, ordersEq: vi.fn() }))

vi.mock('@/lib/supabase-server-component', () => ({
  getSupabaseServerComponent: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'user-1', email: 'b@x.co' } } })) },
  })),
}))
vi.mock('@/lib/supabase', () => ({ getSupabaseServer: () => mocks.admin }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }))

function membershipBuilder(role: string) {
  const b: Record<string, unknown> = {
    select: vi.fn(() => b),
    eq: vi.fn(() => b),
    maybeSingle: vi.fn(async () => ({ data: { organization_id: 'org-1', role }, error: null })),
  }
  return b
}
function ordersBuilder() {
  const b: Record<string, unknown> = {
    select: vi.fn(() => b),
    eq: vi.fn((col: string, val: unknown) => {
      mocks.ordersEq(col, val)
      return b
    }),
    order: vi.fn(async () => ({ data: [], error: null })),
  }
  return b
}
function emptyBuilder() {
  const b: Record<string, unknown> = {
    select: vi.fn(() => b),
    eq: vi.fn(() => b),
    in: vi.fn(() => b),
    order: vi.fn(async () => ({ data: [], error: null })),
  }
  return b
}

async function run(role: string) {
  mocks.ordersEq.mockClear()
  mocks.admin.from.mockImplementation((table: string) => {
    if (table === 'user_organizations') return membershipBuilder(role)
    if (table === 'orders') return ordersBuilder()
    return emptyBuilder()
  })
  vi.resetModules()
  const { getPortalPastOrdersData } = await import('@/lib/portal-data')
  await getPortalPastOrdersData()
  return mocks.ordersEq.mock.calls
}

describe('Past-orders role scope (Item 3)', () => {
  it('staff: scopes orders to quotes.created_by = userId', async () => {
    const calls = await run('staff')
    expect(calls).toContainEqual(['order_type', 'stock_on_hand'])
    expect(calls).toContainEqual(['quotes.organization_id', 'org-1'])
    expect(calls).toContainEqual(['quotes.created_by', 'user-1'])
  })
  it('org_admin: does NOT add the created_by filter', async () => {
    const calls = await run('org_admin')
    expect(calls).toContainEqual(['quotes.organization_id', 'org-1'])
    expect(calls).not.toContainEqual(['quotes.created_by', 'user-1'])
  })
})
