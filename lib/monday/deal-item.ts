/**
 * Monday.com order + reorder integration.
 *
 * Both modes write to the Production board (PRODUCTION_BOARD_ID, override
 * MONDAY_PRODUCTION_BOARD_ID) "Pre-production" group via getProductionBoardId():
 *  - 'order'   — new /checkout orders. One sub-item per product configuration,
 *    with all size quantities on that sub-item; Intent tagged "Order". Columns
 *    mapped to the Production schema (PRODUCTION_COLUMNS).
 *  - 'reorder' — repeat of a completed job. No sub-items; the full breakdown is
 *    packed into the Job Specs long-text. Intent tagged "Reorder" and the item
 *    name ends "- Reorder" so it reads apart from orders in the shared group.
 *
 * CRM-Deals-only fields (deal_stage, deal_source, Deals name/phone/company text
 * columns) are dropped — they don't exist on the Production board and sending
 * them would fail create_item with a ColumnValueException.
 */

import { mondayApiCall } from './client'
import type { MondayCreateItemResponse } from './types'
import {
  PRODUCTION_BOARD_ID,
  PRODUCTION_COLUMNS,
  PRODUCTION_SUBITEM_COLUMNS,
  type ProductionSubitemSizeKey,
} from './column-ids'
import type { JobTracker, QuoteDataItem } from '@/lib/job-tracker'
import {
  getItemColorName,
  getItemDesignName,
  getItemDisplayName,
  getItemTotalQty,
} from '@/lib/job-tracker'
import type { ReorderEditedItem } from '@/lib/config/reorder'

// === Shared Production-board config (both order and reorder modes) ===

/**
 * Board the portal pushes orders AND reorders to. Defaults to the Production
 * board; MONDAY_PRODUCTION_BOARD_ID overrides it (e.g. a staging board in
 * preview). Both modes resolve through here so the destination never forks.
 */
function getProductionBoardId(): string {
  return process.env.MONDAY_PRODUCTION_BOARD_ID || String(PRODUCTION_BOARD_ID)
}

// "Pre-production" group on the Production board (1992701981), verified
// 2026-07-01. Shares the literal 'topics' with the old Deals "New Deals" group
// by coincidence; kept as a distinct constant so the two never get conflated.
const PREPRODUCTION_GROUP_ID = 'topics'

function appendDeliveryAddressSection(lines: string[], deliveryAddress: string | null) {
  const address = deliveryAddress?.trim()
  if (!address) return

  lines.push('--- Delivery Address ---')
  lines.push(address)
  lines.push('')
}

export interface PushOrderDealOptions {
  /** organizations.is_test — route the deal item to the demo group. */
  demo?: boolean
}

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

  appendDeliveryAddressSection(lines, data.deliveryAddress)

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

  // Only columns that exist on the Production board (1992701981) are sent —
  // a CRM-Deals-only id here would fail the whole create_item with a
  // ColumnValueException. The customer name lives in the item NAME; the full
  // breakdown (lines, address, notes, artwork/proof URLs) goes into Job Specs.
  const columnValues: Record<string, unknown> = {
    [PRODUCTION_COLUMNS.customerEmail]: {
      email: data.customerEmail,
      text: data.customerEmail,
    },
    [PRODUCTION_COLUMNS.jobSpecs]: { text: buildFullFormResponse(data) },
    // Tag the shared Pre-production group so staff can filter reorders apart
    // from fresh orders (which are tagged "Order").
    [PRODUCTION_COLUMNS.intent]: { label: 'Reorder' },
  }

  // "Job Reference" — original quote no. preferred, else the job reference.
  const ref = data.originalQuoteNumber || data.originalJobReference
  if (ref) columnValues[PRODUCTION_COLUMNS.poRef] = ref

  // Guard like the order path — never hand the date column an empty string.
  // The reorder route already validates inHandDate, so this is defense-in-depth.
  if (data.inHandDate) {
    columnValues[PRODUCTION_COLUMNS.inHandDate] = { date: data.inHandDate }
  }

  const qty = totalQuantity(data)
  if (qty > 0) columnValues[PRODUCTION_COLUMNS.qty] = String(qty)

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
    boardId: getProductionBoardId(),
    groupId: PREPRODUCTION_GROUP_ID,
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

