import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { statusEmailType, hasEmailBeenSent, recordEmailSend } from '../tracker-email-log'

/**
 * Minimal chainable Supabase stub. `select().eq()...maybeSingle()` resolves to
 * `maybeSingleResult`; `insert()` resolves to `insertResult`. Records calls for
 * assertions.
 */
function makeAdmin(opts: {
  maybeSingleResult?: { data: unknown }
  insertResult?: { error: unknown }
} = {}) {
  const calls = { from: [] as string[], eq: [] as Array<[string, unknown]>, insert: [] as unknown[] }
  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    eq: vi.fn((col: string, val: unknown) => {
      calls.eq.push([col, val])
      return builder
    }),
    maybeSingle: vi.fn(() => Promise.resolve(opts.maybeSingleResult ?? { data: null })),
    insert: vi.fn((row: unknown) => {
      calls.insert.push(row)
      return Promise.resolve(opts.insertResult ?? { error: null })
    }),
  }
  const admin = {
    from: vi.fn((table: string) => {
      calls.from.push(table)
      return builder
    }),
  } as unknown as SupabaseClient
  return { admin, calls, builder }
}

describe('statusEmailType', () => {
  it('encodes the canonical key + trigger-time epoch (stable across retries)', () => {
    const t = statusEmailType('in-production', '2026-07-20T01:00:00.000Z')
    expect(t).toBe(`status_update:in-production:${Date.parse('2026-07-20T01:00:00.000Z')}`)
  })

  it('re-entry to a stage with a NEW trigger time produces a DIFFERENT key', () => {
    const a = statusEmailType('proof-sent', '2026-07-20T01:00:00.000Z')
    const b = statusEmailType('proof-sent', '2026-07-21T09:00:00.000Z')
    expect(a).not.toBe(b)
  })

  it('falls back to epoch 0 when trigger time is missing', () => {
    expect(statusEmailType('dispatched', null)).toBe('status_update:dispatched:0')
    expect(statusEmailType('dispatched', 'not-a-date')).toBe('status_update:dispatched:0')
  })
})

describe('hasEmailBeenSent', () => {
  it('is true when a sent row exists for the item + type', async () => {
    const { admin, calls } = makeAdmin({ maybeSingleResult: { data: { id: 'x' } } })
    const sent = await hasEmailBeenSent(admin, { mondayItemId: '123', emailType: 'status_update:in-production:9' })
    expect(sent).toBe(true)
    expect(calls.from).toContain('tracker_email_log')
    expect(calls.eq).toContainEqual(['monday_item_id', '123'])
    expect(calls.eq).toContainEqual(['email_type', 'status_update:in-production:9'])
    expect(calls.eq).toContainEqual(['email_sent', true])
  })

  it('is false when no row exists', async () => {
    const { admin } = makeAdmin({ maybeSingleResult: { data: null } })
    expect(await hasEmailBeenSent(admin, { mondayItemId: '123', emailType: 't' })).toBe(false)
  })
})

describe('recordEmailSend', () => {
  it('inserts a log row with the send outcome', async () => {
    const { admin, calls } = makeAdmin()
    await recordEmailSend(admin, {
      mondayItemId: '123',
      trackerToken: 'ANFI-1',
      customerEmail: 'jamie@theprint-room.co.nz',
      emailType: 'status_update:in-production:9',
      emailSent: true,
      emailId: 'resend-1',
    })
    expect(calls.insert).toHaveLength(1)
    const row = calls.insert[0] as Record<string, unknown>
    expect(row.monday_item_id).toBe('123')
    expect(row.email_type).toBe('status_update:in-production:9')
    expect(row.email_sent).toBe(true)
    expect(row.email_id).toBe('resend-1')
    expect(row.trigger_type).toBe('automatic')
  })
})
