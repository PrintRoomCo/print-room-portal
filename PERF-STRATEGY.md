# PERF-STRATEGY — customer-portal checkout fan-out + shared-DB debt

_Companion to [PERF-FINDINGS.md](./PERF-FINDINGS.md). Written 2026-07-14 on branch `perf/checkout-fanout`. **Nothing below is implemented yet** — this plan pauses here for review before any fix code lands._

## Baseline (red signal, from the Phase-1 harness)

`scripts/perf/checkout-fanout-harness.ts` runs the real `submitCustomerOrder` against live data (read-only by construction — every line carries a guaranteed-drift claim so the run throws `DecorationDriftError` before `submit_b2b_order`; the fetch wrapper additionally hard-blocks all writes).

| Fixture | Round-trips | Serialised | Wall-clock | Decoration loop |
|---|---|---|---|---|
| 1 line × 3 decorations | 13 | 11 | 446 ms | 2 RTs / 74 ms |
| 10 lines × 3 | 33 | 29 | 1,076 ms | 20 RTs / 703 ms |
| **40 lines × 3** | **93** | **89** | **3,806 ms** | **80 RTs / 3,264 ms** |

Cost model confirmed: **round-trips = 2N + ~13** (N = lines), all serialised, median RTT ≈ 40 ms vs ≈ 1–9 ms in-DB. The decoration loop is 86 % of wall-clock at N=40. Since all live catalogue items are `manual_final`, the per-line cost is 1 link-select + 1 `catalogue_item_decoration_price` RPC; the computed path (`effectiveDecorationPrice` + per-decoration tier lookup) is **dormant with current data but live code** — it must be fixed too or it reintroduces the same bug the day a computed item ships.

## Track A — checkout quick wins (portal code only, no DDL)

Ordered smallest-safest first; re-run the harness after each step. All three preserve drift semantics exactly: same error classes, same per-line entry order, same fallback rules (verified by characterization tests written *before* the refactor — see Test plan).

### A1. Batch the per-line decoration-link select — `submit.ts:715`

Collect every `linkId` across all lines up front; one `.in('id', allLinkIds).eq('is_published', true)` select; build a `Map<linkId, row>`; the per-line loop reads from memory. Mirrors the existing garment `Promise.all` pattern in spirit (fetch-then-map).

- Win: 40 → 1 round-trip (~1.6 s off the 40-line fixture).
- Risk: **low**. Same query shape, same filter; per-line validation (`detached` / `cross_org` / `inactive` / `wrong_item`) reads the same rows from a map instead of a fresh select. Duplicate linkIds across lines dedupe naturally (they re-fetch identical rows today). Chunk the `.in()` at 100 ids to keep the PostgREST URL bounded.
- Rollback: revert the commit; no schema or API surface touched.

### A2. Dedupe + parallelise the manual decoration price — `submit.ts:673`

`catalogue_item_decoration_price(p_catalogue_item_id, p_qty)` depends only on the line's catalogue item and its pooled decoration qty. On a 40-line uniform order there are only ~3 distinct `(item, qty)` pairs, yet we make 40 sequential calls. Precompute the distinct pairs, fetch them with one `Promise.all`, memoize in a `Map`; `applyManualDecorationForLine` reads the map and keeps its drift-compare logic byte-identical.

- Win: 40 → ~3 concurrent round-trips (~1.4 s off the fixture). Bounded by distinct tier-key pools, independent of line count.
- Risk: **low**. Same RPC, same args, same rounding path. Memoization removes a (theoretical) mid-submit price-change race rather than adding one.
- Rollback: revert the commit.

### A3. Fix the dormant computed path — `decoration-effective-price.ts` + `submit.ts:854`

1. Hoist `loadTierMultiplier` out of the loop: resolve once per submit (only when a computed line with decorations exists), pass it into `effectiveDecorationPrice`.
2. Price each line's decorations with `Promise.all`, collecting results in input order before pushing drift entries, so `DecorationDriftError.drift` ordering is unchanged.
3. Keep the existing resolution ladder (RPC → link override → base price → × tier) untouched.

- Win: none on today's traffic (path is dormant); prevents the O(2 × decorations) sequential regression from returning when computed items ship. Tier lookups per checkout become ≤ 1 (acceptance criterion).
- Risk: **low-medium** — this is the code with the richest fallback rules, hence characterization tests first.
- Rollback: revert the commit; `effectiveDecorationPrice`'s public signature can keep a default-null multiplier param for compatibility.

### A4 (design only, not for this branch). Single-round-trip reprice

Move the whole drift/reprice check inside `submit_b2b_order` (or a dedicated `validate_b2b_order` RPC): one round-trip total, closes the drift-check-vs-submit race window. Trade-offs: duplicates TS pricing logic into PL/pgSQL, couples both portals to a bigger RPC, harder to unit-test, and A1–A3 already get within budget. Recommendation: **defer**; revisit only if post-A1–A3 numbers disappoint or the drift race bites in practice.

### Expected end state (A1–A3)

~14–17 round-trips for any order size (fixed overhead ~11 + 1 link batch + ~3 concurrent price RPCs); projected wall-clock for the 40×3 fixture ≈ 0.6–0.8 s (fixed overhead measured at 0.45 s). Meets the < 1 s acceptance target; proven by re-running the same harness.

### Test plan (before any refactor)

