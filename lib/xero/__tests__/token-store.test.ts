// lib/xero/__tests__/token-store.test.ts
//
// Node twin of the staff repo's supabase/functions/_shared/xero-token-store.test.ts
// (spec §5/§7). Same fake-DB suite, wired through the module-level test hooks
// instead of a returned store object. The fake DB emulates the lease RPC's
// atomicity: exactly one caller gets the refresh token while unclaimed.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getXeroAccessToken,
  xeroTenantIdForRegion,
  isXeroConnectedForRegion,
  __setXeroTokenStoreDepsForTests,
  __resetXeroTokenStoreForTests,
  XeroNotConnectedError,
  XeroRefreshError,
  XeroRefreshTimeoutError,
  type TokenStoreDb,
} from '../token-store'

interface FakeState {
  row: { access_token: string | null; access_token_expires_at: string | null } | null
  refreshToken: string
  leaseHeld: boolean
  completes: Array<{ refreshToken: string; accessToken: string; expiresAt: string }>
  failures: string[]
  regionMap: Record<string, string>
}

function makeState(overrides: Partial<FakeState> = {}): FakeState {
  return {
    row: { access_token: 'stale-token', access_token_expires_at: new Date(Date.now() - 1000).toISOString() },
    refreshToken: 'rt-0',
    leaseHeld: false,
    completes: [],
    failures: [],
    regionMap: { NZ: 'tenant-nz', AU: 'tenant-au' },
    ...overrides,
  }
}

function makeDb(state: FakeState): TokenStoreDb {
  return {
    readTokenRow: async () => (state.row ? { ...state.row } : null),
    readHealth: async () => null,
    // Mirrors xero_begin_refresh: claim ONLY if unclaimed AND (force or stale).
    beginRefresh: async (force) => {
      if (state.leaseHeld || !state.row) return null
      const exp = state.row.access_token_expires_at
      const fresh = state.row.access_token && exp && Date.parse(exp) - 60_000 > Date.now()
      if (!force && fresh) return null
      state.leaseHeld = true
      return state.refreshToken
    },
    completeRefresh: async (rt, at, exp) => {
      state.completes.push({ refreshToken: rt, accessToken: at, expiresAt: exp })
      state.row = { access_token: at, access_token_expires_at: exp }
      state.refreshToken = rt
      state.leaseHeld = false
    },
    failRefresh: async (code) => {
      state.failures.push(code)
      state.leaseHeld = false
    },
    tenantIdForRegion: async (region) => state.regionMap[region] ?? null,
  }
}

const okTokenResponse = { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 1800 }
const defaultEnv = (n: string) =>
  ({ XERO_OAUTH_CLIENT_ID: 'oauth-cid', XERO_OAUTH_CLIENT_SECRET: 'oauth-secret' })[n]

beforeEach(() => __resetXeroTokenStoreForTests())

function wireStore(state: FakeState, fetchFn: unknown, env: (n: string) => string | undefined = defaultEnv) {
  __setXeroTokenStoreDepsForTests({
    db: makeDb(state),
    fetchFn: fetchFn as typeof fetch,
    env,
    sleep: async () => {},
  })
}

