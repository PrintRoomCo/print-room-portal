'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useCart } from '@/components/cart/useCart'
import { AvailabilityBadge } from './AvailabilityBadge'
import { VariantPicker, type VariantRow } from './VariantPicker'
import { DecorationSwatchPicker } from './DecorationSwatchPicker'
import { computeOrderBreakdown } from '@/lib/pricing/pricingMath'
import { PriceBreakdown } from '@/components/pricing/PriceBreakdown'
import { ProductImageGallery, type GalleryImage, type GalleryOverlay } from './ProductImageGallery'
import { VariantlessSizeGrid } from './VariantlessSizeGrid'
import { CatalogueTopBar } from './CatalogueTopBar'
import type { DecorationOption } from '@/lib/shop/decorations'
import { filterDecorationsBySwatch } from '@/lib/shop/decoration-filter'
import type { CartLineBracket, CartLineDecoration } from '@/lib/cart/types'
import { useCurrency } from '@/contexts/CurrencyContext'

type FulfilmentType = 'stocked' | 'made_to_order' | 'mixed'
type CustomerRole = 'org_admin' | 'buyer'
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
  /** variant_id → available_qty, only populated for variants the org stocks. */
  availability: Record<string, number>
  organizationId: string
  customerRole: CustomerRole
  images: GalleryImage[]
  decorations: DecorationOption[]
  /**
   * Customer-effective MOQ: `b2b_catalogue_items.moq_override ?? products.moq ?? 1`.
   * Applies uniformly across stocked / MTO / mixed and across single / multi-size —
   * "stocked = no MOQ" was an unintentional collapse pre-2026-05-22.
   */
  effectiveMoq: number
}

