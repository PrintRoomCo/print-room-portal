import { cache } from 'react'
import { unstable_cache } from 'next/cache'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { getSupabaseServer } from '@/lib/supabase'
import { getSupabaseServerComponent } from '@/lib/supabase-server-component'
import { getCompanyAccess } from '@/lib/company'
import {
  getJobsForOrganization,
  getJobsForUser,
  getJobTrackerForUserByToken,
} from '@/lib/job-tracker-queries'
import { getTrackingNumber, type JobTracker, type TrackingInfo } from '@/lib/job-tracker'
import {
  mapPastOrderRow,
  queryPastOrders,
  type PortalPastOrder,
  type PastOrderTracking,
} from '@/lib/orders/past-orders-query'
import { getMemberBranchStoreIds } from '@/lib/orders/branch-grants'
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

export type { PortalPastOrder, PastOrderTracking } from '@/lib/orders/past-orders-query'

export interface PortalPastOrdersData {
  orders: PortalPastOrder[]
  stores: PortalAccountStore[]
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

// Reconstruct the minimal User shape the portal consumes (only .id and .email
// are read anywhere) from a verified JWT payload. sub -> id, email -> email;
// the remaining User fields are filled from claims when present. created_at is
// not carried in the JWT — no caller reads it, so an empty string is safe.
// Returns null for a payload with no usable subject.
export function userFromClaims(claims: Record<string, unknown> | null | undefined): User | null {
  const sub = claims?.sub
  if (typeof sub !== 'string' || sub.length === 0) return null
  const aud = claims!.aud
  return {
    id: sub,
    aud: typeof aud === 'string' ? aud : Array.isArray(aud) ? String(aud[0] ?? '') : '',
    email: typeof claims!.email === 'string' ? (claims!.email as string) : undefined,
    phone: typeof claims!.phone === 'string' ? (claims!.phone as string) : undefined,
    role: typeof claims!.role === 'string' ? (claims!.role as string) : undefined,
    app_metadata: (claims!.app_metadata as User['app_metadata']) ?? {},
    user_metadata: (claims!.user_metadata as User['user_metadata']) ?? {},
    created_at: '',
  } as User
}

// Structural type for the optional getClaims() method (auth-js ≥ 2.10x). Guarded
// at the call site so an older SDK / test double lacking it degrades to getUser.
type ClaimsCapableAuth = {
  getClaims?: () => Promise<{
    data: { claims?: Record<string, unknown> } | null
    error: unknown
  }>
}

export const getPortalUser = cache(async (): Promise<User | null> => {
  const supabase = await getSupabaseServerComponent()

  // getClaims() verifies the access token LOCALLY when it is signed with an
  // asymmetric key (ES256, after the JWT signing-key rotation) — no network
  // round-trip. For a legacy HS256 session it internally falls back to a
  // getUser() network verify, so this is correct during and after the key
  // transition. Anything unexpected (method absent on an older SDK, thrown
  // error, missing/invalid claims, transient JWKS fetch failure) falls through
  // to the authoritative getUser() rather than treating the request as
  // logged-out.
  const auth = supabase.auth as unknown as ClaimsCapableAuth
  if (typeof auth.getClaims === 'function') {
    try {
      const { data, error } = await auth.getClaims()
      if (!error) {
        const user = userFromClaims(data?.claims)
        if (user) return user
      }
    } catch {
      // fall through to getUser()
    }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user ?? null
})

/**
 * Cross-request cache for a user's B2B access slice. Keyed on userId/email and
 * tagged so membership/store mutations can invalidate it; otherwise it survives
 * for `cacheRevalidate.companyAccess` so repeat navigations skip the ~6-query
 * resolution entirely. Service-role reads only (no cookies in the cached scope).
 */
const fetchCompanyAccessForUser = unstable_cache(
  async (userId: string, email: string | null): Promise<B2BCustomerAccess | null> => {
    return getCompanyAccess(userId, email ?? undefined)
  },
  ['portal-company-access'],
  {
    tags: [cacheTags.companyAccess],
    revalidate: cacheRevalidate.companyAccess,
  },
)

export const getPortalCompanyAccess = cache(async (): Promise<B2BCustomerAccess | null> => {
  const nowSec = Math.floor(Date.now() / 1000)
  const preview = await readPreviewSession(nowSec)
  if (preview) {
    const access = await buildPreviewAccess(preview)
    if (access) return access
  }
  const user = await getPortalUser()
  if (!user) return null
  return fetchCompanyAccessForUser(user.id, user.email ?? null)
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
        // Org-wide is a superset of the admin's own trackers (they are a member
        // and their quotes are in the org), so there is no fall-through to a
        // personal list — an admin with zero org trackers correctly sees none.
        trackers = await getJobsForOrganization(membership.organization_id)
        isCompanyWide = true
      } else {
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

async function overlayTrackingInfo(
  adminClient: SupabaseClient,
  orders: PortalPastOrder[],
): Promise<PortalPastOrder[]> {
  const quoteIds = orders.map((o) => o.quoteId).filter(Boolean) as string[]
  if (quoteIds.length === 0) return orders

  // Ordered so the FIRST row kept per quote_id is the LATEST tracker — both the
  // carrier tracking_info and the status (which feeds the stock fulfilment badge)
  // must reflect the most recent tracker, not a DB-arbitrary one.
  const { data: trackerRows } = await adminClient
    .from('job_trackers')
    .select('quote_id, tracking_info, status')
    .in('quote_id', quoteIds)
    .order('created_at', { ascending: false })

  const byQuoteId = new Map<string, { tracking_info: TrackingInfo | null; status: string | null }>()
  for (const row of (trackerRows ?? []) as Array<{
    quote_id: string | null
    tracking_info: TrackingInfo | null
    status: string | null
  }>) {
    if (!row.quote_id || byQuoteId.has(row.quote_id)) continue
    byQuoteId.set(row.quote_id, { tracking_info: row.tracking_info, status: row.status })
  }

  return orders.map((order) => {
    const entry = order.quoteId ? byQuoteId.get(order.quoteId) : null
    if (!entry) return order
    const info = entry.tracking_info
    return {
      ...order,
      trackerStatus: entry.status,
      ...(info
        ? {
            tracking: {
              carrier: info.carrier ?? null,
              trackingNumber: getTrackingNumber(info) ?? null,
              url: info.url ?? null,
            },
          }
        : {}),
    }
  })
}

const fetchPastOrdersForUser = unstable_cache(
  async (userId: string, email: string | null): Promise<PortalPastOrdersData> => {
    const adminClient = getSupabaseServer()
    const { data: membership } = await adminClient
      .from('user_organizations')
      .select('id, organization_id, role, default_store_id')
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

      // Orders view = every placed order for the org, both order types,
      // including awaiting-period-close pre-orders. Scoping (org_admin
      // org-wide, staff own-by-email) lives in queryPastOrders — shared with
      // the CSV export route so the two can never drift.
      const branchStoreIds =
        membership.role === 'org_admin'
          ? []
          : await getMemberBranchStoreIds(
              adminClient,
              membership.id,
              membership.default_store_id ?? null,
            )
      const rows = await queryPastOrders(adminClient, {
        organizationId: membership.organization_id,
        canSeeAllOrgOrders: membership.role === 'org_admin',
        userEmail: email,
        branchStoreIds,
      })

      orders = await overlayTrackingInfo(adminClient, rows.map(mapPastOrderRow))
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
