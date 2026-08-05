import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createStarshipitOrder } from '../client'
import type { NormalizedShippingAddress } from '@/lib/checkout/shipping-address'

const OK_ADDRESS: NormalizedShippingAddress = {
  name: 'Anytime Fitness Newmarket',
  street: '12 Example St',
  city: 'Auckland',
  state: '',
  postalCode: '1023',
  country: 'New Zealand',
  phone: '0211234567',
}

describe('createStarshipitOrder', () => {
  beforeEach(() => {
    process.env.STARSHIPIT_API_KEY = 'k'
    process.env.STARSHIPIT_SUBSCRIPTION_KEY = 's'
  })
  afterEach(() => vi.restoreAllMocks())

  it('POSTs order_number + destination and returns the order id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, order: { order_id: 987 } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const id = await createStarshipitOrder({
      orderNumber: 'PR-1001',
      address: OK_ADDRESS,
      customerEmail: 'jamie@theprint-room.co.nz',
    })

    expect(id).toBe('987')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }]
    expect(url).toBe('https://api.starshipit.com/api/orders')
    expect(init.headers['StarShipIT-Api-Key']).toBe('k')
    expect(init.headers['Ocp-Apim-Subscription-Key']).toBe('s')
    const sent = JSON.parse(init.body as string)
    expect(sent.order.order_number).toBe('PR-1001')
    expect(sent.order.destination.post_code).toBe('1023')
    expect(sent.order.destination.email).toBe('jamie@theprint-room.co.nz')
  })

  it('returns null on a non-ok Starshipit response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, json: async () => ({ success: false }),
    }))
    const id = await createStarshipitOrder({ orderNumber: 'PR-2', address: OK_ADDRESS, customerEmail: null })
    expect(id).toBeNull()
  })

  it('sends city in both suburb and city, and includes items when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, order: { order_id: 1 } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await createStarshipitOrder({
      orderNumber: 'PR-3',
      address: OK_ADDRESS,
      customerEmail: null,
      items: [{ description: 'Classic Tee — L — Black', quantity: 5, value: 24.5 }],
    })

    const sent = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(sent.order.destination.suburb).toBe('Auckland')
    expect(sent.order.destination.city).toBe('Auckland')
    expect(sent.order.items).toEqual([
      { description: 'Classic Tee — L — Black', quantity: 5, value: 24.5 },
    ])
  })

  it('omits the items key entirely when no items are passed', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, order: { order_id: 1 } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await createStarshipitOrder({ orderNumber: 'PR-4', address: OK_ADDRESS, customerEmail: null })

    const sent = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect('items' in sent.order).toBe(false)
  })
})
