interface AvailabilityBadgeProps {
  /** `undefined` means the org does not track this variant — render nothing. */
  availableQty: number | undefined
  /** Zero stock can still be customer-orderable when production top-up is allowed. */
  availableToOrder?: boolean
}

export function AvailabilityBadge({ availableQty, availableToOrder = false }: AvailabilityBadgeProps) {
  if (availableQty === undefined) return null

  if (availableQty > 0) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-lime-100 px-2.5 py-1 text-xs font-medium text-lime-800">
        <span className="h-1.5 w-1.5 rounded-full bg-lime-500" />
        In stock ({availableQty} available)
      </span>
    )
  }

  if (availableToOrder) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[rgb(var(--accent-mint))] px-2.5 py-1 text-xs font-medium text-[rgb(var(--accent-mint-ink))]">
        <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--accent-mint-ink))]" />
        Available to order
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-800">
      <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
      Out of stock
    </span>
  )
}
