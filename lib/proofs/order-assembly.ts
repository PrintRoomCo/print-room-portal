import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createDefaultQuantities,
  createProofItemId,
} from '@/lib/proofs/schema-helpers'
import type {
  ProofDesign,
  ProofDocument,
  ProofMethod,
  ProofOrderLine,
  ProofPrintArea,
} from '@/lib/proofs/types'
import { SIZE_COLUMNS } from '@/lib/proofs/types'

type UnknownRecord = Record<string, unknown>

const ARTWORK_BUCKET = 'org-artworks'

const DEFAULT_TERMS = [
  'Please check all spelling, layout, garment colour, artwork size, print placement, and quantities before approval.',
  'Production will not begin until this proof is approved. Any changes after approval may affect delivery date and incur additional cost.',
].join(' ')

const DEFAULT_APPROVAL_COPY =
  'I confirm the artwork, garment details, and quantities shown in this proof are approved for production.'

export interface OrderProofQuoteRow {
  id: string
  order_ref: string | null
  customer_name: string | null
  customer_email: string | null
  customer_phone: string | null
  organization_id: string | null
  required_by: string | null
  payment_terms: string | null
  notes: string | null
  internal_notes: string | null
  shipping_address: unknown
  total_amount?: number | string | null
}

export interface OrderProofOrganizationRow {
  id: string
  name: string | null
  customer_code?: string | null
}

export interface OrderProofLineRow {
  id: string
  product_id: string
  product_name: string
  quantity: number
  unit_price: number | string | null
  total_price?: number | string | null
  variant_id: string | null
  decorations?: unknown
  customizations?: unknown
  product_variants?: unknown
}

export interface DecorationLinkDetail {
  id: string
  catalogue_item_id: string
  org_decoration_id: string
  snapshot_url: string | null
  snapshot_storage_path?: string | null
  snapshot_color_swatch_id?: string | null
  print_area_id?: string | null
  placement_x?: number | string | null
  placement_y?: number | string | null
  placement_w?: number | string | null
  placement_h?: number | string | null
  placement_rotation_deg?: number | string | null
  unit_price_override?: number | string | null
  decoration?: {
    id: string
    name: string | null
    decoration_method: string | null
    decoration_location_id?: string | null
    unit_price?: number | string | null
    width_mm?: number | string | null
    height_mm?: number | string | null
    colour_count?: number | string | null
    complexity?: string | null
    garment_family?: string | null
    digitized_file_supplied?: boolean | null
    pantones?: string[] | null
    pantone_hexes?: string[] | null
    pricing_breakdown?: unknown
    artwork?: {
      id: string
      name: string | null
      public_url: string | null
      storage_path?: string | null
    } | null
    location?: {
      id?: string
      location: string | null
      placement_key?: string | null
    } | null
  } | null
  print_area?: {
    id: string
    view: string | null
    name: string | null
    width_mm: number | string | null
    height_mm: number | string | null
  } | null
}

export interface CatalogueProofImageRow {
  catalogue_item_id: string
  color_swatch_id: string | null
  view: string | null
  image_url: string | null
  source: string | null
  position: number | null
}

export interface ProductProofImageRow {
  product_id: string
  color_swatch_id: string | null
  view: string | null
  file_url: string | null
  position: number | null
}

export interface ProductBrandInfo {
  sku: string | null
  brandName: string | null
}

export interface OrderProofAssemblyInput {
  orderId: string
  quote: OrderProofQuoteRow
  organization: OrderProofOrganizationRow | null
  lines: OrderProofLineRow[]
  decorationLinksById: Map<string, DecorationLinkDetail>
  catalogueImagesByItemId: Map<string, CatalogueProofImageRow[]>
  productImagesByProductId: Map<string, ProductProofImageRow[]>
  transparentArtworkUrlsByArtworkId: Map<string, string>
  productBrandInfoByProductId: Map<string, ProductBrandInfo>
  preparedByName?: string
  preparedByEmail?: string
  preparedByPhone?: string
}

export interface OrderProofAssemblyResult {
  document: ProofDocument
  checklist: string[]
}

