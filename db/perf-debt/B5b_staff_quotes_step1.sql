-- =====================================================================
-- B5b: staff_quotes — STEP 1 ONLY (merge the two cmd=ALL/public policies)
-- =====================================================================
-- Promoted from the DRAFT in B5_permissive_policies_worst_tables.md after
-- Jon's review on 2026-07-14. This file is the SAFE PARTIAL WIN only:
-- it merges the two overlapping `cmd=ALL, roles=public` policies
-- (admin_access + own_access) into one. It deliberately does NOT touch
-- the three authenticated-scoped policies (insert_own, select_own,
-- select_staff) — that is "step 2" and needs a product-owner call on
-- quote-access rules before any SQL is written (see B5 doc step 2).
--
-- Date: 2026-07-14
--
-- APPLIED 2026-07-14 as tracked migration
-- b5b_staff_quotes_step1_policy_merge after the pg_policies drift check
-- below matched the captured BEFORE set exactly.
-- Project ref: bthsxgmcnbvwwgvdveek.
--
-- WHAT THIS DOES
--   Drops staff_quotes_admin_access and staff_quotes_own_access (both
--   PERMISSIVE, cmd=ALL, roles=public, each with qual == with_check) and
--   replaces them with ONE merged cmd=ALL/public policy whose USING and
--   WITH CHECK are the OR of the two originals. Also wraps auth.uid() as
--   (select auth.uid()) for the auth_rls_initplan win (behavior-
--   preserving; flagged as a bundled extra).
--
-- VERIFIED ADVISOR DELTA — 18 of 20 findings cleared
--   The two merged policies were the SOLE overlapping pair on every
--   command for the 4 non-authenticated roles, and the only pair at all
--   on DELETE/UPDATE. Merging 2 -> 1 clears every group whose overlap
--   was exactly {admin_access, own_access}:
--     DELETE (5 roles)                         -> cleared  (5)
--     UPDATE (5 roles)                          -> cleared  (5)
--     INSERT (4 non-authenticated roles)        -> cleared  (4)
--     SELECT (4 non-authenticated roles)        -> cleared  (4)
--   Residual (NOT cleared by step 1 — needs step 2):
--     INSERT / authenticated  -> {merged, insert_own}                (1)
--     SELECT / authenticated  -> {merged, select_own, select_staff}  (1)
--   => 18 cleared, 2 residual.  NOTE: the B5 draft doc said "10 of 20"
--   for step 1 — that undercounted; it only credited DELETE+UPDATE and
--   missed that the non-authenticated INSERT/SELECT groups also have
--   {admin,own} as their sole overlap. Verify the real number with a
--   get_advisors(performance) diff after applying rather than trusting
--   either figure.
--
-- EQUIVALENCE (why the merge preserves behavior exactly)
--   Both source policies are cmd=ALL, roles=public, and each has
--   with_check identical to its qual. Postgres OR's permissive policies
--   per (role, cmd); OR-ing two policies' USING (and their WITH CHECK)
--   into one policy's USING (and WITH CHECK) is the same boolean per
--   row/command. The three authenticated-scoped policies are left in
--   place, so INSERT/SELECT for `authenticated` keep OR-ing them in
--   exactly as before. Table has 0 live rows (2026-07-14).
--
-- PRE-APPLY DRIFT CHECK (STOP if it differs from the BEFORE text in the
-- ROLLBACK section):
--   SELECT policyname, roles, cmd, qual, with_check
--   FROM pg_policies
--   WHERE schemaname='public' AND tablename='staff_quotes'
--   ORDER BY cmd, policyname;
-- =====================================================================


-- ===== FORWARD =====
BEGIN;

DROP POLICY "staff_quotes_admin_access" ON public.staff_quotes;
DROP POLICY "staff_quotes_own_access"   ON public.staff_quotes;

CREATE POLICY "staff_quotes_admin_or_own_access" ON public.staff_quotes
    AS PERMISSIVE FOR ALL TO public
    USING (
        (EXISTS (
            SELECT 1 FROM staff_users
            WHERE staff_users.user_id = (select auth.uid())
              AND staff_users.is_active = true
              AND staff_users.role = ANY (ARRAY['admin'::text, 'super_admin'::text])
        ))
        OR
        (staff_user_id IN (
            SELECT staff_users.id FROM staff_users
            WHERE staff_users.user_id = (select auth.uid())
              AND staff_users.is_active = true
        ))
    )
    WITH CHECK (
        (EXISTS (
            SELECT 1 FROM staff_users
            WHERE staff_users.user_id = (select auth.uid())
              AND staff_users.is_active = true
              AND staff_users.role = ANY (ARRAY['admin'::text, 'super_admin'::text])
        ))
        OR
        (staff_user_id IN (
            SELECT staff_users.id FROM staff_users
            WHERE staff_users.user_id = (select auth.uid())
              AND staff_users.is_active = true
        ))
    );

COMMIT;

-- Untouched by design (step 2 territory — do NOT drop here):
--   staff_quotes_insert_own    (INSERT, authenticated)
--   staff_quotes_select_own    (SELECT, authenticated)
--   staff_quotes_select_staff  (SELECT, authenticated)
-- Post-apply verified: get_advisors(performance) shows exactly 2 residual
-- findings, for authenticated INSERT and authenticated SELECT.


-- ===== ROLLBACK TEMPLATE (INTENTIONALLY NON-EXECUTING) =====
-- Restores the two original policies verbatim, as captured from
-- pg_policies on 2026-07-14 (bare auth.uid(), pre-initplan form).
-- Apply the SQL inside this block only as a separate tracked rollback
-- migration. Keeping it commented makes the complete file forward-safe.
/*
BEGIN;

DROP POLICY "staff_quotes_admin_or_own_access" ON public.staff_quotes;

CREATE POLICY "staff_quotes_admin_access" ON public.staff_quotes
    AS PERMISSIVE FOR ALL TO public
    USING (EXISTS (
        SELECT 1 FROM staff_users
        WHERE staff_users.user_id = auth.uid()
          AND staff_users.is_active = true
          AND staff_users.role = ANY (ARRAY['admin'::text, 'super_admin'::text])
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM staff_users
        WHERE staff_users.user_id = auth.uid()
          AND staff_users.is_active = true
          AND staff_users.role = ANY (ARRAY['admin'::text, 'super_admin'::text])
    ));

CREATE POLICY "staff_quotes_own_access" ON public.staff_quotes
    AS PERMISSIVE FOR ALL TO public
    USING (staff_user_id IN (
        SELECT staff_users.id FROM staff_users
        WHERE staff_users.user_id = auth.uid()
          AND staff_users.is_active = true
    ))
    WITH CHECK (staff_user_id IN (
        SELECT staff_users.id FROM staff_users
        WHERE staff_users.user_id = auth.uid()
          AND staff_users.is_active = true
    ));

COMMIT;
*/
