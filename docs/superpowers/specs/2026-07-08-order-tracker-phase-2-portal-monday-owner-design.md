# Order tracker — Phase 2: portal becomes the Monday owner — design

**Date:** 2026-07-08
**Branch:** `feat/tracker-phase-2-monday-owner`
**Phase:** 2 of the order-tracker portal-migration epic (see Phase 1 spec for the epic overview)

## Epic context

Phase 1 fixed org-admin visibility (a pure read-path change). Phase 2 is the core:
it makes the **portal** the system of record for Monday → tracker sync, so the
tracker reflects the **actual** job status and the customer is emailed on **every**
stage. It ports the studio's status engine + provisioning into the portal, un-filters
the Monday Job-Status webhook, and cuts the status/provisioning path over to the
portal — leaving carrier tracking + Starshipit + full studio decommission for Phase 4.

Locked epic decisions (2026-07-08, Jon): status model = Monday Job-Status column
(un-filter the one webhook + port the full synonym engine); some jobs are created in
Monday (provisioning must move to the portal); email on every stage.

## Open decisions (recommended defaults — flag if you disagree)

These are the Phase-2-specific forks. The spec is written around the **recommended**
option; each is cheap to flip.

1. **Cutover strategy → kill-switch flip (recommended)** over a long parallel run.
   Build the complete, idempotent portal handler; add a one-env-var kill-switch to the
   studio handler; then in a single step recreate the tracker subscriptions pointing at
   the portal and flip the switch. Idempotent de-dup makes a brief overlap harmless;
   rollback is instant (unset switch, restore the snapshotted subscriptions).
2. **Email de-dup semantics → per-transition, idempotent (recommended)** over
   once-per-stage-ever. A genuine re-entry to a stage (e.g. proof-sent → need-proof →
   proof-sent after a revision) *re-emails*, matching "every status update"; but Monday's
   at-least-once re-delivery of the *same* event does not. Implemented by keying the email
   log on the Monday event's trigger time (stable across retries).
3. **Starshipit / carrier-tracking boundary → stays in Phase 4 (recommended).** Phase 2
   owns status + provisioning + per-stage email + quote mirror + logging. Carrier tracking
   (Starshipit registration, the "shipped with tracking #" email, the `link_mky1w9w`
   carrier-link write-back) is polling-driven in `sync-monday.js` today, is *not* triggered
   by any webhook, and is cleanly separable. Consequence: in Phase 2 the "Dispatched" email
   won't carry a tracking number yet (it arrives via the Phase 4 tracking flow). No Starshipit
   secrets needed in the portal until Phase 4.

## Problem

Three defects stop the tracker from reflecting reality and emailing correctly:

1. **Monday only tells the portal about "Shipped."** Webhook **30731909**
   (`change_status_column_value` on `color_mkpnas0e`) is filtered to
   `columnValue.index = 10` (Shipped). Every other stage change is never delivered, so
   the tracker sits still until the very end.
2. **The portal's status map is a stub.** `mapMondayToTrackerStatus`
   (`lib/monday/status-mappings.ts`) is a 14-row exact-match table. It misses most real
   board labels ("Assign to Production", "Stock Ordered", "Closed Job", "Ready to Pickup",
   the internal quoting/lost/follow-up statuses, "Job on Hold", …). Unmapped labels →
   `null` → "Ignored — unknown tracker status" → no update, no email. It also has **no
   suppression** of internal statuses and **no preserve-previous** for holds.
3. **No provisioning + no durable email de-dup in the portal.** Monday-origin jobs
   (staff create an item and set a Job Reference) never get a tracker row — the portal
   handler only *updates* existing rows. And the handler's only de-dup is a 60s window
   (`DUPLICATE_WINDOW_MS`); once Monday sends every stage with at-least-once retries, a
   retry >60s later would re-email.

**What the portal handler already does** (`app/api/webhooks/monday/tracker-status/route.ts`,
better than expected): `challenge` handshake; routes collections board + production date +
production status; on a status change it appends `status_history` + `production_updates`,
stamps `design_approval_at` / `production_start_at` / `production_complete_at`, updates
`job_trackers`, revalidates `orderTracker` + `accountData` cache tags, **already calls
`sendTrackerStatusEmail` on every status change** (no Shipped filter in code — the limiter
is upstream in Monday), and fires the items sync. So the email trigger exists; the gaps are
the engine, de-dup, provisioning, quote mirror, write-backs, logging, and the cutover.