interface DecorationSnapshot {
  linkId: string
  decorationId: string | null
  name: string
  method: string
  positionLabel: string | null
  unitPrice: number | null
  artworkUrl: string | null
  snapshotUrl: string | null
}

interface VariantSummary {
  colorSwatchId: string | null
  colorLabel: string
  colorHex: string | null
  sizeLabel: string
}

interface DesignDraft {
  key: string
  design: ProofDesign
  productNames: Set<string>
  colourNames: Set<string>
}

interface ImagePick {
  url: string | null
  view: string | null
  source: 'decoration_snapshot' | 'designer_snapshot' | 'staff_upload' | 'product_image' | 'none'
}

export async function loadOrderProofAssembly(
  admin: SupabaseClient,
  orderId: string,
  preparedBy?: { name?: string; email?: string; phone?: string },
): Promise<OrderProofAssemblyResult> {
  const { data: order, error: orderError } = await admin
    .from('orders')
    .select('id, quote_id')
    .eq('id', orderId)
    .maybeSingle()

  if (orderError) throw new Error(`Order lookup failed: ${orderError.message}`)
  if (!order?.quote_id) throw new Error('Order is missing quote_id.')

  const { data: quote, error: quoteError } = await admin
    .from('quotes')
    .select(`
      id,
      order_ref,
      customer_name,
      customer_email,
      customer_phone,
      organization_id,
      required_by,
      payment_terms,
      notes,
      internal_notes,
      shipping_address,
      total_amount
    `)
    .eq('id', order.quote_id)
    .maybeSingle()

  if (quoteError) throw new Error(`Quote lookup failed: ${quoteError.message}`)
  if (!quote) throw new Error('Quote not found.')

  const [organizationResult, linesResult] = await Promise.all([
    quote.organization_id
      ? admin
          .from('organizations')
          .select('id, name, customer_code')
          .eq('id', quote.organization_id)
          .is('deleted_at', null)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    admin
      .from('quote_items')
      .select(`
        id,
        product_id,
        product_name,
        quantity,
        unit_price,
        total_price,
        variant_id,
        decorations,
        customizations,
        product_variants (
          id,
          color_swatch_id,
          size_id,
          product_color_swatches (id, label, hex),
          sizes (id, label, order_index)
        )
      `)
      .eq('quote_id', quote.id),
  ])

  if (organizationResult.error) {
    throw new Error(`Organization lookup failed: ${organizationResult.error.message}`)
  }
  if (linesResult.error) throw new Error(`Quote line lookup failed: ${linesResult.error.message}`)

  const lines = (linesResult.data ?? []) as unknown as OrderProofLineRow[]
  const linkIds = collectDecorationLinkIds(lines)
  const decorationLinksById = await fetchDecorationLinks(admin, linkIds)
  const catalogueItemIds = uniqueStrings(
    Array.from(decorationLinksById.values()).map((link) => link.catalogue_item_id),
  )
  const artworkIds = uniqueStrings(
    Array.from(decorationLinksById.values()).map((link) => link.decoration?.artwork?.id),
  )
  const productIds = uniqueStrings(lines.map((line) => line.product_id))

  const [
    catalogueImagesByItemId,
    productImagesByProductId,
    transparentArtworkUrlsByArtworkId,
    productBrandInfoByProductId,
  ] = await Promise.all([
    fetchCatalogueImages(admin, catalogueItemIds),
    fetchProductImages(admin, productIds),
    fetchTransparentArtworkUrls(admin, artworkIds),
    fetchProductBrandInfo(admin, productIds),
  ])

  return buildProofDocumentFromOrderRows({
    orderId,
    quote: quote as OrderProofQuoteRow,
    organization: organizationResult.data as OrderProofOrganizationRow | null,
    lines,
    decorationLinksById,
    catalogueImagesByItemId,
    productImagesByProductId,
    transparentArtworkUrlsByArtworkId,
    productBrandInfoByProductId,
    preparedByName: preparedBy?.name,
    preparedByEmail: preparedBy?.email,
    preparedByPhone: preparedBy?.phone,
  })
}

