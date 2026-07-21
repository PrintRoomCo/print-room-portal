import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isTrackerTestOrg } from '../tracker-test-org'

/**
 * Chainable Supabase stub that returns a per-table `maybeSingle` result. The
 * table is captured on `from()`, so `quotes` and `organizations` can resolve
 * differently in one call chain.
 */
function makeAdmin(rows: { quotes?: unknown; organizations?: unknown }) {
  let currentTable = ''
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: () =>
      Promise.resolve({
        data: currentTable === 'quotes' ? rows.quotes ?? null : rows.organizations ?? null,
      }),
  }
  const from = vi.fn((t: string) => {
    currentTable = t
    return builder
  })
  return { from } as unknown as SupabaseClient
}

describe('isTrackerTestOrg', () => {
  it('is false (no query) when there is no quote id', async () => {
    const admin = makeAdmin({})
    expect(await isTrackerTestOrg(admin, null)).toBe(false)
    expect((admin.from as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
  })

  it('is false when the quote has no organization', async () => {
    const admin = makeAdmin({ quotes: { organization_id: null } })
    expect(await isTrackerTestOrg(admin, 'q1')).toBe(false)
  })

  it('is true when the organization is a test org', async () => {
    const admin = makeAdmin({ quotes: { organization_id: 'org1' }, organizations: { is_test: true } })
    expect(await isTrackerTestOrg(admin, 'q1')).toBe(true)
  })

  it('is false for a real (non-test) organization', async () => {
    const admin = makeAdmin({ quotes: { organization_id: 'org1' }, organizations: { is_test: false } })
    expect(await isTrackerTestOrg(admin, 'q1')).toBe(false)
  })

  it('is false when the organization row is missing', async () => {
    const admin = makeAdmin({ quotes: { organization_id: 'org1' }, organizations: null })
    expect(await isTrackerTestOrg(admin, 'q1')).toBe(false)
  })
})
