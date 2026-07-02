# IDE prompt — close cross-tenant data-leak vectors (org-scope customer reads)

> Paste everything below the line into your in-repo IDE agent (run inside `print-room-portal`).
> **Read `docs/security/2026-07-01-cross-tenant-data-isolation-audit.md` first** — it has the evidence, file:line, and live-data facts this prompt is based on (verified against prod 2026-07-01).
> This is a **security fix — use TDD** (write the failing isolation tests first). Do not weaken any test to make it pass.

---

## Objective

A logged-in member must only ever read **their own organization's** data. Today the portal reads customer data with the **service-role Supabase client (`getSupabaseServer`), which bypasses RLS**, and several reads scope by **`customer_email` only** — so any two accounts that share an email see each other's data. (This already fired once: seeded demo trackers surfaced on the Anytime Fitness account.) Replace every email-only scope with an **org-verified** scope (for members) or an **auth-user-verified** scope (for org-less individuals). Give `job_trackers` a real tenant key and backfill it. No change to *legitimate* access.

## The invariant to enforce everywhere

> Every read of `quotes`, `orders`, `job_trackers`, `design_collections`, `design_submissions` must be constrained to the caller's tenant: `organization_id = <caller's active org>` for members, or a strong auth-verified owner (`user_id`/`created_by = auth uid`) for org-less individuals. **`customer_email` must never be the sole scope, and must never cross an org boundary.**

## Grounding facts (from the audit — don't re-derive)

- Portal customer reads use `getSupabaseServer()` = service-role → **RLS is bypassed**; the WHERE clause is the only guard. (RLS policies *do* exist on these tables — good for anon/client access, useless for these server reads.)
- `job_trackers`: **1,222 rows; `company_id` & `location_id` populated on 0; `user_id` on 10; `quote_id` on 0** (all legacy). **1,097 are fully orphaned** (no user/org/email). New B2B trackers get a `quote_id` (→ org via `quotes.organization_id`); legacy ones have nothing.
- Because `company_id` is null on every tracker, the org-admin "company-wide orders" path (`getJobsForCompany`) **returns nothing today**, so every tracker view falls through to `user_id` → **email**.
- 0 emails span 2 orgs and 0 multi-org users *right now* — so this is latent, not actively leaking. Fix before real-customer signups scale.

## Leak vectors to fix (verify exact lines as you go)

| # | Location | Fix |
|---|----------|-----|
| 1 | `lib/job-tracker-queries.ts` `getJobsForCustomer(email)` (~:174) | org-scope or remove; never return org-owned trackers by email |
| 2 | `lib/job-tracker-queries.ts` `getJobTrackerForUserByToken` (~:249-314) | drop `ownsByEmail`; authorize by `user_id` or `tracker.organization_id === caller org` |
| 3 | `lib/portal-data.ts` `fetchAccountDataForUser` email fallback (~:255-266) | remove email-only quote branch; individuals scope by `created_by = userId` |
| 4 | `lib/collections.ts` `getCustomerCollections` (~:70) | add org filter (`company_id`/org); individuals by `customer_id = userId` |
| 5 | `lib/collections-detail.ts` `getAvailableDesigns` | same as #4 for `design_submissions` |
| 6 | `lib/company.ts` `.single()` on `user_organizations` (~:44-48) | resolve **active** org from session/`CompanyContext`; don't `.single()` |
| — | `lib/portal-data.ts` `fetchOrderTrackerDataForUser` (~:113-195) | thread the resolved `orgId` into org-scoped queries; no email fall-through for members |

## Tasks

**Task 0 — Guardrail tests first (TDD, must fail before the fix).** Mirror existing suites (`lib/monday/__tests__`, `lib/checkout/__tests__`, `app/(portal)/my-collections/__tests__`). Cover:
- member of org A cannot read org B's quote / tracker / collection / submission via list *or* deep-link token;
- two accounts sharing one email do **not** see each other's trackers/quotes/collections;
- an org member's tracker + `/my-collections` lists are org-scoped (not email);
- deep-link token for a tracker outside the caller's org → `null`;
- a multi-org user resolves to their **active** org, deterministically.

**Task 1 — Tenant key on `job_trackers` (migration + backfill).**
- Add `organization_id uuid` (nullable, indexed) as the canonical tenant key (recommended over reviving `company_id`, since quotes/orders already key on `organization_id`).
- **Back up first:** `CREATE TABLE job_trackers_isobackfill_bak_<date> AS SELECT * FROM job_trackers;` (reversible).
- Backfill: `UPDATE job_trackers jt SET organization_id = q.organization_id FROM quotes q WHERE q.id = jt.quote_id;` (legacy rows with no `quote_id` stay null — that's correct; they're not attributable to an org).
- Stamp `organization_id` at creation in every tracker-insert path — locate them (`lib/checkout/submit.ts`, `app/api/reorder/route.ts`, any `create-monday-item`/`job_trackers` insert) and set it from the order's org.

**Task 2 — Tracker reads.** In `job-tracker-queries.ts` + `fetchOrderTrackerDataForUser`:
- org-admin/company view: scope by `organization_id = orgId` (replaces the dead `company_id` path);
- member list: `organization_id = orgId` — **remove the `getJobsForCustomer(email)` fallback for members**;
- org-less individual: scope by `user_id = userId` only. If you keep any email match, guard it with `organization_id IS NULL` so an org-owned tracker can never surface by email.

**Task 3 — Deep-link token.** In `getJobTrackerForUserByToken`, authorize by `ownsByUser` OR (caller is a member AND `tracker.organization_id === caller org`). Remove `ownsByEmail`. Unknown/foreign token → `null` (callers already surface as not-found).

**Task 4 — Quotes.** In `fetchAccountDataForUser`: members stay org-scoped (keep `.eq('organization_id', …)`). Replace the `else if (email)` branch with an owner-scoped query (`created_by = userId`); if email must be used, add `.is('organization_id', null)` so it can't return an org's quotes.

**Task 5 — Collections/submissions.** In `collections.ts` / `collections-detail.ts`: add the org filter (`company_id`/org) for members; for individuals scope by `customer_id = userId`, not raw email. Columns already exist.

**Task 6 — Multi-org.** Stop `.single()`/`.maybeSingle()` on `user_organizations` (`company.ts`, `portal-data.ts:118`, `:228`, `job-tracker-queries.ts:283`, `reorder/route.ts`). Resolve one **active** org from the session/`CompanyContext` (`getPortalOwnerKey` already encodes the owner) and scope everything to it.

**Task 7 — (recommended, may be a follow-up PR) Defense-in-depth.** Where feasible, read customer data through the **authenticated (RLS-governed) client** instead of service-role, so the DB enforces isolation even if a WHERE clause is missed. First verify the existing SELECT policies actually scope by org membership (if they're permissive, fixing them is its own task).

## Decisions to confirm before finishing

1. **Org-less individuals' history:** match by a one-time-backfilled `user_id` (recommended — then drop email matching entirely), or keep a tightened email match restricted to `organization_id IS NULL` rows? Backfilling `user_id` means mapping `customer_email → auth.users` once.
2. **Tracker tenant key:** new `organization_id` column (recommended) vs reviving `company_id`/`location_id`?
3. **The 1,097 fully-orphaned trackers:** leave (they're already unreachable) or archive/delete? (Separate data task — the operator offered to handle it.)

## Gotchas

- **Service-role bypasses RLS** — do not assume the DB will catch a missing filter; the WHERE clause *is* the security boundary.
- Legacy trackers become org-less after backfill; org members must simply **not see them** (correct), not error.
- The org-admin company-wide view currently returns nothing; after switching to `organization_id` it will start returning the org's trackers — that's intended, confirm it looks right.
- **`unstable_cache` keys** in `portal-data.ts` are `(userId, email)` — add the resolved `orgId` to the cache key parts so switching org context can't serve another org's cached slice. (Also relevant to the 60s stale-view behavior noted earlier.)
- Reuse `CompanyContext`/`getPortalOwnerKey` for the active org — don't re-resolve org differently per function.

## Verify

- Task 0 tests pass; full suite + `tsc` green.
- Manual: as an org member, `/my-collections` and the order tracker show only that org's data; a foreign quote/tracker/collection is never visible; a deep-link to a foreign tracker token → not found.
- Two accounts sharing an email see only their own data.
- Org-admin company-wide tracker view returns the org's trackers post-backfill.

## Out of scope

- Cleaning the 1,097 orphan legacy trackers (separate data op).
- `print-room-chatbot-api` / `ceremony-online` (separate apps).
- Full migration to the authenticated client (Task 7 is optional/phased).

## Done when

- No customer-data read is scoped by `customer_email` alone; every read is org- or auth-owner-scoped.
- `job_trackers.organization_id` is populated (new rows stamped, existing backfilled from quotes); migration backed up.
- Multi-org users resolve to one active org; no `.single()` on `user_organizations`.
- Deep-link tokens can't cross orgs.
- Guardrail tests + suite + `tsc` green; PR notes the migration + any Vercel/backfill follow-ups.
