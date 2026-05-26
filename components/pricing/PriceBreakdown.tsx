import type { OrderBreakdown } from '@/lib/pricing/types'
import { formatPrice } from '@/lib/format/price'

interface PriceBreakdownProps {
  breakdown: OrderBreakdown
  /**
   * Layout/density tweak. All variants render the same data; the difference is
   * in spacing + typographic weight so it slots into PDP, cart totals,
   * and checkout review without bespoke rewrites.
   */
  variant: 'pdp' | 'cart-totals' | 'checkout-review'
  /**
   * Optional formatter for the user's chosen display currency. Pass
   * `useCurrency().format` from the parent client component. When omitted,
   * falls back to NZD-only formatPrice (for server-rendered contexts only).
   */
  format?: (nzdAmount: number) => string
}

/**
 * Full-order breakdown: gross subtotal → decoration (if any) → GST → total.
 * Catalogue prices are absolute — no tier-discount line.
 */
export function PriceBreakdown({ breakdown, variant, format }: PriceBreakdownProps) {
  const showDecoration = breakdown.decorationTotal > 0
  const showShipping = variant === 'cart-totals' || variant === 'checkout-review'
  const fmt = format ?? formatPrice
  const productSubtotal = showDecoration
    ? Number((breakdown.grossSubtotal - breakdown.decorationTotal).toFixed(2))
    : breakdown.grossSubtotal

  return (
    <div className="space-y-1.5 text-sm">
      <Row
        label={showDecoration ? 'Garments' : 'Subtotal'}
        value={productSubtotal}
        format={fmt}
      />
      {showDecoration && (
        <Row label="Decoration" value={breakdown.decorationTotal} format={fmt} />
      )}
      {showShipping && (
        <div className="flex items-baseline justify-between">
          <span className="text-gray-700">Shipping</span>
          <span className="font-medium text-gray-900">Included</span>
        </div>
      )}
      <Row
        label={`GST (${Math.round(breakdown.gstRate * 100)}%)`}
        value={breakdown.gst}
        muted
        format={fmt}
      />
      <div className="mt-1 border-t border-gray-100 pt-1.5">
        <Row label="Total" value={breakdown.total} bold format={fmt} />
      </div>
    </div>
  )
}

function Row({
  label,
  value,
  bold,
  muted,
  format,
}: {
  label: string
  value: number
  bold?: boolean
  muted?: boolean
  format: (n: number) => string
}) {
  return (
    <div className="flex items-baseline justify-between">
      <span className={muted ? 'text-gray-500' : 'text-gray-700'}>{label}</span>
      <span
        className={
          bold
            ? 'text-base font-semibold text-gray-900'
            : muted
              ? 'text-gray-700'
              : 'font-medium text-gray-900'
        }
      >
        {format(value)}
      </span>
    </div>
  )
}
