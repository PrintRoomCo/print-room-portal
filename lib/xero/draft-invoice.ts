// lib/xero/draft-invoice.ts
import { xeroFetch } from './client'
import type { SupabaseClient } from '@supabase/supabase-js'
import { recordAuditEvent } from '@/lib/audit/recordEvent'
import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { getXeroConfig, isXeroEnabled } from './config'
import { evaluateXeroEligibility } from './eligibility'

export interface XeroQuoteLineInput {
  description: string
  quantity: number
  unitAmount: number
}

export interface BuildPayloadArgs {
  contactId: string
  orderRef: string
  today: string // 'YYYY-MM-DD'
  paymentTerms: string | null
  currency: string
  accountCode: string
  taxType: string
  lineAmountTypes: string
  brandingThemeId: string | null
  deliveryAddressSummary?: string | null
  lines: XeroQuoteLineInput[]
}

interface XeroLineItem {
  Description: string
  Quantity: number
  UnitAmount: number
  AccountCode: string
  TaxType: string
}

export interface XeroQuotePayload {
  Status: 'DRAFT'
  Contact: { ContactID: string }
  LineAmountTypes: string
  Reference: string
  Date: string
  ExpiryDate?: string
  CurrencyCode: string
  BrandingThemeID?: string
  Summary?: string
  LineItems: XeroLineItem[]
}

const XERO_QUOTE_SUMMARY_MAX = 3000

/** Add whole days to a 'YYYY-MM-DD' date in UTC (deterministic, tz-safe). */
export function addDaysUTC(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** ExpiryDate from payment terms. net20→+20d, net30→+30d, else none. */
export function expiryDateFor(paymentTerms: string | null, today: string): string | undefined {
  if (paymentTerms === 'net20') return addDaysUTC(today, 20)
  if (paymentTerms === 'net30') return addDaysUTC(today, 30)
  return undefined
}

/** Build the Xero DRAFT quote object (one entry of a POST /Quotes batch). */
export function buildDraftQuotePayload(args: BuildPayloadArgs): XeroQuotePayload {
  const expiryDate = expiryDateFor(args.paymentTerms, args.today)
  const payload: XeroQuotePayload = {
    Status: 'DRAFT',
    Contact: { ContactID: args.contactId },
    LineAmountTypes: args.lineAmountTypes,
    Reference: args.orderRef,
    Date: args.today,
    CurrencyCode: args.currency,
    LineItems: args.lines.map((l) => ({
      Description: l.description,
      Quantity: l.quantity,
      UnitAmount: l.unitAmount,
      AccountCode: args.accountCode,
      TaxType: args.taxType,
    })),
  }
  if (expiryDate) payload.ExpiryDate = expiryDate
  if (args.brandingThemeId) payload.BrandingThemeID = args.brandingThemeId
  if (args.deliveryAddressSummary?.trim()) {
    payload.Summary = `Delivery address:\n${args.deliveryAddressSummary.trim()}`.slice(
      0,
      XERO_QUOTE_SUMMARY_MAX,
    )
  }
  return payload
}

// Back-compat exports for existing tests/callers while the DB/audit naming still
// reflects the original draft-invoice integration.
export const dueDateFor = expiryDateFor
export const buildDraftInvoicePayload = buildDraftQuotePayload

// --- quote_items → quote line --------------------------------------------------

type SwatchEmbed = { label: string | null } | { label: string | null }[] | null

export interface QuoteItemForXero {
  product_name: string
  quantity: number
  unit_price: number | string
  size_label: string | null
  decorations: Array<{ name?: string }> | null
  product_variants: { product_color_swatches: SwatchEmbed } | null
}

function firstOrSelf<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? v[0] ?? null : v
}

/**
 * Compose one Xero quote line from a persisted quote_item. unit_price already
 * includes any folded decoration cost (submit.ts folds it before the RPC), so we
 * bill it as-is. Description mirrors the Monday subitem label style.
 */
export function buildLineFromQuoteItem(row: QuoteItemForXero): XeroQuoteLineInput {
  const swatch = firstOrSelf(row.product_variants?.product_color_swatches)
  const variantBits = [swatch?.label, row.size_label].filter(Boolean).join(' / ')
  const design = row.decorations?.[0]?.name
  const description = [
    row.product_name,
    variantBits ? `— ${variantBits}` : '',
    design ? `(${design})` : '',
  ]
    .filter(Boolean)
    .join(' ')
  return { description, quantity: Number(row.quantity), unitAmount: Number(row.unit_price) }
}

