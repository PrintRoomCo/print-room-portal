# Order tracker — Phase 1: org-admin visibility — design

**Date:** 2026-07-08
**Branch:** `feat/tracker-org-admin-visibility`
**Phase:** 1 of the order-tracker portal-migration epic (below)

## Epic context

The order tracker is being reworked across four independently-shippable phases,
driven by five asks from Jon:

1. **Org-admin visibility** — org admins see every tracker in their org. ← *this spec*
2. **Portal owns Monday** — port the status synonym engine + provisioning +
   per-stage email + webhook logging; un-filter & repoint the Monday webhooks to
   the portal; disable the studio equivalents.
3. **Sign-up-to-view** — email→`auth.users` detector; unregistered recipients get
   a "sign up to view your tracker" invite (deep-linked) instead of the broken
   authless studio view.
4. **Finish migration** — Starshipit + tracking-link + quote mirroring + remaining
   column handlers + collections fulfilment; decommission the studio job-tracker.

Locked epic decisions (2026-07-08): status model = Monday Job-Status column
(un-filter the one webhook + port the full synonym engine); some jobs are created
in Monday (so provisioning must move to the portal); email on every stage. Those
decisions bind Phases 2–4; Phase 1 is orthogonal to them and safe to ship first.

Phase 1 is scoped first because it is small, isolated, ships value immediately
(Anytime Fitness's admin can see their orders today), and it touches the same two
query files (`lib/portal-data.ts`, `lib/job-tracker-queries.ts`) the later phases
build on — doing it first avoids churn.

## Problem

Org admins **cannot** see their organisation's orders. The org-admin code path
is dead in two places, both built on a tenancy model that was never populated:

1. **List view** — `fetchOrderTrackerDataForUser` (`lib/portal-data.ts:129-146`)
   reads `b2b_accounts.company_id`. That **column does not exist** → PostgREST
   returns an error → the code destructures only `data` (error swallowed) →
   `b2bAccount` is null → the whole org block is skipped → it **falls through to
   `getJobsForUser`**. Net effect: an org admin sees only their *own* orders.
   Even if the block were reached, `getJobsForCompany` filters
   `job_trackers.company_id` / `location_id`, which are populated on **0 of 1257**
   rows, so it would return nothing.

2. **Token / deep-link view** — `getJobTrackerForUserByToken`
   (`lib/job-tracker-queries.ts:280-304`) authorises an org admin only when
   `b2b_accounts.company_id === tracker.company_id` **and** `tracker.location_id`
   ∈ the org's stores. Same dead columns → the branch never authorises → an org
   admin opening another member's tracker link gets `notFound()`.

**Root cause:** the 2026-06-03 portal-native-tracker spec assumed a
`company_id` / `location_id` tenancy model on `job_trackers`. That model was
never wired up. Real tenancy runs through the quote and the owning user.

**Evidence (live DB, 2026-07-08):**

- `b2b_accounts` has **no** `company_id` column (only `id`, `organization_id`, …).
- `job_trackers`: `company_id` populated on 0/1257 rows, `location_id` 0/1257.
  Linkable to an org via `quote_id`→`quotes.organization_id` and
  `user_id`→`user_organizations.organization_id`.
- Anytime Fitness (`org 6c65151e…`, code `ANFI`): org_admin =
  `hello@theprint-room.co.nz`, 68 per-gym `staff`. Its **one** tracker today is
  the Invercargill order (`ANFI-000083`, tracker `1624`, status `need-proof`),
  reachable identically via `quote_id`, `user_id`, and `customer_email`.
- Only **2 orgs** have an `org_admin` at all, so blast radius is tiny.
- `quotes.created_by` is **null** on that order — so ownership must key off the
  tracker's own `quote_id` / `user_id`, never `quotes.created_by`.

## Goal

An `org_admin` sees **every** job tracker in their organisation on the
`/order-tracker` list, and can open any of them via its token deep-link. `staff`
continue to see only their own. No cross-org leakage.

## Decisions (locked)

1. **Tenancy key = quote OR owning user.** A tracker belongs to org *O* iff
   `tracker.quote_id` → `quotes.organization_id = O`, **or** `tracker.user_id` is
   a member of *O* (`user_organizations`). Explicitly **not** `company_id` /
   `location_id` (dead), and **not** `customer_email` (an email is not a tenancy
   key — two orgs could share one, which would leak).
2. **org_admin list = org-wide superset.** The org-wide query already includes the
   admin's own orders (they're a member and their quotes are in the org), so there
   is no fall-through to a personal list. `staff` path is unchanged
   (`getJobsForUser`).
3. **Reuse the existing UI.** The list already renders an org-wide view when
   `isCompanyWide` is true (`TrackerSummaryCards` adds an "Awaiting Proof" card;
   `JobTrackerOrderCard` shows each order's `customer_email` — which for AF is the
   gym address, so admins can tell orders apart). The flag name `isCompanyWide` is
   retained; its meaning is "org-wide admin view". **No UI changes in Phase 1.**
4. **Authorisation lives in app code.** All these queries use the service-role
   client, which bypasses RLS — so the correctness of the org-scoping query *is*
   the security boundary. No RLS/migration work in this phase.

## Approach

### New query — `getJobsForOrganization(organizationId)` (`lib/job-tracker-queries.ts`)

Replaces `getJobsForCompany` (whose only caller is `portal-data.ts`).

