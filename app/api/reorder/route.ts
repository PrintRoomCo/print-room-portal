import { NextResponse } from 'next/server'
import { getSupabaseServerComponent } from '@/lib/supabase-server-component'
import { getSupabaseServer } from '@/lib/supabase'
import { createReorderItem } from '@/lib/monday/reorder'

export async function POST(request: Request) {
  const supabase = await getSupabaseServerComponent()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user || !user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { trackerId: number; changes: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!body.trackerId) {
    return NextResponse.json({ error: 'trackerId is required' }, { status: 400 })
  }

  const adminClient = getSupabaseServer()

  // Look up the tracker and verify ownership
  const { data: tracker, error: trackerError } = await adminClient
    .from('job_trackers')
    .select('*')
    .eq('id', body.trackerId)
    .single()

  if (trackerError || !tracker) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  // Verify ownership — customer_email must match authenticated user
  if (tracker.customer_email?.toLowerCase() !== user.email.toLowerCase()) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  try {
    const result = await createReorderItem({
      customerEmail: user.email,
      customerName: tracker.customer_name || user.email,
      companyName: null,
      originalQuoteNumber: tracker.quote_number,
      originalJobReference: tracker.job_reference,
      mondayProjectName: tracker.monday_project_name,
      proofFiles: tracker.proof_files || [],
      changes: body.changes || '',
    })

    return NextResponse.json({ success: true, mondayItemId: result.itemId })
  } catch (err) {
    console.error('[Reorder API] Failed to create Monday item:', err)
    return NextResponse.json(
      { error: 'Failed to submit reorder request. Please try again.' },
      { status: 500 }
    )
  }
}
