import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('../client', () => ({ mondayApiCall: vi.fn() }))
import { mondayApiCall } from '../client'
import { PRODUCTION_COLUMNS } from '../column-ids'
import {
  ensureTrackerForMondayItem,
  provisionTrackerForJobReferenceEvent,
  provisionTrackerForCreateEvent,
  handleTrackerTokenEvent,
} from '../tracker-provisioning'

const mockedMonday = vi.mocked(mondayApiCall)

/** Chainable Supabase stub tuned for the provisioning flow. */
function makeAdmin(config: {
  existingTracker?: Record<string, unknown> | null
  tokenConflict?: { id: string; monday_item_id: string } | null
} = {}) {
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = []
  const updates: Array<{ table: string; set: Record<string, unknown>; eq: Array<[string, unknown]> }> = []
  const admin = {
    from(table: string) {
      const filters: Array<[string, unknown]> = []
      let mode: 'select' | 'insert' | 'update' = 'select'
      let pendingSet: Record<string, unknown> = {}
      const b: Record<string, unknown> = {
        select: () => b,
        insert: (row: Record<string, unknown>) => {
          inserts.push({ table, row })
          return Promise.resolve({ error: null })
        },
        update: (row: Record<string, unknown>) => {
          mode = 'update'
          pendingSet = row
          return b
        },
        eq: (col: string, val: unknown) => {
          filters.push([col, val])
          if (mode === 'update') {
            updates.push({ table, set: pendingSet, eq: [...filters] })
            return Promise.resolve({ error: null })
          }
          return b
        },
        maybeSingle: () => {
          if (filters.some(([c]) => c === 'tracker_token')) {
            return Promise.resolve({ data: config.tokenConflict ?? null })
          }
          return Promise.resolve({ data: config.existingTracker ?? null })
        },
      }
      return b
    },
  } as unknown as SupabaseClient
  return { admin, inserts, updates }
}

/** A Monday item snapshot with the columns provisioning reads. */
function mondayItem(over: { status?: string; email?: string; jobRef?: string; publicLink?: string } = {}) {
  return {
    id: '555',
    name: over.jobRef ?? 'ANFI-000200',
    column_values: [
      { id: PRODUCTION_COLUMNS.mainStatus, text: over.status ?? '', value: null, type: 'color' },
      { id: PRODUCTION_COLUMNS.customerEmail, text: over.email ?? 'buyer@x.test', value: null, type: 'email' },
      { id: PRODUCTION_COLUMNS.poRef, text: over.jobRef ?? 'ANFI-000200', value: null, type: 'text' },
      { id: PRODUCTION_COLUMNS.trackerUrl, text: over.publicLink ?? '', value: null, type: 'text' },
    ],
  }
}

beforeEach(() => vi.resetAllMocks())

