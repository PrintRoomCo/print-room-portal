# Order Tracker — Phase 2 (portal becomes the Monday owner) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the studio's typed Monday status engine + provisioning + de-dup + logging + quote-mirror + auth into the portal so the tracker reflects the real Monday Job-Status and emails on every genuine stage — and close the three gaps the 2026-07-20 diagnosis (issue #77) exposed.

**Architecture:** One canonical status engine (`lib/monday/tracker-status-engine.ts`) referencing the portal's existing 7-key `STATUS_STEPS`. The existing `tracker-status/route.ts` handler is upgraded to map via the engine, key everything on the Monday event's trigger time, suppress internal/hold statuses, provision Monday-origin jobs, mirror quotes (gated), log every event, and require a shared secret. All new writes are idempotent so a brief studio overlap during cutover is harmless. The Monday-subscription cutover + studio kill-switch are documented as a HITL checklist — **not executed here**.

**Tech Stack:** Next 16 (App Router, Route Handlers), TypeScript (strict), Supabase service-role client, vitest (jsdom, `@`→repo root, `after()` mocked with global `flushAfter()`), Monday GraphQL via `lib/monday/client.ts` `mondayApiCall`.

## Global Constraints

- **Build is behavior-safe:** while Monday sub 30731909 stays Shipped-only, none of A–G changes live behavior. Deployable independently of cutover. (verified live 2026-07-20: 30731909 = `color_mkpnas0e` index 10, sole sub on that column.)
- **Canonical status keys (7, identical to studio):** `quote-stage, quote-accepted-mockup, need-proof, proof-sent, proof-approved, in-production, dispatched`. Keep the portal's `STATUS_STEPS`/`STATUS_GUIDANCE` in `lib/job-tracker.ts` as canonical display; the engine references those keys.
- **`tracker_token = job_reference`** for Monday-origin rows; portal-checkout rows keep their UUID token. Job-ref format: `/^[A-Za-z]{2,}[-_]\d{2,}(?:[-_]\d+)?$/`, max 100 chars.
- **Provisioning write-back** writes the **portal** deep link `${NEXT_PUBLIC_SITE_URL}/order-tracker/<token>` (default origin `https://portal.theprintroom.nz`) into `text_mkxvmsha`; **guard: skip if the column already holds that URL** (avoids a write-loop with the tracker-token webhook).
- **No new table, no destructive migration.** Reuse `tracker_email_log` (de-dup via `email_type`), `job_tracker_webhook_logs` (logging), `quote_status_history` (mirror). The optional hardening migration is **skip-by-default**.
- **Shared tables** (`job_trackers`, `tracker_email_log`, `job_tracker_webhook_logs`) are written by BOTH portals + the studio poller — every portal write MUST be idempotent.
- **Test/verification emails → `jamie@theprint-room.co.nz`, NEVER `jon@`.**
- **tsc baseline is 5 errors** (`lib/__tests__/next-config-redirects.test.ts` ×1, `lib/email/__tests__/tracker-notification.test.ts` ×4). New code must not increase it. `next build` must stay green. Full vitest suite green.
- **Do NOT** deploy, apply DB migrations, or change Monday config without Jon's go. Work on `feat/tracker-phase-2-monday-owner`; open a PR.

### Flagged deviations from the spec (confirmed against live data 2026-07-20)

1. **§E quote mirror is gated OFF by default** (`ENABLE_QUOTE_STATUS_MIRROR`). The portal's `quotes.status` is free-text using `approved`/`awaiting-proof-review`, rendered to customers by `components/leavers-admin/StatusBadge.tsx` (only styles `pending/approved/rejected/completed/draft`). The studio's `mapMondayStatusToQuoteEnum` emits a foreign vocabulary (`in_production`, `dispatched`, `quoted`, `accepted`…) that would render as raw gray text. Code + tests ship; live writes stay inert until Jon confirms the portal quote vocabulary and flips the flag.
2. **§A synonym table built against the LIVE board**, fixing labels the studio table itself misses: `sent-mockup-xero-quote`→`quote-accepted-mockup` (idx 4), `all-production-complete`→`in-production` (idx 9), `mockup-complete`→`quote-accepted-mockup` (idx 14), plus explicit suppression of all `Lost Job -` variants (idx 105/152/155/156) and a defensive `lost-job*` prefix guard.
3. **Gap b default = `quote-accepted-mockup`** derived *through the engine* from the canonical fresh-order label `"Need: Mockup (Quote Approved)"`. The spec's "preferred: seed from the Monday label" is not literally possible at checkout (the shell is created in submit step 4c, before the Monday push in 5a, so `monday_item_id` is null and there is no Monday item to read). Deriving from the known creation-default label keeps the engine the single source of truth.

---

## File Structure

