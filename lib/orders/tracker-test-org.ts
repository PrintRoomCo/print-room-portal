/**
 * Resolve whether a job tracker belongs to a test/demo organization
 * (`organizations.is_test`). Used to suppress milestone emails for test orgs,
 * which have live items on the Monday board. Linkage: tracker → quote →
 * organization (the tracker row itself stores no organization_id).
 *
 * Fail-open toward SENDING: any missing link or query error returns false, so a
 * real customer is never silently starved of their milestone email because of a
 * lookup blip.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export async function isTrackerTestOrg(
  admin: SupabaseClient,
  quoteId: string | null | undefined
): Promise<boolean> {
  if (!quoteId) return false

  const { data: quote } = await admin
    .from('quotes')
    .select('organization_id')
    .eq('id', quoteId)
    .maybeSingle()

  const orgId = (quote as { organization_id?: string | null } | null)?.organization_id
  if (!orgId) return false

  const { data: org } = await admin
    .from('organizations')
    .select('is_test')
    .eq('id', orgId)
    .maybeSingle()

  return Boolean((org as { is_test?: boolean | null } | null)?.is_test)
}
