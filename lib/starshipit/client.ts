// lib/starshipit/client.ts
import { getStarshipitCredentials } from './config'
import type { NormalizedShippingAddress } from '@/lib/checkout/shipping-address'

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
}

/**
 * Register an UNSHIPPED order in Starshipit at placement, carrying delivery
 * details only (no tracking number yet). When staff later mark it Shipped in
 * Starshipit, the carrier tracking number flows back via the portal webhook.
 *
 * Endpoint: POST /api/orders. NB the studio only exercises POST
 * /api/orders/shipped (needs an existing tracking_number); the create-order
 * destination field names + response path below MUST be confirmed against
 * Starshipit's live API docs before STARSHIPIT_ENABLED is turned on
 * (see Decision gate). Dark-by-default guarantees this never runs in prod first.
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
        suburb: a.city ?? '',
        state: a.state ?? '',
        post_code: a.postalCode ?? '',
        country: a.country ?? 'New Zealand',
        phone: a.phone ?? '',
        email: args.customerEmail ?? a.email ?? '',
        company: a.company ?? '',
      },
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
