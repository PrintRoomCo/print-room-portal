// lib/xero/__tests__/build-payload.test.ts
import { describe, it, expect } from 'vitest'
import {
  buildDraftInvoicePayload,
  buildLineFromQuoteItem,
  expiryDateFor,
  type BuildPayloadArgs,
  type QuoteItemForXero,
} from '../draft-invoice'

const baseArgs: BuildPayloadArgs = {
  contactId: 'contact-1',
  orderRef: 'ORD-2026-0042',
  today: '2026-07-02',
  paymentTerms: 'net20',
  currency: 'NZD',
  accountCode: '200',
  taxType: 'OUTPUT2',
  lineAmountTypes: 'Exclusive',
  brandingThemeId: null,
  deliveryAddressSummary: 'Sam Buyer\n12 Queen St\nAuckland 1010\nNZ',
  lines: [
    { description: 'Basic Tee — Black / M (Logo Front)', quantity: 10, unitAmount: 12.5 },
    { description: 'Cap — OS', quantity: 20, unitAmount: 8 },
  ],
}

describe('expiryDateFor', () => {
  it('adds 20 days for net20', () => expect(expiryDateFor('net20', '2026-07-02')).toBe('2026-07-22'))
  it('adds 30 days for net30 (crossing a month)', () => expect(expiryDateFor('net30', '2026-07-02')).toBe('2026-08-01'))
  it('sets 20th-of-month terms to the 20th of the following month', () => {
    expect(expiryDateFor('20th of month', '2026-08-18')).toBe('2026-09-20')
    expect(expiryDateFor('20th of month', '2026-12-02')).toBe('2027-01-20')
  })
  it('returns undefined for prepay/null/unknown', () => {
    expect(expiryDateFor('prepay', '2026-07-02')).toBeUndefined()
    expect(expiryDateFor(null, '2026-07-02')).toBeUndefined()
    expect(expiryDateFor('weird', '2026-07-02')).toBeUndefined()
  })
})

describe('buildDraftInvoicePayload', () => {
  it('builds a DRAFT quote with GST-exclusive lines', () => {
    const p = buildDraftInvoicePayload(baseArgs)
    expect(p.Status).toBe('DRAFT')
    expect(p.Contact).toEqual({ ContactID: 'contact-1' })
    expect(p.LineAmountTypes).toBe('Exclusive')
    expect(p.Reference).toBe('ORD-2026-0042')
    expect(p.Date).toBe('2026-07-02')
    expect(p.ExpiryDate).toBe('2026-07-22')
    expect(p.CurrencyCode).toBe('NZD')
    expect(p.Summary).toBe('Delivery address:\nSam Buyer\n12 Queen St\nAuckland 1010\nNZ')
    expect(p.LineItems).toEqual([
      { Description: 'Basic Tee — Black / M (Logo Front)', Quantity: 10, UnitAmount: 12.5, AccountCode: '200', TaxType: 'OUTPUT2' },
      { Description: 'Cap — OS', Quantity: 20, UnitAmount: 8, AccountCode: '200', TaxType: 'OUTPUT2' },
    ])
  })

  it('omits ExpiryDate when payment terms give none, and omits branding when unset', () => {
    const p = buildDraftInvoicePayload({ ...baseArgs, paymentTerms: null })
    expect('ExpiryDate' in p).toBe(false)
    expect('BrandingThemeID' in p).toBe(false)
  })

  it('includes BrandingThemeID when set', () => {
    const p = buildDraftInvoicePayload({ ...baseArgs, brandingThemeId: 'bt-9' })
    expect(p.BrandingThemeID).toBe('bt-9')
  })

  it('adds the orderer as the quote contact name without replacing the organization contact', () => {
    const p = buildDraftInvoicePayload({ ...baseArgs, contactName: 'Nipun Kalra' })
    expect(p.Contact).toEqual({ ContactID: 'contact-1', ContactName: 'Nipun Kalra' })
  })
})

describe('buildLineFromQuoteItem', () => {
  const row: QuoteItemForXero = {
    product_name: 'Basic Tee',
    quantity: 10,
    unit_price: 12.5,
    size_label: 'M',
    decorations: [{ name: 'Logo Front' }],
    product_variants: { product_color_swatches: { label: 'Black' } },
  }

  it('composes product + variant + design description', () => {
    expect(buildLineFromQuoteItem(row)).toEqual({
      description: 'Basic Tee — Black / M (Logo Front)',
      quantity: 10,
      unitAmount: 12.5,
    })
  })

  it('handles array-shaped swatch embeds and missing decoration', () => {
    const r: QuoteItemForXero = {
      ...row,
      decorations: null,
      product_variants: { product_color_swatches: [{ label: 'Navy' }] },
    }
    expect(buildLineFromQuoteItem(r)).toEqual({
      description: 'Basic Tee — Navy / M',
      quantity: 10,
      unitAmount: 12.5,
    })
  })

  it('degrades to product name only when no variant/decoration', () => {
    const r: QuoteItemForXero = {
      product_name: 'Sticker Pack', quantity: 5, unit_price: 3,
      size_label: null, decorations: [], product_variants: null,
    }
    expect(buildLineFromQuoteItem(r)).toEqual({ description: 'Sticker Pack', quantity: 5, unitAmount: 3 })
  })
})
