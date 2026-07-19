import { describe, it, expect, vi, beforeEach } from 'vitest'

// attachProductImages calls resolveProductFrontImages; trackers in these tests
// carry no quote_data items, so it short-circuits — but mock it defensively.
vi.mock('@/lib/product-images', () => ({
  resolveProductFrontImages: vi.fn(async () => ({})),
}))

const fromMock = vi.fn()
vi.mock('@/lib/supabase', () => ({
  getSupabaseServer: () => ({ from: fromMock }),
}))

import { getJobTrackerForUserByToken } from '../job-tracker-queries'

type AnyRow = Record<string, unknown>

/**
 * Builds a Supabase-ish client whose `.from(table)` resolves to the response
 * registered for that table. Each builder records its `.eq` filters and is
 * awaitable via both `.maybeSingle()` and thenable chaining (for `.in`/list).
 */
type TableResponse = { data: AnyRow | AnyRow[] | null; error: unknown }
type TableSpec = TableResponse | ((filters: Record<string, unknown>) => TableResponse)

function installClient(tables: Record<string, TableSpec>) {
  fromMock.mockReset()
  fromMock.mockImplementation((table: string) => {
    const spec = tables[table] ?? { data: null, error: null }
    // Filters are recorded so a table queried two different ways (e.g.
    // user_organizations, read once for the requester's membership and once to
    // test another user's membership) can answer each correctly.
    const filters: Record<string, unknown> = {}
    const resolveResponse = (): TableResponse =>
      typeof spec === 'function' ? spec(filters) : spec
    const builder: AnyRow = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        filters[col] = val
        return builder
      },
      in: (col: string, val: unknown) => {
        filters[col] = val
        return builder
      },
      order: () => builder,
      limit: () => builder,
      maybeSingle: async () => {
        const response = resolveResponse()
        if (Array.isArray(response.data)) {
          return { data: response.data[0] ?? null, error: response.error }
        }
        return response
      },
      then: (resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) =>
        Promise.resolve(resolveResponse()).then(resolve, reject),
    }
    return builder
  })
}

const TOKEN = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa'
const OWNER_USER = 'user-owner'
const OTHER_USER = 'user-other'
const ORG_ID = 'org-1'
// Retained only to prove these dead columns no longer grant access.
const COMPANY_ID = 'COMP-1'

function trackerRow(overrides: AnyRow = {}): AnyRow {
  return {
    id: 't-1',
    tracker_token: TOKEN,
    user_id: OWNER_USER,
    customer_email: 'owner@acme.test',
    company_id: COMPANY_ID,
    location_id: 'store-1',
    status: 'in-production',
    quote_data: null,
    ...overrides,
  }
}

describe('getJobTrackerForUserByToken', () => {
  beforeEach(() => fromMock.mockReset())

  it('returns null for an unknown token', async () => {
    installClient({ job_trackers: { data: null, error: null } })
    const result = await getJobTrackerForUserByToken(TOKEN, OWNER_USER, 'owner@acme.test')
    expect(result).toBeNull()
  })

  it('returns the tracker when the requester owns it by user_id', async () => {
    installClient({ job_trackers: { data: trackerRow(), error: null } })
    const result = await getJobTrackerForUserByToken(TOKEN, OWNER_USER, null)
    expect(result?.id).toBe('t-1')
  })

  it('returns the tracker when the requester matches customer_email (case-insensitive)', async () => {
    installClient({ job_trackers: { data: trackerRow({ user_id: 'someone-else' }), error: null } })
    const result = await getJobTrackerForUserByToken(TOKEN, OTHER_USER, 'OWNER@ACME.TEST')
    expect(result?.id).toBe('t-1')
  })

  // Tenancy is the quote's organization_id (or the owning user's membership) —
  // NOT company_id/location_id, which are null on every row in prod.
  it('returns the tracker for an org_admin of the owning org (via its quote)', async () => {
    installClient({
      job_trackers: {
        data: trackerRow({ user_id: 'someone-else', customer_email: 'x@y.test', quote_id: 'quote-1' }),
        error: null,
      },
      user_organizations: (filters) =>
        filters.organization_id === undefined
          ? { data: { organization_id: ORG_ID, role: 'org_admin' }, error: null }
          : { data: null, error: null },
      quotes: { data: { organization_id: ORG_ID }, error: null },
    })
    const result = await getJobTrackerForUserByToken(TOKEN, OTHER_USER, 'other@nope.test')
    expect(result?.id).toBe('t-1')
  })

  it('returns null for an unrelated logged-in user (buyer, no email/user match)', async () => {
    installClient({
      job_trackers: { data: trackerRow({ user_id: 'someone-else', customer_email: 'x@y.test' }), error: null },
      user_organizations: { data: { organization_id: ORG_ID, role: 'buyer' }, error: null },
    })
    const result = await getJobTrackerForUserByToken(TOKEN, OTHER_USER, 'other@nope.test')
    expect(result).toBeNull()
  })

  it('returns null for an org_admin of a DIFFERENT org', async () => {
    installClient({
      job_trackers: {
        data: trackerRow({ user_id: 'someone-else', customer_email: 'x@y.test', quote_id: 'quote-1' }),
        error: null,
      },
      // Requester admins ORG_ID; the quote and its owning user belong to org-other.
      user_organizations: (filters) =>
        filters.organization_id === undefined
          ? { data: { organization_id: ORG_ID, role: 'org_admin' }, error: null }
          : { data: null, error: null },
      quotes: { data: { organization_id: 'org-other' }, error: null },
    })
    const result = await getJobTrackerForUserByToken(TOKEN, OTHER_USER, 'other@nope.test')
    expect(result).toBeNull()
  })

  it('returns null for an org_admin when the tracker has no quote and no member link', async () => {
    installClient({
      job_trackers: { data: trackerRow({ user_id: 'outsider', customer_email: 'x@y.test' }), error: null },
      user_organizations: (filters) =>
        filters.organization_id === undefined
          ? { data: { organization_id: ORG_ID, role: 'org_admin' }, error: null }
          : { data: null, error: null },
      quotes: { data: null, error: null },
    })
    const result = await getJobTrackerForUserByToken(TOKEN, OTHER_USER, 'other@nope.test')
    expect(result).toBeNull()
  })
})
