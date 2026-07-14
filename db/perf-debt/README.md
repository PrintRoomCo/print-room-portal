# Track B — shared-DB perf/security debt (staged SQL)

Staged 2026-07-14 from the verified findings in PERF-FINDINGS.md §4 and the plan in
PERF-STRATEGY.md Track B — both on branch `perf/checkout-fanout` (PR #66).

**APPLIED 2026-07-14 (on Jon's instruction), as tracked migrations:**
`b3_archive_backup_tables_out_of_public`, `b1_realtime_publication_trim`,
`b4_rls_initplan_hot_tables`, `b7_drop_unused_and_duplicate_indexes` (197
dropped, 1 skipped: `idx_bom_items_tech_pack_id` had been scanned since
staging), `b6_fk_covering_indexes` (79 created; CONCURRENTLY stripped —
transactional apply, safe at current table sizes),
`b5a_preorder_stores_policy_merge`, and
`b5b_staff_quotes_step1_policy_merge`. **NOT applied:** B2
(permission-gated at apply time + open product question on 1-minute cron
latency) or staff_quotes step 2. Post-apply: rls_disabled_in_public
98→0, auth_rls_initplan 87→72, duplicate_index 15→2 (the two constraint-backed
pairs), multiple_permissive_policies 144→106, publication = chat tables only,
checkout harness green (17 round-trips).
Known lint-tension left as-is at current scale: B7's drops re-exposed 48
unindexed FKs and B6's new FK indexes now count as "unused" (79) — the two
advisor lints structurally conflict on a low-traffic DB; revisit when row
counts grow. Rollback sections below remain valid for every applied item.

**FOLLOW-UP 2026-07-14 (B5 applied + B2 investigation):**

- **B5 safe subset APPLIED.** The exact table-specific `pg_policies` drift
  checks in both promoted files matched their captured rollback definitions.
  B5a then ran as tracked migration `b5a_preorder_stores_policy_merge` and the
  performance advisor verified `preorder_stores` 20→0. B5b step 1 ran as
  `b5b_staff_quotes_step1_policy_merge` and verified `staff_quotes` 20→2
  (the expected authenticated INSERT and SELECT residuals). Total
  `multiple_permissive_policies` findings moved 144→124→106. Both target
  tables had 0 live rows at review time; both applied merges include the
  `(select auth.*())` initplan fix. staff_quotes **step 2** remains blocked on
  a product-owner call, was not drafted further, and was not applied.
- **B3 archive-move is safe (swept 2026-07-14).** ZERO runtime
  (`.ts/.tsx/.js`) references to any of the 101 archived tables across all
  repos; the only code references are historical one-off `.sql` scripts that
  *created* the backups (they don't read them at runtime). The
  `*_skucollapse_bak_20260624` / `colourway_collapse_map_bak_20260624` tables
  named in staff scripts 024/025 exist in neither `public` nor `archive`
  (dropped before B3) — B3 missed nothing. No operational break from the move.
- **B2 is two jobs with different risk — do NOT treat them as one.**
  - **jobid 4** `uniforms-monday-sync-cron` = `SELECT invoke_uniforms_monday_sync()`;
    pushes uniforms data to a Monday board. Safe to slow to `*/5` pending ONE
    product answer: **is ≤5-min board freshness acceptable?** If yes, apply
    `select cron.alter_job(4, schedule => '*/5 * * * *');` (rollback `'* * * * *'`).
  - **jobid 1** `b2b-worker-cron` posts to the `b2b-worker` edge function
    (`print-room-studio/supabase/functions/b2b-worker`). That worker is a
    **design/quote APPROVAL queue** (`approve-design` → creates Shopify
    products; `approve-quote`/`reject-quote`; design-collection approve/reject).
    The last committed direct-invoke producer lived in the former Shopify B2B
    portal: enqueue, then an unawaited fire-and-forget POST to the worker. That
    app was deleted from the studio monorepo on 2026-04-10, and no current
    producer/invoker exists in the three active repos, so the currently
    registered webhook path is not source-verifiable here. Live evidence on
    2026-07-14: 9 B2B jobs total, newest 2026-01-13, 0 pending/processing, 1
    historical failure; jobid 1 completed 1,440/1,440 cron runs in 24 hours and
    recent worker HTTP requests were 200. The deployed worker processes at most
    5 jobs per invocation, retries immediately without backoff, and has no
    stale-`processing` recovery. Recommendation: **leave jobid 1 at `*/1`**
    until the live Monday webhook registration/owner is located and a test
    approval proves enqueue + direct invocation end-to-end. If that flow is
    retired, disable this empty cron; if it remains active and ≤5-minute retry
    latency is acceptable, `*/5` is then defensible.
  - Mechanics unchanged: `apply_migration` for the cron change was denied by the
    permission classifier and was NOT worked around.
  - **Parked security note:** jobid 1's cron command embeds a `service_role`
    JWT in plaintext in `cron.job.command`. Separate hardening item, not perf.

## Files, in recommended apply order

| Order | File | What | Win | Blocker / caution |
|---|---|---|---|---|
| 1 | `B3_archive_backup_tables.sql` | Move 101 backup/scratch tables from `public` to a private `archive` schema | **Security**: closes anon-key reachability of 98 RLS-off tables with real customer PII; also shrinks the PostgREST schema cache | Run the dependency checks in the header first. Ship independently and first — it's a security fix |
| 2 | `B1_realtime_publication_trim.sql` | Drop 4 subscriber-less tables from the realtime publication | WAL decode was **79.4 % of all DB time**; chat (the only consumed feed) is untouched | Re-run the subscriber grep if any repo deployed after 2026-07-14 |
| 3 | `B4_rls_initplan_hot_tables.sql` | `(select auth.*())` initplan rewrite for policies on the 9 checkout-hot tables | Per-row → per-query policy evaluation on RLS reads | Mechanical, but review each rewritten expression against the rollback copy |
| 4 | `B7_unused_duplicate_indexes.sql` | Drop 15 duplicate + ~201 advisor-flagged unused indexes | Less WAL per write, smaller cache (~5.5 MB) | **Re-verify `idx_scan = 0` at apply time** (stats window starts 2026-03-23 and may miss seasonal jobs); constraint-backed indexes are excluded/flagged |
| 5 | `B5_permissive_policies_worst_tables.md` + `B5a_preorder_stores.sql` + `B5b_staff_quotes_step1.sql` | Analysis, plus two APPLIED tracked merges: preorder_stores (full, cleared 20) and staff_quotes step 1 (cleared 18 of 20) | Cuts per-query policy evaluation | B5a/B5b applied and advisor-verified; staff_quotes **step 2** remains blocked on a product call and was not drafted further |
| 6 | `B6_fk_covering_indexes.sql` | Covering indexes for the 79 unindexed FKs | Faster FK checks/joins — mostly *latent* (largest affected table is `product_variants` at 35 k rows; `orders` has 10) | `CREATE INDEX CONCURRENTLY` cannot run in a transaction — apply one by one |
| — | `B2_cron_retune.sql` | Every-minute crons → `*/5` (**split**: jobid 4 uniforms-sync vs jobid 1 b2b-worker) | Modest (~3 % of DB time is all of pg_net) | jobid 4 safe pending "≤5-min board freshness OK?"; jobid 1 is an approval queue (backstop cron) — leave at `*/1` unless direct-invoke path confirmed. apply_migration denied; not worked around |

## Ground rules

- Apply **one file per session**, run its pre-apply verification first, and
  keep its rollback section at hand. B5a/B5b were applied as separate tracked
  migrations; their verbatim rollback templates remain intentionally commented
  and must be applied only as separate tracked rollback migrations.
- After B3/B1, watch the staff portal chat + catalogue flows and
  `pg_stat_statements` for a day before proceeding down the list.
- Found during the audit, parked for a separate security pass: 22
  `rls_enabled_no_policy`, 20 `rls_policy_always_true`, 45
  `anon_security_definer_function_executable`, 1 `vulnerable_postgres_version`
  (upgrade available).
- Dead realtime listeners found (not fixed here): staff `ArtworkLibrary.tsx`
  → `organization_artwork_variants`; studio design tool → `products`,
  `product_images`. None of these tables is in the publication, so those
  subscriptions receive nothing today. Adding them = product decision with a
  WAL cost; removing the dead code is the cheaper fix.
