/**
 * Monday.com CRM Deals integration.
 *
 * Creates items on the CRM Deals board (MONDAY_REORDERS_BOARD_ID) for
 * customer reorders AND customer orders. Items land in the "New Deals"
 * group where AMs route them into their pipeline.
 *
 * Mode-discriminated helpers:
 *  - 'reorder' — preserved verbatim from the retired lib/monday/reorder.ts.
 *    No sub-items. Lines packed into long-text breakdown.
 *  - 'order'   — new for the 2026-05-21 checkout → Monday pipeline.
 *    Adds sub-items per cart line with design-name-prefixed names.
 *    Sets deal_source = "Portal - Order".
 */

import { mondayApiCall } from './client'
import type { MondayCreateItemResponse } from './types'
import type { JobTracker, QuoteDataItem } from '@/lib/job-tracker'
import {
  getItemColorName,
  getItemDesignName,
  getItemDisplayName,
  getItemTotalQty,
} from '@/lib/job-tracker'
import type { ReorderEditedItem } from '@/lib/config/reorder'

// === Shared board config (was lib/monday/reorder.ts) ===

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
const DEAL_SOURCE_ORDER = 'Portal - Order'
const DEAL_STAGE_LABEL = 'New'

// === REORDER MODE (preserved verbatim from lib/monday/reorder.ts) ===

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
  designNamesByInstanceId?: Record<string, string>
  editedItems?: ReorderEditedItem[]
}

function formatProductsCompact(
  items: QuoteDataItem[],
  designNamesByInstanceId?: Record<string, string>
): string {
  if (!items || items.length === 0) {
    return 'Reorder — details on original job'
  }
  return items
    .map((item) => {
      const designName = getItemDesignName(item, designNamesByInstanceId)
      const productName = getItemDisplayName(item)
      const qty = getItemTotalQty(item)
      const parts = [`${designName} / ${productName}`]
      if (qty > 0) parts.push(`x${qty}`)
      return parts.join(' ')
    })
    .join(', ')
}

function formatItemBreakdown(
  items: QuoteDataItem[],
  designNamesByInstanceId?: Record<string, string>
): string[] {
  if (!items || items.length === 0) {
    return [
      'Original order had no itemised records (legacy webhook-only tracker).',
      'Staff to pull details from Monday/quote.',
    ]
  }
  const lines: string[] = []
  for (const item of items) {
    const designName = getItemDesignName(item, designNamesByInstanceId)
    const productName = getItemDisplayName(item)
    const color = getItemColorName(item)
    const qty = getItemTotalQty(item)

    lines.push(`• Design: ${designName}`)
    lines.push(`  Product: ${productName}`)
    if (color) lines.push(`  Colour: ${color}`)

    const sizeBreakdown = item.sizes
      ? Object.entries(item.sizes)
          .filter(([, n]) => (n ?? 0) > 0)
          .map(([k, n]) => `${k}:${n}`)
          .join(' ')
      : ''
    if (sizeBreakdown) {
      lines.push(`  Sizes: ${sizeBreakdown} = ${qty}`)
    } else if (qty > 0) {
      lines.push(`  Qty: ${qty}`)
    }
    lines.push('')
  }
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

function formatEditedBreakdown(
  edited: ReorderEditedItem[],
  source: QuoteDataItem[],
  designNamesByInstanceId?: Record<string, string>
): string[] {
  const lines: string[] = []
  const dropped = edited.filter((e) => !e.included).length
  if (dropped > 0) {
    lines.push(`Items dropped from reorder: ${dropped}`)
    lines.push('')
  }
  const kept = edited.filter((e) => e.included)
  if (kept.length === 0) {
    lines.push('Customer dropped all items from the reorder.')
    return lines
  }
  for (const e of kept) {
    const sourceItem = source[e.source_index]
    const sourceProductName = sourceItem ? getItemDisplayName(sourceItem) : ''
    const sourceColor = sourceItem ? getItemColorName(sourceItem) : ''
    const sourceSizes = sourceItem?.sizes
      ? Object.fromEntries(
          Object.entries(sourceItem.sizes).filter(([, n]) => (n ?? 0) > 0),
        )
      : {}
    const designName = sourceItem
      ? getItemDesignName(sourceItem, designNamesByInstanceId)
      : 'Item'

    const productEdited = e.product_name !== sourceProductName
    const colorEdited = (e.color ?? '') !== (sourceColor ?? '')
    const sizesEdited =
      JSON.stringify(e.sizes) !== JSON.stringify(sourceSizes)
    const anyEdit = productEdited || colorEdited || sizesEdited

    lines.push(`• Design: ${designName}${anyEdit ? '   (edited from original)' : ''}`)
    lines.push(`  Product: ${e.product_name}${productEdited ? '  *edited*' : ''}`)
    if (e.color) {
      lines.push(`  Colour: ${e.color}${colorEdited ? '  *edited*' : ''}`)
    } else if (sourceColor) {
      lines.push(`  Colour: (cleared)  *edited*`)
    }
    const totalQty = Object.values(e.sizes).reduce(
      (sum, n) => sum + (Number.isFinite(n) ? n : 0),
      0,
    )
    const sizeText = Object.entries(e.sizes)
      .map(([k, n]) => `${k}:${n}`)
      .join(' ')
    if (sizeText) {
      lines.push(`  Sizes: ${sizeText} = ${totalQty}${sizesEdited ? '  *edited*' : ''}`)
    } else {
      lines.push(`  Sizes: (none)${sizesEdited ? '  *edited*' : ''}`)
    }
    lines.push('')
  }
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
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
  lines.push(...formatItemBreakdown(data.originalItems, data.designNamesByInstanceId))
  lines.push('')

  if (data.editedItems && data.editedItems.length > 0) {
    lines.push('--- Customer-Edited Reorder Items ---')
    lines.push(
      ...formatEditedBreakdown(
        data.editedItems,
        data.originalItems,
        data.designNamesByInstanceId,
      ),
    )
    lines.push('')
  }

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
    [COL_PRODUCT]: formatProductsCompact(data.originalItems, data.designNamesByInstanceId),
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
    editedItems?: ReorderEditedItem[]
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
    designNamesByInstanceId: tracker.designNamesByInstanceId ?? {},
    editedItems: input.editedItems,
  }
}

