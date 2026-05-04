import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { requireB2BCustomer } from '@/lib/checkout/server'
import { formatPrice } from '@/lib/format/price'

export const dynamic = 'force-dynamic'

interface StaffQuoteDetail {
  id: string
  status: string | null
  subtotal: number | null
  total: number | null
  discount_percent: number | null
  created_at: string
  customer_name: string | null
  customer_email: string | null
  submitted_by_user_id: string | null
  quote_data: {
    items?: Array<{
      productId?: string | null
      name?: string | null
      quantity?: number | null
      unitPrice?: number | null
      variantId?: string | null
    }>
  } | null
}

export default async function QuoteRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const auth = await requireB2BCustomer()
  if ('error' in auth) redirect('/account')
  const { admin, context } = auth

  const { data } = await admin
    .from('staff_quotes')
    .select(
      'id, status, subtotal, total, discount_percent, created_at, customer_name, customer_email, submitted_by_user_id, quote_data'
    )
    .eq('id', id)
    .single()
  const row = data as unknown as StaffQuoteDetail | null
  if (!row || row.submitted_by_user_id !== context.userId) return notFound()

  const items = row.quote_data?.items ?? []
  const isApproved = row.status === 'approved'
  const hasTotal = row.total != null && Number.isFinite(Number(row.total))

  return (
    <div className="max-w-3xl p-4 md:p-8">
      <div className="mb-4 flex items-center gap-3">
        <Link href="/quote-requests" className="text-sm text-gray-600 hover:underline">
          ← All quote requests
        </Link>
      </div>

      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Quote request</h1>
          <p className="mt-1 text-sm text-gray-500">
            Submitted{' '}
            {new Date(row.created_at).toLocaleDateString('en-NZ', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
          </p>
        </div>
        <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
          {row.status ?? 'draft'}
        </span>
      </div>

      <section className="rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-4 py-3 text-sm font-medium text-gray-700">
          Lines ({items.length})
        </div>
        <ul className="divide-y divide-gray-100 text-sm">
          {items.length === 0 ? (
            <li className="px-4 py-3 text-gray-500">No lines recorded on this request.</li>
          ) : (
            items.map((it, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate font-medium text-gray-900">
                    {it.name ?? it.productId ?? 'Unknown product'}
                  </div>
                  {it.variantId && (
                    <div className="truncate text-xs text-gray-500">
                      Variant: {it.variantId}
                    </div>
                  )}
                </div>
                <div className="flex-shrink-0 text-right text-xs text-gray-600">
                  <div>Qty {it.quantity ?? '—'}</div>
                  {typeof it.unitPrice === 'number' && (
                    <div className="text-gray-500">
                      Unit {formatPrice(it.unitPrice)}
                    </div>
                  )}
                </div>
              </li>
            ))
          )}
        </ul>
      </section>

      {isApproved && hasTotal ? (
        <section className="mt-6 rounded-2xl border border-sky-200 bg-sky-50 p-4">
          <h2 className="text-sm font-semibold text-sky-900">
            Staff priced this at {formatPrice(row.total)}
          </h2>
          <p className="mt-1 text-xs text-sky-900/80">
            Accept or decline via your account manager — in-app acceptance arrives in v1.1.
          </p>
          <div className="mt-3 flex gap-2">
            {/* v1.1 TODO: wire these up to accept/decline endpoints. */}
            <button
              type="button"
              disabled
              title="In-app acceptance arrives in v1.1 — please confirm with your account manager."
              className="cursor-not-allowed rounded-full bg-sky-600/50 px-4 py-2 text-sm font-medium text-white"
            >
              Accept
            </button>
            <button
              type="button"
              disabled
              title="In-app acceptance arrives in v1.1 — please confirm with your account manager."
              className="cursor-not-allowed rounded-full border border-sky-300 bg-white px-4 py-2 text-sm font-medium text-sky-700"
            >
              Decline
            </button>
          </div>
        </section>
      ) : (
        <section className="mt-6 rounded-2xl border border-gray-100 bg-white p-4 text-sm text-gray-600">
          Awaiting staff pricing. We'll get back to you shortly.
        </section>
      )}
    </div>
  )
}
