import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { applyStarshipitOrderShipment } from '../order-shipments'

type Row = Record<string, unknown>

/**
 * Fake service-role client mirroring the exact chains the module uses.
 * Lookup keys:
 *  - quotes:          quoteByRef[order_ref]
 *  - orders:          orderByQuoteId[quote_id] / orderById[id]
 *  - order_shipments: shipmentByKey[`${order_id}:${tracking_number}`] (two .eq filters)
 *                     shipmentByTracking[tracking_number]             (one .eq filter)
 * Deliberately has NO .or() and NO .upsert() — a regression to either crashes.
 */
function makeDb(opts: {
  quoteByRef?: Record<string, Row>
  orderByQuoteId?: Record<string, Row>
  orderById?: Record<string, Row>
  shipmentByKey?: Record<string, Row>
  shipmentByTracking?: Record<string, Row>
  insertError?: { message: string } | null
} = {}) {
  const inserts: Array<{ table: string; values: Row }> = []
  const updates: Array<{ table: string; values: Row; id: unknown }> = []
  const rpcs: Array<{ fn: string; args: Row }> = []

  function resolve(table: string, filters: Array<[string, unknown]>): Row | null {
    if (table === 'quotes') return opts.quoteByRef?.[String(filters[0][1])] ?? null
    if (table === 'orders') {
      const [column, value] = filters[0]
      if (column === 'quote_id') return opts.orderByQuoteId?.[String(value)] ?? null
      return opts.orderById?.[String(value)] ?? null
    }
    if (table === 'order_shipments') {
      if (filters.length === 2) {
        return opts.shipmentByKey?.[`${String(filters[0][1])}:${String(filters[1][1])}`] ?? null
      }
      return opts.shipmentByTracking?.[String(filters[0][1])] ?? null
    }
    return null
  }

  const supabase = {
    from(table: string) {
      return {
        select: () => {
          const filters: Array<[string, unknown]> = []
          const builder = {
            eq(column: string, value: unknown) {
              filters.push([column, value])
              return builder
            },
            limit() {
              return builder
            },
            maybeSingle() {
              return Promise.resolve({ data: resolve(table, filters), error: null })
            },
          }
          return builder
        },
        update: (values: Row) => ({
          eq: (_column: string, id: unknown) => {
            updates.push({ table, values, id })
            return Promise.resolve({ error: null })
          },
        }),
        insert: (values: Row) => {
          inserts.push({ table, values })
          return Promise.resolve({ error: opts.insertError ?? null })
        },
      }
    },
    rpc(fn: string, args: Row) {
      rpcs.push({ fn, args })
      return Promise.resolve({ data: null, error: null })
    },
  }
  return { supabase: supabase as unknown as SupabaseClient, inserts, updates, rpcs }
}

const MATCH = {
  quoteByRef: { 'PO-123': { id: 'q1' } },
  orderByQuoteId: { q1: { id: 'o1', fulfillment_status: 'unfulfilled' } },
}