export function buildProofDocumentFromOrderRows(
  input: OrderProofAssemblyInput,
): OrderProofAssemblyResult {
  const checklist: string[] = []
  const customerName = input.quote.customer_name || input.organization?.name || 'Client'
  const customerEmail = input.quote.customer_email || ''
  const jobReference = input.quote.order_ref || input.orderId
  const designsByKey = new Map<string, DesignDraft>()
  const orderLinesByKey = new Map<string, ProofOrderLine>()

  if (!customerEmail) checklist.push('Customer email is missing on the quote.')
  if (input.lines.length === 0) checklist.push('The order has no quote_items rows.')

  for (const line of input.lines) {
    const variant = summarizeVariant(line.product_variants)
    const snapshots = decorationSnapshotsFromLine(line)
    if (snapshots.length === 0) {
      checklist.push(`${line.product_name || line.id} has no selected artwork/decorations.`)
      continue
    }

    for (const snapshot of snapshots) {
      const link = snapshot.linkId ? input.decorationLinksById.get(snapshot.linkId) : undefined
      const designKey = link?.org_decoration_id || snapshot.decorationId || snapshot.linkId || line.id
      const design = getOrCreateDesignDraft({
        designsByKey,
        designKey,
        snapshot,
        link,
        input,
        line,
        variant,
        checklist,
      })
      design.productNames.add(line.product_name)
      if (variant.colorLabel) design.colourNames.add(variant.colorLabel)

      const orderLineKey = [
        design.design.index,
        line.product_id,
        variant.colorSwatchId || '_',
      ].join('|')
      const orderLine = orderLinesByKey.get(orderLineKey) ?? createOrderLine(
        line,
        variant,
        design.design.index,
        input.productBrandInfoByProductId.get(line.product_id),
        link,
      )
      applyLineQuantity(orderLine, line.quantity, variant.sizeLabel)
      orderLinesByKey.set(orderLineKey, orderLine)
    }
  }

  const designs = Array.from(designsByKey.values()).map((draft, index) => ({
    ...draft.design,
    index: index + 1,
    garmentLabel: Array.from(draft.productNames).join(', '),
    colourName: Array.from(draft.colourNames).join(', '),
  }))

  const document: ProofDocument = {
    customerName,
    customerEmail,
    jobName: jobReference,
    jobReference,
    preparedByName: input.preparedByName || '',
    preparedByEmail: input.preparedByEmail || '',
    preparedByPhone: input.preparedByPhone || '',
    website: 'printroom.studio',
    deliveryDateLabel: input.quote.required_by || '',
    terms: DEFAULT_TERMS,
    approvalCopy: DEFAULT_APPROVAL_COPY,
    warning: 'Production will not be released until this proof PDF is attached to the Production item.',
    notes: [input.quote.notes, input.quote.internal_notes].filter(Boolean).join('\n'),
    designs,
    orderLines: Array.from(orderLinesByKey.values()),
  }

  if (document.designs.length === 0) checklist.push('No proof designs could be assembled from the order.')
  if (document.orderLines.length === 0) checklist.push('No order table rows could be assembled from quote_items.')

  return { document, checklist: uniqueStrings(checklist) }
}

