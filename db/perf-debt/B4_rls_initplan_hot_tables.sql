-- =====================================================================
-- B4: Fix auth_rls_initplan on checkout-hot tables
-- =====================================================================
-- Purpose:
--   Rewrite RLS policies on the 9 checkout-hot tables so that
--   auth.<fn>() calls (auth.uid(), auth.jwt(), auth.role()) are wrapped
--   as `(select auth.<fn>())`. This lets Postgres evaluate the auth
--   function ONCE per query (as an InitPlan) instead of once per row,
--   which matters most on the tables that sit directly in the B2B
--   checkout / ordering-period / quote path.
--
-- Date: 2026-07-14
--
-- STAGED FOR REVIEW — DO NOT APPLY without explicit sign-off.
-- This project has NO Supabase branching; apply manually via the
-- SQL editor/psql after review. Project ref: bthsxgmcnbvwwgvdveek.
--
-- Scope (checkout-hot tables only, per instruction — NOT the full
-- 87-finding auth_rls_initplan advisor list):
--   b2b_accounts, b2b_catalogue_item_decorations, quote_items, orders,
--   b2b_member_catalogue_grants, b2b_member_catalogue_item_grants,
--   b2b_ordering_periods, b2b_ordering_period_item_pricing,
--   b2b_account_managers
--
-- Evidence (verified via pg_policies on 2026-07-14, project
-- bthsxgmcnbvwwgvdveek):
--   11 total policies exist across these 9 tables.
--   9 policies re-evaluate a bare auth.uid()/auth.role() per row and
--     are rewritten below.
--   2 policies (b2b_member_catalogue_grants_staff_write on
--     b2b_member_catalogue_grants, and
--     b2b_member_catalogue_item_grants_staff_write on
--     b2b_member_catalogue_item_grants) use ONLY the custom wrapper
--     auth_is_staff() with no bare auth.uid()/auth.jwt()/auth.role()
--     call in their qual/with_check — they are SKIPPED, not touched.
--     (auth_is_staff() is a user-defined function, not one of
--     auth.uid()/auth.jwt()/auth.role(), so it is out of scope for
--     this initplan rewrite regardless of its own internal
--     implementation.)
--
-- Pre-apply verification query (run this immediately before applying,
-- to confirm no policy text has drifted since this file was drafted):
--
--   SELECT schemaname, tablename, policyname, qual, with_check
--   FROM pg_policies
--   WHERE schemaname = 'public'
--     AND tablename IN (
--       'b2b_accounts','b2b_catalogue_item_decorations','quote_items',
--       'orders','b2b_member_catalogue_grants',
--       'b2b_member_catalogue_item_grants','b2b_ordering_periods',
--       'b2b_ordering_period_item_pricing','b2b_account_managers'
--     )
--   ORDER BY tablename, policyname;
--
--   Diff the qual/with_check text against the "BEFORE" text quoted in
--   each ROLLBACK block below. If anything differs, STOP and re-derive
--   this file rather than applying it blindly.
-- =====================================================================


-- ===== FORWARD =====

-- Table: b2b_account_managers | Policy: "Service role full access"
-- BEFORE: qual = (auth.role() = 'service_role'::text), with_check = same
ALTER POLICY "Service role full access" ON public.b2b_account_managers
    USING ((( select auth.role()) = 'service_role'::text))
    WITH CHECK ((( select auth.role()) = 'service_role'::text));

-- Table: b2b_accounts | Policy: "Service role full access"
-- BEFORE: qual = (auth.role() = 'service_role'::text), with_check = same
ALTER POLICY "Service role full access" ON public.b2b_accounts
    USING ((( select auth.role()) = 'service_role'::text))
    WITH CHECK ((( select auth.role()) = 'service_role'::text));

