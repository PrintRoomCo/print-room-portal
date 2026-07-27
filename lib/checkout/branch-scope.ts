export type BranchScopeResult =
  | { ok: true }
  | { ok: false; kind: 'out_of_scope'; mismatched: Array<string | null> }
  | { ok: false; kind: 'mixed_branch' }

/**
 * Pure staff buyer-scope check. Returns a RESULT (never throws) so this module
 * has zero dependency on the error classes in submit.ts — avoids a circular
 * import. submit.ts maps the result onto BuyerScopeError / MixedShippingAddressError.
 *
 * `allowedBranches` = resolveBranchStoreIds(grants, default); plain staff => [default],
 * so a zero-grant member is locked to their home branch exactly as today. A manager
 * (≥1 grant) may ship to any granted branch, but only ONE branch per order.
 */
export function checkStaffBranchScope(args: {
  shipToStoreIds: Array<string | null>
  allowedBranches: string[]
  allOneTimeLines: boolean
  hasCustomShippingAddress: boolean
}): BranchScopeResult {
  const allowed = new Set(args.allowedBranches)
  const mismatched = args.shipToStoreIds.filter((sid) => {
    if (sid === null && args.allOneTimeLines && args.hasCustomShippingAddress) return false
    return sid === null || !allowed.has(sid)
  })
  if (mismatched.length > 0) return { ok: false, kind: 'out_of_scope', mismatched }
  const distinct = new Set(args.shipToStoreIds.filter((s): s is string => s !== null))
  if (distinct.size > 1) return { ok: false, kind: 'mixed_branch' }
  return { ok: true }
}
