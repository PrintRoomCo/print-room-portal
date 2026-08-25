// lib/xero/__tests__/create-draft.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('../client', () => ({ xeroFetch: vi.fn() }))
vi.mock('@/lib/audit/recordEvent', () => ({ recordAuditEvent: vi.fn() }))
vi.mock('../token-store', () => ({ isXeroConnectedForCountry: vi.fn() }))

import { xeroFetch } from '../client'
import { recordAuditEvent } from '@/lib/audit/recordEvent'
import { isXeroConnectedForCountry } from '../token-store'
import { createDraftInvoiceForOrder, type CreateDraftInvoiceArgs } from '../draft-invoice'

const mockFetch = vi.mocked(xeroFetch)
const mockAudit = vi.mocked(recordAuditEvent)
const mockConnected = vi.mocked(isXeroConnectedForCountry)

const COUNTRY_ROWS = {
  NZ: { code: 'NZ', currency: 'NZD', xero_sales_account: '191', xero_tax_type: 'OUTPUT2' },
  AU: { code: 'AU', currency: 'AUD', xero_sales_account: '200', xero_tax_type: 'OUTPUT' },
  GB: { code: 'GB', currency: 'GBP', xero_sales_account: '310', xero_tax_type: 'OUTPUT2' },
} as const

/** Minimal chainable Supabase stub covering exactly the calls the orchestrator makes. */
function fakeAdmin(opts: {
  cachedContactId: string | null
  quoteItems: unknown[]
  storeRow?: Record<string, unknown> | null
  countryRows?: Record<string, Record<string, unknown>>
}) {
  const updates: Array<{ table: string; payload: Record<string, unknown> }> = []
  const from = (table: string) => ({
    select: () => ({
      eq: (_column: string, value: unknown) => ({
        maybeSingle: async () => ({
          data:
            table === 'countries'
              ? ((opts.countryRows ?? COUNTRY_ROWS) as Record<string, Record<string, unknown>>)[String(value)] ?? null
              : table === 'organizations'
              ? { xero_contact_id: opts.cachedContactId }
              : table === 'stores'
                ? opts.storeRow ?? null
                : null,
          error: null,
        }),
        // `await admin.from('quote_items').select().eq()` resolves here:
        then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
          resolve({ data: table === 'quote_items' ? opts.quoteItems : null, error: null }),
      }),
    }),
    update: (payload: Record<string, unknown>) => {
      updates.push({ table, payload })
      return { eq: async () => ({ error: null }) }
    },
  })
  return { admin: { from } as unknown as SupabaseClient, updates }
}

const args: CreateDraftInvoiceArgs = {
  orderId: 'order-1',
  orderRef: 'ORD-2026-0042',
  quoteId: 'quote-1',
  organizationId: 'org-1',
  organizationName: 'Acme Co',
  actorUserId: 'user-1',
  ordererEmail: 'buyer@acme.test',
  paymentTerms: 'net20',
  isTestOrg: false,
  billCountry: 'NZ',
  pickingFee: 0,
  prepaidDrawnLineKeys: new Set<string>(),
  existingInvoiceId: null,
  today: '2026-07-02',
}

beforeEach(() => {
  vi.resetAllMocks()
  mockConnected.mockResolvedValue(true)
  process.env.XERO_ENABLED = 'true'
  process.env.XERO_CLIENT_ID = 'cid'
  process.env.XERO_CLIENT_SECRET = 'secret'
  delete process.env.XERO_AU_CLIENT_ID
  delete process.env.XERO_AU_CLIENT_SECRET
})

