import type { PricingMode } from '@/lib/pricing/types'

interface TierBadgeProps {
  label: string | null
  pricingMode?: PricingMode
  className?: string
}

/**
 * Branded chip for pricing visibility.
 * - tiered  → "{Label} pricing"      (e.g. "Wholesale pricing")
 * - catalogue → "Catalogue pricing"   (no tier name; catalogue prices are absolute)
 * - standard → null                   (no badge for non-b2b customers)
 *
 * Uses brand tokens (rgb(var(--color-brand-blue))) so WS3 polish is additive.
 */
export function TierBadge({
  label,
  pricingMode = 'tiered',
  className = '',
}: TierBadgeProps) {
  if (pricingMode === 'standard') return null
  const text =
    pricingMode === 'catalogue'
      ? 'Catalogue pricing'
      : label
        ? `${label} pricing`
        : null
  if (!text) return null
  return (
    <span
      className={
        'inline-flex items-center rounded-full border border-[rgb(var(--color-brand-blue))]/20 ' +
        'bg-[rgb(var(--color-brand-blue))]/10 px-2.5 py-0.5 text-xs font-medium ' +
        'text-[rgb(var(--color-brand-blue))] ' +
        className
      }
    >
      {text}
    </span>
  )
}