// === ORDER MODE — Production board (was CRM Deals) ===

// "Job Status" (PRODUCTION_COLUMNS.mainStatus) label stamped on brand-new portal
// orders. MUST be an existing label on that column (verified 2026-07-01) — an
// empty string leaves the status unset. Reorders deliberately leave Job Status
// unset (a reorder re-runs an already-approved job, so "needs mockup" is wrong).
const ORDER_INITIAL_JOB_STATUS = 'Need: Mockup (Quote Approved)'

/**
 * Demo orders (org.is_test) route to a dedicated demo group when
 * MONDAY_PRODUCTION_DEMO_GROUP_ID is set; otherwise they fall back to
 * Pre-production with a warning (a noisy demo item beats a broken push). The old
 * Deals demo group does not exist on the Production board, so there is no shared
 * default.
 */
function resolveOrderGroupId(demo: boolean | undefined): string {
  if (!demo) return PREPRODUCTION_GROUP_ID
  const demoGroup = process.env.MONDAY_PRODUCTION_DEMO_GROUP_ID
  if (!demoGroup) {
    console.warn(
      '[Monday Order] MONDAY_PRODUCTION_DEMO_GROUP_ID not set — demo order falling back to the Pre-production group',
    )
    return PREPRODUCTION_GROUP_ID
  }
  return demoGroup
}

export interface OrderLineForMonday {
  /** quote_items.id — used as key in returned subitemIds map. */
  quoteItemId: string
  /** products.id — stable identity used to group size rows for one product. */
  productId: string
  productName: string
  variantLabel: string
  colorName: string | null
  sizeLabel: string | null
  /**
   * Decoration name. Defaults to "No decoration" when the line has no
   * decorations attached (resolved at the caller, not here).
   */
  designName: string
  /** Feature 1 — chosen PDP location label for this line; null when none. */
  location: string | null
  /** Feature 2 — optional custom name for this line; null when none. */
  customName: string | null
  quantity: number
}

export interface OrderDealData {
  customerEmail: string
  customerName: string
  customerCompany: string | null
  orderRef: string
  inHandDate: string | null
  deliveryAddress: string | null
  notes: string | null
  totalAmount: number
  /** quotes.currency ('NZD' | 'AUD'). Non-NZD renders a suffix on the Total line
   *  so the factory/accounts never misread a raw AUD number as NZD. */
  currency?: string | null
  lines: OrderLineForMonday[]
}

interface MondayCreateSubitemResponse {
  create_subitem: { id: string }
}

function buildOrderItemName(data: OrderDealData): string {
  const company = data.customerCompany ? ` - ${data.customerCompany}` : ''
  return `${data.customerName}${company} - ${data.orderRef}`
}

