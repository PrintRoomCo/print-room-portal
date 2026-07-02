// lib/monday/updates.ts
import { mondayApiCall } from './client'

/**
 * Post an update (comment) on a Monday item. Used to surface a manual-invoice
 * flag on an order's Production card. Throws on API error — callers wrap it
 * best-effort.
 */
export async function postItemUpdate(itemId: string, body: string): Promise<string | null> {
  const query = `
    mutation ($itemId: ID!, $body: String!) {
      create_update(item_id: $itemId, body: $body) { id }
    }
  `
  const data = await mondayApiCall<{ create_update: { id: string } | null }>(query, { itemId, body })
  return data.create_update?.id ?? null
}
