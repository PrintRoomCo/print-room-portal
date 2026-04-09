import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase'
import {
  mapMondayToCollectionStatus,
  mapMondayToTrackerStatus,
} from '@/lib/monday/status-mappings'
import { sendTrackerStatusEmail } from '@/lib/email/tracker-notification'
import { detectCarrierFromUrl } from '@/lib/job-tracker'

interface MondayWebhookPayload {
  event?: {
    type: string
    boardId: number
    pulseId: number
    pulseName: string
    parentItemId?: number
    parentItemBoardId?: number
    columnId: string
    columnType: string
    columnTitle: string
    value: {
      label?: {
        index: number
        text: string
      }
    }
    previousValue?: {
      label?: {
        index: number
        text: string
      }
    }
  }
  challenge?: string
}

/**
 * Monday.com Webhook: Tracker Status + Collection Status
 *
 * Handles status changes from:
 * - Job tracker board → updates job_trackers + sends email
 * - Collections board → updates design_collections + design_submissions
 */
export async function POST(request: Request) {
  let payload: MondayWebhookPayload
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Monday challenge handshake
  if (payload.challenge) {
    return NextResponse.json({ challenge: payload.challenge })
  }

  const { event } = payload
  if (!event) {
    return NextResponse.json({ error: 'No event' }, { status: 400 })
  }

  // Only handle status column changes
  if (event.columnType !== 'color' && event.columnId !== 'status') {
    return NextResponse.json({ success: true, message: 'Ignored — not a status change' })
  }

  const supabase = getSupabaseServer()
  const boardId = Number(event.boardId)
  const collectionsBoardId = Number(
    process.env.MONDAY_COLLECTIONS_BOARD_ID || '5025641710'
  )

  // --- Collections board handler ---
  if (boardId === collectionsBoardId) {
    return handleCollectionsBoardEvent(supabase, event)
  }

  // --- Tracker board handler (default) ---
  return handleTrackerStatusChange(supabase, event)
}

async function handleCollectionsBoardEvent(
  supabase: ReturnType<typeof getSupabaseServer>,
  event: NonNullable<MondayWebhookPayload['event']>
) {
  const newStatus = mapMondayToCollectionStatus(
    event.value?.label?.index,
    event.value?.label?.text
  )

  if (!newStatus) {
    return NextResponse.json({ success: true, message: 'Ignored — unknown status' })
  }

  // Sub-item (design) status change
  if (event.parentItemId) {
    return handleDesignStatusChange(supabase, event, newStatus)
  }

  // Parent item (collection) status change
  return handleCollectionStatusChange(supabase, event, newStatus)
}

async function handleCollectionStatusChange(
  supabase: ReturnType<typeof getSupabaseServer>,
  event: NonNullable<MondayWebhookPayload['event']>,
  newStatus: 'pending_review' | 'approved' | 'rejected'
) {
  const mondayItemId = String(event.pulseId)

  const { data: collection, error } = await supabase
    .from('design_collections')
    .select('id, status')
    .eq('monday_item_id', mondayItemId)
    .single()

  if (error || !collection) {
    return NextResponse.json({ success: true, message: 'Collection not linked' })
  }

  if (newStatus === 'approved') {
    await supabase
      .from('design_collections')
      .update({
        status: 'approved',
        updated_at: new Date().toISOString(),
      })
      .eq('id', collection.id)

    // Also approve all designs in this collection
    await supabase
      .from('design_submissions')
      .update({ status: 'approved', reviewed_at: new Date().toISOString() })
      .eq('collection_id', collection.id)

    return NextResponse.json({ success: true, message: 'Collection approved' })
  }

  if (newStatus === 'rejected') {
    await supabase
      .from('design_collections')
      .update({
        status: 'rejected',
        notes: 'Rejected via Monday.com',
        updated_at: new Date().toISOString(),
      })
      .eq('id', collection.id)

    return NextResponse.json({ success: true, message: 'Collection rejected' })
  }

  return NextResponse.json({ success: true, message: 'Status noted' })
}

