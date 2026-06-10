import type { Metadata } from 'next'
import { requireB2BCustomer } from '@/lib/checkout/server'
import { handleAuthFailure } from '@/lib/checkout/page-auth'
import { SetTopBarContext } from '@/components/layout/PortalTopBarContext'
import { PortalEmptyState } from '@/components/ui/PortalEmptyState'
import { ORDER_STATUS_LABELS } from '@/lib/orders/status-labels'
import type { OrderStatus } from '@/lib/orders/status-labels'
import { CancelPreOrderButton } from './CancelPreOrderButton'

export const metadata: Metadata = {
  title: 'Orders',
}

interface OrderRow {
  id: string
  status: string | null
  created_at: string | null
  period_id: string | null
  quotes: {
    order_ref: string | null
  } | null
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-NZ', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export default async function OrdersPage() {
  const auth = await requireB2BCustomer()
  if ('kind' in auth) return handleAuthFailure(auth)
  const { admin, context } = auth

  // Load this org's orders (most recent first), joined to quote for the ref.
  const { data: rawOrders } = await admin
    .from('orders')
    .select(
      'id, status, created_at, period_id, quotes!inner ( order_ref )',
    )
    .eq('quotes.organization_id', context.organizationId)
    .order('created_at', { ascending: false })
    .limit(100)

  const orders = (rawOrders ?? []) as unknown as OrderRow[]

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <SetTopBarContext value={{ kind: 'section', label: 'Orders' }} />
      <div className="mx-auto max-w-[1320px] px-4 pb-16 pt-[100px] md:px-6 md:pt-[120px]">
        <header className="mb-10 md:mb-12">
          <h1 className="font-dm-sans font-medium leading-[1.05] tracking-[-0.02em] text-[clamp(40px,5vw,72px)] text-gray-900">
            Orders
          </h1>
        </header>

        {orders.length === 0 ? (
          <PortalEmptyState
            title="No orders yet"
            body="Orders placed through the portal will appear here."
            actionHref="/catalogue"
            actionLabel="Browse catalogue"
          />
        ) : (
          <div className="divide-y divide-gray-200 rounded-2xl border border-gray-200 bg-white">
            {orders.map((order) => {
              const status = order.status as OrderStatus | null
              const label =
                status && status in ORDER_STATUS_LABELS
                  ? ORDER_STATUS_LABELS[status]
                  : (order.status ?? '—')
              const isPreOrderOpen = order.status === 'awaiting-period-close'
              const orderRef = order.quotes?.order_ref ?? null

              return (
                <div
                  key={order.id}
                  className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="flex flex-col gap-1">
                    <p className="text-sm font-medium text-gray-900">
                      {orderRef ? `Order #${orderRef}` : `Order ${order.id.slice(0, 8)}…`}
                    </p>
                    <p className="text-xs text-gray-500">{formatDate(order.created_at)}</p>
                    <p className="mt-0.5 max-w-md text-sm text-gray-700">{label}</p>
                    {isPreOrderOpen && (
                      <p className="mt-1 text-xs text-gray-500">
                        Need to change it? Cancel and place a new order before the window closes.
                      </p>
                    )}
                  </div>

                  {isPreOrderOpen && (
                    <div className="shrink-0 self-start sm:self-center">
                      <CancelPreOrderButton orderId={order.id} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