describe('createDraftInvoiceForOrder — eligible', () => {
  it('resolves contact, POSTs a draft quote, persists ids, audits drafted', async () => {
    mockFetch
      .mockResolvedValueOnce({ Contacts: [{ ContactID: 'c-1' }] }) // name match
      .mockResolvedValueOnce({ Quotes: [{ QuoteID: 'quote-xero-1', QuoteNumber: 'QU-0001' }] }) // create
    const { admin, updates } = fakeAdmin({
      cachedContactId: null,
      quoteItems: [{ product_name: 'Tee', quantity: 10, unit_price: 12.5, size_label: 'M', decorations: [{ name: 'Logo' }], product_variants: { product_color_swatches: { label: 'Black' } } }],
    })

    const res = await createDraftInvoiceForOrder(admin, args)

    expect(res).toEqual({ status: 'drafted', reason: 'ok', invoiceId: 'quote-xero-1', invoiceNumber: 'QU-0001' })
    // POST /Quotes carries the order id as the Idempotency-Key
    const quoteCall = mockFetch.mock.calls.find((c) => c[0] === '/Quotes')
    expect(quoteCall?.[1]).toMatchObject({ method: 'POST', idempotencyKey: 'order-1' })
    // org cache written + orders row stamped
    expect(updates).toContainEqual({ table: 'organizations', payload: { xero_contact_id: 'c-1' } })
    expect(updates).toContainEqual({ table: 'orders', payload: { xero_invoice_id: 'quote-xero-1', xero_invoice_number: 'QU-0001', xero_invoice_status: 'drafted' } })
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'order.xero_drafted' }), admin)
  })

  it('drafts a stock-draw order now — the draws_stock gate is gone (Spec A)', async () => {
    // Spec A invoices stock-on-hand orders too. cachedContactId set → the only
    // xeroFetch is POST /Quotes.
    mockFetch.mockResolvedValueOnce({ Quotes: [{ QuoteID: 'quote-xero-2', QuoteNumber: 'QU-0002' }] })
    const { admin, updates } = fakeAdmin({ cachedContactId: 'c-1', quoteItems: [] })
    const res = await createDraftInvoiceForOrder(admin, args)
    expect(res).toEqual({ status: 'drafted', reason: 'ok', invoiceId: 'quote-xero-2', invoiceNumber: 'QU-0002' })
    expect(updates).toContainEqual({ table: 'orders', payload: { xero_invoice_id: 'quote-xero-2', xero_invoice_number: 'QU-0002', xero_invoice_status: 'drafted' } })
    expect(updates).not.toContainEqual({ table: 'orders', payload: { xero_invoice_status: 'manual_review' } })
  })

  it('zeroes a prepaid stocked line and appends a pick-fee line to the payload', async () => {
    mockFetch.mockResolvedValueOnce({ Quotes: [{ QuoteID: 'quote-xero-3', QuoteNumber: 'QU-0003' }] })
    const { admin } = fakeAdmin({
      cachedContactId: 'c-1',
      quoteItems: [
        // prepaid stocked line — key matches, should be zeroed + relabelled
        {
          product_name: 'Tee', quantity: 24, unit_price: 12.5, size_label: 'M',
          decorations: null, product_variants: { product_color_swatches: { label: 'Black' } },
          product_id: 'p-1', variant_id: 'v-1', size_id: 3, qty_from_stock: 24,
        },
        // not-paid stocked line — billed as-is
        {
          product_name: 'Cap', quantity: 10, unit_price: 20, size_label: null,
          decorations: null, product_variants: null,
          product_id: 'p-2', variant_id: null, size_id: null, qty_from_stock: 10,
        },
      ],
    })

    const res = await createDraftInvoiceForOrder(admin, {
      ...args,
      pickingFee: 30,
      prepaidDrawnLineKeys: new Set(['p-1::v-1::3']),
    })

    expect(res.status).toBe('drafted')
    const quoteCall = mockFetch.mock.calls.find((c) => c[0] === '/Quotes')
    const body = JSON.parse((quoteCall?.[1] as { body: string }).body) as {
      Quotes: Array<{ LineItems: Array<{ Description: string; Quantity: number; UnitAmount: number }> }>
    }
    const items = body.Quotes[0].LineItems
    // prepaid line zeroed ($0) + relabelled
    expect(items).toContainEqual(
      expect.objectContaining({ Description: expect.stringContaining('(prepaid stock — drawn down, no charge)'), Quantity: 24, UnitAmount: 0 }),
    )
    // not-paid line billed as-is
    expect(items).toContainEqual(expect.objectContaining({ Quantity: 10, UnitAmount: 20 }))
    // pick fee rides on its own line
    expect(items).toContainEqual(expect.objectContaining({ Description: 'Picking fee', Quantity: 1, UnitAmount: 30 }))
  })
})

