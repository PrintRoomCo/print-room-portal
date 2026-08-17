// lib/xero/__tests__/client.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  getXeroAccessToken: vi.fn(),
  xeroTenantIdForRegion: vi.fn(),
}))
vi.mock('../token-store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../token-store')>()),
  getXeroAccessToken: mocks.getXeroAccessToken,
  xeroTenantIdForRegion: mocks.xeroTenantIdForRegion,
}))

import { getXeroToken, xeroFetch } from '../client'

beforeEach(() => {
  vi.restoreAllMocks()
  mocks.getXeroAccessToken.mockReset().mockResolvedValue('tok')
  mocks.xeroTenantIdForRegion.mockReset().mockResolvedValue('tenant-nz')
})

describe('getXeroToken', () => {
  it('delegates to the shared store (one app — region no longer selects credentials)', async () => {
    expect(await getXeroToken()).toBe('tok')
    expect(await getXeroToken('AU')).toBe('tok')
    expect(mocks.getXeroAccessToken).toHaveBeenCalledTimes(2)
  })
})

describe('xeroFetch', () => {
  function mockApiFetch(status = 200, jsonBody: unknown = { Quotes: [{ QuoteID: 'quote-1' }] }, textBody = '') {
    const f = vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300, status,
      json: async () => jsonBody, text: async () => textBody, headers: new Map(),
    })
    vi.stubGlobal('fetch', f)
    return f
  }

  it('sends Bearer token and ALWAYS sends Xero-tenant-id (resolved per region)', async () => {
    const f = mockApiFetch()
    await xeroFetch('/Quotes', { method: 'POST', idempotencyKey: 'order-1', body: '{}' })
    expect(mocks.xeroTenantIdForRegion).toHaveBeenCalledWith('NZ') // default region
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://api.xero.com/api.xro/2.0/Quotes')
    expect(init.headers.Authorization).toBe('Bearer tok')
    expect(init.headers['Xero-tenant-id']).toBe('tenant-nz')
    expect(init.headers['Idempotency-Key']).toBe('order-1')
  })

  it('resolves the AU tenant for region AU', async () => {
    mocks.xeroTenantIdForRegion.mockResolvedValue('tenant-au')
    const f = mockApiFetch()
    await xeroFetch('/Contacts', { region: 'AU' })
    expect(mocks.xeroTenantIdForRegion).toHaveBeenCalledWith('AU')
    expect(f.mock.calls[0][1].headers['Xero-tenant-id']).toBe('tenant-au')
  })

  it('throws with body text on non-2xx (unchanged contract)', async () => {
    mockApiFetch(400, {}, 'ValidationException')
    await expect(xeroFetch('/Quotes', { method: 'POST' })).rejects.toThrow(
      /Xero API 400 on \/Quotes: ValidationException/,
    )
  })

  it('propagates XeroNotConnectedError from tenant resolution (caught upstream as draft_failed)', async () => {
    const { XeroNotConnectedError } = await import('../token-store')
    mocks.xeroTenantIdForRegion.mockRejectedValue(new XeroNotConnectedError())
    mockApiFetch()
    await expect(xeroFetch('/Quotes')).rejects.toBeInstanceOf(XeroNotConnectedError)
  })
})
