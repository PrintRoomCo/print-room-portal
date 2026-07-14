-- ============================================================================
-- B2 — Retune the two every-minute pg_net crons to every 5 minutes
-- Date: 2026-07-14 | STAGED FOR REVIEW — DO NOT APPLY without explicit
-- sign-off, AND NOT before the product question below is answered.
--
-- Verified evidence (2026-07-14):
--   * cron.job: jobid 1 = b2b-worker-cron (net.http_post), jobid 4 =
--     uniforms-monday-sync-cron (invoke_uniforms_monday_sync()), both
--     schedule '* * * * *', both active. ~161k invocations each over the
--     113-day stats window (~1,400 s combined DB time).
--   * The earlier "millions of net.* operations" claim is PARTIALLY true:
--     the 2 x 9.24M-call statements are pg_net's own fixed-cadence
--     queue/response cleanup, which does NOT scale with these crons'
--     schedule. Whole pg_net footprint ≈ 3% of DB time. This change is a
--     modest tidy-up, NOT a major win — deprioritised accordingly.
--
-- PRODUCT QUESTION (blocker): is 1-minute latency required for
--   (a) the b2b worker queue, and (b) the uniforms→Monday sync?
--   If either needs sub-minute reactivity, leave that job at '* * * * *'.
--
-- PRE-APPLY VERIFICATION:
--   select jobid, jobname, schedule, active from cron.job order by jobid;
--   -- confirm jobids 1 and 4 still map to the names above.
-- ============================================================================

select cron.alter_job(1, schedule => '*/5 * * * *'); -- b2b-worker-cron
select cron.alter_job(4, schedule => '*/5 * * * *'); -- uniforms-monday-sync-cron

-- ============================= ROLLBACK =====================================
-- select cron.alter_job(1, schedule => '* * * * *');
-- select cron.alter_job(4, schedule => '* * * * *');
