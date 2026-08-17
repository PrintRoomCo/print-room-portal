// lib/xero/__tests__/golden-payload.test.ts
//
// GOLDEN FIXTURES (spec §7): exact /Quotes payload bodies from the CURRENT
// code, captured before the OAuth auth swap. Byte-identical afterwards or the
// swap broke parity. Do not regenerate snapshots to make a failure pass.
// Creds env below satisfies TODAY's getXeroConfig; after the swap it is
// harmlessly ignored — the assertions touch payload fields only.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getXeroConfig } from '../config'
import { buildDraftQuotePayload, buildDraftLines, buildPickFeeLine } from '../draft-invoice'

const SAVED = { ...process.env }
beforeEach(() => {
  for (const k of Object.keys(process.env)) if (k.startsWith('XERO_')) delete process.env[k]
  process.env.XERO_CLIENT_ID = 'cid'
  process.env.XERO_CLIENT_SECRET = 'secret'
  process.env.XERO_AU_CLIENT_ID = 'au-cid'
  process.env.XERO_AU_CLIENT_SECRET = 'au-secret'
})
afterEach(() => { process.env = { ...SAVED } })

// Item rows COPIED from draft-invoice.buildlines.test.ts fixtures (same
// shapes): one made-to-order line, one stock-drawn line for prepaid zeroing.
const ROWS: Parameters<typeof buildDraftLines>[0] = [
  {
    product_name: 'Tee', quantity: 100, unit_price: 10, size_label: 'M',
    decorations: null, product_variants: null,
    product_id: 'p1', variant_id: 'v1', size_id: 1, qty_from_stock: 0,
  },
  {
    product_name: 'Hoodie', quantity: 40, unit_price: 55, size_label: 'L',
    decorations: null, product_variants: null,
    product_id: 'p2', variant_id: 'v2', size_id: 3, qty_from_stock: 40,
  },
]

describe('golden payloads — byte-identical across the auth swap', () => {
  it('NZ: cfg-driven payload, net20, delivery summary', () => {
    const cfg = getXeroConfig('NZ')
    const lines = buildDraftLines(ROWS, new Set())
    const payload = buildDraftQuotePayload({
      contactId: 'contact-nz-1', orderRef: 'REBG-000999', today: '2026-08-17',
      paymentTerms: 'net20', currency: cfg.currency, accountCode: cfg.salesAccountCode,
      taxType: cfg.taxType, lineAmountTypes: cfg.lineAmountTypes, brandingThemeId: cfg.brandingThemeId,
      deliveryAddressSummary: '1 Test St\nAuckland 1010\nNZ', lines,
    })
    expect(JSON.parse(JSON.stringify(payload))).toMatchInlineSnapshot(`
      {
        "Contact": {
          "ContactID": "contact-nz-1",
        },
        "CurrencyCode": "NZD",
        "Date": "2026-08-17",
        "ExpiryDate": "2026-09-06",
        "LineAmountTypes": "Exclusive",
        "LineItems": [
          {
            "AccountCode": "191",
            "Description": "Tee — M",
            "Quantity": 100,
            "TaxType": "OUTPUT2",
            "UnitAmount": 10,
          },
          {
            "AccountCode": "191",
            "Description": "Hoodie — L",
            "Quantity": 40,
            "TaxType": "OUTPUT2",
            "UnitAmount": 55,
          },
        ],
        "Reference": "REBG-000999",
        "Status": "DRAFT",
        "Summary": "Delivery address:
      1 Test St
      Auckland 1010
      NZ",
      }
    `)
  })

  it('NZ: prepaid-zeroed line + pick-fee line', () => {
    const cfg = getXeroConfig('NZ')
    // Same makeLineKey format the buildlines test uses: product::variant::size.
    const prepaidKeys = new Set(['p2::v2::3'])
    const lines = buildDraftLines(ROWS, prepaidKeys)
    lines.push(buildPickFeeLine(35))
    const payload = buildDraftQuotePayload({
      contactId: 'contact-nz-1', orderRef: 'REBG-000999', today: '2026-08-17',
      paymentTerms: null, currency: cfg.currency, accountCode: cfg.salesAccountCode,
      taxType: cfg.taxType, lineAmountTypes: cfg.lineAmountTypes, brandingThemeId: cfg.brandingThemeId,
      deliveryAddressSummary: null, lines,
    })
    expect(JSON.parse(JSON.stringify(payload))).toMatchInlineSnapshot(`
      {
        "Contact": {
          "ContactID": "contact-nz-1",
        },
        "CurrencyCode": "NZD",
        "Date": "2026-08-17",
        "LineAmountTypes": "Exclusive",
        "LineItems": [
          {
            "AccountCode": "191",
            "Description": "Tee — M",
            "Quantity": 100,
            "TaxType": "OUTPUT2",
            "UnitAmount": 10,
          },
          {
            "AccountCode": "191",
            "Description": "Hoodie — L (prepaid stock — drawn down, no charge)",
            "Quantity": 40,
            "TaxType": "OUTPUT2",
            "UnitAmount": 0,
          },
          {
            "AccountCode": "191",
            "Description": "Picking fee",
            "Quantity": 1,
            "TaxType": "OUTPUT2",
            "UnitAmount": 35,
          },
        ],
        "Reference": "REBG-000999",
        "Status": "DRAFT",
      }
    `)
  })

  it('AU: AUD + OUTPUT via getXeroConfig("AU") defaults', () => {
    const cfg = getXeroConfig('AU')
    const lines = buildDraftLines(ROWS, new Set())
    const payload = buildDraftQuotePayload({
      contactId: 'contact-au-1', orderRef: 'AUBG-000001', today: '2026-08-17',
      paymentTerms: 'net30', currency: cfg.currency, accountCode: cfg.salesAccountCode,
      taxType: cfg.taxType, lineAmountTypes: cfg.lineAmountTypes, brandingThemeId: cfg.brandingThemeId,
      deliveryAddressSummary: null, lines,
    })
    expect(JSON.parse(JSON.stringify(payload))).toMatchInlineSnapshot(`
      {
        "Contact": {
          "ContactID": "contact-au-1",
        },
        "CurrencyCode": "AUD",
        "Date": "2026-08-17",
        "ExpiryDate": "2026-09-16",
        "LineAmountTypes": "Exclusive",
        "LineItems": [
          {
            "AccountCode": "200",
            "Description": "Tee — M",
            "Quantity": 100,
            "TaxType": "OUTPUT",
            "UnitAmount": 10,
          },
          {
            "AccountCode": "200",
            "Description": "Hoodie — L",
            "Quantity": 40,
            "TaxType": "OUTPUT",
            "UnitAmount": 55,
          },
        ],
        "Reference": "AUBG-000001",
        "Status": "DRAFT",
      }
    `)
  })
})
