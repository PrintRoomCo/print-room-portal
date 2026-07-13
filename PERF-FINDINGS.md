# PERF-FINDINGS — customer-portal checkout + shared Supabase DB

_Measured 2026-07-14 against project `bthsxgmcnbvwwgvdveek` (live shared DB) and `print-room-portal@main` (09082f4). All measurements are my own reproductions; where they contradict the earlier notes, the corrections are called out explicitly._

## 1. The bug, measured (Phase-1 harness — the red signal)

Harness: `scripts/perf/checkout-fanout-harness.ts`. It calls the **real** `submitCustomerOrder` against live demo-org data with a per-line `claimed_manual_decoration: -1`, which guarantees `DecorationDriftError` *after* the full pricing/validation fan-out but *before* the `submit_b2b_order` write — so the run is read-only end to end (a fetch-wrapper guard additionally blocks every write verb and write RPC). The wrapper counts every PostgREST HTTPS round-trip and its latency.

| Fixture (lines × decorations) | Round-trips | Serialised | Wall-clock | Decoration loop share |
|---|---|---|---|---|
| 1 × 3 | 13 | 11 | 446 ms | 2 RTs / 74 ms |
| 10 × 3 | 33 | 29 | 1,076 ms | 20 RTs / 703 ms |
| **40 × 3** | **93** | **89** | **3,806 ms** | **80 RTs / 3,264 ms (86 %)** |

Endpoint breakdown at N=40: `b2b_catalogue_item_decorations` select × 40 (1,715 ms) + `catalogue_item_decoration_price` RPC × 40 (1,484 ms) + 13 fixed-overhead calls. Median RTT 40.8 ms; the same statements take ~1–9 ms in-DB (pg_stat_statements). **The checkout is not DB-bound; it is round-trip-bound: cost = (2 × lines + ~13) sequential HTTPS round-trips.**

