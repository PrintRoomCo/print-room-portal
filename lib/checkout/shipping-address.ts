export interface NormalizedShippingAddress {
  name?: string
  email?: string
  phone?: string
  company?: string
  street?: string
  city?: string
  state?: string
  country?: string
  postalCode?: string
}

function clean(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

export function normalizeShippingAddress(
  value: Record<string, unknown> | NormalizedShippingAddress | null | undefined,
): NormalizedShippingAddress | null {
  if (!value || typeof value !== 'object') return null

  const raw = value as Record<string, unknown>
  const address: NormalizedShippingAddress = {
    name: clean(raw.name) ?? clean(raw.recipient),
    email: clean(raw.email),
    phone: clean(raw.phone),
    company: clean(raw.company),
    street: clean(raw.street) ?? clean(raw.address) ?? clean(raw.line1),
    city: clean(raw.city),
    state: clean(raw.state),
    country: clean(raw.country),
    postalCode:
      clean(raw.postalCode) ??
      clean(raw.postal_code) ??
      clean(raw.postcode) ??
      clean(raw.zip),
  }

  return Object.values(address).some(Boolean) ? address : null
}

export function formatShippingAddress(
  value: Record<string, unknown> | NormalizedShippingAddress | null | undefined,
): string | null {
  const address = normalizeShippingAddress(value)
  if (!address) return null

  const lines: string[] = []
  if (address.name) lines.push(address.name)
  if (address.company && address.company !== address.name) lines.push(address.company)
  if (address.street) lines.push(address.street)

  const locality = [address.city, address.state, address.postalCode].filter(Boolean).join(' ')
  if (locality) lines.push(locality)
  if (address.country) lines.push(address.country)

  return lines.length > 0 ? lines.join('\n') : null
}

const FREE_TEXT_COUNTRY: Record<string, string> = {
  'NEW ZEALAND': 'NZ',
  NEWZEALAND: 'NZ',
  NZL: 'NZ',
  AUSTRALIA: 'AU',
  AUS: 'AU',
}

/**
 * ISO 3166-1 alpha-2 code for a submitted country, tolerating the free-text
 * variants that existed before SP1 (same mapping as the stores.country
 * backfill migration). Null when unrecognisable — callers decide the failure.
 */
export function isoCountryOrNull(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim().toUpperCase()
  if (!value) return null
  if (/^[A-Z]{2}$/.test(value)) return value
  return FREE_TEXT_COUNTRY[value] ?? null
}