**Create:**
- `lib/monday/tracker-status-engine.ts` — canonical keys, synonyms, `normalizeKey`, `getStatusStep`, `mapMondayStatus`, `deriveStatusValue`, `resolveStatusKey`, `statusesMatch`, `getCustomerFacingStatusCopy`, `isNonCustomerFacingStatus`.
- `lib/monday/job-reference.ts` — `JOB_REFERENCE_PATTERN`, `normalizeJobReference`, `validateJobReference`.
- `lib/monday/webhook-log.ts` — `logWebhookEvent`, `markWebhookLog`.
- `lib/monday/tracker-provisioning.ts` — `ensureTrackerForMondayItem`, `provisionTrackerForJobReferenceEvent`, `provisionTrackerForCreateEvent`, `handleTrackerTokenEvent`.
- `lib/monday/quote-mirror.ts` — `mapMondayStatusToQuoteEnum`, `mirrorStatusToQuote` (gated).
- `lib/email/tracker-email-log.ts` — `hasEmailBeenSent`, `recordEmailSend`, `statusEmailType`.
- Test files alongside each (`lib/monday/__tests__/*.test.ts`, `lib/email/__tests__/*.test.ts`, `app/api/webhooks/monday/tracker-status/__tests__/route.test.ts`).
- `docs/superpowers/checklists/2026-07-20-tracker-phase-2-cutover.md` — HITL cutover + kill-switch + poller-scoping + gap-a operational gate.

**Modify:**
- `lib/monday/status-mappings.ts` — replace `mapMondayToTrackerStatus` body with a thin engine wrapper; delete the 14-row table (keep collection + quick-quote mappers).
- `app/api/webhooks/monday/tracker-status/route.ts` — engine mapping, trigger-time, de-dup, quote-mirror, logging, secret auth, routing for Job-Reference / tracker-token / item-create events.
- `lib/orders/job-tracker.ts:207-238` — Gap b seed fix.

---

## Task 1: Status engine (§A) — the foundation

**Files:**
- Create: `lib/monday/tracker-status-engine.ts`
- Test: `lib/monday/__tests__/tracker-status-engine.test.ts`

**Interfaces — Produces:**
```ts
const CANONICAL_STATUS_KEYS: Set<string>
const DEFAULT_CUSTOMER_STATUS_KEY = 'quote-stage'
const NON_CUSTOMER_FACING_STATUS_KEYS: Set<string>
const PRESERVE_PREVIOUS_STATUS_KEYS: Set<string>   // {'job-on-hold'}
function normalizeKey(v: string | null | undefined): string | null
function getStatusStep(key: string | null): { key: string; label: string; tooltip: string } | null
function isNonCustomerFacingStatus(text: string | null | undefined): boolean
interface MondayStatusMapping { canonical: string | null; normalized: string | null; isCustomerFacing: boolean; isInternalOnly: boolean; preservePrevious: boolean }
function mapMondayStatus(text: string | null | undefined): MondayStatusMapping
interface DerivedStatus { key: string | null; storageValue: string | null; display: string | null; raw: string | null; normalized: string | null; canonical: string | null; isCustomerFacing: boolean; preserveExisting: boolean }
function deriveStatusValue(value: string | null | undefined, opts?: { previousStatus?: string | null; fallbackKey?: string }): DerivedStatus
function resolveStatusKey(v: string | null | undefined): string | null
function statusesMatch(a: string | null | undefined, b: string | null | undefined): boolean
function getCustomerFacingStatusCopy(v: string | null | undefined, opts?): DerivedStatus & { title: string; body: string }
```
Port `mapMondayStatus`/`deriveStatusValue` semantics verbatim from `print-room-studio/lib/monday-status-mappings.js` + `apps/job-tracker/lib/status-transitions.js`. `getStatusStep` reads the portal `STATUS_STEPS` from `@/lib/job-tracker`. Synonyms = studio `BASE_STATUS_SYNONYMS` + folded non-shadowed generated entries + the three live-board fixes. Internal check adds `lost-job-no-reply`, `lost-job-went-with-another-supplier`, `lost-job-will-not-proceed-for-no-reason`, `lost-job-under-moq`, and a defensive rule: any `normalizeKey(text)` starting with `lost-job` or `lost-incorrect` is non-customer-facing.

- [ ] **Step 1: Write the failing test — full live-board coverage.** The single most important fixture: every one of the 40 live `color_mkpnas0e` labels (verified via Monday API 2026-07-20) maps to its expected outcome. `CF` = customer-facing key; `INT` = internal (isCustomerFacing false, preserveExisting true); `HOLD` = preserve; `null` = unknown.

