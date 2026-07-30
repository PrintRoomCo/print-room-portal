import { getSupabaseServer } from '@/lib/supabase'
import { resolveProductFrontImages } from '@/lib/product-images'
import type { JobTracker } from '@/lib/job-tracker'
import { syncJobTrackerItemsFromMonday } from '@/lib/monday/sync-job-tracker-items'

// Sprint 3 (Anna feedback, Monday 2809663385) reversed Feature #7: stock-on-hand
// orders are no longer HIDDEN from the customer tracker — they now appear with a
// simplified Unfulfilled/Fulfilled badge instead of the 7-step production timeline
// (see lib/orders/fulfilment-status.ts and the `isStockOrder` branch in
// JobTrackerOrderCard / OrdersTable). No visibility filter is applied to trackers
// anymore; the render layer branches on order_type.

const STALE_SYNC_INTERVAL_MS = 60 * 60 * 1000
const STALE_SYNC_CONCURRENCY = 10
const STALE_SYNC_PER_CALL_TIMEOUT_MS = 2000
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isItemsSyncEnabled(): boolean {
  return process.env.ENABLE_MONDAY_ITEMS_SYNC === 'true'
}

function needsItemsSync(tracker: JobTracker): boolean {
  if (!tracker.monday_item_id) return false
  if (tracker.quote_data_source === 'submit-quote') return false

  const items = tracker.quote_data?.items ?? []
  if (items.length === 0) return true

  const syncedAt = tracker.monday_items_synced_at
  if (!syncedAt) return true
  return Date.now() - new Date(syncedAt).getTime() > STALE_SYNC_INTERVAL_MS
}

function fireAndForgetItemsSync(trackers: JobTracker[]): void {
  if (!isItemsSyncEnabled()) return

  const stale = trackers.filter(needsItemsSync).slice(0, STALE_SYNC_CONCURRENCY)
  if (stale.length === 0) return

  void Promise.allSettled(
    stale.map((tracker) =>
      Promise.race([
        syncJobTrackerItemsFromMonday(Number(tracker.id)),
        new Promise((resolve) =>
          setTimeout(
            () => resolve({ synced: false, reason: 'timeout' }),
            STALE_SYNC_PER_CALL_TIMEOUT_MS
          )
        ),
      ]).catch((err) => {
        console.error(
          `[JobTracker] stale-on-read sync failed for ${tracker.id}:`,
          err
        )
      })
    )
  )
}

function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

async function attachProductImages(trackers: JobTracker[]): Promise<JobTracker[]> {
  if (trackers.length === 0) return trackers

  const productIds = new Set<string>()
  const designInstanceIds = new Set<string>()
  for (const tracker of trackers) {
    const items = tracker.quote_data?.items ?? []
    for (const item of items) {
      if (item?.productId) productIds.add(item.productId)
      if (item?.designInstanceId && isUuid(item.designInstanceId)) {
        designInstanceIds.add(item.designInstanceId)
      }
    }
  }

  const imageMap =
    productIds.size > 0
      ? await resolveProductFrontImages(Array.from(productIds))
      : {}

  let designNamesByInstanceId: Record<string, string> = {}
  if (designInstanceIds.size > 0) {
    try {
      const supabase = getSupabaseServer()
      const { data: designs, error } = await supabase
        .from('design_submissions')
        .select('id, design_name')
        .in('id', Array.from(designInstanceIds))

      if (error) {
        console.error('[JobTracker] Failed to fetch design names:', error)
      } else if (designs) {
        designNamesByInstanceId = Object.fromEntries(
          designs
            .filter(
              (d): d is { id: string; design_name: string } =>
                typeof d.design_name === 'string' && d.design_name.length > 0
            )
            .map((d) => [d.id, d.design_name])
        )
      }
    } catch (err) {
      console.error('[JobTracker] Error fetching design names:', err)
    }
  }

  const hasImages = Object.keys(imageMap).length > 0
  const hasDesignNames = Object.keys(designNamesByInstanceId).length > 0
  if (!hasImages && !hasDesignNames) return trackers

  return trackers.map((tracker) => {
    const items = tracker.quote_data?.items ?? []
    const trackerImages: Record<string, string> = {}
    const trackerDesignNames: Record<string, string> = {}
    for (const item of items) {
      if (item?.productId && imageMap[item.productId]) {
        trackerImages[item.productId] = imageMap[item.productId]
      }
      const designId = item?.designInstanceId
      if (designId && designNamesByInstanceId[designId]) {
        trackerDesignNames[designId] = designNamesByInstanceId[designId]
      }
    }

    const hasTrackerImages = Object.keys(trackerImages).length > 0
    const hasTrackerDesignNames = Object.keys(trackerDesignNames).length > 0
    if (!hasTrackerImages && !hasTrackerDesignNames) return tracker

    return {
      ...tracker,
      ...(hasTrackerImages
        ? { productImagesByProductId: trackerImages }
        : {}),
      ...(hasTrackerDesignNames
        ? { designNamesByInstanceId: trackerDesignNames }
        : {}),
    }
  })
}

