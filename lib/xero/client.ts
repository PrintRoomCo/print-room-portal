// lib/xero/client.ts
import { getXeroConfig, type XeroRegion } from './config'

const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token'
const XERO_API_BASE = 'https://api.xero.com/api.xro/2.0'

interface CachedToken {
  accessToken: string
  expiresAt: number // epoch ms
}
// Cached PER clientId — an NZ token must never serve an AU call (they are
// different Xero organisations). NEVER logged.
const cachedByClientId = new Map<string, CachedToken>()

/** Test-only: clear the module-scope token cache. */
export function __resetXeroTokenCacheForTests(): void {
  cachedByClientId.clear()
}

/** Get a valid access token for the region's connection, refreshing within 60s
 *  of expiry. Cached PER clientId — an NZ token must never serve an AU call. */
export async function getXeroToken(region: XeroRegion = 'NZ'): Promise<string> {
  const cfg = getXeroConfig(region)
  const now = Date.now()
  const cached = cachedByClientId.get(cfg.clientId)
  if (cached && cached.expiresAt - 60_000 > now) return cached.accessToken

  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')
  const body = new URLSearchParams({ grant_type: 'client_credentials', scope: cfg.scopes })

  const res = await fetch(XERO_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Xero token HTTP ${res.status}: ${text}`)
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number }
  if (!json.access_token) throw new Error('Xero token response missing access_token')

  cachedByClientId.set(cfg.clientId, {
    accessToken: json.access_token,
    expiresAt: now + (json.expires_in ?? 1800) * 1000,
  })
  return json.access_token
}

export interface XeroFetchInit extends Omit<RequestInit, 'headers'> {
  headers?: Record<string, string>
  /** Sent as the Xero `Idempotency-Key` header on writes. */
  idempotencyKey?: string
  /** AU Stage 1 — which Xero connection to authenticate against. Default NZ. */
  region?: XeroRegion
}

/** Authenticated JSON fetch against the Xero Accounting API. Throws on non-2xx. */
export async function xeroFetch<T = unknown>(path: string, init: XeroFetchInit = {}): Promise<T> {
  const { idempotencyKey, headers: extraHeaders, region, ...rest } = init
  const cfg = getXeroConfig(region ?? 'NZ')
  const token = await getXeroToken(region ?? 'NZ')

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(cfg.tenantId ? { 'Xero-tenant-id': cfg.tenantId } : {}),
    ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    ...(extraHeaders ?? {}),
  }

  const res = await fetch(`${XERO_API_BASE}${path}`, { ...rest, headers })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Xero API ${res.status} on ${path}: ${text}`)
  }
  return (await res.json()) as T
}