describe('provisionTrackerForJobReferenceEvent', () => {
  it('creates a tracker keyed on the job reference and writes the PORTAL link back', async () => {
    mockedMonday.mockImplementation((q: string) =>
      q.includes('change_simple_column_value')
        ? Promise.resolve({ change_simple_column_value: { id: 'm1' } })
        : Promise.resolve({ items: [mondayItem()] })
    )
    const { admin, inserts } = makeAdmin({ existingTracker: null, tokenConflict: null })

    const res = await provisionTrackerForJobReferenceEvent({
      admin,
      mondayItemId: '555',
      boardId: 1992701981,
      jobReference: 'ANFI-000200',
    })

    expect(res.statusCode).toBe(200)
    expect((res.body as { action: string }).action).toBe('created')
    expect(inserts).toHaveLength(1)
    const row = inserts[0].row
    expect(row.tracker_token).toBe('ANFI-000200')
    expect(row.job_reference).toBe('ANFI-000200')
    expect(row.monday_item_id).toBe('555')
    expect(row.status).toBe('quote-stage') // empty Monday status -> engine default

    // Portal link written back to the tracker-token column.
    const writeCall = mockedMonday.mock.calls.find(([q]) => (q as string).includes('change_simple_column_value'))
    expect(writeCall).toBeDefined()
    expect((writeCall?.[1] as { value: string }).value).toBe('https://portal.theprintroom.nz/order-tracker/ANFI-000200')
    expect((writeCall?.[1] as { columnId: string }).columnId).toBe(PRODUCTION_COLUMNS.trackerUrl)
  })

  it('seeds status from the Monday label via the engine when present', async () => {
    mockedMonday.mockImplementation((q: string) =>
      q.includes('change_simple_column_value')
        ? Promise.resolve({ change_simple_column_value: { id: 'm1' } })
        : Promise.resolve({ items: [mondayItem({ status: 'Assign to Production' })] })
    )
    const { admin, inserts } = makeAdmin({ existingTracker: null, tokenConflict: null })
    await provisionTrackerForJobReferenceEvent({ admin, mondayItemId: '555', boardId: 1992701981, jobReference: 'ANFI-000200' })
    expect(inserts[0].row.status).toBe('in-production')
  })

  it('skips (validation_failed) on an invalid job reference — no insert', async () => {
    mockedMonday.mockImplementation((q: string) => Promise.resolve({ items: [mondayItem({ jobRef: 'bad ref' })] }))
    const { admin, inserts } = makeAdmin({ existingTracker: null })
    const res = await provisionTrackerForJobReferenceEvent({ admin, mondayItemId: '555', boardId: 1992701981, jobReference: 'bad ref' })
    expect((res.body as { action: string }).action).toBe('validation_failed')
    expect(res.logStatus).toBe('noop')
    expect(inserts).toHaveLength(0)
  })

  it('re-points an existing token to a new monday_item_id (no duplicate insert)', async () => {
    mockedMonday.mockImplementation((q: string) =>
      q.includes('change_simple_column_value')
        ? Promise.resolve({ change_simple_column_value: { id: 'm1' } })
        : Promise.resolve({ items: [mondayItem()] })
    )
    const { admin, inserts, updates } = makeAdmin({
      existingTracker: null,
      tokenConflict: { id: 'trk-9', monday_item_id: '999' },
    })
    const res = await provisionTrackerForJobReferenceEvent({ admin, mondayItemId: '555', boardId: 1992701981, jobReference: 'ANFI-000200' })
    expect(inserts).toHaveLength(0)
    expect(updates.some((u) => (u.set as { monday_item_id?: string }).monday_item_id === '555')).toBe(true)
    expect((res.body as { action: string }).action).toBe('updated')
  })

  it('does NOT re-write the Monday link when it already holds the portal URL (loop guard)', async () => {
    mockedMonday.mockImplementation((q: string) =>
      q.includes('change_simple_column_value')
        ? Promise.resolve({ change_simple_column_value: { id: 'm1' } })
        : Promise.resolve({ items: [mondayItem({ publicLink: 'https://portal.theprintroom.nz/order-tracker/ANFI-000200' })] })
    )
    const { admin } = makeAdmin({ existingTracker: null, tokenConflict: null })
    await ensureTrackerForMondayItem({ admin, mondayItemId: '555', boardId: 1992701981, providedJobReference: 'ANFI-000200', writePublicLink: true, requireJobReference: true })
    const wrote = mockedMonday.mock.calls.some(([q]) => (q as string).includes('change_simple_column_value'))
    expect(wrote).toBe(false)
  })
})

describe('provisionTrackerForCreateEvent', () => {
  it('skips (no insert) when the created item has no valid job reference', async () => {
    mockedMonday.mockImplementation((_q: string) => Promise.resolve({ items: [mondayItem({ jobRef: '' })] }))
    const { admin, inserts } = makeAdmin({ existingTracker: null })
    const res = await provisionTrackerForCreateEvent({ admin, mondayItemId: '555', boardId: 1992701981 })
    expect((res.body as { applied: boolean }).applied).toBe(false)
    expect(res.logStatus).toBe('noop')
    expect(inserts).toHaveLength(0)
  })
})

describe('handleTrackerTokenEvent', () => {
  it('corrects a mismatched pasted tracker URL back to the real job reference', async () => {
    mockedMonday.mockImplementation((q: string) =>
      q.includes('change_simple_column_value')
        ? Promise.resolve({ change_simple_column_value: { id: 'm1' } })
        : Promise.resolve({ items: [mondayItem({ jobRef: 'ANFI-000200' })] })
    )
    const { admin } = makeAdmin()
    const res = await handleTrackerTokenEvent({
      admin,
      mondayItemId: '555',
      boardId: 1992701981,
      pastedValue: 'https://portal.theprintroom.nz/order-tracker/WRONG-99',
      tracker: { job_reference: 'ANFI-000200', tracker_token: 'ANFI-000200' },
    })
    expect(res.applied).toBe(true)
    expect(res.correctedTo).toBe('https://portal.theprintroom.nz/order-tracker/ANFI-000200')
    const wrote = mockedMonday.mock.calls.some(([q]) => (q as string).includes('change_simple_column_value'))
    expect(wrote).toBe(true)
  })

  it('is a no-op when the pasted value already matches the job reference', async () => {
    const { admin } = makeAdmin()
    const res = await handleTrackerTokenEvent({
      admin,
      mondayItemId: '555',
      boardId: 1992701981,
      pastedValue: 'https://portal.theprintroom.nz/order-tracker/ANFI-000200',
      tracker: { job_reference: 'ANFI-000200', tracker_token: 'ANFI-000200' },
    })
    expect(res.applied).toBe(false)
    expect(mockedMonday).not.toHaveBeenCalled()
  })
})
