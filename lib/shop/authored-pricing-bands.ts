import type { SupabaseClient } from '@supabase/supabase-js'

export interface AuthoredPricingBand {
  min_quantity: number
  max_quantity: number | null
}

export async function loadAuthoredPricingBands(
  admin: SupabaseClient,
  catalogueItemId: string,
  targetCurrency = 'NZD',
  countryPartitionEnabled = false,
): Promise<AuthoredPricingBand[]> {
  const { data } = await admin
    .from('b2b_catalogue_item_pricing_tiers')
    .select('min_quantity, max_quantity')
    .eq('catalogue_item_id', catalogueItemId)
    .eq('currency', countryPartitionEnabled ? targetCurrency : 'NZD')
    .order('min_quantity', { ascending: true })

  return (data ?? []).map((row) => ({
    min_quantity: Number(row.min_quantity),
    max_quantity:
      row.max_quantity == null ? null : Number(row.max_quantity),
  }))
}
