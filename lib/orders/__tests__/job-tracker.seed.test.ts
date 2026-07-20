import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { deriveStatusValue } from '@/lib/monday/tracker-status-engine'
import { createJobTrackerShellForOrder, CHECKOUT_SEED_STATUS } from '../job-tracker'

// Issue #77, gap b: a fresh portal order was born at 'need-proof' ("Proof Prep",
// 3/7) — one stage AHEAD of the Monday item's real "Need: Mockup (Quote
// Approved)" (2/7). At checkout the Monday item does not exist yet, so we seed
// from the SAME label the engine derives that stage from.
describe('CHECKOUT_SEED_STATUS (gap b)', () => {
  it('is Mockup, not Proof Prep — matching Monday’s fresh-item default', () => {
    expect(CHECKOUT_SEED_STATUS).toBe('quote-accepted-mockup')
    expect(CHECKOUT_SEED_STATUS).not.toBe('need-proof')
  })

  it('is derived through the engine from the canonical fresh-order label', () => {
    expect(CHECKOUT_SEED_STATUS).toBe(deriveStatusValue('Need: Mockup (Quote Approved)').canonical)
  })
})

/** Minimal Supabase stub for the shell-creation happy path (no line items). */
function makeAdmin() {
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = []
  const resultFor: Record<string, { data: unknown }> = {
    b2b_accounts: { data: { company_id: null } },
    quotes: { data: { subtotal: 0, decoration_cost: 0, total_amount: 0 } },
    quote_items: { data: [] },
    job_trackers: { data: null }, // no existing shell
    products: { data: [] },
  }
  const admin = {
    from(table: string) {
      const result = resultFor[table] ?? { data: null }
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        in: () => Promise.resolve(result),
        maybeSingle: () => Promise.resolve(result),
        single: () => Promise.resolve({ data: { id: 'trk-new' }, error: null }),
        insert: (row: Record<string, unknown>) => {
          inserts.push({ table, row })
          return builder
        },
        // makes `await admin.from('quote_items').select().eq('quote_id', x)` resolve
        then: (res: (v: unknown) => void) => res(result),
      }
      return builder
    },
  } as unknown as SupabaseClient
  return { admin, inserts }
}

describe('createJobTrackerShellForOrder — seed row', () => {
  it('inserts the shell at the Mockup stage, not Proof Prep, with no proof copy', async () => {
    const { admin, inserts } = makeAdmin()
    await createJobTrackerShellForOrder(admin, {
      quoteId: 'q1',
      orderRef: 'ANFI-000300',
      organizationId: 'org1',
      userId: 'user1',
      customerEmail: 'jamie@theprint-room.co.nz',
      customerName: 'Jamie',
      requiredBy: null,
    })

    const trackerInsert = inserts.find((i) => i.table === 'job_trackers')
    expect(trackerInsert).toBeDefined()
    const row = trackerInsert!.row
    expect(row.status).toBe('quote-accepted-mockup')

    const history = row.status_history as Array<{ status_key: string }>
    expect(history[0].status_key).toBe('quote-accepted-mockup')

    const updates = row.production_updates as Array<{ body: string }>
    expect(updates[0].body.toLowerCase()).not.toContain('proof')
  })
})
