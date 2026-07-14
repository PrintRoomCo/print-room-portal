# B5: Multiple Permissive Policies — worst offenders (staff_quotes, preorder_stores)

**Purpose:** Analysis + DRAFT merge proposal for the two tables with the most
`multiple_permissive_policies` advisor findings (20 each). This document is
**NOT ready-to-run SQL**. It exists to scope the work and give reviewers a
concrete starting point.

**Date:** 2026-07-14

**STAGED FOR REVIEW — DO NOT APPLY without explicit sign-off.** This project
has NO Supabase branching; any SQL extracted from this doc must first be
promoted to a tracked migration with a separate tracked rollback, and may be
applied only after someone signs off on the case-by-case semantics called out
below. Project ref: `bthsxgmcnbvwwgvdveek`.

> **PROMOTION STATUS (2026-07-14).** After a verb-by-verb equivalence review,
> two of the merges in this doc were promoted to runnable-but-staged SQL
> files (still NOT applied — apply on explicit sign-off):
> - **`preorder_stores`** → `B5a_preorder_stores.sql` (clean full merge, clears all 20 findings).
> - **`staff_quotes` step 1 only** → `B5b_staff_quotes_step1.sql` (merges the two
>   `cmd=ALL/public` policies; **expected to clear ~18 of 20**, not the "10 of 20"
>   stated below — see the correction in the step-1 section). Step 2 remains
>   blocked on a product-owner call and is intentionally NOT in B5b.
>
> Both target tables have 0 live rows (`pg_stat_user_tables`, 2026-07-14), so
> blast radius is near-nil. Both promoted files also fold in the
> `(select auth.*())` initplan fix. Everything else in this doc is still
> analysis-only.

**Evidence:** `multiple_permissive_policies` lint, 144 total findings across
the project. `staff_quotes` and `preorder_stores` each contribute 20 findings
— the two largest single-table contributors. Full breakdown of all affected
tables is at the bottom of this doc.