export async function getJobsForUser(
  userId: string,
  fallbackEmail?: string
): Promise<JobTracker[]> {
  try {
    const supabase = getSupabaseServer()

    const { data, error } = await supabase
      .from('job_trackers')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    if (error) {
      if (error.code === '42P01') return []
      console.error('[JobTracker] Failed to fetch user jobs:', error)
      return []
    }

    if (data && data.length > 0) {
      const trackers = data as JobTracker[]
      fireAndForgetItemsSync(trackers)
      return attachProductImages(trackers)
    }

    if (fallbackEmail) {
      return getJobsForCustomer(fallbackEmail)
    }

    return []
  } catch (error) {
    console.error('[JobTracker] Error fetching user jobs:', error)
    return []
  }
}

export async function getJobsForCustomer(
  customerEmail: string
): Promise<JobTracker[]> {
  try {
    const supabase = getSupabaseServer()

    const { data, error } = await supabase
      .from('job_trackers')
      .select('*')
      .eq('customer_email', customerEmail.toLowerCase())
      .order('created_at', { ascending: false })

    if (error) {
      if (error.code === '42P01') return []
      console.error('[JobTracker] Failed to fetch customer jobs:', error)
      return []
    }

    const trackers = (data || []) as JobTracker[]
    fireAndForgetItemsSync(trackers)
    return attachProductImages(trackers)
  } catch (error) {
    console.error('[JobTracker] Error fetching customer jobs:', error)
    return []
  }
}

/**
 * Every tracker belonging to an organisation, for the org_admin list view.
 *
 * Tenancy runs through the QUOTE or the OWNING USER — never
 * `job_trackers.company_id` / `location_id` (both null on all 1314 rows; the
 * 2026-06-03 spec assumed a tenancy model that was never wired up), and never
 * `customer_email` (an email is not a tenancy key — two orgs could share one,
 * which would leak).
 *
 * Two round-trips plus a JS dedupe rather than one `.or(...in...)` string:
 * clearer, and it avoids PostgREST or/in string-building pitfalls. Known limit:
 * `.in()` on a very large id list could hit URL limits — not reachable at
 * current org sizes (a handful of quotes, ~68 members); revisit past a few
 * hundred.
 */
