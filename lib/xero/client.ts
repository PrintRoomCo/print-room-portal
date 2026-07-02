// lib/xero/client.ts
import { getXeroConfig } from './config'

const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token'
const XERO_API_BASE = 'https://api.xero.com/api.xro/2.0'

interface CachedToken {
  accessToken: string
  expiresAt: number // epoch ms
}
let cached: CachedToken | null = null

/** Test-only: clear the module-scope token cache. */
export function __resetXeroTokenCacheForTests(): void {
  cached = null
}

/** Get a valid access token, refreshing when within 60s of expiry. */
export async function getXeroToken(): Promise<string> {
  const now = Date.now()
  if (cached && cached.expiresAt - 60_000 > now) return cached.accessToken

  const cfg = getXeroConfig()
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

  cached = {
    accessToken: json.access_token,
    expiresAt: now + (json.expires_in ?? 1800) * 1000,
  }
  return cached.accessToken
}

export interface XeroFetchInit extends Omit<RequestInit, 'headers'> {
  headers?: Record<string, string>
  /** Sent as the Xero `Idempotency-Key` header on writes. */
  idempotencyKey?: string
}

/** Authenticated JSON fetch against the Xero Accounting API. Throws on non-2xx. */
export async function xeroFetch<T = unknown>(path: string, init: XeroFetchInit = {}): Promise<T> {
  const { idempotencyKey, headers: extraHeaders, ...rest } = init
  const cfg = getXeroConfig()
  const token = await getXeroToken()

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
