import { beforeEach, describe, expect, it } from 'vitest'

import { buildDraftQuotePayload } from '../draft-invoice'
import { xeroConfigFromCountryRow } from '../config'

const PAYLOAD_OVERRIDE_ENV_KEYS = [
  'XERO_SALES_ACCOUNT_CODE',
  'XERO_TAX_TYPE',
  'XERO_CURRENCY',
  'XERO_BRANDING_THEME_ID',
  'XERO_AU_SALES_ACCOUNT_CODE',
  'XERO_AU_TAX_TYPE',
  'XERO_AU_CURRENCY',
  'XERO_AU_BRANDING_THEME_ID',
  'XERO_LINE_AMOUNT_TYPES',
] as const

const LEGACY_BODY = {
  NZ: JSON.stringify({
    Status: 'DRAFT',
    Contact: { ContactID: 'contact-nz' },
    LineAmountTypes: 'Exclusive',
    Reference: 'ORDER-NZ',
    Date: '2026-08-25',
    CurrencyCode: 'NZD',
    LineItems: [
      {
        Description: 'Tee — Black / M',
        Quantity: 10,
        UnitAmount: 12.5,
        AccountCode: '191',
        TaxType: 'OUTPUT2',
      },
      {
        Description: 'Picking fee',
        Quantity: 1,
        UnitAmount: 15,
        AccountCode: '191',
        TaxType: 'OUTPUT2',
      },
    ],
    ExpiryDate: '2026-09-14',
    Summary: 'Delivery address:\n1 Test Street\nNZ',
  }),
  AU: JSON.stringify({
    Status: 'DRAFT',
    Contact: { ContactID: 'contact-au' },
    LineAmountTypes: 'Exclusive',
    Reference: 'ORDER-AU',
    Date: '2026-08-25',
    CurrencyCode: 'AUD',
    LineItems: [
      {
        Description: 'Tee — Black / M',
        Quantity: 10,
        UnitAmount: 12.5,
        AccountCode: '200',
        TaxType: 'OUTPUT',
      },
    ],
    ExpiryDate: '2026-09-14',
    Summary: 'Delivery address:\n1 Test Street\nAU',
  }),
} as const

const COUNTRY_ROWS = {
  NZ: { code: 'NZ', currency: 'NZD', xero_sales_account: '191', xero_tax_type: 'OUTPUT2' },
  AU: { code: 'AU', currency: 'AUD', xero_sales_account: '200', xero_tax_type: 'OUTPUT' },
} as const

function goldenPayload(countryCode: keyof typeof COUNTRY_ROWS) {
  const config = xeroConfigFromCountryRow(COUNTRY_ROWS[countryCode])
  return buildDraftQuotePayload({
    contactId: `contact-${countryCode.toLowerCase()}`,
    orderRef: `ORDER-${countryCode}`,
    today: '2026-08-25',
    paymentTerms: 'net20',
    currency: config.currency,
    accountCode: config.salesAccountCode,
    taxType: config.taxType,
    lineAmountTypes: config.lineAmountTypes,
    brandingThemeId: config.brandingThemeId,
    deliveryAddressSummary: `1 Test Street\n${countryCode}`,
    lines: [
      { description: 'Tee — Black / M', quantity: 10, unitAmount: 12.5 },
      ...(countryCode === 'NZ'
        ? [{ description: 'Picking fee', quantity: 1, unitAmount: 15 }]
        : []),
    ],
  })
}

describe('country-row Xero payload config', () => {
  beforeEach(() => {
    for (const key of PAYLOAD_OVERRIDE_ENV_KEYS) delete process.env[key]
  })

  it('maps a third country without a code branch', () => {
    expect(xeroConfigFromCountryRow({
      code: 'GB',
      currency: 'GBP',
      xero_sales_account: '310',
      xero_tax_type: 'OUTPUT2',
    })).toMatchObject({
      currency: 'GBP',
      salesAccountCode: '310',
      taxType: 'OUTPUT2',
      lineAmountTypes: 'Exclusive',
    })
  })

  it.each(['NZ', 'AU'] as const)(
    'keeps the complete %s draft byte-identical to the pre-SP4 capture',
    (billCountry) => {
      expect(JSON.stringify(goldenPayload(billCountry))).toBe(LEGACY_BODY[billCountry])
    },
  )
})
