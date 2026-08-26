# Tracker address-change notifications + status-email cadence — design

**Date:** 2026-08-26
**Status:** Draft for Jon's review — open questions at the end, each with a recommended
default. Nothing here is implemented; nothing here executes the Phase 2 cutover.
**Repos:** `print-room-studio` (`apps/job-tracker`, the live customer tracker) and
`print-room-portal` (the tracker's future home). Spec lives in the portal repo per
convention even though Part A's v1 lands in the studio.

## Summary

Two pieces, deliberately kept separate:

- **Part A (net-new): address-change notifications.** When a customer submits a
  delivery-address change from their tracker page, today the only artifact is a
  Monday.com update @mentioning the account manager — no email to anyone, no
  persistence, no audit trail. Part A adds an **account-manager email (reply-to =
  customer)**, a **customer confirmation email**, an **audit entry** on the tracker,
  and **logging/rate-limiting** through the shared `tracker_email_log` — implemented
  in the studio (where the live customer surface is), shaped so it ports to the
  portal in one move.
- **Part B (decision, no new code): status-change email cadence.** The portal's
  milestone-email system (merged, dormant) stays at **two milestones**
  (in-production, dispatched). Activation remains the existing human-in-the-loop
  Phase 2 cutover checklist — this spec adds no code to that path and does not
  perform the cutover.

All facts below were re-verified against the working trees and the production
database on 2026-08-26.

---

## Verified current state

### A. The live customer tracker is the studio page, via Shopify proxy

The `tracker_ready` email (956 rows in `tracker_email_log`, still firing daily —
latest 2026-08-25) links customers to
`https://www.theprintroom.nz/apps/order-tracker/job/<ref>`, which is the **studio**
pages-router app (`apps/job-tracker/pages/job/[token].js`) behind a Shopify app
proxy. The portal's tracker page (`app/(portal)/order-tracker/[token]/page.tsx`)
requires a signed-in portal user who *owns* the tracker
(`getPortalTrackerByToken` → `getPortalUser()`, `lib/portal-data.ts:281-287`) and
renders `JobTrackerOrderCard` with **no customer actions at all** — the only action
component in the portal tracker area is `CancelPreOrderButton` on the *list* page.
Phase 3 (sign-up-to-view) is unspecced. **Consequence: an address-change feature
built portal-only would be unreachable by the customers who actually use the
tracker today.**

### B. Studio address-change flow (verified end to end, unchanged since July)

- UI: `apps/job-tracker/components/DeliveryAddressChangeModal.js` — one free-text
  textarea, POSTs `{token, message}`.
- API: `pages/api/job/delivery-address-change.js` →
  `submitCustomerActionUpdate({token, message, actionPrefix: 'Delivery Address
  Change Request'})`.
- Logic: `src/server/job-tracker/customer-actions.js:147-165` — resolves the tracker
  by `tracker_token` (falling back to `job_reference`), 400s if no `monday_item_id`,
  fetches the Monday item, resolves the account-manager people column, posts one
  Monday update `@AM Delivery Address Change Request: <message>`. **No email, no
  persistence of the requested address, no `tracker_email_log` row, no rate limit.**
- A sibling generic action exists with prefix `CHANGE REQUEST`
  (`pages/api/job/change-request.js`) — same shape, same gaps.
- Git log for the tracker email/action files shows nothing email-shaped added since
  the 2026-07-07 branding refactor (`9ef6ee69`, `7496a387`).

**Account-manager resolution** (`src/server/job-tracker/monday-item-service.js`):

- `findAccountManagerColumn(columns, process.env.MONDAY_COLUMN_ACCOUNT_MANAGER_ID)`
  — prefers the env-named column; **falls back to the first people column that has
  anyone assigned**. If the env is unset *and* no people column is populated, it
  returns null and `resolveContextForToken` throws **500** — i.e. today an
  unassigned job can hard-fail the address-change request itself
  (`customer-actions.js:104-110`).
- `extractAccountManager` returns `{id, name}` or null; the address-change path
  tolerates a null AM (empty mention), while the sibling *message* path
  (`sendCustomerMessageToAccountManager`, `customer-actions.js:179-186`) **400s**
  without an AM id and again without an AM email.
- The message path is the proven template for an AM email: Resend, from
  `EMAIL_FROM` or `Print Room Studio <noreply@updates.theprint-room.co.nz>`,
  **reply-to = customer email** (`customer-actions.js:212-227`), then posts the
  Monday update. Note its ordering: email first, Monday update second.
- Customer-facing branding kit: `apps/job-tracker/lib/email-branding.js`, used by
  `lib/send-tracker-email.js` (sends from `The Print Room <hello@theprint-room.co.nz>`).

### C. Portal milestone-email system (merged, dormant — verified)

`app/api/webhooks/monday/tracker-status/route.ts` (on `origin/main`; the current
working branch contains `origin/main`):

- Gate: `milestoneForLabel(displayLabel)` (`lib/email/milestone-email.ts`) — raw
  Monday label, normalised: `{assign-to-production, all-production-complete}` →
  `in-production`; `{shipped}` → `dispatched`; everything else updates the tracker
  silently.
- Send path (route.ts:513-557, inside `after()`): requires `tracker.customer_email`;
  de-dup once-ever on stable keys `milestone-in-production` / `milestone-dispatched`
  via `hasEmailBeenSent` on `(monday_item_id, email_type)`; test-org suppression via
  `isTrackerTestOrg(supabase, tracker.quote_id)`; dispatched tracking read from
  Monday column `link_mky1w9w` **only** (`lib/monday/tracking-link.ts` deliberately
  excludes the supplier link `link_mkqz77w0` — a refinement on the July spec's
  precedence list), then legacy `tracker.tracking_info.url`, then "tracking to
  follow" copy.
- Sender: `lib/email/client.ts` — Resend REST, from
  `RESEND_FROM_EMAIL || 'The Print Room <hello@theprint-room.co.nz>'`.
  **No reply-to support in the portal client today.**
- Drift since the July investigation, all inside the same `after()` block and all
  orthogonal to email: quote mirror (inert unless `ENABLE_QUOTE_STATUS_MIRROR`),
  Starshipit made-to-order bridge `pushOrderOnProductionComplete` (flag-gated,
  commit `8510775`), inventory decrement on subitem dispatch. The AU stage-1 work
  (`c948085`) stamps tracker currency but did not change the milestone gate.
- **Dormancy confirmed in prod:** `tracker_email_log` contains `tracker_ready` ×956
  and `order_shipped` ×1 (2026-02-24) — **zero `milestone-*` rows**. The Monday
  Job-Status subscription (30731909) is still Shipped-only and pointed at the
  studio; `MONDAY_WEBHOOK_SECRET` unset. Activation checklist:
  `docs/superpowers/checklists/2026-07-20-tracker-phase-2-cutover.md` (HITL).

### D. Database posture (read-only checks, 2026-08-26)

- `tracker_email_log` columns: `id, monday_item_id, tracker_token, customer_email,
  email_sent, email_id, error_message, sent_at, created_at, email_type
  (default 'tracker_ready'), trigger_type, triggered_by_user_id`. `email_type` is
  free text — **no CHECK constraint**, so new types need no migration. Index
  `(monday_item_id, email_type, email_sent)` supports the de-dup lookup
  (non-unique — de-dup is check-then-insert, adequate here).
- RLS **enabled** with exactly one policy: `SELECT` for `authenticated` (qual
  `true`). No INSERT policy → **writes only work through the service-role client**,
  which is how every existing writer operates. New writers must do the same.
- `job_trackers`: only trigger is `trg_link_tracker_to_user`; **no address columns**
  (address data lives in `quotes.shipping_address` / `ship_to_store_id`,
  `orders.shipping_address`, the Monday Contact DB board 1992699935, and `stores`).
  `production_updates` is the tracker's existing append-only JSON activity feed,
  written by the portal webhook (route.ts:463-481) and studio sync.
- No tracker/email edge functions (only unrelated ones like `send-proof-email`,
  `low-stock-alert`); no tracker/email pg_cron jobs. Notification infra is
  app-level (Next.js on Vercel + Resend), and this spec keeps it that way.

---

## Part A — Address-change notifications (net-new)

### A1. Home: **studio now**, portable by construction

The studio is legacy and Phase 4 decommissions it — but Phase 3/4 are unspecced,
and the studio page is where every customer who can request an address change
actually is (§Verified A). Portal-only would ship a feature with no callers.

So: **v1 lands in the studio**, with the surface kept deliberately tiny:

- **Zero new UI.** The existing modal and endpoint stay as-is; only the server-side
  handler grows.
- **One new module**, `src/server/job-tracker/address-change-notify.js`, containing
  the recipient resolution and the two email builders as pure functions with all
  I/O (Resend, Monday fetch, Supabase log write) injected. This module is the unit
  that gets ported.
- **A porting contract** (§A7) lists the three small portal gaps the port must
  fill. The port itself belongs to the Phase 3 "customer actions" work, which no
  existing tracker spec covers yet (verified: no mention of customer actions in the
  2026-06-03 / 2026-07-08 tracker specs).

### A2. Recipients and copy intent

**Monday stays the source of truth.** The Monday update (existing behavior) remains
the canonical record staff act from; the emails are notifications layered on it.

**1. Account-manager email** — the "someone must see this" channel.

- **To:** the AM resolved from the Monday item (existing `extractAccountManager` →
  `fetchMondayUser(...).email`). When there is no AM, no AM id, or no email:
  **fall back to a fixed ops inbox** (`TRACKER_OPS_FALLBACK_EMAIL`, recommended
  default `hello@theprint-room.co.nz`) instead of dropping the notification. Never
  400/500 the customer because staffing metadata is missing — this also fixes the
  current 500 when no people column is populated (§Verified B): AM resolution
  becomes best-effort everywhere in this path.
- **Reply-to:** the tracker's `customer_email` (reusing `normalizeReplyToAddress`),
  so the AM answers the customer with one keystroke — same pattern as the proven
  message path.
- **From:** same as the sibling message path — `EMAIL_FROM` or
  `Print Room Studio <noreply@updates.theprint-room.co.nz>`. Internal recipient, so
  the past M365-quarantine incident (customer-side, different domain
  `theprintroom.nz`) doesn't apply; no new sender address is introduced.
- **Body:** quote number + job reference, customer name/email, the requested
  address **verbatim**, the **current address on file** when the existing
  Contact-DB lookup (`pages/api/job/contact-info.js` building-street-suburb-city-
  postcode-country) resolves one — so the AM sees old → new at a glance — a link
  to the Monday item, and one explicit action line: *"Update the delivery address
  in Monday and on the order record before dispatch — packing slips and Starshipit
  pushes use the recorded address, not this email."* That line exists because a
  shipped-to address staff never updated in the source system is a known failure
  mode.

**2. Customer confirmation email** — closes the loop the modal currently fakes
("Your account manager has been notified" — currently only a Monday mention).

- **To:** `tracker.customer_email`; **silently skipped** when blank (phone/manual
  jobs) — the Monday update + AM email still happen.
- **From:** `The Print Room <hello@theprint-room.co.nz>` via the existing
  `email-branding.js` kit — the address already landing in these customers'
  inboxes daily (`tracker_ready`), so no deliverability novelty.
- **Copy intent:** explicitly a *request receipt*, not a confirmation of change:
  "We've received your delivery address change request" + the requested address
  echoed + "your account manager will confirm once it's updated" + tracker CTA.
  Never promise the address *was* changed.

### A3. Data: free text in v1, structured at the portal port; persist as an audit entry

- **Requested address stays free text in v1.** Structured fields (street, suburb,
  city, postcode, country — the Contact-DB shape `lib/monday/contact-db.ts` already
  defines) are the right destination, but they mean new form UI in a
  pages-router app scheduled for decommission. The spec's rule for the studio is
  "every line must be portable or disposable"; a six-field form is neither. The
  old→new block in the AM email (A2) recovers most of the transcription-safety
  benefit. **The portal port (A7) is where the form becomes structured fields** —
  TypeScript + existing form components make it cheap there, and it can prefill
  from `quotes.shipping_address` / the Contact DB.
- **Persist an audit entry — yes, without a migration.** Append an entry to
  `job_trackers.production_updates` (service-role write), the same append-only feed
  the portal webhook already writes (route.ts:463-481), shaped:
  `{id, type: 'customer-action', title: 'Delivery address change requested',
  body: <requested address verbatim>, changed_at, source: 'customer',
  metadata: {action: 'address-change-request'}}`.
  This survives the studio's decommission, is visible to both apps, and needs no
  shared-DB migration (HITL-free). Known caveat: `production_updates` writers do
  read-modify-write on a JSON array, so a concurrent webhook append could
  theoretically drop one entry — acceptable for an advisory audit trail; if
  address-change volume ever makes this real, graduate to a dedicated
  `tracker_address_change_requests` table (that *would* be a HITL migration).
- **Explicitly not in scope:** writing the new address into `quotes.shipping_address`,
  `orders.shipping_address`, the Contact DB, or Starshipit. Staff apply the change
  in the source systems; automating that is a separate feature with real risk
  (wrong-address shipments) and belongs behind staff review.

### A4. Logging and rate-limiting via `tracker_email_log`

Both sends write a row (service-role, same `recordEmailSend` shape the portal uses):

- `email_type: 'address-change-request'` — the AM/ops email.
- `email_type: 'address-change-confirmation'` — the customer receipt.
- `email_sent` false + `error_message` on failure (observability for partial
  failures); `trigger_type: 'customer'` (column is free text — verified no
  constraint; the portal's TS union gains the value at port time).

**Rate limit, not once-ever de-dup.** Unlike milestones, repeated address-change
submissions are legitimate (typo'd the first one). Guard: before processing, count
`address-change-request` rows for this `monday_item_id` in the last hour; at **3+,
return 429** with "please reply to your confirmation email or contact your account
manager". This reuses the existing table and index — no new infrastructure.

### A5. Ordering and failure modes

Order of operations: resolve context → **Monday update** (canonical record) →
**AM email** → **customer confirmation** → log rows. The request succeeds (HTTP
200) iff **at least one staff-visible channel** (Monday update OR AM email)
succeeded.

| Failure | Behavior |
|---|---|
| No AM assigned / AM has no email / people column empty | Proceed; AM email goes to `TRACKER_OPS_FALLBACK_EMAIL`; Monday update posts without a mention. (Fixes today's 500.) |
| Monday API down | Post fails → still send the AM email, prefixed with a warning line: "⚠ could not be posted to Monday — this email is the only record". Return 200. Log the Monday failure. |
| Resend down / AM email fails, Monday update succeeded | Return 200 (today's baseline is Monday-only, so nothing regressed); log `email_sent: false`. |
| Both Monday and AM email fail | 500 to the customer — the request genuinely went nowhere. |
| Customer confirmation fails | Never affects the response; log `email_sent: false`. |
| Tracker has no `customer_email` | AM email sends without reply-to; confirmation skipped. |
| Tracker has no `monday_item_id` | 400 (unchanged) — these are rows the tracker UI shouldn't surface actions for anyway. |
| 4th submission within an hour | 429 (A4). |

The message path's existing behaviors (400 without AM, email-before-Monday
ordering) are **out of scope** — not touched, noted here so the asymmetry is a
decision, not an accident.

### A6. Env vars (names only — no values in this doc)

Studio (`apps/job-tracker`), all but one already in use by this app:
`RESEND_API_KEY`, `EMAIL_FROM` (optional), `MONDAY_API_TOKEN` (or `MONDAY_API_KEY`),
`MONDAY_COLUMN_ACCOUNT_MANAGER_ID` (verify it is actually set in Vercel prod —
HITL below), plus **new optional** `TRACKER_OPS_FALLBACK_EMAIL` (code default
`hello@theprint-room.co.nz`). Supabase service-role credentials are already present
(`lib/supabase-server.js`).

Portal (needed only at port time): `RESEND_API_KEY`, `RESEND_FROM_EMAIL`,
`MONDAY_API_TOKEN` — all already used by the portal.

### A7. Porting contract (portal, Phase 3 "customer actions")

When the tracker's customer actions move to the portal, the port fills exactly
these gaps (verified absent today):

1. `lib/email/client.ts` gains an optional `replyTo` param (Resend supports it;
   the client currently doesn't pass it).
2. A Monday `users(ids){email}` lookup helper (portal has people-column parsing in
   `contact-db.ts` but no user-email resolution).
3. A customer-actions API route + UI on `/order-tracker/[token]` — at which point
   the address form becomes **structured fields** (A3) and can prefill.
4. `address-change-*` email types added to the portal's `trigger_type`/`email_type`
   typings; same `tracker_email_log` semantics, so history is continuous across
   the migration.

The studio module (A1) is written so its builders/tests translate 1:1.

---

## Part B — Status-change email cadence (decision, no new code)

**Decision point: keep the two-milestone cadence, or expand it?**

**Recommendation: keep two** (`in-production`, `dispatched`), unchanged from Jon's
2026-07-21 call (spec `2026-07-21-monday-status-notification-emails-design.md`,
which collapsed "email every stage" after board-evidence review). Re-examined
today, nothing has changed that would justify more: the system has never fired
(zero `milestone-*` rows), so there is no customer feedback to respond to; the
board's label traffic is still dominated by internal churn states that would read
as spam; and across the whole lifecycle the customer already gets three pushes —
`tracker_ready` at provisioning (studio, live today), then the two milestones once
cut over. Anyone who wants more granularity has the pull-only tracker link in
every email. If Jon wants a third push, the only candidate that pays rent is a
delivery/POD email — which is **Phase 4** (carrier tracking) territory, not this
spec.

**Activation is the existing HITL cutover, not new code.** The milestone system
goes live exactly and only via
`docs/superpowers/checklists/2026-07-20-tracker-phase-2-cutover.md`
(`MONDAY_WEBHOOK_SECRET` + subscription recreation + studio kill-switch — all
human steps). This spec changes nothing in that path and must not be read as a
reason to touch Monday subscriptions.

**How Part A composes with it:** disjointly by design. Address-change never touches
the webhook route, the milestone gate, or the cutover; the only shared assets are
`tracker_email_log` (new distinct `email_type` values — the once-ever milestone
de-dup can't collide with them) and, at port time, the portal email client. The
address-change feature works identically before and after the cutover.

---

## Files touched (implementation plan seed)

Studio (`~/Documents/print-room-studio`, all under `apps/job-tracker/`):

- **Add** `src/server/job-tracker/address-change-notify.js` — recipient resolution
  (AM → fallback), the two email builders (pure), the audit-entry builder.
- **Modify** `src/server/job-tracker/customer-actions.js` — in
  `submitCustomerActionUpdate` (address-change prefix only, keyed by an explicit
  option so `CHANGE REQUEST` is untouched): make AM-column resolution
  best-effort, then Monday update → notify module → log writes, with A5 ordering.
- **Modify** `pages/api/job/delivery-address-change.js` — pass the flag enabling
  notifications; add the 429 path.
- **Add** `tests/address-change-notify.test.js` (+ extend existing handler tests) —
  studio test runner is `tsx --test ./tests/*.test.js`.
- **No UI changes.** No portal code changes in v1. No DB migrations.

## Test plan (TDD)

Red-green on the node test runner, all I/O faked:

1. Recipient resolution: AM with email → AM; AM without email → fallback; no
   people column populated → fallback (and **no throw** — regression test for
   today's 500).
2. Email builders: AM email carries reply-to customer, verbatim requested address,
   current-address block when contact-info resolves, Monday-item link, the
   Starshipit warning line; confirmation email is receipt-copy (asserts absence of
   "has been changed" phrasing) and skipped without `customer_email`.
3. Ordering/failure matrix of A5, including: Monday down → AM email carries the
   warning line and handler returns 200; both channels down → 500; confirmation
   failure → still 200.
4. Logging: two rows with correct `email_type`, `email_sent:false` + error message
   on failure; rate limit: 3 in-window rows → 429, older rows ignored.
5. Audit entry appended to `production_updates` with `source: 'customer'`.

Live verification (after review, still pre-real-customer): submit from a
**test-org** tracker with `customer_email` **and** the temporary AM/fallback both
set to `jamie@theprint-room.co.nz`. Every test/verification email goes to
**jamie@theprint-room.co.nz — never jon@ and never a real customer.**

## Non-goals

- No change to which statuses email (Part B keeps two milestones).
- No execution of the Phase 2 cutover; no Monday board/webhook/subscription edits.
- No writing of the new address into quotes/orders/Contact DB/stores/Starshipit.
- No new sender domains or Resend domain config.
- No portal UI/customer actions in v1 (that is the Phase 3 port, contract in A7).
- No structured address form in the studio.
- No shared-DB migrations, triggers, edge functions, or cron.

## HITL checklist (human sign-off required — none performed by this spec)

- [ ] Jon signs off the open questions below (or overrides the recommendations).
- [ ] Confirm `MONDAY_COLUMN_ACCOUNT_MANAGER_ID` is set in the studio job-tracker
      Vercel production env (code falls back to column-sniffing, but explicit is
      safer); set `TRACKER_OPS_FALLBACK_EMAIL` if a non-default inbox is chosen.
- [ ] Confirm the sender choices (internal from `noreply@updates.theprint-room.co.nz`,
      customer from `hello@theprint-room.co.nz`) — both existing, no new domains.
- [ ] The Phase 2 milestone-email cutover remains a separate, Jon-gated operation
      via the 2026-07-20 checklist. Nothing in this feature waits on it.

## Open questions for Jon (each with a recommended default)

1. **Fallback inbox when no AM is resolvable?** Recommended:
   `hello@theprint-room.co.nz`. Alternative: a dedicated ops alias if one exists —
   the env var makes this a config choice, not a code choice.
2. **Send the customer confirmation email at all?** Recommended: **yes** — the
   modal already *claims* notification happened; a receipt makes that true, and it
   gives the AM a thread the customer can reply to. If no: A2's item 2 and its log
   rows drop out cleanly; nothing else changes.
3. **Free text in studio v1, structured fields only at the portal port?**
   Recommended: **yes** (A3 rationale — minimum surface in the dying app; the
   old→new email block covers the risk). If Jon wants structured now, the modal
   grows the Contact-DB field set and the builders take an object — same
   architecture, ~a day more studio work that gets thrown away at decommission.
4. **Rate-limit threshold 3/hour/tracker — right number?** Recommended: yes; it
   only needs to stop runaway resubmits, not determined abuse (the token is
   unguessable).
5. **Part B cadence — confirm keep-two.** Recommended: confirm, revisit a
   delivery-confirmation email in Phase 4 with carrier data behind it.
