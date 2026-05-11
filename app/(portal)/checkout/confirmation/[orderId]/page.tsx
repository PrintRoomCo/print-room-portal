import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireB2BCustomer } from '@/lib/checkout/server'
import { handleAuthFailure } from '@/lib/checkout/page-auth'
import { formatPrice } from '@/lib/format/price'

export const dynamic = 'force-dynamic'

const GST_RATE = 0.15

interface OrderRow {
  id: string
  status: string | null
  total_price: number | null
  quotes: {
    order_ref: string | null
    monday_item_id: string | null
    organization_id: string | null
    subtotal: number | null
    decoration_cost: number | null
    tax: number | null
  } | null
}

export default async function ConfirmationPage({
  params,
}: {
  params: Promise<{ orderId: string }>
}) {
  const { orderId } = await params
  const auth = await requireB2BCustomer()
  if ('kind' in auth) return handleAuthFailure(auth)
  const { admin, context } = auth

  const { data } = await admin
    .from('orders')
    .select(
      `id, status, total_price,
       quotes!inner (order_ref, monday_item_id, organization_id, subtotal, decoration_cost, tax)`
    )
    .eq('id', orderId)
    .single()
  const order = data as unknown as OrderRow | null
  if (!order) {
    console.error('[confirmation] order_not_found', { orderId, userId: context.userId })
    return notFound()
  }
  if (!order.quotes) {
    console.error('[confirmation] missing_quote_join', { orderId })
    return notFound()
  }
  if (order.quotes.organization_id !== context.organizationId) {
    console.error('[confirmation] org_mismatch', {
      orderId,
      userId: context.userId,
      userOrgId: context.organizationId,
    })
    return notFound()
  }

  const orderRef = order.quotes.order_ref ?? '—'
  const mondaySynced = Boolean(order.quotes.monday_item_id)

  // Stored total_amount / total_price is ex-GST (matches Xero invoice convention).
  // Re-derive the inc-GST view the cart showed so the customer doesn't see a
  // different total than the one they agreed to at checkout.
  const subtotalExGst = Number(order.quotes.subtotal ?? order.total_price ?? 0)
  const decorationCost = Number(order.quotes.decoration_cost ?? 0)
  const storedTax = Number(order.quotes.tax ?? 0)
  const gst = storedTax > 0 ? storedTax : Math.round(subtotalExGst * GST_RATE * 100) / 100
  const totalIncGst = Math.round((subtotalExGst + gst) * 100) / 100

  return (
    <div className="max-w-2xl p-4 md:p-8">
      <h1 className="text-2xl font-semibold text-gray-900">Order received</h1>
      <p className="mt-2 text-sm text-gray-600">
        Thanks — your order is in our system and we'll be in touch shortly.
      </p>

      <div className="mt-6 rounded-2xl border border-gray-100 bg-white p-4">
        <dl className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Order reference</dt>
            <dd className="font-mono text-base text-gray-900">{orderRef}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Status</dt>
            <dd className="text-gray-900">{order.status ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Production sync</dt>
            <dd className="text-gray-900">
              {mondaySynced ? 'Synced to production' : 'Syncing to production…'}
            </dd>
          </div>
        </dl>
      </div>

      <div className="mt-4 rounded-2xl border border-gray-100 bg-white p-4">
        <h2 className="text-sm font-medium text-gray-700">Order total</h2>
        <dl className="mt-3 space-y-1.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-gray-600">Subtotal (ex-GST)</dt>
            <dd className="text-gray-900">{formatPrice(subtotalExGst)}</dd>
          </div>
          {decorationCost > 0 && (
            <div className="flex justify-between text-gray-500">
              <dt className="pl-3">Includes decoration</dt>
              <dd>{formatPrice(decorationCost)}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-gray-600">GST (15%)</dt>
            <dd className="text-gray-900">{formatPrice(gst)}</dd>
          </div>
          <div className="mt-2 flex justify-between border-t border-gray-100 pt-2 text-base font-semibold">
            <dt>Total payable</dt>
            <dd>{formatPrice(totalIncGst)}</dd>
          </div>
        </dl>
      </div>

      {!mondaySynced && (
        <p className="mt-3 text-xs text-gray-500">
          If this takes more than a few minutes our staff will reconcile it from their side —
          your order is safe.
        </p>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        <Link
          href="/order-tracker"
          className="rounded-full bg-pr-blue px-5 py-2.5 text-sm font-medium text-white hover:bg-pr-blue/90"
        >
          View in order tracker
        </Link>
        <Link
          href="/shop"
          className="rounded-full border border-gray-200 px-5 py-2.5 text-sm font-medium text-gray-800 hover:bg-gray-50"
        >
          Continue shopping
        </Link>
      </div>
    </div>
  )
}
