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
function installClient(tables: Record<string, { data: AnyRow | AnyRow[] | null; error: unknown }>) {
  fromMock.mockReset()
  fromMock.mockImplementation((table: string) => {
    const response = tables[table] ?? { data: null, error: null }
    const builder: AnyRow = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: async () => {
        if (Array.isArray(response.data)) {
          return { data: response.data[0] ?? null, error: response.error }
        }
        return response
      },
      then: (resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) =>
        Promise.resolve(response).then(resolve, reject),
    }
    return builder
  })
}

const TOKEN = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa'
const OWNER_USER = 'user-owner'
const OTHER_USER = 'user-other'
const ORG_ID = 'org-1'
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

  it('returns the tracker for an org_admin of the owning company + location', async () => {
    installClient({
      job_trackers: { data: trackerRow({ user_id: 'someone-else', customer_email: 'x@y.test' }), error: null },
      user_organizations: { data: { organization_id: ORG_ID, role: 'org_admin' }, error: null },
      b2b_accounts: { data: { company_id: COMPANY_ID }, error: null },
      stores: { data: [{ id: 'store-1' }, { id: 'store-2' }], error: null },
    })
    const result = await getJobTrackerForUserByToken(TOKEN, OTHER_USER, 'other@nope.test')
    expect(result?.id).toBe('t-1')
  })

  it('returns null for an unrelated logged-in user (buyer, no email/user match)', async () => {
    installClient({
      job_trackers: { data: trackerRow({ user_id: 'someone-else', customer_email: 'x@y.test' }), error: null },
      user_organizations: { data: { organization_id: ORG_ID, role: 'buyer' }, error: null },
      b2b_accounts: { data: { company_id: COMPANY_ID }, error: null },
      stores: { data: [{ id: 'store-1' }], error: null },
    })
    const result = await getJobTrackerForUserByToken(TOKEN, OTHER_USER, 'other@nope.test')
    expect(result).toBeNull()
  })

  it('returns null for an org_admin of a DIFFERENT company', async () => {
    installClient({
      job_trackers: { data: trackerRow({ user_id: 'someone-else', customer_email: 'x@y.test' }), error: null },
      user_organizations: { data: { organization_id: ORG_ID, role: 'org_admin' }, error: null },
      b2b_accounts: { data: { company_id: 'COMP-OTHER' }, error: null },
      stores: { data: [{ id: 'store-9' }], error: null },
    })
    const result = await getJobTrackerForUserByToken(TOKEN, OTHER_USER, 'other@nope.test')
    expect(result).toBeNull()
  })
})
