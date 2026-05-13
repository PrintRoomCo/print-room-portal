'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useCart } from '@/components/cart/useCart'
import { AvailabilityBadge } from './AvailabilityBadge'
import { VariantPicker, type VariantRow } from './VariantPicker'
import { DecorationSwatchPicker } from './DecorationSwatchPicker'
import { RequestReorderModal } from './RequestReorderModal'
import { computeOrderBreakdown } from '@/lib/pricing/pricingMath'
import { PriceBreakdown } from '@/components/pricing/PriceBreakdown'
import { ProductImageGallery, type GalleryImage, type GalleryOverlay } from './ProductImageGallery'
import type { DecorationOption } from '@/lib/shop/decorations'
import { filterDecorationsBySwatch } from '@/lib/shop/decoration-filter'
import type { CartLineDecoration } from '@/lib/cart/types'

type FulfilmentType = 'stocked' | 'made_to_order' | 'mixed'

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
  images,
  decorations,
  effectiveMoq,
}: Props) {
  const cart = useCart()

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

  const multiSize = useMemo(
    () => new Set(variants.filter((v) => v.size_id != null).map((v) => v.size_id)).size > 1,
    [variants],
  )

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
        const inStock = tracked ? Math.min(qtyLine, stocked) : 0
        const toBeMade = tracked ? Math.max(0, qtyLine - stocked) : qtyLine
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
  }, [variants, variantQuantities, availability])

  const defaultMinQty = effectiveMoq
  const [singleQty, setSingleQty] = useState<number>(defaultMinQty)
  const qty = multiSize ? multiSizeTotalQty : singleQty
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
    if (!Number.isInteger(qty) || qty <= 0) return
    if (priceTimer.current) clearTimeout(priceTimer.current)
    setPricingLoading(true)
    priceTimer.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/shop/pricing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ product_id: product.id, qty }),
        })
        if (res.ok) {
          setPricing((await res.json()) as PricingResponse)
        }
      } finally {
        setPricingLoading(false)
      }
    }, 300)
    return () => {
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
    let cancelled = false
    decorationPriceTimer.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/shop/decoration-pricing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ qtys: probeQtys, items: recalcItems }),
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
      if (decorationPriceTimer.current) clearTimeout(decorationPriceTimer.current)
    }
  }, [qty, decorations, brackets])

  const [reorderModalOpen, setReorderModalOpen] = useState(false)
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

    if (multiSize) {
      let added = 0
      // Iterate every variant the user has touched across all colours — not
      // just the currently-displayed swatch — so cross-variant qtys all flow
      // into one cart submission.
      for (const variant of variants) {
        const lineQty = variantQuantities[variant.variant_id] ?? 0
        if (lineQty <= 0) continue
        const variantLabel =
          [variant.color_label, variant.size_label].filter(Boolean).join(' / ') || '—'
        const tracked = availability[variant.variant_id] !== undefined
        const available = availability[variant.variant_id] ?? 0
        const fulfilmentType: 'stocked' | 'make_to_stock' =
          tracked && lineQty > available ? 'make_to_stock' : 'stocked'
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
        })
        added += lineQty
      }
      if (added > 0) {
        setVariantQuantities({})
        showToast(`Added ${added} item${added === 1 ? '' : 's'} to cart`)
      }
      return
    }

    if (!selectedVariant) return
    const colorLabel = selectedVariant.color_label ?? ''
    const sizeLabel = selectedVariant.size_label ?? ''
    const variantLabel = [colorLabel, sizeLabel].filter(Boolean).join(' / ') || '—'
    const singleTracked = availability[selectedVariant.variant_id] !== undefined
    const singleAvailable = availability[selectedVariant.variant_id] ?? 0
    const singleFulfilmentType: 'stocked' | 'make_to_stock' =
      singleTracked && qty > singleAvailable ? 'make_to_stock' : 'stocked'
    cart.addLine({
      productId: product.id,
      productName: product.name,
      variantId: selectedVariant.variant_id,
      variantLabel,
      qty,
      unitPrice: pricing.unit_price,
      imageUrl: product.image_url,
      decorations: cartLineDecorations,
      fulfilmentType: singleFulfilmentType,
    })
    showToast('Added to cart')
  }

  const priceMissing = pricing != null && pricing.status === 'missing'
  const meetsMoq = qty >= effectiveMoq
  const multiSizeOk = multiSize && multiSizeTotalQty > 0
  const canAddToCart = multiSize
    ? multiSizeOk &&
      meetsMoq &&
      !priceMissing &&
      pricing != null &&
      pricing.status === 'ok'
    : selectedVariant != null &&
      !priceMissing &&
      Number.isInteger(qty) &&
      meetsMoq &&
      pricing != null &&
      pricing.status === 'ok'

  const selectedVariantLabel = selectedVariant
    ? [selectedVariant.color_label, selectedVariant.size_label].filter(Boolean).join(' / ') || '—'
    : '—'

  return (
    <div className="p-4 md:p-8">
      <div className="grid gap-8 lg:grid-cols-2">
        {/* Image */}
        <ProductImageGallery
          images={images}
          fallbackUrl={product.image_url}
          productName={product.name}
          selectedColorSwatchId={colorSwatchId}
          overlays={galleryOverlays}
        />

        {/* Info + controls */}
        <div className="space-y-6">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-semibold text-gray-900">{product.name}</h1>
              {product.sizing_type && product.sizing_type !== 'multi_size' && (
                <span className="rounded-full border border-gray-200 px-2 py-0.5 text-xs text-gray-500">
                  {product.sizing_type.replace(/_/g, ' ')}
                </span>
              )}
            </div>
            {product.description && (
              <p className="mt-2 text-sm text-gray-600">{product.description}</p>
            )}
          </div>

          <VariantPicker
            variants={variants}
            selectedColorSwatchId={colorSwatchId}
            selectedSizeId={sizeId}
            availability={availability}
            showSizePicker={!multiSize}
            onChange={({ colorSwatchId: c, sizeId: s }) => {
              setColorSwatchId(c)
              setSizeId(s)
            }}
          />

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

          {brackets.length > 0 && (
            <div className="rounded-xl border border-gray-100 bg-white p-3 text-xs">
              <p className="mb-2 font-medium text-gray-700">Volume pricing</p>
              <ul className="grid grid-cols-2 gap-y-1 text-gray-600 md:grid-cols-3">
                {brackets.map((b, i) => {
                  const allInUnit = Number(b.unit_price) + (decorationPerUnitAtBracket[i] ?? 0)
                  return (
                    <li key={i}>
                      {b.min_quantity}
                      {b.max_quantity ? `–${b.max_quantity}` : '+'} @ ${allInUnit.toFixed(2)}
                    </li>
                  )
                })}
              </ul>
              {selectedDecorations.length > 0 && (
                <p className="mt-2 text-[11px] text-gray-500">
                  Includes {selectedDecorations.length} decoration
                  {selectedDecorations.length === 1 ? '' : 's'}.
                </p>
              )}
            </div>
          )}

          {multiSize && sizeRowsForColour.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs text-gray-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Size</th>
                    <th className="px-3 py-2 font-medium">Available</th>
                    <th className="px-3 py-2 text-right font-medium">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {sizeRowsForColour.map((row) => {
                    const trackedRow = row.available !== null
                    const stocked = trackedRow ? (row.available ?? 0) : 0
                    const value = variantQuantities[row.variantId] ?? 0
                    // Backorder = qty entered above what's in stock for tracked
                    // variants. For untracked rows the whole qty is "to be made".
                    const backorder = trackedRow
                      ? Math.max(0, value - stocked)
                      : value
                    return (
                      <tr key={row.variantId} className="border-t border-gray-100">
                        <td className="px-3 py-2 font-medium text-gray-800">{row.sizeLabel}</td>
                        <td className="px-3 py-2 text-xs text-gray-600">
                          {!trackedRow ? '—' : `${stocked}`}
                          {backorder > 0 && (
                            <span className="ml-1 text-amber-700">
                              ({backorder} to be made)
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
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
                            className="w-20 rounded-lg border border-gray-200 px-2 py-1 text-right text-sm focus:border-pr-blue focus:outline-none focus:ring-2 focus:ring-pr-blue/30"
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-200 bg-gray-50">
                    <td className="px-3 py-2 text-xs font-medium text-gray-500" colSpan={2}>
                      Total this colour
                    </td>
                    <td className="px-3 py-2 text-right text-sm font-semibold text-gray-800">
                      {currentColourTotalQty}
                    </td>
                  </tr>
                  {otherColoursTotalQty > 0 && (
                    <tr className="border-t border-gray-100 bg-gray-50/60">
                      <td className="px-3 py-2 text-xs text-gray-500" colSpan={2}>
                        Order total (across all variants)
                      </td>
                      <td className="px-3 py-2 text-right text-sm font-semibold text-gray-800">
                        {multiSizeTotalQty}
                        <span className="ml-1 text-xs font-normal text-gray-500">
                          (incl. {otherColoursTotalQty} from other colours)
                        </span>
                      </td>
                    </tr>
                  )}
                </tfoot>
              </table>
            </div>
          )}

          {effectiveMoq > 1 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Minimum order: <span className="font-semibold">{effectiveMoq} units</span>
              {multiSize ? ' across all sizes' : ''}.
              {multiSize && multiSizeTotalQty > 0 && multiSizeTotalQty < effectiveMoq ? (
                <span className="ml-2 font-medium">
                  Currently {multiSizeTotalQty} — add {effectiveMoq - multiSizeTotalQty} more.
                </span>
              ) : null}
            </div>
          )}
          {multiSize && orderLines.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-3">
              <p className="mb-2 text-xs font-medium text-gray-700">Your order</p>
              <ul className="divide-y divide-gray-100 text-sm">
                {orderLines.map((line) => {
                  const label =
                    [line.colourLabel, line.sizeLabel].filter(Boolean).join(' / ') || '—'
                  return (
                    <li
                      key={line.variantId}
                      className="flex items-baseline justify-between py-1.5"
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
            </div>
          )}
          <div className="flex items-end gap-3">
            {!multiSize && (
              <div>
                <label htmlFor="qty" className="block text-sm font-medium text-gray-700">
                  Quantity
                </label>
                <input
                  id="qty"
                  type="number"
                  min={defaultMinQty}
                  step={1}
                  value={qty}
                  onChange={(e) => setQty(Number(e.target.value))}
                  className="mt-1 w-28 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-pr-blue focus:outline-none focus:ring-2 focus:ring-pr-blue/30"
                />
                {isOutOfStock && (
                  <p className="mt-1 text-xs text-amber-700">
                    Out of stock — {qty} will be made.
                  </p>
                )}
              </div>
            )}
            <div className="flex-1 text-right text-sm">
              {pricingLoading ? (
                <span className="text-gray-400">Pricing…</span>
              ) : pricing && pricing.status === 'ok' ? (
                <PriceBreakdown
                  breakdown={computeOrderBreakdown({
                    lines: [
                      {
                        qty,
                        // Roll decoration into the per-unit price so the
                        // standalone "Decoration" line hides — decoration
                        // cost is already shown inside each volume bracket.
                        unitEffective: pricing.unit_price + decorationPerUnit,
                        decorationPerUnit: 0,
                      },
                    ],
                    gstRate: 0.15,
                  })}
                  variant="pdp"
                />
              ) : pricing && pricing.status === 'missing' ? (
                <div className="text-right">
                  <p className="text-sm font-medium text-gray-700">Price on request</p>
                  <a
                    href="mailto:sales@theprint-room.co.nz"
                    className="text-xs text-pr-blue underline"
                  >
                    Contact sales
                  </a>
                </div>
              ) : (
                <span className="text-gray-400">—</span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleAddToCart}
              disabled={!canAddToCart}
              className="rounded-full bg-pr-blue px-5 py-2.5 text-sm font-medium text-white transition-all duration-200 ease-spring hover:bg-pr-blue/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Add to cart
            </button>
            {isOutOfStock && selectedVariant && (
              <button
                type="button"
                onClick={() => setReorderModalOpen(true)}
                className="rounded-full border border-pr-blue px-5 py-2.5 text-sm font-medium text-pr-blue hover:bg-pr-blue/5"
              >
                Request reorder
              </button>
            )}
          </div>
        </div>
      </div>

      <ProductDetailsSection product={product} />

      {reorderModalOpen && selectedVariant && (
        <RequestReorderModal
          variantId={selectedVariant.variant_id}
          variantLabel={selectedVariantLabel}
          productName={product.name}
          defaultQty={qty}
          onClose={() => setReorderModalOpen(false)}
          onSuccess={() => {
            setReorderModalOpen(false)
            showToast('Reorder requested — staff notified')
          }}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-gray-900 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}

function formatSpecKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function ProductDetailsSection({ product }: { product: ProductData }) {
  const rows: { label: string; value: React.ReactNode }[] = []

  if (product.brand_name) rows.push({ label: 'Brand', value: product.brand_name })
  if (product.category_name) rows.push({ label: 'Category', value: product.category_name })
  if (product.sku) rows.push({ label: 'SKU', value: <span className="font-mono">{product.sku}</span> })
  if (product.garment_family) rows.push({ label: 'Garment family', value: product.garment_family.replace(/_/g, ' ') })
  if (product.sizing_type && product.sizing_type !== 'multi_size') rows.push({ label: 'Sizing', value: product.sizing_type.replace(/_/g, ' ') })
  if (product.default_sizes && product.default_sizes.length > 0) rows.push({ label: 'Available sizes', value: product.default_sizes.join(', ') })
  if (product.supports_labels) rows.push({ label: 'Label support', value: 'Yes' })
  if (product.safety_standard) rows.push({ label: 'Safety standard', value: product.safety_standard })
  if (product.lead_time_days != null) rows.push({ label: 'Lead time', value: `~${product.lead_time_days} days` })

  // Flatten specs JSONB — skip keys already covered above, skip arrays/objects
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
    <div className="mt-10 border-t border-gray-100 pt-8">
      <h2 className="mb-4 text-sm font-semibold text-gray-700">Product details</h2>
      <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r) => (
          <div key={r.label} className="flex flex-col gap-0.5">
            <dt className="text-xs font-medium text-gray-500">{r.label}</dt>
            <dd className="text-sm text-gray-800">{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