async function handleDesignStatusChange(
  supabase: ReturnType<typeof getSupabaseServer>,
  event: NonNullable<MondayWebhookPayload['event']>,
  newStatus: 'pending_review' | 'approved' | 'rejected'
) {
  const subitemId = String(event.pulseId)

  const { data: submission, error } = await supabase
    .from('design_submissions')
    .select('id, status')
    .eq('monday_subitem_id', subitemId)
    .single()

  if (error || !submission) {
    return NextResponse.json({ success: true, message: 'Design not linked' })
  }

  if (submission.status === newStatus) {
    return NextResponse.json({ success: true, message: 'Already processed' })
  }

  if (newStatus === 'approved') {
    await supabase
      .from('design_submissions')
      .update({
        status: 'approved',
        reviewed_at: new Date().toISOString(),
        reviewed_by: 'monday-webhook',
      })
      .eq('id', submission.id)

    return NextResponse.json({ success: true, message: 'Design approved' })
  }

  if (newStatus === 'rejected') {
    await supabase
      .from('design_submissions')
      .update({
        status: 'rejected',
        reviewed_at: new Date().toISOString(),
        reviewed_by: 'monday-webhook',
        notes: 'Rejected via Monday.com webhook',
      })
      .eq('id', submission.id)

    return NextResponse.json({ success: true, message: 'Design rejected' })
  }

  return NextResponse.json({ success: true, message: 'Status noted' })
}

async function handleTrackerStatusChange(
  supabase: ReturnType<typeof getSupabaseServer>,
  event: NonNullable<MondayWebhookPayload['event']>
) {
  const mondayItemId = String(event.pulseId)
  const newStatus = mapMondayToTrackerStatus(event.value?.label?.text)

  if (!newStatus) {
    return NextResponse.json({ success: true, message: 'Ignored — unknown tracker status' })
  }

  // Find tracker by monday_item_id or by pulse name matching job_reference
  const { data: tracker } = await supabase
    .from('job_trackers')
    .select('*')
    .or(`monday_item_id.eq.${mondayItemId},job_reference.eq.${event.pulseName}`)
    .limit(1)
    .maybeSingle()

  if (!tracker) {
    return NextResponse.json({ success: true, message: 'Tracker not linked' })
  }

  const nowIso = new Date().toISOString()

  // Append to status_history
  const statusEntry = {
    id: crypto.randomUUID(),
    status: newStatus,
    changed_at: nowIso,
    column_id: event.columnId,
    user_id: null,
  }

  const updateEntry = {
    id: crypto.randomUUID(),
    type: 'status',
    title: `Status updated to ${event.value?.label?.text || newStatus}`,
    body: `Status changed from "${event.previousValue?.label?.text || 'unknown'}" to "${event.value?.label?.text || newStatus}"`,
    changed_at: nowIso,
    source: 'system',
    metadata: { createdBy: 'monday-webhook' },
  }

  const history = Array.isArray(tracker.status_history) ? tracker.status_history : []
  const updates = Array.isArray(tracker.production_updates) ? tracker.production_updates : []

  await supabase
    .from('job_trackers')
    .update({
      status: newStatus,
      status_history: [...history, statusEntry],
      production_updates: [...updates, updateEntry],
    })
    .eq('id', tracker.id)

  // Send email notification (fire-and-forget)
  if (tracker.customer_email) {
    const trackingInfo = tracker.tracking_info as Record<string, string> | null
    const trackingUrl = trackingInfo?.url || null
    const carrier = trackingUrl ? detectCarrierFromUrl(trackingUrl) : null

    sendTrackerStatusEmail({
      contactEmail: tracker.customer_email,
      trackerToken: tracker.tracker_token,
      jobReference: tracker.job_reference,
      quoteNumber: tracker.quote_number || undefined,
      newStatus,
      trackingNumber: trackingInfo?.number || undefined,
      trackingUrl: trackingUrl || undefined,
      carrier: carrier || undefined,
    }).catch((err) => {
      console.error('[TrackerWebhook] Email send failed (non-blocking):', err)
    })
  }

  return NextResponse.json({
    success: true,
    message: `Tracker updated to ${newStatus}`,
    trackerId: tracker.id,
  })
}

export async function GET() {
  return NextResponse.json({ message: 'Monday.com tracker-status webhook endpoint' })
}
