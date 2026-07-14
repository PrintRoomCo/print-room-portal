# Track B — shared-DB perf/security debt (staged SQL, review-only)

Staged 2026-07-14 from the verified findings in PERF-FINDINGS.md §4 and the plan in
PERF-STRATEGY.md Track B — both on branch `perf/checkout-fanout` (PR #66).

**Nothing in this directory has been applied.** The Supabase project
(`bthsxgmcnbvwwgvdveek`) has no branching enabled, so these are hand-apply
scripts for the SQL editor / psql, each with an explicit `ROLLBACK` section
and pre-apply verification queries in its header. This directory is
deliberately *outside* `supabase/migrations` so nothing can auto-apply it.

## Files, in recommended apply order

| Order | File | What | Win | Blocker / caution |
|---|---|---|---|---|
| 1 | `B3_archive_backup_tables.sql` | Move 101 backup/scratch tables from `public` to a private `archive` schema | **Security**: closes anon-key reachability of 98 RLS-off tables with real customer PII; also shrinks the PostgREST schema cache | Run the dependency checks in the header first. Ship independently and first — it's a security fix |
| 2 | `B1_realtime_publication_trim.sql` | Drop 4 subscriber-less tables from the realtime publication | WAL decode was **79.4 % of all DB time**; chat (the only consumed feed) is untouched | Re-run the subscriber grep if any repo deployed after 2026-07-14 |
| 3 | `B4_rls_initplan_hot_tables.sql` | `(select auth.*())` initplan rewrite for policies on the 9 checkout-hot tables | Per-row → per-query policy evaluation on RLS reads | Mechanical, but review each rewritten expression against the rollback copy |
| 4 | `B7_unused_duplicate_indexes.sql` | Drop 15 duplicate + ~201 advisor-flagged unused indexes | Less WAL per write, smaller cache (~5.5 MB) | **Re-verify `idx_scan = 0` at apply time** (stats window starts 2026-03-23 and may miss seasonal jobs); constraint-backed indexes are excluded/flagged |
| 5 | `B5_permissive_policies_worst_tables.md` | Analysis + DRAFT merges for the worst multiple-permissive-policy tables (`staff_quotes`, `preorder_stores`, 20 findings each) | Cuts per-query policy evaluation | **Draft only** — policy semantics must be reviewed case-by-case before any SQL is written into a runnable file |
| 6 | `B6_fk_covering_indexes.sql` | Covering indexes for the 79 unindexed FKs | Faster FK checks/joins — mostly *latent* (largest affected table is `product_variants` at 35 k rows; `orders` has 10) | `CREATE INDEX CONCURRENTLY` cannot run in a transaction — apply one by one |
| — | `B2_cron_retune.sql` | Every-minute crons → `*/5` | Modest (~3 % of DB time is all of pg_net) | Blocked on a product answer: is 1-minute sync latency required? |

## Ground rules

- Apply **one file per session**, run its pre-apply verification first, and
  keep its rollback section at hand.
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
