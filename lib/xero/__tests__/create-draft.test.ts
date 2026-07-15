// lib/xero/__tests__/create-draft.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('../client', () => ({ xeroFetch: vi.fn() }))
vi.mock('@/lib/audit/recordEvent', () => ({ recordAuditEvent: vi.fn() }))

import { xeroFetch } from '../client'
import { recordAuditEvent } from '@/lib/audit/recordEvent'
import { createDraftInvoiceForOrder, type CreateDraftInvoiceArgs } from '../draft-invoice'

const mockFetch = vi.mocked(xeroFetch)
const mockAudit = vi.mocked(recordAuditEvent)

/** Minimal chainable Supabase stub covering exactly the calls the orchestrator makes. */
function fakeAdmin(opts: { cachedContactId: string | null; quoteItems: unknown[] }) {
  const updates: Array<{ table: string; payload: Record<string, unknown> }> = []
  const from = (table: string) => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({
          data: table === 'organizations' ? { xero_contact_id: opts.cachedContactId } : null,
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
  drawsStock: false,
  existingInvoiceId: null,
  today: '2026-07-02',
}

beforeEach(() => {
  vi.resetAllMocks()
  process.env.XERO_ENABLED = 'true'
  process.env.XERO_CLIENT_ID = 'cid'
  process.env.XERO_CLIENT_SECRET = 'secret'
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
    const res = await createDraftInvoiceForOrder(admin, { ...args, drawsStock: true })
    expect(res).toEqual({ status: 'drafted', reason: 'ok', invoiceId: 'quote-xero-2', invoiceNumber: 'QU-0002' })
    expect(updates).toContainEqual({ table: 'orders', payload: { xero_invoice_id: 'quote-xero-2', xero_invoice_number: 'QU-0002', xero_invoice_status: 'drafted' } })
    expect(updates).not.toContainEqual({ table: 'orders', payload: { xero_invoice_status: 'manual_review' } })
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
