export interface InventoryEvent {
  id: string
  variant_id: string
  /** SKUCOLLAPSE: size of the colourway this event touched. size_label is
   *  resolved from size_id by the caller (not stored on the event row). */
  size_id: number | null
  size_label: string | null
  reason: string
  delta_stock: number
  delta_committed: number
  note: string | null
  reference_quote_item_id: string | null
  staff_user_id: string | null
  created_at: string
}

export interface AuditResolvers {
  /** reference_quote_item_id → its quote + ship-to store */
  quoteItemById: Map<string, { quote_id: string; ship_to_store_id: string | null }>
  /** quote_id → the user who placed the order (quotes.created_by) */
  createdByByQuoteId: Map<string, string | null>
  /** user id → display name (full_name ?? email) */
  nameByUserId: Map<string, string>
  /** store id → store name */
  storeNameById: Map<string, string>
}

export interface AuditEntry {
  id: string
  variantId: string
  sizeId: number | null
  sizeLabel: string | null
  reason: string
  deltaStock: number
  deltaCommitted: number
  note: string | null
  /** Resolved order placer, staff member, "Print Room", or "Unknown". */
  who: string
  /** Ship-to store name for order events; null otherwise. */
  where: string | null
  source: 'order' | 'staff'
  createdAt: string
}

// Order-driven reasons carry no staff_user_id; the human is the order placer,
// resolved through the quote. Everything else is a manual staff adjustment.
const ORDER_REASONS = new Set(['order_commit', 'pre_approved_inventory'])

export function buildAuditEntries(
  events: InventoryEvent[],
  r: AuditResolvers,
): AuditEntry[] {
  return events.map((e) => {
    const isOrder = ORDER_REASONS.has(e.reason)

    let who = 'Unknown'
    let where: string | null = null

    if (isOrder) {
      const qi = e.reference_quote_item_id
        ? r.quoteItemById.get(e.reference_quote_item_id)
        : undefined
      const createdBy = qi ? r.createdByByQuoteId.get(qi.quote_id) ?? null : null
      who = createdBy ? r.nameByUserId.get(createdBy) ?? 'Unknown' : 'Unknown'
      where = qi?.ship_to_store_id ? r.storeNameById.get(qi.ship_to_store_id) ?? null : null
    } else {
      who = e.staff_user_id ? r.nameByUserId.get(e.staff_user_id) ?? 'Print Room' : 'Print Room'
      where = null
    }

    return {
      id: e.id,
      variantId: e.variant_id,
      sizeId: e.size_id,
      sizeLabel: e.size_label,
      reason: e.reason,
      deltaStock: e.delta_stock,
      deltaCommitted: e.delta_committed,
      note: e.note,
      who,
      where,
      source: isOrder ? 'order' : 'staff',
      createdAt: e.created_at,
    }
  })
}
