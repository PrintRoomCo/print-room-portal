// lib/xero/draft-invoice.ts
import { xeroFetch } from './client'

export interface XeroInvoiceLineInput {
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
  lines: XeroInvoiceLineInput[]
}

interface XeroLineItem {
  Description: string
  Quantity: number
  UnitAmount: number
  AccountCode: string
  TaxType: string
}

export interface XeroInvoicePayload {
  Type: 'ACCREC'
  Status: 'DRAFT'
  Contact: { ContactID: string }
  LineAmountTypes: string
  Reference: string
  Date: string
  DueDate?: string
  CurrencyCode: string
  BrandingThemeID?: string
  LineItems: XeroLineItem[]
}

/** Add whole days to a 'YYYY-MM-DD' date in UTC (deterministic, tz-safe). */
export function addDaysUTC(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** DueDate from payment terms. net20→+20d, net30→+30d, else none. */
export function dueDateFor(paymentTerms: string | null, today: string): string | undefined {
  if (paymentTerms === 'net20') return addDaysUTC(today, 20)
  if (paymentTerms === 'net30') return addDaysUTC(today, 30)
  return undefined
}

/** Build the Xero ACCREC DRAFT invoice object (one entry of a POST /Invoices batch). */
export function buildDraftInvoicePayload(args: BuildPayloadArgs): XeroInvoicePayload {
  const dueDate = dueDateFor(args.paymentTerms, args.today)
  const payload: XeroInvoicePayload = {
    Type: 'ACCREC',
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
  if (dueDate) payload.DueDate = dueDate
  if (args.brandingThemeId) payload.BrandingThemeID = args.brandingThemeId
  return payload
}

// --- quote_items → invoice line ------------------------------------------------

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
 * Compose one Xero invoice line from a persisted quote_item. unit_price already
 * includes any folded decoration cost (submit.ts folds it before the RPC), so we
 * bill it as-is. Description mirrors the Monday subitem label style.
 */
export function buildLineFromQuoteItem(row: QuoteItemForXero): XeroInvoiceLineInput {
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
