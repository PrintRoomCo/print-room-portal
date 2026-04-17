import { NextResponse } from 'next/server'
import { getSupabaseServerComponent } from '@/lib/supabase-server-component'
import { getSupabaseServer } from '@/lib/supabase'
import { buildReorderDataFromTracker, createReorderItem } from '@/lib/monday/reorder'
import { isTrackerCompleted, type JobTracker } from '@/lib/job-tracker'

interface ReorderBody {
  trackerId: number | string
  deliveryAddress: string
  inHandDate: string
  quantity?: number
  notes?: string
  artworkUrls?: string[]
}

const SUPABASE_PUBLIC_URL_PREFIX = '/storage/v1/object/public/'
const MAX_ARTWORK_URLS = 5

function badRequest(error: string, field?: string) {
  return NextResponse.json({ error, field }, { status: 400 })
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value)
}

function isTodayOrLater(value: string): boolean {
  const target = new Date(`${value}T00:00:00Z`).getTime()
  const now = new Date()
  const todayUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  )
  return target >= todayUtc
}

function isAllowedArtworkUrl(url: string): boolean {
  if (typeof url !== 'string') return false
  if (!url.startsWith('https://')) return false
  if (url.length > 1024) return false
  return url.includes(SUPABASE_PUBLIC_URL_PREFIX)
}

export async function POST(request: Request) {
  const supabase = await getSupabaseServerComponent()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user || !user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: ReorderBody
  try {
    body = (await request.json()) as ReorderBody
  } catch {
    return badRequest('Invalid request body')
  }

  if (!body.trackerId) return badRequest('trackerId is required', 'trackerId')

  const deliveryAddress = (body.deliveryAddress ?? '').trim()
  if (deliveryAddress.length < 6 || deliveryAddress.length > 500) {
    return badRequest(
      'Delivery address must be between 6 and 500 characters',
      'deliveryAddress'
    )
  }

  const inHandDate = (body.inHandDate ?? '').trim()
  if (!isValidIsoDate(inHandDate)) {
    return badRequest('In-hand date must be a valid YYYY-MM-DD date', 'inHandDate')
  }
  if (!isTodayOrLater(inHandDate)) {
    return badRequest('In-hand date cannot be in the past', 'inHandDate')
  }

  let quantity: number | undefined
  if (body.quantity !== undefined && body.quantity !== null) {
    if (
      typeof body.quantity !== 'number' ||
      !Number.isInteger(body.quantity) ||
      body.quantity <= 0 ||
      body.quantity > 100000
    ) {
      return badRequest('Quantity must be a positive integer', 'quantity')
    }
    quantity = body.quantity
  }

  const notes = body.notes ? String(body.notes).slice(0, 5000) : undefined

  let artworkUrls: string[] | undefined
  if (Array.isArray(body.artworkUrls) && body.artworkUrls.length > 0) {
    if (body.artworkUrls.length > MAX_ARTWORK_URLS) {
      return badRequest(`At most ${MAX_ARTWORK_URLS} artwork files`, 'artworkUrls')
    }
    for (const url of body.artworkUrls) {
      if (!isAllowedArtworkUrl(url)) {
        return badRequest('Artwork URLs must be Supabase storage URLs', 'artworkUrls')
      }
    }
    artworkUrls = body.artworkUrls
  }

  const adminClient = getSupabaseServer()

  const { data: tracker, error: trackerError } = await adminClient
    .from('job_trackers')
    .select('*')
    .eq('id', body.trackerId)
    .single<JobTracker>()

  if (trackerError || !tracker) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  if (tracker.customer_email?.toLowerCase() !== user.email.toLowerCase()) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  if (!isTrackerCompleted(tracker.status)) {
    return NextResponse.json(
      { error: 'Reorder is only available on completed projects' },
      { status: 400 }
    )
  }

  try {
    const reorderData = buildReorderDataFromTracker(tracker, {
      customerEmail: user.email,
      customerName: tracker.customer_name || user.email,
      deliveryAddress,
      inHandDate,
      quantity,
      notes,
      artworkUrls,
    })

    const result = await createReorderItem(reorderData)

    return NextResponse.json({ success: true, mondayItemId: result.itemId })
  } catch (err) {
    console.error('[Reorder API] Failed to create Monday item:', err)
    return NextResponse.json(
      { error: 'Failed to submit reorder request. Please try again.' },
      { status: 502 }
    )
  }
}
