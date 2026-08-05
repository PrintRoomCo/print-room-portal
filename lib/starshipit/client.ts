// lib/starshipit/client.ts
import { getStarshipitCredentials } from './config'
import type { NormalizedShippingAddress } from '@/lib/checkout/shipping-address'
import type { StarshipitOrderItem } from './items'

const BASE_URL = 'https://api.starshipit.com'

/** Auth headers — copied from print-room-studio/apps/job-tracker/lib/starshipit.js getHeaders(). */
function getHeaders(): Record<string, string> {
  const { apiKey, subscriptionKey } = getStarshipitCredentials()
  return {
    'StarShipIT-Api-Key': apiKey,
    'Ocp-Apim-Subscription-Key': subscriptionKey,
    'Content-Type': 'application/json',
  }
}

export interface CreateStarshipitOrderArgs {
  /** order_ref — also the job_trackers.job_reference the webhook matches on. */
  orderNumber: string
  address: NormalizedShippingAddress
  customerEmail: string | null
  /** Line items for the printed ticket/packing slip (design D5). Optional. */
  items?: StarshipitOrderItem[]
}

/**
 * Register an UNSHIPPED order in Starshipit at placement, carrying delivery
 * details only (no tracking number yet). When staff later mark it Shipped in
 * Starshipit, the carrier tracking number flows back via the portal webhook.
 *
 * Endpoint: POST /api/orders. Payload field names + response path VERIFIED
 * against the live account 2026-08-06 — see "P0 findings" in
 * docs/superpowers/specs/2026-08-06-starshipit-order-push-design.md.
 *
 * @returns Starshipit order id string, or null on a handled non-2xx.
 */
export async function createStarshipitOrder(
  args: CreateStarshipitOrderArgs,
): Promise<string | null> {
  const a = args.address
  const payload = {
    order: {
      order_number: args.orderNumber,
      destination: {
        name: a.name ?? '',
        street: a.street ?? '',
        // The portal address model has one locality field; send it as both
        // suburb (NZ courier convention) and city — P0 confirmed both fields
        // are accepted and the address validates.
        suburb: a.city ?? '',
        city: a.city ?? '',
        state: a.state ?? '',
        post_code: a.postalCode ?? '',
        country: a.country ?? 'New Zealand',
        phone: a.phone ?? '',
        email: args.customerEmail ?? a.email ?? '',
        company: a.company ?? '',
      },
      ...(args.items && args.items.length > 0 ? { items: args.items } : {}),
    },
  }

  const response = await fetch(`${BASE_URL}/api/orders`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(payload),
  })
  const data = (await response.json().catch(() => ({}))) as {
    success?: boolean
    order?: { order_id?: number | string }
  }
  if (!response.ok || !data.success) {
    console.error('[starshipit] createStarshipitOrder failed:', response.status, JSON.stringify(data))
    return null
  }
  return data.order?.order_id != null ? String(data.order.order_id) : null
}

/**
 * Remove an order from the Starshipit queue (delete-on-cancel, design D7/P3).
 * Endpoint: DELETE /api/orders/delete?order_id={id} — VERIFIED against the
 * live account 2026-08-06 (P0 findings: HTTP 200, { success: true }).
 * @returns true when Starshipit confirms deletion; false on a handled non-2xx.
 */
export async function deleteStarshipitOrder(starshipitOrderId: string): Promise<boolean> {
  const response = await fetch(
    `${BASE_URL}/api/orders/delete?order_id=${encodeURIComponent(starshipitOrderId)}`,
    { method: 'DELETE', headers: getHeaders() },
  )
  const data = (await response.json().catch(() => ({}))) as { success?: boolean }
  if (!response.ok || !data.success) {
    console.error('[starshipit] deleteStarshipitOrder failed:', response.status, JSON.stringify(data))
    return false
  }
  return true
}
