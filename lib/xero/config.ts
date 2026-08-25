// lib/xero/config.ts
//
// PAYLOAD-ONLY since 2026-08-17: authentication moved to the single standard
// OAuth app (lib/xero/token-store.ts, spec 2026-08-17-xero-oauth-multi-tenant).
// This module maps a country row to invoice-payload knobs and nothing else.

import type { SupabaseClient } from '@supabase/supabase-js'

export interface XeroConfig {
  salesAccountCode: string
  taxType: string
  currency: string
  lineAmountTypes: string
  brandingThemeId: string | null
}

export interface XeroCountryRow {
  code: string
  currency: string
  xero_sales_account: string
  xero_tax_type: string
}

/** Deploy-dark rollout flag. Truthy = attempt Xero drafts. */
export function isXeroEnabled(): boolean {
  const v = (process.env.XERO_ENABLED ?? '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'on' || v === 'yes'
}

/** Map required country data to the exact Xero quote-payload knobs. */
export function xeroConfigFromCountryRow(row: XeroCountryRow): XeroConfig {
  const brandingThemeId = row.code === 'AU'
    ? process.env.XERO_AU_BRANDING_THEME_ID || null
    : row.code === 'NZ'
      ? process.env.XERO_BRANDING_THEME_ID || null
      : process.env[`XERO_${row.code}_BRANDING_THEME_ID`] || null
  return {
    salesAccountCode: row.xero_sales_account,
    taxType: row.xero_tax_type,
    currency: row.currency,
    lineAmountTypes: process.env.XERO_LINE_AMOUNT_TYPES ?? 'Exclusive',
    brandingThemeId,
  }
}

/** Payload config for an exact billing-country stamp. Credentials and tenant
 * assignment remain in the token store; a missing row is unsupported. */
export async function getXeroConfig(
  admin: SupabaseClient,
  countryCode: string,
): Promise<XeroConfig | null> {
  const { data, error } = await admin
    .from('countries')
    .select('code, currency, xero_sales_account, xero_tax_type')
    .eq('code', countryCode)
    .maybeSingle()
  if (error) throw new Error(`countries Xero config read failed: ${error.message}`)
  return data ? xeroConfigFromCountryRow(data as XeroCountryRow) : null
}
