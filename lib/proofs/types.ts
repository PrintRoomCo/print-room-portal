/**
 * Minimal proof types for the customer-portal read-only viewer.
 *
 * Mirrors `print-room-staff-portal/src/types/proofs.ts` ProofDocument shape,
 * narrowed to fields the viewer renders. The staff portal owns authoring +
 * normalization; we trust the stored snapshot here and render permissively.
 */

export const SIZE_COLUMNS = [
  'One Size',
  'Size 2',
  'Size 4',
  'XXS/6',
  'XS/8',
  'SML/10',
  'MED/12',
  'LRG/14',
  'XLG/16',
  '2XL/18',
  '3XL/20',
  '4XL/22',
  '5XL/24',
] as const

export type ProofSizeColumn = (typeof SIZE_COLUMNS)[number]

export interface ProofPrintArea {
  id: string
  label: string
  method: string
  widthMm: string
  heightMm: string
  pantone: string
  pantoneHex: string
  artworkStatus: string
  productionNote: string
}

export interface ProofDesign {
  id: string
  index: number
  name: string
  subtitle: string
  garmentLabel: string
  colourName: string
  frontMockupUrl: string
  backMockupUrl: string
  artworkUrl: string
  artworkBackground: string
  artworkNotes: string
  printHeightsNote: string
  productionNote: string
  printAreas: ProofPrintArea[]
}

export interface ProofOrderLine {
  id: string
  designIndex: number
  name: string
  isStaff: boolean
  brand: string
  garment: string
  sku: string
  colour: string
  quantities: Record<string, string>
}

export interface ProofDocument {
  customerName: string
  customerEmail: string
  jobName: string
  jobReference: string
  preparedByName: string
  preparedByEmail: string
  preparedByPhone: string
  website: string
  deliveryDateLabel: string
  terms: string
  approvalCopy: string
  warning: string
  notes: string
  designs: ProofDesign[]
  orderLines: ProofOrderLine[]
}

/**
 * Coerce a Supabase jsonb `snapshot_data` payload into a `ProofDocument` shape.
 * Permissive — missing fields fall back to empty strings / arrays, so an
 * unexpected shape still renders rather than crashing the page.
 */
export function coerceProofDocument(raw: unknown): ProofDocument {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const str = (v: unknown, fb = ''): string =>
    typeof v === 'string' ? v : typeof v === 'number' ? String(v) : fb
  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

  const coercePrintArea = (v: unknown, i: number): ProofPrintArea => {
    const a = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
    return {
      id: str(a.id, `area-${i}`),
      label: str(a.label),
      method: str(a.method, 'screenprint'),
      widthMm: str(a.widthMm),
      heightMm: str(a.heightMm),
      pantone: str(a.pantone),
      pantoneHex: str(a.pantoneHex, '#1f2a44'),
      artworkStatus: str(a.artworkStatus, 'NEW'),
      productionNote: str(a.productionNote, 'N/A'),
    }
  }

  const coerceDesign = (v: unknown, i: number): ProofDesign => {
    const d = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
    return {
      id: str(d.id, `design-${i}`),
      index: typeof d.index === 'number' ? d.index : i + 1,
      name: str(d.name, `Design ${i + 1}`),
      subtitle: str(d.subtitle),
      garmentLabel: str(d.garmentLabel),
      colourName: str(d.colourName),
      frontMockupUrl: str(d.frontMockupUrl),
      backMockupUrl: str(d.backMockupUrl),
      artworkUrl: str(d.artworkUrl),
      artworkBackground: str(d.artworkBackground, '#1f2a44'),
      artworkNotes: str(d.artworkNotes),
      printHeightsNote: str(d.printHeightsNote, 'IF GARMENTS DIFFER'),
      productionNote: str(d.productionNote, 'N/A'),
      printAreas: arr(d.printAreas).map(coercePrintArea),
    }
  }

  const coerceOrderLine = (v: unknown, i: number): ProofOrderLine => {
    const l = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
    const qtyRaw = (l.quantities && typeof l.quantities === 'object'
      ? l.quantities
      : {}) as Record<string, unknown>
    const quantities: Record<string, string> = {}
    for (const [k, val] of Object.entries(qtyRaw)) quantities[k] = str(val)
    return {
      id: str(l.id, `line-${i}`),
      designIndex: typeof l.designIndex === 'number' ? l.designIndex : 1,
      name: str(l.name),
      isStaff: l.isStaff === true,
      brand: str(l.brand),
      garment: str(l.garment),
      sku: str(l.sku),
      colour: str(l.colour),
      quantities,
    }
  }

  return {
    customerName: str(r.customerName),
    customerEmail: str(r.customerEmail),
    jobName: str(r.jobName),
    jobReference: str(r.jobReference),
    preparedByName: str(r.preparedByName),
    preparedByEmail: str(r.preparedByEmail),
    preparedByPhone: str(r.preparedByPhone),
    website: str(r.website, 'printroom.studio'),
    deliveryDateLabel: str(r.deliveryDateLabel),
    terms: str(r.terms),
    approvalCopy: str(r.approvalCopy),
    warning: str(r.warning),
    notes: str(r.notes),
    designs: arr(r.designs).map(coerceDesign),
    orderLines: arr(r.orderLines).map(coerceOrderLine),
  }
}

export function calculateLineTotal(line: ProofOrderLine): number {
  let total = 0
  for (const v of Object.values(line.quantities)) {
    const n = Number(v)
    if (Number.isFinite(n)) total += n
  }
  return total
}

// ---------------------------------------------------------------------------
// Catalogue-side types (F1 vendored helper).
//
// MIRROR: keep in sync with `print-room-staff-portal/src/types/proofs.ts`.
// The staff portal owns authoring; this copy is consumed by the customer-
// portal autofill helper that builds a proof shell after order submit.
// ---------------------------------------------------------------------------

export interface CatalogueProofProductColour {
  swatchId: string
  label: string
  hex: string | null
  imageUrl: string | null
}

export interface CatalogueProofProductDecoration {
  linkId: string
  decorationName: string
  method: string
  printAreaName: string | null
  widthMm: number | null
  heightMm: number | null
  artworkUrl: string | null
  snapshotUrl: string | null
}

export interface CatalogueProofProduct {
  catalogueItemId: string
  sourceProductId: string
  name: string
  imageUrl: string | null
  colours: CatalogueProofProductColour[]
  decorations: CatalogueProofProductDecoration[]
}

export interface CatalogueProofProductGreyed extends CatalogueProofProduct {
  reasons: string[]
}

export interface ReadyProductsResult {
  products: CatalogueProofProduct[]
  greyed: CatalogueProofProductGreyed[]
}

export const PROOF_METHODS = [
  'screenprint',
  'embroidery',
  'heat_press',
  'super_color',
  'other',
] as const

export type ProofMethod = (typeof PROOF_METHODS)[number]

export interface ProofCreateInput {
  organizationId: string
  customerName: string
  customerEmail: string
  jobName: string
  jobReference?: string
}
