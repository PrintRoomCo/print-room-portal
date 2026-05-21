import { NextResponse } from 'next/server'
import { getSupabaseServerComponent } from '@/lib/supabase-server-component'
import { getSupabaseServer } from '@/lib/supabase'
import { buildReorderDataFromTracker, createReorderItem } from '@/lib/monday/deal-item'
import { isTrackerCompleted, type JobTracker } from '@/lib/job-tracker'
import {
  REORDER_EDITABLE_LINE_ITEMS,
  type ReorderEditedItem,
  MAX_PRODUCT_NAME_LENGTH,
  MAX_COLOR_LENGTH,
  MAX_SIZE_LABEL_LENGTH,
  MAX_SIZE_QTY,
} from '@/lib/config/reorder'

interface ReorderBody {
  trackerId: number | string
  deliveryAddress: string
  inHandDate: string
  quantity?: number
  notes?: string
  artworkUrls?: string[]
  editedItems?: unknown
}

function validateEditedItems(
  raw: unknown,
  sourceCount: number,
): { ok: true; items: ReorderEditedItem[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: 'editedItems must be an array' }
  const items: ReorderEditedItem[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      return { ok: false, error: 'Each editedItems entry must be an object' }
    }
    const e = entry as Record<string, unknown>
    const sourceIndex = e.source_index
    if (
      typeof sourceIndex !== 'number' ||
      !Number.isInteger(sourceIndex) ||
      sourceIndex < 0 ||
      sourceIndex >= sourceCount
    ) {
      return { ok: false, error: 'source_index out of range' }
    }
    const productName = e.product_name
    if (typeof productName !== 'string' || productName.length > MAX_PRODUCT_NAME_LENGTH) {
      return { ok: false, error: 'product_name invalid' }
    }
    const color = e.color
    if (color !== null && (typeof color !== 'string' || color.length > MAX_COLOR_LENGTH)) {
      return { ok: false, error: 'color invalid' }
    }
    const sizes = e.sizes
    if (!sizes || typeof sizes !== 'object' || Array.isArray(sizes)) {
      return { ok: false, error: 'sizes must be an object' }
    }
    const cleanSizes: Record<string, number> = {}
    for (const [k, v] of Object.entries(sizes as Record<string, unknown>)) {
      if (k.length === 0 || k.length > MAX_SIZE_LABEL_LENGTH) {
        return { ok: false, error: 'size label invalid' }
      }
      if (
        typeof v !== 'number' ||
        !Number.isFinite(v) ||
        v < 0 ||
        v > MAX_SIZE_QTY
      ) {
        return { ok: false, error: 'size quantity invalid' }
      }
      cleanSizes[k] = Math.floor(v)
    }
    const included = e.included
    if (typeof included !== 'boolean') {
      return { ok: false, error: 'included must be boolean' }
    }
    items.push({
      source_index: sourceIndex,
      product_name: productName,
      color: color === null ? null : (color as string),
      sizes: cleanSizes,
      included,
    })
  }
  return { ok: true, items }
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

  const { data: orgMembership } = await adminClient
    .from('user_organizations')
    .select('organization_id')
    .eq('user_id', user.id)
    .maybeSingle()
  const organizationId = orgMembership?.organization_id ?? null

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

  let editedItems: ReorderEditedItem[] | undefined
  if (REORDER_EDITABLE_LINE_ITEMS && body.editedItems !== undefined) {
    const sourceCount = (tracker.quote_data?.items ?? []).length
    const validated = validateEditedItems(body.editedItems, sourceCount)
    if (!validated.ok) return badRequest(validated.error, 'editedItems')
    editedItems = validated.items
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
      editedItems,
    })

    const result = await createReorderItem(reorderData)

    const { error: persistErr } = await adminClient
      .from('reorder_requests')
      .insert({
        organization_id: organizationId,
        user_id: user.id,
        tracker_id: tracker.id,
        monday_item_id: result.itemId,
        payload: {
          delivery_address: deliveryAddress,
          in_hand_date: inHandDate,
          quantity: quantity ?? null,
          notes: notes ?? null,
          artwork_urls: artworkUrls ?? [],
          customer_email: user.email,
          customer_name: tracker.customer_name ?? null,
          original_quote_number: tracker.quote_number ?? null,
          original_job_reference: tracker.job_reference ?? null,
          edited_items: editedItems ?? null,
        },
      })
    if (persistErr) {
      console.error('[Reorder API] Monday item created but Supabase persist failed:', {
        mondayItemId: result.itemId,
        userId: user.id,
        trackerId: tracker.id,
        error: persistErr.message,
      })
    }

    return NextResponse.json({ success: true, mondayItemId: result.itemId })
  } catch (err) {
    console.error('[Reorder API] Failed to create Monday item:', err)
    return NextResponse.json(
      { error: 'Failed to submit reorder request. Please try again.' },
      { status: 502 }
    )
  }
}
