# Monday-driven customer status emails — design

**Date:** 2026-07-21
**Branch:** `feat/tracker-milestone-emails` (off `main`; order-tracker Phase 2 already merged to `main`, commit `5982f4a`)
**Relationship:** a **revision of the email cadence** in the order-tracker Phase 2 work,
made *before* Phase 2 cuts over. Phase 2 built the "portal owns Monday status" engine +
per-stage email; this narrows *which* stages email and makes the dispatch email carry
tracking. No new tables, no new webhook — it edits the Phase 2 handler.

## Summary

When a portal-originated order advances on the Monday production board, email the
customer at **exactly two moments** — "in production" and "shipped (with tracking)".
Every other stage updates the tracker **silently** (pull-only via the existing
`/order-tracker/<token>` link). This is the notification the customer gets **nothing**
of today: in production, the status emails are gated off (`MONDAY_WEBHOOK_SECRET`
unset), so a placed order goes silent between confirmation and (maybe) a dispatch note.

## How this revises Phase 2

Phase 2's spec (`2026-07-08-order-tracker-phase-2-portal-monday-owner-design.md`) locked
two decisions this design deliberately supersedes, on Jon's 2026-07-21 call:

1. **"Email on every stage" → email on two milestones.** Investigation of the actual
   board (below) showed the customer wants to *hear* about production-start and
   dispatch, not the ~10 internal churn states staff move through (Internal Proof
   Approval, Artwork Proof Edits, Mockup Complete, Closed Job…). Emailing all of them
   would *manufacture* spam that does not exist today.
2. **"Dispatched email carries no tracking until Phase 4" → it carries tracking now.**
   The board already holds the NZ Post tracking link on the item at ship time
   (`link_mky1w9w`), written by the studio poller. We read it directly, so the dispatch
   email is useful on day one — no Starshipit integration in the portal required.

Everything else Phase 2 built (status engine, provisioning, de-dup infra, logging,
the cutover kill-switch) is reused unchanged.

## Locked decisions (2026-07-21, Jon)

- **Scope = two emails, pull-only for the rest.** `in-production` and `dispatched` push;
  all other customer-facing stages update the tracker silently.
- **Proof stages stay on their own flow.** `need-proof` / `proof-sent` are owned by
  `send-proof-email.ts` and are **excluded** here — no double-send by construction.
- **No forced accounts.** Each email carries the public tracker link. The portal-account /
  identity epic is explicitly deferred (see appendix).
- **Recipient = the job_tracker's `customer_email`**, never Monday's email column.
- **Feature reaches portal-originated orders only** — they are the ones with a tracker.
  Phone/manual Monday jobs (no tracker) are excluded by construction, and that is fine.

## Open decisions (refined from code — recommended defaults, flag if you disagree)

1. **`in-production` trigger label set → `{Assign to Production, All Production Complete}`
   (recommended)**, not `Assign to Production` alone. Reason: the status engine
   (`tracker-status-engine.ts`) maps *both* labels to canonical `in-production`, and the
   board shows staff use "All Production Complete" (14×/window) about as often as "Assign
   to Production" (12×) — some jobs skip straight to Complete. Firing on the **first of the
   two** guarantees one "in production" email per job. Copy is written to fit both
   ("Your order is in production"). **`Partially Shipped` is deliberately excluded** even
   though the engine lumps it into `in-production` — it means shipping, not starting.
2. **`dispatched` trigger label set → `{Shipped}` only (recommended).** The engine's
   `dispatched` bucket also swallows `Closed Job`, `Ready to Pickup`, `Ship Direct to
   Client`, `3PL Fulfillment` — we do **not** email on those in v1 (Closed Job is the most
   frequent value on the board and fires *after* Shipped; pickup ≠ shipped copy).
   "Partially Shipped" is out of scope for v1.
3. **Test-org suppression → add it (recommended).** The tracker webhook path has **no**
   test-org guard today, and test items are live on the board. Add a guard reusing the
   existing `isTestOrg` signal (cf. `lib/xero/eligibility.ts`) so a test org never gets a
   milestone email.

The gate keys on the **Monday label** (`displayLabel`), NOT the canonical status, precisely
because the canonical buckets are too coarse for email copy. The tracker's *status* still
derives from the canonical engine unchanged.

## Problem

