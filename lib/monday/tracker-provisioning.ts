/**
 * Monday-origin tracker provisioning (portal).
 *
 * Ported from the studio's
 *   - `tracker-provisioning.js` (ensureTrackerForMondayItem)
 *   - `provisioning-events.js`  (event wrappers)
 *   - `monday.js` trackerTokenHandler
 * adapted to the portal: Monday I/O via `lib/monday/client.ts` `mondayApiCall`
 * (which returns the GraphQL `data` unwrapped), the portal's `PRODUCTION_COLUMNS`,
 * and — critically — the write-back targets the PORTAL deep link
 * `${NEXT_PUBLIC_SITE_URL}/order-tracker/<token>` (not the dead studio URL) and
 * is GUARDED so it never re-writes an already-correct column (which would loop
 * against the tracker-token webhook).
 *
 * A Monday-origin row uses `tracker_token = job_reference` (the human ref), keyed
 * on `monday_item_id`, with a token-conflict re-point. Portal-checkout rows keep
 * their UUID token and are untouched by this path.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { mondayApiCall } from '@/lib/monday/client'
import { PRODUCTION_BOARD_ID, PRODUCTION_COLUMNS } from '@/lib/monday/column-ids'
import { deriveStatusValue } from '@/lib/monday/tracker-status-engine'
import { validateJobReference, normalizeJobReference } from '@/lib/monday/job-reference'

const PORTAL_ORIGIN = process.env.NEXT_PUBLIC_SITE_URL || 'https://portal.theprintroom.nz'

const COLUMNS = {
  status: PRODUCTION_COLUMNS.mainStatus, // color_mkpnas0e
  customerEmail: PRODUCTION_COLUMNS.customerEmail, // email_mkqjpxt3
  jobReference: PRODUCTION_COLUMNS.poRef, // text_mkqxcmvz ("Job Reference")
  publicLink: PRODUCTION_COLUMNS.trackerUrl, // text_mkxvmsha (tracker link column)
}

interface MondayColumnValue {
  id: string
  text?: string | null
  value?: string | null
  type?: string
}
interface MondayItemSnapshot {
  id: string
  name?: string | null
  column_values?: MondayColumnValue[]
}

export function buildPortalTrackerUrl(trackerToken: string): string {
  return `${PORTAL_ORIGIN}/order-tracker/${String(trackerToken).trim()}`
}

export function extractTextFromMondayColumn(column: MondayColumnValue | null): string | null {
  if (!column) return null
  try {
    const parsed = JSON.parse(column.value || 'null') as { text?: string; label?: string } | null
    if (typeof parsed?.text === 'string' && parsed.text.trim()) return parsed.text.trim()
    if (typeof parsed?.label === 'string' && parsed.label.trim()) return parsed.label.trim()
  } catch {
    /* ignore parse errors */
  }
  if (typeof column.text === 'string' && column.text.trim()) return column.text.trim()
  return null
}

export function selectMondayColumn(
  columnValues: MondayColumnValue[] = [],
  columnId: string
): MondayColumnValue | null {
  return columnValues.find((c) => c?.id === columnId) ?? null
}

async function fetchMondayItem(
  mondayItemId: string,
  columnIds: string[]
): Promise<MondayItemSnapshot | null> {
  const query = `query ($itemIds: [ID!], $columnIds: [String!]) {
    items(ids: $itemIds) { id name column_values(ids: $columnIds) { id text value type } }
  }`
  const resp = await mondayApiCall<{ items?: MondayItemSnapshot[] }>(query, {
    itemIds: [String(mondayItemId)],
    columnIds,
  })
  return resp.items?.[0] ?? null
}

async function writeSimpleColumn(
  boardId: number | string,
  itemId: number | string,
  columnId: string,
  value: string
): Promise<void> {
  const mutation = `mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: String!) {
    change_simple_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
  }`
  await mondayApiCall(mutation, { boardId: String(boardId), itemId: String(itemId), columnId, value })
}

