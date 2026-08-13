'use client'

import type { CartLine } from '@/lib/cart/types'
import {
  SAME_ARTWORK_PILL_LABEL,
  nextArtworkBand,
  nextArtworkBandMessage,
  sameArtworkSavings,
  sameArtworkTooltip,
} from '@/lib/pricing/same-artwork-savings'

/**
 * "Same artwork savings" pill + next-band nudge for a pooled cart or checkout
 * line (spec 2026-08-13 §8).
 *
 * States the OUTCOME, never the formula — no itemised per-placement math. Renders
 * nothing at all when the line does not pool, which is every line until a
 * catalogue is opted in, so this is inert on today's carts.
 */
export function SameArtworkSavings({ line }: { line: CartLine }) {
  const savings = sameArtworkSavings(line)
  if (!savings) return null

  const explanation = sameArtworkTooltip(savings)
  const next = nextArtworkBand(line)

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
      {/* A real button, not a span with tabIndex: the explanation is only
          reachable by hovering otherwise, which leaves keyboard and
          screen-reader users without the reason their price changed. */}
      <button
        type="button"
        className="inline-flex cursor-help items-center rounded-full bg-[rgb(var(--accent-mint))] px-2.5 py-1 text-[11px] font-medium text-[rgb(var(--accent-mint-ink))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/40 focus-visible:ring-offset-2"
        title={explanation}
        aria-label={`${SAME_ARTWORK_PILL_LABEL}. ${explanation}`}
      >
        {SAME_ARTWORK_PILL_LABEL}
      </button>
      {next && (
        <span className="text-xs text-gray-500">{nextArtworkBandMessage(next)}</span>
      )}
    </div>
  )
}
