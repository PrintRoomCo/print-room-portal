import { describe, it, expect } from 'vitest'
import { userFromClaims } from '../portal-data'

// getPortalUser reads a locally-verified JWT payload via getClaims() and
// reconstructs the minimal User shape its callers use. Only .id and .email are
// consumed anywhere in the portal, so those two mappings are the contract.
describe('userFromClaims', () => {
  it('maps sub -> id and email -> email (the only fields callers read)', () => {
    const user = userFromClaims({
      sub: 'user-123',
      email: 'buyer@example.com',
      aud: 'authenticated',
      role: 'authenticated',
      app_metadata: { provider: 'email' },
      user_metadata: { full_name: 'Buyer' },
    })
    expect(user?.id).toBe('user-123')
    expect(user?.email).toBe('buyer@example.com')
    expect(user?.aud).toBe('authenticated')
    expect(user?.role).toBe('authenticated')
  })

  it('returns null when the payload has no usable subject', () => {
    expect(userFromClaims(null)).toBeNull()
    expect(userFromClaims(undefined)).toBeNull()
    expect(userFromClaims({})).toBeNull()
    expect(userFromClaims({ sub: '' })).toBeNull()
    expect(userFromClaims({ sub: 123 as unknown as string })).toBeNull()
  })

  it('tolerates a missing email and array aud', () => {
    const user = userFromClaims({ sub: 'u1', aud: ['authenticated', 'other'] })
    expect(user?.id).toBe('u1')
    expect(user?.email).toBeUndefined()
    expect(user?.aud).toBe('authenticated')
    // Fields absent from the JWT default safely (no caller reads created_at).
    expect(user?.app_metadata).toEqual({})
    expect(user?.user_metadata).toEqual({})
  })
})