interface ProvisioningError extends Error {
  code: string
  statusCode: number
}
function provisioningError(code: string, message: string, statusCode = 400): ProvisioningError {
  return Object.assign(new Error(message), { code, statusCode }) as ProvisioningError
}
function isValidationError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  return code === 'missing-job-reference' || code === 'invalid-job-reference'
}

interface ExistingTracker {
  id: string
  tracker_token: string | null
  job_reference: string | null
  quote_number: string | null
  customer_email: string | null
  status: string | null
}

async function fetchExistingTracker(
  admin: SupabaseClient,
  mondayItemId: string
): Promise<ExistingTracker | null> {
  const { data } = await admin
    .from('job_trackers')
    .select('id, tracker_token, job_reference, quote_number, customer_email, status')
    .eq('monday_item_id', String(mondayItemId))
    .maybeSingle()
  return (data as ExistingTracker | null) ?? null
}

function normalizeStatusValue(rawStatus: string | null, existingStatus: string | null): string {
  const derived = deriveStatusValue(rawStatus || null, {
    previousStatus: existingStatus,
    fallbackKey: 'quote-stage',
  })
  return derived.storageValue || existingStatus || 'quote-stage'
}

/**
 * Write the portal tracker URL back to Monday's tracker-link column — but only
 * if it differs from what is already there (loop guard against the tracker-token
 * webhook re-firing on our own write).
 */
async function writeTrackerLinkToMonday(
  mondayItemId: string,
  trackerToken: string,
  boardId: number | string | null
): Promise<{ wrote: boolean; error: string | null }> {
  const targetUrl = buildPortalTrackerUrl(trackerToken)
  try {
    const item = await fetchMondayItem(mondayItemId, [COLUMNS.publicLink])
    const current = extractTextFromMondayColumn(selectMondayColumn(item?.column_values, COLUMNS.publicLink))
    if (current && current.trim() === targetUrl) {
      return { wrote: false, error: null } // already correct — do not loop
    }
    await writeSimpleColumn(boardId ?? PRODUCTION_BOARD_ID, mondayItemId, COLUMNS.publicLink, targetUrl)
    return { wrote: true, error: null }
  } catch (error) {
    return { wrote: false, error: (error as Error)?.message || 'Failed to write tracker link to Monday.' }
  }
}

export interface EnsureArgs {
  admin: SupabaseClient
  mondayItemId: string
  boardId?: number | string | null
  providedJobReference?: string | null
  providedStatus?: string | null
  providedQuoteNumber?: string | null
  providedCustomerEmail?: string | null
  writePublicLink?: boolean
  forceTokenSync?: boolean
  requireJobReference?: boolean
}
export interface EnsureResult {
  created: boolean
  updated: boolean
  skipped: boolean
  skipReason: string | null
  message?: string | null
  trackerToken: string | null
  jobReference: string | null
  status?: string
  wrotePublicLink: boolean
  mondayWriteError: string | null
}

