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