function getOrCreateDesignDraft(args: {
  designsByKey: Map<string, DesignDraft>
  designKey: string
  snapshot: DecorationSnapshot
  link: DecorationLinkDetail | undefined
  input: OrderProofAssemblyInput
  line: OrderProofLineRow
  variant: VariantSummary
  checklist: string[]
}) {
  const existing = args.designsByKey.get(args.designKey)
  if (existing) {
    const area = printAreaFromDecoration(args.link, args.snapshot)
    if (area && !existing.design.printAreas.some((current) => current.label === area.label)) {
      existing.design.printAreas.push(area)
    }
    return existing
  }

  const artwork = resolveArtworkUrl(args.link, args.snapshot, args.input.transparentArtworkUrlsByArtworkId)
  const mockup = resolveMockupImage({
    line: args.line,
    variant: args.variant,
    link: args.link,
    snapshot: args.snapshot,
    catalogueImagesByItemId: args.input.catalogueImagesByItemId,
    productImagesByProductId: args.input.productImagesByProductId,
  })
  const printArea = printAreaFromDecoration(args.link, args.snapshot)
  const designIndex = args.designsByKey.size + 1
  const artworkName = args.link?.decoration?.artwork?.name || args.snapshot.name
  const locationLabel =
    args.link?.print_area?.name ||
    args.link?.decoration?.location?.location ||
    args.snapshot.positionLabel ||
    'Print area'

  if (!args.link && args.snapshot.linkId) {
    args.checklist.push(`Decoration link ${args.snapshot.linkId} is no longer attached to the catalogue item.`)
  }
  if (!mockup.url) {
    args.checklist.push(`${args.line.product_name} / ${locationLabel} needs a product snapshot or clean product image.`)
  }
  if (!artwork.url) {
    args.checklist.push(`${args.snapshot.name || locationLabel} needs uploaded organization artwork.`)
  }
  if (!printArea?.widthMm || !printArea.heightMm) {
    args.checklist.push(`${args.snapshot.name || locationLabel} needs print dimensions in mm.`)
  }
  if (!args.link?.decoration?.decoration_method && !args.snapshot.method) {
    args.checklist.push(`${args.snapshot.name || locationLabel} needs a decoration method.`)
  }

  const design: ProofDesign = {
    id: createProofItemId('design'),
    index: designIndex,
    name: args.snapshot.name || args.link?.decoration?.name || `Design ${designIndex}`,
    subtitle: locationLabel,
    garmentLabel: args.line.product_name,
    colourName: args.variant.colorLabel,
    frontMockupUrl: isBackView(mockup.view) ? '' : mockup.url || '',
    backMockupUrl: isBackView(mockup.view) ? mockup.url || '' : '',
    artworkUrl: artwork.url || '',
    artworkBackground: '#f8f8f4',
    artworkNotes: artworkName ? `Source artwork: ${artworkName}` : '',
    printHeightsNote: buildPrintHeightsNote(args.link),
    productionNote: buildProductionNote(args.link, args.snapshot, mockup.source),
    mockupAssets: [],
    printAreas: printArea ? [printArea] : [],
    sourceMode: args.link?.catalogue_item_id ? 'customer_order_catalogue_product' : 'manual',
    catalogueSource: args.link?.catalogue_item_id
      ? buildOrderCatalogueSource(args.line, args.variant, args.link)
      : null,
  }

  const draft = {
    key: args.designKey,
    design,
    productNames: new Set<string>(),
    colourNames: new Set<string>(),
  }
  args.designsByKey.set(args.designKey, draft)
  return draft
}

function createOrderLine(
  line: OrderProofLineRow,
  variant: VariantSummary,
  designIndex: number,
  productInfo: ProductBrandInfo | undefined,
  link: DecorationLinkDetail | undefined,
): ProofOrderLine {
  return {
    id: createProofItemId('line'),
    designIndex,
    name: `Design ${designIndex}`,
    isStaff: false,
    brand: productInfo?.brandName ?? '',
    garment: line.product_name,
    sku: productInfo?.sku ?? '',
    colour: variant.colorLabel,
    productId: line.product_id,
    productVariantId: line.variant_id,
    sourceCatalogueItemId: link?.catalogue_item_id ?? null,
    sourceMode: link?.catalogue_item_id ? 'customer_order_catalogue_product' : 'manual',
    catalogueSource: link?.catalogue_item_id
      ? buildOrderCatalogueSource(line, variant, link)
      : null,
    quantities: createDefaultQuantities(),
  }
}

function buildOrderCatalogueSource(
  line: OrderProofLineRow,
  variant: VariantSummary,
  link: DecorationLinkDetail,
) {
  return {
    mode: 'customer_order_catalogue_product' as const,
    catalogueItemId: link.catalogue_item_id,
    sourceProductId: line.product_id,
    productId: line.product_id,
    productVariantId: line.variant_id,
    swatchId: variant.colorSwatchId,
    swatchLabel: variant.colorLabel,
    unitPrice: line.unit_price == null ? null : toNumberValue(line.unit_price),
    sourceLabel: 'Customer order catalogue product',
  }
}

