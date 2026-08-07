// lib/starshipit/destination.ts
//
// Fills the Starshipit destination company + recipient name for STORE orders so
// the printed packing slip reads "Company = branch, Name = orderer" (design A2).
// Custom-address orders are returned unchanged. Detection reads the RAW persisted
// shipping_address (which carries the store id); normalizeShippingAddress drops
// unknown keys, so the id discriminator is only visible before normalization.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { NormalizedShippingAddress } from '@/lib/checkout/shipping-address'

/** True when the persisted address is a store snapshot (carries a store id). */
export function isStoreShipment(raw: Record<string, unknown> | null): boolean {
  const id = (raw as { id?: unknown } | null)?.id
  return typeof id === 'string' && id.trim().length > 0
}

/**
 * Best-effort orderer name from quotes.customer_name. Returns null on error or
 * empty — the caller falls back to the branch name, never loses the push.
 */
export async function loadOrdererName(
  admin: SupabaseClient,
  quoteId: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from('quotes')
    .select('customer_name')
    .eq('id', quoteId)
    .maybeSingle()
  if (error || !data) return null
  const name = (data as { customer_name?: unknown }).customer_name
  return typeof name === 'string' && name.trim().length > 0 ? name.trim() : null
}

/**
 * Apply the branch=company / orderer=name rule for store shipments; return
 * custom-address shipments unchanged. Pure — takes the normalized address (the
 * fields sent) and the raw address (the store-id discriminator).
 */
export function resolveStarshipitDestination(args: {
  address: NormalizedShippingAddress
  rawAddress: Record<string, unknown> | null
  ordererName: string | null
}): NormalizedShippingAddress {
  if (!isStoreShipment(args.rawAddress)) return args.address
  return {
    ...args.address,
    company: args.address.name ?? args.address.company,
    name: args.ordererName ?? args.address.name,
  }
}