**What the studio does today** (source of the port,
`print-room-studio/apps/job-tracker/pages/api/webhooks/monday.js` + helpers): full synonym
engine (`lib/monday-status-mappings.js`); provisioning
(`ensureTrackerForMondayItem`, `provisionTrackerForJobReferenceEvent`) where
**`tracker_token = job_reference`** (the human ref like `ANFI-000083`; no UUID) and it
writes the tracker URL back to a Monday link column; quote mirroring
(`quotes` + `quote_status_history`); durable email de-dup (`tracker_email_log`); webhook
logging (`job_tracker_webhook_logs`); and — separately, polling-driven — Starshipit + the
`link_mky1w9w` carrier-link write-back. The studio webhook has **no authenticity check**.

**Board webhook topology (live, board 1992701981):** 30731909 (Job Status, Shipped-only),
24679107 (Job Reference), 26034606 (tracker token), 24685006 (Send Tracker button),
19365146 + 26353740 (Stock — inventory, not tracker), 18483144 + 18484284 (group moves —
unused by the status model). No item-create and no tracking-column subscription. **The
Monday API does not expose subscription URLs**, so we cannot read which app each currently
targets — the cutover therefore *recreates* the tracker subscriptions pointing at the portal
rather than editing them in place.

## Goal

The portal is the single processor of Monday Job-Status changes and Monday-origin
provisioning. Every customer-facing stage transition updates the tracker accurately
(internal statuses suppressed, holds preserved) and emails the customer exactly once per
genuine transition. Monday-created jobs get a tracker when their Job Reference is set. The
studio's status/provisioning webhook role is retired (kill-switch). Carrier tracking and
full studio decommission remain for Phase 4.

## Decisions

**Locked (epic):** finer Monday-Job-Status-column model; provisioning in the portal;
email every stage. **Recommended defaults (above):** kill-switch cutover; per-transition
idempotent email de-dup; Starshipit deferred to Phase 4.

**Additional design decisions:**

- **Port, don't share.** The studio engine is JS in a separate repo; port it into typed
  portal modules (no cross-repo import). One canonical status module in the portal.
- **`tracker_token = job_reference` for Monday-origin rows** (mirrors studio). Portal
  checkout rows keep their UUID token. The `/order-tracker/[token]` deep link already keys
  on `tracker_token`, so both formats work.
- **Provisioning writes the *portal* deep link back to Monday**, not the dead studio
  `/apps/order-tracker/job/*` URL.
- **No new table; no destructive migration.** Reuse `tracker_email_log` (de-dup via
  `email_type` encoding) and `job_tracker_webhook_logs` (logging). One *optional* additive
  hardening migration noted below.
- **Add webhook authenticity** (the studio had none): a shared secret in the subscription
  URL, verified by the portal route.

## Architecture / Approach

### A. Status engine port — `lib/monday/tracker-status-engine.ts` (new)

Port from `print-room-studio/lib/monday-status-mappings.js` +
`apps/job-tracker/lib/status-transitions.js` into typed portal code:

- `CANONICAL_STATUS_KEYS`, `DEFAULT_CUSTOMER_STATUS_KEY`, `BASE_STATUS_SYNONYMS`,
  `NON_CUSTOMER_FACING_STATUS_KEYS`, `PRESERVE_PREVIOUS_STATUS_KEYS`, `normalizeKey`,
  `mapMondayStatus`, and a `deriveStatusValue(label, { previousStatus })` returning
  `{ key, storageValue, display, isCustomerFacing, preserveExisting }`.
- Keep the portal's existing `STATUS_STEPS` / `STATUS_GUIDANCE` in `lib/job-tracker.ts` as
  the canonical 7 steps (identical key set to the studio); the engine references those keys.
- **Drop** the `generated-monday-status-synonyms.js` overlay (a build artefact); fold any
  still-relevant generated entries into `BASE_STATUS_SYNONYMS` explicitly. (Verify current
  board labels via the `analyze-monday-statuses` approach during implementation.)
- **Replace** `mapMondayToTrackerStatus` with a thin wrapper over the engine so existing
  callers keep working; delete the 14-row table.

### B. Status handler upgrades — `handleTrackerStatusChange`

- Map with `deriveStatusValue(displayLabel, { previousStatus: tracker.status })`.
- If `preserveExisting` (e.g. "Job on Hold") → log, **no** status write, **no** email,
  return 200. If `!isCustomerFacing` (internal statuses → null) → log + 200 ignored.
- Use the Monday event's **trigger time** as `changed_at` for `status_history`, the update
  entry, and the email de-dup key (stable across retries). Read `event.triggerTime`
  (fallback `now()`); add it to the `MondayWebhookPayload` type.
- Keep milestone stamping (`design_approval_at` / `production_start_at` /
  `production_complete_at`) and cache revalidation as-is.
