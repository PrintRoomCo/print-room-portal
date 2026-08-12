// lib/starshipit/order-shipments.ts
// Staff-order extension of the Starshipit webhook (staff-portal spec
// 2026-08-12-order-detail-cleanup-and-starshipit-fulfillment-design.md §4).
// Matches the payload to a staff order, upserts the parcel into
// order_shipments, latches orders.fulfillment_status to 'fulfilled' on the
// first shipped event (spec D6 — the manual "Mark fully shipped" is gone),
// and recomputes the rollup via the canonical security-definer RPC.
//
// Injection rationale (same as the tracker match in the route): the payload is
// attacker-influencable, so ONLY sequential .eq() filters — never
// string-interpolated .or(); PostgREST filter grammar is not escaped on a
// service-role client.
//
// Select-then-write instead of .upsert(): the unique index on
// (order_id, tracking_number) is PARTIAL (where tracking_number is not null)
// and PostgREST's on_conflict cannot target a partial index. Events for one
// tracking number arrive sequentially, so the race window is negligible; a
// rare duplicate-key error surfaces in `error` (logged by the route) and the
// next event heals it.
import type { SupabaseClient } from '@supabase/supabase-js'
import { toParcelStatus, type ParcelStatus } from './status'
import type { StarshipitWebhookPayload } from './apply-webhook'

const SHIPPED_PARCEL_STATUSES: readonly ParcelStatus[] = [
  'dispatched',
  'in_transit',
  'out_for_delivery',
  'delivered',
]

export interface OrderShipmentResult {
  matchedOrderId: string | null
  parcelWritten: boolean
  skipReason: 'no_order_match' | 'no_tracking_number' | 'unknown_status' | null
  error: string | null
}

interface OrderRow {
  id: string
  fulfillment_status: string
}

interface ExistingParcel {
  id: string
  shipped_at: string | null
  delivered_at: string | null
}

export async function applyStarshipitOrderShipment(
  supabase: SupabaseClient,
  payload: StarshipitWebhookPayload,
): Promise<OrderShipmentResult> {
  // 1. order_number → quotes.order_ref → the order for that quote. Split-order
  //    refs (-C/-I suffixes) each have their own quote row, so exact match works.
  let order: OrderRow | null = null
  if (payload.order_number) {
    const { data: quote } = await supabase
      .from('quotes')
      .select('id')
      .eq('order_ref', payload.order_number)
      .limit(1)
      .maybeSingle()
    if (quote) {
      const { data } = await supabase
        .from('orders')
        .select('id, fulfillment_status')
        .eq('quote_id', quote.id)
        .limit(1)
        .maybeSingle()
      order = (data as OrderRow | null) ?? null
    }
  }

  // 2. Find the parcel row this event belongs to. When the order is unknown,
  //    fall back to a parcel we already hold for this tracking number — later
  //    Starshipit events can drop or change order_number.
  let existing: ExistingParcel | null = null
  if (order && payload.tracking_number) {
    const { data } = await supabase
      .from('order_shipments')
      .select('id, shipped_at, delivered_at')
      .eq('order_id', order.id)
      .eq('tracking_number', payload.tracking_number)
      .maybeSingle()
    existing = (data as ExistingParcel | null) ?? null
  } else if (!order && payload.tracking_number) {
    const { data } = await supabase
      .from('order_shipments')
      .select('id, order_id, shipped_at, delivered_at')
      .eq('tracking_number', payload.tracking_number)
      .limit(1)
      .maybeSingle()
    if (data) {
      existing = { id: data.id, shipped_at: data.shipped_at, delivered_at: data.delivered_at }
      const { data: orderData } = await supabase
        .from('orders')
        .select('id, fulfillment_status')
        .eq('id', data.order_id)
        .limit(1)
        .maybeSingle()
      order = (orderData as OrderRow | null) ?? null
    }
  }

  if (!order) {
    return { matchedOrderId: null, parcelWritten: false, skipReason: 'no_order_match', error: null }
  }
  if (!payload.tracking_number) {
    return { matchedOrderId: order.id, parcelWritten: false, skipReason: 'no_tracking_number', error: null }
  }
  const status = toParcelStatus(payload.tracking_status)
  if (!status) {
    return { matchedOrderId: order.id, parcelWritten: false, skipReason: 'unknown_status', error: null }
  }

  // 3. Build the write. Carrier/URL fields only when the event carries them —
  //    a sparse later event must not null out earlier data.
  const nowIso = new Date().toISOString()
  const write: Record<string, unknown> = {
    status,
    source: 'starshipit',
    starshipit_payload: payload,
  }
  if (payload.carrier_name) write.carrier_name = payload.carrier_name
  if (payload.carrier_service) write.carrier_service = payload.carrier_service
  if (payload.tracking_url) write.tracking_url = payload.tracking_url
  // First-transition stamps — never overwrite an existing one.
  if (SHIPPED_PARCEL_STATUSES.includes(status) && !existing?.shipped_at) {
    write.shipped_at = payload.shipment_date || nowIso
  }
  if (status === 'delivered' && !existing?.delivered_at) {
    write.delivered_at = payload.last_updated_date || nowIso
  }

  let error: string | null = null
  if (existing) {
    const { error: updateError } = await supabase
      .from('order_shipments')
      .update({ ...write, updated_at: nowIso })
      .eq('id', existing.id)
    error = updateError ? updateError.message : null
  } else {
    const { error: insertError } = await supabase
      .from('order_shipments')
      .insert({ ...write, order_id: order.id, tracking_number: payload.tracking_number })
    error = insertError ? insertError.message : null
  }
  if (error) {
    return { matchedOrderId: order.id, parcelWritten: false, skipReason: null, error }
  }

  // 4. Latch (spec D6): first shipped event stands in for the removed manual
  //    "Mark fully shipped". fulfilled/delivered/cancelled are left alone —
  //    the recompute preserves those latches.
  if (
    SHIPPED_PARCEL_STATUSES.includes(status) &&
    (order.fulfillment_status === 'unfulfilled' ||
      order.fulfillment_status === 'partially_fulfilled')
  ) {
    const { error: latchError } = await supabase
      .from('orders')
      .update({ fulfillment_status: 'fulfilled' })
      .eq('id', order.id)
    if (latchError) error = latchError.message
  }

  // 5. Canonical rollup writer (derives 'delivered', keeps latches).
  const { error: rpcError } = await supabase.rpc('recompute_order_fulfillment_status', {
    p_order_id: order.id,
  })
  if (rpcError) error = error ? `${error} | ${rpcError.message}` : rpcError.message

  return { matchedOrderId: order.id, parcelWritten: true, skipReason: null, error }
}
