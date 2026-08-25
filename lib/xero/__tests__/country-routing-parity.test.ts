import { beforeEach, describe, expect, it } from 'vitest'

import {
  buildDraftQuotePayload,
  xeroRegionForBillCountry,
} from '../draft-invoice'
import { getXeroConfig, type XeroRegion } from '../config'

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

function goldenPayload(region: XeroRegion) {
  const config = getXeroConfig(region)
  return buildDraftQuotePayload({
    contactId: `contact-${region.toLowerCase()}`,
    orderRef: `ORDER-${region}`,
    today: '2026-08-25',
    paymentTerms: 'net20',
    currency: config.currency,
    accountCode: config.salesAccountCode,
    taxType: config.taxType,
    lineAmountTypes: config.lineAmountTypes,
    brandingThemeId: config.brandingThemeId,
    deliveryAddressSummary: `1 Test Street\n${region}`,
    lines: [
      { description: 'Tee — Black / M', quantity: 10, unitAmount: 12.5 },
      ...(region === 'NZ'
        ? [{ description: 'Picking fee', quantity: 1, unitAmount: 15 }]
        : []),
    ],
  })
}

describe('xeroRegionForBillCountry', () => {
  beforeEach(() => {
    for (const key of PAYLOAD_OVERRIDE_ENV_KEYS) delete process.env[key]
  })

  it('adapts only exact NZ and AU stamps to the existing two-region seam', () => {
    expect(xeroRegionForBillCountry('NZ')).toBe('NZ')
    expect(xeroRegionForBillCountry('AU')).toBe('AU')
    expect(xeroRegionForBillCountry('nz')).toBeNull()
    expect(xeroRegionForBillCountry('GB')).toBeNull()
    expect(xeroRegionForBillCountry('')).toBeNull()
  })

  it.each(['NZ', 'AU'] as const)(
    'keeps the complete %s draft byte-identical to the pre-SP4 capture',
    (billCountry) => {
      const region = xeroRegionForBillCountry(billCountry)
      expect(region).not.toBeNull()
      expect(JSON.stringify(goldenPayload(region!))).toBe(LEGACY_BODY[billCountry])
    },
  )
})
