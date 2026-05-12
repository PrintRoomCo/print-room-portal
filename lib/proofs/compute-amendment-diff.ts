import type { ProofDesign, ProofDocument, ProofOrderLine, ProofPrintArea } from './types'
import { CUSTOMER_EDITABLE_FIELDS, isCustomerEditableField } from './customer-editable-fields'

/**
 * One leaf change between original and staged snapshots.
 *
 * `path` is the canonical allow-list-style path string. The wildcard form
 * (`design.name`, `orderLines[].quantities`) is what gets validated against
 * CUSTOMER_EDITABLE_FIELDS — array indices and object keys aren't part of the
 * gate, only the structural location.
 *
 * `instancePath` is the human-readable concrete path for the diff viewer
 * (e.g. `designs[0].name`, `orderLines[2].quantities.SML/10`).
 */
export interface AmendmentDiffEntry {
  path: string
  instancePath: string
  before: unknown
  after: unknown
}

export interface ComputeDiffSuccess {
  ok: true
  diff: AmendmentDiffEntry[]
}

export interface ComputeDiffForbidden {
  ok: false
  reason: 'field_not_editable'
  field: string
  instancePath: string
}

export type ComputeDiffResult = ComputeDiffSuccess | ComputeDiffForbidden

/**
 * Pure server-side function — never call from client code, the security
 * boundary is the API route consuming this. Compares `original` (the
 * snapshot just re-fetched from `design_proof_versions.snapshot_data`)
 * against `staged` (the customer's edited document) and returns either:
 *   - { ok: true,  diff: [...] }  — every change is on the allow-list
 *   - { ok: false, reason: 'field_not_editable', field, instancePath } —
 *     the FIRST violation; the API rejects the entire request with 400
 *     and does not try to filter.
 *
 * The diff is sparse: paths whose values are deep-equal between original
 * and staged are omitted. An empty diff is a valid (no-op) request and
 * still returns `{ ok: true, diff: [] }` — the API route decides whether
 * to reject zero-change submissions; this function stays pure.
 */
export function computeAmendmentDiff(
  original: ProofDocument,
  staged: ProofDocument
): ComputeDiffResult {
  const diff: AmendmentDiffEntry[] = []

  // -- top-level scalar fields (only `notes` is on the allow-list, but we
  //    walk every top-level scalar to detect violations).
  const topLevelStrings: Array<keyof ProofDocument> = [
    'customerName',
    'customerEmail',
    'jobName',
    'jobReference',
    'preparedByName',
    'preparedByEmail',
    'preparedByPhone',
    'website',
    'deliveryDateLabel',
    'terms',
    'approvalCopy',
    'warning',
    'notes',
  ]
  for (const key of topLevelStrings) {
    const before = original[key]
    const after = staged[key]
    if (before === after) continue
    const path = key as string
    if (!isCustomerEditableField(path)) {
      return { ok: false, reason: 'field_not_editable', field: path, instancePath: path }
    }
    diff.push({ path, instancePath: path, before, after })
  }

  // -- designs[] — structural changes (add/remove) are never allow-listed;
  //    reject as a violation if lengths differ. Field-level diffs are walked
  //    per-design, per-printArea.
  if (original.designs.length !== staged.designs.length) {
    return {
      ok: false,
      reason: 'field_not_editable',
      field: 'designs[]',
      instancePath: `designs.length (${original.designs.length} -> ${staged.designs.length})`,
    }
  }
  for (let i = 0; i < original.designs.length; i++) {
    const violation = diffDesign(original.designs[i]!, staged.designs[i]!, i, diff)
    if (violation) return violation
  }

  // -- orderLines[] — structural changes also disallowed.
  if (original.orderLines.length !== staged.orderLines.length) {
    return {
      ok: false,
      reason: 'field_not_editable',
      field: 'orderLines[]',
      instancePath: `orderLines.length (${original.orderLines.length} -> ${staged.orderLines.length})`,
    }
  }
  for (let i = 0; i < original.orderLines.length; i++) {
    const violation = diffOrderLine(original.orderLines[i]!, staged.orderLines[i]!, i, diff)
    if (violation) return violation
  }

  return { ok: true, diff }
}

function diffDesign(
  before: ProofDesign,
  after: ProofDesign,
  index: number,
  acc: AmendmentDiffEntry[]
): ComputeDiffForbidden | null {
  const designScalars: Array<{ key: keyof ProofDesign; path: string }> = [
    { key: 'name', path: 'design.name' },
    { key: 'subtitle', path: 'design.subtitle' },
    { key: 'garmentLabel', path: 'design.garmentLabel' },
    { key: 'colourName', path: 'design.colourName' },
    { key: 'frontMockupUrl', path: 'design.frontMockupUrl' },
    { key: 'backMockupUrl', path: 'design.backMockupUrl' },
    { key: 'artworkUrl', path: 'design.artworkUrl' },
    { key: 'artworkBackground', path: 'design.artworkBackground' },
    { key: 'artworkNotes', path: 'design.artworkNotes' },
    { key: 'printHeightsNote', path: 'design.printHeightsNote' },
    { key: 'productionNote', path: 'design.productionNote' },
  ]
  for (const { key, path } of designScalars) {
    const b = before[key]
    const a = after[key]
    if (b === a) continue
    if (!isCustomerEditableField(path)) {
      return {
        ok: false,
        reason: 'field_not_editable',
        field: path,
        instancePath: `designs[${index}].${String(key)}`,
      }
    }
    acc.push({ path, instancePath: `designs[${index}].${String(key)}`, before: b, after: a })
  }

  if (before.printAreas.length !== after.printAreas.length) {
    return {
      ok: false,
      reason: 'field_not_editable',
      field: 'design.printAreas[]',
      instancePath: `designs[${index}].printAreas.length (${before.printAreas.length} -> ${after.printAreas.length})`,
    }
  }
  for (let j = 0; j < before.printAreas.length; j++) {
    const v = diffPrintArea(before.printAreas[j]!, after.printAreas[j]!, index, j, acc)
    if (v) return v
  }
  return null
}

