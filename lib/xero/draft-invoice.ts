// lib/xero/draft-invoice.ts
import { xeroFetch } from './client'
import type { SupabaseClient } from '@supabase/supabase-js'
import { recordAuditEvent } from '@/lib/audit/recordEvent'
import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import {
  getXeroConfig,
  isXeroEnabled,
  xeroRegionForBillCountry,
  type XeroRegion,
} from './config'
import { isXeroConnectedForRegion } from './token-store'
import { evaluateXeroEligibility } from './eligibility'

export { xeroRegionForBillCountry } from './config'

export interface XeroQuoteLineInput {
  description: string
  quantity: number
  unitAmount: number
}

export interface BuildPayloadArgs {
  contactId: string
  contactName?: string | null
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
  Contact: { ContactID: string; ContactName?: string }
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

/** ExpiryDate from payment terms. */
export function expiryDateFor(paymentTerms: string | null, today: string): string | undefined {
  if (paymentTerms === 'net20') return addDaysUTC(today, 20)
  if (paymentTerms === 'net30') return addDaysUTC(today, 30)
  if (paymentTerms === '20th of month') {
    const issued = new Date(`${today}T00:00:00Z`)
    return new Date(Date.UTC(issued.getUTCFullYear(), issued.getUTCMonth() + 1, 20))
      .toISOString()
      .slice(0, 10)
  }
  return undefined
}

/** Build the Xero DRAFT quote object (one entry of a POST /Quotes batch). */
export function buildDraftQuotePayload(args: BuildPayloadArgs): XeroQuotePayload {
  const expiryDate = expiryDateFor(args.paymentTerms, args.today)
  const contactName = args.contactName?.trim()
  const payload: XeroQuotePayload = {
    Status: 'DRAFT',
    Contact: { ContactID: args.contactId, ...(contactName ? { ContactName: contactName } : {}) },
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
  return { ...line, description: `${line.description} (prepaid stock — drawn down, no charge)`, unitAmount: 0 }
}

type QuoteItemRowForLines = QuoteItemForXero & {
  product_id: string
  variant_id: string | null
  size_id: number | null
  qty_from_stock: number
}

/**
 * Build the Xero quote lines for an order's persisted quote_items. A prepaid
 * line that drew stock is billed at $0 in FULL and tagged; a prepaid variant
 * whose line drew no stock (a made-to-order PO) is charged. There is no
 * within-line split — the no-partial-draw domain rule (short orders become MOQ
 * POs) guarantees a prepaid line is fully drawn or a PO, never partial.
 */
export function buildDraftLines(
  rows: QuoteItemRowForLines[],
  prepaidDrawnLineKeys: Set<string>,
): XeroQuoteLineInput[] {
  return rows.map((row) => {
    const base = buildLineFromQuoteItem(row)
    const key = `${row.product_id}::${row.variant_id ?? ''}::${row.size_id ?? ''}`
    const drewStock = Math.max(0, Number(row.qty_from_stock)) > 0
    // Prepaid + drew stock → whole line $0 (no partial draws: a short prepaid
    // order is a separate MOQ purchase order upstream, never a split line —
    // spec §Domain rules). A prepaid variant's made-to-order PO line has
    // qty_from_stock 0 and is charged.
    return drewStock && prepaidDrawnLineKeys.has(key) ? prepaidZeroLine(base) : base
  })
}

// --- contact resolution --------------------------------------------------------

interface XeroContactsResponse {
  Contacts?: Array<{ ContactID: string }>
}

export interface XeroContactAddress {
  line1: string | null
  city: string | null
  region: string | null
  postalCode: string | null
  country: string | null
}

/** Optional details stamped onto a contact when we CREATE it (never on reuse). */
export interface XeroContactDetails {
  address: XeroContactAddress | null
  phone: string | null
}

export interface ResolveContactArgs {
  /** AU Stage 1 — which Xero connection to resolve the contact against. Xero
   *  contacts are PER organisation, so this must match the draft's region. */
  region: XeroRegion
  /** stores/organizations .xero_contact_id, if already cached. */
  cachedContactId: string | null
  /** Contact name — the ship-to store's name, or the org name as fallback. */
  name: string
  email: string | null
  details?: XeroContactDetails | null
}

export interface ResolvedContact {
  contactId: string
  /** True when we POSTed a brand-new contact (caller should cache it). */
  created: boolean
}

function contactNameWhere(name: string): string {
  // Xero `where` uses double-quoted string literals; escape embedded quotes.
  const escaped = name.replace(/"/g, '\\"')
  return `/Contacts?where=${encodeURIComponent(`Name=="${escaped}"`)}`
}

/** POBOX (shown on documents) + STREET copies of the same location address. */
function contactAddressesFor(a: XeroContactAddress): Array<Record<string, string>> {
  const fields = {
    ...(a.line1 ? { AddressLine1: a.line1 } : {}),
    ...(a.city ? { City: a.city } : {}),
    ...(a.region ? { Region: a.region } : {}),
    ...(a.postalCode ? { PostalCode: a.postalCode } : {}),
    ...(a.country ? { Country: a.country } : {}),
  }
  return [
    { AddressType: 'POBOX', ...fields },
    { AddressType: 'STREET', ...fields },
  ]
}

/**
 * Resolve a Xero ContactID by name: cache → single name match → create. Handles
 * Xero's unique-name-on-create by re-querying (covers a first-order race between
 * two checkouts for a brand-new contact).
 */
export async function resolveXeroContactId(args: ResolveContactArgs): Promise<ResolvedContact> {
  if (args.cachedContactId) return { contactId: args.cachedContactId, created: false }

  const where = contactNameWhere(args.name)
  const found = await xeroFetch<XeroContactsResponse>(where, { region: args.region })
  if (found.Contacts && found.Contacts.length === 1) {
    return { contactId: found.Contacts[0].ContactID, created: false }
  }

  try {
    const created = await xeroFetch<XeroContactsResponse>('/Contacts', {
      method: 'POST',
      region: args.region,
      body: JSON.stringify({
        Contacts: [
          {
            Name: args.name,
            ...(args.email ? { EmailAddress: args.email } : {}),
            ...(args.details?.address ? { Addresses: contactAddressesFor(args.details.address) } : {}),
            ...(args.details?.phone
              ? { Phones: [{ PhoneType: 'DEFAULT', PhoneNumber: args.details.phone }] }
              : {}),
          },
        ],
      }),
    })
    const id = created.Contacts?.[0]?.ContactID
    if (!id) throw new Error('Xero contact create returned no ContactID')
    return { contactId: id, created: true }
  } catch (e) {
    // Unique-name collision (race or pre-existing dup) — re-query and reuse.
    const retry = await xeroFetch<XeroContactsResponse>(where, { region: args.region })
    if (retry.Contacts && retry.Contacts.length >= 1) {
      return { contactId: retry.Contacts[0].ContactID, created: false }
    }
    throw e
  }
}

/** Resolve the person who placed the order without changing the shared Xero
 * organization/store contact. The profile must belong to this organization. */
async function resolveOrdererContactName(
  admin: SupabaseClient,
  organizationId: string,
  email: string | null,
): Promise<string | null> {
  const normalizedEmail = email?.trim().toLowerCase()
  if (!normalizedEmail) return null

  const { data: membershipRows, error: membershipError } = await admin
    .from('user_organizations')
    .select('user_id')
    .eq('organization_id', organizationId)
  if (membershipError || !membershipRows?.length) return null

  const memberIds = membershipRows.map((row) => (row as { user_id: string }).user_id)
  const { data: profileRows, error: profileError } = await admin
    .from('profiles')
    .select('id, email, full_name, auth_display_name')
    .in('id', memberIds)
  if (profileError) return null

  const profile = (profileRows as Array<{
    email: string | null
    full_name: string | null
    auth_display_name: string | null
  }> | null)?.find((row) => row.email?.trim().toLowerCase() === normalizedEmail)
  return profile?.full_name?.trim() || profile?.auth_display_name?.trim() || null
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
  /** Ship-to store (location) — the quote's Xero contact when set. Null/absent
   *  (one-time custom address) falls back to the organisation contact. */
  shipToStoreId?: string | null
  actorUserId: string | null
  ordererEmail: string | null
  paymentTerms: string | null // includes legacy account-specific terms such as '20th of month'
  isTestOrg: boolean
  /** organizations.region — selects the Xero organisation (tenant header +
   *  payload config). Not-connected regions skip with reason not_connected. */
  orgRegion: XeroRegion | null
  /** Immutable quote billing stamp. When present this owns region selection;
   *  orgRegion remains only for pre-SP3 callers during the dark cutover. */
  billCountry?: string
  /** NZ picking fee for this order (0 when none applies). Added as a separate
   *  Xero line. Computed in submit.ts step 5c (stock-on-hand + NZ, region-gated). */
  pickingFee: number
  /** Line keys (product::variant::size, matching makeLineKey) whose prepaid
   *  variant's drawn-from-stock portion is zeroed on the draft (pick fee only). */
  prepaidDrawnLineKeys: Set<string>
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

  const billCountry = args.billCountry ?? args.orgRegion
  const xeroRegion = billCountry ? xeroRegionForBillCountry(billCountry) : null
  if (!xeroRegion) {
    await admin.from('orders').update({ xero_invoice_status: 'skipped' }).eq('id', args.orderId)
    await recordAuditEvent(
      {
        orgId: args.organizationId,
        actorUserId: args.actorUserId,
        action: AUDIT_ACTIONS.ORDER_XERO_DRAFT_SKIPPED,
        targetType: 'order',
        targetId: args.orderId,
        metadata: {
          order_ref: args.orderRef,
          billCountry,
          reason: 'unsupported_country',
        },
      },
      admin,
    )
    return { status: 'skipped', reason: 'unsupported_country' }
  }

  // Not-connected gate, BOTH regions (spec §6): no token row, or this region's
  // tenant unassigned → skip + audit; the order proceeds. Supersedes the AU
  // dark-until-secrets gate — auth state is DB state now.
  if (!(await isXeroConnectedForRegion(xeroRegion))) {
    await admin.from('orders').update({ xero_invoice_status: 'skipped' }).eq('id', args.orderId)
    await recordAuditEvent(
      {
        orgId: args.organizationId,
        actorUserId: args.actorUserId,
        action: AUDIT_ACTIONS.ORDER_XERO_DRAFT_SKIPPED,
        targetType: 'order',
        targetId: args.orderId,
        metadata: {
          order_ref: args.orderRef,
          billCountry,
          reason: 'not_connected',
          region: xeroRegion,
        },
      },
      admin,
    )
    return { status: 'skipped', reason: 'not_connected' }
  }

  const cfg = getXeroConfig(xeroRegion)

  // Contact — the quote is made out to the ship-to LOCATION (store): its own
  // cached id, its name (e.g. "Reburger Takapuna"), and its address/phone/email
  // as the contact details. One-time custom-address orders (no store) fall back
  // to the organisation contact, as before.
  let resolvedContact: ResolvedContact | null = null
  if (args.shipToStoreId) {
    const { data: storeRow } = await admin
      .from('stores')
      .select('xero_contact_id, name, address, city, state, country, postal_code, phone, email')
      .eq('id', args.shipToStoreId)
      .maybeSingle()
    const store = storeRow as {
      xero_contact_id: string | null
      name: string | null
      address: string | null
      city: string | null
      state: string | null
      country: string | null
      postal_code: string | null
      phone: string | null
      email: string | null
    } | null
    if (store?.name) {
      const resolved = await resolveXeroContactId({
        region: xeroRegion,
        cachedContactId: store.xero_contact_id,
        name: store.name,
        email: store.email ?? args.ordererEmail,
        details: {
          address: {
            line1: store.address,
            city: store.city,
            region: store.state,
            postalCode: store.postal_code,
            country: store.country,
          },
          phone: store.phone,
        },
      })
      if (resolved.created || !store.xero_contact_id) {
        await admin
          .from('stores')
          .update({ xero_contact_id: resolved.contactId })
          .eq('id', args.shipToStoreId)
      }
      resolvedContact = resolved
    }
  }
  if (!resolvedContact) {
    // Read the cached org id, resolve, and cache back if newly created.
    const { data: orgRow } = await admin
      .from('organizations')
      .select('xero_contact_id')
      .eq('id', args.organizationId)
      .maybeSingle()
    const cachedContactId = (orgRow as { xero_contact_id: string | null } | null)?.xero_contact_id ?? null
    resolvedContact = await resolveXeroContactId({
      region: xeroRegion,
      cachedContactId,
      name: args.organizationName,
      email: args.ordererEmail,
    })
    if (resolvedContact.created || !cachedContactId) {
      await admin
        .from('organizations')
        .update({ xero_contact_id: resolvedContact.contactId })
        .eq('id', args.organizationId)
    }
  }
  const { contactId } = resolvedContact
  const contactName = await resolveOrdererContactName(
    admin,
    args.organizationId,
    args.ordererEmail,
  )

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
  // Spec B/3a: a prepaid line that drew stock is billed at $0 in full (goods
  // already paid); the pick fee rides on its own line. Key format matches
  // makeLineKey in submit.ts.
  const lines = buildDraftLines(itemRows2, args.prepaidDrawnLineKeys)
  if (args.pickingFee > 0) lines.push(buildPickFeeLine(args.pickingFee))

  const payload = buildDraftQuotePayload({
    contactId,
    contactName,
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
    region: xeroRegion,
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
