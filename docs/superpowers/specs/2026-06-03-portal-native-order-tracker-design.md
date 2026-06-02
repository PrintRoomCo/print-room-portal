# Portal-native order tracker — design

**Date:** 2026-06-03
**Branch:** `feat/portal-native-order-tracker`
**Phase:** 2 (follow-up to the 2026-06-02 orders-rename + location-gate spec)

## Problem

The "Open tracker" button on a customer's order detail page
(`/my-collections/<id>`) and the "Track Project" / "View Full Project Tracker"
links on the `/order-tracker` list point at an **external** URL built by
`getTrackerUrl()`:

```
https://www.theprintroom.nz/apps/order-tracker/job/<tracker_token>
```

That target is a dead Shopify-app-proxy / Vercel route → customers land on a
**Vercel 404** and cannot track their order. The status-update **email**
(`lib/email/tracker-notification.ts`) builds the same dead URL, so every order
notification ships a broken "View order tracker" CTA.

Meanwhile the portal **already renders the full tracker UI natively** inside
`JobTrackerOrderCard` (status steps, production timeline, tracking number,
itemised lines, proof files) on the authed `/order-tracker` list. The data is
real; only the deep-link target is dead.

## Goal

A working, portal-native order tracker the customer can actually open — from the
order page, the tracker list, and the email — with no dependency on the external
studio/Shopify proxy.

## Decisions (locked with Jamie 2026-06-03)

1. **Access model: authed portal page.** New route lives under the `(portal)`
   segment, so opening a tracker requires login. The page also **verifies the
   tracker belongs to the requesting user** (own user_id / own email / org_admin
   of the owning company) before rendering — token alone is not enough.
2. **Repoint the email CTA too.** `tracker-notification.ts` → portal URL in the
   same pass, since it ships the same dead link today.
3. Reuse `JobTrackerOrderCard` for the detail view (no duplicate tracker UI).

## Approach

### New route — `app/(portal)/order-tracker/[token]/page.tsx`
Server component. Resolves the authed user, fetches the single tracker scoped to
that user, and renders it. **`notFound()`** when missing or not owned → the
portal's own 404 (never a Vercel 404).

### New scoped query — `getJobTrackerForUserByToken(token, userId, email)`
(`lib/job-tracker-queries.ts`)
1. Fetch tracker by `tracker_token` (`maybeSingle`). None → `null`.
2. Authorize (any one):
   - `tracker.user_id === userId`, **or**
   - `email` matches `tracker.customer_email` (case-insensitive), **or**
   - requester is `org_admin` of the org whose `b2b_accounts.company_id ===
     tracker.company_id` **and** `tracker.location_id` ∈ that org's store ids
     (mirrors `getJobsForCompany` scoping used by the list).
   - Otherwise → `null` (treated as not-found; no info leak).
3. `attachProductImages([tracker])` and return the enriched row.

### Data wrapper — `getPortalTrackerByToken(token)` (`lib/portal-data.ts`)
Mirrors `getPortalOrderTrackerData`: resolve `getPortalUser()`, delegate to the
scoped query, return `null` when unauthenticated.

### Path helper — `getPortalTrackerPath(token)` (`lib/job-tracker.ts`)
Returns the **relative** in-app path `/order-tracker/<token>`. Replaces every
in-app `getTrackerUrl()` consumer (no external host for same-origin nav).

### Card changes — `JobTrackerOrderCard`
- `trackerUrl` now built from `getPortalTrackerPath` → internal `<Link>`
  (drop `target="_blank"`). On the list, "Track Project" / "View Full Project
  Tracker" now navigate to the detail route.
- New optional props: `defaultExpanded` (detail page opens expanded) and
  `hideTrackerLink` (detail page hides the now-self-referential
  "Track Project" / "View Full Project Tracker" links).

### Repoint call sites
- `my-collections/[collectionId]/page.tsx` ×2 (`getTrackerUrl` → `getPortalTrackerPath`;
  `<a target=_blank>` → `<Link>`).
- `lib/email/tracker-notification.ts`: absolute portal URL
  `${NEXT_PUBLIC_SITE_URL || 'https://portal.theprintroom.nz'}/order-tracker/<token>`.

## Not in scope / unchanged
- `getTrackerUrl()` stays exported (no in-app callers after this; left for any
  external/legacy reference). External studio `/apps/order-tracker/job/*` route
  is untouched.
- No DB/migration. `job_trackers` already holds everything (synced from Monday
  by print-room-studio). No new sync.
- The existing `/order-tracker` **list** route is unchanged.

## Security note
The single-token fetch is access-checked server-side (step 2 above). A logged-in
user cannot view another org's tracker by guessing a token; unauthorised →
`notFound()`.

## Testing
- `lib/job-tracker-queries` unit test for `getJobTrackerForUserByToken`:
  owner-by-user-id passes; owner-by-email passes; org_admin-of-company passes;
  unrelated logged-in user → `null`; unknown token → `null`. (TDD, RED first.)
- Email URL test: CTA href is the portal `/order-tracker/<token>` absolute URL.
- `next build` green.