export function ProductDetailClient({
  product,
  variants,
  brackets,
  availability,
  customerRole,
  images,
  decorations,
  effectiveMoq,
}: Props) {
  const cart = useCart()
  const { format } = useCurrency()

  const firstVariant = variants[0] ?? null
  const [colorSwatchId, setColorSwatchId] = useState<string | null>(
    firstVariant?.color_swatch_id ?? null
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
    ? availability[selectedVariant.variant_id]
    : undefined
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
      const qty = availability[v.variant_id]
      if (qty === undefined) continue
      tracked = true
      total += qty
    }
    return tracked ? total : undefined
  }, [variants, colorSwatchId, availability])

  const sizeRowsForColour = useMemo(() => {
    return variants
      .filter((v) => v.color_swatch_id === colorSwatchId && v.size_id != null)
      .map((v) => {
        const tracked = availability[v.variant_id] !== undefined
        return {
          variantId: v.variant_id,
          sizeId: v.size_id as number,
          sizeLabel: v.size_label ?? '',
          sizeOrder: v.size_order,
          available: tracked ? availability[v.variant_id] : null,
        }
      })
      .sort((a, b) => a.sizeOrder - b.sizeOrder)
  }, [variants, colorSwatchId, availability])

  const currentSelectionHasInventory = useMemo(() => {
    if (sizingMode === 'multi_size_with_variants') {
      return sizeRowsForColour.some((row) => (row.available ?? 0) > 0)
    }
    if (!selectedVariant) return false
    return (availability[selectedVariant.variant_id] ?? 0) > 0
  }, [sizingMode, sizeRowsForColour, selectedVariant, availability])

  const canChooseOrderIntent =
    customerRole === 'org_admin' && currentSelectionHasInventory

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
        const tracked = availability[v.variant_id] !== undefined
        const stocked = tracked ? (availability[v.variant_id] ?? 0) : 0
        const forceBulkOrder = canChooseOrderIntent && orderIntent === 'bulk'
        const inStock = forceBulkOrder ? 0 : tracked ? Math.min(qtyLine, stocked) : 0
        const toBeMade = forceBulkOrder
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

  const defaultMinQty = effectiveMoq
  const [singleQty, setSingleQty] = useState<number>(defaultMinQty)
  const qty =
    sizingMode === 'multi_size_with_variants'
      ? multiSizeTotalQty
      : sizingMode === 'multi_size_variantless'
        ? variantlessTotalQty
        : singleQty
  const setQty = setSingleQty

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
    if (recalcItems.length === 0) return
    if (!Number.isInteger(qty) || qty <= 0) return

    // Probe each bracket's representative qty + the current qty.
    const probeQtys = Array.from(
      new Set([...brackets.map((b) => b.min_quantity), qty].filter((q) => q >= 1)),
    )

    if (decorationPriceTimer.current) clearTimeout(decorationPriceTimer.current)
    const controller = new AbortController()
    let cancelled = false
    decorationPriceTimer.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/shop/decoration-pricing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ qtys: probeQtys, items: recalcItems }),
          signal: controller.signal,
        })
        if (res.ok && !cancelled) {
          const json = (await res.json()) as {
            pricesByQty: Record<string, Record<string, number | null>>
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
  }, [qty, decorations, brackets])

  const [toast, setToast] = useState<string | null>(null)

  const selectedLinkIds = useMemo<ReadonlySet<string>>(
    () => new Set(decorations.map((d) => d.linkId)),
    [decorations],
  )

  const swatchVisibleDecorations = useMemo(
    () => filterDecorationsBySwatch(decorations, colorSwatchId),
    [decorations, colorSwatchId],
  )

  const selectedDecorations = useMemo(
    () => swatchVisibleDecorations.filter((d) => selectedLinkIds.has(d.linkId)),
    [swatchVisibleDecorations, selectedLinkIds],
  )

  const galleryOverlays = useMemo<GalleryOverlay[]>(
    () =>
      selectedDecorations.flatMap((d) =>
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
    [selectedDecorations],
  )

  // Resolve decoration unit price for a specific qty (falls back to static unitPrice
  // for embroidery / legacy rows / cache miss).
  const decorationPriceAt = useMemo(
    () => (linkId: string, atQty: number, fallback: number) =>
      decorationPricesByQty[atQty]?.[linkId] ?? fallback,
    [decorationPricesByQty],
  )

  const decorationPerUnit = useMemo(
    () =>
      selectedDecorations.reduce(
        (s, d) => s + decorationPriceAt(d.linkId, qty, d.unitPrice),
        0,
      ),
    [selectedDecorations, decorationPriceAt, qty],
  )

  // For rendering volume bracket rows: sum of selected decorations at that bracket's qty.
  const decorationPerUnitAtBracket = useMemo(
    () =>
      brackets.map((b) =>
        selectedDecorations.reduce(
          (s, d) => s + decorationPriceAt(d.linkId, b.min_quantity, d.unitPrice),
          0,
        ),
      ),
    [brackets, selectedDecorations, decorationPriceAt],
  )

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  function handleAddToCart() {
    if (!pricing || pricing.status !== 'ok') return
    const cartLineDecorations: CartLineDecoration[] = selectedDecorations.map((d) => ({
      linkId: d.linkId,
      decorationId: d.decorationId,
      name: d.name,
      method: d.method,
      positionLabel: d.positionLabel,
      unitPrice: decorationPriceAt(d.linkId, qty, d.unitPrice),
      artworkUrl: d.artworkUrl,
      snapshotUrl: d.snapshotUrl,
    }))
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
        const tracked = availability[variant.variant_id] !== undefined
        const available = availability[variant.variant_id] ?? 0
        const fulfilmentType: 'stocked' | 'make_to_stock' = canChooseOrderIntent
          ? orderIntent === 'bulk'
            ? 'make_to_stock'
            : 'stocked'
          : tracked && lineQty > available
            ? 'make_to_stock'
            : 'stocked'
        cart.addLine({
          productId: product.id,
          productName: product.name,
          variantId: variant.variant_id,
          variantLabel,
          qty: lineQty,
          unitPrice: pricing.unit_price,
          imageUrl: product.image_url,
          decorations: cartLineDecorations,
          fulfilmentType,
          brackets: cartLineBrackets,
        })
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
          imageUrl: product.image_url,
          decorations: cartLineDecorations,
          fulfilmentType: 'make_to_stock',
          brackets: cartLineBrackets,
        })
        added += lineQty
      }
      if (added > 0) {
        setVariantlessQtyBySize({})
        showToast(`Added ${added} item${added === 1 ? '' : 's'} to cart`)
      }
      return
    }

    // Mode 3: one_size — single cart line, no variant.
    cart.addLine({
      productId: product.id,
      productName: product.name,
      variantId: '',
      variantLabel: '—',
      qty,
      unitPrice: pricing.unit_price,
      imageUrl: product.image_url,
      decorations: cartLineDecorations,
      fulfilmentType: 'make_to_stock',
      brackets: cartLineBrackets,
    })
    showToast('Added to cart')
  }

  const priceMissing = pricing != null && pricing.status === 'missing'
  const meetsMoq = qty >= effectiveMoq
  const pricingOk = pricing != null && pricing.status === 'ok' && !priceMissing
  const canAddToCart =
    sizingMode === 'multi_size_with_variants'
      ? multiSizeTotalQty > 0 && meetsMoq && pricingOk
      : sizingMode === 'multi_size_variantless'
        ? variantlessTotalQty > 0 && meetsMoq && pricingOk
        : // one_size: no variant selection required
          Number.isInteger(qty) && meetsMoq && pricingOk

  let inventoryIntentShortfall: { label: string; available: number } | null = null
  if (canChooseOrderIntent && orderIntent === 'inventory') {
    if (sizingMode === 'multi_size_with_variants') {
      for (const variant of variants) {
        const requested = variantQuantities[variant.variant_id] ?? 0
        if (requested <= 0) continue
        const available = availability[variant.variant_id] ?? 0
        if (requested > available) {
          const label =
            [variant.color_label, variant.size_label].filter(Boolean).join(' / ') ||
            'selected variant'
          inventoryIntentShortfall = {
            label,
            available,
          }
          break
        }
      }
    } else if (selectedVariant && qty > (availableQty ?? 0)) {
      inventoryIntentShortfall = {
        label: 'selected variant',
        available: availableQty ?? 0,
      }
    }
  }
  const canSubmitSelection = canAddToCart && inventoryIntentShortfall == null

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
              />
            </div>
          </div>

          {/* Info + controls — editorial column */}
          <div className="space-y-8">
            <header>
              {product.sku && (
                <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-gray-500">
                  SKU {product.sku}
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-baseline gap-3">
                <h1 className="font-dm-sans font-medium leading-[1.05] tracking-[-0.02em] text-[clamp(32px,4vw,56px)] text-gray-900">
                  {product.name}
                </h1>
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
              selectedColorSwatchId={colorSwatchId}
              selectedSizeId={sizeId}
              availability={availability}
              showSizePicker={false}
              onChange={({ colorSwatchId: c, sizeId: s }) => {
                setColorSwatchId(c)
                setSizeId(s)
              }}
            />
          )}

          <div className="flex items-center gap-3 flex-wrap">
            <AvailabilityBadge
              availableQty={multiSize ? colourTotalAvailable : availableQty}
            />
            {product.lead_time_days != null && (
              <span className="text-xs text-gray-500">
                Lead time ~{product.lead_time_days} days
              </span>
            )}
          </div>

          {decorations.length > 0 && (
            <DecorationSwatchPicker decorations={decorations} />
          )}

          {canChooseOrderIntent && (
            <OrderIntentToggle value={orderIntent} onChange={setOrderIntent} />
          )}

          {brackets.length > 0 && (
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
              {selectedDecorations.length > 0 && (
                <p className="mt-3 text-xs text-gray-500">
                  Includes {selectedDecorations.length} decoration
                  {selectedDecorations.length === 1 ? '' : 's'}.
                </p>
              )}
            </section>
          )}

          {multiSize && sizeRowsForColour.length > 0 && (
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
                  {sizeRowsForColour.map((row) => {
                    const trackedRow = row.available !== null
                    const stocked = trackedRow ? (row.available ?? 0) : 0
                    const value = variantQuantities[row.variantId] ?? 0
                    const backorder = trackedRow
                      ? Math.max(0, value - stocked)
                      : value
                    return (
                      <tr key={row.variantId} className="border-t border-gray-100">
                        <td className="px-5 py-3 font-medium text-gray-900">{row.sizeLabel}</td>
                        <td className="px-5 py-3 text-xs text-gray-600">
                          {!trackedRow ? '—' : `${stocked}`}
                          {backorder > 0 && (
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

          {effectiveMoq > 1 && (
            <div className="rounded-2xl bg-amber-50 px-4 py-3 text-xs text-amber-900">
              Minimum order:{' '}
              <span className="font-semibold">{effectiveMoq} units</span>
              {sizingMode !== 'one_size' ? ' across all sizes' : ''}.
              {sizingMode !== 'one_size' && qty > 0 && qty < effectiveMoq ? (
                <span className="ml-2 font-medium">
                  Currently {qty} — add {effectiveMoq - qty} more.
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
                          unitEffective: pricing.unit_price + decorationPerUnit,
                          decorationPerUnit: 0,
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
              {pricingLoading ? 'Checking price...' : 'Add to cart'}
            </button>
            {inventoryIntentShortfall && (
              <p className="mt-3 text-xs text-amber-700">
                Only {inventoryIntentShortfall.available} available for{' '}
                {inventoryIntentShortfall.label}. Choose Bulk order or reduce quantity.
              </p>
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

function formatSpecKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
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
            {mode === 'inventory' ? 'Stock request' : 'Bulk order'}
          </button>
        )
      })}
    </div>
  )
}

// Condensed details rail rendered directly under the product description.
// Skips fields surfaced elsewhere on the PDP (SKU above title, sizing-type
// pill next to title, lead-time chip next to availability) to avoid the
// "same info three times" feel.
function ProductDetailsCondensed({ product }: { product: ProductData }) {
  const rows: { label: string; value: React.ReactNode }[] = []

  if (product.brand_name) rows.push({ label: 'Brand', value: product.brand_name })
  if (product.category_name) rows.push({ label: 'Category', value: product.category_name })
  if (product.garment_family) rows.push({ label: 'Garment family', value: product.garment_family.replace(/_/g, ' ') })
  if (product.default_sizes && product.default_sizes.length > 0) rows.push({ label: 'Sizes', value: product.default_sizes.join(', ') })
  if (product.safety_standard) rows.push({ label: 'Safety standard', value: product.safety_standard })

  if (product.specs && typeof product.specs === 'object') {
    const skipKeys = new Set(['sizes', 'sizeRange'])
    for (const [k, v] of Object.entries(product.specs)) {
      if (skipKeys.has(k)) continue
      if (v == null || typeof v === 'object') continue
      rows.push({ label: formatSpecKey(k), value: String(v) })
    }
  }

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
