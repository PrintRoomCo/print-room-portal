import { cache } from 'react'
import { getSupabaseServer } from '@/lib/supabase'

/**
 * Customer-editable ProofDocument fields. The allow-list is the single
 * source of truth for what a buyer can mutate from the "Edit proof" page.
 *
 * Consumed by:
 *   - components/proofs/ProofStagingForm.tsx (UI defence in depth — receives
 *     the list as a prop from its server parent page)
 *   - lib/proofs/compute-amendment-diff.ts   (API security boundary —
 *     receives the list as an explicit param from the route handler)
 *
 * Source of truth: `proof_editable_field_paths` table in Supabase
 * (project `bthsxgmcnbvwwgvdveek`). Both repos load from the same table —
 * no duplicate static lists.
 *
 * Path syntax:
 *   'design.name'                  - every design's `name` field
 *   'design.printAreas[].label'    - every printArea row's `label`
 *   'orderLines[].quantities'      - every orderLine's `quantities` object
 *   'notes'                        - top-level doc note
 */

// Loose runtime type — the list is dynamic and read from the DB. Treat as
// `string` everywhere; do not narrow.
export type CustomerEditableField = string

/**
 * Fetches the customer-editable field allow-list from the
 * proof_editable_field_paths table. Memoised per request via React cache.
 *
 * Throws on load failure — the enforcement layer 500s on it rather than
 * silently letting anything through.
 */
export const getCustomerEditableFields = cache(async (): Promise<string[]> => {
  const admin = getSupabaseServer()
  const { data, error } = await admin
    .from('proof_editable_field_paths')
    .select('paths')
    .single()
  if (error || !data) {
    throw new Error(
      `failed to load customer-editable allow-list: ${error?.message ?? 'no row'}`
    )
  }
  return data.paths as string[]
})

export async function isCustomerEditableField(field: string): Promise<boolean> {
  const fields = await getCustomerEditableFields()
  return fields.includes(field)
}