1. **Characterization tests** (new `lib/checkout/__tests__/submit.drift-characterization.test.ts`, mock-client style copied from the existing `submit.*.test.ts` files): pin current behaviour for detached / cross-org / inactive / wrong-item links, computed price drift, manual drift (claimed ≠ server), manual claimed-null silent reprice, manual zero-decoration lines, legacy lines without `catalogueItemId`, RPC-null → override → base fallback ladder, and drift-entry ordering. Green before and after each of A1–A3.
2. **Round-trip regression test**: counting mock admin client; run `submitCustomerOrder` at N=3 and N=12 and assert: decoration-link selects = 1, manual price RPCs = distinct (item, qty) pairs, `b2b_accounts` tier lookups ≤ 1, all independent of N. This pins the fix so the fan-out can't silently return.
3. Existing suite (`npm test`) stays green throughout.

## Track B — shared-DB debt (staged SQL, dev-review only, nothing applied)

Every item below ships as a reviewable SQL file with an explicit rollback block, **not applied to the project** (no branching is enabled on this project; per guardrails, DDL waits for sign-off). Verified numbers in PERF-FINDINGS.md §4.

| # | Item | Expected win | Risk / rollback |
|---|---|---|---|
| B1 | Trim `supabase_realtime` publication (currently 6 tables: `design_snapshots`, `board_relation_links`, `comments`, `notifications`, `chat_conversations`, `chat_messages`) to only what a portal actually subscribes to | WAL decode is **79.4 % of all DB time** (23,297 s / 113 days) — by far the biggest DB-side lever | Low — `ALTER PUBLICATION ... DROP TABLE`; rollback = ADD TABLE back. First inventory actual `.channel()`/`postgres_changes` subscribers in both portals |
| B2 | Retune the two `* * * * *` pg_net crons (`uniforms-monday-sync-cron`, `b2b-worker-cron`) to `*/5`–`*/10` | **Modest** — verified pg_net footprint is ~3 % of DB time; the "millions of ops" are pg_net's own fixed-cadence cleanup, unaffected by cron frequency | Low — `cron.alter_job`; rollback = restore schedule. Needs a product answer: is 1-min sync latency required? |
| B3 | `_bak_`/backup tables (100 of 294 public tables; 97 RLS-off, plus `demo_rewire_map_20260611`): revoke anon/authenticated or move to a private `archive` schema | Closes the anon-key PII exposure **and** shrinks the PostgREST schema cache | Low-medium — staff tooling referencing them would break; rollback = move back/re-grant. **Ship as its own urgent item — it's a security fix wearing a perf hat** |
| B4 | Fix the 87 `auth_rls_initplan` policies, hot tables first (`b2b_accounts`, `b2b_catalogue_item_decorations`, `quote_items`, `orders`, grants/periods tables — all confirmed affected), pattern `(select auth.uid())` | Per-row → per-query evaluation on every RLS read | Low — mechanical rewrite, policy-by-policy; rollback = restore old expression |
| B5 | Merge the 144 multiple-permissive-policy stacks (worst: `staff_quotes` 20, `preorder_stores` 20, chat tables 10 each) | Cuts per-query policy evaluation | Medium — policy semantics must be OR-merged carefully; one table per migration |
| B6 | Add covering indexes for the 79 unindexed FKs | Latent — verified row counts are tiny today (`orders` 10 rows); prioritise `product_variants` (35 k rows) and write-hot event tables | Low — `CREATE INDEX CONCURRENTLY`; rollback = drop index |
| B7 | Drop the 201 unused (≈ 5.5 MB) + 15 duplicate indexes after a stats-window review | Less WAL per write, smaller cache | Medium — verify `idx_scan=0` across a window covering month-end/seasonal jobs and staff-portal patterns; rollback = recreate from saved DDL |

Also surfaced by the audit (park for a security pass, not perf): 22 `rls_enabled_no_policy`, 20 `rls_policy_always_true`, 45 `anon_security_definer_function_executable`, 1 `vulnerable_postgres_version`.

Sequencing: **B3 first** (security), then **B1** (the one big DB-time win), then B4 (hot tables) → B7 → B5 → B6, with B2 whenever the product-latency question is answered. Note Track B improves DB headroom/security, not checkout latency — checkout is round-trip-bound (Track A).

## Acceptance criteria (unchanged from the brief)

- 40×3 harness: bounded, near-constant round-trip count; wall-clock < 1 s. ✅ projected ~0.7 s after A1–A3
- Tier-multiplier lookups per checkout ≤ 1, pinned by regression test
- All existing checkout tests green; characterization tests prove identical drift outcomes pre/post
- Track B delivered as staged SQL + rollback, applied only after explicit sign-off

## Review checkpoint

~~Pausing here.~~ **Approved 2026-07-14; Track A implemented same day.**

## Outcome (measured after A1–A3, same harness)

| Fixture | Round-trips before → after | Wall-clock before → after |
|---|---|---|
| 1 × 3 | 13 → 13 | 446 ms → 391 ms |
| 40 × 3 | **93 → 17** | **3,806 ms → 621 ms (6.1×)** |
| 80 × 3 | (~173 extrapolated) → **17** | (~7.4 s extrapolated) → **554 ms** |

Decoration-loop share at N=40: 3,264 ms → 120 ms (link-selects 40 → 1; manual price RPCs 40 → 3 concurrent). Round-trip count is now independent of order size — pinned by `submit.roundtrip-regression.test.ts` (link-select = 1, price RPCs = distinct (item|link, pooled-qty) pairs, tier lookups ≤ 1). All 16 drift characterization tests unchanged and green pre/post. Full suite: 492 passed; the 2 failures (`CartTable`, `ProductDetailClient.manual-pricing` UI copy tests) fail identically on the unmodified tree — pre-existing, not touched by this branch.
