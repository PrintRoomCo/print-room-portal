// lib/xero/__tests__/client.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  getXeroAccessToken: vi.fn(),
  xeroTenantIdForCountry: vi.fn(),
}))
vi.mock('../token-store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../token-store')>()),
  getXeroAccessToken: mocks.getXeroAccessToken,
  xeroTenantIdForCountry: mocks.xeroTenantIdForCountry,
}))

import { getXeroToken, xeroFetch } from '../client'

beforeEach(() => {
  vi.restoreAllMocks()
  mocks.getXeroAccessToken.mockReset().mockResolvedValue('tok')
  mocks.xeroTenantIdForCountry.mockReset().mockResolvedValue('tenant-nz')
})

describe('getXeroToken', () => {
  it('delegates to the one shared OAuth token store', async () => {
    expect(await getXeroToken()).toBe('tok')
    expect(mocks.getXeroAccessToken).toHaveBeenCalledTimes(1)
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

  it('sends Bearer token and the tenant resolved for the required country', async () => {
    const f = mockApiFetch()
    await xeroFetch('/Quotes', {
      method: 'POST', countryCode: 'NZ', idempotencyKey: 'order-1', body: '{}',
    })
    expect(mocks.xeroTenantIdForCountry).toHaveBeenCalledWith('NZ')
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://api.xero.com/api.xro/2.0/Quotes')
    expect(init.headers.Authorization).toBe('Bearer tok')
    expect(init.headers['Xero-tenant-id']).toBe('tenant-nz')
    expect(init.headers['Idempotency-Key']).toBe('order-1')
  })

  it('resolves a third-country tenant without a branch', async () => {
    mocks.xeroTenantIdForCountry.mockResolvedValue('tenant-gb')
    const f = mockApiFetch()
    await xeroFetch('/Contacts', { countryCode: 'GB' })
    expect(mocks.xeroTenantIdForCountry).toHaveBeenCalledWith('GB')
    expect(f.mock.calls[0][1].headers['Xero-tenant-id']).toBe('tenant-gb')
  })

  it('throws with body text on non-2xx (unchanged contract)', async () => {
    mockApiFetch(400, {}, 'ValidationException')
    await expect(xeroFetch('/Quotes', { method: 'POST', countryCode: 'NZ' })).rejects.toThrow(
      /Xero API 400 on \/Quotes: ValidationException/,
    )
  })

  it('propagates XeroNotConnectedError from tenant resolution (caught upstream as draft_failed)', async () => {
    const { XeroNotConnectedError } = await import('../token-store')
    mocks.xeroTenantIdForCountry.mockRejectedValue(new XeroNotConnectedError())
    mockApiFetch()
    await expect(xeroFetch('/Quotes', { countryCode: 'GB' })).rejects.toBeInstanceOf(XeroNotConnectedError)
  })
})
