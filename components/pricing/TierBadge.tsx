interface TierBadgeProps {
  /** Kept for caller compatibility; ignored — badge always reads "Catalogue pricing". */
  label?: string | null
  /** Kept for caller compatibility; ignored. */
  pricingMode?: 'catalogue'
  className?: string
}

/**
 * Branded chip that always reads "Catalogue pricing" — every B2B customer
 * is on a catalogue after the global fallback removal (2026-05-05).
 *
 * Props `label` and `pricingMode` are accepted but ignored, so existing
 * callers compile without churn.
 */
export function TierBadge({ className = '' }: TierBadgeProps) {
  return (
    <span
      className={
        'inline-flex items-center rounded-full border border-[rgb(var(--color-brand-blue))]/20 ' +
        'bg-[rgb(var(--color-brand-blue))]/10 px-2.5 py-0.5 text-xs font-medium ' +
        'text-[rgb(var(--color-brand-blue))] ' +
        className
      }
    >
      Catalogue pricing
    </span>
  )
}
