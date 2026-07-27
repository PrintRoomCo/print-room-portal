import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildAuditEntries,
  type AuditEntry,
  type InventoryEvent,
  type AuditResolvers,
} from '@/lib/inventory/audit'

const EVENT_LIMIT = 200

/**
 * Inventory audit feed for an organization. Shared by the server-rendered
 * Inventory page (initial paint) and /api/inventory/audit (client refresh) so
 * the two can never drift. Requires a service-role client; the caller is
 * responsible for having authorized the org as org_admin.
 *
 * Returns { entries } on success or { error } on the first failing query so the
 * route can surface a 500 while the page can fall back to an empty feed.
 */
export async function getInventoryAuditEntries(
  admin: SupabaseClient,
  organizationId: string,
): Promise<{ entries: AuditEntry[]; error?: string }> {
  const { data: eventRows, error: eventErr } = await admin
    .from('variant_inventory_events')
    .select(
      'id, variant_id, size_id, reason, delta_stock, delta_committed, note, reference_quote_item_id, staff_user_id, created_at',
    )
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(EVENT_LIMIT)
  if (eventErr) return { entries: [], error: eventErr.message }

  const rawEvents = (eventRows ?? []) as Array<Omit<InventoryEvent, 'size_label'>>
  // SKUCOLLAPSE: the event row carries size_id only; resolve labels from the
  // per-product sizes table so the audit feed can show which size moved.
  const sizeIds = Array.from(
    new Set(rawEvents.map((e) => e.size_id).filter((x): x is number => x != null)),
  )
  const sizeLabelById = new Map<number, string>()
  if (sizeIds.length > 0) {
    const { data: sizeRows } = await admin.from('sizes').select('id, label').in('id', sizeIds)
    for (const s of (sizeRows ?? []) as Array<{ id: number; label: string | null }>) {
      if (s.label) sizeLabelById.set(s.id, s.label)
    }
  }
  const events: InventoryEvent[] = rawEvents.map((e) => ({
    ...e,
    size_label: e.size_id != null ? sizeLabelById.get(e.size_id) ?? null : null,
  }))

  const refIds = Array.from(
    new Set(events.map((e) => e.reference_quote_item_id).filter((x): x is string => !!x)),
  )
  const quoteItemById: AuditResolvers['quoteItemById'] = new Map()
  const createdByByQuoteId: AuditResolvers['createdByByQuoteId'] = new Map()
  const nameByUserId: AuditResolvers['nameByUserId'] = new Map()
  const storeNameById: AuditResolvers['storeNameById'] = new Map()

  if (refIds.length > 0) {
    const { data: qiRows } = await admin
      .from('quote_items')
      .select('id, quote_id, ship_to_store_id')
      .in('id', refIds)
    for (const qi of (qiRows ?? []) as Array<{
      id: string
      quote_id: string
      ship_to_store_id: string | null
    }>) {
      quoteItemById.set(qi.id, { quote_id: qi.quote_id, ship_to_store_id: qi.ship_to_store_id })
    }
  }

  const quoteIds = Array.from(new Set(Array.from(quoteItemById.values()).map((v) => v.quote_id)))
  if (quoteIds.length > 0) {
    const { data: quoteRows } = await admin
      .from('quotes')
      .select('id, created_by')
      .in('id', quoteIds)
    for (const q of (quoteRows ?? []) as Array<{ id: string; created_by: string | null }>) {
      createdByByQuoteId.set(q.id, q.created_by)
    }
  }

  const userIds = Array.from(
    new Set(
      [...Array.from(createdByByQuoteId.values()), ...events.map((e) => e.staff_user_id)].filter(
        (x): x is string => !!x,
      ),
    ),
  )
  if (userIds.length > 0) {
    const { data: profileRows } = await admin
      .from('profiles')
      .select('id, full_name, email')
      .in('id', userIds)
    for (const p of (profileRows ?? []) as Array<{
      id: string
      full_name: string | null
      email: string | null
    }>) {
      nameByUserId.set(p.id, p.full_name || p.email || 'Unknown')
    }
  }

  const storeIds = Array.from(
    new Set(
      Array.from(quoteItemById.values())
        .map((v) => v.ship_to_store_id)
        .filter((x): x is string => !!x),
    ),
  )
  if (storeIds.length > 0) {
    const { data: storeRows } = await admin.from('stores').select('id, name').in('id', storeIds)
    for (const s of (storeRows ?? []) as Array<{ id: string; name: string }>) {
      storeNameById.set(s.id, s.name)
    }
  }

  const entries = buildAuditEntries(events, {
    quoteItemById,
    createdByByQuoteId,
    nameByUserId,
    storeNameById,
  })

  return { entries }
}