export async function ensureTrackerForMondayItem(args: EnsureArgs): Promise<EnsureResult> {
  const {
    admin,
    mondayItemId,
    boardId = null,
    providedJobReference = null,
    providedStatus = null,
    providedQuoteNumber = null,
    providedCustomerEmail = null,
    writePublicLink = true,
    forceTokenSync = false,
    requireJobReference = true,
  } = args

  if (!mondayItemId) {
    throw provisioningError('invalid-monday-item-id', 'Monday item ID is required for tracker provisioning.')
  }
  const normalizedMondayItemId = String(mondayItemId).trim()
  const existingTracker = await fetchExistingTracker(admin, normalizedMondayItemId)

  const needsMondayItem =
    !providedQuoteNumber || !providedCustomerEmail || !providedStatus || !providedJobReference
  const itemSnapshot = needsMondayItem
    ? await fetchMondayItem(normalizedMondayItemId, [COLUMNS.status, COLUMNS.customerEmail, COLUMNS.jobReference])
    : null

  const columnValues = itemSnapshot?.column_values ?? []
  const mondayStatus = extractTextFromMondayColumn(selectMondayColumn(columnValues, COLUMNS.status))
  const mondayEmail = extractTextFromMondayColumn(selectMondayColumn(columnValues, COLUMNS.customerEmail))
  const mondayJobReference = extractTextFromMondayColumn(selectMondayColumn(columnValues, COLUMNS.jobReference))

  const status = normalizeStatusValue(
    providedStatus || mondayStatus || existingTracker?.status || 'quote-stage',
    existingTracker?.status ?? null
  )
  const quoteNumber =
    providedQuoteNumber || itemSnapshot?.name || existingTracker?.quote_number || null
  const customerEmail = providedCustomerEmail || mondayEmail || existingTracker?.customer_email || null

  const rawJobReference = normalizeJobReference(
    providedJobReference || mondayJobReference || existingTracker?.job_reference
  )
  const validation = validateJobReference(rawJobReference)
  if (!validation.ok) {
    if (!requireJobReference) {
      return {
        created: false,
        updated: false,
        skipped: true,
        skipReason: validation.code,
        message: validation.message,
        trackerToken: existingTracker?.tracker_token ?? null,
        jobReference: existingTracker?.job_reference ?? null,
        wrotePublicLink: false,
        mondayWriteError: null,
      }
    }
    throw provisioningError(validation.code, validation.message)
  }

  const trackerToken = validation.value
  const now = new Date().toISOString()
  let created = false
  let updated = false

  if (!existingTracker) {
    const { data: tokenConflict } = await admin
      .from('job_trackers')
      .select('id, monday_item_id')
      .eq('tracker_token', trackerToken)
      .maybeSingle()

    if (tokenConflict) {
      const { error } = await admin
        .from('job_trackers')
        .update({ monday_item_id: normalizedMondayItemId, last_synced_at: now })
        .eq('tracker_token', trackerToken)
      if (error) throw error
      updated = true
    } else {
      const { error } = await admin.from('job_trackers').insert({
        tracker_token: trackerToken,
        job_reference: trackerToken,
        monday_item_id: normalizedMondayItemId,
        status: status || 'quote-stage',
        quote_number: quoteNumber,
        customer_email: customerEmail,
        quote_data: {},
        product_images: [],
        tracking_info: {},
        production_updates: [],
        status_history: [],
        platform: 'monday-native',
        last_synced_at: now,
      })
      if (error) throw error
      created = true
    }
  } else {
    const updates: Record<string, unknown> = { last_synced_at: now }
    if ((existingTracker.job_reference || null) !== trackerToken) {
      updates.job_reference = trackerToken
      if (
        forceTokenSync ||
        !existingTracker.tracker_token ||
        existingTracker.tracker_token === existingTracker.job_reference
      ) {
        updates.tracker_token = trackerToken
      }
    } else if (forceTokenSync && existingTracker.tracker_token !== trackerToken) {
      updates.tracker_token = trackerToken
    }
    if (status && status !== existingTracker.status) updates.status = status
    if (quoteNumber && quoteNumber !== existingTracker.quote_number) updates.quote_number = quoteNumber
    if (customerEmail && customerEmail !== existingTracker.customer_email) updates.customer_email = customerEmail

    const { error } = await admin
      .from('job_trackers')
      .update(updates)
      .eq('monday_item_id', normalizedMondayItemId)
    if (error) throw error
    updated = true
  }

  let wrotePublicLink = false
  let mondayWriteError: string | null = null
  if (writePublicLink) {
    const r = await writeTrackerLinkToMonday(normalizedMondayItemId, trackerToken, boardId)
    wrotePublicLink = r.wrote
    mondayWriteError = r.error
  }

  return {
    created,
    updated,
    skipped: false,
    skipReason: null,
    trackerToken,
    jobReference: trackerToken,
    status,
    wrotePublicLink,
    mondayWriteError,
  }
}

