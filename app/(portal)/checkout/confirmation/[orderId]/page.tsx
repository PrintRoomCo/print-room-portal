import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireB2BCustomer } from '@/lib/checkout/server'
import { handleAuthFailure } from '@/lib/checkout/page-auth'
import { ConfirmationTotals } from './ConfirmationTotals'

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
  const awaitingApproval = order.status === 'awaiting-approval'
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
    <div className="min-h-screen bg-[#FAFAFA]">
      <div className="mx-auto max-w-[1320px] px-4 pb-16 pt-[100px] md:px-6 md:pt-[120px]">
        <div className="max-w-3xl">
          <header className="mb-10 md:mb-12">
            {awaitingApproval && (
              <span className="mb-4 inline-flex rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">
                Awaiting account manager approval
              </span>
            )}
            <h1 className="font-dm-sans font-medium leading-[1.05] tracking-[-0.02em] text-[clamp(40px,5vw,72px)] text-gray-900">
              Order received
            </h1>
            <p className="mt-3 text-sm text-gray-600">
              {awaitingApproval
                ? "Thanks — your order is with our team. We'll notify you once it moves into production."
                : "Thanks — your order is in our system and we'll be in touch shortly."}
            </p>
          </header>

          <div className="rounded-[32px] bg-white p-7 md:p-8">
            <dl className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-wide text-gray-500">
                  Order reference
                </dt>
                <dd className="font-mono text-base text-gray-900">{orderRef}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-gray-500">Status</dt>
                <dd className="text-gray-900">{order.status ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-gray-500">
                  Production sync
                </dt>
                <dd className="text-gray-900">
                  {mondaySynced
                    ? 'Synced to production'
                    : awaitingApproval
                      ? 'Will sync once approved'
                      : 'Syncing to production…'}
                </dd>
              </div>
            </dl>
          </div>

          <div className="mt-4 rounded-[32px] bg-white p-7 md:p-8">
            <h2 className="text-sm font-medium text-gray-700">Order total</h2>
            <ConfirmationTotals
              subtotalExGst={subtotalExGst}
              decorationCost={decorationCost}
              gst={gst}
              totalIncGst={totalIncGst}
              gstRate={GST_RATE}
            />
          </div>

          {!mondaySynced && !awaitingApproval && (
            <p className="mt-3 text-xs text-gray-500">
              If this takes more than a few minutes our staff will reconcile it from their
              side — your order is safe.
            </p>
          )}

          <div className="mt-6 flex flex-wrap gap-2">
            <Link
              href="/order-tracker"
              className="rounded-full bg-gray-900 px-5 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              View in order tracker
            </Link>
            <Link
              href="/catalogue"
              className="rounded-full bg-gray-900 px-5 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              Continue shopping
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