function applyLineQuantity(line: ProofOrderLine, quantity: number, sizeLabel: string) {
  const column = normalizeSizeColumn(sizeLabel)
  line.quantities[column] = String((Number(line.quantities[column]) || 0) + quantity)
}

function printAreaFromDecoration(
  link: DecorationLinkDetail | undefined,
  snapshot: DecorationSnapshot,
): ProofPrintArea | null {
  const label =
    link?.print_area?.name ||
    link?.decoration?.location?.location ||
    snapshot.positionLabel ||
    ''
  const widthMm = toStringValue(link?.print_area?.width_mm ?? link?.decoration?.width_mm)
  const heightMm = toStringValue(link?.print_area?.height_mm ?? link?.decoration?.height_mm)

  if (!label && !widthMm && !heightMm) return null

  // Spec 2026-05-14 §G.3 — AM-curated pantones on org_decorations override the
  // legacy colour_count summary. Empty arrays preserve today's rendering.
  const pantones = (link?.decoration?.pantones ?? []) as string[]
  const hexes = (link?.decoration?.pantone_hexes ?? []) as string[]
  const fallbackColourCount = link?.decoration?.colour_count
    ? `${link.decoration.colour_count} colour${Number(link.decoration.colour_count) === 1 ? '' : 's'}`
    : ''

  return {
    id: createProofItemId('area'),
    label: label || 'PRINT AREA',
    method: normalizeProofMethod(link?.decoration?.decoration_method || snapshot.method),
    widthMm,
    heightMm,
    pantone: pantones.length > 0 ? pantones.join(', ') : fallbackColourCount,
    pantoneHex: hexes[0] ?? '#ffffff',
    artworkStatus: link?.decoration?.digitized_file_supplied ? 'DIGITIZED FILE SUPPLIED' : 'ARTWORK ON FILE',
    productionNote: buildProductionNote(link, snapshot, 'none'),
  }
}

function resolveArtworkUrl(
  link: DecorationLinkDetail | undefined,
  snapshot: DecorationSnapshot,
  transparentArtworkUrlsByArtworkId: Map<string, string>,
) {
  const artworkId = link?.decoration?.artwork?.id
  if (artworkId) {
    const transparent = transparentArtworkUrlsByArtworkId.get(artworkId)
    if (transparent) return { url: transparent, source: 'transparent_png' as const }
  }
  return {
    url: link?.decoration?.artwork?.public_url || snapshot.artworkUrl || null,
    source: 'organization_artwork' as const,
  }
}

function resolveMockupImage(args: {
  line: OrderProofLineRow
  variant: VariantSummary
  link: DecorationLinkDetail | undefined
  snapshot: DecorationSnapshot
  catalogueImagesByItemId: Map<string, CatalogueProofImageRow[]>
  productImagesByProductId: Map<string, ProductProofImageRow[]>
}): ImagePick {
  if (args.link?.snapshot_url) {
    return {
      url: args.link.snapshot_url,
      view: args.link.print_area?.view || null,
      source: 'decoration_snapshot',
    }
  }
  if (args.snapshot.snapshotUrl) {
    return {
      url: args.snapshot.snapshotUrl,
      view: args.link?.print_area?.view || null,
      source: 'decoration_snapshot',
    }
  }

  const catalogueRows = args.link?.catalogue_item_id
    ? args.catalogueImagesByItemId.get(args.link.catalogue_item_id) ?? []
    : []
  const cataloguePick = pickCatalogueImage(catalogueRows, args.variant.colorSwatchId)
  if (cataloguePick.url) return cataloguePick

  const productRows = args.productImagesByProductId.get(args.line.product_id) ?? []
  return pickProductImage(productRows, args.variant.colorSwatchId)
}