describe('applyStarshipitOrderShipment', () => {
  it('inserts a parcel and latches fulfilled on the first Dispatched event', async () => {
    const db = makeDb(MATCH)
    const result = await applyStarshipitOrderShipment(db.supabase, {
      order_number: 'PO-123',
      tracking_number: 'TN1',
      tracking_status: 'Dispatched',
      carrier_name: 'NZ Post',
      carrier_service: 'Overnight',
      tracking_url: 'https://track.example/TN1',
      shipment_date: '2026-08-12T01:00:00Z',
    })
    expect(result).toMatchObject({ matchedOrderId: 'o1', parcelWritten: true, error: null })
    expect(db.inserts).toHaveLength(1)
    expect(db.inserts[0].table).toBe('order_shipments')
    expect(db.inserts[0].values).toMatchObject({
      order_id: 'o1',
      tracking_number: 'TN1',
      status: 'dispatched',
      source: 'starshipit',
      carrier_name: 'NZ Post',
      carrier_service: 'Overnight',
      tracking_url: 'https://track.example/TN1',
      shipped_at: '2026-08-12T01:00:00Z',
    })
    expect(db.updates).toContainEqual({
      table: 'orders',
      values: { fulfillment_status: 'fulfilled' },
      id: 'o1',
    })
    expect(db.rpcs).toEqual([
      { fn: 'recompute_order_fulfillment_status', args: { p_order_id: 'o1' } },
    ])
  })

  it('Printed maps to label_printed and does NOT latch or stamp shipped_at', async () => {
    const db = makeDb(MATCH)
    const result = await applyStarshipitOrderShipment(db.supabase, {
      order_number: 'PO-123',
      tracking_number: 'TN1',
      tracking_status: 'Printed',
    })
    expect(result.parcelWritten).toBe(true)
    expect(db.inserts[0].values).toMatchObject({ status: 'label_printed' })
    expect(db.inserts[0].values.shipped_at).toBeUndefined()
    expect(db.updates.filter((u) => u.table === 'orders')).toHaveLength(0)
    expect(db.rpcs).toHaveLength(1)
  })

  it('a second event for the same tracking number updates the row (no duplicate)', async () => {
    const db = makeDb({
      ...MATCH,
      orderByQuoteId: { q1: { id: 'o1', fulfillment_status: 'fulfilled' } },
      shipmentByKey: {
        'o1:TN1': { id: 's1', shipped_at: '2026-08-10T00:00:00Z', delivered_at: null },
      },
    })
    const result = await applyStarshipitOrderShipment(db.supabase, {
      order_number: 'PO-123',
      tracking_number: 'TN1',
      tracking_status: 'Delivered',
      last_updated_date: '2026-08-12T03:00:00Z',
    })
    expect(result.parcelWritten).toBe(true)
    expect(db.inserts).toHaveLength(0)
    const update = db.updates.find((u) => u.table === 'order_shipments')!
    expect(update.id).toBe('s1')
    expect(update.values).toMatchObject({
      status: 'delivered',
      delivered_at: '2026-08-12T03:00:00Z',
    })
    // First-transition stamp: shipped_at already set, never overwritten.
    expect(update.values.shipped_at).toBeUndefined()
  })

  it('recovers the order from an existing parcel row when order_number is missing', async () => {
    const db = makeDb({
      orderById: { o1: { id: 'o1', fulfillment_status: 'fulfilled' } },
      shipmentByTracking: {
        TN1: { id: 's1', order_id: 'o1', shipped_at: '2026-08-10T00:00:00Z', delivered_at: null },
      },
    })
    const result = await applyStarshipitOrderShipment(db.supabase, {
      tracking_number: 'TN1',
      tracking_status: 'InTransit',
    })
    expect(result.matchedOrderId).toBe('o1')
    const update = db.updates.find((u) => u.table === 'order_shipments')!
    expect(update.values).toMatchObject({ status: 'in_transit' })
  })

  it('no order match → skip, nothing written, no recompute', async () => {
    const db = makeDb()
    const result = await applyStarshipitOrderShipment(db.supabase, {
      order_number: 'UNKNOWN',
      tracking_number: 'TN1',
      tracking_status: 'Dispatched',
    })
    expect(result).toEqual({
      matchedOrderId: null,
      parcelWritten: false,
      skipReason: 'no_order_match',
      error: null,
    })
    expect(db.inserts).toHaveLength(0)
    expect(db.updates).toHaveLength(0)
    expect(db.rpcs).toHaveLength(0)
  })

  it('missing tracking number → skip (upsert key requires it)', async () => {
    const db = makeDb(MATCH)
    const result = await applyStarshipitOrderShipment(db.supabase, {
      order_number: 'PO-123',
      tracking_status: 'Dispatched',
    })
    expect(result).toMatchObject({ matchedOrderId: 'o1', parcelWritten: false, skipReason: 'no_tracking_number' })
    expect(db.inserts).toHaveLength(0)
    expect(db.rpcs).toHaveLength(0)
  })

  it('unknown tracking_status → skip, logged via skipReason', async () => {
    const db = makeDb(MATCH)
    const result = await applyStarshipitOrderShipment(db.supabase, {
      order_number: 'PO-123',
      tracking_number: 'TN1',
      tracking_status: 'SomethingNew',
    })
    expect(result).toMatchObject({ matchedOrderId: 'o1', parcelWritten: false, skipReason: 'unknown_status' })
    expect(db.inserts).toHaveLength(0)
    expect(db.rpcs).toHaveLength(0)
  })

  it('a cancelled order records the parcel but is never un-latched', async () => {
    const db = makeDb({
      ...MATCH,
      orderByQuoteId: { q1: { id: 'o1', fulfillment_status: 'cancelled' } },
    })
    const result = await applyStarshipitOrderShipment(db.supabase, {
      order_number: 'PO-123',
      tracking_number: 'TN1',
      tracking_status: 'Dispatched',
    })
    expect(result.parcelWritten).toBe(true)
    expect(db.updates.filter((u) => u.table === 'orders')).toHaveLength(0)
    // recompute still runs; the SQL preserves the cancelled latch.
    expect(db.rpcs).toHaveLength(1)
  })

  it('surfaces an insert failure in error without throwing', async () => {
    const db = makeDb({ ...MATCH, insertError: { message: 'duplicate key value' } })
    const result = await applyStarshipitOrderShipment(db.supabase, {
      order_number: 'PO-123',
      tracking_number: 'TN1',
      tracking_status: 'Dispatched',
    })
    expect(result).toMatchObject({ matchedOrderId: 'o1', parcelWritten: false, error: 'duplicate key value' })
  })
})