Root cause (code): `lib/checkout/submit.ts:701` — a fully sequential `for (const line ...)` loop issuing one link-select per line (`submit.ts:715`) and one decoration-price call per line/decoration (`submit.ts:673` manual, `submit.ts:854` computed via `lib/checkout/decoration-effective-price.ts`, which itself makes 2 sequential calls and re-fetches the org's tier multiplier every time). The garment loop at `submit.ts:553` already uses `Promise.all` — the in-repo template for the fix.

## 2. Corrections to the earlier evidence (verified against code + pg_stat_statements)

1. **The 19,564-call RPC is `effective_unit_price_for_item`, not the decoration RPC** (its arg shape `p_catalogue_item_id, p_org_id, p_qty` matches; the decoration RPC `effective_decoration_unit_price` shows 1,140 calls). Its volume comes from **catalogue browsing, not checkout**: the PDP probes 6 canonical qty breakpoints per view (`app/(portal)/catalogue/[productId]/page.tsx:129`) and the catalogue list page prices every item at 2 quantities per view. Those are `Promise.all`'d, so they add DB call volume (~18.6 s total DB time) but not user-visible latency. The "~490 pricing calls per checkout" inference is **refuted**.
2. **Every live catalogue item is `manual_final`** (40 active manual items, 23 with published decoration links; the only 2 computed items have zero links). Real checkouts therefore take the *manual* path: 1 link-select + 1 `catalogue_item_decoration_price` per line, and **zero** `b2b_accounts` tier lookups — the harness confirms 0. The proposed "hoist `loadTierMultiplier`" fix is a **no-op for current traffic**; it only matters for the dormant computed path (which remains live code and must still be fixed).
3. `submit_b2b_order` confirmed not the bottleneck: 18–35 calls in stats, mean 26–138 ms, worst 584 ms, all in-DB work.
4. A batch pricing RPC pattern **already exists and is proven**: `effective_unit_prices_bulk` / `effective_unit_prices_for_items_bulk` (1,056 calls in stats) — template for any future set-returning decoration pricing.
5. Transport confirmed as PostgREST-over-HTTPS: the hot statements appear in pg_stat_statements wrapped in `pgrst_source` CTEs.

## 3. Impact ÷ effort ranking — checkout track

| Rank | Fix | Win (40×3 fixture) | Effort |
|---|---|---|---|
| 1 | Batch per-line link-select into one `.in()` (A1) | −39 RTs ≈ −1.6 s | Small |
| 2 | Dedupe+parallelise `catalogue_item_decoration_price` by distinct (item, qty) (A2) | −37 RTs ≈ −1.4 s | Small |
| 3 | Computed path: hoist tier lookup + `Promise.all` (A3) | 0 today; prevents relapse when computed items ship | Small-medium (richest drift semantics — characterization tests first) |
| 4 | Whole reprice inside one RPC (A4) | marginal after 1–3 | Large — **defer** |

Projected post-fix: ~14–17 round-trips independent of order size; ~0.6–0.8 s wall-clock for 40×3 (fixed overhead measured at ~0.45 s). Details, risks and rollback in PERF-STRATEGY.md.

## 4. Shared-DB debt (secondary track) — verified numbers

_Read-only audit via `get_advisors` + `pg_stat_statements` + `cron.job` + catalog queries. Baseline: **29,356 s total DB time** over a 113-day stats window (reset 2026-03-23); DB size 629 MB. Advisor JSON is in the session tool-results directory (not committed)._

| Claim | Verdict | Verified numbers |
|---|---|---|
| Realtime WAL decode ≈ 80 % of DB time | **Verified** | WAL-decode statements total 23,297 s = **79.4 %** of all DB time (~4.2 M calls). `supabase_realtime` publication covers 6 public tables: `design_snapshots`, `board_relation_links`, `comments`, `notifications`, `chat_conversations`, `chat_messages` |
| pg_net firehose from the two `* * * * *` crons | **Partially** | Both crons confirmed active every-minute (~161 k invocations each over the window, ~1,400 s combined). The "millions of net.* ops" (2 × 9.24 M calls) are **pg_net's own fixed-cadence queue/response cleanup**, not proportional to these crons; live `net._http_response` holds only 756 rows. Whole pg_net footprint ≈ 3 % of DB time — real but modest |
| ~87 `auth_rls_initplan` policies incl. checkout-hot tables | **Verified** | Exactly **87**, including `b2b_accounts`, `b2b_catalogue_item_decorations`, `quote_items`, `orders`, `b2b_member_catalogue_grants`/`_item_grants`, `b2b_ordering_periods`/`_item_pricing` — i.e. the tables the checkout path reads |
| ~144 `multiple_permissive_policies`, worst on preorder | **Partially** | Exactly **144**; worst: `staff_quotes` (20) **tied with** `preorder_stores` (20), then `chat_messages`/`chat_conversations` (10 each) |
| ~79 unindexed FKs (orders, variant_inventory_events, …) | **Verified, low current bite** | Exactly **79** across 56 tables, incl. both named ones — but `orders` has 10 live rows and `variant_inventory_events` 0; largest affected is `product_variants` (35 k rows). Latent debt, not an active fire |
| ~201 unused + ~15 duplicate indexes | **Verified** | Exactly **201** (≈ 5.5 MB) and **15** (pairs on `product_pricing_tiers` ×4, `design_snapshots` ×2, `tech_pack_shares` ×2, …) |
| ~100 `_bak_` tables, ~98 RLS-off, anon-reachable | **Verified** | **100** bak/backup tables of **294** public tables (claim said ~318); **97** bak tables RLS-off + 1 non-backup (`demo_rewire_map_20260611`) = the 98 `rls_disabled_in_public` advisor findings |

Additional security-advisor context worth carrying into Track B: `rls_enabled_no_policy` 22, `rls_policy_always_true` 20, `anon_security_definer_function_executable` 45, and **1 `vulnerable_postgres_version`** finding (upgrade available).

**Honest framing:** the DB is small (629 MB, low row counts) and checkout latency is round-trip-bound, so Track B mostly buys back DB CPU/WAL headroom and closes security exposure — it will not visibly speed up checkout. Track A is where the user-facing win is.

## 5. Method notes

- Harness fixture uses the `Print Room Demo` org (`is_test=true`, customer code DEMO); context email is the jamie@ test inbox although no email path is ever reached.
- No writes were performed at any point: the drift throw pre-empts `submit_b2b_order`, and the fetch guard would have raised on any write verb. Verified: harness reports `DecorationDriftError as expected (40 drift entries) — no writes performed`.
- pg_stat_statements numbers are cumulative since the last stats reset and include staff-portal + ad-hoc traffic; they are used for *shape* (call counts, in-DB cost), while the harness supplies the checkout-specific timings.
