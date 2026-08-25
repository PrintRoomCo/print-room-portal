import { describe, expect, it } from 'vitest'

import {
  buildDraftQuotePayload,
  xeroRegionForBillCountry,
} from '../draft-invoice'
import { getXeroConfig, type XeroRegion } from '../config'

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
  it('adapts only exact NZ and AU stamps to the existing two-region seam', () => {
    expect(xeroRegionForBillCountry('NZ')).toBe('NZ')
    expect(xeroRegionForBillCountry('AU')).toBe('AU')
    expect(xeroRegionForBillCountry('nz')).toBeNull()
    expect(xeroRegionForBillCountry('GB')).toBeNull()
    expect(xeroRegionForBillCountry('')).toBeNull()
  })

  it.each(['NZ', 'AU'] as const)(
    'keeps the complete %s draft golden unchanged after country selection',
    (billCountry) => {
      const region = xeroRegionForBillCountry(billCountry)
      expect(region).not.toBeNull()
      expect(goldenPayload(region!)).toStrictEqual(goldenPayload(billCountry))
    },
  )
})