**Pre-apply verification query** (run before extracting/running any DRAFT SQL
below, to confirm the policy set hasn't changed since 2026-07-14):

```sql
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('staff_quotes', 'preorder_stores')
ORDER BY tablename, cmd, policyname;
```

Also re-run the advisor (`get_advisors` performance category) and diff the
`multiple_permissive_policies` `cache_key`/`detail` entries for these two
tables against the "Verified (role, cmd) breakdown" sections below.

---

## Why this costs anything

Postgres RLS evaluates **every PERMISSIVE policy that applies to a given
`(role, command)`** and OR's their results together — a row is visible /
writable if *any* applicable permissive policy's `USING`/`WITH CHECK`
evaluates true. Concretely, for one query:

- Postgres does not stop at the first matching policy. It runs the
  `USING`/`WITH CHECK` expression of **every** permissive policy whose
  `roles` includes the current role and whose `cmd` matches (or is `ALL`).
- Each extra policy is effectively an extra `OR`-ed subquery/EXISTS clause
  tacked onto the access check, evaluated per row (before the initplan fix)
  or at least once per query (after it). More policies = more predicate
  evaluation work, and the planner has less freedom to short-circuit than it
  would with one combined expression.
- A `cmd = ALL` policy is not "one policy" from the planner's perspective —
  it's evaluated for SELECT, INSERT, UPDATE, and DELETE alike, so it
  multiplies out against every cmd-specific policy on the same table. This
  is exactly why a table with only 5 distinct policy *definitions*
  (`preorder_stores`, `staff_quotes`) produces 20 lint *findings*: the
  advisor reports one finding per `(role, cmd)` pair with >1 applicable
  permissive policy, and `roles = {public}` + `cmd = ALL` policies fan out
  across all 5 relevant roles (`anon`, `authenticated`, `authenticator`,
  `dashboard_user`, `supabase_privileged_role`) × up to 4 commands.
- Merging N overlapping permissive policies into 1 (`USING (a) OR (b) OR ...`)
  collapses that fan-out back down to a single evaluation per row/query,
  at the cost of policy expressions that are less individually readable and
  MUST be re-audited for equivalence (see caveats below — this is not a
  free refactor).

---

## staff_quotes — current policies (dumped from pg_policies, 2026-07-14)

| policyname | roles | cmd | qual | with_check |
|---|---|---|---|---|
| `staff_quotes_admin_access` | `{public}` | `ALL` | `EXISTS (SELECT 1 FROM staff_users WHERE staff_users.user_id = auth.uid() AND staff_users.is_active = true AND staff_users.role = ANY (ARRAY['admin','super_admin']))` | same as qual |
| `staff_quotes_own_access` | `{public}` | `ALL` | `staff_user_id IN (SELECT staff_users.id FROM staff_users WHERE staff_users.user_id = auth.uid() AND staff_users.is_active = true)` | same as qual |
| `staff_quotes_insert_own` | `{authenticated}` | `INSERT` | *(null)* | `submitted_by_user_id = auth.uid()` |
| `staff_quotes_select_own` | `{authenticated}` | `SELECT` | `submitted_by_user_id = auth.uid()` | *(null)* |
| `staff_quotes_select_staff` | `{authenticated}` | `SELECT` | `EXISTS (SELECT 1 FROM staff_users s WHERE s.user_id = auth.uid() AND s.is_active AND (s.role = ANY (ARRAY['admin','super_admin']) OR s.permissions ? 'quotes:write' OR s.permissions ? 'quotes:approve' OR s.permissions ? 'quote-tool'))` | *(null)* |

5 policies total. All qual/with_check text also carries the `auth_rls_initplan`
issue (bare `auth.uid()`) — out of scope for this doc (B5 is about policy
*count*, not initplan; that's B4's job, though B4 only covers the 9
checkout-hot tables and does not include `staff_quotes`).

### Verified (role, cmd) breakdown for staff_quotes (20 findings)

Because `staff_quotes_admin_access` and `staff_quotes_own_access` are both
`cmd = ALL, roles = {public}`, they overlap with each other on **every**
role × every action. The three `authenticated`-only policies only add to
that baseline for their specific action:

| Group | Roles (5×) | Action | Overlapping policies | Findings |
|---|---|---|---|---|
| A | anon, authenticated, authenticator, dashboard_user, supabase_privileged_role | DELETE | `{admin_access, own_access}` | 5 |
| B | anon, authenticator, dashboard_user, supabase_privileged_role | INSERT | `{admin_access, own_access}` | 4 |
| C | authenticated | INSERT | `{admin_access, insert_own, own_access}` | 1 |
| D | anon, authenticator, dashboard_user, supabase_privileged_role | SELECT | `{admin_access, own_access}` | 4 |
| E | authenticated | SELECT | `{admin_access, own_access, select_own, select_staff}` | 1 |
| F | anon, authenticated, authenticator, dashboard_user, supabase_privileged_role | UPDATE | `{admin_access, own_access}` | 5 |

Total: 5+4+1+4+1+5 = **20**, matching the advisor count exactly.

### DRAFT proposal for staff_quotes

**DRAFT — semantics must be reviewed case-by-case.**

**Step 1 (~18 of 20 findings — see correction):** merge
the two `cmd = ALL, roles = {public}` policies into one. This is the clean
part of the merge — both already apply to the same roles and the same
commands, so OR-ing their `USING`/`WITH CHECK` is semantically a
straightforward union of "who can see/write this row" with no behavior
change for DELETE/UPDATE (which only these two policies touch):

> **Correction (2026-07-14):** this step was originally billed as "10 of 20
> (groups A and F)". That undercounts. `{admin_access, own_access}` is the
> *sole* overlap not just on DELETE (A) and UPDATE (F) but also on INSERT and
> SELECT for the four **non-authenticated** roles (groups B and D) — those
> have no per-verb policy, so they also collapse 2→1. Step 1 therefore clears
> A+B+D+F = **18** findings, leaving only C (authenticated INSERT, `{merged,
> insert_own}`) and E (authenticated SELECT, `{merged, select_own,
> select_staff}`) = 2 residual for step 2. Confirm with a
> `get_advisors(performance)` diff after applying `B5b_staff_quotes_step1.sql`.

```sql
-- DRAFT — semantics must be reviewed case-by-case.
BEGIN;

DROP POLICY "staff_quotes_admin_access" ON public.staff_quotes;
DROP POLICY "staff_quotes_own_access" ON public.staff_quotes;

CREATE POLICY "staff_quotes_admin_or_own_access" ON public.staff_quotes
    AS PERMISSIVE
    FOR ALL
    TO public
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
```

(Note: initplan-safe `(select auth.uid())` used above since this is a fresh
policy body being drafted anyway — worth doing at the same time, but flag it
to the reviewer explicitly since it's an extra behavior-preserving change
bundled into the merge.)

**Step 2 (groups C and E — NOT fully resolved by step 1, flagged not
drafted):** after step 1, `INSERT` for `authenticated` still has
`{admin_or_own_access, insert_own}` (2 policies) and `SELECT` for
`authenticated` still has `{admin_or_own_access, select_own, select_staff}`
(3 policies). This residual overlap is *structural*: `admin_or_own_access`
has `roles = {public}` (which includes `authenticated`) and `cmd = ALL`
(which includes INSERT/SELECT), so it necessarily overlaps with any
`authenticated`-scoped, action-specific policy on the same table. Two ways
to fully resolve this, both of which change semantics more than step 1 and
need explicit sign-off:

  - **(a) Accept the residual overlap.** 2–3 policies is still much better
    than 3–4, and `insert_own`/`select_own`/`select_staff` encode
    self-service rules that are conceptually distinct from admin/own-quote
    access — merging them into one giant policy trades a small performance
    win for a much harder-to-read policy. Recommended default unless
    profiling shows staff_quotes SELECT/INSERT is actually hot.
  - **(b) Fully merge.** Drop `insert_own`, `select_own`, `select_staff` and
    fold their conditions into `admin_or_own_access` (only valid if that
    policy is also restricted to `roles = {authenticated}` for those verbs,
    which would require splitting it into an ALL/public part and a
    per-verb/authenticated part — no longer "one policy per table"). This
    needs a policy-by-policy correctness review with whoever owns quote
    submission access rules before drafting SQL; not attempted here.

---

## preorder_stores — current policies (dumped from pg_policies, 2026-07-14)

| policyname | roles | cmd | qual | with_check |
|---|---|---|---|---|
| `preorder_stores_service_role` | `{public}` | `ALL` | `auth.role() = 'service_role'::text` | *(null)* |
| `preorder_stores_owner_delete` | `{public}` | `DELETE` | `auth.uid() = owner_id` | *(null)* |
| `preorder_stores_owner_insert` | `{public}` | `INSERT` | *(null)* | `auth.uid() = owner_id` |
| `preorder_stores_public_read` | `{public}` | `SELECT` | `is_active = true` | *(null)* |
| `preorder_stores_owner_update` | `{public}` | `UPDATE` | `auth.uid() = owner_id` | `auth.uid() = owner_id` |

5 policies total, all `roles = {public}`.

### Verified (role, cmd) breakdown for preorder_stores (20 findings)

Because every policy here is `roles = {public}`, and `preorder_stores_service_role`
is `cmd = ALL`, the same overlap pattern repeats identically across all 5
roles for each of the 4 non-ALL commands:

| Action | Overlapping policies | Roles affected | Findings |
|---|---|---|---|
| DELETE | `{owner_delete, service_role}` | anon, authenticated, authenticator, dashboard_user, supabase_privileged_role | 5 |
| INSERT | `{owner_insert, service_role}` | anon, authenticated, authenticator, dashboard_user, supabase_privileged_role | 5 |
| SELECT | `{public_read, service_role}` | anon, authenticated, authenticator, dashboard_user, supabase_privileged_role | 5 |
| UPDATE | `{owner_update, service_role}` | anon, authenticated, authenticator, dashboard_user, supabase_privileged_role | 5 |

Total: 5+5+5+5 = **20**, matching the advisor count exactly.

### DRAFT proposal for preorder_stores

**DRAFT — semantics must be reviewed case-by-case.**

Unlike `staff_quotes`, this one has a clean full resolution: because
`preorder_stores_service_role` is the *only* thing overlapping with each of
the 4 action-specific policies (no authenticated-only extra policies to
complicate things), folding its condition into each per-action policy and
dropping the standalone ALL policy removes all 20 findings, not just some:

```sql
-- DRAFT — semantics must be reviewed case-by-case.
BEGIN;

DROP POLICY "preorder_stores_service_role" ON public.preorder_stores;
DROP POLICY "preorder_stores_owner_delete" ON public.preorder_stores;
DROP POLICY "preorder_stores_owner_insert" ON public.preorder_stores;
DROP POLICY "preorder_stores_public_read" ON public.preorder_stores;
DROP POLICY "preorder_stores_owner_update" ON public.preorder_stores;

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
```

**Caveats a reviewer must check before running this:**
- This changes 5 named policies into 4 differently-named policies. Anything
  that references the old policy names (docs, other migrations, tooling
  that inspects `pg_policies.policyname`) needs updating.
- `preorder_stores_select_merged` folding `service_role` into a SELECT-only
  policy is fine, but double check no code path relies on the service role
  being able to SELECT rows where `is_active = false` via a *different*,
  currently-uncombined policy path (it shouldn't — `service_role` was
  previously `ALL`, so this preserves that), and re-verify service-role
  access still works end-to-end (edge functions, cron jobs, webhooks) after
  applying.
- Table currently has 0 live rows (`n_live_tup = 0` per `pg_stat_user_tables`
  as of 2026-07-14), so there is no data-shape risk in testing this, but
  also no way to sanity-check the merge against real rows before it ships.

---

## Remaining tables affected by `multiple_permissive_policies`

Full breakdown from the advisor JSON (`multiple_permissive_policies` lint,
144 total findings project-wide). Only `staff_quotes` and `preorder_stores`
are analyzed above; everything else below is listed for prioritization only
— no draft SQL in this doc.

| Table | Findings |
|---|---|
| staff_quotes | 20 |
| preorder_stores | 20 |
| chat_messages | 10 |
| chat_conversations | 10 |
| supplier_price_rules | 5 |
| supplier_import_jobs | 5 |
| shopify_product_sync | 5 |
| print_area_templates | 5 |
| preorder_campaigns | 5 |
| organization_artwork_variants | 5 |
| org_users | 5 |
| lead_times | 5 |
| job_trackers | 5 |
| design_submissions | 5 |
| business_rules | 5 |
| b2b_member_catalogue_item_grants | 5 |
| b2b_member_catalogue_grants | 5 |
| products | 2 |
| designs | 2 |
| categories | 2 |
| brands | 2 |
| variant_reorder_requests | 1 |
| variant_inventory | 1 |
| proof_editable_field_paths | 1 |
| product_print_areas | 1 |
| manufacturers | 1 |
| library_items | 1 |
| library_item_colors | 1 |
| library_colors | 1 |
| bom_items | 1 |
| ai_generation_history | 1 |
| account_requests | 1 |

Sum check: 20+20+10+10+(13×5)+(4×2)+(11×1) = 40+20+65+8+11 = **144**, matches
the advisor's total `multiple_permissive_policies` finding count exactly.
