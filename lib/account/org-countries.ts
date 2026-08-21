import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseServerComponent } from '@/lib/supabase-server-component'
import { getSupabaseServer } from '@/lib/supabase'

export interface EnabledCountry {
  code: string
  name: string
  isDefault: boolean
}

export function sortEnabledCountries(rows: EnabledCountry[]): EnabledCountry[] {
  return [...rows].sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

export async function getOrgEnabledCountries(
  admin: SupabaseClient,
  organizationId: string,
): Promise<EnabledCountry[]> {
  const { data } = await admin
    .from('organization_countries')
    .select('country_code, is_default, countries(name)')
    .eq('organization_id', organizationId)
  const rows = (data ?? []).map((r) => {
    const raw = (r as { countries?: unknown }).countries
    const c = (Array.isArray(raw) ? raw[0] : raw) as { name?: string } | null
    return {
      code: r.country_code as string,
      name: c?.name ?? (r.country_code as string),
      isDefault: Boolean(r.is_default),
    }
  })
  return sortEnabledCountries(rows)
}

/**
 * Deliberately uncached: a staff-side country enablement must show up on the
 * next page load, so this must not go inside the unstable_cache scope in
 * lib/portal-data.ts.
 */
export async function getEnabledCountriesForCurrentOrg(): Promise<EnabledCountry[]> {
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
