'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useCart } from '@/components/cart/useCart'
import {
  QTY_CAP_WARNING_EVENT,
  qtyCapWarningFor,
  type QtyCapWarningDetail,
} from '@/lib/shop/qty-cap'
import { AvailabilityBadge } from './AvailabilityBadge'
import { showsPrepaidStockBadge } from '@/lib/shop/prepaid-tag'
import { VariantPicker, type ColourOption, type VariantRow } from './VariantPicker'
import { computeOrderBreakdown } from '@/lib/pricing/pricingMath'
import type { PreOrderDemand } from '@/lib/pricing/preorder-demand'
import { calculatePeriodSavingsOpportunity } from '@/lib/pricing/period-savings'
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
import { sanitiseCustomName } from '@/lib/cart/custom-name'
import { hideVolumeDisplayBands } from '@/lib/shop/volume-display-bands'
import { useCurrency } from '@/contexts/CurrencyContext'
import { pickPreferredGalleryImageUrl, hiddenViewSetForColour } from '@/lib/shop/catalogue-images'
import { resolveSizingMode, type SizingMode } from '@/lib/shop/sizing-mode'
import {
  PILL_LABELS,
  effectivePermission,
  lineFulfilment,
  lineIsOrderable,
  orderingOptions,
  type LineFulfilmentContext,
  type MemberPermission,
} from '@/lib/shop/fulfilment-mode'
import type { VariantAvailability } from '@/lib/shop/variant-availability'
import type { ImageLayout } from '@/lib/shop/image-layout'

type FulfilmentType = 'stocked' | 'made_to_order' | 'mixed'
type CustomerRole = 'org_admin' | 'staff'
type OrderIntent = 'inventory' | 'bulk'

// SKUCOLLAPSE: composite key for per-(colourway, size) qty state + availability
// lookups. Matches the catalogue page + lib/shop/variant-availability
// availabilityKey (size_id renders '' when null).
const cellKey = (variantId: string, sizeId: number | null) => `${variantId}::${sizeId ?? ''}`

interface SizeOption {
  size_id: number
  size_label: string | null
  size_order: number
}

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

/** Feature 1 — one selectable option for the required PDP location dropdown.
 *  `value` is the org_line_dataset_values.id; `label` is the frozen snapshot. */
type LocationOption = { value: string; label: string }

interface Props {
  product: ProductData
  variants: VariantRow[]
  /** Per-product size list (colourway model) — drives the runtime size picker /
   *  qty grid; size is no longer carried on the variant row. */
  sizes: SizeOption[]
  brackets: Bracket[]
  /**
   * variant_id → { available_qty, allow_order_without_stock }. Only populated
   * for variants the org tracks; key presence still signals "tracked". The
   * flag lets a zero-stock variant remain orderable (line becomes
   * made_to_order, surfaces an "Available to order" chip on the size grid).
   */
  availability: Record<string, VariantAvailability>
  organizationId: string
  customerRole: CustomerRole
  /**
   * The viewing member's stored ordering permission
   * (user_organizations.ordering_permission). org_admin is always elevated to
   * 'both' by effectivePermission regardless of this value.
   */
  orderingPermission: MemberPermission
  images: GalleryImage[]
  /** Effective item layout, resolved once by the server. */
  imageLayout?: ImageLayout
  /**
   * Views staff hid from the customer PDP (b2b_catalogue_item_hidden_views),
   * scoped per (catalogue item, colour). Dropped from the gallery and cart
   * thumbnails for the matching colour. `view` is the canonical token.
   */
  hiddenViewRows?: Array<{ color_swatch_id: string | null; view: string | null }>
  /**
   * Spec 3a — variant_id → billing class (variant_inventory.billing_mode).
   * Drives the "Pre-paid" badge for the SELECTED colour and the per-line cart
   * snapshot. Absent variant → invoice_on_dispatch (pay at checkout).
   */
  billingModeByVariant?: Record<string, 'invoice_on_dispatch' | 'prepaid'>
  /**
   * Spec 3a follow-up — variant_id → per-unit price of the volume band the
   * PREPAID stock was originally purchased at (linked intake's quote-item
   * price, else ladder at intake qty). Informational: a prepaid draw is $0
   * at checkout. Only populated for prepaid variants.
   */
  stockPurchasePriceByVariant?: Record<string, number>
  /**
   * Explicit ex-GST stock sell price (b2b_catalogue_items.stock_unit_price).
   * null = not set. When set on a Stock-on-hand item it becomes THE per-unit
   * garment price — shown as one price (no volume ladder) and used for the cart
   * claim + checkout charge; the server bills prepaid draws $0 regardless.
   */
  stockUnitPrice?: number | null
  colourOptions?: ColourOption[]
  decorations: DecorationOption[]
  /**
   * Customer-effective MOQ: `b2b_catalogue_items.moq_override ?? products.moq ?? 1`.
   * Applies uniformly across stocked / MTO / mixed and across single / multi-size —
   * "stocked = no MOQ" was an unintentional collapse pre-2026-05-22.
   */
  effectiveMoq: number
  /**
   * Feature #9 — soft per-order cap:
   * `b2b_catalogue_items.max_order_qty_override ?? products.max_order_qty ?? null`.
   * WARN-ONLY: fires a dismissible toast when an add pushes the product's cart
   * total past the cap. Never gates add-to-cart or checkout.
   */
  effectiveMaxQty?: number | null
  /**
   * Pre-order: item is pre_order fulfilment type but there is no currently open
   * ordering period for this org. When true, the add-to-cart button is disabled
   * with a "Ordering opens with the next window" message.
   */
  preOrderClosed?: boolean
  /**
   * Colour swatch id to preselect, from the catalogue grid's `?color=` deep-link.
   * Clamped to a known colour at init; ignored if it doesn't match this product.
   */
  initialColorSwatchId?: string | null
  /**
   * Staff-set min_quantity of each band HIDDEN from the customer Volume-pricing
   * widget. DISPLAY ONLY — the cart/checkout `brackets` snapshot is the full
   * ladder, so price paid and MOQ are unchanged.
   * Empty = show the full ladder.
   */
  volumeDisplayHiddenBands?: number[]
  /** Feature 1 — org location dropdown options. Empty = no location dropdown. */
  locationOptions?: LocationOption[]
  /** Feature 2 — per-product custom-name cap. null/absent = no custom-name input. */
  customNameMaxLength?: number | null
  /**
   * Pre-order franchise demand for this product in the current open window
   * (whole network). null/absent => not a pre-order franchise item, or no open
   * window => the block is not rendered.
   */
  preOrderDemand?: PreOrderDemand | null
}

