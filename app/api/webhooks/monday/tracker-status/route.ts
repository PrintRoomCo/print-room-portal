import { NextResponse, after } from 'next/server'
import { revalidateTag } from 'next/cache'
import { getSupabaseServer } from '@/lib/supabase'
import { cacheTags } from '@/lib/cache/tags'
import { mapMondayToCollectionStatus } from '@/lib/monday/status-mappings'
import { deriveStatusValue } from '@/lib/monday/tracker-status-engine'
import { sendTrackerStatusEmail } from '@/lib/email/tracker-notification'
import { milestoneForLabel, milestoneEmailType } from '@/lib/email/milestone-email'
import { fetchCustomerTrackingUrl } from '@/lib/monday/tracking-link'
import { isTrackerTestOrg } from '@/lib/orders/tracker-test-org'
import {
  hasEmailBeenSent,
  recordEmailSend,
} from '@/lib/email/tracker-email-log'
import { logWebhookEvent, markWebhookLog } from '@/lib/monday/webhook-log'
import { mirrorStatusToQuote } from '@/lib/monday/quote-mirror'
import {
  provisionTrackerForJobReferenceEvent,
  provisionTrackerForCreateEvent,
  handleTrackerTokenEvent,
} from '@/lib/monday/tracker-provisioning'
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
import { pushOrderOnProductionComplete } from '@/lib/starshipit/push-on-production-complete'