```ts
import { describe, it, expect } from 'vitest'
import { deriveStatusValue, mapMondayStatus, isNonCustomerFacingStatus } from '../tracker-status-engine'

// index -> [label, expectedCanonicalKey | null, kind]
const LIVE_BOARD: Array<[number, string, string | null, 'CF' | 'INT' | 'HOLD' | 'UNKNOWN']> = [
  [0,  'Sent: Quote',                               null,                     'INT'],
  [1,  'Need: Mockup (Quote Approved)',             'quote-accepted-mockup',  'CF'],
  [2,  'Proof Approved',                            'proof-approved',         'CF'],
  [3,  'Sent: Proof+Invoice/Quote',                 'proof-sent',             'CF'],
  [4,  'Sent: Mockup + Xero Quote',                 'quote-accepted-mockup',  'CF'],  // studio MISS — fixed here
  [5,  'Yet to quote',                              'quote-stage',            'CF'],
  [6,  'Need: Proof',                               'need-proof',             'CF'],
  [7,  'Stock Ordered',                             'proof-approved',         'CF'],
  [8,  'Assign to Production',                      'in-production',          'CF'],
  [9,  'All Production Complete',                   'in-production',          'CF'],  // studio MISS — fixed here
  [10, 'Shipped',                                   'dispatched',             'CF'],
  [11, 'Need: Internal Proof Approval',             'need-proof',             'CF'],
  [12, 'Need: Send proof + Invoice/Quote from Xero','need-proof',             'CF'],
  [13, 'Need: Quote Offshore',                      null,                     'INT'],
  [14, 'Mockup Complete',                           'quote-accepted-mockup',  'CF'],  // studio MISS — fixed here
  [15, 'Proof Declined',                            'need-proof',             'CF'],
  [16, 'Partially Shipped',                         'in-production',          'CF'],
  [17, 'Lost Job - Cost',                           null,                     'INT'],
  [18, 'Replied',                                   null,                     'INT'],
  [19, 'Artwork Proof Edits',                       'need-proof',             'CF'],
  [101,'Ready to Pickup',                           'dispatched',             'CF'],
  [102,'PR Warehouse',                              'dispatched',             'CF'],
  [103,'Follow up 1 sent',                          null,                     'INT'],
  [104,'Lost Job - Time',                           null,                     'INT'],
  [105,'Lost Job - no reply',                       null,                     'INT'],  // studio MISS — suppressed here
  [106,'Ship Direct to Client',                     'dispatched',             'CF'],
  [107,'Closed Job',                                'dispatched',             'CF'],
  [108,'3PL Fulfillment',                           'dispatched',             'CF'],
  [109,'Job on Hold',                               null,                     'HOLD'],
  [110,'Follow up 2 sent',                          null,                     'INT'],
  [151,'Open for preorders',                        'quote-accepted-mockup',  'CF'],
  [152,'Lost Job - Went with another supplier',     null,                     'INT'],  // studio MISS — suppressed here
  [153,'Need: Send Draft Quote',                    null,                     'INT'],
  [154,'Needs Follow Up?',                          null,                     'INT'],
  [155,'Lost Job - Will not proceed for no reason', null,                     'INT'],  // studio MISS — suppressed here
  [156,'Lost Job - Under MOQ',                      null,                     'INT'],  // studio MISS — suppressed here
  [157,'In comms',                                  null,                     'INT'],
  [158,'Lost Job',                                  null,                     'INT'],
  [159,'Trends - Ordered',                          'in-production',          'CF'],
  [160,'Lost - Incorrect Info',                     null,                     'INT'],
]

describe('tracker-status-engine — live board coverage', () => {
  it.each(LIVE_BOARD)('idx %s "%s" -> %s (%s)', (_idx, label, expectedKey, kind) => {
    const d = deriveStatusValue(label, { previousStatus: 'need-proof' })
    if (kind === 'CF') {
      expect(d.canonical).toBe(expectedKey)
      expect(d.isCustomerFacing).toBe(true)
      expect(d.preserveExisting).toBe(false)
      expect(d.storageValue).toBe(expectedKey)
    } else if (kind === 'HOLD') {
      expect(d.isCustomerFacing).toBe(false)
      expect(d.preserveExisting).toBe(true)   // hold preserves previous
      expect(d.storageValue).toBe('need-proof') // = previousStatus
    } else if (kind === 'INT') {
      expect(d.isCustomerFacing).toBe(false)
      expect(isNonCustomerFacingStatus(label)).toBe(true)
    }
  })

  it('canonical keys pass straight through', () => {
    for (const k of ['quote-stage','quote-accepted-mockup','need-proof','proof-sent','proof-approved','in-production','dispatched']) {
      expect(deriveStatusValue(k).canonical).toBe(k)
    }
  })

  it('unknown label -> canonical null, not customer-facing, not preserved', () => {
    const d = deriveStatusValue('Totally Unknown Label 123')
    expect(d.canonical).toBeNull()
    expect(d.isCustomerFacing).toBe(false)
    expect(d.preserveExisting).toBe(false)
  })

  it('empty / null -> null across the board', () => {
    expect(deriveStatusValue('').canonical).toBeNull()
    expect(deriveStatusValue(null).isCustomerFacing).toBe(false)
  })
})
```

