// lib/xero/config.ts
//
// PAYLOAD-ONLY since 2026-08-17: authentication moved to the single standard
// OAuth app (lib/xero/token-store.ts, spec 2026-08-17-xero-oauth-multi-tenant).
// This module maps a region to the invoice-payload knobs and nothing else.

export interface XeroConfig {
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

/** Payload config for a region. Never throws — credentials live in the token
 *  store; "is Xero usable" is isXeroConnectedForRegion (token-store.ts). */
export function getXeroConfig(region: XeroRegion = 'NZ'): XeroConfig {
  if (region === 'AU') {
    return {
      salesAccountCode: process.env.XERO_AU_SALES_ACCOUNT_CODE ?? '200',
      taxType: process.env.XERO_AU_TAX_TYPE ?? 'OUTPUT',
      currency: process.env.XERO_AU_CURRENCY ?? 'AUD',
      lineAmountTypes: process.env.XERO_LINE_AMOUNT_TYPES ?? 'Exclusive',
      brandingThemeId: process.env.XERO_AU_BRANDING_THEME_ID || null,
    }
  }
  return {
    salesAccountCode: process.env.XERO_SALES_ACCOUNT_CODE ?? '200',
    taxType: process.env.XERO_TAX_TYPE ?? 'OUTPUT2',
    currency: process.env.XERO_CURRENCY ?? 'NZD',
    lineAmountTypes: process.env.XERO_LINE_AMOUNT_TYPES ?? 'Exclusive',
    brandingThemeId: process.env.XERO_BRANDING_THEME_ID || null,
  }
}
