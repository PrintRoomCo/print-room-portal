/**
 * Monday.com Reorder Integration
 *
 * Creates items on the CRM (Chatbot Inquires) board when a customer
 * submits a reorder request via the portal. Column mapping mirrors the
 * chatbot-api so reorders sit alongside other inbound enquiries.
 */

import { mondayApiCall } from './client'
import type { MondayCreateItemResponse } from './types'
import type { JobTracker, QuoteDataItem } from '@/lib/job-tracker'
import {
  getItemArtworkUrl,
  getItemColorName,
  getItemDisplayName,
  getItemPrintMethod,
  getItemTotalQty,
} from '@/lib/job-tracker'

const BOARD_ID = process.env.MONDAY_REORDERS_BOARD_ID
if (!BOARD_ID) {
  throw new Error(
    'MONDAY_REORDERS_BOARD_ID is not configured — set it to the CRM board id (e.g. 5026071982).'
  )
}

// Column ids on the Chatbot Inquires / CRM board (5026071982).
// Mirrors print-room-chatbot-api/api/services/monday.ts.
const COLUMN_EMAIL = 'email_mm023vj'
const COLUMN_INQUIRY_DATE = 'date_mkzmwgr'
const COLUMN_INQUIRY_TYPE = 'dropdown_mkzm6ahn'
const COLUMN_CUSTOMER_FEEDBACK = 'text_mkzmx0p1'
const COLUMN_DESCRIPTION = 'long_text_mm02rede'
const COLUMN_PRODUCTS = 'long_text_mm02st29'

export interface ReorderData {
  customerEmail: string
  customerName: string
  originalQuoteNumber: string | null
  originalJobReference: string | null
  mondayProjectName: string | null
  deliveryAddress: string
  inHandDate: string
  quantity?: number
  notes?: string
  artworkUrls?: string[]
  proofFileUrls: string[]
  originalItems: QuoteDataItem[]
}

function formatItemsSummary(items: QuoteDataItem[]): string {
  if (!items || items.length === 0) {
    return 'Original order had no itemised records (legacy webhook-only tracker). Staff to pull details from Monday/quote.'
  }

  const lines: string[] = ['ORIGINAL ORDER SUMMARY']
  for (const item of items) {
    const name = getItemDisplayName(item)
    const color = getItemColorName(item)
    const method = getItemPrintMethod(item)
    const total = getItemTotalQty(item)
    const sizeBreakdown = item.sizes
      ? Object.entries(item.sizes)
          .filter(([, n]) => (n ?? 0) > 0)
          .map(([k, n]) => `${k}:${n}`)
          .join(' ')
      : ''

    const header = [name, color, method ? `(${method})` : null]
      .filter(Boolean)
      .join(' — ')
    lines.push(`- ${header}`)
    if (sizeBreakdown) {
      lines.push(`  Sizes: ${sizeBreakdown} = ${total}`)
    } else if (total > 0) {
      lines.push(`  Qty: ${total}`)
    }
    const artwork = getItemArtworkUrl(item)
    if (artwork) lines.push(`  Artwork: ${artwork}`)
  }
  return lines.join('\n')
}

function buildDescription(data: ReorderData): string {
  const ref =
    data.originalQuoteNumber ||
    data.originalJobReference ||
    'Unknown reference'
  const lines: string[] = [
    'REORDER REQUEST',
    `Customer: ${data.customerName} <${data.customerEmail}>`,
    `Past order: ${ref}${data.mondayProjectName ? ` — ${data.mondayProjectName}` : ''}`,
    '',
    'Delivery address:',
    data.deliveryAddress,
    '',
    `In-hand date: ${data.inHandDate}`,
    `Quantity: ${typeof data.quantity === 'number' ? data.quantity : 'not specified'}`,
    '',
    'Customer notes:',
    data.notes?.trim() ? data.notes.trim() : 'none',
    '',
    'New artwork:',
    data.artworkUrls && data.artworkUrls.length > 0
      ? data.artworkUrls.join('\n')
      : 'none uploaded',
    '',
    'Proof files from original order:',
    data.proofFileUrls.length > 0 ? data.proofFileUrls.join('\n') : 'none',
    '',
    `Submitted: ${new Date().toISOString()}`,
    'Source: B2B Portal - Reorder',
  ]
  return lines.join('\n')
}

function buildShortSummary(data: ReorderData): string {
  const ref =
    data.originalQuoteNumber || data.originalJobReference || 'unknown'
  const qty =
    typeof data.quantity === 'number' ? String(data.quantity) : '—'
  const addressSnippet = data.deliveryAddress
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140)
  return `REORDER | Ref: ${ref} | In-hand: ${data.inHandDate} | Qty: ${qty} | Delivery: ${addressSnippet}`
}

export async function createReorderItem(
  data: ReorderData
): Promise<{ itemId: string; itemName: string }> {
  const projectLabel =
    data.mondayProjectName || data.originalQuoteNumber || 'Project'
  const itemName = `REORDER — ${projectLabel}`

  const today = new Date().toISOString().split('T')[0]

  const columnValues: Record<string, unknown> = {
    [COLUMN_EMAIL]: { email: data.customerEmail, text: data.customerEmail },
    [COLUMN_INQUIRY_DATE]: { date: today },
    [COLUMN_INQUIRY_TYPE]: 'General Question',
    [COLUMN_CUSTOMER_FEEDBACK]: buildShortSummary(data).slice(0, 250),
    [COLUMN_DESCRIPTION]: buildDescription(data),
    [COLUMN_PRODUCTS]: formatItemsSummary(data.originalItems),
  }

  const mutation = `
    mutation CreateReorder($boardId: ID!, $itemName: String!, $columnValues: JSON!) {
      create_item(board_id: $boardId, item_name: $itemName, column_values: $columnValues) {
        id
        name
      }
    }
  `

  const result = await mondayApiCall<MondayCreateItemResponse>(mutation, {
    boardId: BOARD_ID,
    itemName,
    columnValues: JSON.stringify(columnValues),
  })

  console.log('[Monday Reorder] Created item:', result.create_item.id)

  return {
    itemId: result.create_item.id,
    itemName: result.create_item.name,
  }
}

export function buildReorderDataFromTracker(
  tracker: JobTracker,
  input: {
    customerEmail: string
    customerName: string
    deliveryAddress: string
    inHandDate: string
    quantity?: number
    notes?: string
    artworkUrls?: string[]
  }
): ReorderData {
  const proofFileUrls = (tracker.proof_files || [])
    .map((f) => f?.url)
    .filter((u): u is string => Boolean(u))

  return {
    customerEmail: input.customerEmail,
    customerName: input.customerName || tracker.customer_name || input.customerEmail,
    originalQuoteNumber: tracker.quote_number,
    originalJobReference: tracker.job_reference,
    mondayProjectName: tracker.monday_project_name,
    deliveryAddress: input.deliveryAddress,
    inHandDate: input.inHandDate,
    quantity: input.quantity,
    notes: input.notes,
    artworkUrls: input.artworkUrls,
    proofFileUrls,
    originalItems: tracker.quote_data?.items ?? [],
  }
}
