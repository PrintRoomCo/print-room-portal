interface TierBadgeProps {
  /** Kept for caller compatibility; ignored — badge always reads "Catalogue pricing". */
  label?: string | null
  /** Kept for caller compatibility; ignored. */
  pricingMode?: 'catalogue'
  className?: string
}

/**
 * Informational chip that always reads "Catalogue pricing" — every B2B
 * customer is on a catalogue after the global fallback removal (2026-05-05).
 *
 * Neutral OEM-port aesthetic: subtle gray border, near-white background,
 * gray-800 text, small leading dot for the mode marker.
 *
 * Props `label` and `pricingMode` are accepted but ignored, so existing
 * callers compile without churn.
 */
export function TierBadge({ className = '' }: TierBadgeProps) {
  return (
    <span
      className={
        'inline-flex items-center gap-1.5 rounded-full border border-gray-200 ' +
        'bg-white px-2.5 py-1 text-xs font-medium text-gray-800 ' +
        className
      }
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-gray-400" />
      Catalogue pricing
    </span>
  )
}
