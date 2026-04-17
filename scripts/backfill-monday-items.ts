/**
 * Backfill: populate `quote_data.items[]` for every job_tracker with a
 * `monday_item_id` by syncing from the Production board's subitems.
 *
 * Usage (from repo root):
 *   npx tsx scripts/backfill-monday-items.ts           # dry run (no writes)
 *   npx tsx scripts/backfill-monday-items.ts --write   # actually update rows
 *   npx tsx scripts/backfill-monday-items.ts --write --force
 *
 * --force also overwrites rows tagged `quote_data_source = 'submit-quote'`.
 * Default preserves them.
 *
 * Rate-limited to ~2 req/s to stay well below Monday's 500/min budget.
 */

import { getSupabaseServer } from '@/lib/supabase'
import { syncJobTrackerItemsFromMonday } from '@/lib/monday/sync-job-tracker-items'

const RATE_LIMIT_MS = 500

const args = new Set(process.argv.slice(2))
const WRITE = args.has('--write')
const FORCE = args.has('--force')

async function main() {
  const supabase = getSupabaseServer()

  const { data, error } = await supabase
    .from('job_trackers')
    .select('id, quote_data_source, monday_item_id')
    .not('monday_item_id', 'is', null)
    .order('id', { ascending: true })

  if (error) {
    console.error('[backfill] failed to list trackers:', error)
    process.exit(1)
  }

  const rows = data ?? []
  console.log(
    `[backfill] ${rows.length} trackers with monday_item_id (write=${WRITE}, force=${FORCE})`
  )

  const stats = { synced: 0, skipped: 0, failed: 0 }

  for (const row of rows) {
    const trackerId = Number(row.id)
    if (!WRITE) {
      console.log(`[dry] would sync tracker ${trackerId}`)
      stats.skipped += 1
      continue
    }

    try {
      const result = await syncJobTrackerItemsFromMonday(trackerId, {
        force: FORCE,
      })
      if (result.synced) {
        stats.synced += 1
        console.log(
          `[ok] tracker=${trackerId} items=${result.itemCount ?? 0}` +
            (result.warnings?.length ? ` warnings=${result.warnings.length}` : '')
        )
      } else {
        stats.skipped += 1
        console.log(`[skip] tracker=${trackerId} reason=${result.reason}`)
      }
    } catch (err) {
      stats.failed += 1
      console.error(`[err] tracker=${trackerId}`, err)
    }

    await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_MS))
  }

  console.log('[backfill] done', stats)
}

main().catch((err) => {
  console.error('[backfill] fatal:', err)
  process.exit(1)
})
