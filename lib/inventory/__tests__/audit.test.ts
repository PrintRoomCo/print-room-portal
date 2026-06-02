import { describe, it, expect } from 'vitest'
import {
  buildAuditEntries,
  type InventoryEvent,
  type AuditResolvers,
} from '../audit'

function resolvers(over: Partial<AuditResolvers> = {}): AuditResolvers {
  return {
    quoteItemById: over.quoteItemById ?? new Map(),
    createdByByQuoteId: over.createdByByQuoteId ?? new Map(),
    nameByUserId: over.nameByUserId ?? new Map(),
    storeNameById: over.storeNameById ?? new Map(),
  }
}

function event(over: Partial<InventoryEvent> = {}): InventoryEvent {
  return {
    id: over.id ?? 'e1',
    variant_id: over.variant_id ?? 'v1',
    reason: over.reason ?? 'order_commit',
    delta_stock: over.delta_stock ?? -5,
    delta_committed: over.delta_committed ?? 0,
    note: over.note ?? null,
    reference_quote_item_id: 'reference_quote_item_id' in over ? over.reference_quote_item_id! : 'qi-1',
    staff_user_id: 'staff_user_id' in over ? over.staff_user_id! : null,
    created_at: over.created_at ?? '2026-06-01T00:00:00Z',
  }
}

describe('buildAuditEntries', () => {
  it('resolves who (order placer) + where (ship-to store) for an order event', () => {
    const [entry] = buildAuditEntries(
      [event({ reason: 'order_commit', reference_quote_item_id: 'qi-1' })],
      resolvers({
        quoteItemById: new Map([['qi-1', { quote_id: 'q-1', ship_to_store_id: 's-1' }]]),
        createdByByQuoteId: new Map([['q-1', 'u-1']]),
        nameByUserId: new Map([['u-1', 'Jane Buyer']]),
        storeNameById: new Map([['s-1', 'Queen St Store']]),
      }),
    )
    expect(entry.source).toBe('order')
    expect(entry.who).toBe('Jane Buyer')
    expect(entry.where).toBe('Queen St Store')
  })

  it('labels manual staff events as Print Room with no ship-to', () => {
    const [entry] = buildAuditEntries(
      [event({ reason: 'intake', reference_quote_item_id: null, staff_user_id: null })],
      resolvers(),
    )
    expect(entry.source).toBe('staff')
    expect(entry.who).toBe('Print Room')
    expect(entry.where).toBeNull()
  })

  it('uses the staff member name when a manual event carries staff_user_id', () => {
    const [entry] = buildAuditEntries(
      [event({ reason: 'count_correction', reference_quote_item_id: null, staff_user_id: 'staff-9' })],
      resolvers({ nameByUserId: new Map([['staff-9', 'Sam Staff']]) }),
    )
    expect(entry.who).toBe('Sam Staff')
  })

  it('degrades gracefully when the order chain cannot resolve a person', () => {
    const [entry] = buildAuditEntries(
      [event({ reason: 'pre_approved_inventory', reference_quote_item_id: 'qi-x' })],
      resolvers(), // no maps populated
    )
    expect(entry.source).toBe('order')
    expect(entry.who).toBe('Unknown')
    expect(entry.where).toBeNull()
  })

  it('passes movement fields straight through', () => {
    const [entry] = buildAuditEntries(
      [event({ delta_stock: -3, delta_committed: 3, note: 'partial ship', reason: 'order_commit', reference_quote_item_id: null })],
      resolvers(),
    )
    expect(entry).toMatchObject({ deltaStock: -3, deltaCommitted: 3, note: 'partial ship', variantId: 'v1' })
  })
})