export function ProductDetailClient({
  product,
  variants,
  sizes,
  brackets,
  availability,
  customerRole,
  orderingPermission,
  images,
  imageLayout = 'standard_views',
  hiddenViewRows = [],
  billingModeByVariant = {},
  stockPurchasePriceByVariant = {},
  stockUnitPrice = null,
  colourOptions = [],
  decorations,
  effectiveMoq,
  effectiveMaxQty = null,
  preOrderClosed = false,
  initialColorSwatchId = null,
  volumeDisplayHiddenBands = [],
  locationOptions = [],
  customNameMaxLength = null,
  preOrderDemand = null,
}: Props) {
  const cart = useCart()
  const { format } = useCurrency()

  const firstVariant = variants[0] ?? null
  // Deep-link preselect: honour `?color=` when it names a colour this product
  // actually has; otherwise fall back to the first variant / first colour option.
  const knownSwatchIds = new Set<string>([
    ...variants.map((v) => v.color_swatch_id).filter((x): x is string => !!x),
    ...colourOptions.map((c) => c.id),
  ])
  const [colorSwatchId, setColorSwatchId] = useState<string | null>(
    (initialColorSwatchId && knownSwatchIds.has(initialColorSwatchId)
      ? initialColorSwatchId
      : null) ?? firstVariant?.color_swatch_id ?? colourOptions[0]?.id ?? null
  )
  // Colourway model: the variant carries no size. Single-size (one_size) products
  // resolve their lone size here; multi-size products drive size via the qty grid
  // (per-size rows), so the single sizeId stays null there.
  const [sizeId, setSizeId] = useState<number | null>(sizes.length === 1 ? sizes[0].size_id : null)
  // Feature 1 — required PDP location dropdown. requiresLocation hard-gates
  // add-to-cart (mirrors the MOQ gate, no default); the chosen label rides the
  // cart line (via lineSignature) through checkout onto the order + Monday.
  const requiresLocation = locationOptions.length > 0
  const [locationValueId, setLocationValueId] = useState<string | null>(null)
  const selectedLocationLabel =
    locationOptions.find((o) => o.value === locationValueId)?.label ?? null
  // Feature 2 — optional free-text custom name. No gate (unlike location): a
  // blank input just means "no name" and the line merges normally. The sanitised
  // value rides every cart line added (via lineSignature) onto the order + Monday.
  const allowsCustomName =
    typeof customNameMaxLength === 'number' && customNameMaxLength > 0
  const [customNameInput, setCustomNameInput] = useState('')
  const sanitisedCustomName = sanitiseCustomName(customNameInput, customNameMaxLength)
  // Qty per variant_id. Survives colour-switches so the user can build a
  // multi-variant order (e.g. 50 of Black M + 30 of White L) in a single PDP
  // session without losing entries when they flip swatches. Cross-colour
  // composition is intentional 2026-05-14 — the order-summary panel below
  // surfaces everything that's been touched.
  const [variantQuantities, setVariantQuantities] = useState<Record<string, number>>({})
  const [orderIntent, setOrderIntent] = useState<OrderIntent>('inventory')

  const sizingMode: SizingMode = useMemo(
    () => resolveSizingMode(product.sizing_type, variants.length, sizes.length),
    [product.sizing_type, variants.length, sizes.length],
  )

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

  // Canonical views staff hid from the customer PDP for the active colour.
  const hiddenViews = useMemo(
    () => hiddenViewSetForColour(hiddenViewRows, colorSwatchId),
    [hiddenViewRows, colorSwatchId],
  )

  const variantsForSelectedColour = useMemo(
    () => variants.filter((v) => v.color_swatch_id === colorSwatchId),
    [variants, colorSwatchId],
  )

  // Spec 3a — the line's billing class is the VARIANT's (absent → invoiced);
  // the "Pre-paid" badge shows when any variant of the selected colour is prepaid.
  const billingModeForVariant = (variantId: string | null): 'invoice_on_dispatch' | 'prepaid' =>
    (variantId && billingModeByVariant[variantId]) || 'invoice_on_dispatch'
  const selectedColourPrepaid = variantsForSelectedColour.some(
    (v) => billingModeByVariant[v.variant_id] === 'prepaid',
  )
  // Original purchase per-unit price for the selected (prepaid) colour —
  // informational display only; the draw itself is $0 at checkout.
  const selectedColourStockPrice = useMemo<number | null>(() => {
    for (const v of variantsForSelectedColour) {
      const price = stockPurchasePriceByVariant[v.variant_id]
      if (typeof price === 'number') return price
    }
    return null
  }, [variantsForSelectedColour, stockPurchasePriceByVariant])

  // Prefer the post-SKUCOLLAPSE sizeless colourway variant, but keep supporting
  // legacy products whose product_variants rows still carry size_id.
  const selectedVariant = useMemo(
    () =>
      variantsForSelectedColour.find((v) => v.size_id == null) ??
      variantsForSelectedColour[0] ??
      null,
    [variantsForSelectedColour],
  )

  const variantForSize = useMemo(
    () => (candidateSizeId: number | null) => {
      const exact = variantsForSelectedColour.find((v) => v.size_id === candidateSizeId)
      const hasAvailability = (variant: VariantRow) =>
        availability[cellKey(variant.variant_id, candidateSizeId)] !== undefined

      if (exact && hasAvailability(exact)) return exact

      const availableVariant = variantsForSelectedColour.find(hasAvailability)
      if (availableVariant) return availableVariant

      return (
        exact ??
        variantsForSelectedColour.find((v) => v.size_id == null) ??
        variantsForSelectedColour[0] ??
        null
      )
    },
    [variantsForSelectedColour, availability],
  )

  const selectedCellVariant = variantForSize(sizeId)

  // Availability is per (variant, size); look up by the composite key.
  const availKey =
    selectedCellVariant != null ? cellKey(selectedCellVariant.variant_id, sizeId) : null
  const tracksThisVariant = availKey != null && availability[availKey] !== undefined
  const availableQty = availKey ? availability[availKey]?.available_qty : undefined
  const selectedVariantBackorderable =
    availKey != null && availability[availKey]?.allow_order_without_stock === true
  const isOutOfStock = tracksThisVariant && (availableQty ?? 0) === 0

  // Total in-stock across every size for the currently selected colour.
  // Drives the AvailabilityBadge in multi-size mode so customers see "240
  // available" for Black, not "8 available" because S happens to be the
  // selected size.
  const colourTotalAvailable = useMemo<number | undefined>(() => {
    let total = 0
    let tracked = false
    for (const s of sizes) {
      const variant = variantForSize(s.size_id)
      if (!variant) continue
      const a = availability[cellKey(variant.variant_id, s.size_id)]
      if (a === undefined) continue
      tracked = true
      total += a.available_qty
    }
    return tracked ? total : undefined
  }, [sizes, variantForSize, availability])

  // Size rows come from the per-product `sizes` list (the variant is a colourway);
  // availability is per colourway×size via the composite key.
  const sizeRowsForColour = useMemo(() => {
    if (variantsForSelectedColour.length === 0) return []
    return sizes
      .flatMap((s) => {
        const variant = variantForSize(s.size_id)
        if (!variant) return []
        const a = availability[cellKey(variant.variant_id, s.size_id)]
        const tracked = a !== undefined
        return [
          {
            variantId: variant.variant_id,
            sizeId: s.size_id,
            sizeLabel: s.size_label ?? '',
            sizeOrder: s.size_order,
            available: tracked ? a.available_qty : null,
            allowOrderWithoutStock: tracked ? a.allow_order_without_stock : false,
          },
        ]
      })
      .sort((a, b) => a.sizeOrder - b.sizeOrder)
  }, [sizes, variantsForSelectedColour.length, variantForSize, availability])

  // Backorderable variants count as "has inventory" for the gate that
  // unlocks the From-Stock vs Made-to-Order toggle and lets the customer
  // proceed past stock guards — even though zero stock is on hand.
  const currentSelectionHasInventory = useMemo(() => {
    if (sizingMode === 'multi_size_with_variants') {
      return sizeRowsForColour.some(
        (row) => (row.available ?? 0) > 0 || row.allowOrderWithoutStock,
      )
    }
    if (!availKey) return false
    const a = availability[availKey]
    if (!a) return false
    return a.available_qty > 0 || a.allow_order_without_stock
  }, [sizingMode, sizeRowsForColour, availKey, availability])

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
  const permission = effectivePermission(customerRole, orderingPermission)
  const options = orderingOptions(product.fulfilment_type, permission)

  // Offer the From-inventory / Reorder choice only when BOTH paths are open to this
  // viewer AND there's stock to draw AND tiers to reorder against.
  const canChooseOrderIntent =
    options.canDrawStock &&
    options.canReorder &&
    currentSelectionHasInventory &&
    brackets.length > 0

  // True whenever this order will be fulfilled from existing stock rather than
  // a new production run: a buyer (stock-only by role), a stocked product with
  // no volume tiers, or an org_admin who has toggled to "From Stock". In every
  // case the PDP hides bulk-order artefacts (volume pricing + lead time) and
  // the Add-to-cart guard blocks ordering beyond available stock.
  const isInventoryMode =
    (options.canDrawStock && !options.canReorder) ||
    (currentSelectionHasInventory && brackets.length === 0) ||
    (canChooseOrderIntent && orderIntent === 'inventory')

  // Item 6: the stock "Available" column and the header AvailabilityBadge are
  // meaningful only when drawing from existing stock (Stock-on-hand mode). In
  // Purchase-order mode (!isInventoryMode) the order is a production run, so
  // per-size availability is irrelevant — hide both.
  const showAvailability = isInventoryMode

  // From-inventory mode (spec Item 3) applied to the multi-size variant table:
  // show ONLY sizes with a tracked, in-stock quantity for the current colour,
  // and drop the "Available" status column below. Reorder/MTO mode is
  // unchanged; CartTable remains the oversell net.
  const visibleSizeRows = isInventoryMode
    ? sizeRowsForColour.filter(
        (row) =>
          row.available !== null &&
          (row.available > 0 || row.allowOrderWithoutStock),
      )
    : sizeRowsForColour

  const hasBackorderableOrderPath = sizeRowsForColour.some(
    (row) => row.allowOrderWithoutStock,
  )
  const isUnavailableToOrder = options.deadZone && !hasBackorderableOrderPath

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
      (sum, row) => sum + (variantQuantities[cellKey(row.variantId, row.sizeId)] ?? 0),
      0,
    )
  }, [sizeRowsForColour, variantQuantities])

  // Are there qtys queued under colours other than the currently-displayed one?
  const otherColoursTotalQty = multiSizeTotalQty - currentColourTotalQty

  // Display name of the currently-selected colour, resolved the same way the
  // swatch picker resolves it (catalogue colour option first, then the variant's
  // own color_label). Drives the grid's per-colour subtotal label so it reads
  // "Total Navy" rather than the generic "Total This Colour" (Anna feedback).
  const selectedColourLabel = useMemo<string | null>(() => {
    const opt = colourOptions.find((c) => c.id === colorSwatchId)
    return opt?.label ?? variantsForSelectedColour[0]?.color_label ?? null
  }, [colourOptions, colorSwatchId, variantsForSelectedColour])

  // Resolved per-variant lines for every variant the user has touched in this
  // session, across all colours. Drives the order-summary panel between the
  // size grid and the price block.
  // One row per touched (colourway, size) cell across every colour the user has
  // entered. Size comes from the per-product `sizes` list; qty + availability are
  // keyed by the (variant, size) composite.
  const orderLines = useMemo(() => {
    const out: Array<{
      variantId: string
      sizeId: number | null
      colourLabel: string
      sizeLabel: string
      qty: number
      inStock: number
      toBeMade: number
      tracked: boolean
    }> = []
    for (const v of variants) {
      for (const s of sizes) {
        const qtyLine = variantQuantities[cellKey(v.variant_id, s.size_id)] ?? 0
        if (qtyLine <= 0) continue
        const a = availability[cellKey(v.variant_id, s.size_id)]
        const tracked = a !== undefined
        const stocked = tracked ? a.available_qty : 0
        const backorderable = tracked && a.allow_order_without_stock
        const forceBulkOrder = canChooseOrderIntent && orderIntent === 'bulk'
        // Backorderable variant behaves like the bulk path at line level —
        // entire qty goes to production, none drawn from stock — even though
        // it's a tracked SKU. Matches the "made_to_order" cart fulfilment.
        const treatAsBulk = forceBulkOrder || backorderable
        const inStock = treatAsBulk ? 0 : tracked ? Math.min(qtyLine, stocked) : 0
        const toBeMade = treatAsBulk
          ? qtyLine
          : tracked
            ? Math.max(0, qtyLine - stocked)
            : qtyLine
        out.push({
          variantId: v.variant_id,
          sizeId: s.size_id,
          colourLabel: v.color_label ?? '',
          sizeLabel: s.size_label ?? '',
          qty: qtyLine,
          inStock,
          toBeMade,
          tracked,
        })
      }
    }
    return out
  }, [variants, sizes, variantQuantities, availability, canChooseOrderIntent, orderIntent])

  const defaultMinQty = activeMoq
  const [singleQty, setSingleQty] = useState<number>(defaultMinQty)
  const qty =
    sizingMode === 'multi_size_with_variants'
      ? multiSizeTotalQty
      : sizingMode === 'multi_size_variantless'
        ? variantlessTotalQty
        : singleQty
  const setQty = setSingleQty
  const preOrderSavings = useMemo(
    () =>
      preOrderDemand
        ? calculatePeriodSavingsOpportunity({
            networkQty: preOrderDemand.unitsOrdered,
            franchiseQty: qty,
            bands: brackets.map((bracket) => ({
              minQuantity: bracket.min_quantity,
              unitPrice: bracket.unit_price,
            })),
          })
        : null,
    [brackets, preOrderDemand, qty],
  )
  const preOrderCloses = preOrderDemand
    ? new Date(preOrderDemand.closesAt).toLocaleDateString('en-NZ', {
        day: 'numeric',
        month: 'long',
      })
    : null

  useEffect(() => {
    setSingleQty((q) => Math.max(defaultMinQty, q))
  }, [defaultMinQty])

  const [pricing, setPricing] = useState<PricingResponse | null>(null)
  const [pricingLoading, setPricingLoading] = useState(false)
  const priceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Decoration prices keyed by qty bucket: { [qty]: { [linkId]: unitPrice } }
  // Populated for: every bracket's min_quantity + the current qty.
  // For decorations without recalcInputs (legacy rows; unpriceable embroidery
  // is blocked from add-to-cart instead), the static d.unitPrice is the fallback.
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
    // Stock-on-hand with an explicit price shows/charges ONE flat price, never
    // the volume ladder. Short-circuit the /api/shop/pricing fetch so the cart's
    // claimed_unit_price is the explicit price — matching the server's canonical
    // (submit.ts garmentUnitPriceForLine), so the checkout drift guard passes.
    if (isInventoryMode && stockUnitPrice != null) {
      setPricing({
        unit_price: stockUnitPrice,
        total: Number((stockUnitPrice * qty).toFixed(2)),
        status: 'ok',
        bracket: null,
      })
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
  }, [qty, product.id, isInventoryMode, stockUnitPrice])

  useEffect(() => {
    // The pricing API only needs the linkId (it re-resolves the decoration
    // server-side); placement/colour ride along for screenprint only.
    // Embroidery is included too: its stitch-ladder price is qty-independent,
    // so every probed qty returns the same figure — the fetch is what applies
    // the tier multiplier and keeps cart == checkout.
    const recalcItems = decorations.flatMap((d) => {
      const ri = d.recalcInputs
      if (ri == null) return []
      return ri.method === 'screenprint'
        ? [{ linkId: d.linkId, placementKey: ri.placementKey, colourCount: ri.colourCount }]
        : [{ linkId: d.linkId }]
    })
    // Manual-final items need the combined decoration figure regardless of
    // per-placement recalc inputs — it's resolved from the catalogue item id, not
    // from placement/colour-count. Without this a manual item whose decoration
    // has no recalcInputs (e.g. a legacy or manually-attached decoration)
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

  // Soft gate (mirrors the RPC's NULL for embroidery with no stitch_count and
  // no dimensions): on a computed-price item such a decoration has no real
  // price — the static fallback would drift against the server recompute — so
  // the PDP shows pricing-pending and blocks add-to-cart. Manual-final items
  // are exempt: their decoration billing is the item-level combined figure and
  // placements are metadata.
  const pendingPricingDecorations = useMemo(
    () =>
      isManualPricing
        ? []
        : pricedDecorations.filter(
            (d) => d.method === 'embroidery' && d.recalcInputs == null,
          ),
    [isManualPricing, pricedDecorations],
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
      swatchVisibleDecorations
        .filter((d): d is DecorationOption & { artworkUrl: string } => Boolean(d.artworkUrl))
        .map((d) => ({
          id: d.linkId,
          url: d.artworkUrl,
          label: d.positionLabel ? `${d.name} - ${d.positionLabel}` : d.name,
          alt: `${d.name} artwork`,
        })),
    [swatchVisibleDecorations],
  )

  // Resolve decoration unit price for a specific qty (falls back to static
  // unitPrice for legacy rows / cache miss).
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

  const decorationPerUnit = useMemo(
    () =>
      isManualPricing
        ? manualDecorationAt(qty)
        : pricedDecorations.reduce(
            (s, d) => s + decorationPriceAt(d.linkId, qty, d.unitPrice),
            0,
          ),
    [isManualPricing, manualDecorationAt, pricedDecorations, decorationPriceAt, qty],
  )

  // For rendering volume bracket rows: combined decoration at that bracket's qty.
  const decorationPerUnitAtBracket = useMemo(
    () =>
      brackets.map((b) =>
        isManualPricing
          ? manualDecorationAt(b.min_quantity)
          : pricedDecorations.reduce(
              (s, d) => s + decorationPriceAt(d.linkId, b.min_quantity, d.unitPrice),
              0,
            ),
      ),
    [brackets, isManualPricing, manualDecorationAt, pricedDecorations, decorationPriceAt],
  )

  // Customer Volume-pricing widget rows: combine each garment band with its
  // decoration figure, then drop the staff-hidden bands. Display only —
  // the cart's `brackets` snapshot stays the full ladder, so the price paid at
  // any qty (and the MOQ) are unchanged; this just changes what's advertised.
  const displayVolumeBrackets = useMemo(
    () =>
      hideVolumeDisplayBands(
        brackets.map((b, i) => ({
          min_quantity: b.min_quantity,
          max_quantity: b.max_quantity,
          unit_price: Number(b.unit_price) + (decorationPerUnitAtBracket[i] ?? 0),
        })),
        volumeDisplayHiddenBands,
      ),
    [brackets, decorationPerUnitAtBracket, volumeDisplayHiddenBands],
  )

  function handleAddToCart() {
    if (!pricing || pricing.status !== 'ok') return
    if (pendingPricingDecorations.length > 0) return
    const selectedDecorations = decorations.filter((d) => selectedLinkIds.has(d.linkId))
    // one_size: the lone product size carried onto the order line.
    const oneSizeSizeLabel = sizes.find((s) => s.size_id === sizeId)?.size_label ?? null

    // Feature #9 (warn-only): existing cart qty for this product, captured
    // BEFORE the adds so one add action fires at most one toast. Must never
    // block the add — the cap is advisory.
    const qtyInCartBeforeAdd = (cart.lines ?? [])
      .filter((l) => l.productId === product.id)
      .reduce((sum, l) => sum + l.qty, 0)
    const warnIfOverCap = (addedQty: number) => {
      if (addedQty <= 0) return
      const warning = qtyCapWarningFor(qtyInCartBeforeAdd, addedQty, effectiveMaxQty)
      if (!warning) return
      window.dispatchEvent(
        new CustomEvent<QtyCapWarningDetail>(QTY_CAP_WARNING_EVENT, {
          detail: { productName: product.name, ...warning },
        }),
      )
    }

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

    // Line-level manual decoration snapshot (null/undefined for computed items).
    // Only snapshot a concrete figure once the combined fetch has resolved; if it
    // hasn't (sub-debounce add / fetch error), snapshot null so the server
    // silently re-prices from the engine rather than us claiming a stale 0 that
    // would trip the zero-tolerance drift guard at checkout.
    const manualDecorationActive = isManualPricing
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
      pickPreferredGalleryImageUrl(
        images,
        swatchId,
        product.image_url,
        hiddenViewSetForColour(hiddenViewRows, swatchId),
        imageLayout,
      )
    // Stock-on-hand with an explicit price: one flat band so the cart keeps the
    // single price on qty edits (and the claimed price stays the explicit one).
    const cartLineBrackets: CartLineBracket[] =
      isInventoryMode && stockUnitPrice != null
        ? [{ minQty: 1, maxQty: null, unitPrice: stockUnitPrice }]
        : brackets.map((b) => ({
            minQty: b.min_quantity,
            maxQty: b.max_quantity,
            unitPrice: b.unit_price,
          }))

    // Mode 1: multi-size with variants — one cart line per touched (colourway,
    // size) cell. The variant is the colourway; size is an explicit line attribute.
    if (sizingMode === 'multi_size_with_variants') {
      let added = 0
      for (const variant of variants) {
        for (const s of sizes) {
          const lineQty = variantQuantities[cellKey(variant.variant_id, s.size_id)] ?? 0
          if (lineQty <= 0) continue
          const variantLabel =
            [variant.color_label, s.size_label].filter(Boolean).join(' / ') || '—'
          const a = availability[cellKey(variant.variant_id, s.size_id)]
          const tracked = a !== undefined
          const available = tracked ? a.available_qty : 0
          const backorderable = tracked && a.allow_order_without_stock
          const baseLine = {
            productId: product.id,
            productName: product.name,
            variantId: variant.variant_id,
            variantLabel,
            sizeId: s.size_id,
            sizeLabel: s.size_label,
            unitPrice: pricing.unit_price,
            imageUrl: cartImageForSwatch(variant.color_swatch_id),
            decorations: cartDecorationsForSwatch(variant.color_swatch_id),
            brackets: cartLineBrackets,
            catalogueItemId: product.catalogueItemId,
            locationLabel: selectedLocationLabel,
            customName: sanitisedCustomName,
            billingMode: billingModeForVariant(variant.variant_id),
            nature: product.fulfilment_type,
            manualDecorationPerUnit: manualDecorationPerUnitSnapshot,
            manualDecorationBrackets: manualDecorationBracketsSnapshot,
          }

          // Fulfilment decision: toggle choice wins for org_admin; otherwise a
          // line only claims a stock draw when one is actually possible —
          // drawable product (nature × permission) + tracked cell with enough
          // stock. Untracked cells of made_to_order products are production
          // runs, NOT 'stocked' (fix 2026-07-06; see lineFulfilment).
          const fulfilmentType = lineFulfilment({
            canDrawStock: options.canDrawStock,
            canChooseOrderIntent,
            orderIntent,
            tracked,
            available,
            backorderable,
            lineQty,
          })
          cart.addLine({ ...baseLine, qty: lineQty, fulfilmentType })
          added += lineQty
        }
      }
      if (added > 0) {
        setVariantQuantities({})
        warnIfOverCap(added)
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
          fulfilmentType: 'made_to_order',
          brackets: cartLineBrackets,
          catalogueItemId: product.catalogueItemId,
          locationLabel: selectedLocationLabel,
          customName: sanitisedCustomName,
          billingMode: billingModeForVariant(variantsForSelectedColour[0]?.variant_id ?? null),
          nature: product.fulfilment_type,
          manualDecorationPerUnit: manualDecorationPerUnitSnapshot,
          manualDecorationBrackets: manualDecorationBracketsSnapshot,
        })
        added += lineQty
      }
      if (added > 0) {
        setVariantlessQtyBySize({})
        warnIfOverCap(added)
      }
      return
    }

    // Mode 3: one_size — single cart line, no variant. Same fulfilment
    // decision as multi-size: toggle choice wins when present (PDP shortfall
    // already enforced From-Stock vs zero-stock); buyer flow auto-routes
    // backorderable to made_to_order.
    const oneSizeFulfilment = lineFulfilment({
      canDrawStock: options.canDrawStock,
      canChooseOrderIntent,
      orderIntent,
      tracked: tracksThisVariant,
      available: availableQty ?? 0,
      backorderable: selectedVariantBackorderable,
      lineQty: qty,
    })
    cart.addLine({
      productId: product.id,
      productName: product.name,
      // one_size still has a colourway variant (SKUCOLLAPSE: a variant IS a
      // colour). Carry the SELECTED variant so checkout can resolve its
      // billing_mode (prepaid → $0) and draw its stock — dropping it here
      // (variantId '') sent variant_id: null and made submit_b2b_order raise
      // NO_INVENTORY ("missing variant_id") for stock_only members. Genuinely
      // variantless single-SKU products keep '' (selectedVariant is null).
      variantId: selectedVariant?.variant_id ?? '',
      variantLabel: selectedVariant?.color_label ?? '—',
      sizeId,
      sizeLabel: oneSizeSizeLabel,
      qty,
      unitPrice: pricing.unit_price,
      imageUrl: cartImageForSwatch(colorSwatchId),
      decorations: cartDecorationsForSwatch(colorSwatchId),
      fulfilmentType: oneSizeFulfilment,
      brackets: cartLineBrackets,
      catalogueItemId: product.catalogueItemId,
      locationLabel: selectedLocationLabel,
      customName: sanitisedCustomName,
      billingMode: billingModeForVariant(selectedVariant?.variant_id ?? null),
      nature: product.fulfilment_type,
      manualDecorationPerUnit: manualDecorationPerUnitSnapshot,
      manualDecorationBrackets: manualDecorationBracketsSnapshot,
    })
    warnIfOverCap(qty)
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
  // Hard cap: a stock-on-hand order can never exceed available stock. When a
  // buyer wants more than is in stock they must switch to the Purchase Order
  // (Re-order) pill, which places a production run subject to the product MOQ.
  if (isInventoryMode) {
    if (sizingMode === 'multi_size_with_variants') {
      const cells = variants.flatMap((variant) => sizes.map((s) => ({ variant, s })))
      for (const { variant, s } of cells) {
        const requested = variantQuantities[cellKey(variant.variant_id, s.size_id)] ?? 0
        if (requested <= 0) continue
        const a = availability[cellKey(variant.variant_id, s.size_id)]
        const backorderable = a?.allow_order_without_stock === true
        // Buyer / no toggle: backorderable variants auto-route to
        // made_to_order at submit, so there's no useful prompt to surface
        // (customer has no choice to switch). Org_admin with toggle: let
        // the shortfall message fire so they can switch to Made to Order.
        if (backorderable && !canChooseOrderIntent) continue
        const available = a?.available_qty ?? 0
        if (requested > available) {
          inventoryIntentShortfall = {
            label:
              [variant.color_label, s.size_label].filter(Boolean).join(' / ') ||
              'selected variant',
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

  // A viewer who cannot reorder (a stock_only member) may only take a genuine
  // stock draw. submit_b2b_order coerces their line to `stocked` and then
  // rejects it (member_cannot_produce for backorderable/made_to_order, or
  // NO_INVENTORY for an untracked cell) — surfaced as the opaque "not stocked
  // for your account" at the final confirm. Mirror that rule up front so an
  // un-drawable selection is blocked at the PDP instead. `lineIsOrderable`
  // encodes the same predicate the server uses; viewers who can reorder are
  // unaffected (a production run is valid for them).
  const selectionBlockedByPermission = useMemo(() => {
    if (options.canReorder) return false
    const blocked = (c: LineFulfilmentContext) => !lineIsOrderable(c, options.canReorder)
    if (sizingMode === 'multi_size_with_variants') {
      for (const variant of variants) {
        for (const s of sizes) {
          const lineQty = variantQuantities[cellKey(variant.variant_id, s.size_id)] ?? 0
          if (lineQty <= 0) continue
          const a = availability[cellKey(variant.variant_id, s.size_id)]
          const tracked = a !== undefined
          if (
            blocked({
              canDrawStock: options.canDrawStock,
              canChooseOrderIntent,
              orderIntent,
              tracked,
              available: tracked ? a.available_qty : 0,
              backorderable: tracked && a.allow_order_without_stock,
              lineQty,
            })
          )
            return true
        }
      }
      return false
    }
    if (sizingMode === 'multi_size_variantless') {
      // Variantless lines are always a production run — a non-reorderer can't take them.
      return variantlessTotalQty > 0
    }
    // one_size
    if (qty <= 0) return false
    return blocked({
      canDrawStock: options.canDrawStock,
      canChooseOrderIntent,
      orderIntent,
      tracked: tracksThisVariant,
      available: availableQty ?? 0,
      backorderable: selectedVariantBackorderable,
      lineQty: qty,
    })
  }, [
    options.canReorder,
    options.canDrawStock,
    canChooseOrderIntent,
    orderIntent,
    sizingMode,
    variants,
    sizes,
    variantQuantities,
    availability,
    variantlessTotalQty,
    qty,
    tracksThisVariant,
    availableQty,
    selectedVariantBackorderable,
  ])

  // Feature 1 — a product with a location dataset cannot be added until a
  // location is chosen (no default; mirrors the MOQ hard-gate).
  const meetsLocation = !requiresLocation || locationValueId != null

  const canSubmitSelection =
    !isUnavailableToOrder &&
    canAddToCart &&
    meetsLocation &&
    inventoryIntentShortfall == null &&
    // A viewer who can't reorder may only take a genuine stock draw; an
    // un-drawable cell (backorderable / made-to-order / over-stock) is blocked
    // up front to mirror submit_b2b_order, not left to fail late at checkout.
    // (Re-added after a merge dropped it from this expression — the memo and its
    // warning message survived, but the button gate did not; see TEST-000080.)
    !selectionBlockedByPermission &&
    !preOrderClosed &&
    pendingPricingDecorations.length === 0

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
                hiddenViews={hiddenViews}
                imageLayout={imageLayout}
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
                {showAvailability && (
                  <AvailabilityBadge
                    availableQty={multiSize ? colourTotalAvailable : availableQty}
                    availableToOrder={
                      multiSize ? hasBackorderableOrderPath : selectedVariantBackorderable
                    }
                  />
                )}
                {showsPrepaidStockBadge(product.fulfilment_type, selectedColourPrepaid ? 'prepaid' : 'invoice_on_dispatch') && (
                  <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                    Pre-paid
                  </span>
                )}
                {product.sizing_type && product.sizing_type !== 'multi_size' && (
                  <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-[11px] tracking-[0.12em] text-gray-600">
                    {product.sizing_type.replace(/_/g, ' ')}
                  </span>
                )}
              </div>
              {product.description && (
                <p className="mt-5 max-w-prose whitespace-pre-line text-base leading-relaxed text-gray-600">
                  {product.description}
                </p>
              )}
              <ProductDetailsCondensed product={product} />
            </header>

          {!isUnavailableToOrder &&
            (sizingMode === 'multi_size_with_variants' ||
              (sizingMode === 'one_size' && colourOptions.length > 1)) && (
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

          {isUnavailableToOrder ? (
            <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
              unavailable to order right now. contact the print room for more information
            </div>
          ) : (
          <>
          {preOrderDemand && (
            <section
              role="status"
              aria-label="Pre-order demand so far"
              className="rounded-[24px] bg-[rgb(var(--accent-mint))] p-5 text-sm leading-6 text-black md:p-6"
            >
              <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-black/60">
                Network pre-order
              </p>
              <p className="mt-1 font-dm-sans text-base font-medium">
                {product.name}
              </p>
              <p className="mt-1 tabular-nums text-black/70">
                <span className="font-semibold">{preOrderDemand.unitsOrdered}</span>{' '}
                {preOrderDemand.unitsOrdered === 1 ? 'unit' : 'units'} ordered across{' '}
                <span className="font-semibold">{preOrderDemand.orderCount}</span>{' '}
                {preOrderDemand.orderCount === 1 ? 'order' : 'orders'} so far.
              </p>
              {preOrderSavings ? (
                <div className="mt-4 border-t border-black/10 pt-4">
                  <p>
                    <span className="font-medium">
                      {preOrderSavings.unitsToNextSaving} more units of {product.name}
                    </span>{' '}
                    by {preOrderCloses} unlocks {format(preOrderSavings.nextUnitPrice)} per unit.
                  </p>
                  <p className="mt-1 text-black/70">
                    Your franchise&apos;s {qty}-unit order will save{' '}
                    <span className="font-semibold text-black">
                      {format(preOrderSavings.franchiseSavings)}
                    </span>{' '}
                    at that tier ({format(preOrderSavings.perUnitSavings)} per unit).
                  </p>
                </div>
              ) : qty <= 0 ? (
                <p className="mt-4 border-t border-black/10 pt-4 text-black/70">
                  Choose quantities below to see this franchise&apos;s saving at the
                  next price tier.
                </p>
              ) : (
                <p className="mt-4 border-t border-black/10 pt-4 font-medium">
                  This order is already at the lowest available network price.
                </p>
              )}
            </section>
          )}
          {/* Volume ladder is a purchase-order concern only — never shown for the
              Stock-on-hand ordering type (supersedes commit 243737a for stock). */}
          {displayVolumeBrackets.length > 0 && !isInventoryMode && (
            <section className="rounded-[24px] bg-white p-6">
              {/* Both pieces in their own span: prices before checkout are
                  ex-GST everywhere, and an unlabelled ladder was read as
                  GST-inclusive (Chris, 2026-07-30). */}
              <p className="flex items-baseline justify-between text-[11px] font-medium tracking-[0.12em] text-gray-500">
                <span>Volume Pricing</span>
                <span className="font-normal tracking-normal text-gray-400">
                  Per unit, excl. GST
                </span>
              </p>
              <ul className="mt-4 grid grid-cols-2 gap-y-2 text-sm text-gray-700 md:grid-cols-3">
                {displayVolumeBrackets.map((b, i) => (
                  <li key={i} className="tabular-nums">
                    <span className="font-medium text-gray-900">
                      {b.min_quantity}
                      {b.max_quantity ? `–${b.max_quantity}` : '+'}
                    </span>{' '}
                    <span className="text-gray-500">@ {format(b.unit_price)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Explicit stock price (Stock-on-hand shows ONE price, not the ladder).
              THE price for both prepaid and pay-at-checkout colours when set;
              supersedes the original-purchase-price panel below. One-size
              products fold this price into the Available|Qty card below instead
              (a single card for a single variant), so skip the standalone panel. */}
          {isInventoryMode && stockUnitPrice != null && sizingMode !== 'one_size' && (
            <section data-testid="stock-unit-price" className="rounded-[24px] bg-white p-6">
              <p className="text-[11px] font-medium tracking-[0.12em] text-gray-500">
                Price
              </p>
              <p className="mt-4 text-sm text-gray-700 tabular-nums">
                <span className="font-medium text-gray-900">{format(stockUnitPrice)}</span>{' '}
                <span className="text-gray-500">
                  per unit, excl. GST{selectedColourPrepaid ? ' — pre-paid' : ''}
                </span>
              </p>
            </section>
          )}

          {/* Prepaid stock (Spec 3a follow-up): where Volume Pricing surfaces
              for purchase orders, a stock draw surfaces the per-unit price of
              the band the stock was ORIGINALLY purchased at. Informational —
              the draw itself is billed $0 (goods already paid). Only when there
              is no explicit stock price (that supersedes it). */}
          {isInventoryMode && stockUnitPrice == null && selectedColourPrepaid && selectedColourStockPrice != null && sizingMode !== 'one_size' && (
            <section className="rounded-[24px] bg-white p-6">
              <p className="text-[11px] font-medium tracking-[0.12em] text-gray-500">
                Prepaid Stock
              </p>
              <p className="mt-4 text-sm text-gray-700 tabular-nums">
                <span className="font-medium text-gray-900">
                  {format(selectedColourStockPrice)}
                </span>{' '}
                <span className="text-gray-500">
                  per unit, excl. GST — original purchase price
                </span>
              </p>
            </section>
          )}

          {canChooseOrderIntent && (
            <OrderIntentToggle value={orderIntent} onChange={setOrderIntent} />
          )}

          {multiSize && visibleSizeRows.length > 0 && (
            <section className="overflow-hidden rounded-[24px] bg-white">
              <table className="w-full text-sm">
                <thead className="text-left text-[11px] tracking-[0.08em] text-gray-500">
                  <tr>
                    <th className="px-5 pt-5 pb-2 font-medium">Size</th>
                    {showAvailability && (
                      <th className="px-5 pt-5 pb-2 font-medium">Available</th>
                    )}
                    <th className="px-5 pt-5 pb-2 text-right font-medium">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleSizeRows.map((row) => {
                    const trackedRow = row.available !== null
                    const stocked = trackedRow ? (row.available ?? 0) : 0
                    const value = variantQuantities[cellKey(row.variantId, row.sizeId)] ?? 0
                    const showBackorderableChip =
                      trackedRow && row.allowOrderWithoutStock && stocked === 0
                    // Untracked rows (no inventory record) only ever reach this
                    // table on the production path — isInventoryMode filters them
                    // out (visibleSizeRows requires available !== null) — so a
                    // made-to-order/in-house size is genuinely available to order,
                    // exactly like a backorderable row. Surface the same pill
                    // rather than a bare "—".
                    const showAvailableToOrderChip = showBackorderableChip || !trackedRow
                    return (
                      <tr key={cellKey(row.variantId, row.sizeId)} className="border-t border-gray-100">
                        <td className="px-5 py-3 font-medium text-gray-900">
                          {row.sizeLabel}
                          {/* Purchase-order side: the Available column (which
                              carries the "to be made" chip in inventory mode) is
                              hidden, but every unit here is a production run — so
                              surface the same yellow reassurance inline. */}
                          {!isInventoryMode && value > 0 && (
                            <span className="ml-2 text-xs font-normal text-amber-700">
                              ({value} to be made)
                            </span>
                          )}
                        </td>
                        {showAvailability && (
                          <td className="px-5 py-3 text-xs text-gray-600">
                            {showAvailableToOrderChip ? (
                              <span className="inline-flex rounded-full bg-[rgb(var(--accent-mint))] px-2 py-0.5 text-[10px] font-medium text-[rgb(var(--accent-mint-ink))]">
                                Available to order
                              </span>
                            ) : `${stocked}`}
                          </td>
                        )}
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
                                const k = cellKey(row.variantId, row.sizeId)
                                if (!Number.isFinite(n) || n <= 0) {
                                  delete next[k]
                                } else {
                                  next[k] = Math.floor(n)
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
                    <td className="px-5 py-3 text-[11px] font-medium tracking-[0.08em] text-gray-500" colSpan={showAvailability ? 2 : 1}>
                      {selectedColourLabel ? `Total ${selectedColourLabel}` : 'Total This Colour'}
                    </td>
                    <td className="px-5 py-3 text-right text-sm font-medium text-gray-900 tabular-nums">
                      {currentColourTotalQty}
                    </td>
                  </tr>
                  {otherColoursTotalQty > 0 && (
                    <tr className="border-t border-gray-100">
                      <td className="px-5 py-3 text-xs text-gray-500" colSpan={showAvailability ? 2 : 1}>
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

          {/* One-size / single-variant inventory card — mirrors the multi-size
              grid above so a one-size product (e.g. a visor) shows its Available
              stock alongside an inline Qty input, just like the hoodie, instead
              of a bare quantity field. For a single variant the price, available
              stock and quantity all live in ONE card: the standalone Price /
              Prepaid Stock panels above are suppressed for one_size and their
              content is folded in here as a header row. Only in inventory mode
              (there's stock to show); the standalone Quantity input below
              carries production-only one-size items where no Available column
              applies. */}
          {sizingMode === 'one_size' && showAvailability && (
            <section className="overflow-hidden rounded-[24px] bg-white">
              {stockUnitPrice != null ? (
                <div data-testid="stock-unit-price" className="px-5 pt-5">
                  <p className="text-[11px] font-medium tracking-[0.12em] text-gray-500">
                    Price
                  </p>
                  <p className="mt-2 text-sm text-gray-700 tabular-nums">
                    <span className="font-medium text-gray-900">{format(stockUnitPrice)}</span>{' '}
                    <span className="text-gray-500">
                      per unit, excl. GST{selectedColourPrepaid ? ' — pre-paid' : ''}
                    </span>
                  </p>
                </div>
              ) : selectedColourPrepaid && selectedColourStockPrice != null ? (
                <div className="px-5 pt-5">
                  <p className="text-[11px] font-medium tracking-[0.12em] text-gray-500">
                    Prepaid Stock
                  </p>
                  <p className="mt-2 text-sm text-gray-700 tabular-nums">
                    <span className="font-medium text-gray-900">
                      {format(selectedColourStockPrice)}
                    </span>{' '}
                    <span className="text-gray-500">
                      per unit, excl. GST — original purchase price
                    </span>
                  </p>
                </div>
              ) : null}
              <table className="w-full text-sm">
                <thead className="text-left text-[11px] tracking-[0.08em] text-gray-500">
                  <tr>
                    <th className="px-5 pt-5 pb-2 font-medium">Available</th>
                    <th className="px-5 pt-5 pb-2 text-right font-medium">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="px-5 py-3 text-xs text-gray-600">
                      {!tracksThisVariant || (isOutOfStock && selectedVariantBackorderable) ? (
                        <span className="inline-flex rounded-full bg-[rgb(var(--accent-mint))] px-2 py-0.5 text-[10px] font-medium text-[rgb(var(--accent-mint-ink))]">
                          Available to order
                        </span>
                      ) : (
                        `${availableQty ?? 0}`
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <input
                        id="qty"
                        type="number"
                        min={defaultMinQty}
                        step={1}
                        value={qty}
                        onChange={(e) => setQty(Number(e.target.value))}
                        aria-label="Quantity"
                        className="w-24 rounded-full bg-gray-50 px-3 py-1.5 text-right text-sm tabular-nums focus:bg-white focus:outline-none focus:ring-2 focus:ring-gray-300"
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
              {isOutOfStock && (
                <p className="px-5 pb-4 text-xs text-amber-700">
                  Out of stock — {qty} will be made.
                </p>
              )}
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
              <p className="text-[11px] font-medium tracking-[0.12em] text-gray-500">
                Your Order
              </p>
              <ul className="mt-4 divide-y divide-gray-100 text-sm">
                {orderLines.map((line) => {
                  const label =
                    [line.colourLabel, line.sizeLabel].filter(Boolean).join(' / ') || '—'
                  // "to be made" is production language — shown only on the
                  // Purchase Order side. Stock-on-hand orders are capped at
                  // available stock, so nothing there is ever "to be made".
                  const showToBeMade = !isInventoryMode
                  return (
                    <li
                      key={cellKey(line.variantId, line.sizeId)}
                      className="flex items-baseline justify-between py-2.5"
                    >
                      <span className="text-gray-800">{label}</span>
                      <span className="text-right text-gray-700">
                        <span className="font-medium tabular-nums">{line.qty}</span>
                        {showToBeMade && line.tracked && line.toBeMade > 0 && line.inStock > 0 && (
                          <span className="ml-1 text-xs text-gray-500">
                            ({line.inStock} in stock,{' '}
                            <span className="text-amber-700">
                              {line.toBeMade} to be made
                            </span>
                            )
                          </span>
                        )}
                        {showToBeMade && line.tracked && line.toBeMade > 0 && line.inStock === 0 && (
                          <span className="ml-1 text-xs text-amber-700">
                            ({line.toBeMade} to be made)
                          </span>
                        )}
                        {showToBeMade && !line.tracked && (
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
              {/* Production-only one-size items keep the inline Quantity field;
                  when there's stock to show, the Available|Qty table above owns
                  the quantity input instead (mirrors the multi-size hoodie). */}
              {sizingMode === 'one_size' && !showAvailability && (
                <div>
                  <label
                    htmlFor="qty"
                    className="block text-[11px] font-medium tracking-[0.12em] text-gray-500"
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
                {isInventoryMode && selectedColourPrepaid ? (
                  // Prepaid stock draw: goods already paid — no live ladder
                  // price here (the Prepaid Stock section above carries the
                  // original purchase price). Checkout bills the line at $0.
                  <div>
                    <p className="text-sm font-medium text-gray-900">Pre-paid</p>
                    <p className="text-[11px] text-gray-500">
                      Goods already paid for — picking fee charged at checkout
                    </p>
                  </div>
                ) : pricingLoading ? (
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
                      className="text-[11px] font-medium tracking-[0.12em] text-gray-500 underline transition-colors hover:text-gray-900"
                    >
                      Contact sales
                    </a>
                  </div>
                ) : (
                  <span className="text-gray-400">—</span>
                )}
              </div>
            </div>

            {requiresLocation && (
              <div className="mt-4">
                <label
                  htmlFor="pdp-location"
                  className="mb-1 block text-sm font-medium text-gray-900"
                >
                  Location <span className="text-red-600">*</span>
                </label>
                <select
                  id="pdp-location"
                  value={locationValueId ?? ''}
                  onChange={(e) => setLocationValueId(e.target.value || null)}
                  className="w-full rounded-2xl border border-black/15 px-4 py-2.5 text-sm"
                >
                  <option value="">Select a location…</option>
                  {locationOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                {locationValueId == null && (
                  <p className="mt-2 rounded-2xl bg-amber-50 px-4 py-3 text-xs text-amber-900">
                    Choose a location to add this item to your cart.
                  </p>
                )}
              </div>
            )}

            {allowsCustomName && (
              <div className="mt-4">
                <label
                  htmlFor="pdp-custom-name"
                  className="mb-1 block text-sm font-medium text-gray-900"
                >
                  Custom name <span className="font-normal text-gray-500">(optional)</span>
                </label>
                <input
                  id="pdp-custom-name"
                  type="text"
                  maxLength={customNameMaxLength ?? undefined}
                  value={customNameInput}
                  onChange={(e) => setCustomNameInput(e.target.value)}
                  placeholder="e.g. a name to print"
                  className="w-full rounded-2xl border border-black/15 px-4 py-2.5 text-sm"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Up to {customNameMaxLength} characters. Leave blank for no name.
                </p>
              </div>
            )}

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
            {pendingPricingDecorations.length > 0 && (
              <p className="mt-3 text-xs text-amber-700">
                Decoration pricing pending for{' '}
                {pendingPricingDecorations.map((d) => d.name).join(', ')} — our
                team is finalising the embroidery details. Check back soon or
                contact us.
              </p>
            )}
            {inventoryIntentShortfall && (
              <p className="mt-3 text-xs text-amber-700">
                {inventoryIntentShortfall.backorderable && canChooseOrderIntent
                  ? `No available stock for ${inventoryIntentShortfall.label} — select Purchase order to order this.`
                  : `Only ${inventoryIntentShortfall.available} available for ${inventoryIntentShortfall.label}. ${
                      canChooseOrderIntent
                        ? 'Switch to Purchase order or reduce quantity.'
                        : 'Reduce quantity to order from stock.'
                    }`}
              </p>
            )}
            {selectionBlockedByPermission && inventoryIntentShortfall == null && (
              <p className="mt-3 text-xs text-amber-700">
                Not stocked for your account — contact staff to add stock, or remove it from
                your selection.
              </p>
            )}
          </section>
          </>
          )}
          </div>
        </div>
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
  // Category intentionally omitted from the customer PDP (Anna portal feedback):
  // the title already carries the design name; brand + SKU are enough context.

  if (rows.length === 0) return null

  return (
    <dl className="mt-6 grid grid-cols-2 gap-x-8 gap-y-2.5 text-xs">
      {rows.map((r) => (
        <div key={r.label} className="flex flex-col gap-0.5">
          <dt className="text-[10px] font-medium tracking-[0.12em] text-gray-500">{r.label}</dt>
          <dd className="truncate text-sm text-gray-900">{r.value}</dd>
        </div>
      ))}
    </dl>
  )
}
