import type { SupabaseClient } from '@supabase/supabase-js'
import type { B2BCustomerContext } from '@/lib/checkout/server'
import { pushProductionJob } from '@/lib/monday/production-job'
import { PRODUCTION_BOARD_ID } from '@/lib/monday/column-ids'

export interface CheckoutLineInput {
  product_id: string
  product_name: string
  variant_id?: string | null
  qty: number
  ship_to_store_id?: string | null
}

export interface CheckoutInput {
  context: B2BCustomerContext
  idempotency_key: string
  required_by?: string | null
  notes?: string | null
  internal_notes?: string | null
  lines: CheckoutLineInput[]
  custom_shipping_address?: Record<string, unknown> | null
}

export interface CheckoutResult {
  order_id: string
  order_ref: string
  monday_item_id: string | null
  monday_push_error: string | null
}

interface SubmitB2BOrderRow {
  quote_id: string
  order_id: string
  order_ref: string
}

interface StoreRow {
  id: string
  name: string | null
  address: string | null
  city: string | null
  state: string | null
  country: string | null
  postal_code: string | null
}

interface QuoteItemRow {
  id: string
  product_id: string
  variant_id: string | null
}

interface QuoteRowForMonday {
  order_ref: string
  customer_name: string
  customer_email: string | null
  total_amount: number
  required_by: string | null
  payment_terms: string | null
  notes: string | null
  monday_item_id: string | null
}

interface QuoteItemForMonday {
  id: string
  product_name: string
  quantity: number
  unit_price: number
  monday_subitem_id: string | null
  product_variants:
    | {
        product_color_swatches: { label: string | null } | { label: string | null }[] | null
        sizes: { label: string | null } | { label: string | null }[] | null
      }
    | null
}

function pickOne<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? v[0] ?? null : v
}

// b2b_accounts.payment_terms CHECK constraint allows only 'prepay' | 'net20' | 'net30'.
// Plan default was 'net_20' which fails; use 'net20' instead.
const PAYMENT_TERMS_FALLBACK = 'net20'

export async function submitCustomerOrder(
  admin: SupabaseClient,
  input: CheckoutInput
): Promise<CheckoutResult> {
  // 1. Resolve shipping_address — either the custom JSON or the first line's store.
  let shippingAddress: Record<string, unknown> = input.custom_shipping_address ?? {}
  if (!input.custom_shipping_address && input.lines[0]?.ship_to_store_id) {
    const { data: firstStore } = await admin
      .from('stores')
      .select('id, name, address, city, state, country, postal_code')
      .eq('id', input.lines[0].ship_to_store_id)
      .single()
    if (firstStore) shippingAddress = firstStore as unknown as Record<string, unknown>
  }

  // 2. Re-price every line on the server — ignore any client-sent prices.
  const repriced = await Promise.all(
    input.lines.map(async (l) => {
      const { data: unit } = await admin.rpc('get_unit_price', {
        p_product_id: l.product_id,
        p_org_id: input.context.organizationId,
        p_qty: l.qty,
      })
      return { ...l, unit_price: Number(unit ?? 0) }
    })
  )

  // 3. Call the shared submit_b2b_order RPC.
  const { data, error } = await admin.rpc('submit_b2b_order', {
    p_idempotency_key: input.idempotency_key,
    p_organization_id: input.context.organizationId,
    p_customer_code: input.context.customerCode!,
    p_customer_name: input.context.organizationName,
    p_customer_email: input.context.email,
    p_customer_phone: null,
    p_shipping_address: shippingAddress,
    p_payment_terms: input.context.paymentTerms ?? PAYMENT_TERMS_FALLBACK,
    p_required_by: input.required_by ?? null,
    p_notes: input.notes ?? null,
    p_internal_notes: input.internal_notes ?? null,
    p_lines: repriced.map((l) => ({
      product_id: l.product_id,
      product_name: l.product_name,
      quantity: l.qty,
      unit_price: l.unit_price,
      variant_id: l.variant_id ?? null,
    })),
  })
  if (error) throw new Error(error.message)

  const rowRaw = Array.isArray(data) ? data[0] : data
  const row = rowRaw as SubmitB2BOrderRow | null
  if (!row) throw new Error('submit_b2b_order returned no row')
  const { quote_id, order_id, order_ref } = row

  // 4. Apply per-line ship_to_store_id. The RPC creates quote_items without
  //    ship-to; we set it here so split-ship orders record the right store per line.
  const { data: newLines } = await admin
    .from('quote_items')
    .select('id, product_id, variant_id')
    .eq('quote_id', quote_id)
  if (newLines) {
    const rows = newLines as QuoteItemRow[]
    for (const inLine of input.lines) {
      const match = rows.find(
        (x) =>
          x.product_id === inLine.product_id &&
          (x.variant_id ?? null) === (inLine.variant_id ?? null)
      )
      if (match && inLine.ship_to_store_id !== undefined) {
        await admin
          .from('quote_items')
          .update({ ship_to_store_id: inLine.ship_to_store_id ?? null })
          .eq('id', match.id)
      }
    }
  }

  // 5. Monday push. Failure here doesn't roll back the order — staff can
  //    reconcile via the staff portal. monday_push_error surfaces on the
  //    confirmation page so the customer knows not to panic.
  let monday_item_id: string | null = null
  let monday_push_error: string | null = null
  try {
    const { data: q } = await admin
      .from('quotes')
      .select(
        'order_ref, customer_name, customer_email, total_amount, required_by, payment_terms, notes, monday_item_id'
      )
      .eq('id', quote_id)
      .single()
    const quote = q as QuoteRowForMonday | null
    if (!quote) throw new Error('quote row missing after submit_b2b_order')

    const { data: lines } = await admin
      .from('quote_items')
      .select(
        `id, product_name, quantity, unit_price, monday_subitem_id,
         product_variants (
           product_color_swatches (label),
           sizes (label)
         )`
      )
      .eq('quote_id', quote_id)
    const lineRows = (lines ?? []) as unknown as QuoteItemForMonday[]

    const order = {
      order_ref: quote.order_ref,
      customer_name: quote.customer_name,
      customer_email: quote.customer_email,
      total_price: Number(quote.total_amount),
      required_by: quote.required_by,
      payment_terms: quote.payment_terms,
      notes: quote.notes,
      monday_item_id: quote.monday_item_id,
    }
    const pLines = lineRows.map((l) => {
      const swatch = pickOne(l.product_variants?.product_color_swatches ?? null)
      const size = pickOne(l.product_variants?.sizes ?? null)
      const variantLabel = [swatch?.label, size?.label].filter(Boolean).join(' / ') || '—'
      return {
        quote_item_id: l.id,
        product_name: l.product_name,
        variant_label: variantLabel,
        quantity: l.quantity,
        unit_price: Number(l.unit_price),
        decoration_summary: null,
        existing_subitem_id: l.monday_subitem_id,
      }
    })

    const result = await pushProductionJob(order, pLines)
    monday_item_id = result.itemId
    await admin
      .from('quotes')
      .update({
        monday_item_id: result.itemId,
        monday_board_id: String(PRODUCTION_BOARD_ID),
      })
      .eq('id', quote_id)
    for (const [qItemId, subitemId] of Object.entries(result.subitemIds)) {
      await admin.from('quote_items').update({ monday_subitem_id: subitemId }).eq('id', qItemId)
    }
  } catch (e) {
    monday_push_error = (e as Error).message
  }

  return { order_id, order_ref, monday_item_id, monday_push_error }
}
