import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('../client', () => ({ deleteStarshipitOrder: vi.fn() }))
vi.mock('@/lib/audit/recordEvent', () => ({ recordAuditEvent: vi.fn().mockResolvedValue(undefined) }))

import { deleteStarshipitOrderOnCancel } from '../delete-on-cancel'
import { deleteStarshipitOrder } from '../client'
import { recordAuditEvent } from '@/lib/audit/recordEvent'

const deleteMock = deleteStarshipitOrder as unknown as ReturnType<typeof vi.fn>
const auditMock = recordAuditEvent as unknown as ReturnType<typeof vi.fn>

function makeAdmin(orderRow: Record<string, unknown> | null) {
  const updates: Array<{ set: Record<string, unknown>; id: unknown }> = []
  const admin = {
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: orderRow, error: null }) }),
      }),
      update: (set: Record<string, unknown>) => ({
        eq: (_c: string, id: unknown) => {
          updates.push({ set, id })
          return Promise.resolve({ error: null })
        },
      }),
    })),
  }
  return { admin: admin as unknown as SupabaseClient, updates }
}

const ARGS = { orderId: 'o1', organizationId: 'org1' }
const PUSHED = { starshipit_pushed_at: '2026-08-06T00:00:00Z', starshipit_order_id: '987' }

describe('deleteStarshipitOrderOnCancel', () => {
  beforeEach(() => {
    process.env.STARSHIPIT_ENABLED = 'true'
    deleteMock.mockResolvedValue(true)
  })
  afterEach(() => {
    vi.clearAllMocks()
    delete process.env.STARSHIPIT_ENABLED
  })

  it('no-ops while the flag is off', async () => {
    process.env.STARSHIPIT_ENABLED = ''
    const { admin } = makeAdmin(PUSHED)
    await deleteStarshipitOrderOnCancel(admin, ARGS)
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('no-ops when the order was never pushed', async () => {
    const { admin } = makeAdmin({ starshipit_pushed_at: null, starshipit_order_id: null })
    await deleteStarshipitOrderOnCancel(admin, ARGS)
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('deletes, clears both columns, and audits ORDER_STARSHIPIT_DELETED', async () => {
    const { admin, updates } = makeAdmin(PUSHED)
    await deleteStarshipitOrderOnCancel(admin, ARGS)
    expect(deleteMock).toHaveBeenCalledWith('987')
    expect(updates).toEqual([
      { set: { starshipit_pushed_at: null, starshipit_order_id: null }, id: 'o1' },
    ])
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'order.starshipit_deleted', targetId: 'o1' }),
      admin,
    )
  })

  it('audits ORDER_STARSHIPIT_DELETE_FAILED and keeps the stamp when the API fails', async () => {
    deleteMock.mockResolvedValue(false)
    const { admin, updates } = makeAdmin(PUSHED)
    await deleteStarshipitOrderOnCancel(admin, ARGS)
    expect(updates).toHaveLength(0)
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'order.starshipit_delete_failed' }),
      admin,
    )
  })

  it('never throws (network error swallowed + logged)', async () => {
    deleteMock.mockRejectedValue(new Error('ECONNRESET'))
    const { admin } = makeAdmin(PUSHED)
    await expect(deleteStarshipitOrderOnCancel(admin, ARGS)).resolves.toBeUndefined()
  })
})
