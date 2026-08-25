// lib/xero/token-store.ts — Node twin of the staff repo's
// supabase/functions/_shared/xero-token-store.ts; keep the cores in lockstep.
//
// Shared token store for the single standard Xero OAuth app (spec §5).
// Every dependency of the core is injected (db port, fetch, env, clock, sleep)
// so the contract is identical to the Deno twin and unit-tests the same way.
//
// SECURITY: refresh/access tokens must NEVER appear in a thrown message, log,
// or audit payload. Errors carry Xero's OAuth error CODE only.

// Node-only import — the shared core below stays runtime-agnostic.
import { getSupabaseServer } from '@/lib/supabase'

export class XeroNotConnectedError extends Error {
  code = 'not_connected'
  constructor() {
    super('Xero is not connected')
    this.name = 'XeroNotConnectedError'
  }
}

export class XeroRefreshError extends Error {
  constructor(public errorCode: string) {
    super(`Xero token refresh failed: ${errorCode}`)
    this.name = 'XeroRefreshError'
  }
}

export class XeroRefreshTimeoutError extends Error {
  constructor() {
    super('Timed out waiting for a concurrent Xero token refresh')
    this.name = 'XeroRefreshTimeoutError'
  }
}

export interface XeroTokenRowSafe {
  access_token: string | null
  access_token_expires_at: string | null
}

export interface XeroTokenHealth {
  connected_at: string | null
  last_refreshed_at: string | null
  refresh_failed_at: string | null
  refresh_failure_count: number
  last_refresh_error_code: string | null
}

/** DB port over the singleton + connections tables and the lease RPCs.
 *  supabaseTokenStoreDb() adapts a service-role client; tests fake it. */
export interface TokenStoreDb {
  readTokenRow(): Promise<XeroTokenRowSafe | null>
  readHealth(): Promise<XeroTokenHealth | null>
  /** xero_begin_refresh: the refresh token when WE hold the lease, else null. */
  beginRefresh(force: boolean): Promise<string | null>
  completeRefresh(refreshToken: string, accessToken: string, expiresAt: string): Promise<void>
  failRefresh(errorCode: string): Promise<void>
  tenantIdForCountry(countryCode: string): Promise<string | null>
}

export interface TokenStoreDeps {
  db: TokenStoreDb
  fetchFn: typeof fetch
  env: (name: string) => string | undefined
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token'
const FRESH_MARGIN_MS = 60_000
const POLL_INTERVAL_MS = 250
const POLL_ATTEMPTS = 20 // ≤5s (spec §5 step 3)

export function createXeroTokenStore(deps: TokenStoreDeps) {
  const now = deps.now ?? (() => Date.now())
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  let cached: { accessToken: string; expiresAt: number } | null = null

  function cacheIfFresh(row: XeroTokenRowSafe): string | null {
    if (!row.access_token || !row.access_token_expires_at) return null
    const expiresAt = Date.parse(row.access_token_expires_at)
    if (Number.isNaN(expiresAt) || expiresAt - FRESH_MARGIN_MS <= now()) return null
    cached = { accessToken: row.access_token, expiresAt }
    return row.access_token
  }

  async function refreshWithLease(refreshToken: string): Promise<string> {
    const clientId = deps.env('XERO_OAUTH_CLIENT_ID') ?? ''
    const clientSecret = deps.env('XERO_OAUTH_CLIENT_SECRET') ?? ''
    if (!clientId || !clientSecret) {
      // A missing secret is a refresh failure (audited by callers, spec §6) —
      // release the lease so the next attempt isn't blocked for 30s.
      await deps.db.failRefresh('missing_client_credentials')
      throw new XeroRefreshError('missing_client_credentials')
    }
    let res: { ok: boolean; status: number; json(): Promise<unknown> }
    try {
      res = await deps.fetchFn(XERO_TOKEN_URL, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
      })
    } catch {
      await deps.db.failRefresh('network_error')
      throw new XeroRefreshError('network_error')
    }
    if (!res.ok) {
      // Xero OAuth errors are JSON like {"error":"invalid_grant"} — surface the
      // CODE only; never body text (defence against echoed parameters).
      let code = `http_${res.status}`
      try {
        const body = (await res.json()) as { error?: unknown }
        if (body && typeof body.error === 'string') code = body.error
      } catch { /* keep http_<status> */ }
      await deps.db.failRefresh(code)
      throw new XeroRefreshError(code)
    }
    const json = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number }
    if (!json.access_token || !json.refresh_token) {
      await deps.db.failRefresh('malformed_token_response')
      throw new XeroRefreshError('malformed_token_response')
    }
    const expiresAtMs = now() + (json.expires_in ?? 1800) * 1000
    await deps.db.completeRefresh(json.refresh_token, json.access_token, new Date(expiresAtMs).toISOString())
    cached = { accessToken: json.access_token, expiresAt: expiresAtMs }
    return json.access_token
  }

  return {
    /** §5 steps 1-3. { force: true } (keep-alive) rotates even when fresh. */
    async getAccessToken(opts: { force?: boolean } = {}): Promise<string> {
      if (!opts.force) {
        if (cached && cached.expiresAt - FRESH_MARGIN_MS > now()) return cached.accessToken
        const row = await deps.db.readTokenRow()
        if (!row) throw new XeroNotConnectedError()
        const fresh = cacheIfFresh(row)
        if (fresh) return fresh
      } else if (!(await deps.db.readTokenRow())) {
        throw new XeroNotConnectedError()
      }
      const claimed = await deps.db.beginRefresh(opts.force ?? false)
      if (claimed !== null) return refreshWithLease(claimed)
      // Zero rows: another process holds the lease (or already refreshed).
      // Poll the row briefly and use the winner's token.
      for (let i = 0; i < POLL_ATTEMPTS; i++) {
        const row = await deps.db.readTokenRow()
        if (!row) throw new XeroNotConnectedError()
        const fresh = cacheIfFresh(row)
        if (fresh) return fresh
        await sleep(POLL_INTERVAL_MS)
      }
      throw new XeroRefreshTimeoutError()
    },

    /** §5 step 4: null = not connected (no token row, or country unassigned). */
    async connectionForCountry(countryCode: string): Promise<{ tenantId: string } | null> {
      const [row, tenantId] = await Promise.all([
        deps.db.readTokenRow(),
        deps.db.tenantIdForCountry(countryCode),
      ])
      if (!row || !tenantId) return null
      return { tenantId }
    },

    /** Keep-alive check reads (safe columns only — never token columns). */
    readHealth(): Promise<XeroTokenHealth | null> {
      return deps.db.readHealth()
    },

    __resetCacheForTests(): void {
      cached = null
    },
  }
}

