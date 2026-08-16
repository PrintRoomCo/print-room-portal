// lib/xero/__tests__/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { isXeroEnabled, getXeroConfig, isXeroConfiguredForRegion } from '../config'

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
  it('is false for "0"/"false"/garbage', () => {
    for (const v of ['0', 'false', 'off', 'nope']) {
      process.env.XERO_ENABLED = v
      expect(isXeroEnabled()).toBe(false)
    }
  })
})

describe('getXeroConfig', () => {
  it('throws when client id/secret missing', () => {
    expect(() => getXeroConfig()).toThrow(/XERO_CLIENT_ID/)
  })
  it('applies defaults for optional vars', () => {
    process.env.XERO_CLIENT_ID = 'cid'
    process.env.XERO_CLIENT_SECRET = 'secret'
    const cfg = getXeroConfig()
    expect(cfg).toMatchObject({
      clientId: 'cid',
      clientSecret: 'secret',
      scopes: 'accounting.transactions accounting.contacts',
      tenantId: null,
      salesAccountCode: '200',
      taxType: 'OUTPUT2',
      currency: 'NZD',
      lineAmountTypes: 'Exclusive',
      brandingThemeId: null,
    })
  })
  it('reads overrides from env', () => {
    process.env.XERO_CLIENT_ID = 'cid'
    process.env.XERO_CLIENT_SECRET = 'secret'
    process.env.XERO_SALES_ACCOUNT_CODE = '260'
    process.env.XERO_TAX_TYPE = 'OUTPUT'
    process.env.XERO_LINE_AMOUNT_TYPES = 'Inclusive'
    process.env.XERO_TENANT_ID = 'tid'
    process.env.XERO_BRANDING_THEME_ID = 'bt-1'
    const cfg = getXeroConfig()
    expect(cfg).toMatchObject({
      salesAccountCode: '260', taxType: 'OUTPUT', lineAmountTypes: 'Inclusive',
      tenantId: 'tid', brandingThemeId: 'bt-1',
    })
  })
})

describe('getXeroConfig("AU") (AU Stage 1)', () => {
  it('maps the XERO_AU_* env surface with AU defaults', () => {
    process.env.XERO_AU_CLIENT_ID = 'au-id'
    process.env.XERO_AU_CLIENT_SECRET = 'au-secret'
    const cfg = getXeroConfig('AU')
    expect(cfg.clientId).toBe('au-id')
    expect(cfg.clientSecret).toBe('au-secret')
    expect(cfg.taxType).toBe('OUTPUT')       // AU 10% GST on Income
    expect(cfg.currency).toBe('AUD')
    expect(cfg.salesAccountCode).toBe('200') // default; env-overridable per HITL check
    expect(cfg.tenantId).toBeNull()          // custom connection = single-org token
  })
  it('reads AU overrides from env', () => {
    process.env.XERO_AU_CLIENT_ID = 'au-id'
    process.env.XERO_AU_CLIENT_SECRET = 'au-secret'
    process.env.XERO_AU_SALES_ACCOUNT_CODE = '210'
    process.env.XERO_AU_TAX_TYPE = 'OUTPUT2'
    process.env.XERO_AU_CURRENCY = 'NZD'
    process.env.XERO_AU_BRANDING_THEME_ID = 'au-bt'
    expect(getXeroConfig('AU')).toMatchObject({
      salesAccountCode: '210', taxType: 'OUTPUT2', currency: 'NZD', brandingThemeId: 'au-bt',
    })
  })
  it('throws when AU creds are absent', () => {
    expect(() => getXeroConfig('AU')).toThrow(/XERO_AU_CLIENT_ID/)
  })
  it('isXeroConfiguredForRegion mirrors cred presence per region', () => {
    expect(isXeroConfiguredForRegion('AU')).toBe(false)
    expect(isXeroConfiguredForRegion('NZ')).toBe(false)
    process.env.XERO_AU_CLIENT_ID = 'au-id'
    process.env.XERO_AU_CLIENT_SECRET = 'au-secret'
    expect(isXeroConfiguredForRegion('AU')).toBe(true)
    expect(isXeroConfiguredForRegion('NZ')).toBe(false) // AU creds never satisfy NZ
    process.env.XERO_CLIENT_ID = 'nz-id'
    process.env.XERO_CLIENT_SECRET = 'nz-secret'
    expect(isXeroConfiguredForRegion('NZ')).toBe(true)
  })
  it('getXeroConfig() with no arg is the NZ config (back-compat)', () => {
    process.env.XERO_CLIENT_ID = 'cid'
    process.env.XERO_CLIENT_SECRET = 'secret'
    process.env.XERO_AU_CLIENT_ID = 'au-id'
    process.env.XERO_AU_CLIENT_SECRET = 'au-secret'
    // No arg must resolve NZ even with AU creds present.
    expect(getXeroConfig()).toMatchObject({ clientId: 'cid', taxType: 'OUTPUT2', currency: 'NZD' })
  })
})
