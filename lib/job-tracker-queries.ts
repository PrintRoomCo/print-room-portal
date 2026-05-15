import { getSupabaseServer } from '@/lib/supabase'
import { resolveProductFrontImages } from '@/lib/product-images'
import type { JobTracker } from '@/lib/job-tracker'
import { syncJobTrackerItemsFromMonday } from '@/lib/monday/sync-job-tracker-items'

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
