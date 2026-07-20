# Order Tracker Phase 2 — Cutover checklist (HITL — do NOT execute without Jon's go)

This is the **only** part of Phase 2 that changes live customer-facing behaviour
(status + emails). The portal build (engine, provisioning, de-dup, logging, auth,
gap-b seed) is deployable first with **no** behaviour change while Monday
subscription 30731909 stays Shipped-only. Nothing below is automated — every step
is a human action Jon (or ops) performs, or approves the assistant to perform.

**Prepared 2026-07-20. Live facts re-verified same day (Supabase + Monday API).**

---

## 0. Preconditions (verify before touching anything)

- [ ] Portal PR merged + deployed to production (build is inert until this).
- [ ] `MONDAY_WEBHOOK_SECRET` chosen (a long random string) and set in the portal's
      production env. **Note:** the instant this is set, the route enforces the
      `?secret=` query param — so set it *together with* recreating the subscriptions
      (§2), or the current Shipped-only sub (no secret) will start 401-ing.
- [ ] `NEXT_PUBLIC_SITE_URL` confirmed = `https://portal.theprintroom.nz` (drives the
      Monday link write-back + email deep links).
- [ ] Leave `ENABLE_QUOTE_STATUS_MIRROR` **unset** — the quote mirror stays inert
      until the portal quote-status vocabulary is signed off (see §6).

## 1. Snapshot the current subscriptions (rollback insurance)

Live board **1992701981** webhooks, captured 2026-07-20 (Monday API — subscription
*URLs* are not API-readable; note them from the Monday integrations UI before editing):

| id | event | config |
|---|---|---|
| **30731909** | `change_status_column_value` | `color_mkpnas0e`, **columnValue.index = 10 (Shipped)** ← the filtered status sub |
| 24679107 | `change_specific_column_value` | `text_mkqxcmvz` (Job Reference) |
| 26034606 | `change_specific_column_value` | `text_mkxvmsha` (tracker link) |
| 24685006 | `change_specific_column_value` | `button_mkyhh79y` (Send Tracker button) |
| 19365146 | `change_status_column_value` | `color_mkpedzar` idx 3 (Stock — leave alone) |
| 26353740 | `change_status_column_value` | `color_mkpedzar` idx 13 (Stock — leave alone) |
| 18483144 | `item_moved_to_any_group` | — (leave alone) |
| 18484284 | `item_moved_to_any_group` | — (leave alone) |

- [ ] Record each subscription's target URL from the Monday integrations UI here: __________

## 2. Recreate / repoint the tracker subscriptions at the portal

Target URL for all four: `https://portal.theprintroom.nz/api/webhooks/monday/tracker-status?secret=<MONDAY_WEBHOOK_SECRET>`

- [ ] **Status (replaces 30731909):** `change_status_column_value` on `color_mkpnas0e`
      **with NO `columnValue`** (un-filtered → every stage, not just Shipped).
- [ ] **Job Reference (replaces 24679107):** `change_specific_column_value` on `text_mkqxcmvz`.
- [ ] **Tracker link (replaces 26034606):** `change_specific_column_value` on `text_mkxvmsha`.
- [ ] **Send button (replaces 24685006):** `change_specific_column_value` on `button_mkyhh79y` (optional this phase).
- [ ] **Delete** the four replaced studio-era subscriptions once the portal ones verify.
- [ ] **Leave untouched:** 19365146, 26353740 (Stock), 18483144, 18484284 (group moves).

> **Studio changes are BUILT and staged:** `jimile/print-room-studio` **PR #50**
> (branch `feat/tracker-phase-2-studio-cutover`) contains both §3 and §4 below,
> **gated behind the single env var `STUDIO_TRACKER_WEBHOOKS_DISABLED`**. While it
> is unset the studio is byte-for-byte unchanged. Merge PR #50 first (safe, inert),
> then flip the env at cutover. The inline diffs below document exactly what it does.

## 3. Studio kill-switch (in studio PR #50 — apply the env at cutover)

The portal build does not touch the studio repo. This is inert until the env is set,
so the studio webhook handler stops double-processing tracker events only at cutover.
It leaves the collections path and the polling `sync-monday.js` alive for Phase 4.

In `print-room-studio/apps/job-tracker/pages/api/webhooks/monday.js`, right after the
board check (`if (expectedBoardId && String(event.boardId) !== expectedBoardId) …`):

