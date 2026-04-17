/**
 * Backfill: populate `design_approval_at`, `production_start_at`,
 * `production_complete_at` on `job_trackers` from existing `status_history`.
 *
 * The Monday webhook only started writing these milestone timestamps after
 * the PR6 fix — rows whose status transitioned before that still have the
 * history entries but null timestamp columns. This script reconstructs them
 * from the earliest matching entry for each canonical status_key, and only
 * ever sets a null column to a value (never overwrites).
 *
 * For entries that lack `status_key`, fall back to
 * `mapMondayToTrackerStatus(entry.status)` so legacy history still maps.
 *
 * Usage (from repo root):
 *   npx tsx scripts/backfill-status-milestones.ts           # dry run
 *   npx tsx scripts/backfill-status-milestones.ts --write   # apply updates
 */

import { getSupabaseServer } from '@/lib/supabase'
import { mapMondayToTrackerStatus } from '@/lib/monday/status-mappings'
import type { StatusHistoryEntry } from '@/lib/job-tracker'

const WRITE = process.argv.includes('--write')

const MILESTONE_BY_KEY: Record<string, 'design_approval_at' | 'production_start_at' | 'production_complete_at'> = {
  'proof-approved': 'design_approval_at',
  'in-production': 'production_start_at',
  dispatched: 'production_complete_at',
}

function resolveKey(entry: StatusHistoryEntry): string | null {
  if (entry.status_key) return entry.status_key
  return mapMondayToTrackerStatus(entry.status)
}

async function main() {
  const supabase = getSupabaseServer()

  const { data, error } = await supabase
    .from('job_trackers')
    .select(
      'id, status_history, design_approval_at, production_start_at, production_complete_at'
    )
    .not('status_history', 'is', null)
    .order('id', { ascending: true })

  if (error) {
    console.error('[backfill-milestones] query failed:', error)
    process.exit(1)
  }

  const rows = data ?? []
  console.log(`[backfill-milestones] ${rows.length} trackers, write=${WRITE}`)

  const stats = { scanned: 0, updated: 0, skipped: 0, failed: 0 }
  const fieldCounts = {
    design_approval_at: 0,
    production_start_at: 0,
    production_complete_at: 0,
  }

  for (const row of rows) {
    stats.scanned += 1

    const history = Array.isArray(row.status_history)
      ? (row.status_history as StatusHistoryEntry[])
      : []
    if (history.length === 0) {
      stats.skipped += 1
      continue
    }

    const earliest: Partial<Record<string, string>> = {}
    for (const entry of history) {
      const key = resolveKey(entry)
      if (!key || !(key in MILESTONE_BY_KEY)) continue
      if (!entry.changed_at) continue
      if (earliest[key] && earliest[key]! <= entry.changed_at) continue
      earliest[key] = entry.changed_at
    }

    const patch: Record<string, string> = {}
    for (const [key, column] of Object.entries(MILESTONE_BY_KEY)) {
      const candidate = earliest[key]
      if (!candidate) continue
      if (row[column]) continue
      patch[column] = candidate
    }

    if (Object.keys(patch).length === 0) {
      stats.skipped += 1
      continue
    }

    for (const col of Object.keys(patch)) {
      fieldCounts[col as keyof typeof fieldCounts] += 1
    }

    if (!WRITE) {
      console.log(`[dry] ${row.id}: would set`, patch)
      continue
    }

    const { error: updateErr } = await supabase
      .from('job_trackers')
      .update(patch)
      .eq('id', row.id)

    if (updateErr) {
      stats.failed += 1
      console.error(`[backfill-milestones] ${row.id} failed:`, updateErr)
      continue
    }

    stats.updated += 1
    console.log(`[backfill-milestones] ${row.id} updated`, patch)
  }

  console.log('[backfill-milestones] done', { ...stats, fieldCounts })
}

main().catch((err) => {
  console.error('[backfill-milestones] fatal:', err)
  process.exit(1)
})
