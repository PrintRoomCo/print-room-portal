import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import {
  buildCheckoutRequestLines,
  withReviewedPartitionPrices,
  useCheckoutPreview,
} from './useCheckoutPreview'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => vi.unstubAllGlobals())

const request = (idempotencyKey: string) => ({
  idempotency_key: idempotencyKey,
  lines: [{ product_id: 'p1', product_name: 'Tee', qty: 1 }],
})

describe('useCheckoutPreview', () => {
  it('does not request the preview endpoint while the cutover is disabled', () => {
    const { result } = renderHook(() =>
      useCheckoutPreview(false, request('off')),
    )

    expect(result.current).toEqual({
      status: 'idle', partitions: [], totalsByCurrency: [], error: null,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('posts the current checkout assignment and exposes prepared partitions', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        outcomes: [{ ok: true, partition: { key: 'AU:purchase_order' } }],
        totalsByCurrency: { AUD: 110 },
      }),
    })
    const { result } = renderHook(() =>
      useCheckoutPreview(true, request('preview-1')),
    )

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(fetchMock).toHaveBeenCalledWith('/api/checkout/preview', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify(request('preview-1')),
    }))
    expect(result.current.partitions).toEqual([
      { ok: true, partition: { key: 'AU:purchase_order' } },
    ])
    expect(result.current.totalsByCurrency).toEqual([
      { currency: 'AUD', total: 110 },
    ])
  })

  it('aborts a stale assignment and never renders its totals', async () => {
    let resolveFirst!: (value: unknown) => void
    const first = new Promise((resolve) => { resolveFirst = resolve })
    fetchMock
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          outcomes: [{ ok: true, partition: { key: 'NZ:stock_on_hand' } }],
          totalsByCurrency: { NZD: 115 },
        }),
      })
    const { result, rerender } = renderHook(
      ({ key }) => useCheckoutPreview(true, request(key)),
      { initialProps: { key: 'first' } },
    )

    rerender({ key: 'second' })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    const firstSignal = fetchMock.mock.calls[0]?.[1]?.signal as AbortSignal
    expect(firstSignal.aborted).toBe(true)
    resolveFirst({
      ok: true,
      json: async () => ({
        outcomes: [{ ok: true, partition: { key: 'AU:purchase_order' } }],
        totalsByCurrency: { AUD: 999 },
      }),
    })
    await Promise.resolve()
    expect(result.current.partitions).toEqual([
      { ok: true, partition: { key: 'NZ:stock_on_hand' } },
    ])
    expect(result.current.totalsByCurrency).toEqual([
      { currency: 'NZD', total: 115 },
    ])
  })
})

describe('checkout preview request lines', () => {
  const cartLine = {
    lineId: 'line-1',
    productId: 'product-1',
    productName: 'Test tee',
    variantId: 'variant-1',
    variantLabel: 'Black / M',
    qty: 12,
    unitPrice: 10,
    imageUrl: null,
    decorations: [],
    fulfilmentType: 'stocked' as const,
  }

  it('hydrates a legacy cart without inventing a drawer currency', () => {
    expect(buildCheckoutRequestLines({
      lines: [cartLine],
      perLineShipTo: { 'line-1': 'store-au' },
      allCustom: false,
      modeByVariantId: { 'variant-1': 'prepaid' },
    })).toEqual([
      expect.objectContaining({
        cart_line_id: 'line-1',
        ship_to_store_id: 'store-au',
        claimed_billing_mode: 'prepaid',
      }),
    ])
    expect(buildCheckoutRequestLines({
      lines: [cartLine],
      perLineShipTo: { 'line-1': 'store-au' },
      allCustom: false,
      modeByVariantId: {},
    })[0]).not.toHaveProperty('priceCurrency')
  })

  it('carries the exact reviewed country prices into placement', () => {
    const requestLines = buildCheckoutRequestLines({
      lines: [{ ...cartLine, priceCurrency: 'NZD' }],
      perLineShipTo: { 'line-1': 'store-au' },
      allCustom: false,
      modeByVariantId: {},
    })

    expect(withReviewedPartitionPrices(requestLines, [{
      ok: true,
      partition: {
        key: 'AU:stock_on_hand',
        country: {
          code: 'AU', name: 'Australia', currency: 'AUD', taxRate: 0.1,
          taxLabel: 'GST 10%', isDefault: false,
        },
        orderType: 'stock_on_hand',
        lines: [{
          ...requestLines[0], cartLineId: 'line-1', unitPrice: 11,
          decorationUnitPrice: 2, billingMode: 'invoice_on_dispatch', billed: true,
        }],
        pricingPoolLines: requestLines,
        totals: {
          goodsSubtotal: 132, decorationSubtotal: 24, pickingFee: 0,
          tax: 15.6, total: 171.6,
        },
      },
    }])).toEqual([
      expect.objectContaining({
        priceCurrency: 'NZD',
        reviewed_unit_price: 11,
        reviewed_decoration_price: 2,
        reviewed_currency: 'AUD',
      }),
    ])
  })
})