-- Table: b2b_catalogue_item_decorations
-- Policy: "org members can read catalogue-item decorations"
-- BEFORE (qual only, with_check is null):
--   (EXISTS ( SELECT 1
--      FROM ((b2b_catalogue_items ci
--        JOIN b2b_catalogues c ON ((c.id = ci.catalogue_id)))
--        JOIN user_organizations uo ON ((uo.organization_id = c.organization_id)))
--     WHERE ((ci.id = b2b_catalogue_item_decorations.catalogue_item_id) AND (uo.user_id = auth.uid()))))
ALTER POLICY "org members can read catalogue-item decorations" ON public.b2b_catalogue_item_decorations
    USING ((EXISTS ( SELECT 1
       FROM ((b2b_catalogue_items ci
         JOIN b2b_catalogues c ON ((c.id = ci.catalogue_id)))
         JOIN user_organizations uo ON ((uo.organization_id = c.organization_id)))
      WHERE ((ci.id = b2b_catalogue_item_decorations.catalogue_item_id) AND (uo.user_id = (select auth.uid()))))));

-- Table: b2b_member_catalogue_grants | Policy: "b2b_member_catalogue_grants_self_read"
-- BEFORE (qual only, with_check is null):
--   (auth_is_staff() OR (EXISTS ( SELECT 1
--      FROM user_organizations uo
--     WHERE ((uo.id = b2b_member_catalogue_grants.membership_id) AND (uo.user_id = auth.uid())))))
-- NOTE: auth_is_staff() is a custom function, left untouched. Only the
-- bare auth.uid() inside the EXISTS is wrapped.
ALTER POLICY "b2b_member_catalogue_grants_self_read" ON public.b2b_member_catalogue_grants
    USING ((auth_is_staff() OR (EXISTS ( SELECT 1
       FROM user_organizations uo
      WHERE ((uo.id = b2b_member_catalogue_grants.membership_id) AND (uo.user_id = (select auth.uid())))))));

-- Table: b2b_member_catalogue_grants | Policy: "b2b_member_catalogue_grants_staff_write"
-- SKIPPED: qual/with_check = auth_is_staff() only — no bare
-- auth.uid()/auth.jwt()/auth.role() call to rewrite.

-- Table: b2b_member_catalogue_item_grants | Policy: "b2b_member_catalogue_item_grants_self_read"
-- BEFORE (qual only, with_check is null):
--   (auth_is_staff() OR (EXISTS ( SELECT 1
--      FROM user_organizations uo
--     WHERE ((uo.id = b2b_member_catalogue_item_grants.membership_id) AND (uo.user_id = auth.uid())))))
ALTER POLICY "b2b_member_catalogue_item_grants_self_read" ON public.b2b_member_catalogue_item_grants
    USING ((auth_is_staff() OR (EXISTS ( SELECT 1
       FROM user_organizations uo
      WHERE ((uo.id = b2b_member_catalogue_item_grants.membership_id) AND (uo.user_id = (select auth.uid())))))));

-- Table: b2b_member_catalogue_item_grants | Policy: "b2b_member_catalogue_item_grants_staff_write"
-- SKIPPED: qual/with_check = auth_is_staff() only — no bare
-- auth.uid()/auth.jwt()/auth.role() call to rewrite.

-- Table: b2b_ordering_period_item_pricing | Policy: "b2b_ordering_period_item_pricing_member_read"
-- BEFORE (qual only, with_check is null):
--   (period_id IN ( SELECT p.id
--      FROM b2b_ordering_periods p
--     WHERE (p.organization_id IN ( SELECT user_organizations.organization_id
--              FROM user_organizations
--             WHERE (user_organizations.user_id = auth.uid())))))
ALTER POLICY "b2b_ordering_period_item_pricing_member_read" ON public.b2b_ordering_period_item_pricing
    USING ((period_id IN ( SELECT p.id
       FROM b2b_ordering_periods p
      WHERE (p.organization_id IN ( SELECT user_organizations.organization_id
               FROM user_organizations
              WHERE (user_organizations.user_id = (select auth.uid())))))));