- [ ] **Step 2: Run — verify it fails** (`npx vitest run lib/monday/__tests__/tracker-status-engine.test.ts`) — FAIL, module not found.
- [ ] **Step 3: Implement the engine.** Port the JS to TS. `BASE_STATUS_SYNONYMS` = studio table + `'all-production-complete':'in-production'`, `'mockup-complete':'quote-accepted-mockup'`, `'awaiting-customer-feedback':'proof-sent'`, `'sent-mockup-xero-quote':'quote-accepted-mockup'`. `NON_CUSTOMER_FACING_STATUS_KEYS` = studio set + the four lost-job variants above; `isNonCustomerFacingStatus` also returns true when `normalized.startsWith('lost-job') || normalized.startsWith('lost-incorrect')`. `mapMondayStatus.isInternalOnly` uses `isNonCustomerFacingStatus`. `getStatusStep` uses `STATUS_STEPS` from `@/lib/job-tracker`.
- [ ] **Step 4: Run — verify it passes.**
- [ ] **Step 5: Commit** — `feat(tracker): typed Monday status engine, verified against the live board`.

## Task 2: Replace the stub mapper (§A wrapper)

**Files:** Modify `lib/monday/status-mappings.ts`; Test `lib/monday/__tests__/status-mappings.tracker.test.ts`.
**Interfaces — Consumes:** `deriveStatusValue` (Task 1). **Produces:** `mapMondayToTrackerStatus(text): string | null` returns the canonical customer-facing key or `null` (unchanged signature).

- [ ] **Step 1: Failing test** — `mapMondayToTrackerStatus('Assign to Production') === 'in-production'`; `('Job on Hold') === null`; `('Lost Job') === null`; `('Proof Approved') === 'proof-approved'`; `('Totally Unknown') === null`.
- [ ] **Step 2: Run — fails** (stub returns null for 'Assign to Production').
- [ ] **Step 3: Implement** — replace the function body + delete the 14-row `mapping` object:
```ts
import { deriveStatusValue } from '@/lib/monday/tracker-status-engine'
export function mapMondayToTrackerStatus(labelText: string | undefined): string | null {
  const d = deriveStatusValue(labelText ?? null)
  return d.isCustomerFacing ? d.canonical : null
}
```
Keep `mapMondayToCollectionStatus` + `mapMondayToQuickQuoteEvent` untouched. Remove the now-unused `STATUS_STEPS` import if nothing else uses it.
- [ ] **Step 4: Run — passes.**
- [ ] **Step 5: Commit** — `refactor(tracker): map Monday status via the engine; drop the 14-row stub`.

## Task 3: Durable per-stage email de-dup (§C)

