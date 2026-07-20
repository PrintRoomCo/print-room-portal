// Portal-side SHELL creator for job_trackers — used by checkout submit step 4c
// to materialise a tracker the moment a B2B customer places an order, before
// the Monday push runs. monday_item_id starts NULL; step 5a stamps it once
// pushOrderDeal returns. Monday-driven status updates flow back into
// status_history via the existing job_tracker_webhook_logs path (untouched).
//
// quote_data is populated from quote_items at submit time so /order-tracker
// renders the same line breakdown the confirmation page shows. The legacy
// QuoteData / QuoteDataItem shape from lib/job-tracker.ts is reused so the
// existing JobTrackerOrderCard + ProjectLineItem render without changes.
//
// Idempotency: app-level find-by-quote_id then update-or-insert. The table's
// job_reference UNIQUE constraint catches duplicate submits at the DB layer
// since order_ref is unique per submit.

import type { SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import type { QuoteData, QuoteDataItem } from '@/lib/job-tracker'
import { normalizeShippingAddress } from '@/lib/checkout/shipping-address'
import { deriveStatusValue } from '@/lib/monday/tracker-status-engine'

// Gap b (issue #77): the shell is created in submit step 4c, BEFORE the Monday
// push (step 5a), so there is no Monday item to read yet. Monday creates the
// production-board item at "Need: Mockup (Quote Approved)" — seed the tracker at
// the SAME stage the engine derives from that label so a fresh order is not born
// one stage ahead of Monday. Falls back to the literal key if the mapping moves.
export const CHECKOUT_SEED_STATUS =
  deriveStatusValue('Need: Mockup (Quote Approved)').canonical ?? 'quote-accepted-mockup'

export interface CreateJobTrackerShellArgs {
  quoteId: string
  orderRef: string
  organizationId: string
  userId: string
  customerEmail: string | null
  customerName: string | null
  requiredBy: string | null
  shippingAddress?: Record<string, unknown> | null
}

interface QuoteRow {
  subtotal: number | null
  decoration_cost: number | null
  total_amount: number | null
}

interface QuoteItemRow {
  id: string
  product_id: string | null
  product_name: string | null
  quantity: number | null
  unit_price: number | null
  decorations: unknown
  product_variants:
    | {
        product_color_swatches:
          | { label: string | null; hex: string | null }
          | { label: string | null; hex: string | null }[]
          | null
        sizes: { label: string | null } | { label: string | null }[] | null
      }
    | null
}

function pickOne<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

interface DecorationLogo {
  imageUrl: string | undefined
  printMethod: string | undefined
}

function decorationsToLogos(value: unknown): DecorationLogo[] {
  if (!Array.isArray(value)) return []
  return value
    .map((raw): DecorationLogo | null => {
      if (!raw || typeof raw !== 'object') return null
      const r = raw as Record<string, unknown>
      const imageUrl =
        typeof r.artworkUrl === 'string'
          ? r.artworkUrl
          : typeof r.snapshotUrl === 'string'
            ? r.snapshotUrl
            : undefined
      const printMethod = typeof r.method === 'string' ? r.method : undefined
      if (!imageUrl && !printMethod) return null
      return { imageUrl, printMethod }
    })
    .filter((x): x is DecorationLogo => x !== null)
}

export async function createJobTrackerShellForOrder(
  admin: SupabaseClient,
  args: CreateJobTrackerShellArgs,
): Promise<{ trackerId: string; trackerToken: string }> {
  const [b2bAccountRes, quoteRes, itemsRes, existingRes] = await Promise.all([
    admin
      .from('b2b_accounts')
      .select('company_id')
      .eq('organization_id', args.organizationId)
      .maybeSingle(),
    admin
      .from('quotes')
      .select('subtotal, decoration_cost, total_amount')
      .eq('id', args.quoteId)
      .maybeSingle(),
    admin
      .from('quote_items')
      .select(
        `id, product_id, product_name, quantity, unit_price, decorations,
         product_variants (
           product_color_swatches (label, hex),
           sizes (label)
         )`,
      )
      .eq('quote_id', args.quoteId),
    admin
      .from('job_trackers')
      .select('id, tracker_token')
      .eq('quote_id', args.quoteId)
      .maybeSingle(),
  ])

  if (existingRes.error) {
    throw new Error(
      `Existing job tracker lookup failed: ${existingRes.error.message}`,
    )
  }

  const quote = (quoteRes.data as QuoteRow | null) ?? null
  const itemRows = (itemsRes.data ?? []) as unknown as QuoteItemRow[]

  // Master product images for product_id values (legacy text column on
  // quote_items; PostgREST can't auto-embed). Mirrors the confirmation page.
  const productIds = Array.from(
    new Set(
      itemRows
        .map((r) => r.product_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  )
  const productImageById = new Map<string, string | null>()
  if (productIds.length > 0) {
    const { data: rows } = await admin
      .from('products')
      .select('id, image_url')
      .in('id', productIds)
    for (const row of (rows ?? []) as Array<{
      id: string
      image_url: string | null
    }>) {
      productImageById.set(row.id, row.image_url)
    }
  }

  const trackerToken = existingRes.data?.tracker_token || randomUUID()
  const nowIso = new Date().toISOString()
  const customerEmail = args.customerEmail?.toLowerCase() ?? null

  const items: QuoteDataItem[] = itemRows.map((row) => {
    const swatch = pickOne(row.product_variants?.product_color_swatches ?? null)
    const size = pickOne(row.product_variants?.sizes ?? null)
    const quantity = Number(row.quantity ?? 0)
    return {
      productId: row.product_id ?? undefined,
      productName: row.product_name ?? 'Item',
      quantity,
      // sizes is a Record<string, number>; populate when we have a size label
      // so ProjectLineItem renders the size:qty chip. Absent for variantless
      // lines — the card falls back to total quantity.
      sizes:
        size?.label && quantity > 0 ? { [size.label]: quantity } : undefined,
      subtotal: quantity * Number(row.unit_price ?? 0),
      customizations: {
        colors: swatch?.label
          ? {
              garment: {
                name: swatch.label,
                hex: swatch.hex ?? '',
              },
            }
          : undefined,
        logos: decorationsToLogos(row.decorations),
      },
    }
  })

  const productImages = Array.from(
    new Set(
      itemRows
        .map((r) => (r.product_id ? productImageById.get(r.product_id) : null))
        .filter((url): url is string => typeof url === 'string' && url.length > 0),
    ),
  )

  const subtotal = Number(quote?.subtotal ?? 0)
  const decorationCost = Number(quote?.decoration_cost ?? 0)
  const totalAmount = Number(quote?.total_amount ?? 0)
  const shippingAddress = normalizeShippingAddress(args.shippingAddress)

  const quoteData: QuoteData = {
    items,
    summary: {
      subtotal,
      total: totalAmount,
      artworkTotal: decorationCost,
    },
    customerName: args.customerName ?? undefined,
    shippingAddress: shippingAddress ?? undefined,
    subtotal,
    currencyCode: 'NZD',
  }

  const row = {
    tracker_token: trackerToken,
    job_reference: args.orderRef,
    monday_item_id: null,
    quote_id: args.quoteId,
    user_id: args.userId,
    quote_number: args.orderRef,
    customer_email: customerEmail,
    customer_name: args.customerName,
    company_id:
      (b2bAccountRes.data as { company_id: string | null } | null)?.company_id ??
      null,
    status: CHECKOUT_SEED_STATUS,
    tracking_info: {},
    status_history: [
      {
        id: randomUUID(),
        status: CHECKOUT_SEED_STATUS,
        status_key: CHECKOUT_SEED_STATUS,
        changed_at: nowIso,
      },
    ],
    production_updates: [
      {
        id: randomUUID(),
        type: 'milestone',
        title: 'Order received',
        body: 'Your order has been received. Our team is preparing your mockup.',
        changed_at: nowIso,
        source: 'system',
      },
    ],
    estimated_delivery_at: args.requiredBy,
    proof_files: null,
    product_images: productImages,
    quote_data: quoteData,
    quote_data_source: 'submit-quote',
    platform: 'b2b-portal',
    last_synced_at: nowIso,
  }

  if (existingRes.data?.id) {
    const { data, error } = await admin
      .from('job_trackers')
      .update(row)
      .eq('id', existingRes.data.id)
      .select('id')
      .single()
    if (error || !data) {
      throw new Error(
        `Job tracker update failed: ${error?.message || 'no tracker returned'}`,
      )
    }
    return {
      trackerId: String((data as { id: string | number }).id),
      trackerToken,
    }
  }

  const { data, error } = await admin
    .from('job_trackers')
    .insert(row)
    .select('id')
    .single()
  if (error || !data) {
    throw new Error(
      `Job tracker create failed: ${error?.message || 'no tracker returned'}`,
    )
  }
  return {
    trackerId: String((data as { id: string | number }).id),
    trackerToken,
  }
}
