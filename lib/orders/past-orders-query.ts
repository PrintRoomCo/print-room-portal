import type { SupabaseClient } from '@supabase/supabase-js'
import { billedFigures } from '@/lib/checkout/billed-figures'

export interface PastOrderTracking {
  carrier: string | null
  trackingNumber: string | null
  url: string | null
}

export interface PortalPastOrder {
  orderId: string
  quoteId: string | null
  orderRef: string | null
  quoteNumber: string | null
  reference: string | null
  status: string
  orderType: string
  customerName: string | null
  customerEmail: string | null
  customerCompany: string | null
  /** Ex-GST full GOODS value (quotes.subtotal) — "Product value" in the UI. */
  subtotal: number
  totalAmount: number
  currency: string
  pickingFee: number
  /** Ex-GST total invoiced, billedFigures().billedExGst (NULL billed_total ⇒ goods value). */
  billed: number
  createdAt: string
  tracking: PastOrderTracking | null
}

export interface PastOrderRow {
  id: string
  status: string | null
  order_type: string | null
  created_at: string | null
  quote_id: string | null
  quotes: {
    organization_id: string | null
    order_ref: string | null
    quote_number: string | null
    reference: string | null
    customer_name: string | null
    customer_email: string | null
    customer_company: string | null
    customer_code: string | null
    subtotal: number | null
    total_amount: number | null
    currency: string | null
    picking_fee: number | null
    billed_total: number | null
  } | null
}

export const PAST_ORDERS_SELECT = `id, status, order_type, created_at, quote_id,
   quotes!inner (
     organization_id, order_ref, quote_number, reference,
     customer_name, customer_email, customer_company, customer_code,
     subtotal, total_amount, currency, picking_fee, billed_total
   )`

export interface PastOrdersScope {
  organizationId: string
  /** true for org_admin (org-wide); false for staff (own orders only). */
  canSeeAllOrgOrders: boolean
  /** The requester's auth email — staff scoping keys on quotes.customer_email. */
  userEmail: string | null
}

/**
 * The ONE org/role scoping rule for the orders view — shared by the list
 * fetcher and the CSV export route so the two can never drift on who sees
 * what. Runs on the service-role client (RLS bypassed): this function IS the
 * security boundary.
 *
 * Staff scoping keys on quotes.customer_email, not quotes.created_by:
 * created_by is NULL on every ordered quote (checkout never stamps it). Email
 * is safe here because organization_id is constrained first — the Phase 1
 * prohibition on email is about cross-org tenancy, not own-orders scoping.
 * Staff with no auth email fail CLOSED.
 */
export async function queryPastOrders(
  adminClient: SupabaseClient,
  scope: PastOrdersScope,
): Promise<PastOrderRow[]> {
  if (!scope.canSeeAllOrgOrders && !scope.userEmail) return []

  let query = adminClient
    .from('orders')
    .select(PAST_ORDERS_SELECT)
    .eq('quotes.organization_id', scope.organizationId)

  if (!scope.canSeeAllOrgOrders) {
    query = query.eq('quotes.customer_email', scope.userEmail)
  }

  const { data, error } = await query.order('created_at', { ascending: false })
  if (error) {
    console.error('[PastOrders] query failed:', error)
    return []
  }
  return (data ?? []) as unknown as PastOrderRow[]
}

export function mapPastOrderRow(row: PastOrderRow): PortalPastOrder {
  const figures = billedFigures({
    goodsExGst: Number(row.quotes?.subtotal ?? 0),
    billedTotal: row.quotes?.billed_total,
    pickingFee: row.quotes?.picking_fee,
  })
  return {
    orderId: row.id,
    quoteId: row.quote_id,
    orderRef: row.quotes?.order_ref ?? null,
    quoteNumber: row.quotes?.quote_number ?? null,
    reference: row.quotes?.reference ?? null,
    status: row.status ?? 'awaiting-approval',
    orderType: row.order_type ?? 'purchase_order',
    customerName: row.quotes?.customer_name ?? null,
    customerEmail: row.quotes?.customer_email ?? null,
    customerCompany: row.quotes?.customer_company ?? null,
    subtotal: Number(row.quotes?.subtotal ?? 0),
    totalAmount: Number(row.quotes?.total_amount ?? 0),
    currency: row.quotes?.currency ?? 'NZD',
    pickingFee: figures.pickingFee,
    billed: figures.billedExGst,
    createdAt: row.created_at ?? new Date().toISOString(),
    tracking: null,
  }
}
