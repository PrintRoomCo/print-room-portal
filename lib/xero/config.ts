// lib/xero/config.ts

export interface XeroConfig {
  clientId: string
  clientSecret: string
  scopes: string
  tenantId: string | null
  salesAccountCode: string
  taxType: string
  currency: string
  lineAmountTypes: string
  brandingThemeId: string | null
}

/** Deploy-dark rollout flag. Truthy = attempt Xero drafts. */
export function isXeroEnabled(): boolean {
  const v = (process.env.XERO_ENABLED ?? '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'on' || v === 'yes'
}

export type XeroRegion = 'NZ' | 'AU'

/** True when the region's credentials exist (getXeroConfig would not throw). */
export function isXeroConfiguredForRegion(region: XeroRegion): boolean {
  if (region === 'AU') return Boolean(process.env.XERO_AU_CLIENT_ID && process.env.XERO_AU_CLIENT_SECRET)
  return Boolean(process.env.XERO_CLIENT_ID && process.env.XERO_CLIENT_SECRET)
}

/** Read + validate Xero config from the environment. Throws if creds are absent.
 *  Each region is a separate Xero CUSTOM CONNECTION (client_credentials is bound
 *  to exactly one Xero organisation): NZ = the original app, AU = "The Print Room
 *  Australia" via the XERO_AU_* surface. */
export function getXeroConfig(region: XeroRegion = 'NZ'): XeroConfig {
  if (region === 'AU') {
    const clientId = process.env.XERO_AU_CLIENT_ID ?? ''
    const clientSecret = process.env.XERO_AU_CLIENT_SECRET ?? ''
    if (!clientId || !clientSecret) {
      throw new Error('XERO_AU_CLIENT_ID / XERO_AU_CLIENT_SECRET are not configured')
    }
    return {
      clientId,
      clientSecret,
      scopes: process.env.XERO_SCOPES ?? 'accounting.transactions accounting.contacts',
      tenantId: null,
      salesAccountCode: process.env.XERO_AU_SALES_ACCOUNT_CODE ?? '200',
      taxType: process.env.XERO_AU_TAX_TYPE ?? 'OUTPUT',
      currency: process.env.XERO_AU_CURRENCY ?? 'AUD',
      lineAmountTypes: process.env.XERO_LINE_AMOUNT_TYPES ?? 'Exclusive',
      brandingThemeId: process.env.XERO_AU_BRANDING_THEME_ID || null,
    }
  }
  // NZ branch: byte-identical to the pre-AU function body.
  const clientId = process.env.XERO_CLIENT_ID ?? ''
  const clientSecret = process.env.XERO_CLIENT_SECRET ?? ''
  if (!clientId || !clientSecret) {
    throw new Error('XERO_CLIENT_ID / XERO_CLIENT_SECRET are not configured')
  }
  return {
    clientId,
    clientSecret,
    scopes: process.env.XERO_SCOPES ?? 'accounting.transactions accounting.contacts',
    tenantId: process.env.XERO_TENANT_ID || null,
    salesAccountCode: process.env.XERO_SALES_ACCOUNT_CODE ?? '200',
    taxType: process.env.XERO_TAX_TYPE ?? 'OUTPUT2',
    currency: process.env.XERO_CURRENCY ?? 'NZD',
    lineAmountTypes: process.env.XERO_LINE_AMOUNT_TYPES ?? 'Exclusive',
    brandingThemeId: process.env.XERO_BRANDING_THEME_ID || null,
  }
}