- Keep the 60s window as a fast-path duplicate guard; durable de-dup (C) is the real guard.

### C. Durable per-stage email + de-dup — `lib/email/tracker-email-log.ts` (new)

Port `hasEmailBeenSent` / `recordEmailSend` (studio `email-dedup.js`) to portal TS against
`tracker_email_log`. Encode the stage into `email_type`:

- **Per-transition idempotent (recommended):**
  `email_type = 'status_update:' + canonicalKey + ':' + triggerTimeEpoch`.
  Before send: `hasEmailBeenSent({ mondayItemId, emailType })`; skip if found. This dedups
  Monday's re-delivery of one event (same trigger time) while re-emailing genuine re-entry
  (new trigger time). Served by the existing `(monday_item_id, email_sent, email_type)` index.
- *(Once-per-stage-ever alternative: drop the `:triggerTimeEpoch` suffix.)*
- After send: `recordEmailSend({ mondayItemId, trackerToken, customerEmail, emailType,
  emailSent, emailId, errorMessage, triggerType:'automatic' })`.
- Email body unchanged (`sendTrackerStatusEmail`) — already links the portal
  `/order-tracker/<token>` deep link and renders a tracking panel when present.
- *Optional hardening migration (not required to ship):* add `status_key text`,
  `status_changed_at timestamptz` columns + a partial unique index for a DB-level
  idempotency guarantee against the (rare) concurrent-delivery race. Default: skip; the
  studio has run without it.

### D. Provisioning — `lib/monday/tracker-provisioning.ts` (new) + handler branches

Port `ensureTrackerForMondayItem` + `provisionTrackerForJobReferenceEvent` +
`provisionTrackerForCreateEvent` (studio `tracker-provisioning.js` / `provisioning-events.js`)
to portal TS using the service-role client and `lib/monday/client.ts` (`mondayApiCall`,
`MONDAY_API_TOKEN` already present):

- **Job Reference event** (`change_specific_column_value` on `text_mkqxcmvz`): strict
  provisioning — validate the job-ref format (`^[A-Za-z]{2,}[-_]\d{2,}(?:[-_]\d+)?$`), upsert
  a `job_trackers` row keyed on `monday_item_id` with `tracker_token = job_reference =` the
  validated ref, `status` via the engine (default `quote-stage`), `quote_number` /
  `customer_email` from Monday columns, empty `quote_data`/`status_history`/etc. Handle the
  token-conflict re-point (existing row with that token → set its `monday_item_id`).
- **Item-create event** (lenient; skip when no valid job ref). *No subscription drives this
  today* — port it for completeness but note it's inert until a create webhook is added.
- **tracker-token event** (`text_mkxvmsha`): port `trackerTokenHandler` — validate the pasted
  value against the job reference and write a corrected value back if needed.
- **Monday write-back:** after provisioning, write the **portal** tracker URL
  (`${NEXT_PUBLIC_SITE_URL}/order-tracker/<token>`) into the public-link column
  (`MONDAY_COLUMN_PUBLIC_LINK_ID` → default `text_mkxvmsha`). Guard: skip if already set, to
  avoid a write-loop with the tracker-token webhook.

### E. Quote mirroring — folded into `handleTrackerStatusChange`

Port `mirrorStatusToQuote` + `mapMondayStatusToQuoteEnum`: when a status change applies and
`tracker.quote_id` is set, map the raw Monday label to the `quotes` status enum, and if it
differs from the current value, update `quotes.status` and insert a `quote_status_history`
row (`actor:'monday-webhook'`, `source:'production-board'`). Fire-and-forget / non-blocking.

### F. Webhook logging — `lib/monday/webhook-log.ts` (new)

Port `logWebhookEvent` / `markWebhookLog` to portal TS against `job_tracker_webhook_logs`
(columns: `monday_item_id, board_id, column_id, event_type, payload(jsonb), status, error,
processed_at, notes`). Log every production-board event the portal handles and mark the
outcome (`processed` / `noop` / `missing-job` / `failed`). The portal already has write
access (proven by `lib/inventory/ship-quote-line.ts`).

### G. Webhook auth hardening — the route

