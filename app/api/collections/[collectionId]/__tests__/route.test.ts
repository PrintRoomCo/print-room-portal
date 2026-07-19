import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  admin: { from: vi.fn() },
  authUser: { id: 'user-1', email: 'admin@x.co' } as { id: string; email: string } | null,
}))

vi.mock('@/lib/supabase-server-component', () => ({
  getSupabaseServerComponent: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: mocks.authUser } })) },
  })),
}))
vi.mock('@/lib/supabase', () => ({ getSupabaseServer: () => mocks.admin }))
vi.mock('@/lib/collections-detail', () => ({
  getCollectionWithDesigns: vi.fn(async () => null),
  getAvailableDesigns: vi.fn(async () => []),
  getCollectionByQuoteId: vi.fn(async () => null),
}))
vi.mock('@/lib/job-tracker-queries', () => ({
  getLatestJobTrackerByQuoteId: vi.fn(async () => null),
}))

// Another org member's quote: the session email does NOT match.
const quoteRow = {
  id: 'quote-1',
  customer_email: 'ferrymead@anytimefitness.co.nz',
  organization_id: 'org-1',
  line_items: [],
}

function quotesBuilder() {
  const b: Record<string, unknown> = {
    select: vi.fn(() => b),
    eq: vi.fn(() => b),
    single: vi.fn(async () => ({ data: quoteRow, error: null })),
  }
  return b
}

function membershipBuilder(membership: { organization_id: string; role: string } | null) {
  const b: Record<string, unknown> = {
    select: vi.fn(() => b),
    eq: vi.fn(() => b),
    maybeSingle: vi.fn(async () => ({ data: membership, error: null })),
  }
  return b
}

function setup(membership: { organization_id: string; role: string } | null) {
  mocks.admin.from.mockImplementation((table: string) => {
    if (table === 'quotes') return quotesBuilder()
    if (table === 'user_organizations') return membershipBuilder(membership)
    throw new Error(`unexpected table ${table}`)
  })
}

async function get() {
  vi.resetModules()
  const { GET } = await import('@/app/api/collections/[collectionId]/route')
  return GET(new Request('http://localhost/api/collections/quote-1'), {
    params: Promise.resolve({ collectionId: 'quote-1' }),
  })
}

describe('GET /api/collections/[collectionId] — quote authorization', () => {
  beforeEach(() => {
    mocks.authUser = { id: 'user-1', email: 'admin@x.co' }
  })

  it('401 when unauthenticated', async () => {
    mocks.authUser = null
    setup(null)
    expect((await get()).status).toBe(401)
  })

  it('owner (matching customer_email) gets the quote', async () => {
    mocks.authUser = { id: 'user-2', email: 'Ferrymead@AnytimeFitness.co.nz' }
    setup(null)
    const res = await get()
    expect(res.status).toBe(200)
    expect((await res.json()).mode).toBe('quote')
  })

  it("org_admin of the quote's org gets another member's quote", async () => {
    setup({ organization_id: 'org-1', role: 'org_admin' })
    const res = await get()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.mode).toBe('quote')
    expect(body.quote.id).toBe('quote-1')
  })

  it('org_admin of a DIFFERENT org is denied (404, no existence leak)', async () => {
    setup({ organization_id: 'org-2', role: 'org_admin' })
    expect((await get()).status).toBe(404)
  })

  it('same-org staff who did not place the order is denied (404)', async () => {
    setup({ organization_id: 'org-1', role: 'staff' })
    expect((await get()).status).toBe(404)
  })
})