1. Fetch the org's quote ids: `quotes.select('id').eq('organization_id', org)`.
2. Fetch the org's member user ids:
   `user_organizations.select('user_id').eq('organization_id', org)`.
3. Run up to two `job_trackers` queries — `.in('quote_id', quoteIds)` and
   `.in('user_id', memberIds)` — skipping either when its id list is empty, and
   **merge + dedupe by `id`** (a tracker matched by both must appear once). Sort
   by `created_at` desc.
4. `fireAndForgetItemsSync(trackers)` + `return attachProductImages(trackers)`, for
   parity with the sibling fetchers.
5. Standard guards: `error.code === '42P01'` → `[]`; wrap in try/catch → `[]`.

Two round-trips + JS dedupe (rather than one `.or(...in...)` string) is chosen for
readability and to avoid PostgREST `.or`/`in` string-building pitfalls; row counts
are tiny. *Known limit:* `.in()` on a very large id list could hit URL limits — not
reachable at current org sizes (≤ a handful of quotes, ≤ ~68 members); revisit if
an org exceeds ~a few hundred quotes/members.

### List fix — `fetchOrderTrackerDataForUser` (`lib/portal-data.ts`)

- Keep the `user_organizations` membership read (`organization_id, role`).
- If `role === 'org_admin' && organization_id`:
  `trackers = await getJobsForOrganization(organization_id)`; `isCompanyWide = true`.
- Else: `trackers = await getJobsForUser(userId, email ?? undefined)`;
  `isCompanyWide = false`.
- **Remove** the `b2b_accounts` lookup, the `stores` lookup, and the
  `getJobsForCompany` import.
- Pre-orders block, `ownerKey`, and the `unstable_cache` wrapper are unchanged.

### Token fix — `getJobTrackerForUserByToken` (`lib/job-tracker-queries.ts`)

- Keep `ownsByUser || ownsByEmail`.
- Replace the org-admin branch: when the requester is `org_admin` of
  `membership.organization_id`, set `authorized = await trackerBelongsToOrg(
  supabase, tracker, membership.organization_id)`.
- New private helper `trackerBelongsToOrg(supabase, tracker, orgId)`:
  - `tracker.quote_id` → `quotes.select('organization_id')` → `=== orgId` ⇒ true;
  - else `tracker.user_id` → `user_organizations` row with
    `user_id = tracker.user_id AND organization_id = orgId` exists ⇒ true;
  - else false.
- Update the function's doc comment (it currently describes the `company_id` /
  `location_id` rule).

This helper encodes the **same** tenancy rule as `getJobsForOrganization` (quote
OR owning-user membership), so the list and the deep-link cannot drift on who may
see what.

## Cache

`fetchOrderTrackerDataForUser` is `unstable_cache`d, keyed on `(userId, email)`,
tagged `cacheTags.orderTracker` with a TTL. Keying the admin's org-wide result on
their own `userId` is correct. A newly-created org tracker appears for the admin on
the next tag revalidation (order-status writes already bust this tag) or on TTL
expiry — same freshness contract as today. No cache change.

## Not in scope / unchanged

- **UI** — `OrderTrackerClient`, `JobTrackerOrderCard`, `TrackerSummaryCards` are
  already `isCompanyWide`-aware; untouched. `/api/order-tracker` delegates to the
  same fetcher, so it's fixed transitively.
- `getJobsForUser` / `getJobsForCustomer` — unchanged.
- **Pre-orders staff filter** — the `awaiting-period-close` block filters staff by
  `quotes.created_by`, which is null on current orders, so staff under-return
  pre-orders. Real, but a separate concern from tracker visibility; left for a
  later pass.
- **Legacy Monday-only trackers** — the ~1257 rows with only `monday_item_id`
  (no `quote_id`/`user_id`) remain invisible to orgs. They predate the portal and
  do not join to any quote (`monday_item_id`→`quotes` yields 0). Reconnecting them
  is Phase 2/4 migration work, not Phase 1.
- No DB migration, no RLS change.

## Security note

Because the service-role client bypasses RLS, the org-scoping query is the only
thing standing between one org and another's orders — so it must be exact.

- A token guess by an unrelated logged-in user (a different org, or a non-admin
  member who doesn't own the tracker) resolves to `null` → `notFound()`.
- An `org_admin` is authorised for a token **only** when that tracker resolves
  into *their* org via its quote or its owning user's membership.
- `customer_email` is deliberately excluded from org authorisation so a shared or
  colliding email can never widen visibility across orgs.

## Testing (TDD, RED first)

- **`getJobsForOrganization`**: returns a tracker linked via `quote_id`; via
  `user_id`; **dedupes** a tracker matched by both; excludes another org's
  tracker; empty org → `[]`.
- **`getJobTrackerForUserByToken`**: org_admin of the owning org (via `quote_id`)
  → tracker; via owning-user membership → tracker; org_admin of a **different**
  org → `null`; same-org **staff** (non-owner) → `null`; owner (by user_id/email)
  → tracker; unknown token → `null`.
- **`fetchOrderTrackerDataForUser`**: org_admin → `isCompanyWide = true` + org
  superset; staff → own orders + `isCompanyWide = false` (integration-level with a
  mocked Supabase client).
- `next build` green.
- **Manual smoke:** as `hello@theprint-room.co.nz` (AF admin), `/order-tracker`
  shows the Invercargill order; opening its token renders the detail page.
