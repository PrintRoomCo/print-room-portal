/**
 * Read a customer-facing courier tracking URL off a Monday production-board item.
 *
 * The "Dispatched" milestone email needs the tracking link at send time. The
 * studio poller writes it into `job_trackers.tracking_info`, but that poller is
 * disabled at the Phase 2 cutover — so post-cutover we read the link straight
 * off the Monday item instead. ONLY the "Customer Tracker Link" column
 * (`link_mky1w9w`) is read: the "Supplier Tracking Link" (`link_mkqz77w0`) is
 * inbound blanks tracking and must never be shown to a customer (see
 * `lib/monday/column-ids.ts`).
 */

import { mondayApiCall } from '@/lib/monday/client'
import { PRODUCTION_COLUMNS } from '@/lib/monday/column-ids'

interface MondayLinkColumn {
  text?: string | null
  value?: string | null
}

/**
 * Pull the URL out of a Monday "link" column payload. Monday stores links as
 * `value` JSON `{ "url": "...", "text": "..." }`; the display `text` is often a
 * label rather than the URL. Prefer `value.url`, then fall back to `text` only
 * when it already looks like a URL.
 */
export function extractUrlFromLinkColumn(
  column: MondayLinkColumn | null | undefined
): string | null {
  if (!column) return null
  try {
    const parsed = JSON.parse(column.value || 'null') as { url?: string } | null
    const url = parsed?.url?.trim()
    if (url) return url
  } catch {
    /* not JSON — fall through to text */
  }
  const text = column.text?.trim()
  if (text && /^https?:\/\//i.test(text)) return text
  return null
}

/**
 * Fetch the customer tracking URL for a Monday item, or `null` if absent /
 * unreadable. Best-effort: never throws (the dispatched email falls back to
 * "tracking to follow" copy on null).
 */
export async function fetchCustomerTrackingUrl(
  mondayItemId: string
): Promise<string | null> {
  const columnId = PRODUCTION_COLUMNS.customerTrackingUrl
  const query = `query ($itemIds: [ID!], $columnIds: [String!]) {
    items(ids: $itemIds) { id column_values(ids: $columnIds) { id text value } }
  }`
  try {
    const resp = await mondayApiCall<{
      items?: Array<{ column_values?: MondayLinkColumn[] }>
    }>(query, { itemIds: [String(mondayItemId)], columnIds: [columnId] })
    const column = resp.items?.[0]?.column_values?.[0] ?? null
    return extractUrlFromLinkColumn(column)
  } catch (err) {
    console.error('[tracking-link] fetch failed:', err)
    return null
  }
}