describe('getXeroAccessToken', () => {
  it('no token row → XeroNotConnectedError (no HTTP)', async () => {
    const fetchFn = vi.fn()
    wireStore(makeState({ row: null }), fetchFn)
    await expect(getXeroAccessToken()).rejects.toBeInstanceOf(XeroNotConnectedError)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('fresh DB token → returned without refresh; second call hits the memory cache', async () => {
    const state = makeState({
      row: { access_token: 'fresh-at', access_token_expires_at: new Date(Date.now() + 600_000).toISOString() },
    })
    const fetchFn = vi.fn()
    const db = makeDb(state)
    const reads = vi.spyOn(db, 'readTokenRow')
    __setXeroTokenStoreDepsForTests({ db, fetchFn: fetchFn as typeof fetch, env: defaultEnv, sleep: async () => {} })
    expect(await getXeroAccessToken()).toBe('fresh-at')
    expect(await getXeroAccessToken()).toBe('fresh-at')
    expect(fetchFn).not.toHaveBeenCalled()
    expect(reads).toHaveBeenCalledTimes(1)
  })

  it('stale token → claims the lease, POSTs grant_type=refresh_token, stores the ROTATED pair', async () => {
    const state = makeState()
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200, json: async () => okTokenResponse }))
    wireStore(state, fetchFn)
    expect(await getXeroAccessToken()).toBe('at-1')
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, { body: string; headers: Record<string, string> }]
    expect(url).toBe('https://identity.xero.com/connect/token')
    expect(init.body).toContain('grant_type=refresh_token')
    expect(init.body).toContain('refresh_token=rt-0')
    expect(init.headers.Authorization).toMatch(/^Basic /)
    expect(state.completes).toEqual([expect.objectContaining({ refreshToken: 'rt-1', accessToken: 'at-1' })])
  })

  it('RACE: two concurrent callers → exactly ONE Xero refresh (fails if the lease guard is removed)', async () => {
    const state = makeState()
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200, json: async () => okTokenResponse }))
    wireStore(state, fetchFn)
    const [a, b] = await Promise.all([getXeroAccessToken(), getXeroAccessToken()])
    expect(a).toBe('at-1')
    expect(b).toBe('at-1')
    expect(fetchFn).toHaveBeenCalledTimes(1) // ← the serialisation property
    expect(state.completes).toHaveLength(1)
  })

  it('loser whose winner never completes → XeroRefreshTimeoutError', async () => {
    wireStore(makeState({ leaseHeld: true }), vi.fn()) // someone else holds it forever
    await expect(getXeroAccessToken()).rejects.toBeInstanceOf(XeroRefreshTimeoutError)
  })

  it('Xero refresh failure → xero_fail_refresh(code) + XeroRefreshError carrying the CODE only', async () => {
    const state = makeState({ refreshToken: 'SECRET-REFRESH-TOKEN' })
    const fetchFn = vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) }))
    wireStore(state, fetchFn)
    const err = await getXeroAccessToken().then(
      () => { throw new Error('should have thrown') },
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(XeroRefreshError)
    expect((err as XeroRefreshError).errorCode).toBe('invalid_grant')
    // REDACTION: no token/secret material in the message, ever.
    expect(String(err)).not.toContain('SECRET-REFRESH-TOKEN')
    expect(String(err)).not.toContain('oauth-secret')
    expect(state.failures).toEqual(['invalid_grant'])
  })

  it('missing XERO_OAUTH_* env → refresh failure path (missing_client_credentials)', async () => {
    const state = makeState()
    wireStore(state, vi.fn(), () => undefined)
    await expect(getXeroAccessToken()).rejects.toBeInstanceOf(XeroRefreshError)
    expect(state.failures).toEqual(['missing_client_credentials'])
  })

  it('force refresh rotates even when the token is fresh (keep-alive)', async () => {
    const state = makeState({
      row: { access_token: 'fresh-at', access_token_expires_at: new Date(Date.now() + 600_000).toISOString() },
    })
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200, json: async () => okTokenResponse }))
    wireStore(state, fetchFn)
    expect(await getXeroAccessToken({ force: true })).toBe('at-1')
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })
})

describe('region exports', () => {
  it('xeroTenantIdForRegion returns the mapped tenant and throws XeroNotConnectedError when unmapped', async () => {
    const state = makeState({ regionMap: { NZ: 'tenant-nz' } })
    wireStore(state, vi.fn())
    expect(await xeroTenantIdForRegion('NZ')).toBe('tenant-nz')
    await expect(xeroTenantIdForRegion('AU')).rejects.toBeInstanceOf(XeroNotConnectedError)
  })
  it('isXeroConnectedForRegion is false with no token row', async () => {
    wireStore(makeState({ row: null }), vi.fn())
    expect(await isXeroConnectedForRegion('NZ')).toBe(false)
  })
})