Add `MONDAY_WEBHOOK_SECRET`. The recreated subscription URLs include `?secret=<value>`; the
route rejects (401) any event POST whose `secret` query param doesn't match. The `challenge`
handshake is answered before the secret check (Monday's verification call carries no secret).

### H. Monday subscription cutover

1. **Snapshot** the 8 current subscriptions (ids + configs above) to the design/PR for
   rollback. (URLs are not API-readable; note them from the Monday integrations UI.)
2. **Recreate, pointing at the portal** `https://portal.theprintroom.nz/api/webhooks/monday/
   tracker-status?secret=…` (confirm prod host):
   - Job Status `color_mkpnas0e` — `change_status_column_value` **with no `columnValue`**
     (un-filtered → every stage). Replaces 30731909.
   - Job Reference `text_mkqxcmvz` — replaces 24679107 (provisioning).
   - tracker token `text_mkxvmsha` — replaces 26034606.
   - Send Tracker button `button_mkyhh79y` — replaces 24685006 (manual send; optional this
     phase).
3. **Delete** the replaced studio-era subscriptions (or, if they already point at the portal,
   just un-filter the status one). **Leave** Stock (19365146/26353740) and group-move
   (18483144/18484284) subscriptions untouched (not part of the status model).
4. **Studio kill-switch:** add `STUDIO_TRACKER_WEBHOOKS_DISABLED=true` to
   `print-room-studio` webhook handler → for job-tracker-board status / job-reference /
   tracker-token events, log + return `200 { ignored: true }`. Leaves the studio's polling
   `sync-monday.js` (carrier tracking) and collections path alive for Phase 4.
5. **Verify** on a test Monday item: move it through stages → portal `job_tracker_webhook_logs`
   rows + `job_trackers` advances + de-duped emails (to `jamie@theprint-room.co.nz`, per test
   policy). Set a Job Reference on a fresh item → tracker provisioned + portal link written
   back to Monday.

## Idempotency & safety (parallel-run correctness)

All portal writes are safe to run even if a stray studio subscription overlaps briefly:
status update is a keyed upsert; email de-dup prevents doubles; quote-mirror no-ops when the
status already matches; the Monday link write-back guards on an existing value; provisioning
upserts on `monday_item_id` (with token-conflict re-point). This is what makes the kill-switch
cutover low-risk.

## Not in scope / deferred

- **Phase 4:** Starshipit registration; the "shipped with tracking number" email; the
  `link_mky1w9w` carrier-link write-back; retiring `sync-monday.js` polling; collections-board
  ownership; **full** studio decommission.
- **Phase 3:** the sign-up-to-view email flow for never-logged-in recipients.
- Group-move and Stock webhooks (not part of the status model).
- The optional `tracker_email_log` hardening migration (only if the concurrency race proves
  real).

## Security note

- Service-role writes bypass RLS, so handler correctness is the boundary (as in Phase 1).
- Adds the first authenticity check to this webhook (`MONDAY_WEBHOOK_SECRET`), closing the
  studio's open-endpoint gap.
- Supabase MCP / Monday data is untrusted; the engine only ever maps labels to a fixed key
  set — unknown labels are ignored, never executed.
- Test/verification emails go to `jamie@theprint-room.co.nz`, never `jon@`.

## Rollback

Unset `STUDIO_TRACKER_WEBHOOKS_DISABLED` and restore the snapshotted subscriptions (re-add
the Shipped-only filter on the status webhook, re-point to the studio). Because the portal
handler is idempotent and additive, no data cleanup is required on rollback.

## Testing (TDD, RED first)

- **Engine:** canonical keys pass through; representative synonyms map (e.g. `Assign to
  Production`→`in-production`, `Stock Ordered`→`proof-approved`, `Closed Job`→`dispatched`);
  internal statuses (`Lost Job`, `Follow up 1 sent`) → not-customer-facing; `Job on Hold`
  → preserve-previous; unknown → null.
- **Handler:** customer-facing transition writes status + history + milestone + emails once;
  internal status → ignored, no write/email; hold → preserved, no email; a second delivery
  of the same event (same trigger time) → no second email; a genuine re-entry (new trigger
  time) → re-emails.
- **Provisioning:** Job-Reference event on a new Monday item creates a tracker with
  `tracker_token = job_reference` and writes the portal link back to Monday; invalid job ref
  → skip; existing token → re-point, no duplicate.
- **Quote mirror:** status change with `quote_id` updates `quotes.status` + inserts
  `quote_status_history`; no-ops when unchanged.
- **Auth:** event POST without the correct `secret` → 401; `challenge` still answered.
- `next build` green; manual end-to-end on a test item as above (emails → jamie@).

## Implementation staging (one design, likely two plans)

1. **Build (safe behind the still-filtered webhook):** engine (A/B), de-dup (C), logging (F),
   quote mirror (E), provisioning (D), auth (G). Deployable with no behaviour change while
   Monday still sends only Shipped.
2. **Cutover (H):** snapshot → recreate/un-filter/repoint subscriptions → studio kill-switch
   → verify. This is the only step that changes live behaviour and is independently
   reversible.
