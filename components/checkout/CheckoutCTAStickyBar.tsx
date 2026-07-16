'use client'

interface CheckoutCTAStickyBarProps {
  itemCount: number
  /** Total formatted via `useCurrency().format` in the parent. */
  totalLabel: string
  onSubmit: () => void
  disabled: boolean
  submitting: boolean
  submitLabel?: string
  submittingLabel?: string
}

/**
 * Full-width fixed bottom CTA bar — House of Miracles pass 2 signature element.
 * OEM black (Q1=A). Left: cart count + total. Right: CTA pill (defaults to
 * "Review order" for the /checkout page; the /checkout/review page overrides
 * to "Confirm & place order").
 *
 * The page container must reserve `pb-[120px] md:pb-[96px]` so this bar never
 * covers the bottom of the items card on short viewports. iOS safe-area is
 * respected via `env(safe-area-inset-bottom)`.
 */
export function CheckoutCTAStickyBar({
  itemCount,
  totalLabel,
  onSubmit,
  disabled,
  submitting,
  submitLabel = 'Review order',
  submittingLabel = 'Submitting…',
}: CheckoutCTAStickyBarProps) {
  return (
    <div
      role="region"
      aria-label="Checkout actions"
      className="fixed inset-x-0 bottom-0 z-40 bg-gray-900 px-4 py-4 text-white md:px-6 pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      <div className="mx-auto flex max-w-[1320px] items-center justify-between gap-4">
        <div className="flex flex-col md:flex-row md:items-baseline md:gap-6">
          <span className="text-sm font-medium">
            Cart: {itemCount} item{itemCount === 1 ? '' : 's'}
          </span>
          <span className="text-base font-semibold">{totalLabel}</span>
        </div>
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled || submitting}
          aria-busy={submitting}
          className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting && (
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
          {submitting ? submittingLabel : submitLabel}
        </button>
      </div>
    </div>
  )
}
