import { NextResponse } from 'next/server'
import { getSupabaseServerComponent } from '@/lib/supabase-server-component'
import { getSupabaseServer } from '@/lib/supabase'
import { getJobsForUser, getJobsForCompany, getJobsForCustomer } from '@/lib/job-tracker-queries'

export async function GET() {
  const supabase = await getSupabaseServerComponent()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ trackers: [], isCompanyWide: false })
  }

  const adminClient = getSupabaseServer()

  // Check organization membership + role
  const { data: membership } = await adminClient
    .from('user_organizations')
    .select('organization_id, role')
    .eq('user_id', user.id)
    .single()

  let trackers: any[] = []
  let isCompanyWide = false

  try {
    const isAdmin = membership?.role === 'admin' || membership?.role === 'manager'

    if (isAdmin && membership?.organization_id) {
      // Get company's B2B account to find company_id
      const { data: b2bAccount } = await adminClient
        .from('b2b_accounts')
        .select('company_id')
        .eq('organization_id', membership.organization_id)
        .single()

      if (b2bAccount?.company_id) {
        // Get location IDs for this company
        const { data: stores } = await adminClient
          .from('stores')
          .select('id')
          .eq('organization_id', membership.organization_id)

        const locationIds = stores?.map((s) => s.id) || []
        trackers = await getJobsForCompany(b2bAccount.company_id, locationIds)
        isCompanyWide = trackers.length > 0
      }
    }

    // Fallback to user-level lookup
    if (trackers.length === 0) {
      trackers = await getJobsForUser(user.id, user.email || undefined)
      isCompanyWide = false
    }
  } catch (error) {
    console.error('[OrderTracker API] Failed to fetch trackers:', error)
  }

  return NextResponse.json({ trackers, isCompanyWide })
}
