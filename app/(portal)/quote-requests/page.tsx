import Link from 'next/link'
import { requireB2BCustomer } from '@/lib/checkout/server'
import { handleAuthFailure } from '@/lib/checkout/page-auth'
import { formatPrice } from '@/lib/format/price'

export const dynamic = 'force-dynamic'

interface StaffQuoteRow {
  id: string
  status: string | null
  total: number | null
  created_at: string
  quote_data: { items?: unknown[] } | null
}

export default async function QuoteRequestsListPage() {
  const auth = await requireB2BCustomer()
  if ('kind' in auth) return handleAuthFailure(auth)
  const { admin, context } = auth

  const { data } = await admin
    .from('staff_quotes')
    .select('id, status, total, created_at, quote_data')
    .eq('submitted_by_user_id', context.userId)
    .order('created_at', { ascending: false })

  const rows = (data ?? []) as StaffQuoteRow[]

  return (
    <div className="p-4 md:p-8">
      <h1 className="mb-6 text-2xl font-semibold text-gray-900">Your quote requests</h1>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-10 text-center text-gray-500">
          You haven't submitted any quote requests yet.{' '}
          <Link href="/shop" className="underline">
            Browse the catalog
          </Link>{' '}
          to get started.
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((q) => {
            const itemCount = q.quote_data?.items?.length ?? 0
            return (
              <li key={q.id}>
                <Link
                  href={`/quote-requests/${q.id}`}
                  className="block rounded-2xl border border-gray-100 bg-white p-4 shadow-sm transition-colors hover:bg-gray-50"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-700">
                      {new Date(q.created_at).toLocaleDateString('en-NZ', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </span>
                    <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
                      {q.status ?? 'draft'}
                    </span>
                  </div>
                  <div className="mt-2 text-xs text-gray-500">
                    {itemCount} line{itemCount === 1 ? '' : 's'}
                    {q.total != null
                      ? ` · ${formatPrice(q.total)}`
                      : ' · awaiting staff pricing'}
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