/** A separate Xero line for the NZ picking fee (billed once per order). */
export function buildPickFeeLine(feeNzd: number): XeroQuoteLineInput {
  return { description: 'Picking fee', quantity: 1, unitAmount: feeNzd }
}

/** Zero a prepaid goods line (100% discount) while keeping it visible on the quote. */
export function prepaidZeroLine(line: XeroQuoteLineInput): XeroQuoteLineInput {
  return { ...line, description: `${line.description} (prepaid — no charge)`, unitAmount: 0 }
}

// --- contact resolution --------------------------------------------------------

interface XeroContactsResponse {
  Contacts?: Array<{ ContactID: string }>
}

export interface ResolveContactArgs {
  /** organizations.xero_contact_id, if already cached. */
  cachedContactId: string | null
  orgName: string
  email: string | null
}

export interface ResolvedContact {
  contactId: string
  /** True when we POSTed a brand-new contact (caller should cache it). */
  created: boolean
}

function contactNameWhere(orgName: string): string {
  // Xero `where` uses double-quoted string literals; escape embedded quotes.
  const escaped = orgName.replace(/"/g, '\\"')
  return `/Contacts?where=${encodeURIComponent(`Name=="${escaped}"`)}`
}

/**
 * Resolve the org's Xero ContactID: cache → single name match → create. Handles
 * Xero's unique-name-on-create by re-querying (covers a first-order race between
 * two checkouts for a brand-new org).
 */
export async function resolveXeroContactId(args: ResolveContactArgs): Promise<ResolvedContact> {
  if (args.cachedContactId) return { contactId: args.cachedContactId, created: false }

  const where = contactNameWhere(args.orgName)
  const found = await xeroFetch<XeroContactsResponse>(where)
  if (found.Contacts && found.Contacts.length === 1) {
    return { contactId: found.Contacts[0].ContactID, created: false }
  }

  try {
    const created = await xeroFetch<XeroContactsResponse>('/Contacts', {
      method: 'POST',
      body: JSON.stringify({
        Contacts: [{ Name: args.orgName, ...(args.email ? { EmailAddress: args.email } : {}) }],
      }),
    })
    const id = created.Contacts?.[0]?.ContactID
    if (!id) throw new Error('Xero contact create returned no ContactID')
    return { contactId: id, created: true }
  } catch (e) {
    // Unique-name collision (race or pre-existing dup) — re-query and reuse.
    const retry = await xeroFetch<XeroContactsResponse>(where)
    if (retry.Contacts && retry.Contacts.length >= 1) {
      return { contactId: retry.Contacts[0].ContactID, created: false }
    }
    throw e
  }
}

// --- orchestrator --------------------------------------------------------------

interface XeroQuotesResponse {
  Quotes?: Array<{ QuoteID: string; QuoteNumber?: string }>
}

export interface CreateDraftInvoiceArgs {
  orderId: string
  orderRef: string
  quoteId: string
  organizationId: string
  organizationName: string
  actorUserId: string | null
  ordererEmail: string | null
  paymentTerms: string | null // 'prepay' | 'net20' | 'net30' | null
  isTestOrg: boolean
  /** NZ picking fee for this order (0 when none applies). Added as a separate
   *  Xero line. Computed in submit.ts step 5c (stock-on-hand + NZ, region-gated). */
  pickingFee: number
  /** Line keys (product::variant::size, matching makeLineKey) whose prepaid
   *  stocked goods are zeroed on the draft (billed at $0 — pick fee only). */
  prepaidStockedLineKeys: Set<string>
  existingInvoiceId: string | null
  today: string // 'YYYY-MM-DD'
  deliveryAddressSummary?: string | null
}

export interface CreateDraftInvoiceResult {
  status: 'drafted' | 'manual_review' | 'skipped'
  reason: string
  invoiceId?: string
  invoiceNumber?: string
}

/**
 * Create one order's Xero DRAFT quote, or flag it for manual review.
 * Best-effort contract: on a Xero/DB error it THROWS — the caller (submit.ts
 * step 5c) wraps this in try/catch and audits ORDER_XERO_DRAFT_FAILED. It never
 * rolls back the order.
 */
export async function createDraftInvoiceForOrder(
  admin: SupabaseClient,
  args: CreateDraftInvoiceArgs,
): Promise<CreateDraftInvoiceResult> {
  // Spec A: every non-test order is invoiced — purchase orders and stock-on-hand
  // alike. No payment-terms or stock-draw gate remains. Spec B layers prepaid
  // goods-zeroing + a separate pick-fee line onto the draft below.
  const elig = evaluateXeroEligibility({
    xeroEnabled: isXeroEnabled(),
    existingInvoiceId: args.existingInvoiceId,
    isTestOrg: args.isTestOrg,
  })

  if (!elig.eligible) {
    // test_org → record a 'skipped' status (keeps the ledger clean, no nag).
    if (elig.reason === 'test_org') {
      await admin.from('orders').update({ xero_invoice_status: 'skipped' }).eq('id', args.orderId)
    }
    // 'disabled' / 'already_drafted' → fully inert (no write, no audit).
    return { status: 'skipped', reason: elig.reason }
  }

  const cfg = getXeroConfig()

  // Contact — read the cached id, resolve, and cache back if newly created.
  const { data: orgRow } = await admin
    .from('organizations')
    .select('xero_contact_id')
    .eq('id', args.organizationId)
    .maybeSingle()
  const cachedContactId = (orgRow as { xero_contact_id: string | null } | null)?.xero_contact_id ?? null
  const { contactId, created } = await resolveXeroContactId({
    cachedContactId,
    orgName: args.organizationName,
    email: args.ordererEmail,
  })
  if (created || !cachedContactId) {
    await admin.from('organizations').update({ xero_contact_id: contactId }).eq('id', args.organizationId)
  }

  // Lines — read the persisted quote_items (canonical, decoration already folded).
  const { data: itemRows } = await admin
    .from('quote_items')
    .select(
      `product_name, quantity, unit_price, size_label, decorations,
       product_id, variant_id, size_id, qty_from_stock,
       product_variants ( product_color_swatches(label) )`,
    )
    .eq('quote_id', args.quoteId)
  const itemRows2 = (itemRows ?? []) as unknown as Array<
    QuoteItemForXero & {
      product_id: string
      variant_id: string | null
      size_id: number | null
      qty_from_stock: number
    }
  >
  // Spec B: a prepaid stocked line is billed at $0 (goods already paid); the
  // pick fee rides on its own line. Key format matches makeLineKey in submit.ts.
  const lines = itemRows2.map((row) => {
    const base = buildLineFromQuoteItem(row)
    const key = `${row.product_id}::${row.variant_id ?? ''}::${row.size_id ?? ''}`
    const isPrepaidStocked = row.qty_from_stock > 0 && args.prepaidStockedLineKeys.has(key)
    return isPrepaidStocked ? prepaidZeroLine(base) : base
  })
  if (args.pickingFee > 0) lines.push(buildPickFeeLine(args.pickingFee))

  const payload = buildDraftQuotePayload({
    contactId,
    orderRef: args.orderRef,
    today: args.today,
    paymentTerms: args.paymentTerms,
    currency: cfg.currency,
    accountCode: cfg.salesAccountCode,
    taxType: cfg.taxType,
    lineAmountTypes: cfg.lineAmountTypes,
    brandingThemeId: cfg.brandingThemeId,
    deliveryAddressSummary: args.deliveryAddressSummary,
    lines,
  })

  // Idempotency-Key (order id) closes the write→persist crash gap: a retry with
  // the same key returns the already-created draft instead of a duplicate.
  const res = await xeroFetch<XeroQuotesResponse>('/Quotes', {
    method: 'POST',
    idempotencyKey: args.orderId,
    body: JSON.stringify({ Quotes: [payload] }),
  })
  const quote = res.Quotes?.[0]
  if (!quote?.QuoteID) throw new Error('Xero quote create returned no QuoteID')

  await admin
    .from('orders')
    .update({
      xero_invoice_id: quote.QuoteID,
      xero_invoice_number: quote.QuoteNumber ?? null,
      xero_invoice_status: 'drafted',
    })
    .eq('id', args.orderId)

  await recordAuditEvent(
    {
      orgId: args.organizationId,
      actorUserId: args.actorUserId,
      action: AUDIT_ACTIONS.ORDER_XERO_DRAFTED,
      targetType: 'order',
      targetId: args.orderId,
      metadata: { order_ref: args.orderRef, xero_quote_id: quote.QuoteID, xero_quote_number: quote.QuoteNumber ?? null },
    },
    admin,
  )

  return { status: 'drafted', reason: 'ok', invoiceId: quote.QuoteID, invoiceNumber: quote.QuoteNumber }
}
