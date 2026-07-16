import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  supabase: null as unknown,
  revalidateTag: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({ getSupabaseServer: () => mocks.supabase }))
vi.mock('next/cache', () => ({ revalidateTag: mocks.revalidateTag }))

import { POST } from '../route'

interface TrackerRowLike {
  id: number
  tracker_token: string
  job_reference: string | null
  quote_number: string | null
  tracking_info: Record<string, unknown> | null
  production_updates: unknown[] | null
}

/**
 * Fake service-role client. job_trackers lookups resolve via an exact
 * `${column}:${value}` key — and the builder deliberately has NO .or()
 * method, so any regression back to string-interpolated .or() filters
 * (the PostgREST injection vector) crashes the test.
 */
function makeSupabase(
  opts: {
    trackerByColumn?: Record<string, TrackerRowLike>
    updateError?: { message: string } | null
  } = {},
) {
  const logs: Array<Record<string, unknown>> = []
  const updates: Array<Record<string, unknown>> = []
  const supabase = {
    from(table: string) {
      if (table === 'starshipit_webhook_logs') {
        return {
          insert: (row: Record<string, unknown>) => {
            logs.push(row)
            return Promise.resolve({ error: null })
          },
        }
      }
      // job_trackers
      return {
        select: () => ({
          eq: (column: string, value: unknown) => ({
            limit: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: opts.trackerByColumn?.[`${column}:${String(value)}`] ?? null,
                  error: null,
                }),
            }),
          }),
        }),
        update: (payload: Record<string, unknown>) => ({
          eq: () => {
            updates.push(payload)
            return Promise.resolve({ error: opts.updateError ?? null })
          },
        }),
      }
    },
  }
  return { supabase, logs, updates }
}

const TRACKER: TrackerRowLike = {
  id: 42,
  tracker_token: 'tok-42',
  job_reference: 'PR-100',
  quote_number: 'Q-100',
  tracking_info: null,
  production_updates: [],
}

function req(body: unknown) {
  return new Request('http://t/api/webhooks/starshipit?secret=s3cret', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('STARSHIPIT_WEBHOOK_SECRET', 's3cret')
})
afterEach(() => vi.unstubAllEnvs())

describe('POST /api/webhooks/starshipit — parameterized matching', () => {
  it('an injection-shaped order_number matches nothing (bound value, not filter grammar)', async () => {
    const f = makeSupabase({ trackerByColumn: { 'job_reference:PR-100': TRACKER } })
    mocks.supabase = f.supabase

    const res = await POST(req({ order_number: 'X,job_reference.neq.', tracking_number: null }))
    expect(res.status).toBe(200)
    expect((await res.json()).matched).toBe(false)
    expect(f.updates).toHaveLength(0)
    expect(f.logs[0]).toMatchObject({ status: 'unmatched' })
  })

  it('matches a real job_reference and appends the tracking update', async () => {
    const f = makeSupabase({ trackerByColumn: { 'job_reference:PR-100': TRACKER } })
    mocks.supabase = f.supabase

    const res = await POST(
      req({ order_number: 'PR-100', tracking_number: 'TN1', tracking_status: 'Dispatched' }),
    )
    expect(res.status).toBe(200)
    expect((await res.json()).matched).toBe(true)
    expect(f.updates).toHaveLength(1)
    expect(f.logs[0]).toMatchObject({ status: 'matched', matched_job_tracker_id: 42 })
  })

  it('a failed tracker update logs status=error (not a false matched) and returns 500', async () => {
    const f = makeSupabase({
      trackerByColumn: { 'job_reference:PR-100': TRACKER },
      updateError: { message: 'connection reset' },
    })
    mocks.supabase = f.supabase

    const res = await POST(req({ order_number: 'PR-100', tracking_number: 'TN1' }))
    expect(res.status).toBe(500)
    expect(f.logs[0]).toMatchObject({ status: 'error', error: 'connection reset' })
  })
})
