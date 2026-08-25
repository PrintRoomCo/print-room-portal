// lib/xero/client.ts
import { getXeroAccessToken, xeroTenantIdForCountry } from './token-store'

const XERO_API_BASE = 'https://api.xero.com/api.xro/2.0'

/** Get a valid access token. One standard OAuth app covers every country. */
export async function getXeroToken(): Promise<string> {
  return getXeroAccessToken()
}

export interface XeroFetchInit extends Omit<RequestInit, 'headers'> {
  headers?: Record<string, string>
  /** Sent as the Xero `Idempotency-Key` header on writes. */
  idempotencyKey?: string
  /** Exact billing country whose organisation receives the request. */
  countryCode: string
}

/** Authenticated JSON fetch against the Xero Accounting API. Throws on non-2xx.
 *  Xero-tenant-id is mandatory — an unassigned country throws
 *  XeroNotConnectedError before any HTTP leaves the box. */
export async function xeroFetch<T = unknown>(path: string, init: XeroFetchInit): Promise<T> {
  const { idempotencyKey, headers: extraHeaders, countryCode, ...rest } = init
  const [token, tenantId] = await Promise.all([
    getXeroAccessToken(),
    xeroTenantIdForCountry(countryCode),
  ])

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'Xero-tenant-id': tenantId,
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
