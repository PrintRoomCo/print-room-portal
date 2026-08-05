import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('../client', () => ({ createStarshipitOrder: vi.fn() }))
vi.mock('../items', () => ({ loadStarshipitOrderItems: vi.fn().mockResolvedValue([]) }))
vi.mock('@/lib/audit/recordEvent', () => ({ recordAuditEvent: vi.fn().mockResolvedValue(undefined) }))

import { pushOrderToStarshipit } from '../push-order'
import { createStarshipitOrder } from '../client'
import { loadStarshipitOrderItems } from '../items'

const createMock = createStarshipitOrder as unknown as ReturnType<typeof vi.fn>
const itemsMock = loadStarshipitOrderItems as unknown as ReturnType<typeof vi.fn>

/** Table-aware admin stub: orders select -> {starshipit_pushed_at}, update recorded. */
function makeAdmin({ pushedAt = null as string | null } = {}) {
  const updates: Array<{ table: string; set: Record<string, unknown>; id: unknown }> = []
  const fromSpy = vi.fn((table: string) => ({
    select: () => ({
      eq: () => ({
        maybeSingle: () =>
          Promise.resolve({ data: { starshipit_pushed_at: pushedAt }, error: null }),
      }),
    }),
    update: (set: Record<string, unknown>) => ({
      eq: (_col: string, id: unknown) => {
        updates.push({ table, set, id })
        return Promise.resolve({ error: null })
      },
    }),
  }))
  return { admin: { from: fromSpy } as unknown as SupabaseClient, fromSpy, updates }
}

const baseArgs = {
  orderId: 'o1',
  orderRef: 'PR-1001',
  quoteId: 'q1',
  organizationId: 'org1',
  actorUserId: 'u1',
  trigger: 'placement' as const,
  intent: 'customer' as const,
  isTestOrg: false,
  isStockOnHand: true,
  customerEmail: 'jamie@theprint-room.co.nz',
  shippingAddress: { name: 'AF', street: '12 Example St', city: 'Auckland', postcode: '1023', country: 'New Zealand' },
}

describe('pushOrderToStarshipit', () => {
  beforeEach(() => {
    process.env.STARSHIPIT_ENABLED = 'true'
    itemsMock.mockResolvedValue([])
  })
  afterEach(() => {
    vi.clearAllMocks()
    delete process.env.STARSHIPIT_ENABLED
  })

  it('skips before ANY db read when the flag is off (dark = column-free)', async () => {
    process.env.STARSHIPIT_ENABLED = ''
    const { admin, fromSpy } = makeAdmin()
    const r = await pushOrderToStarshipit(admin, baseArgs)
    expect(r).toEqual({ status: 'skipped', reason: 'disabled' })
    expect(fromSpy).not.toHaveBeenCalled()
    expect(createStarshipitOrder).not.toHaveBeenCalled()
  })

  it('skips an already-pushed order without calling the client', async () => {
    const { admin } = makeAdmin({ pushedAt: '2026-08-06T00:00:00Z' })
    const r = await pushOrderToStarshipit(admin, baseArgs)
    expect(r).toEqual({ status: 'skipped', reason: 'already_pushed' })
    expect(createStarshipitOrder).not.toHaveBeenCalled()
  })

  it('placement trigger skips a made-to-order order', async () => {
    const { admin } = makeAdmin()
    const r = await pushOrderToStarshipit(admin, { ...baseArgs, isStockOnHand: false })
    expect(r).toEqual({ status: 'skipped', reason: 'not_stock_on_hand' })
  })

  it('production_complete trigger pushes a made-to-order order', async () => {
    createMock.mockResolvedValue('987')
    const { admin } = makeAdmin()
    const r = await pushOrderToStarshipit(admin, {
      ...baseArgs, trigger: 'production_complete', isStockOnHand: false,
    })
    expect(r).toEqual({ status: 'pushed', reason: 'ok', starshipitOrderId: '987' })
  })

  it('loads items for the quote and passes them to the client', async () => {
    createMock.mockResolvedValue('987')
    itemsMock.mockResolvedValue([{ description: 'Tee — L', quantity: 2 }])
    const { admin } = makeAdmin()
    await pushOrderToStarshipit(admin, baseArgs)
    expect(loadStarshipitOrderItems).toHaveBeenCalledWith(admin, 'q1')
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ orderNumber: 'PR-1001', items: [{ description: 'Tee — L', quantity: 2 }] }),
    )
  })

  it('stamps starshipit_pushed_at + starshipit_order_id on success', async () => {
    createMock.mockResolvedValue('987')
    const { admin, updates } = makeAdmin()
    await pushOrderToStarshipit(admin, baseArgs)
    expect(updates).toHaveLength(1)
    expect(updates[0].table).toBe('orders')
    expect(updates[0].id).toBe('o1')
    expect(updates[0].set.starshipit_order_id).toBe('987')
    expect(typeof updates[0].set.starshipit_pushed_at).toBe('string')
  })

  it('throws when the client returns no id (caller audits the failure)', async () => {
    createMock.mockResolvedValue(null)
    const { admin, updates } = makeAdmin()
    await expect(pushOrderToStarshipit(admin, baseArgs)).rejects.toThrow(/no order id/)
    expect(updates).toHaveLength(0)
  })
})