**Files:** Create `lib/email/tracker-email-log.ts`; Test `lib/email/__tests__/tracker-email-log.test.ts`.
**Interfaces — Produces:**
```ts
function statusEmailType(canonicalKey: string, triggerTime: string | null | undefined): string  // `status_update:${key}:${epochMs}` (epoch 0 when triggerTime absent)
function hasEmailBeenSent(admin, args: { mondayItemId: string; emailType: string }): Promise<boolean>
function recordEmailSend(admin, args: { mondayItemId: string; trackerToken?: string; customerEmail: string | null; emailType: string; emailSent: boolean; emailId?: string | null; errorMessage?: string | null; triggerType?: 'automatic' | 'manual' }): Promise<void>
```
Port from `print-room-studio/apps/job-tracker/lib/email-dedup.js`, but take the Supabase client as the first arg (portal passes the route's service-role client) instead of importing a module-level singleton. Columns verified live: `tracker_email_log(monday_item_id, tracker_token, customer_email, email_type, email_sent, email_id, error_message, trigger_type, triggered_by_user_id, sent_at)`.

- [ ] **Step 1: Failing test** (mock a chainable supabase stub): `statusEmailType('in-production','2026-07-20T01:00:00.000Z')` === `'status_update:in-production:1784...'` (assert prefix + a numeric epoch); `hasEmailBeenSent` returns true when the stub yields a row, false when null; `recordEmailSend` inserts a row with `email_sent:true`.
- [ ] **Step 2: Run — fails.**
- [ ] **Step 3: Implement.** `statusEmailType` = `` `status_update:${key}:${triggerTime ? Date.parse(triggerTime) || 0 : 0}` ``. `hasEmailBeenSent` selects `id` where `monday_item_id`, `email_type`, `email_sent=true`, `.maybeSingle()`. `recordEmailSend` inserts; log (don't throw) on error.
- [ ] **Step 4: Run — passes.**
- [ ] **Step 5: Commit** — `feat(tracker): durable per-transition email de-dup on tracker_email_log`.

## Task 4: Webhook logging (§F)

**Files:** Create `lib/monday/webhook-log.ts`; Test `lib/monday/__tests__/webhook-log.test.ts`.
**Interfaces — Produces:**
```ts
function logWebhookEvent(admin, args: { mondayItemId: string; boardId: number | string | null; columnId: string | null; eventType: string | null; payload: unknown }): Promise<string | null>  // returns log id
function markWebhookLog(admin, logId: string | null, updates: { status?: 'processed'|'noop'|'missing-job'|'failed'; error?: string | null; notes?: string | null; processed_at?: string }): Promise<void>
```
Port from studio `monday.js:214-250`. `job_tracker_webhook_logs(monday_item_id, board_id, column_id, event_type, payload jsonb, status, error, processed_at, notes)` verified live.

- [ ] **Step 1: Failing test** — `logWebhookEvent` inserts and returns the stub id; `markWebhookLog(admin, id, {status:'processed'})` updates by id; `markWebhookLog(admin, null, ...)` is a no-op (no insert/update calls).
- [ ] **Step 2: Run — fails.**
- [ ] **Step 3: Implement** (JSON-sanitize the payload; default `processed_at` to caller-provided or `new Date().toISOString()` inside `markWebhookLog`).
- [ ] **Step 4: Run — passes.**
- [ ] **Step 5: Commit** — `feat(tracker): job_tracker_webhook_logs logging helper`.

## Task 5: Job-reference validation (§D part 1)

**Files:** Create `lib/monday/job-reference.ts`; Test `lib/monday/__tests__/job-reference.test.ts`.
**Interfaces — Produces:** `JOB_REFERENCE_PATTERN`, `normalizeJobReference(v): string | null`, `validateJobReference(v): { ok: true; value: string } | { ok: false; code: 'missing-job-reference'|'invalid-job-reference'; message: string; value?: string }`. Verbatim port of studio `job-reference.js`.

- [ ] **Step 1: Failing test** — `validateJobReference('ANFI-000092').ok === true`; `('NEOC-3781').ok === true`; `('  ').code === 'missing-job-reference'`; `('bad').code === 'invalid-job-reference'`; `('A1').code === 'invalid-job-reference'`; `('X'.repeat(3)+'-99').ok === true`; `('ANFI-000092-2').ok === true`.
- [ ] **Step 2: Run — fails.**
- [ ] **Step 3: Implement** (verbatim).
- [ ] **Step 4: Run — passes.**
- [ ] **Step 5: Commit** — `feat(tracker): job-reference validation (portal port)`.

## Task 6: Provisioning (§D)

**Files:** Create `lib/monday/tracker-provisioning.ts`; Test `lib/monday/__tests__/tracker-provisioning.test.ts`.
**Interfaces — Consumes:** `deriveStatusValue` (T1), `validateJobReference`/`normalizeJobReference` (T5), `mondayApiCall` (`@/lib/monday/client`), `PRODUCTION_COLUMNS`/`PRODUCTION_BOARD_ID` (`@/lib/monday/column-ids`). **Produces:**
```ts
interface EnsureArgs { admin; mondayItemId: string; boardId?: number|string|null; providedJobReference?: string|null; providedStatus?: string|null; providedQuoteNumber?: string|null; providedCustomerEmail?: string|null; writePublicLink?: boolean; forceTokenSync?: boolean; requireJobReference?: boolean }
interface EnsureResult { created: boolean; updated: boolean; skipped: boolean; skipReason: string|null; trackerToken: string|null; jobReference: string|null; status?: string; wrotePublicLink: boolean; mondayWriteError: string|null }
function ensureTrackerForMondayItem(args: EnsureArgs): Promise<EnsureResult>
function provisionTrackerForJobReferenceEvent(args: { admin; mondayItemId: string; boardId; jobReference: string|null }): Promise<{ statusCode: number; body: unknown; logStatus: 'processed'|'noop'|'failed'; logNotes?: string|null; error?: unknown }>
function provisionTrackerForCreateEvent(args: { admin; mondayItemId: string; boardId }): Promise<{ statusCode: number; body: unknown; logStatus: 'processed'|'noop'; logNotes?: string|null }>
function handleTrackerTokenEvent(args: { admin; mondayItemId: string; boardId; pastedValue: string|null; tracker: { job_reference: string|null; tracker_token: string|null } | null }): Promise<{ applied: boolean; correctedTo?: string|null }>
```
Port `ensureTrackerForMondayItem` (studio `tracker-provisioning.js`) + the event wrappers (`provisioning-events.js`) + `trackerTokenHandler` (studio `monday.js:641-750`). Adapt to portal: Monday item fetch/extract via `mondayApiCall` (returns `data` unwrapped — callers read `resp.items`); job-ref column = `PRODUCTION_COLUMNS.poRef` (`text_mkqxcmvz`); public-link column = `PRODUCTION_COLUMNS.trackerUrl` (`text_mkxvmsha`); board default = `PRODUCTION_BOARD_ID`. **Write-back builds the portal URL** `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://portal.theprintroom.nz'}/order-tracker/<token>` and **reads the column first, skipping the write when it already equals that URL** (loop guard). `buildPersistedPayload` inserts empty `quote_data:{}, product_images:[], tracking_info:{}, production_updates:[], status_history:[]`, `platform:'monday-native'`, `status` via engine (default `quote-stage`).

- [ ] **Step 1: Failing tests** (mock `@/lib/monday/client`, pass a chainable supabase stub):
  1. Job-Reference event, new item, valid ref `ANFI-000200` → inserts a row with `tracker_token === job_reference === 'ANFI-000200'`, `monday_item_id`, `status:'quote-stage'`; calls the write-back mutation with the **portal** URL `.../order-tracker/ANFI-000200`; result `created:true`.
  2. Invalid ref `bad ref` → no insert, `provisionTrackerForJobReferenceEvent(...).body.action === 'validation_failed'`, statusCode 200, `logStatus:'noop'`.
  3. Token conflict: a row already has `tracker_token='ANFI-000200'` under a different `monday_item_id` → re-point (`update monday_item_id`), `updated:true`, **no** duplicate insert.
  4. Write-back loop guard: when the Monday column already reads `.../order-tracker/ANFI-000200`, the write mutation is **not** called.
  5. `handleTrackerTokenEvent`: pasted value whose job-ref segment ≠ the item's real job-ref → writes the corrected portal URL back + returns `applied:true, correctedTo`; matching value → `applied:false`.
- [ ] **Step 2: Run — fails.**
- [ ] **Step 3: Implement** the port with the portal adaptations above.
- [ ] **Step 4: Run — passes.**
- [ ] **Step 5: Commit** — `feat(tracker): Monday-origin provisioning + portal-link write-back + token validation`.

## Task 7: Quote mirror (§E) — gated OFF by default

**Files:** Create `lib/monday/quote-mirror.ts`; Test `lib/monday/__tests__/quote-mirror.test.ts`.
**Interfaces — Produces:**
```ts
function mapMondayStatusToQuoteEnum(rawLabel: string | null | undefined): string | null
function mirrorStatusToQuote(admin, args: { quoteId: string; rawMondayStatus: string; columnId: string; changedAt: string; userId?: number|string|null }): Promise<void>
```
Verbatim port of studio `monday.js:757-835`. **`mirrorStatusToQuote` returns immediately unless `process.env.ENABLE_QUOTE_STATUS_MIRROR === 'true'`.** When enabled: read `quotes.status`; if the mapped value differs, update `quotes.status` and insert a `quote_status_history` row (`from_status, to_status, actor:'monday-webhook', source:'production-board', metadata:{columnId, mondayLabel, userId}, changed_at`). Non-fatal (log, never throw). `quote_status_history` columns verified live.

- [ ] **Step 1: Failing tests** — `mapMondayStatusToQuoteEnum('Proof Approved') === 'in_production'`, `('Shipped') === 'dispatched'`, `('nonsense') === null`. With `ENABLE_QUOTE_STATUS_MIRROR='true'`: a changed status updates `quotes` + inserts history; unchanged → no update, no insert. With the flag unset: **no** DB calls at all.
- [ ] **Step 2: Run — fails.**
- [ ] **Step 3: Implement** with the env gate as the first line.
- [ ] **Step 4: Run — passes.**
- [ ] **Step 5: Commit** — `feat(tracker): quote-status mirror (gated behind ENABLE_QUOTE_STATUS_MIRROR)`.

## Task 8: Handler upgrade + routing + auth (§B, wire C/E/F/G)

**Files:** Modify `app/api/webhooks/monday/tracker-status/route.ts`; Test `app/api/webhooks/monday/tracker-status/__tests__/route.test.ts`.
**Interfaces — Consumes:** everything from T1–T7. Adds `triggerTime?: string`, `userId?: number` to the `event` type.

Control flow of the upgraded `POST`:
1. Parse JSON. If `payload.challenge` → `{challenge}` (before auth).
2. **Secret gate:** if `process.env.MONDAY_WEBHOOK_SECRET` is set and `new URL(request.url).searchParams.get('secret')` ≠ it → 401. (Unset ⇒ open, preserving today's Shipped webhook.)
3. Existing collections-board + date routing unchanged.
4. **New:** production board + `columnId === PRODUCTION_COLUMNS.poRef` → `provisionTrackerForJobReferenceEvent` (log + mark).
5. **New:** production board + `columnId === PRODUCTION_COLUMNS.trackerUrl` → `handleTrackerTokenEvent`.
6. **New:** item-create (no `columnId`, `event.type` includes `create`) → `provisionTrackerForCreateEvent` (log + mark). *(Inert until a create subscription exists.)*
7. `color` on `mainStatus` → `handleTrackerStatusChange` (below).

Upgraded `handleTrackerStatusChange`:
- `logWebhookEvent` at entry (capture `logId`).
- `const changedAt = event.triggerTime && !Number.isNaN(Date.parse(event.triggerTime)) ? new Date(event.triggerTime).toISOString() : new Date().toISOString()`.
- `const derived = deriveStatusValue(displayLabel, { previousStatus: tracker.status })` — but resolve the tracker first (existing inventory-decrement branch on `dispatched` subitem stays).
- If tracker missing → `markWebhookLog(logId,{status:'missing-job'})`, 200 "Tracker not linked".
- `!derived.isCustomerFacing`: `markWebhookLog(logId,{status:'noop', notes: derived.preserveExisting ? 'hold/internal — preserved' : 'unknown status — ignored'})`, 200. No write, no email.
- `derived.storageValue === tracker.status` (no real change): `markWebhookLog(logId,{status:'noop', notes:'status unchanged'})`, 200. **(gap-c idempotency: poller-then-webhook convergence.)**
- 60s fast-path window guard retained.
- Real transition → build status_history + production_updates entries with `changed_at = changedAt`; milestone stamps unchanged; `update job_trackers`; revalidate tags.
- **Email (deferred via `after()`):** if `tracker.customer_email` → `const et = statusEmailType(derived.storageValue, event.triggerTime)`; `if (!(await hasEmailBeenSent(supabase,{mondayItemId, emailType: et}))) { const r = await sendTrackerStatusEmail({...}); await recordEmailSend(supabase,{ mondayItemId, trackerToken: tracker.tracker_token, customerEmail: tracker.customer_email, emailType: et, emailSent: r.success, emailId: undefined, errorMessage: r.error, triggerType:'automatic' }) }`.
- **Quote mirror (deferred via `after()`):** if `tracker.quote_id` → `mirrorStatusToQuote(supabase,{ quoteId: tracker.quote_id, rawMondayStatus: displayLabel, columnId: event.columnId, changedAt, userId: event.userId })` (inert unless the flag is on).
- `markWebhookLog(logId,{status:'processed'})`; keep the items-sync branch.

- [ ] **Step 1: Failing tests** (mock `@/lib/supabase`, `@/lib/email/tracker-notification`, `@/lib/email/tracker-email-log`, `@/lib/monday/webhook-log`, `@/lib/monday/quote-mirror`, `@/lib/monday/tracker-provisioning`; use global `flushAfter()`):
  1. Customer-facing transition (`Assign to Production`, `triggerTime` set, tracker at `need-proof`) → `job_trackers.update` called with `status:'in-production'`, one new status_history entry, `production_start_at` stamped; after `flushAfter()`, `sendTrackerStatusEmail` called **once** and `recordEmailSend` with `emailSent:true`; `markWebhookLog` `processed`.
  2. Internal (`Lost Job`) → **no** update, **no** email; `markWebhookLog` `noop` notes contains `preserved`.
  3. Hold (`Job on Hold`) → no update, no email; `noop`.
  4. Same-event redelivery (same `triggerTime`, `hasEmailBeenSent`→true) → after flush, `sendTrackerStatusEmail` **not** called again.
  5. Genuine re-entry (`proof-sent` again with a **new** `triggerTime`, tracker currently `need-proof`) → email **is** sent (new `email_type`).
  6. Status unchanged (`Assign to Production` when tracker already `in-production`) → no update, no email, `noop` notes `unchanged`. **(gap c)**
  7. Auth: with `MONDAY_WEBHOOK_SECRET='s3cret'`, POST without `?secret` → 401; with `?secret=s3cret` → processed; a `challenge` body with the secret set but absent from query → still answered 200.
  8. Job-Reference column event routes to `provisionTrackerForJobReferenceEvent` (mocked) and returns its body.
- [ ] **Step 2: Run — fails.**
- [ ] **Step 3: Implement** the route changes.
- [ ] **Step 4: Run — passes**; then run the whole monday + email suites.
- [ ] **Step 5: Commit** — `feat(tracker): engine-driven handler — trigger-time, de-dup, provisioning routing, quote-mirror, logging, secret auth`.

## Task 9: Gap b — checkout seed is one stage optimistic

**Files:** Modify `lib/orders/job-tracker.ts:207-238`; Test `lib/orders/__tests__/job-tracker.seed.test.ts`.
**Interfaces — Consumes:** `deriveStatusValue` (T1).

- [ ] **Step 1: Failing test** — construct the insert row and assert: (a) `row.status === 'quote-accepted-mockup'` (NOT `'need-proof'`); (b) the seeded `status_history[0].status_key === 'quote-accepted-mockup'`; (c) the seed milestone body does **not** mention "proof". Simplest form: export a small pure helper `seedTrackerStatus()` from the module and assert it equals `deriveStatusValue('Need: Mockup (Quote Approved)').canonical` === `'quote-accepted-mockup'`, then assert the built `row` uses it. (Mock supabase minimally for the full-path assertion, or unit-test the helper — prefer the helper.)
- [ ] **Step 2: Run — fails** (current seed is `'need-proof'`).
- [ ] **Step 3: Implement** — add at top of module:
```ts
import { deriveStatusValue } from '@/lib/monday/tracker-status-engine'
// Monday creates the production-board item at "Need: Mockup (Quote Approved)" (idx 1).
// Seed the tracker at the SAME stage the engine derives from that label, so a fresh
// order is not born one stage ahead of Monday (issue #77, gap b). Falls back to the
// engine default if the canonical mapping ever changes.
const CHECKOUT_SEED_STATUS =
  deriveStatusValue('Need: Mockup (Quote Approved)').canonical ?? 'quote-accepted-mockup'
```
Replace `status: 'need-proof'` → `status: CHECKOUT_SEED_STATUS`; the `status_history[0]` `status`/`status_key` → `CHECKOUT_SEED_STATUS`; milestone body → `'Your order has been received. Our team is preparing your mockup.'`.
- [ ] **Step 4: Run — passes.**
- [ ] **Step 5: Commit** — `fix(tracker): seed checkout status at Mockup, matching Monday (issue #77 gap b)`.

## Task 10: Gap c — poller+webhook idempotency test + note

**Files:** Test `app/api/webhooks/monday/tracker-status/__tests__/route.idempotency.test.ts` (or fold into T8 file). Doc note in the cutover checklist (Task 11).

- [ ] **Step 1: Failing/【covered】test** — the "status unchanged → noop" case (T8 #6) IS the portal-side idempotency guarantee: whichever writer (studio poller or portal webhook) lands the transition first, the second sees `tracker.status === derived.storageValue` and no-ops — no duplicate `status_history`, and (because the poller does not email and the webhook de-dups on trigger time) no double email. Add an explicit second-writer assertion: given a tracker already at `in-production` with a matching last `status_history` entry, a webhook for `Assign to Production` produces **zero** additional entries and **zero** `sendTrackerStatusEmail` calls.
- [ ] **Step 2: Run — fails** if not yet implemented; passes once T8 lands.
- [ ] **Step 3:** (no new impl beyond T8) — this task certifies the behavior.
- [ ] **Step 4: Run — passes.**
- [ ] **Step 5: Commit** — `test(tracker): certify poller+webhook single-transition idempotency (issue #77 gap c)`.

## Task 11: Cutover + kill-switch + gap-a checklist (HITL — doc only)

**Files:** Create `docs/superpowers/checklists/2026-07-20-tracker-phase-2-cutover.md`.

- [ ] **Step 1** — write the checklist (no code executed). Must contain, verbatim-ready for Jon:
  - **Subscription snapshot** (live 2026-07-20): the 8 board-1992701981 webhooks with ids/events/configs (30731909 status Shipped-only; 24679107 job-ref; 26034606 tracker-token; 24685006 send-button; 19365146+26353740 Stock on `color_mkpedzar`; 18483144+18484284 group-move).
  - **Env to set:** `MONDAY_WEBHOOK_SECRET`, confirm `NEXT_PUBLIC_SITE_URL`, (later) `ENABLE_QUOTE_STATUS_MIRROR` only after vocab sign-off.
  - **Recreate/repoint** 30731909 (un-filtered, `?secret=`), 24679107, 26034606, 24685006 at `https://portal.theprintroom.nz/api/webhooks/monday/tracker-status?secret=…`; leave Stock + group-move alone.
  - **Studio kill-switch diff** (proposed, for the studio repo — apply on Jon's go): in `apps/job-tracker/pages/api/webhooks/monday.js`, after the board check, `if (process.env.STUDIO_TRACKER_WEBHOOKS_DISABLED === 'true') return res.status(200).json({ ignored: true })` for status/job-ref/tracker-token events; leaves collections + poller alive.
  - **Gap c poller-scoping** (proposed studio change, bring fwd from Phase 4): in `apps/job-tracker/pages/api/sync-monday.js`, skip rows where `platform in ('b2b-portal','monday-native')` (portal-owned) when the portal owns board 1992701981 — or gate the status write off entirely at cutover.
  - **Gap a operational gate (headline):** BEFORE cutover, confirm with ops that the portal-created item on board 1992701981 is the row staff actually progress (which group it lands in). §H.5 verification must move a **real** order through stages via the normal staff workflow (not one implementer-made test item); emails → `jamie@theprint-room.co.nz`.
  - **Rollback:** unset `STUDIO_TRACKER_WEBHOOKS_DISABLED`; restore the snapshotted subs (re-add index-10 filter, re-point to studio). Idempotent handler ⇒ no data cleanup.
- [ ] **Step 2: Commit** — `docs(tracker): Phase 2 cutover + kill-switch + gap-a operational checklist (HITL)`.

---

## Self-Review

- **Spec coverage:** A→T1/T2; B→T8; C→T3; D→T5/T6; E→T7; F→T4; G→T8; H→T11; gap a→T11; gap b→T9; gap c→T10/T8. ✔
- **Types consistent:** `deriveStatusValue`/`DerivedStatus` used identically in T2/T8/T9; `ensureTrackerForMondayItem` result shape stable T6→T8; `statusEmailType`/`hasEmailBeenSent`/`recordEmailSend` stable T3→T8. ✔
- **Placeholder scan:** every code step carries real code or a precise reference to a verbatim studio source with the adaptation named. ✔
- **Safety:** no migration; §E gated; auth open when secret unset; write-back loop-guarded; all writes idempotent; cutover is doc-only. ✔
