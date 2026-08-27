'use client'

import type { MinimumOrderStatus } from '@/lib/checkout/minimum-order'
import { minimumOrderCopy } from '@/lib/checkout/minimum-order-copy'

/**
 * The one rendering of the $500 gate. Shared by the cart drawer and both
 * checkout clients so the customer reads the same sentence wherever they meet it.
 *
 * `tentative` = the cart could not rule out an exemption (inventory intent is a
 * checkout-time toggle; the open period may still be loading). It softens the
 * wording and drops the alert role, because the order may still go through.
 */
export function MinimumOrderNotice({
  status,
  tentative = false,
}: {
  status: MinimumOrderStatus
  tentative?: boolean
}) {
  const copy = minimumOrderCopy(status, { tentative })
  return (
    <div
      data-testid="minimum-order-notice"
      role={tentative ? 'status' : 'alert'}
      className={`rounded-xl border p-4 text-sm ${
        tentative
          ? 'border-amber-200 bg-amber-50 text-amber-900'
          : 'border-red-200 bg-red-50 text-red-900'
      }`}
    >
      {copy.lead}
      <a className="font-medium underline" href={copy.mailto}>
        {copy.ctaLabel}
      </a>
      .
    </div>
  )
}
