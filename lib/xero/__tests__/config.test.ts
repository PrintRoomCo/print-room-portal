// lib/xero/__tests__/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { isXeroEnabled, getXeroConfig } from '../config'

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

describe('getXeroConfig — payload-only (auth moved to token-store)', () => {
  it('needs NO credentials and applies NZ defaults', () => {
    expect(getXeroConfig()).toEqual({
      salesAccountCode: '200',
      taxType: 'OUTPUT2',
      currency: 'NZD',
      lineAmountTypes: 'Exclusive',
      brandingThemeId: null,
    })
  })
  it('reads NZ overrides from env', () => {
    process.env.XERO_SALES_ACCOUNT_CODE = '260'
    process.env.XERO_TAX_TYPE = 'OUTPUT'
    process.env.XERO_LINE_AMOUNT_TYPES = 'Inclusive'
    process.env.XERO_BRANDING_THEME_ID = 'bt-1'
    expect(getXeroConfig('NZ')).toEqual({
      salesAccountCode: '260', taxType: 'OUTPUT', currency: 'NZD',
      lineAmountTypes: 'Inclusive', brandingThemeId: 'bt-1',
    })
  })
  it('AU defaults: AUD + OUTPUT, no credentials involved', () => {
    expect(getXeroConfig('AU')).toEqual({
      salesAccountCode: '200', taxType: 'OUTPUT', currency: 'AUD',
      lineAmountTypes: 'Exclusive', brandingThemeId: null,
    })
  })
  it('AU overrides from the XERO_AU_* payload surface', () => {
    process.env.XERO_AU_SALES_ACCOUNT_CODE = '210'
    process.env.XERO_AU_BRANDING_THEME_ID = 'au-bt'
    expect(getXeroConfig('AU')).toMatchObject({ salesAccountCode: '210', brandingThemeId: 'au-bt' })
  })
  it('carries no credential fields at all', () => {
    // `as unknown as` — XeroConfig has no index signature, so a direct cast is
    // a tsc error (TS2352). The assertions below are the point of the test.
    const cfg = getXeroConfig() as unknown as Record<string, unknown>
    expect(cfg).not.toHaveProperty('clientId')
    expect(cfg).not.toHaveProperty('clientSecret')
    expect(cfg).not.toHaveProperty('scopes')
    expect(cfg).not.toHaveProperty('tenantId')
  })
})