`sendTrackerStatusEmail` (`lib/email/tracker-notification.ts`) has exactly one caller —
the Phase 2 webhook (`app/api/webhooks/monday/tracker-status/route.ts:518`) — and it
currently fires on **every** customer-facing transition via
`statusEmailType(canonicalKey, event.triggerTime)`. Two gaps:

1. **Wrong cadence.** Un-gated, this emails the customer on ~10 stages including internal
   ones. We want two.
2. **Hollow dispatch email.** Tracking is read from `tracker.tracking_info`
   (route.ts:515), which the *studio poller* populates — and the poller is disabled at
   cutover. Post-cutover the dispatch email would say "shipped!" with no tracking. The
   board holds the real link on the item; read that instead.

## Design

### 1. Email-trigger gate (the core change)

In the webhook handler, replace "email on every customer-facing transition" with an
explicit label allow-list, evaluated on `displayLabel` (the raw Monday Job-Status label):

| Monday Job-Status label | Email | Fires |
|---|---|---|
| `Assign to Production`, `All Production Complete` | **in-production** | first entry, once ever |
| `Shipped` | **dispatched** (+ tracking) | first entry, once ever |
| any other customer-facing label | — | tracker updates silently |

The tracker's `status`, `status_history`, `production_updates`, and the
`production_start_at` / `production_complete_at` timestamps are written on **all**
customer-facing transitions exactly as today — only the *email* is gated. So the customer
can still pull the full journey from the tracker link; they're only *pushed* the two.

### 2. Recipient (no change)

`contactEmail: tracker.customer_email` (route.ts:519) — already correct. The email only
sends when `tracker.customer_email` is set, which is the case for portal-originated orders
and blank for the phone/manual jobs we intend to skip.

### 3. Dispatch tracking source (change)

For the `dispatched` email, resolve tracking at send time with this precedence:

1. Monday item column `link_mky1w9w` ("Customer Tracker Link" — holds the NZ Post URL)
2. Monday item column `link_mkqz77w0` ("Supplier Tracking Link")
3. `tracker.tracking_info.url` (legacy / poller-populated)
4. **none → send anyway** with "shipped — tracking to follow" copy (no tracking block)

The webhook event payload carries only the status change, so the handler fetches these two
link columns for `mondayItemId` inside the deferred `after()` block (one Monday read).
Carrier is inferred from the URL via the existing `detectCarrierFromUrl`.

### 4. Idempotency (once-ever per milestone)

Reuse the existing `hasEmailBeenSent` / `recordEmailSend` dedup on
`(mondayItemId, emailType)` (`tracker_email_log`). Change `statusEmailType` so the two
milestone types return **stable** keys (`'milestone-in-production'`,
`'milestone-dispatched'`) that do **not** encode `triggerTime`. Effect: a re-entry to a
milestone after a hold/rework (Assign to Production → Job on Hold → Assign to Production)
does **not** re-notify. This deliberately diverges from Phase 2 decision #2
(per-transition, re-emails on re-entry) — correct for milestone emails, which should land
once. Because tracking arrives with "Shipped", the `dispatched` email is sent on that
transition; if it somehow lands before tracking exists, the fallback copy covers it and
the once-ever guard means no "now with tracking" follow-up (acceptable for v1).

### 5. Test-org suppression

Before send, skip trackers belonging to test organizations, reusing the existing
`isTestOrg` signal (cf. `lib/xero/eligibility.ts`). The tracker webhook path has no such
guard today — this adds one.

### 6. Email copy

Two cases in `sendTrackerStatusEmail`, selected by `newStatus`:

- **in-production** — subject "Your order is in production", body "Good news — your order
  <job ref> is now in production," + the tracker-link CTA. No tracking block.
- **dispatched** — subject "Your order has shipped", body + tracking block (number,
  carrier, "Track with carrier →") when resolved, or "tracking to follow" when not, + the
  tracker-link CTA.

Both carry the existing hybrid footer: a link to `/order-tracker/<token>`. No account
required, no "sign in" upsell in v1.

## Files touched

- **Modify** `app/api/webhooks/monday/tracker-status/route.ts` — the `after()` email block
  (~495–538): label-allow-list gate; fetch `link_mky1w9w`/`link_mkqz77w0` for the dispatch
  email; test-org guard.
