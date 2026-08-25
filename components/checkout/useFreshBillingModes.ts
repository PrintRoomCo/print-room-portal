'use client'

import { useEffect, useMemo, useState } from 'react'
import type { BillingMode } from '@/lib/shop/billing-mode'

const EMPTY_MODES: Record<string, BillingMode> = {}

export type FreshBillingModesStatus = 'loading' | 'ready' | 'error'

/**
 * Fresh per-variant billing modes for the cart.
 *
 * The cart's own billingMode is a PDP snapshot and can be days stale. Because
 * checkout now renders prepaid goods at $0, the money must come from here.
 *
 * Fail-closed by construction: on fetch failure the map is left EMPTY, so every
 * line resolves to a null mode and bills at full price. That over-quotes a
 * prepaid customer, which is recoverable; under-quoting is not. The submit-time
 * `claimed_billing_mode` 409 catches genuine drift either way.
 *
 * `status` lets callers hold the total back for the sub-second fetch rather than
 * flashing a wrong number. 'error' is still a usable, fail-closed answer, hence
 * separate from 'loading'.
 */
export function useFreshBillingModes(
  lines: Array<{ variantId: string }>,
  enabled = true,
): { modeByVariantId: Record<string, BillingMode>; status: FreshBillingModesStatus } {
  const variantIds = useMemo(
    () =>
      Array.from(
        new Set(lines.map((line) => line.variantId).filter((id) => id.length > 0)),
      ).sort(),
    [lines],
  )
  const query = useMemo(() => variantIds.join(','), [variantIds])
  const [modeByVariantId, setModeByVariantId] = useState<Record<string, BillingMode>>({})
  const [status, setStatus] = useState<FreshBillingModesStatus>('loading')

  useEffect(() => {
    if (!enabled || query.length === 0) {
      setModeByVariantId({})
      setStatus('ready')
      return
    }

    const controller = new AbortController()
    setStatus('loading')

    fetch(`/api/checkout/billing-modes?variant_ids=${encodeURIComponent(query)}`, {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data: { modeByVariantId?: Record<string, BillingMode> }) => {
        if (controller.signal.aborted) return
        setModeByVariantId(data?.modeByVariantId ?? {})
        setStatus('ready')
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        if ((error as { name?: string })?.name === 'AbortError') return
        // Fail closed: empty map ⇒ every line bills at full price.
        setModeByVariantId({})
        setStatus('error')
      })

    return () => controller.abort()
  }, [enabled, query])

  return {
    modeByVariantId: enabled && query.length > 0 ? modeByVariantId : EMPTY_MODES,
    status,
  }
}
