/**
 * Sync Monday Production subitems → `job_trackers.quote_data.items[]`.
 *
 * Idempotent: never overwrites a row that was populated by the higher-fidelity
 * submit-quote path unless `opts.force` is set.
 */

import { getSupabaseServer } from '@/lib/supabase'
import type { QuoteData } from '@/lib/job-tracker'
import { PRODUCTION_BOARD_ID } from './column-ids'
import { fetchProductionProjectWithSubitems } from './subitems'
import {
  transformSubitemsToQuoteData,
  type TransformLookups,
} from './transform-subitems-to-quote-data'

export interface SyncResult {
  synced: boolean
  reason?: string
  itemCount?: number
  warnings?: string[]
}

interface CachedLookups {
  lookups: TransformLookups
  loadedAt: number
}

const LOOKUP_TTL_MS = 15 * 60 * 1000
let cachedLookups: CachedLookups | null = null

async function loadTransformLookups(): Promise<TransformLookups> {
  const now = Date.now()
  if (cachedLookups && now - cachedLookups.loadedAt < LOOKUP_TTL_MS) {
    return cachedLookups.lookups
  }

  const supabase = getSupabaseServer()

  const [swatchesRes, productsRes] = await Promise.all([
    supabase
      .from('product_color_swatches')
      .select('label, hex')
      .not('hex', 'is', null),
    supabase
      .from('products')
      .select('id, sku')
      .not('sku', 'is', null),
  ])

  const colorHexByName: Record<string, string> = {}
  for (const row of swatchesRes.data ?? []) {
    const label = (row as { label?: string | null }).label
    const hex = (row as { hex?: string | null }).hex
    if (!label || !hex) continue
    const key = label.toLowerCase().trim()
    if (key && !colorHexByName[key]) colorHexByName[key] = hex
  }

  const skuToProductId: Record<string, string> = {}
  for (const row of productsRes.data ?? []) {
    const id = (row as { id?: string | null }).id
    const sku = (row as { sku?: string | null }).sku
    if (!id || !sku) continue
    skuToProductId[sku.toUpperCase().trim()] = id
  }

  cachedLookups = {
    lookups: { colorHexByName, skuToProductId },
    loadedAt: now,
  }
  return cachedLookups.lookups
}

export function clearMondayItemsSyncCache() {
  cachedLookups = null
}

export async function syncJobTrackerItemsFromMonday(
  trackerId: number,
  opts: { force?: boolean } = {}
): Promise<SyncResult> {
  const supabase = getSupabaseServer()

  const { data: tracker, error: loadErr } = await supabase
    .from('job_trackers')
    .select(
      'id, monday_item_id, quote_data, quote_data_source, monday_items_synced_at'
    )
    .eq('id', trackerId)
    .maybeSingle()

  if (loadErr || !tracker) {
    return { synced: false, reason: 'tracker not found' }
  }

  if (!tracker.monday_item_id) {
    return { synced: false, reason: 'no monday_item_id' }
  }

  if (tracker.quote_data_source === 'submit-quote' && !opts.force) {
    return { synced: false, reason: 'submit-quote source' }
  }

  const snapshot = await fetchProductionProjectWithSubitems(
    Number(tracker.monday_item_id)
  )
  if (!snapshot) {
    return { synced: false, reason: 'monday item not found' }
  }

  const lookups = await loadTransformLookups()
  const transformed = transformSubitemsToQuoteData(snapshot, lookups)

  if (transformed.warnings.length > 0) {
    console.warn(
      `[MondayItemsSync] tracker=${trackerId} warnings:`,
      transformed.warnings
    )
  }

  const existing = (tracker.quote_data ?? {}) as QuoteData
  const merged: QuoteData = {
    ...existing,
    items: transformed.items,
    summary: existing.summary ?? transformed.summary,
  }

  const { error: updateErr } = await supabase
    .from('job_trackers')
    .update({
      quote_data: merged,
      quote_data_source: 'monday-subitems',
      monday_items_synced_at: new Date().toISOString(),
      monday_board_id: PRODUCTION_BOARD_ID,
    })
    .eq('id', trackerId)

  if (updateErr) {
    console.error(
      `[MondayItemsSync] tracker=${trackerId} update failed:`,
      updateErr
    )
    return { synced: false, reason: 'update failed' }
  }

  return {
    synced: true,
    itemCount: transformed.items.length,
    warnings: transformed.warnings,
  }
}