export function buildOrderFullFormResponse(data: OrderDealData): string {
  const lines: string[] = [
    `Order ref: ${data.orderRef}`,
    `Customer: ${data.customerName}`,
    `Email: ${data.customerEmail}`,
  ]
  if (data.customerCompany) lines.push(`Company: ${data.customerCompany}`)
  const currencySuffix = data.currency && data.currency !== 'NZD' ? ` (${data.currency})` : ''
  lines.push(`Total: $${data.totalAmount.toFixed(2)}${currencySuffix}`)
  if (data.inHandDate) lines.push(`In-hand: ${data.inHandDate}`)
  lines.push('')

  appendDeliveryAddressSection(lines, data.deliveryAddress)

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

/**
 * Build the Production-board column values for an order item. Only columns that
 * exist on the Production board (1992701981) are sent — sending a CRM-Deals-only
 * id here would fail the whole create_item with a ColumnValueException. The
 * customer name lives in the item NAME; the full breakdown (including per-line
 * quantities) goes into the Job Specs long-text, so no separate qty/product
 * columns are needed.
 */
function buildOrderColumnValues(data: OrderDealData): Record<string, unknown> {
  const columnValues: Record<string, unknown> = {
    [PRODUCTION_COLUMNS.customerEmail]: {
      email: data.customerEmail,
      text: data.customerEmail,
    },
    [PRODUCTION_COLUMNS.poRef]: data.orderRef,
    [PRODUCTION_COLUMNS.jobSpecs]: { text: buildOrderFullFormResponse(data) },
  }

  if (Number.isFinite(data.totalAmount)) {
    columnValues[PRODUCTION_COLUMNS.quoteTotal] = data.totalAmount
  }
  if (data.inHandDate) {
    columnValues[PRODUCTION_COLUMNS.inHandDate] = { date: data.inHandDate }
  }
  if (ORDER_INITIAL_JOB_STATUS) {
    columnValues[PRODUCTION_COLUMNS.mainStatus] = { label: ORDER_INITIAL_JOB_STATUS }
  }
  // Tag the shared Pre-production group so staff can filter fresh orders apart
  // from reorders (which are tagged "Reorder"). Label created on demand.
  columnValues[PRODUCTION_COLUMNS.intent] = { label: 'Order' }

  return columnValues
}

export async function createOrderDealItem(
  data: OrderDealData,
  opts?: PushOrderDealOptions,
): Promise<{ itemId: string; itemName: string }> {
  const itemName = buildOrderItemName(data)
  const columnValues = buildOrderColumnValues(data)

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
    boardId: getProductionBoardId(),
    groupId: resolveOrderGroupId(opts?.demo),
    itemName,
    columnValues: JSON.stringify(columnValues),
  })

  console.log('[Monday Order] Created item:', result.create_item.id)
  return { itemId: result.create_item.id, itemName: result.create_item.name }
}

// Maps portal size labels (quote_items.size_label, i.e. sizes.label) onto the
// Subitems board's size columns (PRODUCTION_SUBITEM_COLUMNS.sizes). Keys are
// matched UPPER-CASED (see normalizeSizeLabel). The board's size columns are
// dual-labelled ("XXS / 6", "SML / 10", "MED / 12", …), so numeric AU/women's
// sizes route onto the same column as their letter equivalent — verified
// against board 1992701983 (2026-07-09).
const SIZE_LABEL_ALIASES: Record<string, ProductionSubitemSizeKey> = {
  // One-size / sizeless variants → "One Size"
  OS: 'ONE',
  'O/S': 'ONE',
  'ONE SIZE': 'ONE',
  ONESIZE: 'ONE',
  '1SIZE': 'ONE',
  // Extra-small letter aliases (board column is "XXS / 6")
  '2XS': 'XXS',
  // Numeric AU/women's sizing → the board's dual-labelled letter columns.
  '6': 'XXS',
  '8': 'XS',
  '10': 'S',
  '12': 'M',
  '14': 'L',
  '16': 'XL',
  '18': '2XL',
  '20': '3XL',
  '22': '4XL',
  '24': '5XL',
  // Extra-large letter aliases
  '2XL': '2XL',
  XXL: '2XL',
  '3XL': '3XL',
  XXXL: '3XL',
  '4XL': '4XL',
  XXXXL: '4XL',
  '5XL': '5XL',
  XXXXXL: '5XL',
  // Kids age/shoe ranges carrying a country suffix (columns are "4-8" / "9-13")
  '4-8 US': '4-8',
  '9-13 US': '9-13',
}

function normalizeSizeLabel(
  sizeLabel: string | null,
): ProductionSubitemSizeKey {
  const raw = sizeLabel?.trim()
  if (!raw) return 'ONE'
  const upper = raw.toUpperCase()
  if (upper in SIZE_LABEL_ALIASES) return SIZE_LABEL_ALIASES[upper]
  if (upper in PRODUCTION_SUBITEM_COLUMNS.sizes) {
    return upper as ProductionSubitemSizeKey
  }
  // No matching size column exists on the Subitems board, so the quantity will
  // land in "One Size" — almost always wrong (e.g. 7XL, workwear cm sizes,
  // waist sizes). Warn so an unmapped size surfaces instead of silently
  // corrupting the production board; add an alias above if it has a home.
  console.warn(
    `[Monday Order] Unmapped size label "${raw}" — quantity routed to the "One Size" column. Add an alias to SIZE_LABEL_ALIASES if this size maps to a board column.`,
  )
  return 'ONE'
}

