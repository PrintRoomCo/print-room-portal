'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useCart } from '@/components/cart/useCart'
import { AvailabilityBadge } from './AvailabilityBadge'
import { VariantPicker, type ColourOption, type VariantRow } from './VariantPicker'
import { computeOrderBreakdown } from '@/lib/pricing/pricingMath'
import { PriceBreakdown } from '@/components/pricing/PriceBreakdown'
import { ProductImageGallery, type GalleryImage, type GalleryOverlay } from './ProductImageGallery'
import { VariantlessSizeGrid } from './VariantlessSizeGrid'
import { CatalogueTopBar } from './CatalogueTopBar'
import type { DecorationOption } from '@/lib/shop/decorations'
import {
  filterDecorationsBySwatch,
  resolveDecorationsForPricing,
} from '@/lib/shop/decoration-filter'
import type { CartLineBracket, CartLineDecoration } from '@/lib/cart/types'
import { useCurrency } from '@/contexts/CurrencyContext'
import { pickPreferredGalleryImageUrl } from '@/lib/shop/catalogue-images'
import { PILL_LABELS } from '@/lib/shop/fulfilment-mode'
import type { VariantAvailability } from '@/lib/shop/variant-availability'

type FulfilmentType = 'stocked' | 'made_to_order' | 'mixed'
type CustomerRole = 'org_admin' | 'staff'
type OrderIntent = 'inventory' | 'bulk'

interface ProductData {
  id: string
  name: string
  description: string | null
  image_url: string | null
  moq: number | null
  lead_time_days: number | null
  sizing_type: string | null
  decoration_methods: string[] | null
  decoration_price: number | null
  sku: string | null
  safety_standard: string | null
  specs: Record<string, unknown> | null
  supports_labels: boolean | null
  garment_family: string | null
  default_sizes: string[] | null
  fulfilment_type: FulfilmentType
  brand_name: string | null
  category_name: string | null
  // Phase 2 — catalogue-item identity (named to avoid colliding with the
  // size/colour `variantLabel` on CartLine). Null for legacy/non-catalogue.
  catalogueItemId: string | null
  catalogueVariantLabel: string | null
  // Manual-final pricing (2026-06-10). 'manual_final' => decoration is ONE
  // combined figure per band for the whole item (read from the engine), not a
  // per-placement sum, and the garment is already tier-exact. Optional: absent =>
  // treated as 'computed' (today's path), so a missing wiring can never
  // accidentally make an item manual.
  priceMode?: 'computed' | 'manual_final'
  // Manual-final: combined decoration figure per canonical breakpoint, resolved
  // server-side. Seeds the PDP so the right decoration shows on first paint,
  // independent of the client decoration-pricing fetch. Absent for computed.
  manualDecorationSeed?: Record<number, number>
}

interface Bracket {
  min_quantity: number
  max_quantity: number | null
  unit_price: number
}

interface PricingResponse {
  unit_price: number
  total: number
  status: 'ok' | 'missing'
  bracket: { min_quantity: number; max_quantity: number | null } | null
}

interface Props {
  product: ProductData
  variants: VariantRow[]
  brackets: Bracket[]
  /**
   * variant_id → { available_qty, allow_order_without_stock }. Only populated
   * for variants the org tracks; key presence still signals "tracked". The
   * flag lets a zero-stock variant remain orderable (line becomes
   * make_to_stock, surfaces an "Available to order" chip on the size grid).
   */
  availability: Record<string, VariantAvailability>
  organizationId: string
  customerRole: CustomerRole
  images: GalleryImage[]
  colourOptions?: ColourOption[]
  decorations: DecorationOption[]
  /**
   * Customer-effective MOQ: `b2b_catalogue_items.moq_override ?? products.moq ?? 1`.
   * Applies uniformly across stocked / MTO / mixed and across single / multi-size —
   * "stocked = no MOQ" was an unintentional collapse pre-2026-05-22.
   */
  effectiveMoq: number
  /**
   * Pre-order: item is pre_order fulfilment type but there is no currently open
   * ordering period for this org. When true, the add-to-cart button is disabled
   * with a "Ordering opens with the next window" message.
   */
  preOrderClosed?: boolean
}

