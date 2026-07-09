// lib/xero/__tests__/client.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getXeroToken, xeroFetch, __resetXeroTokenCacheForTests } from '../client'

const SAVED = { ...process.env }
beforeEach(() => {
  __resetXeroTokenCacheForTests()
  vi.restoreAllMocks()
  process.env.XERO_CLIENT_ID = 'cid'
  process.env.XERO_CLIENT_SECRET = 'secret'
  delete process.env.XERO_TENANT_ID
})
afterEach(() => {
  process.env = { ...SAVED }
})

function mockFetchOnce(status: number, jsonBody: unknown, textBody = '') {
  return vi.fn().mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => jsonBody,
    text: async () => textBody,
    headers: new Map(),
  })
}

describe('getXeroToken', () => {
  it('POSTs client_credentials and returns access_token', async () => {
    const f = mockFetchOnce(200, { access_token: 'tok-1', expires_in: 1800 })
    vi.stubGlobal('fetch', f)

    const token = await getXeroToken()
    expect(token).toBe('tok-1')

    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://identity.xero.com/connect/token')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toMatch(/^Basic /)
    expect(init.body).toContain('grant_type=client_credentials')
  })

  it('caches the token across calls (no second network hit)', async () => {
    const f = mockFetchOnce(200, { access_token: 'tok-cache', expires_in: 1800 })
    vi.stubGlobal('fetch', f)
    await getXeroToken()
    await getXeroToken()
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('throws on non-2xx token response', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(401, {}, 'unauthorized_client'))
    await expect(getXeroToken()).rejects.toThrow(/Xero token HTTP 401/)
  })
})

describe('xeroFetch', () => {
  it('sends Bearer token, JSON accept, and Idempotency-Key when provided', async () => {
    const f = vi
      .fn()
      // 1st call: token
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ access_token: 'tok', expires_in: 1800 }), text: async () => '', headers: new Map() })
      // 2nd call: the API request
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ Quotes: [{ QuoteID: 'quote-1' }] }), text: async () => '', headers: new Map() })
    vi.stubGlobal('fetch', f)

    const res = await xeroFetch<{ Quotes: Array<{ QuoteID: string }> }>('/Quotes', {
      method: 'POST',
      idempotencyKey: 'order-1',
      body: JSON.stringify({ Quotes: [] }),
    })
    expect(res.Quotes[0].QuoteID).toBe('quote-1')

    const [url, init] = f.mock.calls[1]
    expect(url).toBe('https://api.xero.com/api.xro/2.0/Quotes')
    expect(init.headers.Authorization).toBe('Bearer tok')
    expect(init.headers.Accept).toBe('application/json')
    expect(init.headers['Idempotency-Key']).toBe('order-1')
  })

  it('throws with body text on non-2xx', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ access_token: 'tok', expires_in: 1800 }), text: async () => '', headers: new Map() })
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({}), text: async () => 'ValidationException', headers: new Map() })
    vi.stubGlobal('fetch', f)
    await expect(xeroFetch('/Quotes', { method: 'POST' })).rejects.toThrow(/Xero API 400 on \/Quotes: ValidationException/)
  })
})
