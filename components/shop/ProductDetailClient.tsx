'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useCart } from '@/components/cart/useCart'
import { AvailabilityBadge } from './AvailabilityBadge'
import { VariantPicker, type VariantRow } from './VariantPicker'
import { DecorationSwatchPicker } from './DecorationSwatchPicker'
import { RequestReorderModal } from './RequestReorderModal'
import { usePricingContext } from '@/lib/pricing/usePricingContext'
import { computeOrderBreakdown } from '@/lib/pricing/pricingMath'
import { PriceBreakdown } from '@/components/pricing/PriceBreakdown'
import { TierBadge } from '@/components/pricing/TierBadge'
import { ProductImageGallery, type GalleryImage } from './ProductImageGallery'
import type { DecorationOption } from '@/lib/shop/decorations'
import type { CartLineDecoration } from '@/lib/cart/types'

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
}

export function ProductDetailClient({
  product,
  variants,
  brackets,
  availability,
  images,
  decorations,
}: Props) {
  const cart = useCart()
  const pricingCtx = usePricingContext()

  const firstVariant = variants[0] ?? null
  const [colorSwatchId, setColorSwatchId] = useState<string | null>(
    firstVariant?.color_swatch_id ?? null
  )
  const [sizeId, setSizeId] = useState<number | null>(firstVariant?.size_id ?? null)

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

  const defaultMinQty = tracksThisVariant ? 1 : product.moq ?? 1
  const [qty, setQty] = useState<number>(defaultMinQty)

  useEffect(() => {
    setQty((q) => Math.max(defaultMinQty, q))
  }, [defaultMinQty])

  const [pricing, setPricing] = useState<PricingResponse | null>(null)
  const [pricingLoading, setPricingLoading] = useState(false)
  const priceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [decorationPrices, setDecorationPrices] = useState<Record<string, number>>({})
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
    if (decorationPriceTimer.current) clearTimeout(decorationPriceTimer.current)
    let cancelled = false
    decorationPriceTimer.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/shop/decoration-pricing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ qty, items: recalcItems }),
        })
        if (res.ok && !cancelled) {
          const json = (await res.json()) as { prices: Record<string, number | null> }
          const resolved: Record<string, number> = {}
          for (const [linkId, price] of Object.entries(json.prices)) {
            if (price != null) resolved[linkId] = price
          }
          setDecorationPrices(resolved)
        }
      } catch {
        // network error — keep existing prices
      }
    }, 300)
    return () => {
      cancelled = true
      if (decorationPriceTimer.current) clearTimeout(decorationPriceTimer.current)
    }
  }, [qty, decorations])

  const [reorderModalOpen, setReorderModalOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [selectedLinkIds, setSelectedLinkIds] = useState<ReadonlySet<string>>(
    () => new Set(decorations.filter((d) => d.isDefault).map((d) => d.linkId)),
  )

  const selectedDecorations = useMemo(
    () => decorations.filter((d) => selectedLinkIds.has(d.linkId)),
    [decorations, selectedLinkIds],
  )
  const decorationPerUnit = useMemo(
    () => selectedDecorations.reduce((s, d) => s + (decorationPrices[d.linkId] ?? d.unitPrice), 0),
    [selectedDecorations, decorationPrices],
  )

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  function handleAddToCart() {
    if (!selectedVariant || !pricing || pricing.status !== 'ok') return
    const colorLabel = selectedVariant.color_label ?? ''
    const sizeLabel = selectedVariant.size_label ?? ''
    const variantLabel = [colorLabel, sizeLabel].filter(Boolean).join(' / ') || '—'
    const cartLineDecorations: CartLineDecoration[] = selectedDecorations.map((d) => ({
      linkId: d.linkId,
      decorationId: d.decorationId,
      name: d.name,
      method: d.method,
      positionLabel: d.positionLabel,
      unitPrice: decorationPrices[d.linkId] ?? d.unitPrice,
      artworkUrl: d.artworkUrl,
      snapshotUrl: d.snapshotUrl,
    }))
    cart.addLine({
      productId: product.id,
      productName: product.name,
      variantId: selectedVariant.variant_id,
      variantLabel,
      qty,
      unitPrice: pricing.unit_price,
      imageUrl: product.image_url,
      decorations: cartLineDecorations,
    })
    showToast('Added to cart')
  }

  const priceMissing = pricing != null && pricing.status === 'missing'
  const canAddToCart =
    selectedVariant != null &&
    !isOutOfStock &&
    !priceMissing &&
    Number.isInteger(qty) &&
    qty >= defaultMinQty &&
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
        />

        {/* Info + controls */}
        <div className="space-y-6">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-semibold text-gray-900">{product.name}</h1>
              <TierBadge label={pricingCtx.tierLabel} pricingMode={pricingCtx.pricingMode} />
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
            onChange={({ colorSwatchId: c, sizeId: s }) => {
              setColorSwatchId(c)
              setSizeId(s)
            }}
          />

          <div className="flex items-center gap-3 flex-wrap">
            <AvailabilityBadge availableQty={availableQty} />
            {product.lead_time_days != null && (
              <span className="text-xs text-gray-500">
                Lead time ~{product.lead_time_days} days
              </span>
            )}
          </div>

          {decorations.length > 0 && (
            <DecorationSwatchPicker
              decorations={decorations}
              selectedLinkIds={selectedLinkIds}
              onChange={setSelectedLinkIds}
            />
          )}

          {brackets.length > 0 && (
            <div className="rounded-xl border border-gray-100 bg-white p-3 text-xs">
              <p className="mb-2 font-medium text-gray-700">Volume pricing</p>
              <ul className="grid grid-cols-2 gap-y-1 text-gray-600 md:grid-cols-3">
                {brackets.map((b, i) => (
                  <li key={i}>
                    {b.min_quantity}
                    {b.max_quantity ? `–${b.max_quantity}` : '+'} @ ${Number(b.unit_price).toFixed(2)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-end gap-3">
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
                disabled={isOutOfStock}
                className="mt-1 w-28 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-pr-blue focus:outline-none focus:ring-2 focus:ring-pr-blue/30 disabled:bg-gray-100 disabled:text-gray-400"
              />
              {product.moq != null && product.moq > 1 ? (
                <p className="mt-1 text-xs text-gray-500">Min. order {product.moq}</p>
              ) : null}
            </div>
            <div className="flex-1 text-right text-sm">
              {pricingLoading ? (
                <span className="text-gray-400">Pricing…</span>
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
  if (product.moq != null && product.moq > 1) rows.push({ label: 'Min. order qty', value: product.moq })
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
