import { cache } from 'react'
import { unstable_cache } from 'next/cache'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { getSupabaseServer } from '@/lib/supabase'
import { getSupabaseServerComponent } from '@/lib/supabase-server-component'
import { getCompanyAccess } from '@/lib/company'
import {
  getJobsForCompany,
  getJobsForUser,
  getJobTrackerForUserByToken,
} from '@/lib/job-tracker-queries'
import { getTrackingNumber, type JobTracker, type TrackingInfo } from '@/lib/job-tracker'
import type { B2BCustomerAccess } from '@/types/company'
import { cacheTags, cacheRevalidate } from '@/lib/cache/tags'
import { readPreviewSession } from '@/lib/preview/cookie'
import { buildPreviewAccess } from '@/lib/preview/context'

export interface PortalAccountStore {
  id: string
  name: string
  address: string | null
  location: string | null
  city: string | null
  state: string | null
  country: string | null
  postal_code: string | null
  phone: string | null
}

export interface PortalAccountQuote {
  id: string
  reference: string | null
  quote_number: string | null
  status: string
  customer_name: string | null
  customer_email: string
  customer_company: string | null
  subtotal: number
  total_amount: number
  currency: string
  source: string | null
  created_at: string
  line_items?: unknown[] | null
}

export interface PortalAccountData {
  stores: PortalAccountStore[]
  recentQuotes: PortalAccountQuote[]
  ownerKey: string | null
}

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
  customerName: string | null
  customerEmail: string | null
  customerCompany: string | null
  subtotal: number
  totalAmount: number
  currency: string
  createdAt: string
  tracking: PastOrderTracking | null
}

export interface PortalPastOrdersData {
  orders: PortalPastOrder[]
  stores: PortalAccountStore[]
  ownerKey: string | null
}

interface PastOrderRow {
  id: string
  status: string | null
  created_at: string | null
  quote_id: string | null
  quotes: {
    organization_id: string | null
    created_by: string | null
    order_ref: string | null
    quote_number: string | null
    reference: string | null
    customer_name: string | null
    customer_email: string | null
    customer_company: string | null
    subtotal: number | null
    total_amount: number | null
    currency: string | null
  } | null
}

interface PortalAccountOrderStatusRow {
  id: string
  quote_id: string | null
  status: string | null
}

export interface PreOrderTrackerItem {
  orderId: string
  orderRef: string | null
  createdAt: string
  periodClosesAt: string | null
  windowOpen: boolean
}

export interface PortalOrderTrackerData {
  trackers: JobTracker[]
  isCompanyWide: boolean
  ownerKey: string | null
  preOrders: PreOrderTrackerItem[]
}

export const getPortalUser = cache(async (): Promise<User | null> => {
  const supabase = await getSupabaseServerComponent()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user ?? null
})

export const getPortalCompanyAccess = cache(async (): Promise<B2BCustomerAccess | null> => {
  const nowSec = Math.floor(Date.now() / 1000)
  const preview = await readPreviewSession(nowSec)
  if (preview) {
    const access = await buildPreviewAccess(preview)
    if (access) return access
  }
  const user = await getPortalUser()
  if (!user) return null
  return getCompanyAccess(user.id, user.email ?? undefined)
})

/**
 * unstable_cache body for getPortalOrderTrackerData. Pulled out so the cache
 * key is keyed on userId/email rather than touching cookies inside the
 * cached scope. Invalidate via cacheTags.orderTrackerByUser/Org on order
 * status writes.
 */
interface PreOrderRow {
  id: string
  created_at: string | null
  period_id: string | null
  quotes: {
    order_ref: string | null
    created_by: string | null
  } | null
  b2b_ordering_periods: {
    closes_at: string | null
    status: string | null
  } | null
}

