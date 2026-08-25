'use client'

import { useEffect, useMemo, useState } from 'react'
import type { PreparedCheckoutPartition } from '@/lib/checkout/prepare'
import type { CurrencyTotal } from '@/lib/pricing/order-billing-shape'
import type { BillingCountryConfig } from '@/lib/account/org-countries'
import type { CartLine } from '@/lib/cart/types'
import type { CheckoutLineInput } from '@/lib/checkout/submit'
import type { BillingMode } from '@/lib/shop/billing-mode'

export interface CheckoutPreviewRequest {
  idempotency_key: string
  required_by?: string | null
  notes?: string | null
  intent?: 'customer' | 'inventory'
  lines: CheckoutLineInput[]
  custom_shipping_address?: object | null
}

export type CheckoutPreviewPartition =
  | { ok: true; partition: PreparedCheckoutPartition }
  | {
      ok: false
      partitionKey: string
      countryCode: string
      country: BillingCountryConfig
      code: string
      error: string
    }

export type CheckoutPreviewStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface CheckoutPreviewResult {
  status: CheckoutPreviewStatus
  partitions: CheckoutPreviewPartition[]
  totalsByCurrency: CurrencyTotal[]
  error: string | null
}

const IDLE: CheckoutPreviewResult = {
  status: 'idle',
  partitions: [],
  totalsByCurrency: [],
  error: null,
}
const LOADING: CheckoutPreviewResult = {
  status: 'loading',
  partitions: [],
  totalsByCurrency: [],
  error: null,
}

export function buildCheckoutRequestLines(input: {
  lines: CartLine[]
  perLineShipTo: Record<string, string | null>
  allCustom: boolean
  modeByVariantId: Record<string, BillingMode>
  /** Display provenance for persisted pre-SP3 lines that lack a currency stamp. */
  defaultPriceCurrency?: string
}): CheckoutLineInput[] {
  return input.lines.map((line) => ({
    product_id: line.productId,
    product_name: line.productName,
    variant_id: line.variantId || null,
    size_id: line.sizeId ?? null,
    size_label: line.sizeLabel ?? null,
    qty: line.qty,
    ship_to_store_id: input.allCustom
      ? null
      : input.perLineShipTo[line.lineId] ?? null,
    location_label: line.locationLabel ?? null,
    custom_name: line.customName ?? null,
    cart_line_id: line.lineId,
    decorations: line.decorations,
    claimed_unit_price: line.unitPrice,
    ...(line.priceCurrency ?? input.defaultPriceCurrency
      ? { priceCurrency: line.priceCurrency ?? input.defaultPriceCurrency }
      : {}),
    has_brackets: Array.isArray(line.brackets) && line.brackets.length > 0,
    fulfilment_type: line.fulfilmentType,
    catalogueItemId: line.catalogueItemId ?? null,
    claimed_manual_decoration: line.manualDecorationPerUnit ?? null,
    claimed_billing_mode: line.variantId
      ? input.modeByVariantId[line.variantId] ?? 'invoice_on_dispatch'
      : null,
  }))
}

export function withReviewedPartitionPrices(
  lines: CheckoutLineInput[],
  outcomes: CheckoutPreviewPartition[],
): CheckoutLineInput[] {
  const reviewedByLineId = new Map<
    string,
    { unitPrice: number; decorationPrice: number; currency: string }
  >()
  for (const outcome of outcomes) {
    if (!outcome.ok) continue
    for (const line of outcome.partition.lines) {
      if (!line.cartLineId) continue
      reviewedByLineId.set(line.cartLineId, {
        unitPrice: line.unitPrice,
        decorationPrice: line.decorationUnitPrice,
        currency: outcome.partition.country.currency,
      })
    }
  }
  return lines.map((line) => {
    const reviewed = line.cart_line_id
      ? reviewedByLineId.get(line.cart_line_id)
      : undefined
    return reviewed
      ? {
          ...line,
          reviewed_unit_price: reviewed.unitPrice,
          reviewed_decoration_price: reviewed.decorationPrice,
          reviewed_currency: reviewed.currency,
        }
      : line
  })
}

export function useCheckoutPreview(
  enabled: boolean,
  request: CheckoutPreviewRequest | null,
): CheckoutPreviewResult {
  const serialized = useMemo(
    () => (enabled && request ? JSON.stringify(request) : null),
    [enabled, request],
  )
  const [settled, setSettled] = useState<{
    request: string | null
    result: CheckoutPreviewResult
  }>({ request: null, result: IDLE })

  useEffect(() => {
    if (!serialized) {
      return
    }

    const controller = new AbortController()

    fetch('/api/checkout/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: serialized,
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as {
          outcomes?: CheckoutPreviewPartition[]
          totalsByCurrency?: Record<string, number>
          error?: string
        }
        if (!response.ok) {
          throw new Error(body.error ?? `Preview failed (${response.status})`)
        }
        return body
      })
      .then((body) => {
        if (controller.signal.aborted) return
        setSettled({
          request: serialized,
          result: {
            status: 'ready',
            partitions: body.outcomes ?? [],
            totalsByCurrency: Object.entries(body.totalsByCurrency ?? {}).map(
              ([currency, total]) => ({ currency, total }),
            ),
            error: null,
          },
        })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        if ((error as { name?: string })?.name === 'AbortError') return
        setSettled({
          request: serialized,
          result: {
            status: 'error',
            partitions: [],
            totalsByCurrency: [],
            error: (error as Error).message || 'Checkout preview failed.',
          },
        })
      })

    return () => controller.abort()
  }, [serialized])

  if (!serialized) return IDLE
  return settled.request === serialized ? settled.result : LOADING
}
