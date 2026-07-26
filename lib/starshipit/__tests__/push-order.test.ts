import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../client', () => ({ createStarshipitOrder: vi.fn() }))
vi.mock('@/lib/audit/recordEvent', () => ({ recordAuditEvent: vi.fn().mockResolvedValue(undefined) }))

import { pushOrderToStarshipit } from '../push-order'
import { createStarshipitOrder } from '../client'

const admin = {} as never // recordEvent is mocked, so admin is never dereferenced

const baseArgs = {
  orderId: 'o1',
  orderRef: 'PR-1001',
  organizationId: 'org1',
  actorUserId: 'u1',
  intent: 'customer' as const,
  isTestOrg: false,
  isStockOnHand: true,
  customerEmail: 'jamie@theprint-room.co.nz',
  shippingAddress: { name: 'AF', street: '12 Example St', city: 'Auckland', postcode: '1023', country: 'New Zealand' },
}

describe('pushOrderToStarshipit', () => {
  beforeEach(() => { process.env.STARSHIPIT_ENABLED = 'true' })
  afterEach(() => { vi.clearAllMocks(); delete process.env.STARSHIPIT_ENABLED })

  it('skips (does not call the client) when the flag is off', async () => {
    process.env.STARSHIPIT_ENABLED = ''
    const r = await pushOrderToStarshipit(admin, baseArgs)
    expect(r).toEqual({ status: 'skipped', reason: 'disabled' })
    expect(createStarshipitOrder).not.toHaveBeenCalled()
  })

  it('skips inventory-intent orders', async () => {
    const r = await pushOrderToStarshipit(admin, { ...baseArgs, intent: 'inventory' })
    expect(r.status).toBe('skipped')
    expect(r.reason).toBe('inventory_intent')
  })

  it('skips a purchase-order (made-to-order) order without calling the client', async () => {
    const r = await pushOrderToStarshipit(admin, { ...baseArgs, isStockOnHand: false })
    expect(r).toEqual({ status: 'skipped', reason: 'not_stock_on_hand' })
    expect(createStarshipitOrder).not.toHaveBeenCalled()
  })

  it('pushes and returns the starshipit order id', async () => {
    ;(createStarshipitOrder as unknown as ReturnType<typeof vi.fn>).mockResolvedValue('987')
    const r = await pushOrderToStarshipit(admin, baseArgs)
    expect(r).toEqual({ status: 'pushed', reason: 'ok', starshipitOrderId: '987' })
  })

  it('throws when the client returns null (caller audits the failure)', async () => {
    ;(createStarshipitOrder as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    await expect(pushOrderToStarshipit(admin, baseArgs)).rejects.toThrow(/no order id/)
  })
})
