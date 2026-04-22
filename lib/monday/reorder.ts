/**
 * Monday.com Reorder Integration
 *
 * Creates items on the CRM Deals board when a customer submits a reorder
 * via the portal. Mirrors the quote/wishlist pattern used in
 * print-room-chatbot-api/api/services/monday-quote.ts so that portal
 * reorders land alongside chatbot quote requests in the "New Deals"
 * group and follow the sales/account team's existing workflow.
 */

import { mondayApiCall } from './client'
import type { MondayCreateItemResponse } from './types'
import type { JobTracker, QuoteDataItem } from '@/lib/job-tracker'
import {
  getItemColorName,
  getItemDisplayName,
  getItemPrintMethod,
  getItemTotalQty,
} from '@/lib/job-tracker'

function getBoardId(): string {
  const id = process.env.MONDAY_REORDERS_BOARD_ID
  if (!id) {
    throw new Error(
      'MONDAY_REORDERS_BOARD_ID is not configured — set it to the CRM Deals board id (e.g. 2046357917).'
    )
  }
  return id
}

// "New Deals" group on the Deals board (2046357917).
const DEALS_GROUP_ID = 'topics'

// Column ids on the CRM Deals board (2046357917).
// Mirrors print-room-chatbot-api/api/services/monday-quote.ts QUOTE_COLUMNS.
const COL_CUSTOMER_NAME = 'text_mkzjv77f'
const COL_EMAIL = 'email_mkzjab7s'
const COL_PHONE = 'text_mkzjfbgj'
const COL_COMPANY = 'text_mkzjmfef'
const COL_PRODUCT = 'text_mkzj78dx'
const COL_FULL_FORM_RESPONSE = 'long_text_mkzjhs9j'
const COL_DEAL_STAGE = 'deal_stage'
const COL_DEAL_SOURCE = 'color_mkzhwkjn'
const COL_QTY = 'text_mkzjj9j5'
const COL_IN_HAND_DATE = 'date_mm0p5fzc'

const DEAL_SOURCE_LABEL = 'Portal - Reorder'
const DEAL_STAGE_LABEL = 'New'