export async function getJobsForOrganization(
  organizationId: string
): Promise<JobTracker[]> {
  try {
    const supabase = getSupabaseServer()

    const [{ data: quoteRows }, { data: memberRows }] = await Promise.all([
      supabase.from('quotes').select('id').eq('organization_id', organizationId),
      supabase
        .from('user_organizations')
        .select('user_id')
        .eq('organization_id', organizationId),
    ])

    const quoteIds = (quoteRows || []).map((r: { id: string }) => r.id)
    const memberIds = (memberRows || []).map((r: { user_id: string }) => r.user_id)

    if (quoteIds.length === 0 && memberIds.length === 0) return []

    const [byQuote, byUser] = await Promise.all([
      quoteIds.length > 0
        ? supabase
            .from('job_trackers')
            .select('*')
            .in('quote_id', quoteIds)
            .order('created_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      memberIds.length > 0
        ? supabase
            .from('job_trackers')
            .select('*')
            .in('user_id', memberIds)
            .order('created_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ])

    for (const result of [byQuote, byUser]) {
      if (result.error) {
        if ((result.error as { code?: string }).code === '42P01') return []
        console.error('[JobTracker] Failed to fetch org jobs:', result.error)
        return []
      }
    }

    // A tracker matched by BOTH quote and owning user must appear once.
    const byId = new Map<number | string, JobTracker>()
    for (const row of [...(byQuote.data || []), ...(byUser.data || [])] as JobTracker[]) {
      if (!byId.has(row.id)) byId.set(row.id, row)
    }

    const trackers = Array.from(byId.values()).sort((a, b) =>
      String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')),
    )

    fireAndForgetItemsSync(trackers)
    return attachProductImages(trackers)
  } catch (error) {
    console.error('[JobTracker] Error fetching org jobs:', error)
    return []
  }
}

/**
 * Does `tracker` belong to `orgId`? Encodes the SAME tenancy rule as
 * getJobsForOrganization (quote-org OR owning-user membership), so the list and
 * the deep-link cannot drift on who may see what.
 */
async function trackerBelongsToOrg(
  supabase: ReturnType<typeof getSupabaseServer>,
  tracker: { quote_id?: string | null; user_id?: string | null },
  orgId: string,
): Promise<boolean> {
  if (tracker.quote_id) {
    const { data: quote } = await supabase
      .from('quotes')
      .select('organization_id')
      .eq('id', tracker.quote_id)
      .maybeSingle()
    if (quote?.organization_id === orgId) return true
  }

  if (tracker.user_id) {
    const { data: membership } = await supabase
      .from('user_organizations')
      .select('user_id')
      .eq('user_id', tracker.user_id)
      .eq('organization_id', orgId)
      .maybeSingle()
    if (membership) return true
  }

  return false
}

/**
 * Fetch a single tracker by its `tracker_token`, scoped to what `userId` is
 * allowed to see. Powers the portal-native `/order-tracker/[token]` deep link.
 *
 * Authorization (any one):
 *   - the tracker's `user_id` is the requester, or
 *   - the requester's email matches the tracker's `customer_email`, or
 *   - the requester is an `org_admin` of the org that owns the tracker — via its
 *     quote's `organization_id` or its owning user's membership (mirrors
 *     `getJobsForOrganization`, the list view's scoping).
 *
 * Returns `null` for an unknown token OR an unauthorised requester — callers
 * surface both as not-found, so a token guess never leaks another org's order.
 */
export async function getJobTrackerForUserByToken(
  token: string,
  userId: string,
  email?: string | null
): Promise<JobTracker | null> {
  try {
    const supabase = getSupabaseServer()

    const { data, error } = await supabase
      .from('job_trackers')
      .select('*')
      .eq('tracker_token', token)
      .maybeSingle()

    if (error) {
      if (error.code === '42P01') return null
      console.error('[JobTracker] Failed to fetch tracker by token:', error)
      return null
    }

    const tracker = data as JobTracker | null
    if (!tracker) return null

    // Sprint 3 reversed Feature #7: a stock-on-hand tracker is no longer treated
    // as not-found here — its deep link resolves to the simplified fulfilment card.
    // Authorization below is unchanged, so a token guess still can't leak an order.
    const ownsByUser = tracker.user_id === userId
    const ownsByEmail =
      !!email &&
      !!tracker.customer_email &&
      tracker.customer_email.toLowerCase() === email.toLowerCase()

    let authorized = ownsByUser || ownsByEmail

    if (!authorized) {
      const { data: membership } = await supabase
        .from('user_organizations')
        .select('organization_id, role')
        .eq('user_id', userId)
        .maybeSingle()

      if (membership?.role === 'org_admin' && membership.organization_id) {
        authorized = await trackerBelongsToOrg(supabase, tracker, membership.organization_id)
      }
    }

    if (!authorized) return null

    const [withImages] = await attachProductImages([tracker])
    return withImages
  } catch (err) {
    console.error('[JobTracker] Error fetching tracker by token:', err)
    return null
  }
}

export async function getJobTrackersByQuoteId(
  quoteId: string
): Promise<JobTracker[]> {
  try {
    const supabase = getSupabaseServer()

    const { data, error } = await supabase
      .from('job_trackers')
      .select('*')
      .eq('quote_id', quoteId)
      .order('created_at', { ascending: false })

    if (error) {
      if (error.code === '42P01') return []
      console.error('[JobTracker] Failed to fetch jobs by quote_id:', error)
      return []
    }

    return attachProductImages((data || []) as JobTracker[])
  } catch (error) {
    console.error('[JobTracker] Error fetching jobs by quote_id:', error)
    return []
  }
}

export async function getLatestJobTrackerByQuoteId(
  quoteId: string
): Promise<JobTracker | null> {
  try {
    const supabase = getSupabaseServer()

    const { data, error } = await supabase
      .from('job_trackers')
      .select('*')
      .eq('quote_id', quoteId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      if (error.code === '42P01') return null
      console.error('[JobTracker] Failed to fetch latest job by quote_id:', error)
      return null
    }

    if (!data) return null
    const [withImages] = await attachProductImages([data as JobTracker])
    return withImages
  } catch (error) {
    console.error('[JobTracker] Error fetching latest job by quote_id:', error)
    return null
  }
}
