import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ admin: { from: vi.fn() } }))

vi.mock('@/lib/supabase', () => ({ getSupabaseServer: () => mocks.admin }))

/**
 * A filter-aware, awaitable PostgREST-ish builder. `.eq()` calls are recorded
 * and handed to `resolve()`, so a test can assert that scoping filters were
 * actually applied rather than trusting a mock that returns rows regardless —
 * which is exactly how a cross-tenant leak would slip through a green test.
 */
function builder(resolve: (filters: Record<string, unknown>) => unknown) {
  const filters: Record<string, unknown> = {}
  const result = () => Promise.resolve(resolve(filters))
  const b: Record<string, unknown> = {
    select: vi.fn(() => b),
    eq: vi.fn((col: string, val: unknown) => {
      filters[col] = val
      return b
    }),
    in: vi.fn((col: string, vals: unknown) => {
      filters[col] = vals
      return b
    }),
    order: vi.fn(() => result()),
    maybeSingle: vi.fn(() => result()),
    single: vi.fn(() => result()),
    limit: vi.fn(() => b),
    // Awaiting the builder itself (no terminal method) resolves the query.
    then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      result().then(onFulfilled, onRejected),
  }
  return b
}

const ok = (data: unknown) => ({ data, error: null })

const ORG = 'org-1'
const OTHER_ORG = 'org-2'

const trackerViaQuote = {
  id: 1,
  quote_id: 'quote-1',
  user_id: null,
  tracker_token: 't1',
  created_at: '2026-07-10',
}
const trackerViaUser = {
  id: 2,
  quote_id: null,
  user_id: 'member-1',
  tracker_token: 't2',
  created_at: '2026-07-09',
}

describe('getJobsForOrganization', () => {
  beforeEach(() => vi.resetModules())

  function setup(opts: { quoteIds?: string[]; memberIds?: string[]; trackers?: unknown[] }) {
    const quoteIds = opts.quoteIds ?? []
    const memberIds = opts.memberIds ?? []
    const trackers = (opts.trackers ?? []) as Array<Record<string, unknown>>

    mocks.admin.from.mockImplementation((table: string) => {
      if (table === 'quotes') {
        return builder((f) =>
          ok(f.organization_id === ORG ? quoteIds.map((id) => ({ id })) : []),
        )
      }
      if (table === 'user_organizations') {
        return builder((f) =>
          ok(f.organization_id === ORG ? memberIds.map((user_id) => ({ user_id })) : []),
        )
      }
      if (table === 'job_trackers') {
        return builder((f) => {
          if (f.quote_id) {
            const wanted = f.quote_id as string[]
            return ok(trackers.filter((t) => wanted.includes(t.quote_id as string)))
          }
          if (f.user_id) {
            const wanted = f.user_id as string[]
            return ok(trackers.filter((t) => wanted.includes(t.user_id as string)))
          }
          return ok([])
        })
      }
      return builder(() => ok([]))
    })
  }

  it('returns a tracker linked by quote_id', async () => {
    setup({ quoteIds: ['quote-1'], memberIds: [], trackers: [trackerViaQuote] })
    const { getJobsForOrganization } = await import('@/lib/job-tracker-queries')
    expect((await getJobsForOrganization(ORG)).map((r) => r.id)).toEqual([1])
  })

  it('returns a tracker linked by owning-user membership', async () => {
    setup({ quoteIds: [], memberIds: ['member-1'], trackers: [trackerViaUser] })
    const { getJobsForOrganization } = await import('@/lib/job-tracker-queries')
    expect((await getJobsForOrganization(ORG)).map((r) => r.id)).toEqual([2])
  })

  it('dedupes a tracker matched by BOTH quote and owning user', async () => {
    const both = { ...trackerViaQuote, user_id: 'member-1' }
    setup({ quoteIds: ['quote-1'], memberIds: ['member-1'], trackers: [both] })
    const { getJobsForOrganization } = await import('@/lib/job-tracker-queries')
    expect((await getJobsForOrganization(ORG)).map((r) => r.id)).toEqual([1])
  })

  it("excludes another org's tracker", async () => {
    setup({
      quoteIds: ['quote-1'],
      memberIds: ['member-1'],
      trackers: [trackerViaQuote, { id: 9, quote_id: 'other-quote', user_id: 'outsider' }],
    })
    const { getJobsForOrganization } = await import('@/lib/job-tracker-queries')
    expect((await getJobsForOrganization(ORG)).map((r) => r.id)).toEqual([1])
  })

  it('returns [] for an org with no quotes and no members', async () => {
    setup({ quoteIds: [], memberIds: [], trackers: [trackerViaQuote] })
    const { getJobsForOrganization } = await import('@/lib/job-tracker-queries')
    expect(await getJobsForOrganization(ORG)).toEqual([])
  })
})