function buildOrderSubitemColumnValues(
  lines: readonly OrderLineForMonday[],
): Record<string, unknown> {
  const line = lines[0]
  if (!line) {
    throw new Error('Cannot build a Monday subitem without an order line')
  }

  const columnValues: Record<string, unknown> = {
    [PRODUCTION_SUBITEM_COLUMNS.fallbackGarment]: line.productName,
  }

  if (line.colorName?.trim()) {
    columnValues[PRODUCTION_SUBITEM_COLUMNS.fallbackColor] = line.colorName.trim()
  }

  for (const sizeLine of lines) {
    if (!Number.isFinite(sizeLine.quantity) || sizeLine.quantity <= 0) continue
    const sizeKey = normalizeSizeLabel(sizeLine.sizeLabel)
    const columnId = PRODUCTION_SUBITEM_COLUMNS.sizes[sizeKey]
    const existingQty = Number(columnValues[columnId] ?? 0)
    columnValues[columnId] = existingQty + sizeLine.quantity
  }

  // Feature 1 — the chosen PDP location label, its own subitem column.
  if (line.location?.trim()) {
    columnValues[PRODUCTION_SUBITEM_COLUMNS.location] = line.location.trim()
  }
  // Feature 2 — the optional custom name, its own subitem column.
  if (line.customName?.trim()) {
    columnValues[PRODUCTION_SUBITEM_COLUMNS.customName] = line.customName.trim()
  }
  // Decoration name, elevated to its own column off the subitem title
  // (2026-07-22 title fix). Skip the "No decoration" sentinel.
  if (line.designName?.trim() && line.designName !== 'No decoration') {
    columnValues[PRODUCTION_SUBITEM_COLUMNS.decoration] = line.designName.trim()
  }

  return columnValues
}

function orderSubitemGroupKey(line: OrderLineForMonday): string {
  // Size is deliberately absent: size rows belonging to the same product
  // configuration must land on one Production subitem. Keep other subitem-level
  // values in the key because Monday has only one Colour, Decoration, Location,
  // and Custom Name cell per subitem; merging differing values would lose data.
  return JSON.stringify([
    line.productId,
    line.colorName?.trim() ?? '',
    line.designName?.trim() ?? '',
    line.location?.trim() ?? '',
    line.customName?.trim() ?? '',
  ])
}

function groupOrderLinesForSubitems(
  lines: readonly OrderLineForMonday[],
): OrderLineForMonday[][] {
  const groups = new Map<string, OrderLineForMonday[]>()
  for (const line of lines) {
    const key = orderSubitemGroupKey(line)
    const group = groups.get(key)
    if (group) {
      group.push(line)
    } else {
      groups.set(key, [line])
    }
  }
  return Array.from(groups.values())
}

export async function createOrderDealSubitem(
  parentItemId: string,
  lines: readonly OrderLineForMonday[],
): Promise<{ subitemId: string }> {
  const line = lines[0]
  if (!line) {
    throw new Error('Cannot create a Monday subitem without an order line')
  }
  const itemName = line.productName
  const columnValues = buildOrderSubitemColumnValues(lines)

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
    columnValues: JSON.stringify(columnValues),
  })
  return { subitemId: result.create_subitem.id }
}

export async function pushOrderDeal(
  data: OrderDealData,
  opts?: PushOrderDealOptions,
): Promise<{ itemId: string; subitemIds: Record<string, string> }> {
  const { itemId } = await createOrderDealItem(data, opts)
  const subitemIds: Record<string, string> = {}
  for (const lines of groupOrderLinesForSubitems(data.lines)) {
    try {
      const { subitemId } = await createOrderDealSubitem(itemId, lines)
      for (const line of lines) {
        subitemIds[line.quoteItemId] = subitemId
      }
    } catch (err) {
      console.error('[Monday Order] Subitem create failed:', {
        itemId,
        quoteItemIds: lines.map((line) => line.quoteItemId),
        err: err instanceof Error ? err.message : String(err),
      })
      // Subitem failure is non-fatal — item exists, AM can add subitems manually.
      // We DO NOT throw, so partial subitems are preserved on the deal item.
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  return { itemId, subitemIds }
}
