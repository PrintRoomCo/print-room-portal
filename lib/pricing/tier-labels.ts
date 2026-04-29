/**
 * WS4 — Locked tier-name map.
 *
 * Tier 1 = Wholesale (10% off in price_tiers seed)
 * Tier 2 = Trade     (5%)
 * Tier 3 = Standard  (0% — list price)
 *
 * Naming locked per 2026-04-29 spec §9 decision #1. To change names later,
 * edit this file (v1) or move to a tier_labels settings table (v1.1).
 */
export const TIER_LABELS: Record<1 | 2 | 3, string> = {
  1: 'Wholesale',
  2: 'Trade',
  3: 'Standard',
}

/**
 * Look up the friendly label for a tier value.
 * Accepts the numeric tier (1/2/3) or its string form ("1"/"2"/"3").
 * Returns null for any unknown / non-tiered value (incl. 'Custom', 'bronze', null, undefined).
 */
export function getTierLabel(
  tier: number | string | null | undefined
): string | null {
  if (tier === null || tier === undefined) return null
  const n = typeof tier === 'string' ? Number(tier) : tier
  if (!Number.isInteger(n)) return null
  if (n === 1 || n === 2 || n === 3) return TIER_LABELS[n]
  return null
}