- **Modify** `lib/email/tracker-notification.ts` — two-case copy (in-production /
  dispatched); ensure tracking block renders only when present.
- **Modify** `lib/email/tracker-email-log.ts` (`statusEmailType`, line 24) — stable
  milestone keys, and return `null`/skip for non-milestone canonical statuses.
- **Add** a small helper to fetch a Monday item's link columns (or extend the existing
  Monday client), if none exists.
- **Tests** (TDD): gate fires on the two label sets and *only* those; `Partially Shipped`,
  `Closed Job`, `Ready to Pickup`, `Proof Sent` do **not** email; dispatch tracking
  precedence + fallback; once-ever dedup across a hold re-entry; test-org suppression.

## What this does NOT do

- **No account / identity work.** See appendix — deferred.
- **No `Partially Shipped` email** (v1). No pickup/closed-job email.
- **No Starshipit integration in the portal.** Tracking is read from the Monday column the
  poller already writes; portal never talks to Starshipit here.
- **No change to the tracker status model, provisioning, or the cutover mechanism** — all
  inherited from Phase 2.

## Deploy preconditions (operational, HITL — Jon, not code)

This rides the **paused Phase 2 cutover**; it is not live until:

1. `MONDAY_WEBHOOK_SECRET` set on the portal.
2. The Monday Job-Status subscription un-filtered from "Shipped-only" so it also delivers
   the production labels (Monday config — Jon).
3. Studio poller kill-switch (`STUDIO_TRACKER_WEBHOOKS_DISABLED`) on, so the portal is the
   sole sender.

**Verify before build:** that the studio kill-switch disables only the *status/email* path
and **not** the Starshipit → `link_mky1w9w` carrier-link write-back (Phase 2 spec §3 states
carrier tracking is separately polling-driven and stays until Phase 4 — so the link should
keep landing on the item). If the kill-switch *does* stop the link write-back, the dispatch
email falls back to "tracking to follow" until Phase 4 wires Starshipit into the portal.

## Evidence appendix — the board data this design rests on

Board `1992701981` ("Production"), Job Status column `color_mkpnas0e`, activity window ~10
days to 2026-07-21 (1000-event cap):

- **112 Job-Status changes.** Targets: Closed Job 15 · All Production Complete 14 ·
  **Shipped 12** · **Assign to Production 12** · Need: Internal Proof Approval 11 · Sent:
  Proof+Invoice/Quote 9 · Proof Approved 9 · Mockup Complete 7 · Artwork Proof Edits 4 …
  → both triggers are live and frequent; the long tail is the internal churn we must not
  email.
- **5 recently-shipped jobs sampled** (Grappler, Hydro Surf, MTF #1612, DOC Beanies,
  Dairyworks): Monday's `Email` column blank on **3/5** (→ recipient must come from the
  tracker); a courier tracking URL present on **4/5** (in `link_mky1w9w`/`link_mkqz77w0`),
  absent on 1/5 (→ precedence + fallback). Grappler and Dairyworks (both portal-linked,
  `tracker_token` set) reached "Shipped" *with* tracking + email — i.e. staff **do** drive
  the portal's own items end-to-end (Phase 2 "Gap-a" substantially answered).
- "Shipped → Closed Job" happens fast (Closed Job is the top target; all 5 samples already
  Closed) → the handler must be event-driven and never read current board state on retry.

## Appendix — deferred: the customer-identity epic

Parked on 2026-07-21 (Jon: portal accounts "buy nothing yet, it just feels tidier").
Written down so it is not lost; **not** work items. Revisit a slice only when its trigger fires:

| Slice | Revisit when |
|---|---|
| Whitelist auto-onboard from the production board (tracker + JIT account + invite) | a known org (e.g. Anytime Fitness) asks to self-serve or see all its locations' jobs in one list |
| Self-serve account creation | inbound demand for a login that isn't tied to a single order |
| Shopify storefront ↔ portal shared identity (Supabase; theme already bundles `supabase-js`) | wishlist/quote volume justifies unifying identity — validate Shopify auth feasibility with a spike first |
| Wishlist quote → visible portal project | after shared identity exists |

Spine to preserve if/when revived: the **portal's Supabase identity is the single customer
account**, and account-provisioning is one reusable primitive every entry point calls.