const fetchOrderTrackerDataForUser = unstable_cache(
  async (userId: string, email: string | null): Promise<PortalOrderTrackerData> => {
    const adminClient = getSupabaseServer()
    const { data: membership } = await adminClient
      .from('user_organizations')
      .select('organization_id, role')
      .eq('user_id', userId)
      .maybeSingle()

    let trackers: JobTracker[] = []
    let isCompanyWide = false
    let preOrders: PreOrderTrackerItem[] = []

    try {
      const canSeeAllOrgOrders = membership?.role === 'org_admin'

      if (canSeeAllOrgOrders && membership?.organization_id) {
        const { data: b2bAccount } = await adminClient
          .from('b2b_accounts')
          .select('company_id')
          .eq('organization_id', membership.organization_id)
          .maybeSingle()

        if (b2bAccount?.company_id) {
          const { data: stores } = await adminClient
            .from('stores')
            .select('id')
            .eq('organization_id', membership.organization_id)

          const locationIds = stores?.map((s) => s.id) || []
          trackers = await getJobsForCompany(b2bAccount.company_id, locationIds)
          isCompanyWide = trackers.length > 0
        }
      }

      if (trackers.length === 0) {
        trackers = await getJobsForUser(userId, email || undefined)
        isCompanyWide = false
      }

      // Fetch pre-orders (awaiting-period-close) for this user/org.
      if (membership?.organization_id) {
        let preOrderQuery = adminClient
          .from('orders')
          .select(
            'id, created_at, period_id, quotes!inner ( order_ref, created_by, organization_id ), b2b_ordering_periods ( closes_at, status )',
          )
          .eq('status', 'awaiting-period-close')
          .eq('quotes.organization_id', membership.organization_id)
          .order('created_at', { ascending: false })

        // staff (non-org_admin) see only their own pre-orders
        if (membership.role !== 'org_admin') {
          preOrderQuery = preOrderQuery.eq('quotes.created_by', userId)
        }

        const { data: preOrderRows } = await preOrderQuery

        preOrders = ((preOrderRows ?? []) as unknown as PreOrderRow[]).map((row) => ({
          orderId: row.id,
          orderRef: row.quotes?.order_ref ?? null,
          createdAt: row.created_at ?? new Date().toISOString(),
          periodClosesAt: row.b2b_ordering_periods?.closes_at ?? null,
          windowOpen: row.b2b_ordering_periods?.status === 'open',
        }))
      }
    } catch (error) {
      console.error('[OrderTracker] Failed to fetch trackers:', error)
    }

    return {
      trackers,
      isCompanyWide,
      ownerKey: membership?.organization_id ? `org:${membership.organization_id}` : `user:${userId}`,
      preOrders,
    }
  },
  ['portal-order-tracker-data'],
  {
    tags: [cacheTags.orderTracker],
    revalidate: cacheRevalidate.orderTracker,
  },
)

export const getPortalOrderTrackerData = cache(async (): Promise<PortalOrderTrackerData> => {
  const user = await getPortalUser()
  if (!user) {
    return { trackers: [], isCompanyWide: false, ownerKey: null, preOrders: [] }
  }
  return fetchOrderTrackerDataForUser(user.id, user.email ?? null)
})

/**
 * Single tracker for the portal-native `/order-tracker/[token]` deep link,
 * scoped to the authed user (returns null when unauthenticated, unknown, or
 * not owned — see getJobTrackerForUserByToken).
 */
export const getPortalTrackerByToken = cache(
  async (token: string): Promise<JobTracker | null> => {
    const user = await getPortalUser()
    if (!user) return null
    return getJobTrackerForUserByToken(token, user.id, user.email ?? null)
  }
)

/**
 * unstable_cache body for getPortalAccountData. Same pattern as the order
 * tracker fetcher above — user/email resolved outside, queries here use
 * the service-role admin client (no cookies inside the cached scope).
 * Invalidate via cacheTags.accountData on quote/order/store mutations.
 */
const fetchAccountDataForUser = unstable_cache(
  async (userId: string, email: string | null): Promise<PortalAccountData> => {
    const adminClient = getSupabaseServer()
    const { data: membership } = await adminClient
      .from('user_organizations')
      .select('organization_id')
      .eq('user_id', userId)
      .maybeSingle()

    let stores: PortalAccountStore[] = []
    let recentQuotes: PortalAccountQuote[] = []

    if (membership) {
      const [{ data: storesData }, { data: quotesData }] = await Promise.all([
        adminClient
          .from('stores')
          .select('id, name, address, location, city, state, country, postal_code, phone')
          .eq('organization_id', membership.organization_id)
          .order('created_at', { ascending: true }),
        adminClient
          .from('quotes')
          .select('id, reference, quote_number, status, customer_name, customer_email, customer_company, subtotal, total_amount, currency, source, created_at')
          .eq('organization_id', membership.organization_id)
          .order('created_at', { ascending: false }),
      ])

      stores = (storesData || []) as PortalAccountStore[]
      recentQuotes = await overlayLatestOrderStatuses(
        adminClient,
        (quotesData || []) as PortalAccountQuote[],
      )
    } else if (email) {
      const { data: quotesData } = await adminClient
        .from('quotes')
        .select('id, reference, quote_number, status, customer_name, customer_email, customer_company, subtotal, total_amount, currency, source, created_at')
        .eq('customer_email', email)
        .order('created_at', { ascending: false })

      recentQuotes = await overlayLatestOrderStatuses(
        adminClient,
        (quotesData || []) as PortalAccountQuote[],
      )
    }

    return {
      stores,
      recentQuotes,
      ownerKey: membership?.organization_id ? `org:${membership.organization_id}` : `user:${userId}`,
    }
  },
  ['portal-account-data'],
  {
    tags: [cacheTags.accountData],
    revalidate: cacheRevalidate.accountData,
  },
)

export const getPortalAccountData = cache(async (): Promise<PortalAccountData> => {
  const user = await getPortalUser()
  if (!user) {
    return { stores: [], recentQuotes: [], ownerKey: null }
  }
  return fetchAccountDataForUser(user.id, user.email ?? null)
})