```js
// Phase 2 cutover kill-switch: the portal now owns Monday Job-Status / job-reference
// / tracker-token processing for this board. Collections + the poller stay live.
if (process.env.STUDIO_TRACKER_WEBHOOKS_DISABLED === 'true') {
  return res.status(200).json({ success: true, ignored: true, reason: 'portal-owned (phase 2)' });
}
```

- [ ] Diff applied to a studio branch + reviewed.
- [ ] `STUDIO_TRACKER_WEBHOOKS_DISABLED=true` set in the studio production env at cutover.

## 4. Gap c — stop the studio poller double-writing portal rows

`print-room-studio/apps/job-tracker/pages/api/sync-monday.js` (cron `/api/worker`, every
minute) polls board 1992701981 and writes `status`/`status_history` to `job_trackers`
**by `monday_item_id`, with no portal scoping** (verified live: 15 `color_mkpnas0e`
events processed since 2026-07-14). Post-cutover both the portal webhook and this poller
process the same change. The portal handler is idempotent (unchanged-status → no-op, so
no duplicate history; and it de-dups email on trigger time) — the certified safeguard —
but eliminate the parallel writer to be safe. **Done in studio PR #50 (same env gate):**
`syncTrackerFromMondayItem` skips portal-owned rows BEFORE `ensureTrackerForMondayItem`
when `STUDIO_TRACKER_WEBHOOKS_DISABLED=true` — which also protects the portal's UUID
`tracker_token` from `forceTokenSync` clobbering. The scope check —

```js
// in the tracker-update path, skip rows the portal now owns:
if (['b2b-portal', 'monday-native'].includes(trackerContext.platform)) {
  return { outcome: 'skipped', reason: 'portal-owned (phase 2)' };
}
```

- [ ] Poller-scoping applied to a studio branch, OR the poller's status write gated off
      board 1992701981 entirely at cutover.

## 5. Gap a — the headline operational gate (do this BEFORE flipping anything)

The un-filtered webhook + full engine emit **nothing** unless staff actually advance the
**portal-created** item on board 1992701981. As of 2026-07-20 all 6 real Anytime-Fitness
orders + 11 test orders sit **untouched at index 1 ("Need: Mockup (Quote Approved)")**
since the portal created them (0 webhook-log rows; Monday `updated_at ≈ creation`).

- [ ] **Confirm with ops** that the item the portal creates on board 1992701981 is the row
      staff actually progress through Job Status (check which group it lands in). If staff
      work the job on a *different* item/board, this is a **workflow fix, not a code fix** —
      raise it before cutover.
- [ ] **§H.5 verification uses a REAL order through the normal staff workflow**, not one
      implementer-created test item: move a real (test-org) order Mockup → Proof → Approved
      → Production → Shipped via the way staff actually work, and confirm each stage writes
      `job_tracker_webhook_logs` (processed) + advances `job_trackers` + emails once.
- [ ] All verification emails land at **`jamie@theprint-room.co.nz`** (test-org policy), never `jon@`.

## 6. Quote mirror (§E) — leave OFF until vocabulary sign-off

- [ ] Do **not** set `ENABLE_QUOTE_STATUS_MIRROR` yet. Enabling it makes the webhook write
      the studio quote-enum vocabulary (`in_production`, `dispatched`, `quoted`, …) into the
      portal's customer-facing `quotes.status`, which today uses `approved` /
      `awaiting-proof-review` and is rendered by `components/leavers-admin/StatusBadge`
      (styles only pending/approved/rejected/completed/draft). Confirm the intended portal
      quote vocabulary + badge styling first, then map + enable in a follow-up.

## 7. Rollback (instant, no data cleanup)

- [ ] Unset `STUDIO_TRACKER_WEBHOOKS_DISABLED` in the studio env.
- [ ] Restore the snapshotted subscriptions: re-add the `columnValue.index = 10` filter on
      the status sub and re-point the four subs to the studio URLs from §1.
- [ ] (Optional) unset `MONDAY_WEBHOOK_SECRET` if the restored subs carry no secret.

Because the portal handler is idempotent and additive (keyed upserts, trigger-time email
de-dup, guarded link write-back, quote-mirror off), no data cleanup is required on rollback.
