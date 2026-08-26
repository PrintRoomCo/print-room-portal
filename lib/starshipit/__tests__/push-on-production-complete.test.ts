import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('../push-order', () => ({ pushOrderToStarshipit: vi.fn() }))
vi.mock('@/lib/audit/recordEvent', () => ({ recordAuditEvent: vi.fn().mockResolvedValue(undefined) }))

import { pushOrderOnProductionComplete } from '../push-on-production-complete'
import { pushOrderToStarshipit } from '../push-order'
import { recordAuditEvent } from '@/lib/audit/recordEvent'

const pushMock = pushOrderToStarshipit as unknown as ReturnType<typeof vi.fn>
const auditMock = recordAuditEvent as unknown as ReturnType<typeof vi.fn>

const ORDER = {
  id: 'o1',
  status: 'in-production',
  intent: 'customer',
  order_type: 'purchase_order',
  shipping_address: { name: 'AF', street: '12 Example St', city: 'Auckland' },
}
const QUOTE = {
  order_ref: 'PR-1001',
  customer_email: 'jamie@theprint-room.co.nz',
  organization_id: 'org1',
  shipping_address: { name: 'Quote Addr', street: '9 Quote St', city: 'Wellington' },
  bill_country: 'NZ',
}
const ORG = { is_test: false }

/** Table-aware stub: maybeSingle resolves per-table fixtures. */
function makeAdmin(tables: Record<string, unknown>) {
  const fromSpy = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'order', 'limit']) {
      builder[m] = vi.fn(() => builder)
    }
    builder.maybeSingle = vi.fn(() =>
      Promise.resolve({ data: tables[table] ?? null, error: null }),
    )
    return builder
  })
  return { admin: { from: fromSpy } as unknown as SupabaseClient, fromSpy }
}

const LABEL = 'All Production Complete'

describe('pushOrderOnProductionComplete', () => {
  beforeEach(() => {
    process.env.STARSHIPIT_ENABLED = 'true'
    pushMock.mockResolvedValue({ status: 'pushed', reason: 'ok', starshipitOrderId: '1' })
  })
  afterEach(() => {
    vi.clearAllMocks()
    delete process.env.STARSHIPIT_ENABLED
  })

  it('no-ops (no DB reads) while the flag is off', async () => {
    process.env.STARSHIPIT_ENABLED = ''
    const { admin, fromSpy } = makeAdmin({})
    await pushOrderOnProductionComplete(admin, { quoteId: 'q1', displayLabel: LABEL })
    expect(fromSpy).not.toHaveBeenCalled()
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('no-ops for non-trigger labels', async () => {
    const { admin, fromSpy } = makeAdmin({})
    await pushOrderOnProductionComplete(admin, { quoteId: 'q1', displayLabel: 'Shipped' })
    expect(fromSpy).not.toHaveBeenCalled()
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('resolves order+quote+org and pushes with the production_complete trigger', async () => {
    const { admin } = makeAdmin({ orders: ORDER, quotes: QUOTE, organizations: ORG })
    await pushOrderOnProductionComplete(admin, { quoteId: 'q1', displayLabel: LABEL })
    expect(pushMock).toHaveBeenCalledWith(admin, {
      orderId: 'o1',
      orderRef: 'PR-1001',
      quoteId: 'q1',
      organizationId: 'org1',
      actorUserId: null,
      trigger: 'production_complete',
      intent: 'customer',
      isTestOrg: false,
      billCountry: 'NZ',
      isStockOnHand: false,
      customerEmail: 'jamie@theprint-room.co.nz',
      shippingAddress: ORDER.shipping_address,
    })
  })

  it('threads the stamped AU bill country through to the push args', async () => {
    const { admin, fromSpy } = makeAdmin({
      orders: ORDER, quotes: { ...QUOTE, bill_country: 'AU' }, organizations: ORG,
    })
    await pushOrderOnProductionComplete(admin, { quoteId: 'q1', displayLabel: LABEL })
    expect(pushMock.mock.calls[0][1].billCountry).toBe('AU')
    expect(fromSpy).not.toHaveBeenCalledWith('organization_countries')
  })

  // Historical pre-SP3 quotes carry no stamp; the bridge resolves the org's
  // default country row — never organizations.region.
  it('resolves a historical null stamp from the org default country row', async () => {
    const { admin } = makeAdmin({
      orders: ORDER,
      quotes: { ...QUOTE, bill_country: null },
      organizations: ORG,
      organization_countries: { country_code: 'AU' },
    })
    await pushOrderOnProductionComplete(admin, { quoteId: 'q1', displayLabel: LABEL })
    expect(pushMock.mock.calls[0][1].billCountry).toBe('AU')
  })

  it('falls back to the quote shipping address when the order has none', async () => {
    const { admin } = makeAdmin({
      orders: { ...ORDER, shipping_address: null }, quotes: QUOTE, organizations: ORG,
    })
    await pushOrderOnProductionComplete(admin, { quoteId: 'q1', displayLabel: LABEL })
    expect(pushMock.mock.calls[0][1].shippingAddress).toEqual(QUOTE.shipping_address)
  })

  it('no-ops when the quote has no orders row (quote-form job, not ours)', async () => {
    const { admin } = makeAdmin({ orders: null, quotes: QUOTE, organizations: ORG })
    await pushOrderOnProductionComplete(admin, { quoteId: 'q1', displayLabel: LABEL })
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('no-ops for a cancelled order', async () => {
    const { admin } = makeAdmin({
      orders: { ...ORDER, status: 'cancelled' }, quotes: QUOTE, organizations: ORG,
    })
    await pushOrderOnProductionComplete(admin, { quoteId: 'q1', displayLabel: LABEL })
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('audits ORDER_STARSHIPIT_SKIPPED when the push skips', async () => {
    pushMock.mockResolvedValue({ status: 'skipped', reason: 'already_pushed' })
    const { admin } = makeAdmin({ orders: ORDER, quotes: QUOTE, organizations: ORG })
    await pushOrderOnProductionComplete(admin, { quoteId: 'q1', displayLabel: LABEL })
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'order.starshipit_skipped',
        metadata: expect.objectContaining({ reason: 'already_pushed', trigger: 'production_complete' }),
      }),
      admin,
    )
  })

  it('audits ORDER_STARSHIPIT_PUSH_FAILED and does NOT throw when the push throws', async () => {
    pushMock.mockRejectedValue(new Error('starshipit 500'))
    const { admin } = makeAdmin({ orders: ORDER, quotes: QUOTE, organizations: ORG })
    await expect(
      pushOrderOnProductionComplete(admin, { quoteId: 'q1', displayLabel: LABEL }),
    ).resolves.toBeUndefined()
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'order.starshipit_push_failed',
        metadata: expect.objectContaining({ error: 'starshipit 500' }),
      }),
      admin,
    )
  })
})
