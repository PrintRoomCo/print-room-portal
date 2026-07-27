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
  // Per-user B2B access slice (role, tier, stores, tenant, inventory presence).
  // Cross-request cached in getPortalCompanyAccess so repeat navigations skip
  // the ~6-query resolution. Backstopped by a short revalidate window; in-portal
  // mutations that change membership/stores should also revalidate this tag.
  companyAccess: 'company-access',
  // NZD exchange rate table — changes at most daily; safe to cache for an hour.
  exchangeRates: 'exchange-rates',
} as const

export const cacheRevalidate = {
  orderTracker: 60,
  accountData: 60,
  // Role/tier are security-relevant, so keep the backstop short. In-portal
  // membership/store mutations revalidate the tag for immediate propagation;
  // this window only covers changes made outside the portal (admin backend).
  companyAccess: 60,
  exchangeRates: 3600,
} as const