describe('createDraftInvoiceForOrder — location contact (shipToStoreId)', () => {
  const takapuna = {
    xero_contact_id: null,
    name: 'Reburger Takapuna',
    address: '6 Te Rauroha Street, Papakura',
    city: 'Auckland',
    state: null,
    country: 'NZ',
    postal_code: '2110',
    phone: null,
    email: null,
  }

  it('makes the quote out to the store: name + address on create, cached per-store', async () => {
    mockFetch
      .mockResolvedValueOnce({ Contacts: [] }) // name lookup: none
      .mockResolvedValueOnce({ Contacts: [{ ContactID: 'store-c-1' }] }) // create
      .mockResolvedValueOnce({ Quotes: [{ QuoteID: 'qx-1', QuoteNumber: 'QU-0100' }] })
    const { admin, updates } = fakeAdmin({ cachedContactId: null, storeRow: takapuna, quoteItems: [] })

    const res = await createDraftInvoiceForOrder(admin, { ...args, shipToStoreId: 'store-1' })

    expect(res.status).toBe('drafted')
    // Contact created with the STORE name and location details — not the org name.
    const createBody = (mockFetch.mock.calls[1][1] as { body: string }).body
    expect(createBody).toContain('"Name":"Reburger Takapuna"')
    expect(createBody).not.toContain('"Name":"Acme Co"')
    expect(createBody).toContain('"AddressLine1":"6 Te Rauroha Street, Papakura"')
    expect(createBody).toContain('"PostalCode":"2110"')
    // Store has no email → orderer email fallback.
    expect(createBody).toContain('"EmailAddress":"buyer@acme.test"')
    // Cached on the store, org cache untouched.
    expect(updates).toContainEqual({ table: 'stores', payload: { xero_contact_id: 'store-c-1' } })
    expect(updates.filter((u) => u.table === 'organizations')).toHaveLength(0)
    // Quote is made out to the store contact.
    const quoteCall = mockFetch.mock.calls.find((c) => c[0] === '/Quotes')
    expect((quoteCall?.[1] as { body: string }).body).toContain('"ContactID":"store-c-1"')
  })

  it('prefers the store email over the orderer email on create', async () => {
    mockFetch
      .mockResolvedValueOnce({ Contacts: [] })
      .mockResolvedValueOnce({ Contacts: [{ ContactID: 'store-c-2' }] })
      .mockResolvedValueOnce({ Quotes: [{ QuoteID: 'qx-2', QuoteNumber: 'QU-0101' }] })
    const { admin } = fakeAdmin({
      cachedContactId: null,
      storeRow: { ...takapuna, email: 'takapuna@reburger.test' },
      quoteItems: [],
    })
    await createDraftInvoiceForOrder(admin, { ...args, shipToStoreId: 'store-1' })
    const createBody = (mockFetch.mock.calls[1][1] as { body: string }).body
    expect(createBody).toContain('"EmailAddress":"takapuna@reburger.test"')
  })

  it('uses the cached store contact id without any contact lookup', async () => {
    mockFetch.mockResolvedValueOnce({ Quotes: [{ QuoteID: 'qx-3', QuoteNumber: 'QU-0102' }] })
    const { admin, updates } = fakeAdmin({
      cachedContactId: null,
      storeRow: { ...takapuna, xero_contact_id: 'store-cached-1' },
      quoteItems: [],
    })
    const res = await createDraftInvoiceForOrder(admin, { ...args, shipToStoreId: 'store-1' })
    expect(res.status).toBe('drafted')
    expect(mockFetch).toHaveBeenCalledTimes(1) // POST /Quotes only
    expect((mockFetch.mock.calls[0][1] as { body: string }).body).toContain('"ContactID":"store-cached-1"')
    expect(updates.filter((u) => u.table === 'stores')).toHaveLength(0)
  })

  it('falls back to the organisation contact when the store row is missing', async () => {
    mockFetch.mockResolvedValueOnce({ Quotes: [{ QuoteID: 'qx-4', QuoteNumber: 'QU-0103' }] })
    const { admin } = fakeAdmin({ cachedContactId: 'org-c-1', storeRow: null, quoteItems: [] })
    const res = await createDraftInvoiceForOrder(admin, { ...args, shipToStoreId: 'store-gone' })
    expect(res.status).toBe('drafted')
    expect((mockFetch.mock.calls[0][1] as { body: string }).body).toContain('"ContactID":"org-c-1"')
  })
})