export interface ReorderData {
  customerEmail: string
  customerName: string
  customerPhone?: string | null
  customerCompany?: string | null
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

function formatProductsCompact(items: QuoteDataItem[]): string {
  if (!items || items.length === 0) {
    return 'Reorder — details on original job'
  }
  return items
    .map((item) => {
      const name = getItemDisplayName(item)
      const qty = getItemTotalQty(item)
      const method = getItemPrintMethod(item)
      const parts = [name]
      if (qty > 0) parts.push(`x${qty}`)
      if (method) parts.push(`(${method})`)
      return parts.join(' ')
    })
    .join(', ')
}

function formatItemBreakdown(items: QuoteDataItem[]): string[] {
  if (!items || items.length === 0) {
    return [
      'Original order had no itemised records (legacy webhook-only tracker).',
      'Staff to pull details from Monday/quote.',
    ]
  }
  const lines: string[] = []
  for (const item of items) {
    const name = getItemDisplayName(item)
    const color = getItemColorName(item)
    const method = getItemPrintMethod(item)
    const qty = getItemTotalQty(item)
    const header = [name, color, method ? `(${method})` : null]
      .filter(Boolean)
      .join(' — ')
    lines.push(`• ${header}`)
    const sizeBreakdown = item.sizes
      ? Object.entries(item.sizes)
          .filter(([, n]) => (n ?? 0) > 0)
          .map(([k, n]) => `${k}:${n}`)
          .join(' ')
      : ''
    if (sizeBreakdown) lines.push(`  Sizes: ${sizeBreakdown} = ${qty}`)
    else if (qty > 0) lines.push(`  Qty: ${qty}`)
  }
  return lines
}

function buildFullFormResponse(data: ReorderData): string {
  const ref =
    data.originalQuoteNumber ||
    data.originalJobReference ||
    'Unknown reference'
  const lines: string[] = [
    `Name: ${data.customerName}`,
    `Email: ${data.customerEmail}`,
  ]
  if (data.customerPhone) lines.push(`Phone: ${data.customerPhone}`)
  if (data.customerCompany) lines.push(`Company: ${data.customerCompany}`)
  lines.push('Source: B2B Portal — Reorder')
  lines.push('')

  lines.push('--- Reorder Details ---')
  lines.push(
    `Past order: ${ref}${
      data.mondayProjectName ? ` — ${data.mondayProjectName}` : ''
    }`
  )
  lines.push(`In-hand date: ${data.inHandDate}`)
  lines.push(
    `Requested qty: ${
      typeof data.quantity === 'number' ? data.quantity : 'not specified'
    }`
  )
  lines.push('')

  lines.push('--- Delivery Address ---')
  lines.push(data.deliveryAddress)
  lines.push('')

  lines.push('--- Customer Notes ---')
  lines.push(data.notes?.trim() ? data.notes.trim() : 'none')
  lines.push('')

  lines.push('--- Original Order Items ---')
  lines.push(...formatItemBreakdown(data.originalItems))
  lines.push('')

  if (data.artworkUrls && data.artworkUrls.length > 0) {
    lines.push('--- New Artwork ---')
    lines.push(...data.artworkUrls)
    lines.push('')
  }

  if (data.proofFileUrls.length > 0) {
    lines.push('--- Proof Files (original order) ---')
    lines.push(...data.proofFileUrls)
    lines.push('')
  }

  lines.push(`Submitted: ${new Date().toISOString()}`)
  return lines.join('\n')
}

function totalQuantity(data: ReorderData): number {
  if (typeof data.quantity === 'number' && data.quantity > 0) {
    return data.quantity
  }
  return (data.originalItems || []).reduce(
    (sum, item) => sum + getItemTotalQty(item),
    0
  )
}

export async function createReorderItem(
  data: ReorderData
): Promise<{ itemId: string; itemName: string }> {
  const companyLabel = data.customerCompany ? ` - ${data.customerCompany}` : ''
  const itemName = `${data.customerName}${companyLabel} - Reorder`

  const columnValues: Record<string, unknown> = {
    [COL_CUSTOMER_NAME]: data.customerName,
    [COL_EMAIL]: { email: data.customerEmail, text: data.customerEmail },
    [COL_PRODUCT]: formatProductsCompact(data.originalItems),
    [COL_FULL_FORM_RESPONSE]: { text: buildFullFormResponse(data) },
    [COL_DEAL_STAGE]: { label: DEAL_STAGE_LABEL },
    [COL_DEAL_SOURCE]: { label: DEAL_SOURCE_LABEL },
    [COL_IN_HAND_DATE]: { date: data.inHandDate },
  }

  if (data.customerPhone) columnValues[COL_PHONE] = data.customerPhone
  if (data.customerCompany) columnValues[COL_COMPANY] = data.customerCompany

  const qty = totalQuantity(data)
  if (qty > 0) columnValues[COL_QTY] = String(qty)

  const mutation = `
    mutation CreateReorder($boardId: ID!, $groupId: String!, $itemName: String!, $columnValues: JSON!) {
      create_item(
        board_id: $boardId,
        group_id: $groupId,
        item_name: $itemName,
        column_values: $columnValues,
        create_labels_if_missing: true
      ) {
        id
        name
      }
    }
  `

  const result = await mondayApiCall<MondayCreateItemResponse>(mutation, {
    boardId: getBoardId(),
    groupId: DEALS_GROUP_ID,
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

  const shipping = tracker.quote_data?.shippingAddress
  const customerPhone = tracker.quote_data?.customerPhone || shipping?.phone || null
  const customerCompany = shipping?.company || null

  return {
    customerEmail: input.customerEmail,
    customerName: input.customerName || tracker.customer_name || input.customerEmail,
    customerPhone,
    customerCompany,
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