function diffPrintArea(
  before: ProofPrintArea,
  after: ProofPrintArea,
  designIndex: number,
  areaIndex: number,
  acc: AmendmentDiffEntry[]
): ComputeDiffForbidden | null {
  const scalars: Array<{ key: keyof ProofPrintArea; path: string }> = [
    { key: 'label', path: 'design.printAreas[].label' },
    { key: 'method', path: 'design.printAreas[].method' },
    { key: 'widthMm', path: 'design.printAreas[].widthMm' },
    { key: 'heightMm', path: 'design.printAreas[].heightMm' },
    { key: 'pantone', path: 'design.printAreas[].pantone' },
    { key: 'pantoneHex', path: 'design.printAreas[].pantoneHex' },
    { key: 'artworkStatus', path: 'design.printAreas[].artworkStatus' },
    { key: 'productionNote', path: 'design.printAreas[].productionNote' },
  ]
  for (const { key, path } of scalars) {
    const b = before[key]
    const a = after[key]
    if (b === a) continue
    if (!isCustomerEditableField(path)) {
      return {
        ok: false,
        reason: 'field_not_editable',
        field: path,
        instancePath: `designs[${designIndex}].printAreas[${areaIndex}].${String(key)}`,
      }
    }
    acc.push({
      path,
      instancePath: `designs[${designIndex}].printAreas[${areaIndex}].${String(key)}`,
      before: b,
      after: a,
    })
  }
  return null
}

function diffOrderLine(
  before: ProofOrderLine,
  after: ProofOrderLine,
  index: number,
  acc: AmendmentDiffEntry[]
): ComputeDiffForbidden | null {
  const scalars: Array<{ key: keyof ProofOrderLine; path: string }> = [
    { key: 'name', path: 'orderLines[].name' },
    { key: 'isStaff', path: 'orderLines[].isStaff' },
    { key: 'brand', path: 'orderLines[].brand' },
    { key: 'garment', path: 'orderLines[].garment' },
    { key: 'sku', path: 'orderLines[].sku' },
    { key: 'colour', path: 'orderLines[].colour' },
    // designIndex intentionally not diff-walked as a scalar; structural
    // re-binding of an order line to a different design is not customer-
    // editable. If we ever want to allow it, add 'orderLines[].designIndex'
    // to the allow-list AND a row here.
  ]
  for (const { key, path } of scalars) {
    const b = before[key]
    const a = after[key]
    if (b === a) continue
    if (!isCustomerEditableField(path)) {
      return {
        ok: false,
        reason: 'field_not_editable',
        field: path,
        instancePath: `orderLines[${index}].${String(key)}`,
      }
    }
    acc.push({
      path,
      instancePath: `orderLines[${index}].${String(key)}`,
      before: b,
      after: a,
    })
  }

  // Catch any designIndex shift explicitly — it's not on the allow-list and
  // would silently re-parent a line if we didn't.
  if (before.designIndex !== after.designIndex) {
    return {
      ok: false,
      reason: 'field_not_editable',
      field: 'orderLines[].designIndex',
      instancePath: `orderLines[${index}].designIndex`,
    }
  }

  // quantities is an object — diff each size column. The allow-list path
  // is `orderLines[].quantities` (whole-object scoped); per-size diffs roll
  // up under it.
  const QUANTITIES_PATH = 'orderLines[].quantities'
  const sizeKeys = new Set([...Object.keys(before.quantities), ...Object.keys(after.quantities)])
  for (const size of sizeKeys) {
    const b = before.quantities[size] ?? ''
    const a = after.quantities[size] ?? ''
    if (b === a) continue
    if (!isCustomerEditableField(QUANTITIES_PATH)) {
      return {
        ok: false,
        reason: 'field_not_editable',
        field: QUANTITIES_PATH,
        instancePath: `orderLines[${index}].quantities[${size}]`,
      }
    }
    acc.push({
      path: QUANTITIES_PATH,
      instancePath: `orderLines[${index}].quantities[${size}]`,
      before: b,
      after: a,
    })
  }
  return null
}

/** Reduce a diff to the per-section summary shape stored in
 *  `proof_amendment_requests.diff_summary` (kept loose JSON for the staff
 *  viewer to render later in Slice H). */
export function buildDiffSummary(diff: AmendmentDiffEntry[]): {
  designs: AmendmentDiffEntry[]
  orderLines: AmendmentDiffEntry[]
  notes: AmendmentDiffEntry[]
} {
  return {
    designs: diff.filter((d) => d.path.startsWith('design.')),
    orderLines: diff.filter((d) => d.path.startsWith('orderLines[]')),
    notes: diff.filter((d) => d.path === 'notes'),
  }
}

/** Exposed for tests / debugging only. Re-export the allow-list as a Set
 *  so callers can do membership checks without importing the strings file. */
export const CUSTOMER_EDITABLE_FIELDS_SET = new Set<string>(CUSTOMER_EDITABLE_FIELDS)
