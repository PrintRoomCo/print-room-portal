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
  let tracker: TrackerRow | null = null
  if (payload.order_number) {
    const { data } = await supabase
      .from('job_trackers')
      .select(JOB_SELECT)
      .or(
        `job_reference.eq.${payload.order_number},` +
          `quote_number.eq.${payload.order_number},` +
          `tracker_token.eq.${payload.order_number}`,
      )
      .limit(1)
      .maybeSingle()
    tracker = (data as TrackerRow | null) ?? null
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

  // 3. Log every hit (matched or not) — mirrors the studio receiver.
  await supabase.from('starshipit_webhook_logs').insert({
    order_number: payload.order_number ?? null,
    tracking_number: payload.tracking_number ?? null,
    tracking_status: payload.tracking_status ?? null,
    carrier_name: payload.carrier_name ?? null,
    carrier_service: payload.carrier_service ?? null,
    payload,
    matched_job_tracker_id: tracker ? Number(tracker.id) : null,
    status: tracker ? 'matched' : 'unmatched',
    processed_at: new Date().toISOString(),
  })

  if (!tracker) {
    return NextResponse.json({ success: true, matched: false })
  }

  // 4. Supplement: write tracking_info + append a 'tracking' production_update.
  //    NB deliberately does NOT flip job_trackers.status or send an email —
  //    that is the supersede-vs-supplement decision (see Decision gate).
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
  if (error) {
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  revalidateTag(cacheTags.orderTracker, { expire: 0 })

  return NextResponse.json({ success: true, matched: true, trackerId: tracker.id })
}

export async function GET() {
  return NextResponse.json({ message: 'Starshipit webhook endpoint' })
}
