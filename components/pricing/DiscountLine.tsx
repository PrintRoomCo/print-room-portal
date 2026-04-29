interface DiscountLineProps {
  /** Tier label, e.g. 'Wholesale'. */
  label: string
  /** Positive dollar amount being discounted. */
  amount: number
  /** Fractional discount, e.g. 0.10 for 10%. */
  discountFraction: number
}

/**
 * Single-line discount summary: "Your {Label} discount: −$X.XX (−N%)".
 * Renders nothing if amount is 0 — caller controls visibility via order math.
 */
export function DiscountLine({
  label,
  amount,
  discountFraction,
}: DiscountLineProps) {
  if (!(amount > 0)) return null
  const pct = Math.round(discountFraction * 100)
  return (
    <div className="flex items-baseline justify-between text-sm">
      <span className="text-gray-700">
        Your <span className="font-medium">{label}</span> discount
      </span>
      <span className="font-medium text-[rgb(var(--color-brand-blue))]">
        −${amount.toFixed(2)}{' '}
        <span className="text-xs text-gray-500">(−{pct}%)</span>
      </span>
    </div>
  )
}
