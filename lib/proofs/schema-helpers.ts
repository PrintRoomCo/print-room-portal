// Minimal subset of staff portal's `src/lib/proofs/schema.ts` — only the
// builders that `buildDocumentFromCatalogue` and `autofillProofForOrder`
// depend on. The staff portal also exports normalisers / DB mappers /
// validators; the customer portal never authors a proof from scratch via the
// UI, so those parts stay staff-only.
//
// MIRROR: when staff portal renames or reshapes one of these helpers, mirror
// the change here. Drift is accepted (per spec 2026-05-13 §M.R4) but tracked
// via this comment.

import { SIZE_COLUMNS } from '@/lib/proofs/types'
import type {
  ProofCreateInput,
  ProofDocument,
  ProofOrderLine,
  ProofPrintArea,
} from '@/lib/proofs/types'

const DEFAULT_TERMS = [
  'Please check all spelling, layout, garment colour, artwork size, print placement, and quantities before approval.',
  'Production will not begin until this proof is approved. Any changes after approval may affect delivery date and incur additional cost.',
].join(' ')

const DEFAULT_APPROVAL_COPY =
  'I confirm the artwork, garment details, and quantities shown in this proof are approved for production.'

const DEFAULT_WARNING =
  'Important: extra garments are recommended for screen printed jobs to cover setup, test prints, or garment faults.'

export function createProofItemId(prefix: string): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  )
}

export function createDefaultQuantities(): Record<string, string> {
  return SIZE_COLUMNS.reduce<Record<string, string>>((acc, column) => {
    acc[column] = ''
    return acc
  }, {})
}

export function createDefaultPrintArea(label = 'LEFT CHEST'): ProofPrintArea {
  return {
    id: createProofItemId('area'),
    label,
    method: 'screenprint',
    widthMm: '90',
    heightMm: '55',
    pantone: 'White',
    pantoneHex: '#ffffff',
    artworkStatus: 'NEW',
    productionNote: 'N/A',
  }
}

export function createDefaultDesign(index: number) {
  return {
    id: createProofItemId('design'),
    index,
    name: `Design ${index}`,
    subtitle: '',
    garmentLabel: '',
    colourName: '',
    frontMockupUrl: '',
    backMockupUrl: '',
    artworkUrl: '',
    artworkBackground: '#1f2a44',
    artworkNotes: '',
    printHeightsNote: 'IF GARMENTS DIFFER',
    productionNote: 'N/A',
    printAreas: [createDefaultPrintArea('LEFT CHEST'), createDefaultPrintArea('CENTRE BACK')],
  }
}

export function createDefaultOrderLine(designIndex = 1): ProofOrderLine {
  return {
    id: createProofItemId('line'),
    designIndex,
    name: '',
    isStaff: false,
    brand: '',
    garment: '',
    sku: '',
    colour: '',
    quantities: createDefaultQuantities(),
  }
}

export function createDefaultProofDocument(
  input: ProofCreateInput & { organizationName: string; preparedByName?: string },
): ProofDocument {
  const firstDesign = createDefaultDesign(1)
  return {
    customerName: input.customerName || input.organizationName,
    customerEmail: input.customerEmail,
    jobName: input.jobName,
    jobReference: input.jobReference || '',
    preparedByName: input.preparedByName || '',
    preparedByEmail: '',
    preparedByPhone: '',
    website: 'printroom.studio',
    deliveryDateLabel: '',
    terms: DEFAULT_TERMS,
    approvalCopy: DEFAULT_APPROVAL_COPY,
    warning: DEFAULT_WARNING,
    notes: '',
    designs: [firstDesign],
    orderLines: [
      {
        ...createDefaultOrderLine(1),
        name: input.customerName || input.organizationName,
      },
    ],
  }
}

export function reindexDesigns<T extends { index: number }>(designs: T[]): T[] {
  return designs.map((design, index) => ({ ...design, index: index + 1 }))
}
