import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { mapMondayStatusToQuoteEnum, mirrorStatusToQuote } from '../quote-mirror'

function makeAdmin(currentStatus: string | null) {
  const updates: Array<Record<string, unknown>> = []
  const inserts: Array<Record<string, unknown>> = []
  const admin = {
    from(table: string) {
      let mode: 'select' | 'update' | 'insert' = 'select'
      const b: Record<string, unknown> = {
        select: () => b,
        update: (row: Record<string, unknown>) => {
          mode = 'update'
          updates.push({ table, ...row })
          return b
        },
        insert: (row: Record<string, unknown>) => {
          inserts.push({ table, ...row })
          return Promise.resolve({ error: null })
        },
        eq: () => (mode === 'update' ? Promise.resolve({ error: null }) : b),
        maybeSingle: () => Promise.resolve({ data: currentStatus === undefined ? null : { id: 'q1', status: currentStatus }, error: null }),
      }
      return b
    },
  } as unknown as SupabaseClient
  return { admin, updates, inserts }
}

// 'Proof Approved' maps to the quote enum 'in_production' (the studio quote map
// keys on the raw label, not the tracker canonical key).
const args = {
  quoteId: 'q1',
  rawMondayStatus: 'Proof Approved',
  columnId: 'color_mkpnas0e',
  changedAt: '2026-07-20T01:00:00.000Z',
}

describe('mapMondayStatusToQuoteEnum', () => {
  it('maps the quote-relevant labels', () => {
    expect(mapMondayStatusToQuoteEnum('Proof Approved')).toBe('in_production')
    expect(mapMondayStatusToQuoteEnum('In Production')).toBe('in_production')
    expect(mapMondayStatusToQuoteEnum('Shipped')).toBe('dispatched')
    expect(mapMondayStatusToQuoteEnum('Delivered')).toBe('completed')
    expect(mapMondayStatusToQuoteEnum('nonsense label')).toBeNull()
  })
})

describe('mirrorStatusToQuote (gated behind ENABLE_QUOTE_STATUS_MIRROR)', () => {
  afterEach(() => {
    delete process.env.ENABLE_QUOTE_STATUS_MIRROR
  })

  it('does NOTHING when the flag is unset (portal-safety default)', async () => {
    const { admin, updates, inserts } = makeAdmin('approved')
    const fromSpy = vi.spyOn(admin, 'from')
    await mirrorStatusToQuote(admin, args)
    expect(fromSpy).not.toHaveBeenCalled()
    expect(updates).toHaveLength(0)
    expect(inserts).toHaveLength(0)
  })

  describe('with the flag ON', () => {
    beforeEach(() => {
      process.env.ENABLE_QUOTE_STATUS_MIRROR = 'true'
    })

    it('updates quotes.status + inserts a history row when the mapped status differs', async () => {
      const { admin, updates, inserts } = makeAdmin('approved')
      await mirrorStatusToQuote(admin, args)
      expect(updates.some((u) => u.table === 'quotes' && u.status === 'in_production')).toBe(true)
      expect(inserts.some((i) => i.table === 'quote_status_history' && i.to_status === 'in_production' && i.from_status === 'approved')).toBe(true)
    })

    it('no-ops when the quote is already at the mapped status', async () => {
      const { admin, updates, inserts } = makeAdmin('in_production')
      await mirrorStatusToQuote(admin, args)
      expect(updates).toHaveLength(0)
      expect(inserts).toHaveLength(0)
    })

    it('no-ops when the label has no quote mapping', async () => {
      const { admin, updates, inserts } = makeAdmin('approved')
      await mirrorStatusToQuote(admin, { ...args, rawMondayStatus: 'Need: Mockup (Quote Approved)' })
      expect(updates).toHaveLength(0)
      expect(inserts).toHaveLength(0)
    })
  })
})
