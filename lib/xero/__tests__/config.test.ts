// lib/xero/__tests__/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { isXeroEnabled, xeroConfigFromCountryRow } from '../config'

const COUNTRY_ROWS = {
  NZ: { code: 'NZ', currency: 'NZD', xero_sales_account: '191', xero_tax_type: 'OUTPUT2' },
  AU: { code: 'AU', currency: 'AUD', xero_sales_account: '200', xero_tax_type: 'OUTPUT' },
} as const

const SAVED = { ...process.env }
beforeEach(() => {
  for (const k of Object.keys(process.env)) if (k.startsWith('XERO_')) delete process.env[k]
})
afterEach(() => {
  process.env = { ...SAVED }
})

describe('isXeroEnabled', () => {
  it('is false when XERO_ENABLED is unset', () => {
    expect(isXeroEnabled()).toBe(false)
  })
  it.each(['1', 'true', 'TRUE', 'on', 'yes'])('is true for %s', (v) => {
    process.env.XERO_ENABLED = v
    expect(isXeroEnabled()).toBe(true)
  })
})

describe('xeroConfigFromCountryRow — payload-only', () => {
  it('needs no credentials and maps the NZ row exactly', () => {
    expect(xeroConfigFromCountryRow(COUNTRY_ROWS.NZ)).toEqual({
      salesAccountCode: '191',
      taxType: 'OUTPUT2',
      currency: 'NZD',
      lineAmountTypes: 'Exclusive',
      brandingThemeId: null,
    })
  })
  it('retires account/tax/currency env overrides but keeps line type and branding', () => {
    process.env.XERO_SALES_ACCOUNT_CODE = '260'
    process.env.XERO_TAX_TYPE = 'OUTPUT'
    process.env.XERO_CURRENCY = 'USD'
    process.env.XERO_LINE_AMOUNT_TYPES = 'Inclusive'
    process.env.XERO_BRANDING_THEME_ID = 'bt-1'
    expect(xeroConfigFromCountryRow(COUNTRY_ROWS.NZ)).toEqual({
      salesAccountCode: '191', taxType: 'OUTPUT2', currency: 'NZD',
      lineAmountTypes: 'Inclusive', brandingThemeId: 'bt-1',
    })
  })
  it('maps AU row data without credentials', () => {
    expect(xeroConfigFromCountryRow(COUNTRY_ROWS.AU)).toEqual({
      salesAccountCode: '200', taxType: 'OUTPUT', currency: 'AUD',
      lineAmountTypes: 'Exclusive', brandingThemeId: null,
    })
  })
  it('keeps only the AU branding override', () => {
    process.env.XERO_AU_SALES_ACCOUNT_CODE = '210'
    process.env.XERO_AU_BRANDING_THEME_ID = 'au-bt'
    expect(xeroConfigFromCountryRow(COUNTRY_ROWS.AU)).toMatchObject({
      salesAccountCode: '200',
      brandingThemeId: 'au-bt',
    })
  })
  it('supports an optional country-specific branding theme for a third country', () => {
    process.env.XERO_GB_BRANDING_THEME_ID = 'gb-bt'
    expect(xeroConfigFromCountryRow({
      code: 'GB', currency: 'GBP', xero_sales_account: '310', xero_tax_type: 'OUTPUT2',
    })).toMatchObject({ currency: 'GBP', salesAccountCode: '310', brandingThemeId: 'gb-bt' })
  })
  it('carries no credential fields at all', () => {
    // `as unknown as` — XeroConfig has no index signature, so a direct cast is
    // a tsc error (TS2352). The assertions below are the point of the test.
    const cfg = xeroConfigFromCountryRow(COUNTRY_ROWS.NZ) as unknown as Record<string, unknown>
    expect(cfg).not.toHaveProperty('clientId')
    expect(cfg).not.toHaveProperty('clientSecret')
    expect(cfg).not.toHaveProperty('scopes')
    expect(cfg).not.toHaveProperty('tenantId')
  })
})
