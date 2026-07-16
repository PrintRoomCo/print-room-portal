// app/api/webhooks/starshipit/route.ts
import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { getSupabaseServer } from '@/lib/supabase'
import { cacheTags } from '@/lib/cache/tags'
import type { TrackingInfo, ProductionUpdate } from '@/lib/job-tracker'
import { verifyStarshipitWebhookSecret } from '@/lib/starshipit/verify-webhook'
import {
  applyStarshipitWebhook,
  type StarshipitWebhookPayload,
} from '@/lib/starshipit/apply-webhook'

const JOB_SELECT =
  'id, tracker_token, job_reference, quote_number, tracking_info, production_updates'

type TrackerRow = {
  id: string | number
  tracker_token: string
  job_reference: string | null
  quote_number: string | null
  tracking_info: TrackingInfo | null
  production_updates: ProductionUpdate[] | null
}

export async function POST(request: Request) {
  // 1. Fail-closed secret check (dark-by-default via STARSHIPIT_WEBHOOK_SECRET).
  const url = new URL(request.url)
  const authorized = verifyStarshipitWebhookSecret({
    configuredSecret: process.env.STARSHIPIT_WEBHOOK_SECRET,
    querySecret: url.searchParams.get('secret'),
    headerSecret:
      request.headers.get('x-starshipit-secret') ||
      request.headers.get('x-starshipit-hmac'),
  })
  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let payload: StarshipitWebhookPayload
  try {
    payload = (await request.json()) as StarshipitWebhookPayload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!payload.order_number && !payload.tracking_number) {
    return NextResponse.json(
      { error: 'Missing order_number and tracking_number' },
      { status: 400 },
    )
  }

  const supabase = getSupabaseServer()

  // 2. Match on the portal's OWN reference first, then a clean tracking number.
  //    Sequential .eq() lookups, NEVER string-interpolated .or(): the payload
  //    is attacker-influencable (single shared secret, no HMAC) and .or() does
  //    not escape PostgREST filter grammar, so an order_number like
  //    "X,job_reference.neq." would widen the match to an arbitrary row on a
  //    service-role (RLS-bypassing) client. .eq() binds the value safely.
  let tracker: TrackerRow | null = null
  if (payload.order_number) {
    for (const column of ['job_reference', 'quote_number', 'tracker_token'] as const) {
      const { data } = await supabase
        .from('job_trackers')
        .select(JOB_SELECT)
        .eq(column, payload.order_number)
        .limit(1)
        .maybeSingle()
      tracker = (data as TrackerRow | null) ?? null
      if (tracker) break
    }
  }
  if (!tracker && payload.tracking_number) {
    const { data } = await supabase
      .from('job_trackers')
      .select(JOB_SELECT)
      .eq('tracking_info->>trackingNumber', payload.tracking_number)
      .limit(1)
      .maybeSingle()
    tracker = (data as TrackerRow | null) ?? null
  }

  // 3. Supplement: write tracking_info + append a 'tracking' production_update.
  //    NB deliberately does NOT flip job_trackers.status or send an email —
  //    that is the supersede-vs-supplement decision (see Decision gate).
  let updateError: string | null = null
  if (tracker) {
    const { trackingInfo, productionUpdate } = applyStarshipitWebhook(
      tracker.tracking_info,
      payload,
    )
    const updates = Array.isArray(tracker.production_updates)
      ? tracker.production_updates
      : []

    const { error } = await supabase
      .from('job_trackers')
      .update({
        tracking_info: trackingInfo,
        production_updates: [...updates, productionUpdate],
      })
      .eq('id', tracker.id)
    updateError = error ? error.message : null
  }

  // 4. Log every hit (matched or not) — mirrors the studio receiver. Written
  //    AFTER the tracker update so a failed write is recorded as an error
  //    instead of a false 'matched' row with no indication anything failed.
  await supabase.from('starshipit_webhook_logs').insert({
    order_number: payload.order_number ?? null,
    tracking_number: payload.tracking_number ?? null,
    tracking_status: payload.tracking_status ?? null,
    carrier_name: payload.carrier_name ?? null,
    carrier_service: payload.carrier_service ?? null,
    payload,
    matched_job_tracker_id: tracker ? Number(tracker.id) : null,
    status: updateError ? 'error' : tracker ? 'matched' : 'unmatched',
    error: updateError,
    processed_at: new Date().toISOString(),
  })

  if (!tracker) {
    return NextResponse.json({ success: true, matched: false })
  }
  if (updateError) {
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  revalidateTag(cacheTags.orderTracker, { expire: 0 })

  return NextResponse.json({ success: true, matched: true, trackerId: tracker.id })
}

export async function GET() {
  return NextResponse.json({ message: 'Starshipit webhook endpoint' })
}
