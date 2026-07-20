import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Mocks (declared before importing the route) ---
const trackerRow = {
  current: null as Record<string, unknown> | null,
}
const supaUpdates: Array<{ set: Record<string, unknown>; id: unknown }> = []

vi.mock('@/lib/supabase', () => ({
  getSupabaseServer: () => ({
    from() {
      let pendingUpdate: Record<string, unknown> | null = null
      const b: Record<string, unknown> = {
        select: () => b,
        or: () => b,
        limit: () => b,
        maybeSingle: () => Promise.resolve({ data: trackerRow.current }),
        single: () => Promise.resolve({ data: trackerRow.current }),
        update: (row: Record<string, unknown>) => {
          pendingUpdate = row
          return b
        },
        eq: (_c: string, v: unknown) => {
          if (pendingUpdate) {
            supaUpdates.push({ set: pendingUpdate, id: v })
            return Promise.resolve({ error: null })
          }
          return b
        },
        insert: () => Promise.resolve({ error: null }),
      }
      return b
    },
  }),
}))

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))

const sendTrackerStatusEmail = vi.fn((_args?: unknown) => Promise.resolve({ success: true }))
vi.mock('@/lib/email/tracker-notification', () => ({
  sendTrackerStatusEmail: (a: unknown) => sendTrackerStatusEmail(a),
}))

const hasEmailBeenSent = vi.fn(() => Promise.resolve(false))
const recordEmailSend = vi.fn(() => Promise.resolve())
vi.mock('@/lib/email/tracker-email-log', async (orig) => ({
  ...(await orig<typeof import('@/lib/email/tracker-email-log')>()),
  hasEmailBeenSent: (...a: unknown[]) => hasEmailBeenSent(...(a as [])),
  recordEmailSend: (...a: unknown[]) => recordEmailSend(...(a as [])),
}))

const logWebhookEvent = vi.fn(() => Promise.resolve('log-1'))
const markWebhookLog = vi.fn(() => Promise.resolve())
vi.mock('@/lib/monday/webhook-log', () => ({
  logWebhookEvent: (...a: unknown[]) => logWebhookEvent(...(a as [])),
  markWebhookLog: (...a: unknown[]) => markWebhookLog(...(a as [])),
}))

const mirrorStatusToQuote = vi.fn(() => Promise.resolve())
vi.mock('@/lib/monday/quote-mirror', () => ({
  mirrorStatusToQuote: (...a: unknown[]) => mirrorStatusToQuote(...(a as [])),
}))

const provisionTrackerForJobReferenceEvent = vi.fn(() =>
  Promise.resolve({ statusCode: 200, body: { success: true, action: 'created' }, logStatus: 'processed' })
)
const handleTrackerTokenEvent = vi.fn(() => Promise.resolve({ applied: true, correctedTo: 'x' }))
const provisionTrackerForCreateEvent = vi.fn(() =>
  Promise.resolve({ statusCode: 200, body: { success: true, applied: false }, logStatus: 'noop' })
)
vi.mock('@/lib/monday/tracker-provisioning', () => ({
  provisionTrackerForJobReferenceEvent: (...a: unknown[]) => provisionTrackerForJobReferenceEvent(...(a as [])),
  handleTrackerTokenEvent: (...a: unknown[]) => handleTrackerTokenEvent(...(a as [])),
  provisionTrackerForCreateEvent: (...a: unknown[]) => provisionTrackerForCreateEvent(...(a as [])),
}))

import { POST } from '../route'

declare const flushAfter: () => Promise<void>

const MAIN_STATUS = 'color_mkpnas0e'
const JOB_REF_COL = 'text_mkqxcmvz'
const TRACKER_URL_COL = 'text_mkxvmsha'

