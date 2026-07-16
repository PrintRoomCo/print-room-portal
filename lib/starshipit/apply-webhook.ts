// lib/starshipit/apply-webhook.ts
import { randomUUID } from 'node:crypto'
import type { TrackingInfo, ProductionUpdate } from '@/lib/job-tracker'
import { mapStarshipitStatus } from './status'

export interface StarshipitWebhookPayload {
  order_number?: string
  tracking_number?: string
  tracking_status?: string
  carrier_name?: string
  carrier_service?: string
  shipment_date?: string
  tracking_url?: string
  last_updated_date?: string
}

export interface AppliedStarshipitWebhook {
  trackingInfo: TrackingInfo
  productionUpdate: ProductionUpdate
}

/**
 * Pure merge: fold a Starshipit webhook payload into the tracker's existing
 * tracking_info and produce a 'tracking' production_updates entry to append.
 * Mirrors the studio receiver's updatedTracking + trackingUpdate objects, but
 * stays inside the portal TrackingInfo shape (number/trackingNumber/url/carrier).
 */
export function applyStarshipitWebhook(
  existing: TrackingInfo | null,
  payload: StarshipitWebhookPayload,
): AppliedStarshipitWebhook {
  const prev = existing ?? {}
  const statusInfo = mapStarshipitStatus(payload.tracking_status)
  const nowIso = payload.last_updated_date || new Date().toISOString()

  const trackingInfo: TrackingInfo = {
    ...prev,
    number: payload.tracking_number || prev.number,
    trackingNumber: payload.tracking_number || prev.trackingNumber,
    url: payload.tracking_url || prev.url,
    carrier: payload.carrier_name || prev.carrier,
    updated_at: nowIso,
  }

  const productionUpdate: ProductionUpdate = {
    id: randomUUID(),
    type: 'tracking',
    title: statusInfo.label,
    body:
      `Shipment status: ${statusInfo.label}` +
      `${payload.carrier_name ? ` via ${payload.carrier_name}` : ''}` +
      `${payload.tracking_number ? ` (${payload.tracking_number})` : ''}`,
    changed_at: nowIso,
    source: 'system',
    metadata: {
      source: 'starshipit',
      tracking_status: payload.tracking_status,
      carrier_name: payload.carrier_name,
      tracking_number: payload.tracking_number,
    },
  }

  return { trackingInfo, productionUpdate }
}