-- Table: b2b_ordering_periods | Policy: "b2b_ordering_periods_member_read"
-- BEFORE (qual only, with_check is null):
--   (organization_id IN ( SELECT user_organizations.organization_id
--      FROM user_organizations
--     WHERE (user_organizations.user_id = auth.uid())))
ALTER POLICY "b2b_ordering_periods_member_read" ON public.b2b_ordering_periods
    USING ((organization_id IN ( SELECT user_organizations.organization_id
       FROM user_organizations
      WHERE (user_organizations.user_id = (select auth.uid())))));

-- Table: orders | Policy: "Service role full access"
-- BEFORE: qual = (auth.role() = 'service_role'::text), with_check = same
ALTER POLICY "Service role full access" ON public.orders
    USING ((( select auth.role()) = 'service_role'::text))
    WITH CHECK ((( select auth.role()) = 'service_role'::text));

-- Table: quote_items | Policy: "Service role full access"
-- BEFORE: qual = (auth.role() = 'service_role'::text), with_check = same
ALTER POLICY "Service role full access" ON public.quote_items
    USING ((( select auth.role()) = 'service_role'::text))
    WITH CHECK ((( select auth.role()) = 'service_role'::text));


-- ===== ROLLBACK =====
-- Restores each policy's original qual/with_check verbatim, as captured
-- from pg_policies on 2026-07-14 (see BEFORE comments above).

ALTER POLICY "Service role full access" ON public.b2b_account_managers
    USING ((auth.role() = 'service_role'::text))
    WITH CHECK ((auth.role() = 'service_role'::text));

ALTER POLICY "Service role full access" ON public.b2b_accounts
    USING ((auth.role() = 'service_role'::text))
    WITH CHECK ((auth.role() = 'service_role'::text));

ALTER POLICY "org members can read catalogue-item decorations" ON public.b2b_catalogue_item_decorations
    USING ((EXISTS ( SELECT 1
       FROM ((b2b_catalogue_items ci
         JOIN b2b_catalogues c ON ((c.id = ci.catalogue_id)))
         JOIN user_organizations uo ON ((uo.organization_id = c.organization_id)))
      WHERE ((ci.id = b2b_catalogue_item_decorations.catalogue_item_id) AND (uo.user_id = auth.uid())))));

ALTER POLICY "b2b_member_catalogue_grants_self_read" ON public.b2b_member_catalogue_grants
    USING ((auth_is_staff() OR (EXISTS ( SELECT 1
       FROM user_organizations uo
      WHERE ((uo.id = b2b_member_catalogue_grants.membership_id) AND (uo.user_id = auth.uid()))))));

-- (b2b_member_catalogue_grants_staff_write was never modified — no rollback needed.)

ALTER POLICY "b2b_member_catalogue_item_grants_self_read" ON public.b2b_member_catalogue_item_grants
    USING ((auth_is_staff() OR (EXISTS ( SELECT 1
       FROM user_organizations uo
      WHERE ((uo.id = b2b_member_catalogue_item_grants.membership_id) AND (uo.user_id = auth.uid()))))));

-- (b2b_member_catalogue_item_grants_staff_write was never modified — no rollback needed.)

ALTER POLICY "b2b_ordering_period_item_pricing_member_read" ON public.b2b_ordering_period_item_pricing
    USING ((period_id IN ( SELECT p.id
       FROM b2b_ordering_periods p
      WHERE (p.organization_id IN ( SELECT user_organizations.organization_id
               FROM user_organizations
              WHERE (user_organizations.user_id = auth.uid()))))));

ALTER POLICY "b2b_ordering_periods_member_read" ON public.b2b_ordering_periods
    USING ((organization_id IN ( SELECT user_organizations.organization_id
       FROM user_organizations
      WHERE (user_organizations.user_id = auth.uid()))));

ALTER POLICY "Service role full access" ON public.orders
    USING ((auth.role() = 'service_role'::text))
    WITH CHECK ((auth.role() = 'service_role'::text));

ALTER POLICY "Service role full access" ON public.quote_items
    USING ((auth.role() = 'service_role'::text))
    WITH CHECK ((auth.role() = 'service_role'::text));
