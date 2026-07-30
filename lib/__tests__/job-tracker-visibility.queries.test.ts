import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/product-images', () => ({
  resolveProductFrontImages: vi.fn(async () => ({})),
}))
const fromMock = vi.fn()
vi.mock('@/lib/supabase', () => ({ getSupabaseServer: () => ({ from: fromMock }) }))

import { getJobsForUser, getJobTrackerForUserByToken } from '../job-tracker-queries'

type AnyRow = Record<string, unknown>

function installList(rows: AnyRow[]) {
  fromMock.mockReset()
  fromMock.mockImplementation(() => {
    const builder: AnyRow = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(r),
    }
    return builder
  })
}

const stock = { id: 's', user_id: 'u1', order_type: 'stock_on_hand', quote_data: null }
const po = { id: 'p', user_id: 'u1', order_type: 'purchase_order', quote_data: null }
const legacy = { id: 'l', user_id: 'u1', order_type: null, quote_data: null }

// Sprint 3 (Anna feedback, Monday 2809663385) reversed Feature #7: stock-on-hand
// orders are no longer HIDDEN from the customer tracker. The list and the token
// deep link now surface them; the render layer swaps the 7-step timeline for a
// simplified Unfulfilled/Fulfilled badge. See job-tracker-queries.ts.
describe('tracker list now includes stock_on_hand', () => {
  it('getJobsForUser returns stock + PO + legacy (no visibility filter)', async () => {
    installList([stock, po, legacy])
    const out = await getJobsForUser('u1')
    expect(out.map((t) => t.id).sort()).toEqual(['l', 'p', 's'])
  })
})

describe('token deep-link now resolves stock_on_hand', () => {
  it('returns a stock tracker for its owner (no longer treated as not-found)', async () => {
    fromMock.mockReset()
    fromMock.mockImplementation((table: string) => {
      const builder: AnyRow = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () =>
          table === 'job_trackers'
            ? {
                data: { ...stock, tracker_token: 'tok', customer_email: null },
                error: null,
              }
            : { data: null, error: null },
      }
      return builder
    })
    const out = await getJobTrackerForUserByToken('tok', 'u1', null)
    expect(out?.id).toBe('s')
  })
})