export type XeroTokenStore = ReturnType<typeof createXeroTokenStore>

/** Structural client type so the core needs no supabase-js import (keeps it
 *  runtime-agnostic, matching the Deno twin). supabase-js satisfies it. */
export interface TokenStoreClient {
  from(table: string): {
    select(cols: string): {
      eq(col: string, v: unknown): {
        maybeSingle(): Promise<{ data: unknown; error: { message: string } | null }>
      }
    }
  }
  rpc(fn: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }> | PromiseLike<{ data: unknown; error: { message: string } | null }>
}

export function supabaseTokenStoreDb(client: TokenStoreClient): TokenStoreDb {
  return {
    async readTokenRow() {
      const { data, error } = await client
        .from('xero_oauth_tokens')
        .select('access_token, access_token_expires_at')
        .eq('id', 1)
        .maybeSingle()
      if (error) throw new Error(`xero_oauth_tokens read failed: ${error.message}`)
      return (data as XeroTokenRowSafe | null) ?? null
    },
    async readHealth() {
      const { data, error } = await client
        .from('xero_oauth_tokens')
        .select('connected_at, last_refreshed_at, refresh_failed_at, refresh_failure_count, last_refresh_error_code')
        .eq('id', 1)
        .maybeSingle()
      if (error) throw new Error(`xero_oauth_tokens health read failed: ${error.message}`)
      return (data as XeroTokenHealth | null) ?? null
    },
    async beginRefresh(force) {
      const { data, error } = await client.rpc('xero_begin_refresh', { p_force: force })
      if (error) throw new Error(`xero_begin_refresh failed: ${error.message}`)
      const rows = (data as Array<{ refresh_token: string }> | null) ?? []
      return rows.length ? rows[0].refresh_token : null
    },
    async completeRefresh(refreshToken, accessToken, expiresAt) {
      const { error } = await client.rpc('xero_complete_refresh', {
        p_refresh_token: refreshToken,
        p_access_token: accessToken,
        p_expires_at: expiresAt,
      })
      // Deliberately parameter-free message: a PostgREST error string must
      // never carry the rotated pair.
      if (error) throw new Error('xero_complete_refresh failed')
    },
    async failRefresh(errorCode) {
      const { error } = await client.rpc('xero_fail_refresh', { p_error_code: errorCode })
      if (error) console.error('xero_fail_refresh failed', { errorCode })
    },
    async tenantIdForCountry(countryCode) {
      const { data, error } = await client
        .from('xero_connections')
        .select('tenant_id')
        .eq('country_code', countryCode)
        .maybeSingle()
      if (error) throw new Error(`xero_connections read failed: ${error.message}`)
      return (data as { tenant_id: string } | null)?.tenant_id ?? null
    },
  }
}

// ── Node singleton wiring (keeps getXeroToken/xeroFetch signatures intact) ──

let _store: XeroTokenStore | null = null
let _testDeps: Partial<TokenStoreDeps> | null = null

function store(): XeroTokenStore {
  if (!_store) {
    _store = createXeroTokenStore({
      db: _testDeps?.db ?? supabaseTokenStoreDb(getSupabaseServer() as unknown as TokenStoreClient),
      fetchFn: _testDeps?.fetchFn ?? fetch,
      env: _testDeps?.env ?? ((name) => process.env[name]),
      now: _testDeps?.now,
      sleep: _testDeps?.sleep,
    })
  }
  return _store
}

/** Test-only: inject fakes; the next call rebuilds the store around them. */
export function __setXeroTokenStoreDepsForTests(deps: Partial<TokenStoreDeps>): void {
  _testDeps = deps
  _store = null
}

/** Test-only: drop fakes AND the cached store/token. */
export function __resetXeroTokenStoreForTests(): void {
  _testDeps = null
  _store = null
}

export async function getXeroAccessToken(opts?: { force?: boolean }): Promise<string> {
  return store().getAccessToken(opts ?? {})
}

export async function xeroTenantIdForCountry(countryCode: string): Promise<string> {
  const connection = await store().connectionForCountry(countryCode)
  if (!connection) throw new XeroNotConnectedError()
  return connection.tenantId
}

export async function isXeroConnectedForCountry(countryCode: string): Promise<boolean> {
  return (await store().connectionForCountry(countryCode)) !== null
}