function pickCatalogueImage(rows: CatalogueProofImageRow[], colorSwatchId: string | null): ImagePick {
  const sorted = rows
    .filter((row) => row.image_url)
    .filter((row) => row.color_swatch_id === colorSwatchId || row.color_swatch_id == null)
    .sort((a, b) => {
      const source = catalogueSourceRank(a.source) - catalogueSourceRank(b.source)
      if (source !== 0) return source
      const view = viewRank(a.view) - viewRank(b.view)
      if (view !== 0) return view
      const colour = colourRank(a.color_swatch_id, colorSwatchId) - colourRank(b.color_swatch_id, colorSwatchId)
      if (colour !== 0) return colour
      return (a.position ?? 0) - (b.position ?? 0)
    })
  const best = sorted[0]
  return {
    url: best?.image_url ?? null,
    view: best?.view ?? null,
    source: best?.source === 'designer_snapshot' ? 'designer_snapshot' : best ? 'staff_upload' : 'none',
  }
}

function pickProductImage(rows: ProductProofImageRow[], colorSwatchId: string | null): ImagePick {
  const sorted = rows
    .filter((row) => row.file_url)
    .filter((row) => row.color_swatch_id === colorSwatchId || row.color_swatch_id == null)
    .sort((a, b) => {
      const view = viewRank(a.view) - viewRank(b.view)
      if (view !== 0) return view
      const colour = colourRank(a.color_swatch_id, colorSwatchId) - colourRank(b.color_swatch_id, colorSwatchId)
      if (colour !== 0) return colour
      return (a.position ?? 0) - (b.position ?? 0)
    })
  const best = sorted[0]
  return {
    url: best?.file_url ?? null,
    view: best?.view ?? null,
    source: best ? 'product_image' : 'none',
  }
}

function buildPrintHeightsNote(link: DecorationLinkDetail | undefined) {
  const placement = [
    link?.placement_x != null ? `x ${link.placement_x}` : null,
    link?.placement_y != null ? `y ${link.placement_y}` : null,
    link?.placement_w != null ? `w ${link.placement_w}` : null,
    link?.placement_h != null ? `h ${link.placement_h}` : null,
  ].filter(Boolean)
  return placement.length > 0 ? `Placement: ${placement.join(', ')}` : 'IF GARMENTS DIFFER'
}