export function ProductDetailClient({
  product,
  variants,
  brackets,
  availability,
  customerRole,
  images,
  colourOptions = [],
  decorations,
  effectiveMoq,
  preOrderClosed = false,
}: Props) {
  const cart = useCart()
  const { format } = useCurrency()

  const firstVariant = variants[0] ?? null
  const [colorSwatchId, setColorSwatchId] = useState<string | null>(
    firstVariant?.color_swatch_id ?? colourOptions[0]?.id ?? null
  )
  const [sizeId, setSizeId] = useState<number | null>(firstVariant?.size_id ?? null)
  // Qty per variant_id. Survives colour-switches so the user can build a
  // multi-variant order (e.g. 50 of Black M + 30 of White L) in a single PDP
  // session without losing entries when they flip swatches. Cross-colour
  // composition is intentional 2026-05-14 — the order-summary panel below
  // surfaces everything that's been touched.
  const [variantQuantities, setVariantQuantities] = useState<Record<string, number>>({})
  const [orderIntent, setOrderIntent] = useState<OrderIntent>('inventory')

  type SizingMode = 'multi_size_with_variants' | 'multi_size_variantless' | 'one_size'

  const sizingMode: SizingMode = useMemo(() => {
    if (product.sizing_type === 'one_size') return 'one_size'
    if (variants.length > 0) return 'multi_size_with_variants'
    return 'multi_size_variantless'
  }, [product.sizing_type, variants.length])

  // Back-compat alias for the existing variant-driven render paths. True only
  // when we still have product_variants to drive the colour×size grid.
  const multiSize = sizingMode === 'multi_size_with_variants'

  // Sizes for the variantless grid — empty when not in that mode.
  const variantlessSizes = useMemo<string[]>(
    () => (sizingMode === 'multi_size_variantless' ? product.default_sizes ?? [] : []),
    [sizingMode, product.default_sizes],
  )

  // qty state for variantless multi-size — keyed by size label since there
  // are no variant UUIDs to key on.
  const [variantlessQtyBySize, setVariantlessQtyBySize] = useState<Record<string, number>>({})

  const variantlessTotalQty = useMemo(() => {
    let sum = 0
    for (const n of Object.values(variantlessQtyBySize)) sum += n
    return sum
  }, [variantlessQtyBySize])

  const selectedVariant = useMemo(
    () =>
      variants.find(
        (v) => v.color_swatch_id === colorSwatchId && v.size_id === sizeId
      ) ?? null,
    [variants, colorSwatchId, sizeId]
  )

  const tracksThisVariant =
    selectedVariant != null && availability[selectedVariant.variant_id] !== undefined
  const availableQty = selectedVariant
    ? availability[selectedVariant.variant_id]?.available_qty
    : undefined
  const selectedVariantBackorderable =
    selectedVariant != null &&
    availability[selectedVariant.variant_id]?.allow_order_without_stock === true
  const isOutOfStock = tracksThisVariant && (availableQty ?? 0) === 0

  // Total in-stock across every size for the currently selected colour.
  // Drives the AvailabilityBadge in multi-size mode so customers see "240
  // available" for Black, not "8 available" because S happens to be the
  // selected size.
  const colourTotalAvailable = useMemo<number | undefined>(() => {
    if (!colorSwatchId) return undefined
    let total = 0
    let tracked = false
    for (const v of variants) {
      if (v.color_swatch_id !== colorSwatchId) continue
      const a = availability[v.variant_id]
      if (a === undefined) continue
      tracked = true
      total += a.available_qty
    }
    return tracked ? total : undefined
  }, [variants, colorSwatchId, availability])

  const sizeRowsForColour = useMemo(() => {
    return variants
      .filter((v) => v.color_swatch_id === colorSwatchId && v.size_id != null)
      .map((v) => {
        const a = availability[v.variant_id]
        const tracked = a !== undefined
        return {
          variantId: v.variant_id,
          sizeId: v.size_id as number,
          sizeLabel: v.size_label ?? '',
          sizeOrder: v.size_order,
          available: tracked ? a.available_qty : null,
          allowOrderWithoutStock: tracked ? a.allow_order_without_stock : false,
        }
      })
      .sort((a, b) => a.sizeOrder - b.sizeOrder)
  }, [variants, colorSwatchId, availability])

  // Backorderable variants count as "has inventory" for the gate that
  // unlocks the From-Stock vs Made-to-Order toggle and lets the customer
  // proceed past stock guards — even though zero stock is on hand.
  const currentSelectionHasInventory = useMemo(() => {
    if (sizingMode === 'multi_size_with_variants') {
      return sizeRowsForColour.some(
        (row) => (row.available ?? 0) > 0 || row.allowOrderWithoutStock,
      )
    }
    if (!selectedVariant) return false
    const a = availability[selectedVariant.variant_id]
    if (!a) return false
    return a.available_qty > 0 || a.allow_order_without_stock
  }, [sizingMode, sizeRowsForColour, selectedVariant, availability])

  // The order-mode toggle is offered to an org_admin looking at a product that
  // BOTH has stock for the current selection AND has volume tiers — i.e. it can
  // be drawn from inventory OR reordered in bulk. We deliberately do NOT require
  // fulfilment_type === 'mixed': a 'mixed' product satisfies this naturally when
  // it holds stock, and gating on 'mixed' silently hid the toggle from
  // made_to_order items that DO carry tracked stock (regression 2026-06-03).
  // With no tiers there is nothing to reorder against; restricted members can
  // only ever draw from stock by role — neither case shows a toggle.
  //
  // A 'stocked' product is inventory-only by definition (pillsFor → only
  // 'from_inventory') and isInventoryMode is hard-forced true for it below, so a
  // toggle could never actually switch it into reorder/bulk. Offering one
  // produced an INERT Reorder pill that left the size table filtered to
  // in-stock-only — "Reorder doesn't reveal sizes" (Symptom 1+2, 2026-06-03).
  // Excluding stocked here means it shows no toggle and stays inventory-only.
  const isOrgAdminViewer = customerRole === 'org_admin'
  const canChooseOrderIntent =
    isOrgAdminViewer &&
    product.fulfilment_type !== 'stocked' &&
    currentSelectionHasInventory &&
    brackets.length > 0

  // True whenever this order will be fulfilled from existing stock rather than
  // a new production run: a buyer (stock-only by role), a stocked product with
  // no volume tiers, or an org_admin who has toggled to "From Stock". In every
  // case the PDP hides bulk-order artefacts (volume pricing + lead time) and
  // the Add-to-cart guard blocks ordering beyond available stock.
  const isInventoryMode =
    !isOrgAdminViewer ||
    product.fulfilment_type === 'stocked' ||
    (currentSelectionHasInventory && brackets.length === 0) ||
    (canChooseOrderIntent && orderIntent === 'inventory')

  // Org_admin drawing From inventory may overflow a size's available stock:
  // the in-stock units are drawn down and the shortfall becomes a production
  // run. Restricted staff and stocked-only products are NOT in scope; they
  // keep the hard cap at available stock (inventoryIntentShortfall below).
  const isInventoryOverflowScope = canChooseOrderIntent && orderIntent === 'inventory'

  // From-inventory mode (spec Item 3) applied to the multi-size variant table:
  // show ONLY sizes with a tracked, in-stock quantity for the current colour,
  // and drop the "Available" status column below. Reorder/MTO mode is
  // unchanged; CartTable remains the oversell net.
  const visibleSizeRows = isInventoryMode
    ? sizeRowsForColour.filter((row) => row.available !== null && row.available > 0)
    : sizeRowsForColour

  // MOQ exists to make a new production run economical — it does not apply when
  // drawing down stock that has already been made. In inventory mode the only
  // ceiling is available stock (enforced by the shortfall guard), so the
  // effective minimum drops to 1. `effectiveMoq` (the product's MOQ) is left
  // intact and still applies the moment the order becomes Made to Order.
  const activeMoq = isInventoryMode ? 1 : effectiveMoq

  // Grand total across every colour the user has touched in this session,
  // not just the currently-displayed colour. Drives pricing tier + Add to cart.
  const multiSizeTotalQty = useMemo(() => {
    let sum = 0
    for (const n of Object.values(variantQuantities)) sum += n
    return sum
  }, [variantQuantities])

  // Total for the currently-displayed colour only — used for the grid's per-
  // colour subtotal so the user can see what's queued under the active swatch.
  const currentColourTotalQty = useMemo(() => {
    return sizeRowsForColour.reduce(
      (sum, row) => sum + (variantQuantities[row.variantId] ?? 0),
      0,
    )
  }, [sizeRowsForColour, variantQuantities])

  // Are there qtys queued under colours other than the currently-displayed one?
  const otherColoursTotalQty = multiSizeTotalQty - currentColourTotalQty

  // Resolved per-variant lines for every variant the user has touched in this
  // session, across all colours. Drives the order-summary panel between the
  // size grid and the price block.
  const orderLines = useMemo(() => {
    return variants
      .filter((v) => (variantQuantities[v.variant_id] ?? 0) > 0)
      .map((v) => {
        const qtyLine = variantQuantities[v.variant_id] ?? 0
        const a = availability[v.variant_id]
        const tracked = a !== undefined
        const stocked = tracked ? a.available_qty : 0
        const backorderable = tracked && a.allow_order_without_stock
        const forceBulkOrder = canChooseOrderIntent && orderIntent === 'bulk'
        // Backorderable variant behaves like the bulk path at line level —
        // entire qty goes to production, none drawn from stock — even though
        // it's a tracked SKU. Matches the "make_to_stock" cart fulfilment.
        const treatAsBulk = forceBulkOrder || backorderable
        const inStock = treatAsBulk ? 0 : tracked ? Math.min(qtyLine, stocked) : 0
        const toBeMade = treatAsBulk
          ? qtyLine
          : tracked
            ? Math.max(0, qtyLine - stocked)
            : qtyLine
        return {
          variantId: v.variant_id,
          colourLabel: v.color_label ?? '',
          sizeLabel: v.size_label ?? '',
          qty: qtyLine,
          inStock,
          toBeMade,
          tracked,
        }
      })
  }, [variants, variantQuantities, availability, canChooseOrderIntent, orderIntent])

  const defaultMinQty = activeMoq
  const [singleQty, setSingleQty] = useState<number>(defaultMinQty)
  const qty =
    sizingMode === 'multi_size_with_variants'
      ? multiSizeTotalQty
      : sizingMode === 'multi_size_variantless'
        ? variantlessTotalQty
        : singleQty
  const setQty = setSingleQty

  // Total units that exceed available stock across every touched variant - the
  // production ("to be made") portion of a From-inventory order. Summed per
  // product to match the server-side MOQ rollup (lib/checkout/submit.ts). Only
  // meaningful inside isInventoryOverflowScope.
  const toBeMadeSum = useMemo(() => {
    if (!isInventoryOverflowScope) return 0
    if (sizingMode === 'multi_size_with_variants') {
      return orderLines.reduce((sum, line) => sum + line.toBeMade, 0)
    }
    // one_size: a single selected variant.
    if (selectedVariant) {
      const avail = availability[selectedVariant.variant_id]?.available_qty ?? 0
      return Math.max(0, qty - avail)
    }
    return 0
  }, [
    isInventoryOverflowScope,
    sizingMode,
    orderLines,
    selectedVariant,
    availability,
    qty,
  ])

  useEffect(() => {
    setSingleQty((q) => Math.max(defaultMinQty, q))
  }, [defaultMinQty])

  const [pricing, setPricing] = useState<PricingResponse | null>(null)
  const [pricingLoading, setPricingLoading] = useState(false)
  const priceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Decoration prices keyed by qty bucket: { [qty]: { [linkId]: unitPrice } }
  // Populated for: every bracket's min_quantity + the current qty.
  // For decorations without recalcInputs (embroidery + legacy), the static
  // d.unitPrice is used as a fallback.
  const [decorationPricesByQty, setDecorationPricesByQty] = useState<
    Record<number, Record<string, number>>
  >({})
  // Manual-final: the item's ONE combined decoration figure per probed qty
  // (engine value, no per-placement breakdown). Seeded server-side at the
  // canonical breakpoints so the PDP is correct on first paint; the client fetch
  // below refines it for other qtys. Empty unless price_mode is manual.
  const [manualDecorationByQty, setManualDecorationByQty] = useState<
    Record<number, number>
  >(product.manualDecorationSeed ?? {})
  const isManualPricing = product.priceMode === 'manual_final'
  const decorationPriceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (priceTimer.current) clearTimeout(priceTimer.current)
    if (!Number.isInteger(qty) || qty <= 0) {
      setPricingLoading(false)
      return
    }
    const controller = new AbortController()
    let cancelled = false
    setPricingLoading(true)
    priceTimer.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/shop/pricing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ product_id: product.id, qty }),
          signal: controller.signal,
        })
        if (res.ok && !cancelled) {
          setPricing((await res.json()) as PricingResponse)
        }
      } catch (error) {
        if (!cancelled && error instanceof Error && error.name !== 'AbortError') {
          setPricing(null)
        }
      } finally {
        if (cancelled) return
        setPricingLoading(false)
      }
    }, 300)
    return () => {
      cancelled = true
      controller.abort()
      if (priceTimer.current) clearTimeout(priceTimer.current)
    }
  }, [qty, product.id])

  useEffect(() => {
    const recalcItems = decorations
      .filter((d) => d.recalcInputs != null)
      .map((d) => ({
        linkId: d.linkId,
        placementKey: d.recalcInputs!.placementKey,
        colourCount: d.recalcInputs!.colourCount,
      }))
    // Manual-final items need the combined decoration figure regardless of
    // per-placement recalc inputs — it's resolved from the catalogue item id, not
    // from placement/colour-count. Without this a manual item whose decoration
    // has no recalcInputs (e.g. embroidery, or a manually-attached decoration)
    // would never fetch the combined and the PDP would show $0 decoration.
    if (recalcItems.length === 0 && !isManualPricing) return
    if (!Number.isInteger(qty) || qty <= 0) return

    // Probe each bracket's representative qty, the standard screen-print
    // qty ladder (so we capture the decoration's own band breakpoints even
    // when the item has no garment-tier ladder), plus the current qty.
    // The cart snapshots these as `decoration.brackets` so qty edits in the
    // cart re-pick decoration price the same way they re-pick garment price.
    // qty=1 is excluded for symmetry with the garment brackets — printed
    // gear's commercial floor is qty 24.
    const DECORATION_PROBE_BREAKPOINTS = [24, 50, 100, 250, 500, 1000]
    const probeQtys = Array.from(
      new Set(
        [
          ...brackets.map((b) => b.min_quantity),
          ...DECORATION_PROBE_BREAKPOINTS,
          qty,
        ].filter((q) => q >= 1),
      ),
    )

    if (decorationPriceTimer.current) clearTimeout(decorationPriceTimer.current)
    const controller = new AbortController()
    let cancelled = false
    decorationPriceTimer.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/shop/decoration-pricing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            qtys: probeQtys,
            items: recalcItems,
            catalogueItemId: product.catalogueItemId,
          }),
          signal: controller.signal,
        })
        if (res.ok && !cancelled) {
          const json = (await res.json()) as {
            pricesByQty: Record<string, Record<string, number | null>>
            manualByQty?: Record<string, number | null>
          }
          const resolved: Record<number, Record<string, number>> = {}
          for (const [qStr, links] of Object.entries(json.pricesByQty ?? {})) {
            const q = Number(qStr)
            const inner: Record<string, number> = {}
            for (const [linkId, price] of Object.entries(links)) {
              if (price != null) inner[linkId] = price
            }
            resolved[q] = inner
          }
          setDecorationPricesByQty(resolved)
          // Manual-final combined figure per qty (null for computed items).
          // Merge over the server seed so a sparse/failed fetch never wipes the
          // first-paint values; fresher fetched values win per qty.
          const manualResolved: Record<number, number> = {}
          for (const [qStr, combined] of Object.entries(json.manualByQty ?? {})) {
            if (combined != null && Number.isFinite(Number(combined))) {
              manualResolved[Number(qStr)] = Number(combined)
            }
          }
          if (Object.keys(manualResolved).length > 0) {
            setManualDecorationByQty((prev) => ({ ...prev, ...manualResolved }))
          }
        }
      } catch {
        // network error — keep existing prices
      }
    }, 300)
    return () => {
      cancelled = true
      controller.abort()
      if (decorationPriceTimer.current) clearTimeout(decorationPriceTimer.current)
    }
  }, [qty, decorations, brackets, isManualPricing])

  const [toast, setToast] = useState<string | null>(null)

  const selectedLinkIds = useMemo<ReadonlySet<string>>(
    () => new Set(decorations.map((d) => d.linkId)),
    [decorations],
  )

  const swatchVisibleDecorations = useMemo(
    () => filterDecorationsBySwatch(decorations, colorSwatchId),
    [decorations, colorSwatchId],
  )

  const visibleDecorations = useMemo(
    () => swatchVisibleDecorations.filter((d) => selectedLinkIds.has(d.linkId)),
    [swatchVisibleDecorations, selectedLinkIds],
  )

  const pickerColourOptions = useMemo(() => {
    if (colourOptions.length === 0) return undefined
    if (decorations.length === 0) return colourOptions

    const allColourDecoration = decorations.some((d) => d.snapshotColorSwatchId == null)
    if (allColourDecoration) return colourOptions

    const publishedSwatchIds = new Set(
      decorations
        .map((d) => d.snapshotColorSwatchId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    )
    if (publishedSwatchIds.size === 0) return colourOptions

    return colourOptions.filter((colour) => publishedSwatchIds.has(colour.id))
  }, [colourOptions, decorations])

  const pricedDecorations = useMemo(
    () =>
      resolveDecorationsForPricing(
        decorations.filter((d) => selectedLinkIds.has(d.linkId)),
        colorSwatchId,
      ),
    [decorations, selectedLinkIds, colorSwatchId],
  )

  const galleryOverlays = useMemo<GalleryOverlay[]>(
    () =>
      visibleDecorations.flatMap((d) =>
        d.overlay
          ? [
              {
                linkId: d.linkId,
                imageId: d.overlay.imageId,
                rect: d.overlay.rect,
                placement: d.overlay.placement,
                artworkUrl: d.overlay.artworkUrl,
              },
            ]
          : [],
      ),
    [visibleDecorations],
  )

  const galleryDecorationImages = useMemo(
    () =>
      swatchVisibleDecorations.map((d) => ({
        id: d.linkId,
        url: d.artworkUrl,
        label: d.positionLabel ? `${d.name} - ${d.positionLabel}` : d.name,
        alt: `${d.name} artwork`,
      })),
    [swatchVisibleDecorations],
  )

  // Resolve decoration unit price for a specific qty (falls back to static unitPrice
  // for embroidery / legacy rows / cache miss).
  const decorationPriceAt = useMemo(
    () => (linkId: string, atQty: number, fallback: number) =>
      decorationPricesByQty[atQty]?.[linkId] ?? fallback,
    [decorationPricesByQty],
  )

  // Manual-final: the item's ONE combined decoration figure at a given qty.
  // Exact probe key when present; else the highest probed band <= qty (mirrors a
  // band pick); 0 before the fetch resolves.
  const manualDecorationAt = useMemo(
    () =>
      (atQty: number): number => {
        if (manualDecorationByQty[atQty] != null) return manualDecorationByQty[atQty]
        const mins = Object.keys(manualDecorationByQty)
          .map(Number)
          .filter((n) => Number.isFinite(n))
          .sort((a, b) => a - b)
        let val = 0
        for (const m of mins) {
          if (m <= atQty) val = manualDecorationByQty[m]
          else break
        }
        return val
      },
    [manualDecorationByQty],
  )

  // Manual decoration is charged only when the line actually carries decorations
  // (a customer who deselects every placement pays no decoration). The server
  // applies the same gate so cart and submit agree.
  const hasPricedDecorations = pricedDecorations.length > 0

  const decorationPerUnit = useMemo(
    () =>
      isManualPricing
        ? hasPricedDecorations
          ? manualDecorationAt(qty)
          : 0
        : pricedDecorations.reduce(
            (s, d) => s + decorationPriceAt(d.linkId, qty, d.unitPrice),
            0,
          ),
    [isManualPricing, hasPricedDecorations, manualDecorationAt, pricedDecorations, decorationPriceAt, qty],
  )

  // For rendering volume bracket rows: combined decoration at that bracket's qty.
  const decorationPerUnitAtBracket = useMemo(
    () =>
      brackets.map((b) =>
        isManualPricing
          ? hasPricedDecorations
            ? manualDecorationAt(b.min_quantity)
            : 0
          : pricedDecorations.reduce(
              (s, d) => s + decorationPriceAt(d.linkId, b.min_quantity, d.unitPrice),
              0,
            ),
      ),
    [brackets, isManualPricing, hasPricedDecorations, manualDecorationAt, pricedDecorations, decorationPriceAt],
  )

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  function handleAddToCart() {
    if (!pricing || pricing.status !== 'ok') return
    const selectedDecorations = decorations.filter((d) => selectedLinkIds.has(d.linkId))

    // Build a per-decoration qty-band ladder from `decorationPricesByQty` so
    // the cart can re-tier deco price on qty edit (same shape as the garment
    // brackets snapshot). Two-pass collapse: drop runs where the price
    // equals the previous kept point, then size each band by the NEXT kept
    // point's qty minus one. Naive collapse (skip-but-don't-extend) would
    // leave gaps — e.g. probes at qty 1 and qty 24 sharing a price → band
    // (1, 23) and the next band starting at 50 → qty 24-49 falls in no band
    // and pickBracket returns null on cart edits, which makes the cart's
    // decoration unit price get stuck at the previous tier's value.
    // Returns undefined when we have no probe data (legacy decorations
    // without recalcInputs) — cart will leave unitPrice frozen and the
    // server will re-price on submit either way.
    const buildDecorationBrackets = (linkId: string): CartLineBracket[] | undefined => {
      const probeMins = Object.keys(decorationPricesByQty)
        .map((s) => Number(s))
        .filter((n) => Number.isFinite(n) && n >= 1)
        .sort((a, b) => a - b)
      const points: Array<{ min: number; price: number }> = []
      for (const min of probeMins) {
        const price = decorationPricesByQty[min]?.[linkId]
        if (price != null) points.push({ min, price })
      }
      if (points.length === 0) return undefined
      const interesting: Array<{ min: number; price: number }> = []
      for (const p of points) {
        const last = interesting[interesting.length - 1]
        if (!last || last.price !== p.price) interesting.push(p)
      }
      const bands = interesting.map((p, i) => ({
        minQty: p.min,
        maxQty: i + 1 < interesting.length ? interesting[i + 1].min - 1 : null,
        unitPrice: p.price,
      }))
      return bands.length > 0 ? bands : undefined
    }

    // Manual-final: the LINE-level combined decoration ladder (one figure per
    // band for the whole item). Same two-pass collapse as the per-placement
    // builder above, applied to the combined `manualDecorationByQty`.
    const buildManualDecorationBrackets = (): CartLineBracket[] | undefined => {
      const probeMins = Object.keys(manualDecorationByQty)
        .map((s) => Number(s))
        .filter((n) => Number.isFinite(n) && n >= 1)
        .sort((a, b) => a - b)
      const points: Array<{ min: number; price: number }> = []
      for (const min of probeMins) {
        const price = manualDecorationByQty[min]
        if (price != null) points.push({ min, price })
      }
      if (points.length === 0) return undefined
      const interesting: Array<{ min: number; price: number }> = []
      for (const p of points) {
        const last = interesting[interesting.length - 1]
        if (!last || last.price !== p.price) interesting.push(p)
      }
      const bands = interesting.map((p, i) => ({
        minQty: p.min,
        maxQty: i + 1 < interesting.length ? interesting[i + 1].min - 1 : null,
        unitPrice: p.price,
      }))
      return bands.length > 0 ? bands : undefined
    }

    // Line-level manual decoration snapshot (null/undefined for computed items,
    // or manual items with no decoration selected — no decoration billed then).
    // Only snapshot a concrete figure once the combined fetch has resolved; if it
    // hasn't (sub-debounce add / fetch error), snapshot null so the server
    // silently re-prices from the engine rather than us claiming a stale 0 that
    // would trip the zero-tolerance drift guard at checkout.
    const manualDecorationActive = isManualPricing && selectedDecorations.length > 0
    const hasManualData = Object.keys(manualDecorationByQty).length > 0
    const manualDecorationPerUnitSnapshot =
      manualDecorationActive && hasManualData ? manualDecorationAt(qty) : null
    const manualDecorationBracketsSnapshot =
      manualDecorationActive && hasManualData ? buildManualDecorationBrackets() : undefined

    const cartDecorationsForSwatch = (swatchId: string | null): CartLineDecoration[] =>
      resolveDecorationsForPricing(selectedDecorations, swatchId).map((d) => ({
        linkId: d.linkId,
        decorationId: d.decorationId,
        name: d.name,
        method: d.method,
        positionLabel: d.positionLabel,
        // Manual items: per-placement price is not individually billed (the line
        // carries one combined figure). Snapshot 0 so any accidental fallback to
        // the per-placement sum yields 0, never a wrong positive number.
        unitPrice: isManualPricing ? 0 : decorationPriceAt(d.linkId, qty, d.unitPrice),
        artworkUrl: d.artworkUrl,
        snapshotUrl: d.snapshotUrl,
        brackets: isManualPricing ? undefined : buildDecorationBrackets(d.linkId),
      }))
    const cartImageForSwatch = (swatchId: string | null): string | null =>
      pickPreferredGalleryImageUrl(images, swatchId, product.image_url)
    const cartLineBrackets: CartLineBracket[] = brackets.map((b) => ({
      minQty: b.min_quantity,
      maxQty: b.max_quantity,
      unitPrice: b.unit_price,
    }))

    // Mode 1: existing multi-size with variants — one cart line per touched variant.
    if (sizingMode === 'multi_size_with_variants') {
      let added = 0
      for (const variant of variants) {
        const lineQty = variantQuantities[variant.variant_id] ?? 0
        if (lineQty <= 0) continue
        const variantLabel =
          [variant.color_label, variant.size_label].filter(Boolean).join(' / ') || '—'
        const a = availability[variant.variant_id]
        const tracked = a !== undefined
        const available = tracked ? a.available_qty : 0
        const backorderable = tracked && a.allow_order_without_stock
        const baseLine = {
          productId: product.id,
          productName: product.name,
          variantId: variant.variant_id,
          variantLabel,
          unitPrice: pricing.unit_price,
          imageUrl: cartImageForSwatch(variant.color_swatch_id),
          decorations: cartDecorationsForSwatch(variant.color_swatch_id),
          brackets: cartLineBrackets,
          catalogueItemId: product.catalogueItemId,
          catalogueVariantLabel: product.catalogueVariantLabel,
          manualDecorationPerUnit: manualDecorationPerUnitSnapshot,
          manualDecorationBrackets: manualDecorationBracketsSnapshot,
        }

        // Org_admin From-inventory overflow: split a partial-stock variant into
        // a stocked draw + a make_to_stock production line. The server MOQ
        // engine then counts only the production portion and inventory draws
        // only the stocked portion. lineSignature keys on fulfilmentType, so
        // the two lines never merge in the cart.
        if (
          isInventoryOverflowScope &&
          tracked &&
          !backorderable &&
          lineQty > available
        ) {
          if (available > 0) {
            cart.addLine({ ...baseLine, qty: available, fulfilmentType: 'stocked' })
          }
          cart.addLine({
            ...baseLine,
            qty: lineQty - available,
            fulfilmentType: 'make_to_stock',
          })
          added += lineQty
          continue
        }

        // Fulfilment decision (unchanged): toggle choice wins for org_admin;
        // buyer/no-toggle auto-routes backorderable to make_to_stock, else
        // stock-vs-qty.
        const fulfilmentType: 'stocked' | 'make_to_stock' = canChooseOrderIntent
          ? orderIntent === 'bulk'
            ? 'make_to_stock'
            : 'stocked'
          : backorderable
            ? 'make_to_stock'
            : tracked && lineQty > available
              ? 'make_to_stock'
              : 'stocked'
        cart.addLine({ ...baseLine, qty: lineQty, fulfilmentType })
        added += lineQty
      }
      if (added > 0) {
        setVariantQuantities({})
        showToast(`Added ${added} item${added === 1 ? '' : 's'} to cart`)
      }
      return
    }

    // Mode 2: variantless multi-size — one cart line per touched size.
    // variant_id='' sentinel; size string is the only label; product_name gets
    // the size suffix so it surfaces in /tracking + Monday subitems without
    // parsing customizations jsonb.
    if (sizingMode === 'multi_size_variantless') {
      let added = 0
      for (const size of variantlessSizes) {
        const lineQty = variantlessQtyBySize[size] ?? 0
        if (lineQty <= 0) continue
        cart.addLine({
          productId: product.id,
          productName: `${product.name} — ${size}`,
          variantId: '',
          variantLabel: size,
          qty: lineQty,
          unitPrice: pricing.unit_price,
          imageUrl: cartImageForSwatch(colorSwatchId),
          decorations: cartDecorationsForSwatch(colorSwatchId),
          fulfilmentType: 'make_to_stock',
          brackets: cartLineBrackets,
          catalogueItemId: product.catalogueItemId,
          catalogueVariantLabel: product.catalogueVariantLabel,
          manualDecorationPerUnit: manualDecorationPerUnitSnapshot,
          manualDecorationBrackets: manualDecorationBracketsSnapshot,
        })
        added += lineQty
      }
      if (added > 0) {
        setVariantlessQtyBySize({})
        showToast(`Added ${added} item${added === 1 ? '' : 's'} to cart`)
      }
      return
    }

    // Mode 3: one_size — single cart line, no variant. Same fulfilment
    // decision as multi-size: toggle choice wins when present (PDP shortfall
    // already enforced From-Stock vs zero-stock); buyer flow auto-routes
    // backorderable to make_to_stock.
    // Mode 3 org_admin From-inventory overflow: split into a stocked draw + a
    // make_to_stock production line, mirroring Mode 1.
    if (
      isInventoryOverflowScope &&
      tracksThisVariant &&
      !selectedVariantBackorderable &&
      qty > (availableQty ?? 0)
    ) {
      const avail = availableQty ?? 0
      const oneSizeBase = {
        productId: product.id,
        productName: product.name,
        variantId: '',
        variantLabel: '—',
        unitPrice: pricing.unit_price,
        imageUrl: cartImageForSwatch(colorSwatchId),
        decorations: cartDecorationsForSwatch(colorSwatchId),
        brackets: cartLineBrackets,
        catalogueItemId: product.catalogueItemId,
        catalogueVariantLabel: product.catalogueVariantLabel,
        manualDecorationPerUnit: manualDecorationPerUnitSnapshot,
        manualDecorationBrackets: manualDecorationBracketsSnapshot,
      }
      if (avail > 0) {
        cart.addLine({ ...oneSizeBase, qty: avail, fulfilmentType: 'stocked' })
      }
      cart.addLine({
        ...oneSizeBase,
        qty: qty - avail,
        fulfilmentType: 'make_to_stock',
      })
      showToast('Added to cart')
      return
    }

    const oneSizeFulfilment: 'stocked' | 'make_to_stock' = canChooseOrderIntent
      ? orderIntent === 'bulk'
        ? 'make_to_stock'
        : 'stocked'
      : selectedVariantBackorderable
        ? 'make_to_stock'
        : tracksThisVariant && qty > (availableQty ?? 0)
          ? 'make_to_stock'
          : 'stocked'
    cart.addLine({
      productId: product.id,
      productName: product.name,
      variantId: '',
      variantLabel: '—',
      qty,
      unitPrice: pricing.unit_price,
      imageUrl: cartImageForSwatch(colorSwatchId),
      decorations: cartDecorationsForSwatch(colorSwatchId),
      fulfilmentType: oneSizeFulfilment,
      brackets: cartLineBrackets,
      catalogueItemId: product.catalogueItemId,
      catalogueVariantLabel: product.catalogueVariantLabel,
      manualDecorationPerUnit: manualDecorationPerUnitSnapshot,
      manualDecorationBrackets: manualDecorationBracketsSnapshot,
    })
    showToast('Added to cart')
  }

  const priceMissing = pricing != null && pricing.status === 'missing'
  const meetsMoq = qty >= activeMoq
  const pricingOk = pricing != null && pricing.status === 'ok' && !priceMissing
  const canAddToCart =
    sizingMode === 'multi_size_with_variants'
      ? multiSizeTotalQty > 0 && meetsMoq && pricingOk
      : sizingMode === 'multi_size_variantless'
        ? variantlessTotalQty > 0 && meetsMoq && pricingOk
        : // one_size: no variant selection required
          Number.isInteger(qty) && meetsMoq && pricingOk

  let inventoryIntentShortfall: {
    label: string
    available: number
    backorderable: boolean
  } | null = null
  // Hard cap stays for everyone EXCEPT the org_admin From-inventory overflow
  // scope, where exceeding stock is allowed and routed into a production run.
  if (isInventoryMode && !isInventoryOverflowScope) {
    if (sizingMode === 'multi_size_with_variants') {
      for (const variant of variants) {
        const requested = variantQuantities[variant.variant_id] ?? 0
        if (requested <= 0) continue
        const a = availability[variant.variant_id]
        const backorderable = a?.allow_order_without_stock === true
        // Buyer / no toggle: backorderable variants auto-route to
        // make_to_stock at submit, so there's no useful prompt to surface
        // (customer has no choice to switch). Org_admin with toggle: let
        // the shortfall message fire so they can switch to Made to Order.
        if (backorderable && !canChooseOrderIntent) continue
        const available = a?.available_qty ?? 0
        if (requested > available) {
          const label =
            [variant.color_label, variant.size_label].filter(Boolean).join(' / ') ||
            'selected variant'
          inventoryIntentShortfall = {
            label,
            available,
            backorderable,
          }
          break
        }
      }
    } else if (selectedVariant && qty > (availableQty ?? 0)) {
      // Same rule as multi-size: skip only when the buyer has no toggle.
      if (!(selectedVariantBackorderable && !canChooseOrderIntent)) {
        inventoryIntentShortfall = {
          label: 'selected variant',
          available: availableQty ?? 0,
          backorderable: selectedVariantBackorderable,
        }
      }
    }
  }

  // Production top-up MOQ guard (org_admin From-inventory overflow only). The
  // to-be-made units trigger a production run, which must reach the product's
  // real MOQ. Pure stock draws (toBeMadeSum === 0) are exempt; the server check
  // in lib/checkout/submit.ts is the redundant safety net behind this.
  let madeMoqShortfall: { toBeMade: number; moq: number; needed: number } | null =
    null
  if (
    isInventoryOverflowScope &&
    toBeMadeSum > 0 &&
    effectiveMoq > 1 &&
    toBeMadeSum < effectiveMoq
  ) {
    madeMoqShortfall = {
      toBeMade: toBeMadeSum,
      moq: effectiveMoq,
      needed: effectiveMoq - toBeMadeSum,
    }
  }

  const canSubmitSelection =
    canAddToCart && inventoryIntentShortfall == null && madeMoqShortfall == null &&
    !preOrderClosed

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <div className="mx-auto max-w-[1320px] px-4 pb-16 pt-3 motion-safe:animate-portal-enter md:px-6 md:pt-4">
        <CatalogueTopBar
          crumbs={[
            { label: 'Home', href: '/account' },
            { label: 'Catalogue', href: '/catalogue' },
            { label: product.name },
          ]}
        />
        <div className="mt-6 grid gap-8 lg:grid-cols-[1.05fr_1fr] lg:gap-12">
          {/* Image — soft plate, sticky on desktop */}
          <div className="lg:sticky lg:top-[92px] h-fit">
            <div className="overflow-hidden rounded-[32px] bg-white p-4 md:p-6">
              <ProductImageGallery
                images={images}
                fallbackUrl={product.image_url}
                productName={product.name}
                selectedColorSwatchId={colorSwatchId}
                overlays={galleryOverlays}
                decorationImages={galleryDecorationImages}
              />
            </div>
          </div>

          {/* Info + controls — editorial column */}
          <div className="space-y-8">
            <header>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="font-dm-sans font-medium leading-[1.05] tracking-[-0.02em] text-[clamp(32px,4vw,56px)] text-gray-900">
                  {product.name}
                </h1>
                <AvailabilityBadge
                  availableQty={multiSize ? colourTotalAvailable : availableQty}
                />
                {product.sizing_type && product.sizing_type !== 'multi_size' && (
                  <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-[11px] uppercase tracking-[0.12em] text-gray-600">
                    {product.sizing_type.replace(/_/g, ' ')}
                  </span>
                )}
              </div>
              {product.description && (
                <p className="mt-5 max-w-prose text-base leading-relaxed text-gray-600">
                  {product.description}
                </p>
              )}
              <ProductDetailsCondensed product={product} />
            </header>

          {sizingMode === 'multi_size_with_variants' && (
            <VariantPicker
              variants={variants}
              colorOptions={pickerColourOptions}
              selectedColorSwatchId={colorSwatchId}
              selectedSizeId={sizeId}
              availability={availability}
              showSizePicker={false}
              inStockOnly={isInventoryMode}
              onChange={({ colorSwatchId: c, sizeId: s }) => {
                setColorSwatchId(c)
                setSizeId(s)
              }}
            />
          )}

          {product.lead_time_days != null && !isInventoryMode && (
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-xs text-gray-500">
                Lead time ~{product.lead_time_days} days
              </span>
            </div>
          )}

          {canChooseOrderIntent && (
            <OrderIntentToggle value={orderIntent} onChange={setOrderIntent} />
          )}

          {brackets.length > 0 && !isInventoryMode && (
            <section className="rounded-[24px] bg-white p-6">
              <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-gray-500">
                Volume pricing
              </p>
              <ul className="mt-4 grid grid-cols-2 gap-y-2 text-sm text-gray-700 md:grid-cols-3">
                {brackets.map((b, i) => {
                  const allInUnit = Number(b.unit_price) + (decorationPerUnitAtBracket[i] ?? 0)
                  return (
                    <li key={i} className="tabular-nums">
                      <span className="font-medium text-gray-900">
                        {b.min_quantity}
                        {b.max_quantity ? `–${b.max_quantity}` : '+'}
                      </span>{' '}
                      <span className="text-gray-500">@ {format(allInUnit)}</span>
                    </li>
                  )
                })}
              </ul>
              {pricedDecorations.length > 0 && (
                <p className="mt-3 text-xs text-gray-500">
                  Includes {pricedDecorations.length} decoration
                  {pricedDecorations.length === 1 ? '' : 's'}.
                </p>
              )}
            </section>
          )}

          {multiSize && visibleSizeRows.length > 0 && (
            <section className="overflow-hidden rounded-[24px] bg-white">
              <table className="w-full text-sm">
                <thead className="text-left text-[11px] uppercase tracking-[0.08em] text-gray-500">
                  <tr>
                    <th className="px-5 pt-5 pb-2 font-medium">Size</th>
                    <th className="px-5 pt-5 pb-2 font-medium">Available</th>
                    <th className="px-5 pt-5 pb-2 text-right font-medium">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleSizeRows.map((row) => {
                    const trackedRow = row.available !== null
                    const stocked = trackedRow ? (row.available ?? 0) : 0
                    const value = variantQuantities[row.variantId] ?? 0
                    // Backorderable lines always go to production — surface
                    // the full requested qty as "to be made" rather than
                    // counting the (zero) stock balance against it.
                    const backorder = !trackedRow || row.allowOrderWithoutStock
                      ? value
                      : Math.max(0, value - stocked)
                    const showBackorderableChip =
                      trackedRow && row.allowOrderWithoutStock && stocked === 0
                    return (
                      <tr key={row.variantId} className="border-t border-gray-100">
                        <td className="px-5 py-3 font-medium text-gray-900">{row.sizeLabel}</td>
                        <td className="px-5 py-3 text-xs text-gray-600">
                          {showBackorderableChip ? (
                            <span className="inline-flex rounded-full bg-[rgb(var(--accent-mint))] px-2 py-0.5 text-[10px] font-medium text-[rgb(var(--accent-mint-ink))]">
                              Available to order
                            </span>
                          ) : !trackedRow ? '—' : `${stocked}`}
                          {/* "to be made" is a reorder/MTO concept — qty beyond
                              stock that goes to production. In From-inventory mode
                              the shortfall guard already caps orders at available
                              stock, so we show only the available count there. */}
                          {(!isInventoryMode || isInventoryOverflowScope) && backorder > 0 && !showBackorderableChip && (
                            <span className="ml-1 text-amber-700">
                              ({backorder} to be made)
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={value || ''}
                            placeholder="0"
                            onChange={(e) => {
                              const n = Number(e.target.value)
                              setVariantQuantities((prev) => {
                                const next = { ...prev }
                                if (!Number.isFinite(n) || n <= 0) {
                                  delete next[row.variantId]
                                } else {
                                  next[row.variantId] = Math.floor(n)
                                }
                                return next
                              })
                            }}
                            aria-label={`Quantity for size ${row.sizeLabel}`}
                            className="w-20 rounded-full bg-gray-50 px-3 py-1.5 text-right text-sm tabular-nums focus:bg-white focus:outline-none focus:ring-2 focus:ring-gray-300"
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-200">
                    <td className="px-5 py-3 text-[11px] font-medium uppercase tracking-[0.08em] text-gray-500" colSpan={2}>
                      Total this colour
                    </td>
                    <td className="px-5 py-3 text-right text-sm font-medium text-gray-900 tabular-nums">
                      {currentColourTotalQty}
                    </td>
                  </tr>
                  {otherColoursTotalQty > 0 && (
                    <tr className="border-t border-gray-100">
                      <td className="px-5 py-3 text-xs text-gray-500" colSpan={2}>
                        Order total (across all variants)
                      </td>
                      <td className="px-5 py-3 text-right text-sm font-medium text-gray-900 tabular-nums">
                        {multiSizeTotalQty}
                        <span className="ml-1 text-xs font-normal text-gray-500">
                          (+{otherColoursTotalQty} other colours)
                        </span>
                      </td>
                    </tr>
                  )}
                </tfoot>
              </table>
            </section>
          )}

          {sizingMode === 'multi_size_variantless' && variantlessSizes.length > 0 && (
            <VariantlessSizeGrid
              sizes={variantlessSizes}
              quantities={variantlessQtyBySize}
              onChange={setVariantlessQtyBySize}
            />
          )}

          {activeMoq > 1 && (
            <div className="rounded-2xl bg-amber-50 px-4 py-3 text-xs text-amber-900">
              Minimum order:{' '}
              <span className="font-semibold">{activeMoq} units</span>
              {sizingMode !== 'one_size' ? ' across all sizes' : ''}.
              {sizingMode !== 'one_size' && qty > 0 && qty < activeMoq ? (
                <span className="ml-2 font-medium">
                  Currently {qty} — add {activeMoq - qty} more.
                </span>
              ) : null}
            </div>
          )}
          {multiSize && orderLines.length > 0 && (
            <section className="rounded-[24px] bg-white p-6">
              <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-gray-500">
                Your order
              </p>
              <ul className="mt-4 divide-y divide-gray-100 text-sm">
                {orderLines.map((line) => {
                  const label =
                    [line.colourLabel, line.sizeLabel].filter(Boolean).join(' / ') || '—'
                  return (
                    <li
                      key={line.variantId}
                      className="flex items-baseline justify-between py-2.5"
                    >
                      <span className="text-gray-800">{label}</span>
                      <span className="text-right text-gray-700">
                        <span className="font-medium tabular-nums">{line.qty}</span>
                        {line.tracked && line.toBeMade > 0 && line.inStock > 0 && (
                          <span className="ml-1 text-xs text-gray-500">
                            ({line.inStock} in stock,{' '}
                            <span className="text-amber-700">
                              {line.toBeMade} to be made
                            </span>
                            )
                          </span>
                        )}
                        {line.tracked && line.toBeMade > 0 && line.inStock === 0 && (
                          <span className="ml-1 text-xs text-amber-700">
                            ({line.toBeMade} to be made)
                          </span>
                        )}
                        {!line.tracked && (
                          <span className="ml-1 text-xs text-amber-700">
                            ({line.toBeMade} to be made)
                          </span>
                        )}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          {/* Price + add-to-cart panel — sticky bottom card on desktop scroll */}
          <section className="rounded-[24px] bg-white p-6 md:p-7">
            <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
              {sizingMode === 'one_size' && (
                <div>
                  <label
                    htmlFor="qty"
                    className="block text-[11px] font-medium uppercase tracking-[0.12em] text-gray-500"
                  >
                    Quantity
                  </label>
                  <input
                    id="qty"
                    type="number"
                    min={defaultMinQty}
                    step={1}
                    value={qty}
                    onChange={(e) => setQty(Number(e.target.value))}
                    className="mt-2 w-28 rounded-full bg-gray-50 px-4 py-2 text-sm tabular-nums focus:bg-white focus:outline-none focus:ring-2 focus:ring-gray-300"
                  />
                  {isOutOfStock && (
                    <p className="mt-2 text-xs text-amber-700">
                      Out of stock — {qty} will be made.
                    </p>
                  )}
                </div>
              )}
              <div className="flex-1 md:text-right">
                {pricingLoading ? (
                  <span className="text-sm text-gray-400">Pricing…</span>
                ) : pricing && pricing.status === 'ok' ? (
                  <PriceBreakdown
                    breakdown={computeOrderBreakdown({
                      lines: [
                        {
                          qty,
                          unitEffective: pricing.unit_price,
                          decorationPerUnit,
                        },
                      ],
                      gstRate: 0.15,
                    })}
                    variant="pdp"
                    format={format}
                  />
                ) : pricing && pricing.status === 'missing' ? (
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      Price on request
                    </p>
                    <a
                      href="mailto:hello@theprint-room.co.nz"
                      className="text-[11px] font-medium uppercase tracking-[0.12em] text-gray-500 underline transition-colors hover:text-gray-900"
                    >
                      Contact sales
                    </a>
                  </div>
                ) : (
                  <span className="text-gray-400">—</span>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={handleAddToCart}
              disabled={!canSubmitSelection || pricingLoading}
              className="mt-6 w-full rounded-full bg-gray-900 px-5 py-3 text-sm font-medium text-white transition-all duration-150 hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pricingLoading
                ? 'Checking price...'
                : preOrderClosed
                  ? 'Ordering opens with the next window'
                  : 'Add to cart'}
            </button>
            {inventoryIntentShortfall && (
              <p className="mt-3 text-xs text-amber-700">
                {inventoryIntentShortfall.backorderable && canChooseOrderIntent
                  ? `No available stock for ${inventoryIntentShortfall.label} — select Re-order to order this.`
                  : `Only ${inventoryIntentShortfall.available} available for ${inventoryIntentShortfall.label}. ${
                      canChooseOrderIntent
                        ? 'Switch to Re-order or reduce quantity.'
                        : 'Reduce quantity to order from stock.'
                    }`}
              </p>
            )}
            {isInventoryOverflowScope && toBeMadeSum > 0 && (
              madeMoqShortfall ? (
                <p className="mt-3 text-xs text-amber-700">
                  Production run minimum is {madeMoqShortfall.moq}.{' '}
                  {madeMoqShortfall.toBeMade} to be made — add{' '}
                  {madeMoqShortfall.needed} more, or reduce to draw only from
                  stock.
                </p>
              ) : (
                <p className="mt-3 text-xs text-gray-500">
                  {toBeMadeSum} to be made · production min {effectiveMoq}
                </p>
              )
            )}
          </section>
          </div>
        </div>

        {toast && (
          <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-gray-900 px-5 py-2.5 text-sm font-medium text-white shadow-lg transition-opacity">
            {toast}
          </div>
        )}
      </div>
    </div>
  )
}

function OrderIntentToggle({
  value,
  onChange,
}: {
  value: OrderIntent
  onChange: (value: OrderIntent) => void
}) {
  return (
    <div
      role="group"
      aria-label="Order mode"
      className="grid h-9 w-full grid-cols-2 overflow-hidden rounded-full border border-gray-300 bg-white text-xs font-medium text-gray-700 sm:w-[200px]"
    >
      {(['inventory', 'bulk'] as const).map((mode) => {
        const selected = value === mode
        return (
          <button
            key={mode}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(mode)}
            className={`min-w-0 px-3 transition-colors ${
              selected
                ? 'bg-gray-100 text-gray-950'
                : 'bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-950'
            } ${mode === 'bulk' ? 'border-l border-gray-300' : ''}`}
          >
            {mode === 'inventory' ? PILL_LABELS.from_inventory : PILL_LABELS.reorder}
          </button>
        )
      })}
    </div>
  )
}

function ProductDetailsCondensed({ product }: { product: ProductData }) {
  const rows: { label: string; value: React.ReactNode }[] = []

  if (product.sku) rows.push({ label: 'SKU', value: product.sku })
  if (product.brand_name) rows.push({ label: 'Brand', value: product.brand_name })
  if (product.category_name) rows.push({ label: 'Category', value: product.category_name })

  if (rows.length === 0) return null

  return (
    <dl className="mt-6 grid grid-cols-2 gap-x-8 gap-y-2.5 text-xs">
      {rows.map((r) => (
        <div key={r.label} className="flex flex-col gap-0.5">
          <dt className="text-[10px] font-medium uppercase tracking-[0.12em] text-gray-500">{r.label}</dt>
          <dd className="truncate text-sm text-gray-900">{r.value}</dd>
        </div>
      ))}
    </dl>
  )
}
