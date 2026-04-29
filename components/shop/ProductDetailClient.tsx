'use client'

import Image from 'next/image'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useCart } from '@/components/cart/useCart'
import { AvailabilityBadge } from './AvailabilityBadge'
import { VariantPicker, type VariantRow } from './VariantPicker'
import { RequestReorderModal } from './RequestReorderModal'
import { usePricingContext } from '@/lib/pricing/usePricingContext'
import { computeOrderBreakdown } from '@/lib/pricing/pricingMath'
import { PriceBreakdown } from '@/components/pricing/PriceBreakdown'
import { TierBadge } from '@/components/pricing/TierBadge'

interface ProductData {
  id: string
  name: string
  description: string | null
  image_url: string | null
  moq: number | null
  lead_time_days: number | null
  sizing_type: string | null
  decoration_eligible: boolean | null
  decoration_price: number | null
}

interface Bracket {
  min_quantity: number
  max_quantity: number | null
  unit_price: number
}

interface PricingResponse {
  unit_price: number
  total: number
  bracket: { min_quantity: number; max_quantity: number | null } | null
}

interface Props {
  product: ProductData
  variants: VariantRow[]
  brackets: Bracket[]
  /** variant_id → available_qty, only populated for variants the org stocks. */
  availability: Record<string, number>
  organizationId: string
}

export function ProductDetailClient({
  product,
  variants,
  brackets,
  availability,
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

  const [reorderModalOpen, setReorderModalOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  function handleAddToCart() {
    if (!selectedVariant || !pricing) return
    const colorLabel = selectedVariant.color_label ?? ''
    const sizeLabel = selectedVariant.size_label ?? ''
    const variantLabel = [colorLabel, sizeLabel].filter(Boolean).join(' / ') || '—'
    cart.addLine({
      productId: product.id,
      productName: product.name,
      variantId: selectedVariant.variant_id,
      variantLabel,
      qty,
      unitPrice: pricing.unit_price,
      imageUrl: product.image_url,
      decorationPrice: product.decoration_price ?? null,
    })
    showToast('Added to cart')
  }

  const canAddToCart =
    selectedVariant != null &&
    !isOutOfStock &&
    Number.isInteger(qty) &&
    qty >= defaultMinQty &&
    pricing != null

  const selectedVariantLabel = selectedVariant
    ? [selectedVariant.color_label, selectedVariant.size_label].filter(Boolean).join(' / ') || '—'
    : '—'

  return (
    <div className="p-4 md:p-8">
      <div className="grid gap-8 lg:grid-cols-2">
        {/* Image */}
        <div className="relative aspect-square w-full overflow-hidden rounded-2xl border border-gray-100 bg-gray-50">
          {product.image_url ? (
            <Image
              src={product.image_url}
              alt={product.name}
              fill
              sizes="(min-width:1024px) 40vw, 100vw"
              className="object-contain p-6"
              unoptimized
              priority
            />
          ) : (
            <div className="flex h-full items-center justify-center text-gray-300">
              No image
            </div>
          )}
        </div>

        {/* Info + controls */}
        <div className="space-y-6">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-semibold text-gray-900">{product.name}</h1>
              <TierBadge label={pricingCtx.tierLabel} pricingMode={pricingCtx.pricingMode} />
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

          <div className="flex items-center gap-3">
            <AvailabilityBadge availableQty={availableQty} />
            {!tracksThisVariant && product.lead_time_days != null && (
              <span className="text-xs text-gray-500">
                Lead time ~{product.lead_time_days} days
              </span>
            )}
          </div>

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
              {!tracksThisVariant && product.moq ? (
                <p className="mt-1 text-xs text-gray-500">Min. order {product.moq}</p>
              ) : null}
            </div>
            <div className="flex-1 text-right text-sm">
              {pricingLoading ? (
                <span className="text-gray-400">Pricing…</span>
              ) : pricing ? (
                <PriceBreakdown
                  breakdown={computeOrderBreakdown({
                    lines: [
                      {
                        qty,
                        unitEffective: pricing.unit_price,
                        decorationPerUnit: product.decoration_price ?? 0,
                      },
                    ],
                    tierDiscount: pricingCtx.tierDiscount,
                    pricingMode: pricingCtx.pricingMode,
                    gstRate: 0.15,
                  })}
                  pricingMode={pricingCtx.pricingMode}
                  tierLabel={pricingCtx.tierLabel}
                  tierDiscount={pricingCtx.tierDiscount}
                  variant="pdp"
                />
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