interface EventResult {
  statusCode: number
  body: unknown
  logStatus: 'processed' | 'noop' | 'failed'
  logNotes?: string | null
  error?: unknown
}

export async function provisionTrackerForJobReferenceEvent(args: {
  admin: SupabaseClient
  mondayItemId: string
  boardId: number | string | null
  jobReference: string | null
}): Promise<EventResult> {
  try {
    const r = await ensureTrackerForMondayItem({
      admin: args.admin,
      mondayItemId: args.mondayItemId,
      boardId: args.boardId,
      providedJobReference: args.jobReference,
      writePublicLink: true,
      forceTokenSync: true,
      requireJobReference: true,
    })
    const action = r.created ? 'created' : r.updated ? 'updated' : 'noop'
    return {
      statusCode: 200,
      body: { success: true, action, tracker_token: r.trackerToken },
      logStatus: action === 'noop' ? 'noop' : 'processed',
      logNotes: null,
    }
  } catch (error) {
    if (isValidationError(error)) {
      return {
        statusCode: 200,
        body: { success: true, action: 'validation_failed', message: (error as Error).message },
        logStatus: 'noop',
        logNotes: (error as Error).message,
      }
    }
    return { statusCode: 500, body: { error: 'Failed to process Job Reference update.' }, logStatus: 'failed', error }
  }
}

export async function provisionTrackerForCreateEvent(args: {
  admin: SupabaseClient
  mondayItemId: string
  boardId: number | string | null
}): Promise<EventResult> {
  const r = await ensureTrackerForMondayItem({
    admin: args.admin,
    mondayItemId: args.mondayItemId,
    boardId: args.boardId,
    writePublicLink: true,
    forceTokenSync: false,
    requireJobReference: false,
  })
  if (r.skipped) {
    return {
      statusCode: 200,
      logStatus: 'noop',
      logNotes: r.message ?? null,
      body: { success: true, applied: false, reason: r.skipReason, message: r.message },
    }
  }
  const applied = Boolean(r.created || r.updated)
  return {
    statusCode: 200,
    logStatus: applied ? 'processed' : 'noop',
    body: { success: true, applied, created: r.created, updated: r.updated, tracker_token: r.trackerToken },
  }
}

/**
 * Validate a manually-pasted tracker-link value against the item's real job
 * reference; if they disagree, write the corrected PORTAL url back to Monday and
 * fix the DB row. Ported from the studio trackerTokenHandler.
 */
export async function handleTrackerTokenEvent(args: {
  admin: SupabaseClient
  mondayItemId: string
  boardId: number | string | null
  pastedValue: string | null
  tracker: { job_reference: string | null; tracker_token: string | null } | null
}): Promise<{ applied: boolean; correctedTo?: string | null }> {
  const pasted = (args.pastedValue ?? '').trim()
  if (!pasted) return { applied: false }

  const urlJobRef = pasted.includes('/') ? pasted.split('/').pop() || pasted : pasted
  if (args.tracker?.job_reference && args.tracker.job_reference === urlJobRef) {
    return { applied: false } // already valid
  }

  const item = await fetchMondayItem(args.mondayItemId, [COLUMNS.jobReference])
  const actualJobRef = extractTextFromMondayColumn(selectMondayColumn(item?.column_values, COLUMNS.jobReference))
  if (!actualJobRef || urlJobRef === actualJobRef) {
    return { applied: false }
  }

  const correctUrl = buildPortalTrackerUrl(actualJobRef)
  await writeSimpleColumn(args.boardId ?? PRODUCTION_BOARD_ID, args.mondayItemId, COLUMNS.publicLink, correctUrl)
  await args.admin
    .from('job_trackers')
    .update({ tracker_token: actualJobRef, job_reference: actualJobRef })
    .eq('monday_item_id', String(args.mondayItemId))

  return { applied: true, correctedTo: correctUrl }
}
