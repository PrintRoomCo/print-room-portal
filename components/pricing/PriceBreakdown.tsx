import type { OrderBreakdown } from '@/lib/pricing/types'

interface PriceBreakdownProps {
  breakdown: OrderBreakdown
  /**
   * Layout/density tweak. All variants render the same data; the difference is
   * in spacing + typographic weight so it slots into PDP, cart totals,
   * and checkout review without bespoke rewrites.
   */
  variant: 'pdp' | 'cart-totals' | 'checkout-review'
}

/**
 * Full-order breakdown: gross subtotal → decoration (if any) → GST → total.
 * Catalogue prices are absolute — no tier-discount line.
 */
export function PriceBreakdown({ breakdown }: PriceBreakdownProps) {
  const showDecoration = breakdown.decorationTotal > 0

  return (
    <div className="space-y-1.5 text-sm">
      <Row label="Subtotal" value={breakdown.grossSubtotal} />
      {showDecoration && (
        <Row label="Decoration" value={breakdown.decorationTotal} />
      )}
      <Row
        label={`GST (${Math.round(breakdown.gstRate * 100)}%)`}
        value={breakdown.gst}
        muted
      />
      <div className="mt-1 border-t border-gray-100 pt-1.5">
        <Row label="Total" value={breakdown.total} bold />
      </div>
    </div>
  )
}

function Row({
  label,
  value,
  bold,
  muted,
}: {
  label: string
  value: number
  bold?: boolean
  muted?: boolean
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
        ${value.toFixed(2)}
      </span>
    </div>
  )
}
