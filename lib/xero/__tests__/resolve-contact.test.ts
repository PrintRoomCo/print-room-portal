// lib/xero/__tests__/resolve-contact.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../client', () => ({ xeroFetch: vi.fn() }))
import { xeroFetch } from '../client'
import { resolveXeroContactId } from '../draft-invoice'

const mockFetch = vi.mocked(xeroFetch)
beforeEach(() => vi.resetAllMocks())

describe('resolveXeroContactId', () => {
  it('uses the cached contact id without any API call', async () => {
    const r = await resolveXeroContactId({ cachedContactId: 'cached-1', orgName: 'Acme', email: null })
    expect(r).toEqual({ contactId: 'cached-1', created: false })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('uses a single name match', async () => {
    mockFetch.mockResolvedValueOnce({ Contacts: [{ ContactID: 'found-1' }] })
    const r = await resolveXeroContactId({ cachedContactId: null, orgName: 'Acme', email: null })
    expect(r).toEqual({ contactId: 'found-1', created: false })
    expect(mockFetch.mock.calls[0][0]).toContain('/Contacts?where=')
  })

  it('creates a contact when none matches', async () => {
    mockFetch
      .mockResolvedValueOnce({ Contacts: [] }) // name lookup: none
      .mockResolvedValueOnce({ Contacts: [{ ContactID: 'new-1' }] }) // create
    const r = await resolveXeroContactId({ cachedContactId: null, orgName: 'Acme', email: 'ap@acme.test' })
    expect(r).toEqual({ contactId: 'new-1', created: true })
    const [, init] = mockFetch.mock.calls[1]
    expect(init.method).toBe('POST')
    expect(init.body).toContain('"Name":"Acme"')
    expect(init.body).toContain('"EmailAddress":"ap@acme.test"')
  })

  it('recovers from a unique-name collision by re-querying', async () => {
    mockFetch
      .mockResolvedValueOnce({ Contacts: [] }) // name lookup: none (race)
      .mockRejectedValueOnce(new Error('Xero API 400 on /Contacts: contact name must be unique'))
      .mockResolvedValueOnce({ Contacts: [{ ContactID: 'raced-1' }] }) // re-query wins
    const r = await resolveXeroContactId({ cachedContactId: null, orgName: 'Acme', email: null })
    expect(r).toEqual({ contactId: 'raced-1', created: false })
  })

  it('rethrows when create fails and re-query still finds nothing', async () => {
    mockFetch
      .mockResolvedValueOnce({ Contacts: [] })
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ Contacts: [] })
    await expect(resolveXeroContactId({ cachedContactId: null, orgName: 'Acme', email: null })).rejects.toThrow('boom')
  })
})
