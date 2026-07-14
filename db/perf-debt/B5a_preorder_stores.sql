-- =====================================================================
-- B5a: Collapse multiple_permissive_policies on public.preorder_stores
-- =====================================================================
-- Promoted from the DRAFT in B5_permissive_policies_worst_tables.md after
-- Jon's verb-by-verb equivalence review on 2026-07-14. This is the ONE
-- table in B5 with a clean, fully behavior-preserving full merge (no
-- authenticated-scoped residual, unlike staff_quotes).
--
-- Date: 2026-07-14
--
-- STAGED — RUNNABLE BUT NOT APPLIED. Apply only on explicit sign-off,
-- via the same tracked-migration path used for B1/B3/B4/B6/B7, OR by
-- hand in the SQL editor. Project ref: bthsxgmcnbvwwgvdveek.
--
-- WHAT THIS DOES
--   Merges the 5 permissive policies on preorder_stores (1 cmd=ALL
--   service_role policy + 4 per-command owner/public policies) into 4
--   per-command policies, each OR-ing in the service_role branch. This
--   removes all 20 `multiple_permissive_policies` findings for this
--   table (the service_role ALL policy was the sole overlap on every
--   command, so folding it in per-command clears each group entirely).
--   The rewrite also wraps auth.uid()/auth.role() as (select ...) so
--   they evaluate once per query (auth_rls_initplan) — an extra
--   behavior-preserving change bundled in deliberately.
--
-- EQUIVALENCE (why this preserves behavior exactly)
--   Postgres OR's all permissive policies that apply to a (role, cmd).
--   The old service_role policy is cmd=ALL with a USING clause and NO
--   WITH CHECK, so Postgres copies its USING into the WITH CHECK for
--   INSERT/UPDATE. Per command, the old effective check was therefore:
--     SELECT : USING (is_active = true) OR USING (service_role)
--     DELETE : USING (uid = owner_id)  OR USING (service_role)
--     INSERT : CHECK (uid = owner_id)  OR CHECK (service_role)   [copied]
--     UPDATE : USING (uid = owner_id)  OR USING (service_role),
--              CHECK (uid = owner_id)  OR CHECK (service_role)   [copied]
--   Each merged policy below reproduces exactly that OR, per command.
--   Table has 0 live rows (pg_stat_user_tables, 2026-07-14) so there is
--   no data-shape risk — but also no real rows to smoke-test against.
--
-- CAVEATS FOR THE APPLIER
--   1. Renames 5 policies -> 4. Anything that inspects
--      pg_policies.policyname for preorder_stores (docs, tooling, other
--      migrations) must be updated. Old names dropped:
--        preorder_stores_service_role, _owner_delete, _owner_insert,
--        _public_read, _owner_update
--      New names: preorder_stores_{delete,insert,select,update}_merged
--   2. service_role previously had ALL access; the SELECT merge lets
--      service_role read is_active=false rows exactly as before (it was
--      cmd=ALL). Re-verify service-role paths end-to-end after applying
--      (edge functions, cron jobs, webhooks that write preorder_stores).
--      Blast radius is ~nil at 0 rows, but confirm the path still works.
--
-- PRE-APPLY DRIFT CHECK (run immediately before applying; STOP if it
-- differs from the "BEFORE" set captured in the ROLLBACK section):
--   SELECT policyname, roles, cmd, qual, with_check
--   FROM pg_policies
--   WHERE schemaname='public' AND tablename='preorder_stores'
--   ORDER BY cmd, policyname;
-- =====================================================================


-- ===== FORWARD =====
BEGIN;

DROP POLICY "preorder_stores_service_role" ON public.preorder_stores;
DROP POLICY "preorder_stores_owner_delete"  ON public.preorder_stores;
DROP POLICY "preorder_stores_owner_insert"  ON public.preorder_stores;
DROP POLICY "preorder_stores_public_read"   ON public.preorder_stores;
DROP POLICY "preorder_stores_owner_update"  ON public.preorder_stores;

CREATE POLICY "preorder_stores_delete_merged" ON public.preorder_stores
    AS PERMISSIVE FOR DELETE TO public
    USING ((select auth.uid()) = owner_id OR (select auth.role()) = 'service_role'::text);

CREATE POLICY "preorder_stores_insert_merged" ON public.preorder_stores
    AS PERMISSIVE FOR INSERT TO public
    WITH CHECK ((select auth.uid()) = owner_id OR (select auth.role()) = 'service_role'::text);

CREATE POLICY "preorder_stores_select_merged" ON public.preorder_stores
    AS PERMISSIVE FOR SELECT TO public
    USING (is_active = true OR (select auth.role()) = 'service_role'::text);

CREATE POLICY "preorder_stores_update_merged" ON public.preorder_stores
    AS PERMISSIVE FOR UPDATE TO public
    USING ((select auth.uid()) = owner_id OR (select auth.role()) = 'service_role'::text)
    WITH CHECK ((select auth.uid()) = owner_id OR (select auth.role()) = 'service_role'::text);

COMMIT;

-- Post-apply check: get_advisors(performance) should show 0
-- multiple_permissive_policies findings for preorder_stores (was 20).


-- ===== ROLLBACK =====
-- Restores the 5 original policies verbatim, as captured from pg_policies
-- on 2026-07-14 (bare auth.*() calls, i.e. the pre-initplan form).
BEGIN;

DROP POLICY "preorder_stores_delete_merged" ON public.preorder_stores;
DROP POLICY "preorder_stores_insert_merged" ON public.preorder_stores;
DROP POLICY "preorder_stores_select_merged" ON public.preorder_stores;
DROP POLICY "preorder_stores_update_merged" ON public.preorder_stores;

CREATE POLICY "preorder_stores_service_role" ON public.preorder_stores
    AS PERMISSIVE FOR ALL TO public
    USING (auth.role() = 'service_role'::text);

CREATE POLICY "preorder_stores_owner_delete" ON public.preorder_stores
    AS PERMISSIVE FOR DELETE TO public
    USING (auth.uid() = owner_id);

CREATE POLICY "preorder_stores_owner_insert" ON public.preorder_stores
    AS PERMISSIVE FOR INSERT TO public
    WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "preorder_stores_public_read" ON public.preorder_stores
    AS PERMISSIVE FOR SELECT TO public
    USING (is_active = true);

CREATE POLICY "preorder_stores_owner_update" ON public.preorder_stores
    AS PERMISSIVE FOR UPDATE TO public
    USING (auth.uid() = owner_id)
    WITH CHECK (auth.uid() = owner_id);

COMMIT;
