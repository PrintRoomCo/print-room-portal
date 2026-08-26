import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseServerComponent } from '@/lib/supabase-server-component'
import { getSupabaseServer } from '@/lib/supabase'
import type { SupportedCurrency } from '@/lib/currency/types'

export interface EnabledCountry {
  code: string
  name: string
  isDefault: boolean
}

export interface BillingCountryConfig extends EnabledCountry {
  currency: SupportedCurrency
  taxRate: number
  taxLabel: string
}

export function sortEnabledCountries<T extends EnabledCountry>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
    return a.code.localeCompare(b.code)
  })
}

export async function getOrgEnabledCountries(
  admin: SupabaseClient,
  organizationId: string,
): Promise<BillingCountryConfig[]> {
  const { data } = await admin
    .from('organization_countries')
    .select('country_code, is_default, countries!inner(name, currency, tax_rate, tax_label)')
    .eq('organization_id', organizationId)
    .eq('countries.is_active', true)
  const rows = (data ?? []).map((r) => {
    const raw = (r as { countries?: unknown }).countries
    const c = (Array.isArray(raw) ? raw[0] : raw) as {
      name?: string
      currency?: string
      tax_rate?: number | string
      tax_label?: string
    } | null
    return {
      code: r.country_code as string,
      name: c?.name ?? (r.country_code as string),
      currency: (c?.currency ?? '') as SupportedCurrency,
      taxRate: Number(c?.tax_rate),
      taxLabel: c?.tax_label ?? '',
      isDefault: Boolean(r.is_default),
    }
  })
  return sortEnabledCountries(rows)
}

export async function getOrgDefaultBillingCountry(
  admin: SupabaseClient,
  organizationId: string,
): Promise<BillingCountryConfig> {
  const countries = await getOrgEnabledCountries(admin, organizationId)
  const defaultCountry = countries.find((country) => country.isDefault)
  if (!defaultCountry) {
    throw new Error(`Organization ${organizationId} has no enabled default billing country`)
  }
  return defaultCountry
}

export async function getPlatformBillingCountry(
  admin: SupabaseClient,
  code: string,
): Promise<BillingCountryConfig> {
  const { data, error } = await admin
    .from('countries')
    .select('code, name, currency, tax_rate, tax_label')
    .eq('code', code)
    .maybeSingle()
  if (error) throw new Error(`Country ${code} billing config could not be loaded: ${error.message}`)
  if (!data) throw new Error(`Country ${code} billing config does not exist`)
  return {
    code: data.code as string,
    name: data.name as string,
    currency: data.currency as SupportedCurrency,
    taxRate: Number(data.tax_rate),
    taxLabel: data.tax_label as string,
    isDefault: true,
  }
}

/**
 * Deliberately uncached: a staff-side country enablement must show up on the
 * next page load, so this must not go inside the unstable_cache scope in
 * lib/portal-data.ts.
 */
export async function getEnabledCountriesForCurrentOrg(): Promise<BillingCountryConfig[]> {
  const supabase = await getSupabaseServerComponent()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []
  const admin = getSupabaseServer()
  const { data: membership } = await admin
    .from('user_organizations')
    .select('organization_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) return []
  return getOrgEnabledCountries(admin, membership.organization_id)
}
