'use client'

import { useEffect, useMemo, useState } from 'react'
import type { CartLine } from '@/lib/cart/types'

const EMPTY_FRONT_IMAGES: Record<string, string> = {}

export function useCartLineFrontImages(
  lines: Array<Pick<CartLine, 'lineId' | 'catalogueItemId' | 'productId' | 'variantId'>>,
  enabled = true,
): Record<string, string> {
  const requestLines = useMemo(
    () =>
      lines
        .filter((line) => line.catalogueItemId || line.productId)
        .map((line) => ({
          lineId: line.lineId,
          catalogueItemId: line.catalogueItemId ?? null,
          productId: line.productId,
          variantId: line.variantId || null,
        })),
    [lines],
  )
  const requestBody = useMemo(
    () => JSON.stringify({ lines: requestLines }),
    [requestLines],
  )
  const [frontImageByLineId, setFrontImageByLineId] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!enabled || requestLines.length === 0) {
      return
    }

    const controller = new AbortController()

    fetch('/api/checkout/review-images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: requestBody,
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { imagesByLineId?: Record<string, string> } | null) => {
        if (!controller.signal.aborted) {
          setFrontImageByLineId(data?.imagesByLineId ?? {})
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted && error?.name !== 'AbortError') {
          setFrontImageByLineId({})
        }
      })

    return () => controller.abort()
  }, [enabled, requestBody, requestLines.length])

  return enabled && requestLines.length > 0 ? frontImageByLineId : EMPTY_FRONT_IMAGES
}
