import { getSupabaseServer } from '@/lib/supabase'
import type { JobTracker } from '@/lib/job-tracker'

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
      return data as JobTracker[]
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

    return (data || []) as JobTracker[]
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

    return (data || []) as JobTracker[]
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

    return (data || []) as JobTracker[]
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

    return (data as JobTracker | null) ?? null
  } catch (error) {
    console.error('[JobTracker] Error fetching latest job by quote_id:', error)
    return null
  }
}
