import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { requireB2BCustomer } from '@/lib/checkout/server'
import { formatPrice } from '@/lib/format/price'

export const dynamic = 'force-dynamic'

interface OrderRow {
  id: string
  status: string | null
  total_price: number | null
  quotes: {
    order_ref: string | null
    monday_item_id: string | null
    organization_id: string | null
  } | null
}

export default async function ConfirmationPage({
  params,
}: {
  params: Promise<{ orderId: string }>
}) {
  const { orderId } = await params
  const auth = await requireB2BCustomer()
  if ('error' in auth) redirect('/account')
  const { admin, context } = auth

  const { data } = await admin
    .from('orders')
    .select(`id, status, total_price, quotes!inner (order_ref, monday_item_id, organization_id)`)
    .eq('id', orderId)
    .single()
  const order = data as unknown as OrderRow | null
  if (!order) return notFound()
  if (order.quotes?.organization_id !== context.organizationId) return notFound()

  const orderRef = order.quotes?.order_ref ?? '—'
  const mondaySynced = Boolean(order.quotes?.monday_item_id)

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
            <dt className="text-xs uppercase tracking-wide text-gray-500">Total</dt>
            <dd className="text-gray-900">{formatPrice(order.total_price)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Production sync</dt>
            <dd className="text-gray-900">
              {mondaySynced ? 'Synced to production' : 'Syncing to production…'}
            </dd>
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