function mapPastOrderRow(row: PastOrderRow): PortalPastOrder {
  return {
    orderId: row.id,
    quoteId: row.quote_id,
    orderRef: row.quotes?.order_ref ?? null,
    quoteNumber: row.quotes?.quote_number ?? null,
    reference: row.quotes?.reference ?? null,
    status: row.status ?? 'awaiting-approval',
    customerName: row.quotes?.customer_name ?? null,
    customerEmail: row.quotes?.customer_email ?? null,
    customerCompany: row.quotes?.customer_company ?? null,
    subtotal: Number(row.quotes?.subtotal ?? 0),
    totalAmount: Number(row.quotes?.total_amount ?? 0),
    currency: row.quotes?.currency ?? 'NZD',
    createdAt: row.created_at ?? new Date().toISOString(),
    tracking: null,
  }
}

async function overlayTrackingInfo(
  adminClient: SupabaseClient,
  orders: PortalPastOrder[],
): Promise<PortalPastOrder[]> {
  const quoteIds = orders.map((o) => o.quoteId).filter(Boolean) as string[]
  if (quoteIds.length === 0) return orders

  const { data: trackerRows } = await adminClient
    .from('job_trackers')
    .select('quote_id, tracking_info')
    .in('quote_id', quoteIds)

  const byQuoteId = new Map<string, TrackingInfo | null>()
  for (const row of (trackerRows ?? []) as Array<{
    quote_id: string | null
    tracking_info: TrackingInfo | null
  }>) {
    if (!row.quote_id || byQuoteId.has(row.quote_id)) continue
    byQuoteId.set(row.quote_id, row.tracking_info)
  }

  return orders.map((order) => {
    const info = order.quoteId ? byQuoteId.get(order.quoteId) : null
    if (!info) return order
    return {
      ...order,
      tracking: {
        carrier: info.carrier ?? null,
        trackingNumber: getTrackingNumber(info) ?? null,
        url: info.url ?? null,
      },
    }
  })
}

const fetchPastOrdersForUser = unstable_cache(
  async (userId: string, email: string | null): Promise<PortalPastOrdersData> => {
    void email
    const adminClient = getSupabaseServer()
    const { data: membership } = await adminClient
      .from('user_organizations')
      .select('organization_id, role')
      .eq('user_id', userId)
      .maybeSingle()

    let orders: PortalPastOrder[] = []
    let stores: PortalAccountStore[] = []

    if (membership?.organization_id) {
      const { data: storesData } = await adminClient
        .from('stores')
        .select('id, name, address, location, city, state, country, postal_code, phone')
        .eq('organization_id', membership.organization_id)
        .order('created_at', { ascending: true })
      stores = (storesData || []) as PortalAccountStore[]

      // Past orders = placed stock_on_hand orders. Display fields come from the
      // joined quote (orders carries no org/customer columns). order_type is
      // added by the Order-type foundation task.
      const canSeeAllOrgOrders = membership.role === 'org_admin'

      let orderQuery = adminClient
        .from('orders')
        .select(
          `id, status, created_at, quote_id,
           quotes!inner (
             organization_id, created_by, order_ref, quote_number, reference,
             customer_name, customer_email, customer_company,
             subtotal, total_amount, currency
           )`,
        )
        .eq('order_type', 'stock_on_hand')
        .eq('quotes.organization_id', membership.organization_id)

      // staff (non-admin) see only their own placed stock orders; org_admin sees the
      // whole org. This is the same rule buildAccess().canSeeAllOrgOrders encodes.
      if (!canSeeAllOrgOrders) {
        orderQuery = orderQuery.eq('quotes.created_by', userId)
      }

      const { data: orderRows } = await orderQuery.order('created_at', { ascending: false })

      orders = await overlayTrackingInfo(
        adminClient,
        ((orderRows ?? []) as unknown as PastOrderRow[]).map(mapPastOrderRow),
      )
    }

    return {
      orders,
      stores,
      ownerKey: membership?.organization_id
        ? `org:${membership.organization_id}`
        : `user:${userId}`,
    }
  },
  ['portal-past-orders-data'],
  {
    tags: [cacheTags.accountData],
    revalidate: cacheRevalidate.accountData,
  },
)

export const getPortalPastOrdersData = cache(async (): Promise<PortalPastOrdersData> => {
  const user = await getPortalUser()
  if (!user) {
    return { orders: [], stores: [], ownerKey: null }
  }
  return fetchPastOrdersForUser(user.id, user.email ?? null)
})

async function overlayLatestOrderStatuses(
  adminClient: SupabaseClient,
  quotes: PortalAccountQuote[],
): Promise<PortalAccountQuote[]> {
  const quoteIds = quotes.map((quote) => quote.id).filter(Boolean)
  if (quoteIds.length === 0) return quotes

  const { data: orderRows, error } = await adminClient
    .from('orders')
    .select('id, quote_id, status')
    .in('quote_id', quoteIds)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[PortalData] Failed to overlay order statuses:', error)
    return quotes
  }

  const latestOrderByQuoteId = new Map<string, PortalAccountOrderStatusRow>()
  for (const order of (orderRows ?? []) as PortalAccountOrderStatusRow[]) {
    if (!order.quote_id || latestOrderByQuoteId.has(order.quote_id)) continue
    latestOrderByQuoteId.set(order.quote_id, order)
  }

  return quotes.map((quote) => {
    const order = latestOrderByQuoteId.get(quote.id)
    if (!order?.status) return quote
    return { ...quote, status: order.status }
  })
}
