/**
 * Cache tag helpers for unstable_cache / revalidateTag wiring.
 *
 * unstable_cache only accepts static tags at registration, so we use
 * coarse-grained tags that invalidate every user's slice of a given
 * dataset. Per-user precision needs `cacheTag()` inside `'use cache'`
 * which requires `cacheComponents: true` — out of scope here.
 *
 * Mutation handlers should call `revalidateTag(tag, { expire: 0 })` —
 * the single-arg `revalidateTag(tag)` form is deprecated in Next 16.
 */
export const cacheTags = {
  orderTracker: 'order-tracker',
  accountData: 'account-data',
} as const

export const cacheRevalidate = {
  orderTracker: 60,
  accountData: 60,
} as const