function buildProductionNote(
  link: DecorationLinkDetail | undefined,
  snapshot: DecorationSnapshot,
  mockupSource: ImagePick['source'],
) {
  const decoration = link?.decoration
  const parts = [
    decoration?.garment_family ? `Garment family: ${decoration.garment_family}` : null,
    decoration?.complexity ? `Complexity: ${decoration.complexity}` : null,
    decoration?.digitized_file_supplied ? 'Digitized file supplied' : null,
    decoration?.colour_count ? `Colour count: ${decoration.colour_count}` : null,
    snapshot.unitPrice != null ? `Decoration unit: ${formatMoney(snapshot.unitPrice)}` : null,
    mockupSource !== 'none' ? `Mockup source: ${mockupSource.replace('_', ' ')}` : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join('\n') : 'N/A'
}

function decorationSnapshotsFromLine(line: OrderProofLineRow): DecorationSnapshot[] {
  const decorations = asArray(line.decorations)
  return decorations
    .map((item) => {
      const record = asObject(item)
      const linkId = toStringValue(record.linkId || record.link_id)
      if (!linkId) return null
      return {
        linkId,
        decorationId: toStringValue(record.decorationId || record.decoration_id) || null,
        name: toStringValue(record.name, 'Artwork'),
        method: toStringValue(record.method),
        positionLabel: toStringValue(record.positionLabel || record.position_label) || null,
        unitPrice: record.unitPrice == null && record.unit_price == null
          ? null
          : toNumberValue(record.unitPrice ?? record.unit_price),
        artworkUrl: toStringValue(record.artworkUrl || record.artwork_url) || null,
        snapshotUrl: toStringValue(record.snapshotUrl || record.snapshot_url) || null,
      } satisfies DecorationSnapshot
    })
    .filter((item): item is DecorationSnapshot => Boolean(item))
}

function summarizeVariant(value: unknown): VariantSummary {
  const variant = asObject(pickOne(value))
  const swatch = asObject(pickOne(variant.product_color_swatches))
  const size = asObject(pickOne(variant.sizes))
  return {
    colorSwatchId: toStringValue(variant.color_swatch_id || swatch.id) || null,
    colorLabel: toStringValue(swatch.label),
    colorHex: toStringValue(swatch.hex) || null,
    sizeLabel: toStringValue(size.label, 'One Size'),
  }
}

function collectDecorationLinkIds(lines: OrderProofLineRow[]) {
  return uniqueStrings(
    lines.flatMap((line) => decorationSnapshotsFromLine(line).map((snapshot) => snapshot.linkId)),
  )
}

async function fetchDecorationLinks(admin: SupabaseClient, linkIds: string[]) {
  const map = new Map<string, DecorationLinkDetail>()
  if (linkIds.length === 0) return map

  const { data, error } = await admin
    .from('b2b_catalogue_item_decorations')
    .select(`
      id,
      catalogue_item_id,
      org_decoration_id,
      snapshot_url,
      snapshot_storage_path,
      snapshot_color_swatch_id,
      print_area_id,
      placement_x,
      placement_y,
      placement_w,
      placement_h,
      placement_rotation_deg,
      unit_price_override,
      decoration:org_decorations!b2b_catalogue_item_decorations_org_decoration_id_fkey (
        id,
        name,
        decoration_method,
        decoration_location_id,
        unit_price,
        width_mm,
        height_mm,
        colour_count,
        complexity,
        garment_family,
        digitized_file_supplied,
        pantones,
        pantone_hexes,
        pricing_breakdown,
        artwork:organization_artworks!org_decorations_artwork_id_fkey (
          id,
          name,
          public_url,
          storage_path
        ),
        location:decoration_locations!org_decorations_decoration_location_id_fkey (
          id,
          location,
          placement_key
        )
      ),
      print_area:product_print_areas!b2b_catalogue_item_decorations_print_area_id_fkey (
        id,
        view,
        name,
        width_mm,
        height_mm
      )
    `)
    .in('id', linkIds)

  if (error) throw new Error(`Decoration link lookup failed: ${error.message}`)
  for (const row of (data ?? []) as unknown as DecorationLinkDetail[]) {
    map.set(row.id, normalizeDecorationLink(row))
  }
  return map
}

async function fetchCatalogueImages(admin: SupabaseClient, catalogueItemIds: string[]) {
  const map = new Map<string, CatalogueProofImageRow[]>()
  if (catalogueItemIds.length === 0) return map
  const { data, error } = await admin
    .from('b2b_catalogue_item_images')
    .select('catalogue_item_id, color_swatch_id, view, image_url, source, position')
    .in('catalogue_item_id', catalogueItemIds)
  if (error) throw new Error(`Catalogue image lookup failed: ${error.message}`)
  for (const row of (data ?? []) as CatalogueProofImageRow[]) {
    const list = map.get(row.catalogue_item_id) ?? []
    list.push(row)
    map.set(row.catalogue_item_id, list)
  }
  return map
}

async function fetchProductImages(admin: SupabaseClient, productIds: string[]) {
  const map = new Map<string, ProductProofImageRow[]>()
  if (productIds.length === 0) return map
  const { data, error } = await admin
    .from('product_images')
    .select('product_id, color_swatch_id, view, file_url, position')
    .in('product_id', productIds)
  if (error) throw new Error(`Product image lookup failed: ${error.message}`)
  for (const row of (data ?? []) as ProductProofImageRow[]) {
    const list = map.get(row.product_id) ?? []
    list.push(row)
    map.set(row.product_id, list)
  }
  return map
}

async function fetchTransparentArtworkUrls(admin: SupabaseClient, artworkIds: string[]) {
  const map = new Map<string, string>()
  if (artworkIds.length === 0) return map
  const { data, error } = await admin
    .from('organization_artwork_variants')
    .select('artwork_id, storage_path, variant_type, status')
    .in('artwork_id', artworkIds)
    .eq('variant_type', 'transparent_png')
    .eq('status', 'ready')
    .not('storage_path', 'is', null)
  if (error) throw new Error(`Artwork variant lookup failed: ${error.message}`)
  for (const row of (data ?? []) as Array<{ artwork_id: string; storage_path: string | null }>) {
    if (!row.storage_path || map.has(row.artwork_id)) continue
    const { data: urlData } = admin.storage.from(ARTWORK_BUCKET).getPublicUrl(row.storage_path)
    if (urlData.publicUrl) map.set(row.artwork_id, urlData.publicUrl)
  }
  return map
}

// Spec 2026-05-14 §G.2 — pull brand + sku for each ordered product.
// SKU lives on `products.sku` (one per product); `product_variants` has only
// `sku_suffix`. See spec §F.2 + §J5.
async function fetchProductBrandInfo(
  admin: SupabaseClient,
  productIds: string[],
): Promise<Map<string, ProductBrandInfo>> {
  const map = new Map<string, ProductBrandInfo>()
  if (productIds.length === 0) return map
  const { data, error } = await admin
    .from('products')
    .select('id, sku, brand:brands!products_brand_id_fkey(name)')
    .in('id', productIds)
  if (error) throw new Error(`Product brand lookup failed: ${error.message}`)
  for (const row of (data ?? []) as Array<{
    id: string
    sku: string | null
    brand: { name: string | null } | { name: string | null }[] | null
  }>) {
    const brand = Array.isArray(row.brand) ? row.brand[0] ?? null : row.brand
    map.set(row.id, { sku: row.sku ?? null, brandName: brand?.name ?? null })
  }
  return map
}

function normalizeDecorationLink(link: DecorationLinkDetail): DecorationLinkDetail {
  return {
    ...link,
    decoration: pickOne(link.decoration) ?? null,
    print_area: pickOne(link.print_area) ?? null,
  }
}

function normalizeProofMethod(value: unknown): ProofMethod {
  const normalized = toStringValue(value).toLowerCase().replace(/[\s-]+/g, '_')
  if (normalized === 'heatpress') return 'heat_press'
  if (normalized === 'supacolour' || normalized === 'supercolour') return 'super_color'
  if (normalized === 'screen_print' || normalized === 'screen') return 'screenprint'
  if (normalized === 'embroidery') return 'embroidery'
  if (normalized === 'screenprint') return 'screenprint'
  if (normalized === 'heat_press') return 'heat_press'
  if (normalized === 'super_color') return 'super_color'
  return 'other'
}

function normalizeSizeColumn(key: string) {
  const trimmed = key.trim()
  if ((SIZE_COLUMNS as readonly string[]).includes(trimmed)) return trimmed
  const normalized = trimmed.toLowerCase().replace(/\s+/g, '')
  const aliases: Record<string, string> = {
    os: 'One Size',
    onesize: 'One Size',
    xxs: 'XXS/6',
    xs: 'XS/8',
    s: 'SML/10',
    sml: 'SML/10',
    small: 'SML/10',
    m: 'MED/12',
    med: 'MED/12',
    medium: 'MED/12',
    l: 'LRG/14',
    lrg: 'LRG/14',
    large: 'LRG/14',
    xl: 'XLG/16',
    xlg: 'XLG/16',
    '2xl': '2XL/18',
    xxl: '2XL/18',
    '3xl': '3XL/20',
    '4xl': '4XL/22',
    '5xl': '5XL/24',
  }
  return aliases[normalized] ?? 'One Size'
}

function asObject(value: unknown): UnknownRecord {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as UnknownRecord
  }
  return {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function pickOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function toStringValue(value: unknown, fallback = '') {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return fallback
}

function toNumberValue(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : 0
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))))
}

function catalogueSourceRank(source: string | null) {
  if (source === 'designer_snapshot') return 0
  if (source === 'staff_upload') return 1
  return 9
}

function viewRank(view: string | null) {
  const normalized = view?.toLowerCase() ?? ''
  if (normalized === 'hero') return 0
  if (normalized === 'front') return 1
  if (normalized === 'back') return 2
  return 5
}

function colourRank(rowColorSwatchId: string | null, selectedColorSwatchId: string | null) {
  if (rowColorSwatchId && rowColorSwatchId === selectedColorSwatchId) return 0
  if (rowColorSwatchId == null) return 1
  return 2
}

function isBackView(view: string | null) {
  return view?.toLowerCase().includes('back') ?? false
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('en-NZ', {
    style: 'currency',
    currency: 'NZD',
  }).format(value)
}
