import { getSupabaseServer } from '@/lib/supabase'
import { resolveProductFrontImages } from '@/lib/product-images'
import type { JobTracker } from '@/lib/job-tracker'
import { syncJobTrackerItemsFromMonday } from '@/lib/monday/sync-job-tracker-items'

const STALE_SYNC_INTERVAL_MS = 60 * 60 * 1000
const STALE_SYNC_CONCURRENCY = 10
const STALE_SYNC_PER_CALL_TIMEOUT_MS = 2000

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

async function attachProductImages(trackers: JobTracker[]): Promise<JobTracker[]> {
  if (trackers.length === 0) return trackers

  const productIds = new Set<string>()
  for (const tracker of trackers) {
    const items = tracker.quote_data?.items ?? []
    for (const item of items) {
      if (item?.productId) productIds.add(item.productId)
    }
  }

  if (productIds.size === 0) return trackers

  const imageMap = await resolveProductFrontImages(Array.from(productIds))

  return trackers.map((tracker) => {
    const items = tracker.quote_data?.items ?? []
    const trackerImages: Record<string, string> = {}
    for (const item of items) {
      if (item?.productId && imageMap[item.productId]) {
        trackerImages[item.productId] = imageMap[item.productId]
      }
    }
    return Object.keys(trackerImages).length > 0
      ? { ...tracker, productImagesByProductId: trackerImages }
      : tracker
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

export async function getJobsForCompany(
  companyId: string,
  locationIds?: string[]
): Promise<JobTracker[]> {
  try {
    const supabase = getSupabaseServer()

    let query = supabase
      .from('job_trackers')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })

    if (locationIds && locationIds.length > 0) {
      query = query.in('location_id', locationIds)
    }

    const { data, error } = await query

    if (error) {
      if (error.code === '42P01') return []
      console.error('[JobTracker] Failed to fetch company jobs:', error)
      return []
    }

    const trackers = (data || []) as JobTracker[]
    fireAndForgetItemsSync(trackers)
    return attachProductImages(trackers)
  } catch (error) {
    console.error('[JobTracker] Error fetching company jobs:', error)
    return []
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
