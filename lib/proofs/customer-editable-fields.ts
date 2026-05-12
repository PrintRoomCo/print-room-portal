/**
 * Customer-editable ProofDocument fields. Allow-list consumed by:
 *   - components/proofs/ProofStagingForm.tsx (UI defence in depth)
 *   - lib/proofs/compute-amendment-diff.ts   (API security boundary)
 *
 * MUST stay in sync with the staff-portal copy at
 * `print-room-staff-portal/src/lib/proofs/customer-editable-fields.ts`.
 * The customer portal cannot import from the staff repo, so this is a
 * deliberate manual duplicate. When you add a field here, add it there
 * (and vice versa) in the same PR.
 *
 * Source of truth: spec §G + plan §E2 (2026-05-12-proof-creator-product-first).
 *
 * Path syntax:
 *   'design.name'                  - every design's `name` field
 *   'design.printAreas[].label'    - every printArea row's `label`
 *   'orderLines[].quantities'      - every orderLine's `quantities` object
 *   'notes'                        - top-level doc note
 */
export const CUSTOMER_EDITABLE_FIELDS = [
  'design.name',
  'design.subtitle',
  'design.colourName',
  'design.printAreas[].label',
  'design.printAreas[].widthMm',
  'design.printAreas[].heightMm',
  'orderLines[].quantities',
  'orderLines[].colour',
  'orderLines[].name',
  'notes',
] as const

export type CustomerEditableField = (typeof CUSTOMER_EDITABLE_FIELDS)[number]

export function isCustomerEditableField(field: string): field is CustomerEditableField {
  return (CUSTOMER_EDITABLE_FIELDS as readonly string[]).includes(field)
}
