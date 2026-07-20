import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logWebhookEvent, markWebhookLog } from '../webhook-log'

function makeAdmin(opts: { insertId?: string | null } = {}) {
  const calls = { from: [] as string[], insert: [] as unknown[], update: [] as unknown[], eq: [] as Array<[string, unknown]> }
  const builder: Record<string, unknown> = {
    insert: vi.fn((row: unknown) => {
      calls.insert.push(row)
      return builder
    }),
    update: vi.fn((row: unknown) => {
      calls.update.push(row)
      return builder
    }),
    select: vi.fn(() => builder),
    single: vi.fn(() => Promise.resolve({ data: { id: opts.insertId ?? 'log-1' }, error: null })),
    eq: vi.fn((c: string, v: unknown) => {
      calls.eq.push([c, v])
      return Promise.resolve({ error: null })
    }),
  }
  const admin = {
    from: vi.fn((t: string) => {
      calls.from.push(t)
      return builder
    }),
  } as unknown as SupabaseClient
  return { admin, calls }
}

describe('logWebhookEvent', () => {
  it('inserts a row and returns its id', async () => {
    const { admin, calls } = makeAdmin({ insertId: 'log-42' })
    const id = await logWebhookEvent(admin, {
      mondayItemId: '2783418624',
      boardId: 1992701981,
      columnId: 'color_mkpnas0e',
      eventType: 'change_status_column_value',
      payload: { hello: 'world' },
    })
    expect(id).toBe('log-42')
    expect(calls.from).toContain('job_tracker_webhook_logs')
    const row = calls.insert[0] as Record<string, unknown>
    expect(row.monday_item_id).toBe('2783418624')
    expect(row.board_id).toBe('1992701981')
    expect(row.column_id).toBe('color_mkpnas0e')
    expect(row.event_type).toBe('change_status_column_value')
  })
})

describe('markWebhookLog', () => {
  it('updates the log row by id with the outcome', async () => {
    const { admin, calls } = makeAdmin()
    await markWebhookLog(admin, 'log-1', { status: 'processed', notes: 'ok' })
    expect(calls.update).toHaveLength(1)
    const upd = calls.update[0] as Record<string, unknown>
    expect(upd.status).toBe('processed')
    expect(upd.notes).toBe('ok')
    expect(upd.processed_at).toBeTypeOf('string')
    expect(calls.eq).toContainEqual(['id', 'log-1'])
  })

  it('is a no-op when logId is null', async () => {
    const { admin, calls } = makeAdmin()
    await markWebhookLog(admin, null, { status: 'failed' })
    expect(calls.update).toHaveLength(0)
    expect(calls.from).toHaveLength(0)
  })
})