function statusEvent(over: Record<string, unknown> = {}) {
  return {
    type: 'update_column_value',
    boardId: 1992701981,
    pulseId: 555,
    pulseName: 'ANFI-000200',
    columnId: MAIN_STATUS,
    columnType: 'color',
    triggerTime: '2026-07-20T01:00:00.000Z',
    userId: 42,
    value: { label: { index: 8, text: 'Assign to Production' } },
    previousValue: { label: { index: 6, text: 'Need: Proof' } },
    ...over,
  }
}

function post(event: Record<string, unknown> | null, opts: { secret?: string; challenge?: string } = {}) {
  const url = `https://portal.theprintroom.nz/api/webhooks/monday/tracker-status${opts.secret ? `?secret=${opts.secret}` : ''}`
  const body = opts.challenge ? { challenge: opts.challenge } : { event }
  return POST(new Request(url, { method: 'POST', body: JSON.stringify(body) }))
}

function baseTracker(over: Record<string, unknown> = {}) {
  return {
    id: 't1',
    status: 'need-proof',
    customer_email: 'jamie@theprint-room.co.nz',
    tracker_token: 'ANFI-000200',
    job_reference: 'ANFI-000200',
    quote_number: 'ANFI-000200',
    quote_id: 'q1',
    status_history: [{ id: 'h0', status_key: 'need-proof', changed_at: '2026-07-01T00:00:00.000Z' }],
    production_updates: [],
    tracking_info: {},
    design_approval_at: null,
    production_start_at: null,
    production_complete_at: null,
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  supaUpdates.length = 0
  trackerRow.current = baseTracker()
  delete process.env.MONDAY_WEBHOOK_SECRET
  hasEmailBeenSent.mockResolvedValue(false)
})

describe('tracker-status route — customer-facing transition', () => {
  it('writes status + history + milestone and emails ONCE', async () => {
    const res = await post(statusEvent())
    expect(res.status).toBe(200)
    expect(supaUpdates).toHaveLength(1)
    const patch = supaUpdates[0].set
    expect(patch.status).toBe('in-production')
    expect(Array.isArray(patch.status_history) && (patch.status_history as unknown[]).length).toBe(2)
    expect(patch.production_start_at).toBe('2026-07-20T01:00:00.000Z') // stamped from trigger time

    await flushAfter()
    expect(sendTrackerStatusEmail).toHaveBeenCalledTimes(1)
    expect(sendTrackerStatusEmail.mock.calls[0][0]).toMatchObject({
      contactEmail: 'jamie@theprint-room.co.nz',
      newStatus: 'in-production',
    })
    expect(recordEmailSend).toHaveBeenCalledTimes(1)
    expect(markWebhookLog).toHaveBeenCalledWith(expect.anything(), 'log-1', expect.objectContaining({ status: 'processed' }))
  })

  it('records the status_history changed_at from the Monday trigger time', async () => {
    await post(statusEvent())
    const patch = supaUpdates[0].set
    const hist = patch.status_history as Array<{ changed_at: string; status_key: string }>
    expect(hist[1].status_key).toBe('in-production')
    expect(hist[1].changed_at).toBe('2026-07-20T01:00:00.000Z')
  })
})

describe('tracker-status route — non-advancing statuses', () => {
  it('internal (Lost Job) → no write, no email, noop log', async () => {
    const res = await post(statusEvent({ value: { label: { index: 158, text: 'Lost Job' } } }))
    expect(res.status).toBe(200)
    expect(supaUpdates).toHaveLength(0)
    await flushAfter()
    expect(sendTrackerStatusEmail).not.toHaveBeenCalled()
    expect(markWebhookLog).toHaveBeenCalledWith(expect.anything(), 'log-1', expect.objectContaining({ status: 'noop' }))
  })

  it('hold (Job on Hold) → no write, no email, preserved', async () => {
    await post(statusEvent({ value: { label: { index: 109, text: 'Job on Hold' } } }))
    expect(supaUpdates).toHaveLength(0)
    await flushAfter()
    expect(sendTrackerStatusEmail).not.toHaveBeenCalled()
  })

  it('unknown label → no write, no email', async () => {
    await post(statusEvent({ value: { label: { index: 99, text: 'Totally Unknown' } } }))
    expect(supaUpdates).toHaveLength(0)
    await flushAfter()
    expect(sendTrackerStatusEmail).not.toHaveBeenCalled()
  })
})