interface MondayWebhookPayload {
  event?: {
    type: string
    boardId: number
    pulseId: number
    pulseName: string
    parentItemId?: number
    parentItemBoardId?: number
    // Absent on item-create events; text columns carry `text`/`value`.
    columnId?: string
    columnType?: string
    columnTitle?: string
    // Monday's event timestamp — stable across at-least-once re-delivery, so it
    // keys status_history.changed_at and the email de-dup type.
    triggerTime?: string
    userId?: number
    value?: {
      label?: { index: number; text: string }
      text?: string
      value?: string
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

  // Monday's verification handshake carries no secret — answer it first.
  if (payload.challenge) {
    return NextResponse.json({ challenge: payload.challenge })
  }

  // Webhook authenticity (spec §G). Enforced only once MONDAY_WEBHOOK_SECRET is
  // configured, so the currently-live Shipped-only subscription (no secret in
  // its URL) keeps working until the cutover recreates the subscriptions.
  const secret = process.env.MONDAY_WEBHOOK_SECRET
  if (secret) {
    const provided = new URL(request.url).searchParams.get('secret')
    if (provided !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
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

  // Monday-origin provisioning + tracker-link validation (production board).
  // These text/create events only start firing once the cutover repoints their
  // subscriptions at the portal — inert before then.
  if (boardId === PRODUCTION_BOARD_ID) {
    if (
      !event.columnId &&
      typeof event.type === 'string' &&
      event.type.toLowerCase().includes('create')
    ) {
      return handleCreateEvent(supabase, event)
    }
    if (event.columnId === PRODUCTION_COLUMNS.poRef) {
      return handleJobReferenceEvent(supabase, event)
    }
    if (event.columnId === PRODUCTION_COLUMNS.trackerUrl) {
      return handleTrackerTokenColumnEvent(supabase, event)
    }
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

    revalidateTag(cacheTags.accountData, { expire: 0 })
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

    revalidateTag(cacheTags.accountData, { expire: 0 })
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

    revalidateTag(cacheTags.accountData, { expire: 0 })
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

    revalidateTag(cacheTags.accountData, { expire: 0 })
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

/** Extract a plain text value from a Monday text-column event payload. */
function textFromEventValue(
  event: NonNullable<MondayWebhookPayload['event']>
): string | null {
  return event.value?.text ?? event.value?.value ?? event.value?.label?.text ?? null
}

/** Item-create → provision a tracker if the item already has a valid job ref. */
async function handleCreateEvent(
  supabase: ReturnType<typeof getSupabaseServer>,
  event: NonNullable<MondayWebhookPayload['event']>
) {
  const mondayItemId = String(event.pulseId)
  const logId = await logWebhookEvent(supabase, {
    mondayItemId,
    boardId: event.boardId,
    columnId: null,
    eventType: event.type,
    payload: { pulseId: event.pulseId, type: event.type, triggerTime: event.triggerTime },
  })
  const r = await provisionTrackerForCreateEvent({ admin: supabase, mondayItemId, boardId: event.boardId })
  await markWebhookLog(supabase, logId, { status: r.logStatus, notes: r.logNotes ?? null })
  return NextResponse.json(r.body, { status: r.statusCode })
}

/** Job Reference (text_mkqxcmvz) set/changed → provision keyed on the ref. */
async function handleJobReferenceEvent(
  supabase: ReturnType<typeof getSupabaseServer>,
  event: NonNullable<MondayWebhookPayload['event']>
) {
  const mondayItemId = String(event.pulseId)
  const jobReference = textFromEventValue(event)
  const logId = await logWebhookEvent(supabase, {
    mondayItemId,
    boardId: event.boardId,
    columnId: event.columnId ?? null,
    eventType: event.type,
    payload: { value: event.value, triggerTime: event.triggerTime },
  })
  if (!jobReference) {
    await markWebhookLog(supabase, logId, { status: 'noop', notes: 'Job Reference cleared' })
    return NextResponse.json({ success: true, action: 'noop', message: 'Job Reference cleared' })
  }
  const r = await provisionTrackerForJobReferenceEvent({
    admin: supabase,
    mondayItemId,
    boardId: event.boardId,
    jobReference,
  })
  await markWebhookLog(supabase, logId, { status: r.logStatus, notes: r.logNotes ?? null })
  return NextResponse.json(r.body, { status: r.statusCode })
}

/** Tracker-link column (text_mkxvmsha) pasted → validate against the job ref. */
async function handleTrackerTokenColumnEvent(
  supabase: ReturnType<typeof getSupabaseServer>,
  event: NonNullable<MondayWebhookPayload['event']>
) {
  const mondayItemId = String(event.pulseId)
  const pastedValue = textFromEventValue(event)
  const tracker = await findTrackerByEvent(supabase, event)
  const logId = await logWebhookEvent(supabase, {
    mondayItemId,
    boardId: event.boardId,
    columnId: event.columnId ?? null,
    eventType: event.type,
    payload: { value: event.value, triggerTime: event.triggerTime },
  })
  const r = await handleTrackerTokenEvent({
    admin: supabase,
    mondayItemId,
    boardId: event.boardId,
    pastedValue,
    tracker: tracker
      ? { job_reference: tracker.job_reference, tracker_token: tracker.tracker_token }
      : null,
  })
  await markWebhookLog(supabase, logId, { status: r.applied ? 'processed' : 'noop' })
  return NextResponse.json({ success: true, applied: r.applied, correctedTo: r.correctedTo ?? null })
}

async function handleTrackerStatusChange(
  supabase: ReturnType<typeof getSupabaseServer>,
  event: NonNullable<MondayWebhookPayload['event']>
) {
  const displayLabel = event.value?.label?.text ?? ''
  const mondayItemId = String(event.pulseId)
  const columnId = event.columnId ?? PRODUCTION_COLUMNS.mainStatus

  const logId = await logWebhookEvent(supabase, {
    mondayItemId,
    boardId: event.boardId,
    columnId,
    eventType: event.type,
    payload: {
      value: event.value,
      previousValue: event.previousValue,
      triggerTime: event.triggerTime,
      userId: event.userId,
    },
  })

  // Trigger time is stable across Monday's at-least-once re-delivery — key
  // status_history + the email de-dup on it (falls back to now()).
  const changedAt =
    event.triggerTime && !Number.isNaN(Date.parse(event.triggerTime))
      ? new Date(event.triggerTime).toISOString()
      : new Date().toISOString()

  const tracker = await findTrackerByEvent(supabase, event)
  const derived = deriveStatusValue(displayLabel, { previousStatus: tracker?.status ?? null })

  // Inventory decrement: subitem dispatched event — independent of the parent
  // tracker, so it runs even when the subitem has no tracker row of its own.
  if (event.parentItemId && derived.canonical === 'dispatched') {
    const { shipMondaySubitem } = await import('@/lib/inventory/ship-quote-line')
    await shipMondaySubitem(supabase, String(event.pulseId), event.pulseName ?? null, event)
  }

  if (!tracker) {
    await markWebhookLog(supabase, logId, { status: 'missing-job' })
    return NextResponse.json({ success: true, message: 'Tracker not linked' })
  }

  // Internal / hold / unknown → never advance the customer tracker, never email.
  if (!derived.isCustomerFacing) {
    await markWebhookLog(supabase, logId, {
      status: 'noop',
      notes: derived.preserveExisting ? 'hold/internal — preserved previous' : 'unknown status — ignored',
    })
    return NextResponse.json({ success: true, message: 'Ignored — non-customer-facing status' })
  }

  const canonicalKey = derived.storageValue as string

  // Idempotency (issue #77 gap c): if the tracker is already at this stage
  // (e.g. the studio poller landed the same transition first), do nothing —
  // no duplicate history, no duplicate email.
  if (canonicalKey === tracker.status) {
    await markWebhookLog(supabase, logId, { status: 'noop', notes: 'status unchanged' })
    return NextResponse.json({ success: true, message: 'No status change' })
  }

  const history: StatusHistoryEntry[] = Array.isArray(tracker.status_history)
    ? (tracker.status_history as StatusHistoryEntry[])
    : []

  const lastEntry = history[history.length - 1]
  if (
    lastEntry?.status_key === canonicalKey &&
    Date.now() - new Date(lastEntry.changed_at).getTime() < DUPLICATE_WINDOW_MS
  ) {
    await markWebhookLog(supabase, logId, { status: 'noop', notes: 'duplicate within window' })
    return NextResponse.json({ success: true, message: 'Duplicate ignored' })
  }

  const previousLabel = event.previousValue?.label?.text ?? undefined

  const statusEntry: StatusHistoryEntry = {
    id: crypto.randomUUID(),
    status: displayLabel || canonicalKey,
    status_key: canonicalKey,
    previous_status: previousLabel,
    changed_at: changedAt,
    column_id: columnId,
    user_id: event.userId != null ? String(event.userId) : null,
  }

  const updates: ProductionUpdate[] = Array.isArray(tracker.production_updates)
    ? (tracker.production_updates as ProductionUpdate[])
    : []

  const updateEntry: ProductionUpdate = {
    id: crypto.randomUUID(),
    type: 'status',
    title: `Status updated to ${displayLabel || canonicalKey}`,
    body: `Status changed from "${previousLabel ?? 'unknown'}" to "${displayLabel || canonicalKey}"`,
    changed_at: changedAt,
    source: 'system',
    metadata: { createdBy: 'monday-webhook', status_key: canonicalKey },
  }

  const patch: Record<string, unknown> = {
    status: canonicalKey,
    status_history: [...history, statusEntry],
    production_updates: [...updates, updateEntry],
  }

  if (canonicalKey === 'proof-approved' && !tracker.design_approval_at) {
    patch.design_approval_at = changedAt
  }
  if (canonicalKey === 'in-production' && !tracker.production_start_at) {
    patch.production_start_at = changedAt
  }
  if (canonicalKey === 'dispatched' && !tracker.production_complete_at) {
    patch.production_complete_at = changedAt
  }

  const { error: updateErr } = await supabase
    .from('job_trackers')
    .update(patch)
    .eq('id', tracker.id)

  if (updateErr) {
    console.error('[TrackerWebhook] Update failed:', updateErr)
    await markWebhookLog(supabase, logId, { status: 'failed', error: updateErr.message })
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  // Tracker status flipped → portal order-tracker + account quote-status overlay both stale.
  revalidateTag(cacheTags.orderTracker, { expire: 0 })
  revalidateTag(cacheTags.accountData, { expire: 0 })

  await markWebhookLog(supabase, logId, { status: 'processed' })

  // Best-effort side-effects, deferred past the response (spec §C/§E). Email is
  // de-duped per transition on the Monday trigger time; the quote mirror is
  // inert unless ENABLE_QUOTE_STATUS_MIRROR is set.
  after(async () => {
    // Customer milestone email — gated on the RAW Monday label (not the coarse
    // canonical status): only "in production" and "shipped" push. Every other
    // customer-facing transition updates the tracker silently (pull-only).
    const milestone = tracker.customer_email ? milestoneForLabel(displayLabel) : null
    if (milestone) {
      const emailType = milestoneEmailType(milestone)
      const already = await hasEmailBeenSent(supabase, { mondayItemId, emailType })
      // Only pay for the is_test lookup when we are actually about to send.
      const suppressed = already || (await isTrackerTestOrg(supabase, tracker.quote_id))
      if (!suppressed) {
        // Dispatched tracking is read from the Monday item (poller-independent);
        // in-production carries no tracking. Precedence: customer link column →
        // legacy tracking_info → none (email sends with "tracking to follow").
        let trackingUrl: string | undefined
        let trackingNumber: string | undefined
        if (milestone === 'dispatched') {
          const fromMonday = await fetchCustomerTrackingUrl(mondayItemId)
          const legacy = (tracker.tracking_info as TrackingInfo | null)?.url ?? null
          trackingUrl = fromMonday || legacy || undefined
          trackingNumber = trackingUrl ? getTrackingNumber({ number: trackingUrl }) : undefined
        }
        const carrier = trackingUrl ? detectCarrierFromUrl(trackingUrl) ?? undefined : undefined

        const result = await sendTrackerStatusEmail({
          contactEmail: tracker.customer_email as string,
          trackerToken: tracker.tracker_token,
          jobReference: tracker.job_reference,
          quoteNumber: tracker.quote_number || undefined,
          newStatus: milestone,
          trackingNumber,
          trackingUrl,
          carrier,
        })
        await recordEmailSend(supabase, {
          mondayItemId,
          trackerToken: tracker.tracker_token,
          customerEmail: tracker.customer_email,
          emailType,
          emailSent: result.success,
          errorMessage: result.error,
          triggerType: 'automatic',
        })
      }
    }

    if (tracker.quote_id) {
      await mirrorStatusToQuote(supabase, {
        quoteId: tracker.quote_id,
        rawMondayStatus: displayLabel,
        columnId,
        changedAt,
        userId: event.userId,
      })
    }

    if (tracker.quote_id) {
      // Made-to-order Starshipit bridge — self-filtering on flag + label,
      // never throws. See lib/starshipit/push-on-production-complete.ts.
      await pushOrderOnProductionComplete(supabase, {
        quoteId: tracker.quote_id,
        displayLabel,
      })
    }
  })

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

  revalidateTag(cacheTags.orderTracker, { expire: 0 })

  return NextResponse.json({
    success: true,
    message: `Estimated delivery updated to ${iso}`,
    trackerId: tracker.id,
  })
}

export async function GET() {
  return NextResponse.json({ message: 'Monday.com tracker-status webhook endpoint' })
}
