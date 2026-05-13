// MIRROR: keep in sync with
// `print-room-staff-portal/src/lib/proofs/build-document-from-catalogue.ts`.
// F4 (per-decoration toggle) lands in both copies simultaneously; the
// customer portal calls this with `enabledDecorationIds=undefined` (autofill =
// all decorations), the staff portal picker provides explicit arrays.

import type {
  CatalogueProofProduct,
  CatalogueProofProductColour,
  CatalogueProofProductDecoration,
  ProofDesign,
  ProofDocument,
  ProofMethod,
  ProofOrderLine,
  ProofPrintArea,
} from '@/lib/proofs/types'
import { PROOF_METHODS } from '@/lib/proofs/types'
import {
  createDefaultOrderLine,
  createDefaultPrintArea,
  createDefaultProofDocument,
  createProofItemId,
  reindexDesigns,
} from '@/lib/proofs/schema-helpers'

export interface BuildDocumentSelection {
  catalogueItemId: string
  swatchId?: string | null
  /**
   * Per-decoration toggle (spec 2026-05-13 §G.3).
   * undefined → emit every decoration on the product (default, autofill path).
   * non-empty → emit only decorations whose linkId is in this array.
   * empty array → emit a bare-garment design (no decoration print areas).
   */
  enabledDecorationIds?: string[]
}

export interface BuildDocumentFromCatalogueInput {
  selections: BuildDocumentSelection[]
  products: CatalogueProofProduct[]
  organizationId: string
  organizationName: string
  customerName: string
  customerEmail: string
  jobName: string
  jobReference?: string
  preparedByName?: string
  preparedByEmail?: string
  preparedByPhone?: string
}

export function buildDocumentFromCatalogue(
  input: BuildDocumentFromCatalogueInput,
): ProofDocument {
  const fallback = createDefaultProofDocument({
    organizationId: input.organizationId,
    organizationName: input.organizationName,
    customerName: input.customerName,
    customerEmail: input.customerEmail,
    jobName: input.jobName,
    jobReference: input.jobReference,
    preparedByName: input.preparedByName,
  })

  if (input.selections.length === 0) return fallback

  const productsById = new Map<string, CatalogueProofProduct>()
  for (const product of input.products) productsById.set(product.catalogueItemId, product)

  const designs: ProofDesign[] = []
  const orderLines: ProofOrderLine[] = []

  for (const selection of input.selections) {
    const product = productsById.get(selection.catalogueItemId)
    if (!product) continue

    const swatch = pickColour(product, selection.swatchId ?? null)
    const mockupUrl = pickMockupUrl(product, swatch)

    const filtered = filterDecorationsByEnabledIds(
      product.decorations,
      selection.enabledDecorationIds,
    )
    const decorations = filtered.length > 0 ? filtered : null

    if (!decorations) {
      const designIndex = designs.length + 1
      designs.push(buildDesignSkeleton({ designIndex, product, swatch, mockupUrl, decoration: null }))
      orderLines.push(buildOrderLine({ designIndex, product, swatch }))
      continue
    }

    const designIndex = designs.length + 1
    const printAreas: ProofPrintArea[] = decorations.map((dec) => buildPrintArea(dec))
    const firstDecoration = decorations[0]
    designs.push(
      buildDesignSkeleton({
        designIndex,
        product,
        swatch,
        mockupUrl,
        decoration: firstDecoration,
        printAreas,
      }),
    )
    orderLines.push(buildOrderLine({ designIndex, product, swatch }))
  }

  if (designs.length === 0) return fallback

  return {
    ...fallback,
    designs: reindexDesigns(designs),
    orderLines,
  }
}

function filterDecorationsByEnabledIds(
  decorations: CatalogueProofProductDecoration[],
  enabledDecorationIds: string[] | undefined,
): CatalogueProofProductDecoration[] {
  if (enabledDecorationIds === undefined) return decorations
  if (enabledDecorationIds.length === 0) return []
  const enabled = new Set(enabledDecorationIds)
  return decorations.filter((d) => enabled.has(d.linkId))
}

function pickColour(
  product: CatalogueProofProduct,
  swatchId: string | null,
): CatalogueProofProductColour | null {
  if (swatchId) {
    const match = product.colours.find((c) => c.swatchId === swatchId)
    if (match) return match
  }
  return product.colours[0] ?? null
}

function pickMockupUrl(
  product: CatalogueProofProduct,
  swatch: CatalogueProofProductColour | null,
): string {
  if (swatch?.imageUrl) return swatch.imageUrl
  return product.imageUrl ?? ''
}

function buildPrintArea(decoration: CatalogueProofProductDecoration): ProofPrintArea {
  const label = (decoration.printAreaName || decoration.decorationName || 'Print area')
    .toString()
    .toUpperCase()
  return {
    id: createProofItemId('area'),
    label,
    method: normalizeMethod(decoration.method),
    widthMm: toDimensionString(decoration.widthMm),
    heightMm: toDimensionString(decoration.heightMm),
    pantone: '',
    pantoneHex: '#ffffff',
    artworkStatus: 'NEW',
    productionNote: 'N/A',
  }
}

function buildDesignSkeleton(args: {
  designIndex: number
  product: CatalogueProofProduct
  swatch: CatalogueProofProductColour | null
  mockupUrl: string
  decoration: CatalogueProofProductDecoration | null
  printAreas?: ProofPrintArea[]
}): ProofDesign {
  const { designIndex, product, swatch, mockupUrl, decoration, printAreas } = args
  return {
    id: createProofItemId('design'),
    index: designIndex,
    name: decoration?.decorationName || product.name || `Design ${designIndex}`,
    subtitle: decoration?.printAreaName ?? '',
    garmentLabel: product.name,
    colourName: swatch?.label ?? '',
    frontMockupUrl: mockupUrl,
    backMockupUrl: '',
    artworkUrl: decoration?.artworkUrl ?? '',
    artworkBackground: '#f8f8f4',
    artworkNotes: '',
    printHeightsNote: 'IF GARMENTS DIFFER',
    productionNote: 'N/A',
    printAreas: printAreas && printAreas.length > 0 ? printAreas : [createDefaultPrintArea()],
  }
}

function buildOrderLine(args: {
  designIndex: number
  product: CatalogueProofProduct
  swatch: CatalogueProofProductColour | null
}): ProofOrderLine {
  const { designIndex, product, swatch } = args
  const base = createDefaultOrderLine(designIndex)
  return {
    ...base,
    name: product.name,
    garment: product.name,
    colour: swatch?.label ?? '',
  }
}

function normalizeMethod(method: string | null | undefined): ProofMethod {
  const m = (method ?? '').toString().trim().toLowerCase()
  if ((PROOF_METHODS as readonly string[]).includes(m)) return m as ProofMethod
  if (m === 'screen_print' || m === 'screen' || m === 'screenprinting') return 'screenprint'
  if (m === 'embroider' || m === 'embroidered') return 'embroidery'
  if (m === 'heat' || m === 'heat-press' || m === 'heatpress') return 'heat_press'
  if (m === 'supercolor' || m === 'super-color' || m === 'supacolor' || m === 'supacolour') {
    return 'super_color'
  }
  return 'other'
}

function toDimensionString(value: number | null | undefined): string {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Number.isInteger(value) ? String(value) : value.toFixed(1)
  }
  return ''
}