describe('createDraftInvoiceForOrder — ineligible', () => {
  it('skips (no write, no audit) when the flag is off', async () => {
    process.env.XERO_ENABLED = 'false'
    const { admin, updates } = fakeAdmin({ cachedContactId: null, quoteItems: [] })
    const res = await createDraftInvoiceForOrder(admin, args)
    expect(res).toEqual({ status: 'skipped', reason: 'disabled' })
    expect(updates).toHaveLength(0)
    expect(mockAudit).not.toHaveBeenCalled()
  })

  it('records skipped status for a test org (no audit)', async () => {
    const { admin, updates } = fakeAdmin({ cachedContactId: null, quoteItems: [] })
    const res = await createDraftInvoiceForOrder(admin, { ...args, isTestOrg: true })
    expect(res).toEqual({ status: 'skipped', reason: 'test_org' })
    expect(updates).toContainEqual({ table: 'orders', payload: { xero_invoice_status: 'skipped' } })
    expect(mockAudit).not.toHaveBeenCalled()
  })
})

describe('createDraftInvoiceForOrder — Xero failure propagates', () => {
  it('throws when POST /Quotes fails (caller catches + audits failed)', async () => {
    // cachedContactId set → resolveXeroContactId short-circuits (no fetch), so the
    // ONLY xeroFetch call is POST /Quotes — mock it to reject.
    mockFetch.mockRejectedValueOnce(new Error('Xero API 400 on /Quotes: ValidationException'))
    const { admin } = fakeAdmin({ cachedContactId: 'c-1', quoteItems: [] })
    await expect(createDraftInvoiceForOrder(admin, args)).rejects.toThrow(/ValidationException/)
  })
})

describe('createDraftInvoiceForOrder — country routing + not_connected gate', () => {
  it('skips and audits an unsupported exact bill-country stamp without touching Xero', async () => {
    mockConnected.mockResolvedValue(false)
    const { admin, updates } = fakeAdmin({ cachedContactId: null, quoteItems: [] })

    const res = await createDraftInvoiceForOrder(admin, {
      ...args,
      billCountry: 'US',
    })

    expect(res).toEqual({ status: 'skipped', reason: 'unsupported_country' })
    expect(updates).toEqual([
      { table: 'orders', payload: { xero_invoice_status: 'skipped' } },
    ])
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'order.xero_draft_skipped',
        metadata: expect.objectContaining({
          reason: 'unsupported_country',
          country_code: 'US',
        }),
      }),
      admin,
    )
    expect(mockConnected).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it.each(['NZ', 'AU', 'GB'] as const)(
    '%s country row with no connection: skips not_connected and sends zero HTTP',
    async (countryCode) => {
      mockConnected.mockResolvedValue(false)
      const { admin, updates } = fakeAdmin({ cachedContactId: null, quoteItems: [] })
      const res = await createDraftInvoiceForOrder(admin, { ...args, billCountry: countryCode })
      expect(res).toEqual({ status: 'skipped', reason: 'not_connected' })
      expect(mockConnected).toHaveBeenCalledWith(countryCode)
      expect(updates).toEqual([{ table: 'orders', payload: { xero_invoice_status: 'skipped' } }])
      expect(mockAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'order.xero_draft_skipped',
          metadata: expect.objectContaining({ reason: 'not_connected', country_code: countryCode }),
        }),
        admin,
      )
      expect(mockFetch).not.toHaveBeenCalled()
    },
  )

  it('GB country, connected: reaches the GB tenant with row-backed GBP config', async () => {
    const { admin } = fakeAdmin({ cachedContactId: 'contact-1', quoteItems: [] })
    mockFetch.mockResolvedValueOnce({ Quotes: [{ QuoteID: 'q-gb', QuoteNumber: 'QU-1' }] })

    const res = await createDraftInvoiceForOrder(admin, { ...args, billCountry: 'GB' })

    expect(res.status).toBe('drafted')
    for (const call of mockFetch.mock.calls) {
      expect((call[1] as { countryCode?: string } | undefined)?.countryCode).toBe('GB')
    }
    const payload = JSON.parse((mockFetch.mock.calls.at(-1)![1] as { body: string }).body)
    expect(payload.Quotes[0]).toMatchObject({ CurrencyCode: 'GBP' })
    expect(payload.Quotes[0].LineItems).toEqual([])
  })
})