describe('getJobTrackerForUserByToken — org_admin authorization', () => {
  beforeEach(() => vi.resetModules())

  const tracker = {
    id: 1657,
    tracker_token: 'tok',
    quote_id: 'quote-1',
    user_id: 'member-1',
    company_id: null,
    location_id: null,
    customer_email: 'ferrymead@anytimefitness.co.nz',
  }

  /** quote-1 belongs to ORG; member-1 is a member of ORG. */
  function setup(opts: { role: string; membershipOrg: string }) {
    mocks.admin.from.mockImplementation((table: string) => {
      if (table === 'job_trackers') return builder(() => ok(tracker))
      if (table === 'quotes') {
        return builder((f) => ok(f.id === 'quote-1' ? { organization_id: ORG } : null))
      }
      if (table === 'user_organizations') {
        return builder((f) => {
          // trackerBelongsToOrg: filters on BOTH user_id and organization_id.
          if (f.organization_id !== undefined) {
            const isMember = f.user_id === 'member-1' && f.organization_id === ORG
            return ok(isMember ? { user_id: 'member-1' } : null)
          }
          // The requester's own membership lookup (user_id only).
          return ok({ organization_id: opts.membershipOrg, role: opts.role })
        })
      }
      return builder(() => ok([]))
    })
  }

  it("org_admin of the quote's org sees another member's tracker", async () => {
    setup({ role: 'org_admin', membershipOrg: ORG })
    const { getJobTrackerForUserByToken } = await import('@/lib/job-tracker-queries')
    expect((await getJobTrackerForUserByToken('tok', 'admin-user', 'admin@x.co'))?.id).toBe(1657)
  })

  it('org_admin of a DIFFERENT org gets null', async () => {
    setup({ role: 'org_admin', membershipOrg: OTHER_ORG })
    const { getJobTrackerForUserByToken } = await import('@/lib/job-tracker-queries')
    expect(await getJobTrackerForUserByToken('tok', 'admin-user', 'admin@x.co')).toBeNull()
  })

  it('same-org staff who does not own the tracker gets null', async () => {
    setup({ role: 'staff', membershipOrg: ORG })
    const { getJobTrackerForUserByToken } = await import('@/lib/job-tracker-queries')
    expect(await getJobTrackerForUserByToken('tok', 'other-user', 'other@x.co')).toBeNull()
  })

  it('the owner still sees their own tracker by user_id', async () => {
    setup({ role: 'staff', membershipOrg: ORG })
    const { getJobTrackerForUserByToken } = await import('@/lib/job-tracker-queries')
    expect((await getJobTrackerForUserByToken('tok', 'member-1', 'someone@else.co'))?.id).toBe(1657)
  })

  it('the owner still sees their own tracker by email (case-insensitive)', async () => {
    setup({ role: 'staff', membershipOrg: ORG })
    const { getJobTrackerForUserByToken } = await import('@/lib/job-tracker-queries')
    const result = await getJobTrackerForUserByToken(
      'tok',
      'nobody',
      'Ferrymead@AnytimeFitness.co.nz',
    )
    expect(result?.id).toBe(1657)
  })
})
