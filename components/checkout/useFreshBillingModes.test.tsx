import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useFreshBillingModes } from './useFreshBillingModes'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

function ok(modeByVariantId: Record<string, string>) {
  return { ok: true, json: async () => ({ modeByVariantId }) }
}

describe('useFreshBillingModes', () => {
  it('returns the fresh modes once loaded', async () => {
    fetchMock.mockResolvedValue(ok({ v1: 'prepaid' }))
    const { result } = renderHook(() => useFreshBillingModes([{ variantId: 'v1' }]))

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.modeByVariantId).toEqual({ v1: 'prepaid' })
  })

  it('starts in loading so the caller can hold the total back', () => {
    fetchMock.mockReturnValue(new Promise(() => {})) // never resolves
    const { result } = renderHook(() => useFreshBillingModes([{ variantId: 'v1' }]))
    expect(result.current.status).toBe('loading')
  })

  // The money-critical path. An empty map means every line resolves to a null
  // mode and bills at FULL price; we over-quote a prepaid customer rather than
  // quote $17.25 on an order we'd invoice at $1,684.98.
  it('fails CLOSED on a network error: empty map, never a stale $0', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useFreshBillingModes([{ variantId: 'v1' }]))

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.modeByVariantId).toEqual({})
  })

  it('fails CLOSED on a non-OK response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 })
    const { result } = renderHook(() => useFreshBillingModes([{ variantId: 'v1' }]))

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.modeByVariantId).toEqual({})
  })

  it('dedupes variant ids and skips blanks', async () => {
    fetchMock.mockResolvedValue(ok({}))
    renderHook(() =>
      useFreshBillingModes([{ variantId: 'v1' }, { variantId: 'v1' }, { variantId: '' }]),
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/checkout/billing-modes?variant_ids=v1')
  })

  it('does not fetch for an empty cart and reports ready', async () => {
    const { result } = renderHook(() => useFreshBillingModes([]))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.modeByVariantId).toEqual({})
  })

  it('does not fetch when disabled', async () => {
    const { result } = renderHook(() => useFreshBillingModes([{ variantId: 'v1' }], false))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // Order-independent so a cart re-render with the same variants doesn't refetch.
  it('issues one request regardless of line order', async () => {
    fetchMock.mockResolvedValue(ok({}))
    const { rerender } = renderHook(
      ({ lines }) => useFreshBillingModes(lines),
      { initialProps: { lines: [{ variantId: 'b' }, { variantId: 'a' }] } },
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/checkout/billing-modes?variant_ids=a%2Cb')

    rerender({ lines: [{ variantId: 'a' }, { variantId: 'b' }] })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
