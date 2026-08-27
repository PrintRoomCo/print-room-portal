'use client'

import { useEffect, useMemo, useState } from 'react'

const EMPTY: ReadonlySet<string> = new Set()

export interface PeriodMembership {
  /** Cart catalogue item ids that belong to the org's open ordering period. */
  preOrderItemIds: ReadonlySet<string>
  /** True until the lookup resolves. Callers must not hard-block while true. */
  loading: boolean
}

/**
 * Which cart items are pre-order period items.
 *
 * /api/period/summary returns rows from period_progress_for_org filtered to the
 * requested ids, so an item appearing in `items` IS in the open period. The qty
 * we send is irrelevant to membership, so it is fixed at 1.
 *
 * Note: PeriodSavingsBar issues the same GET for its savings copy. Collapsing the
 * two would mean making that component presentational and rewriting its tests —
 * out of scope here. See the follow-ups in the plan.
 */
export function usePeriodSummary(
  catalogueItemIds: ReadonlyArray<string>,
): PeriodMembership {
  const key = useMemo(
    () => [...new Set(catalogueItemIds)].sort().join('|'),
    [catalogueItemIds],
  )
  const [settled, setSettled] = useState<{ key: string; ids: ReadonlySet<string> }>({
    key: '',
    ids: EMPTY,
  })

  useEffect(() => {
    if (!key) return
    const controller = new AbortController()
    const params = new URLSearchParams()
    for (const id of key.split('|')) params.append('item', `${id}:1`)

    fetch(`/api/period/summary?${params.toString()}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { items?: Array<{ catalogueItemId: string }> } | null) => {
        if (controller.signal.aborted) return
        setSettled({
          key,
          ids: new Set((body?.items ?? []).map((item) => item.catalogueItemId)),
        })
      })
      // A failed lookup leaves `loading` true, which downgrades a block to a
      // warning. Erring toward "do not block" is the whole point of this layer.
      .catch(() => {})

    return () => controller.abort()
  }, [key])

  if (!key) return { preOrderItemIds: EMPTY, loading: false }
  return settled.key === key
    ? { preOrderItemIds: settled.ids, loading: false }
    : { preOrderItemIds: EMPTY, loading: true }
}
