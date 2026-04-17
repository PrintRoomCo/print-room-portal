import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase'
import {
  mapMondayToCollectionStatus,
  mapMondayToTrackerStatus,
} from '@/lib/monday/status-mappings'
import { sendTrackerStatusEmail } from '@/lib/email/tracker-notification'
import {
  detectCarrierFromUrl,
  getTrackingNumber,
  type StatusHistoryEntry,
  type ProductionUpdate,
  type TrackingInfo,
} from '@/lib/job-tracker'
import {
  PRODUCTION_BOARD_ID,
  PRODUCTION_COLUMNS,
} from '@/lib/monday/column-ids'
import { syncJobTrackerItemsFromMonday } from '@/lib/monday/sync-job-tracker-items'

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
      label?: { index: number; text: string }
      date?: string
      time?: string
    }
    previousValue?: {
      label?: { index: number; text: string }
      date?: string
      time?: string
    }
  }
  challenge?: string
}

const DUPLICATE_WINDOW_MS = 60_000

/**
 * Monday.com webhook: tracker status + collection status + tracker dates.
 */
export async function POST(request: Request) {
  let payload: MondayWebhookPayload
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (payload.challenge) {
    return NextResponse.json({ challenge: payload.challenge })
  }

  const { event } = payload
  if (!event) {
    return NextResponse.json({ error: 'No event' }, { status: 400 })
  }

  const supabase = getSupabaseServer()
  const boardId = Number(event.boardId)
  const collectionsBoardId = Number(
    process.env.MONDAY_COLLECTIONS_BOARD_ID || '5025641710'
  )

  if (boardId === collectionsBoardId) {
    if (event.columnType !== 'color' && event.columnId !== 'status') {
      return NextResponse.json({
        success: true,
        message: 'Ignored — not a status change',
      })
    }
    return handleCollectionsBoardEvent(supabase, event)
  }

  if (boardId === PRODUCTION_BOARD_ID && event.columnType === 'date') {
    return handleTrackerDateChange(supabase, event)
  }

  if (event.columnType !== 'color') {
    return NextResponse.json({
      success: true,
      message: 'Ignored — not a status or date change',
    })
  }

  if (boardId === PRODUCTION_BOARD_ID && event.columnId !== PRODUCTION_COLUMNS.mainStatus) {
    return NextResponse.json({
      success: true,
      message: 'Ignored — not the main status column',
    })
  }

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

  if (event.parentItemId) {
    return handleDesignStatusChange(supabase, event, newStatus)
  }
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
      .update({ status: 'approved', updated_at: new Date().toISOString() })
      .eq('id', collection.id)

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

async function findTrackerByEvent(
  supabase: ReturnType<typeof getSupabaseServer>,
  event: NonNullable<MondayWebhookPayload['event']>
) {
  const mondayItemId = String(event.pulseId)

  const { data } = await supabase
    .from('job_trackers')
    .select('*')
    .or(`monday_item_id.eq.${mondayItemId},job_reference.eq.${event.pulseName}`)
    .limit(1)
    .maybeSingle()

  return data
}

async function handleTrackerStatusChange(
  supabase: ReturnType<typeof getSupabaseServer>,
  event: NonNullable<MondayWebhookPayload['event']>
) {
  const displayLabel = event.value?.label?.text ?? ''
  const canonicalKey = mapMondayToTrackerStatus(displayLabel)

  if (!canonicalKey) {
    return NextResponse.json({
      success: true,
      message: 'Ignored — unknown tracker status',
    })
  }

  const tracker = await findTrackerByEvent(supabase, event)
  if (!tracker) {
    return NextResponse.json({ success: true, message: 'Tracker not linked' })
  }

  const history: StatusHistoryEntry[] = Array.isArray(tracker.status_history)
    ? (tracker.status_history as StatusHistoryEntry[])
    : []

  const lastEntry = history[history.length - 1]
  if (
    lastEntry?.status_key === canonicalKey &&
    Date.now() - new Date(lastEntry.changed_at).getTime() < DUPLICATE_WINDOW_MS
  ) {
    return NextResponse.json({ success: true, message: 'Duplicate ignored' })
  }

  const nowIso = new Date().toISOString()
  const previousLabel = event.previousValue?.label?.text ?? undefined

  const statusEntry: StatusHistoryEntry = {
    id: crypto.randomUUID(),
    status: displayLabel || canonicalKey,
    status_key: canonicalKey,
    previous_status: previousLabel,
    changed_at: nowIso,
    column_id: event.columnId,
    user_id: null,
  }

  const updates: ProductionUpdate[] = Array.isArray(tracker.production_updates)
    ? (tracker.production_updates as ProductionUpdate[])
    : []

  const updateEntry: ProductionUpdate = {
    id: crypto.randomUUID(),
    type: 'status',
    title: `Status updated to ${displayLabel || canonicalKey}`,
    body: `Status changed from "${previousLabel ?? 'unknown'}" to "${displayLabel || canonicalKey}"`,
    changed_at: nowIso,
    source: 'system',
    metadata: { createdBy: 'monday-webhook', status_key: canonicalKey },
  }

  const patch: Record<string, unknown> = {
    status: canonicalKey,
    status_history: [...history, statusEntry],
    production_updates: [...updates, updateEntry],
  }

  if (canonicalKey === 'proof-approved' && !tracker.design_approval_at) {
    patch.design_approval_at = nowIso
  }
  if (canonicalKey === 'in-production' && !tracker.production_start_at) {
    patch.production_start_at = nowIso
  }
  if (canonicalKey === 'dispatched' && !tracker.production_complete_at) {
    patch.production_complete_at = nowIso
  }

  const { error: updateErr } = await supabase
    .from('job_trackers')
    .update(patch)
    .eq('id', tracker.id)

  if (updateErr) {
    console.error('[TrackerWebhook] Update failed:', updateErr)
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  if (tracker.customer_email) {
    const trackingInfo = (tracker.tracking_info as TrackingInfo | null) ?? null
    const trackingUrl = trackingInfo?.url || null
    const carrier = trackingUrl ? detectCarrierFromUrl(trackingUrl) : null

    sendTrackerStatusEmail({
      contactEmail: tracker.customer_email,
      trackerToken: tracker.tracker_token,
      jobReference: tracker.job_reference,
      quoteNumber: tracker.quote_number || undefined,
      newStatus: canonicalKey,
      trackingNumber: getTrackingNumber(trackingInfo),
      trackingUrl: trackingUrl || undefined,
      carrier: carrier || undefined,
    }).catch((err) => {
      console.error('[TrackerWebhook] Email send failed (non-blocking):', err)
    })
  }

  if (process.env.ENABLE_MONDAY_ITEMS_SYNC === 'true') {
    syncJobTrackerItemsFromMonday(Number(tracker.id)).catch((err) => {
      console.error('[TrackerWebhook] Items sync failed (non-blocking):', err)
    })
  }

  return NextResponse.json({
    success: true,
    message: `Tracker updated to ${canonicalKey}`,
    trackerId: tracker.id,
  })
}

async function handleTrackerDateChange(
  supabase: ReturnType<typeof getSupabaseServer>,
  event: NonNullable<MondayWebhookPayload['event']>
) {
  if (
    event.columnId !== PRODUCTION_COLUMNS.shipDate &&
    event.columnId !== PRODUCTION_COLUMNS.inHandDate
  ) {
    return NextResponse.json({
      success: true,
      message: 'Ignored — not a tracked date column',
    })
  }

  const rawDate = event.value?.date
  if (!rawDate) {
    return NextResponse.json({ success: true, message: 'Ignored — cleared date' })
  }

  const time = event.value?.time || '00:00:00'
  const iso = new Date(`${rawDate}T${time}Z`).toISOString()
  if (Number.isNaN(Date.parse(iso))) {
    return NextResponse.json({ success: true, message: 'Ignored — invalid date' })
  }

  const tracker = await findTrackerByEvent(supabase, event)
  if (!tracker) {
    return NextResponse.json({ success: true, message: 'Tracker not linked' })
  }

  const { error } = await supabase
    .from('job_trackers')
    .update({ estimated_delivery_at: iso })
    .eq('id', tracker.id)

  if (error) {
    console.error('[TrackerWebhook] Date update failed:', error)
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    message: `Estimated delivery updated to ${iso}`,
    trackerId: tracker.id,
  })
}

export async function GET() {
  return NextResponse.json({ message: 'Monday.com tracker-status webhook endpoint' })
}