describe('tracker-status route — idempotency (gap c)', () => {
  it('status unchanged (already in-production) → no write, no email', async () => {
    trackerRow.current = baseTracker({
      status: 'in-production',
      status_history: [{ id: 'h1', status_key: 'in-production', changed_at: '2026-07-19T00:00:00.000Z' }],
    })
    await post(statusEvent()) // Assign to Production -> in-production, already there
    expect(supaUpdates).toHaveLength(0)
    await flushAfter()
    expect(sendTrackerStatusEmail).not.toHaveBeenCalled()
    expect(markWebhookLog).toHaveBeenCalledWith(expect.anything(), 'log-1', expect.objectContaining({ status: 'noop' }))
  })
})

describe('tracker-status route — email de-dup', () => {
  it('same event redelivered (hasEmailBeenSent true) → no second email', async () => {
    trackerRow.current = baseTracker() // still need-proof, so it IS a transition
    hasEmailBeenSent.mockResolvedValue(true)
    await post(statusEvent())
    await flushAfter()
    expect(sendTrackerStatusEmail).not.toHaveBeenCalled()
    expect(supaUpdates).toHaveLength(1) // status still written; only the email is de-duped
  })

  it('genuine re-entry with a NEW trigger time → re-emails', async () => {
    // tracker at need-proof; Monday sends proof-sent with a fresh trigger time
    trackerRow.current = baseTracker({ status: 'need-proof' })
    hasEmailBeenSent.mockResolvedValue(false)
    await post(statusEvent({ value: { label: { index: 3, text: 'Sent: Proof+Invoice/Quote' } }, triggerTime: '2026-07-22T09:00:00.000Z' }))
    await flushAfter()
    expect(sendTrackerStatusEmail).toHaveBeenCalledTimes(1)
    expect(sendTrackerStatusEmail.mock.calls[0][0]).toMatchObject({ newStatus: 'proof-sent' })
  })
})

describe('tracker-status route — auth', () => {
  it('rejects a POST without the correct secret when MONDAY_WEBHOOK_SECRET is set', async () => {
    process.env.MONDAY_WEBHOOK_SECRET = 's3cret'
    const res = await post(statusEvent())
    expect(res.status).toBe(401)
  })

  it('processes when the secret matches', async () => {
    process.env.MONDAY_WEBHOOK_SECRET = 's3cret'
    const res = await post(statusEvent(), { secret: 's3cret' })
    expect(res.status).toBe(200)
    expect(supaUpdates).toHaveLength(1)
  })

  it('answers the challenge handshake before the secret check', async () => {
    process.env.MONDAY_WEBHOOK_SECRET = 's3cret'
    const res = await post(null, { challenge: 'abc123' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ challenge: 'abc123' })
  })
})

describe('tracker-status route — provisioning + token routing', () => {
  it('routes a Job Reference column event to provisioning', async () => {
    const res = await post(statusEvent({ columnId: JOB_REF_COL, columnType: 'text', value: { text: 'ANFI-000200' } }))
    expect(provisionTrackerForJobReferenceEvent).toHaveBeenCalledTimes(1)
    expect((await res.json()).action).toBe('created')
  })

  it('routes a tracker-token column event to the token handler', async () => {
    await post(statusEvent({ columnId: TRACKER_URL_COL, columnType: 'text', value: { text: 'https://portal.theprintroom.nz/order-tracker/WRONG-1' } }))
    expect(handleTrackerTokenEvent).toHaveBeenCalledTimes(1)
  })

  it('routes an item-create event to create-provisioning', async () => {
    await post({ type: 'create_pulse', boardId: 1992701981, pulseId: 777, pulseName: 'ANFI-000201' })
    expect(provisionTrackerForCreateEvent).toHaveBeenCalledTimes(1)
  })
})
