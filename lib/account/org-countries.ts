import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseServerComponent } from '@/lib/supabase-server-component'
import { getSupabaseServer } from '@/lib/supabase'

export interface EnabledCountry {
  code: string
  name: string
  isDefault: boolean
}

export interface BillingCountryConfig extends EnabledCountry {
  currency: string
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
      currency: c?.currency ?? '',
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
