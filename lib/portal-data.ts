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
import type { JobTracker } from '@/lib/job-tracker'
import type { B2BCustomerAccess } from '@/types/company'
import { cacheTags, cacheRevalidate } from '@/lib/cache/tags'

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
