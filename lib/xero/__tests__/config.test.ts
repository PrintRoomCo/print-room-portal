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
