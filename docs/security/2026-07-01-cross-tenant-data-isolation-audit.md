# Cross-tenant data-isolation audit — print-room-portal (2026-07-01)

**Question:** can one account see another account's data on the portal?
**Short answer:** **No *active* leak between real customers today** (verified: 0 emails span two orgs, 0 multi-org users, data is sparse). **But the portal has real, structural email-based leak vectors with no DB-level backstop on the read paths** — and one already manifested (the seeded demo trackers surfaced on the Anytime Fitness account). These will leak as real customers onboard. Fix before scaling signups.

All evidence below is from live prod (Supabase MCP) + code read on 2026-07-01.

---

## How isolation works here (and the core weakness)

- Every customer-facing table has **RLS enabled *with* policies** (`quotes` 4, `orders` 1, `job_trackers` 3, `design_collections` 5, `design_submissions` 2, `stores` 4, `b2b_catalogues` 1, `user_organizations` 1, `variant_inventory` 2, …). Good defense-in-depth for anon/client access.
- **BUT** the portal's server reads use `getSupabaseServer()` = the **service-role key, which bypasses RLS entirely.** So for every SSR/API read below, **isolation = the query's WHERE clause only.** The RLS policies do *not* protect these paths. A single missing `.eq('organization_id', …)` = cross-tenant read.

---

## Verified leak vectors (service-role → RLS bypassed → scoped by email only)

| # | Location | What it returns | Scoping | Severity |
|---|----------|-----------------|---------|----------|
| 1 | `lib/job-tracker-queries.ts:174` `getJobsForCustomer(email)` | job_trackers | **customer_email only** | **HIGH** |
| 2 | `lib/job-tracker-queries.ts:272-278` `getJobTrackerForUserByToken` | single tracker (deep link) | token + `ownsByEmail` (email match, no org) | **HIGH** |
| 3 | `lib/portal-data.ts:255-266` account-data email fallback | quotes | **customer_email only** (when membership null) | MED |
| 4 | `lib/collections.ts:70` `getCustomerCollections` | design_collections | **customer_email only** (`company_id` col exists, unused) | MED |
| 5 | `lib/collections-detail.ts` `getAvailableDesigns` | design_submissions | **customer_email only** | MED |
| 6 | `lib/company.ts:48` `.single()` on user_organizations | drives all org scoping | errors on multi-org → treated as individual → email fallback | MED (latent) |

**Vector 1 is the important one** and is made worse by a data fact:

- **`company_id` and `location_id` are set on 0 of 1,222 job_trackers.** So `getJobsForCompany(company_id, locationIds)` — the org-admin "see all my company's orders" path — **returns nothing**, and *every* order-tracker view falls through: `getJobsForUser(user_id)` (only **10/1222** trackers have a `user_id`) → **`getJobsForCustomer(email)`**. Email is effectively the *primary* key for tracker visibility. Two accounts that ever share an email see each other's trackers. **This is exactly how the demo trackers (Cardrona) appeared on the AF account.**
- `getJobTrackerForUserByToken` (vector 2) has a correct org-admin branch, but it's gated behind `company_id` matching — which is null on every tracker — so that branch never authorizes; `ownsByEmail` becomes the only positive path.

---

## Current live exposure (why it's not actively leaking *yet*)

- **0** customer_emails appear in quotes across **more than one** org.
- **0** users belong to more than one org (`user_organizations`).
- Job-tracker emails are all internal/test — `jamierogangeorge@gmail.com` (104 trackers), `jamie@ceremony.onl` (7), `jon@theprint-room.co.nz` (3), `finn@theprint-room.co.nz` (1), `john.smith@acme.com` (7, test), etc. None keyed to a real external customer org.
- Registered members whose email matches legacy trackers: `jamierogangeorge@gmail.com` (0 orgs → 104), `jamie@ceremony.onl` (0 orgs → 7), `jon@theprint-room.co.nz` (**1 org** → 3). Only `jon@` is an org member, and those 3 trackers have no org of their own, so it's his own historical data — not another customer's.
- `design_collections` is **empty** (0 rows); `design_submissions` = 2 rows.
- Only orgs in the system: **Hydro Surf** (demo/seed), **Anytime Fitness** (now empty after purge), **Test Account**.

So: sparse, internal data + org-scoped reads for real members ⇒ no cross-**customer** leak today. The vectors are **structural** and will trip as soon as (a) a real customer's email is reused across orgs, (b) a staff/partner is added to 2 orgs, or (c) trackers get created without a `user_id` match.

---

## Data-hygiene finding (not a leak, but cruft)

- **1,097 of 1,222 job_trackers are totally unscoped** (no `user_id`, `company_id`, `location_id`, *or* `customer_email`). They're unreachable via list queries and can't be authorized by token → orphaned legacy junk. Safe to archive/delete after a backup.

---

## Fix direction (priority order)

1. **Org-scope tracker reads (vector 1 & 2).** Give trackers a real tenant key — backfill `organization_id`/`company_id` (+`location_id`) from their `quote_id`/order, then require the viewer's org to match. Remove the pure-`customer_email` fallback, or restrict it to genuinely org-less individual users and never let it cross an org boundary.
2. **Backfill `company_id`/`location_id` on trackers** so `getJobsForCompany` actually works and org-admins get a correct company-wide view (right now it silently returns nothing).
3. **Handle multi-org users** — stop `.single()`/`.maybeSingle()` on `user_organizations`; select the active org from session/`CompanyContext` and scope to it.
4. **Org-scope `design_collections` / `design_submissions`** reads (`.eq('company_id', …)` / organization) — the columns already exist.
5. **Defense-in-depth:** read customer data through the **authenticated (RLS-governed) client** instead of service-role wherever feasible, so the DB enforces isolation even if a WHERE clause is missed. (The policies already exist.)
6. **Clean up** the 1,097 orphan trackers (backup + delete).

---

## Note on the recent cleanup

The Anytime Fitness / demo deletions this session were id/account-scoped with verified counts (Hydro Surf's `orders` stayed at 5 throughout); they did **not** touch any other org or the 1,222 legacy trackers. No collateral. Backups: `*_anytimetest_bak_20260701`, `quotes_anytimeq_bak_20260701`, `quote_items_anytimeq_bak_20260701`, `job_trackers_demo_bak_20260701`.