// === ORDER MODE (new) ===

export interface OrderLineForMonday {
  /** quote_items.id — used as key in returned subitemIds map. */
  quoteItemId: string
  productName: string
  variantLabel: string
  /**
   * Decoration name. Defaults to "No decoration" when the line has no
   * decorations attached (resolved at the caller, not here).
   */
  designName: string
  quantity: number
}

export interface OrderDealData {
  customerEmail: string
  customerName: string
  customerCompany: string | null
  orderRef: string
  inHandDate: string | null
  notes: string | null
  totalAmount: number
  lines: OrderLineForMonday[]
}

interface MondayCreateSubitemResponse {
  create_subitem: { id: string }
}

function buildOrderItemName(data: OrderDealData): string {
  const company = data.customerCompany ? ` - ${data.customerCompany}` : ''
  return `${data.customerName}${company} - ${data.orderRef}`
}

function buildOrderFullFormResponse(data: OrderDealData): string {
  const lines: string[] = [
    `Order ref: ${data.orderRef}`,
    `Customer: ${data.customerName}`,
    `Email: ${data.customerEmail}`,
  ]
  if (data.customerCompany) lines.push(`Company: ${data.customerCompany}`)
  lines.push(`Total: $${data.totalAmount.toFixed(2)}`)
  if (data.inHandDate) lines.push(`In-hand: ${data.inHandDate}`)
  lines.push('')
  lines.push('--- Lines ---')
  for (const line of data.lines) {
    lines.push(
      `• ${line.designName}: ${line.productName} — ${line.variantLabel} × ${line.quantity}`,
    )
  }
  lines.push('')
  if (data.notes?.trim()) {
    lines.push('--- Customer notes ---')
    lines.push(data.notes.trim())
    lines.push('')
  }
  lines.push(`Source: B2B Portal — Order`)
  lines.push(`Submitted: ${new Date().toISOString()}`)
  return lines.join('\n')
}

function formatOrderProductsCompact(lines: OrderLineForMonday[]): string {
  if (lines.length === 0) return 'Order — no lines'
  return lines
    .map((l) => `${l.designName} / ${l.productName} x${l.quantity}`)
    .join(', ')
}

function totalOrderQuantity(lines: OrderLineForMonday[]): number {
  return lines.reduce((sum, l) => sum + l.quantity, 0)
}

export async function createOrderDealItem(
  data: OrderDealData,
): Promise<{ itemId: string; itemName: string }> {
  const itemName = buildOrderItemName(data)

  const columnValues: Record<string, unknown> = {
    [COL_CUSTOMER_NAME]: data.customerName,
    [COL_EMAIL]: { email: data.customerEmail, text: data.customerEmail },
    [COL_PRODUCT]: formatOrderProductsCompact(data.lines),
    [COL_FULL_FORM_RESPONSE]: { text: buildOrderFullFormResponse(data) },
    [COL_DEAL_STAGE]: { label: DEAL_STAGE_LABEL },
    [COL_DEAL_SOURCE]: { label: DEAL_SOURCE_ORDER },
  }

  if (data.customerCompany) columnValues[COL_COMPANY] = data.customerCompany
  if (data.inHandDate) columnValues[COL_IN_HAND_DATE] = { date: data.inHandDate }
  const qty = totalOrderQuantity(data.lines)
  if (qty > 0) columnValues[COL_QTY] = String(qty)

  const mutation = `
    mutation CreateOrder($boardId: ID!, $groupId: String!, $itemName: String!, $columnValues: JSON!) {
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

  console.log('[Monday Order] Created item:', result.create_item.id)
  return { itemId: result.create_item.id, itemName: result.create_item.name }
}

export async function createOrderDealSubitem(
  parentItemId: string,
  line: OrderLineForMonday,
): Promise<{ subitemId: string }> {
  const itemName = `${line.designName}: ${line.productName} — ${line.variantLabel} × ${line.quantity}`

  const mutation = `
    mutation CreateOrderSubitem($parentItemId: ID!, $itemName: String!, $columnValues: JSON) {
      create_subitem(parent_item_id: $parentItemId, item_name: $itemName, column_values: $columnValues) {
        id
      }
    }
  `

  const result = await mondayApiCall<MondayCreateSubitemResponse>(mutation, {
    parentItemId,
    itemName,
    columnValues: JSON.stringify({}),
  })
  return { subitemId: result.create_subitem.id }
}

export async function pushOrderDeal(
  data: OrderDealData,
): Promise<{ itemId: string; subitemIds: Record<string, string> }> {
  const { itemId } = await createOrderDealItem(data)
  const subitemIds: Record<string, string> = {}
  for (const line of data.lines) {
    try {
      const { subitemId } = await createOrderDealSubitem(itemId, line)
      subitemIds[line.quoteItemId] = subitemId
    } catch (err) {
      console.error('[Monday Order] Subitem create failed:', {
        itemId,
        quoteItemId: line.quoteItemId,
        err: err instanceof Error ? err.message : String(err),
      })
      // Subitem failure is non-fatal — item exists, AM can add subitems manually.
      // We DO NOT throw, so partial subitems are preserved on the deal item.
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  return { itemId, subitemIds }
}
