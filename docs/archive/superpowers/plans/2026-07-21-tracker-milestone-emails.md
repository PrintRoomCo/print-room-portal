# Tracker Milestone Emails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a portal-originated order advances on the Monday production board, email the customer at exactly two milestones — "in production" and "shipped (with tracking)" — and update the tracker silently for every other stage.

**Architecture:** This revises the *email cadence* of the already-built order-tracker Phase 2 webhook (`app/api/webhooks/monday/tracker-status/route.ts`). Instead of emailing on every customer-facing transition, a pure label-allow-list gate (`lib/email/milestone-email.ts`) decides which of the two milestone emails, if any, a raw Monday label fires. The dispatched email reads its tracking link straight off the Monday item (the studio poller that used to populate `tracking_info` is disabled at cutover). De-dup reuses the existing `tracker_email_log` with a new *stable* key so each milestone lands once ever. No new tables, no new webhook, no migration.

**Tech Stack:** Next.js (App Router, `after()`), TypeScript, Supabase (service-role client injected), Monday GraphQL via `lib/monday/client.ts`, Vitest.

## Global Constraints

- **Test runner:** `npx vitest run <path>` for a single file; `npm test` (= `vitest run`) for the suite. `after()` side-effects are flushed in tests via the global `flushAfter()` (see `vitest.setup.ts`).
- **TDD:** every task is red → green → refactor. Write the failing test, watch it fail for the right reason, then the minimal code.
- **Branch:** `feat/tracker-milestone-emails`, cut off `main` (order-tracker Phase 2 is already merged to `main` — commit `5982f4a`, so the Phase 2 webhook this plan edits is present on `main`). Do NOT merge or deploy.
- **No migration.** This feature is additive code only. It reuses the existing `tracker_email_log` table. Do not create, apply, or alter any DB migration.
- **Shared tables stay idempotent.** `job_trackers` and `tracker_email_log` are shared by both portals + the studio poller. The de-dup key must be stable so a re-delivery or a still-live second writer never double-sends.
- **Test/verification emails go to `jamie@theprint-room.co.nz`, never `jon@`.** Do not send any real email during implementation — all sends are mocked in tests.
- **Do NOT touch Monday config** (subscriptions, columns, automations) from code or MCP. The subscription un-filter and the studio kill-switch are Jon's operational steps, out of scope here.
- **Tracking source for the dispatched email = ONLY the Customer Tracker Link column `link_mky1w9w`** (`PRODUCTION_COLUMNS.customerTrackingUrl`). The Supplier Tracking Link `link_mkqz77w0` is inbound-blanks tracking and MUST NEVER be emailed to a customer (`lib/monday/column-ids.ts:52`). This intentionally deviates from spec §3, which listed the supplier link as precedence #2 — flagged for Jon.
- **Milestone email types (verbatim):** `milestone-in-production` and `milestone-dispatched`.
- **In-production trigger labels (normalized):** `assign-to-production`, `all-production-complete`. **Dispatched trigger label (normalized):** `shipped`. Nothing else emails.
- **Commit** after each task (frequent commits). Do not push.

## Known limitations (v1, by design)

1. **Status-ordering edge.** The milestone email fires inside the `after()` block, which only runs when the status actually *advances* (the handler early-returns when `canonicalKey === tracker.status`). So if a non-milestone label that shares the same canonical bucket lands *first* — e.g. "Trends - Ordered" (→ `in-production`) before "Assign to Production", or "Ready to Pickup" (→ `dispatched`) before "Shipped" — it advances the tracker and the later milestone label is idempotency-skipped, sending no email. In practice "Shipped" precedes "Closed Job" (board evidence) and the in-production non-milestone labels are rare. Accepted for v1; do not re-architect the handler's idempotency to fix it.
2. **Dispatched-before-tracking.** If "Shipped" somehow lands before the tracking link is on the item, the email sends with "tracking to follow" copy; the once-ever guard means no "now with tracking" follow-up. Accepted for v1.

## File Structure

**New files**
- `lib/email/milestone-email.ts` — pure gate: raw Monday label → milestone key (or null); stable de-dup key per milestone.
- `lib/email/__tests__/milestone-email.test.ts`
- `lib/monday/tracking-link.ts` — read the customer tracking URL off a Monday item (link-column parse + best-effort fetch).
- `lib/monday/__tests__/tracking-link.test.ts`
- `lib/orders/tracker-test-org.ts` — resolve `organizations.is_test` for a tracker via its quote.
- `lib/orders/__tests__/tracker-test-org.test.ts`

**Modified files**
- `lib/email/tracker-notification.ts` — two-case milestone copy (in-production / dispatched), dispatched "tracking to follow" branch. Test: `lib/email/__tests__/tracker-notification.test.ts` (extend).
- `lib/email/tracker-email-log.ts` — remove the now-dead `statusEmailType` (its per-transition, trigger-time-keyed behaviour is replaced by the stable milestone key). Test: `lib/email/__tests__/tracker-email-log.test.ts` (prune).
- `app/api/webhooks/monday/tracker-status/route.ts` — the `after()` email block: label gate, test-org guard, dispatched tracking fetch, stable email type. Test: `app/api/webhooks/monday/tracker-status/__tests__/route.test.ts` (extend + fix).

---

### Task 1: Milestone label gate (`lib/email/milestone-email.ts`)

**Files:**
- Create: `lib/email/milestone-email.ts`
- Test: `lib/email/__tests__/milestone-email.test.ts`

**Interfaces:**
- Consumes: `normalizeKey` from `@/lib/monday/tracker-status-engine`.
- Produces:
  - `type MilestoneKey = 'in-production' | 'dispatched'`
  - `milestoneForLabel(displayLabel: string | null | undefined): MilestoneKey | null`
  - `milestoneEmailType(milestone: MilestoneKey): string` → `` `milestone-${milestone}` ``

- [ ] **Step 1: Write the failing test**

Create `lib/email/__tests__/milestone-email.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { milestoneForLabel, milestoneEmailType } from '../milestone-email'

describe('milestoneForLabel', () => {
  it('maps the two in-production trigger labels', () => {
    expect(milestoneForLabel('Assign to Production')).toBe('in-production')
    expect(milestoneForLabel('All Production Complete')).toBe('in-production')
  })

  it('maps Shipped to dispatched', () => {
    expect(milestoneForLabel('Shipped')).toBe('dispatched')
  })

  it('is case- and punctuation-insensitive', () => {
    expect(milestoneForLabel('assign to production')).toBe('in-production')
    expect(milestoneForLabel('ASSIGN TO PRODUCTION')).toBe('in-production')
  })

  it('returns null for canonical-sibling labels that must NOT email', () => {
    // These all map to canonical in-production/dispatched in the status engine,
    // but are deliberately excluded from the email gate.
    expect(milestoneForLabel('Partially Shipped')).toBeNull()
    expect(milestoneForLabel('Trends - Ordered')).toBeNull()
    expect(milestoneForLabel('Closed Job')).toBeNull()
    expect(milestoneForLabel('Ready to Pickup')).toBeNull()
    expect(milestoneForLabel('Ship Direct to Client')).toBeNull()
  })

  it('returns null for proof / internal stages', () => {
    expect(milestoneForLabel('Sent: Proof+Invoice/Quote')).toBeNull()
    expect(milestoneForLabel('Need: Internal Proof Approval')).toBeNull()
    expect(milestoneForLabel('Job on Hold')).toBeNull()
  })

  it('returns null for empty / nullish input', () => {
    expect(milestoneForLabel('')).toBeNull()
    expect(milestoneForLabel(null)).toBeNull()
    expect(milestoneForLabel(undefined)).toBeNull()
  })
})

describe('milestoneEmailType', () => {
  it('returns stable keys that do NOT encode trigger time', () => {
    expect(milestoneEmailType('in-production')).toBe('milestone-in-production')
    expect(milestoneEmailType('dispatched')).toBe('milestone-dispatched')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/email/__tests__/milestone-email.test.ts`
Expected: FAIL — `Cannot find module '../milestone-email'` (module not created yet).

- [ ] **Step 3: Write minimal implementation**

Create `lib/email/milestone-email.ts`:

```ts
/**
 * Milestone email gate (portal).
 *
 * The order-tracker webhook advances the customer tracker on EVERY customer-
 * facing Monday transition, but the customer is only *emailed* at two moments:
 * "in production" and "shipped". This module is the single source of truth for
 * that allow-list.
 *
 * The gate keys on the RAW Monday Job-Status label, NOT the canonical status,
 * because the canonical buckets are deliberately coarse: canonical
 * `in-production` also swallows "Partially Shipped" / "Trends - Ordered", and
 * canonical `dispatched` swallows "Closed Job" / "Ready to Pickup" / "Ship
 * Direct to Client" — none of which should trigger a customer email. See
 * `lib/monday/tracker-status-engine.ts` for the full canonical map.
 */

import { normalizeKey } from '@/lib/monday/tracker-status-engine'

export type MilestoneKey = 'in-production' | 'dispatched'

/**
 * Normalised Monday labels that fire the "in production" email. Both map to
 * canonical `in-production`; staff use "All Production Complete" about as often
 * as "Assign to Production" (some jobs skip straight to Complete), so we fire on
 * whichever lands FIRST and de-dup once-ever downstream. "Partially Shipped" is
 * deliberately excluded — it means shipping has begun, not that work started.
 */
const IN_PRODUCTION_LABELS: ReadonlySet<string> = new Set([
  'assign-to-production',
  'all-production-complete',
])

/**
 * Normalised Monday labels that fire the "shipped" email. Only "Shipped" — not
 * "Closed Job" (fires AFTER Shipped and is the most frequent board value),
 * "Ready to Pickup" or "Ship Direct to Client" (pickup ≠ shipped copy).
 */
const DISPATCHED_LABELS: ReadonlySet<string> = new Set(['shipped'])

/**
 * Map a raw Monday Job-Status label to the milestone email it should fire, or
 * `null` for every other label (the tracker still updates silently). Case- and
 * punctuation-insensitive via `normalizeKey`.
 */
export function milestoneForLabel(
  displayLabel: string | null | undefined
): MilestoneKey | null {
  const key = normalizeKey(displayLabel)
  if (!key) return null
  if (IN_PRODUCTION_LABELS.has(key)) return 'in-production'
  if (DISPATCHED_LABELS.has(key)) return 'dispatched'
  return null
}

/**
 * Stable de-dup key for a milestone email — `milestone-<key>`. Unlike the old
 * per-transition key, this does NOT encode the Monday trigger time, so a
 * re-entry to the milestone after a hold/rework (Assign to Production → Job on
 * Hold → Assign to Production) does not re-notify: the email lands once ever.
 */
export function milestoneEmailType(milestone: MilestoneKey): string {
  return `milestone-${milestone}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/email/__tests__/milestone-email.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add lib/email/milestone-email.ts lib/email/__tests__/milestone-email.test.ts
git commit -m "feat: milestone email label gate (in-production / dispatched)"
```

---

### Task 2: Customer tracking-link reader (`lib/monday/tracking-link.ts`)

**Files:**
- Create: `lib/monday/tracking-link.ts`
- Test: `lib/monday/__tests__/tracking-link.test.ts`

**Interfaces:**
- Consumes: `mondayApiCall` from `@/lib/monday/client`; `PRODUCTION_COLUMNS.customerTrackingUrl` from `@/lib/monday/column-ids`.
- Produces:
  - `extractUrlFromLinkColumn(column: { text?: string | null; value?: string | null } | null | undefined): string | null`
  - `fetchCustomerTrackingUrl(mondayItemId: string): Promise<string | null>` — best-effort, never throws.

- [ ] **Step 1: Write the failing test**

Create `lib/monday/__tests__/tracking-link.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mondayApiCall = vi.fn()
vi.mock('@/lib/monday/client', () => ({
  mondayApiCall: (...a: unknown[]) => mondayApiCall(...(a as [])),
}))

import { extractUrlFromLinkColumn, fetchCustomerTrackingUrl } from '../tracking-link'

describe('extractUrlFromLinkColumn', () => {
  it('reads url from the link column value JSON', () => {
    const col = { value: JSON.stringify({ url: 'https://nzpost.co.nz/track/XYZ', text: 'Track' }), text: 'Track' }
    expect(extractUrlFromLinkColumn(col)).toBe('https://nzpost.co.nz/track/XYZ')
  })

  it('falls back to text when it looks like a URL and value has no url', () => {
    const col = { value: JSON.stringify({ text: '' }), text: 'https://courierpost.co.nz/track/AB1' }
    expect(extractUrlFromLinkColumn(col)).toBe('https://courierpost.co.nz/track/AB1')
  })

  it('returns null when text is a non-URL label and value has no url', () => {
    expect(extractUrlFromLinkColumn({ value: 'null', text: 'Track here' })).toBeNull()
  })

  it('returns null for a null column', () => {
    expect(extractUrlFromLinkColumn(null)).toBeNull()
  })

  it('tolerates malformed value JSON and uses URL-looking text', () => {
    expect(extractUrlFromLinkColumn({ value: '{not json', text: 'https://x.test/1' })).toBe('https://x.test/1')
  })
})

describe('fetchCustomerTrackingUrl', () => {
  beforeEach(() => mondayApiCall.mockReset())

  it('returns the customer tracking url for the item', async () => {
    mondayApiCall.mockResolvedValue({
      items: [{ column_values: [{ id: 'link_mky1w9w', text: 'Track', value: JSON.stringify({ url: 'https://nzpost.co.nz/track/XYZ' }) }] }],
    })
    expect(await fetchCustomerTrackingUrl('555')).toBe('https://nzpost.co.nz/track/XYZ')
    // queried the customer tracker link column only
    const vars = mondayApiCall.mock.calls[0][1] as { columnIds: string[]; itemIds: string[] }
    expect(vars.columnIds).toEqual(['link_mky1w9w'])
    expect(vars.itemIds).toEqual(['555'])
  })

  it('returns null when the item has no link', async () => {
    mondayApiCall.mockResolvedValue({ items: [{ column_values: [{ id: 'link_mky1w9w', text: '', value: 'null' }] }] })
    expect(await fetchCustomerTrackingUrl('555')).toBeNull()
  })

  it('returns null (never throws) when the Monday call fails', async () => {
    mondayApiCall.mockRejectedValue(new Error('Monday 500'))
    expect(await fetchCustomerTrackingUrl('555')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/monday/__tests__/tracking-link.test.ts`
Expected: FAIL — `Cannot find module '../tracking-link'`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/monday/tracking-link.ts`:

```ts
/**
 * Read a customer-facing courier tracking URL off a Monday production-board item.
 *
 * The "Dispatched" milestone email needs the tracking link at send time. The
 * studio poller writes it into `job_trackers.tracking_info`, but that poller is
 * disabled at the Phase 2 cutover — so post-cutover we read the link straight
 * off the Monday item instead. ONLY the "Customer Tracker Link" column
 * (`link_mky1w9w`) is read: the "Supplier Tracking Link" (`link_mkqz77w0`) is
 * inbound blanks tracking and must never be shown to a customer (see
 * `lib/monday/column-ids.ts`).
 */

import { mondayApiCall } from '@/lib/monday/client'
import { PRODUCTION_COLUMNS } from '@/lib/monday/column-ids'

interface MondayLinkColumn {
  text?: string | null
  value?: string | null
}

/**
 * Pull the URL out of a Monday "link" column payload. Monday stores links as
 * `value` JSON `{ "url": "...", "text": "..." }`; the display `text` is often a
 * label rather than the URL. Prefer `value.url`, then fall back to `text` only
 * when it already looks like a URL.
 */
export function extractUrlFromLinkColumn(
  column: MondayLinkColumn | null | undefined
): string | null {
  if (!column) return null
  try {
    const parsed = JSON.parse(column.value || 'null') as { url?: string } | null
    const url = parsed?.url?.trim()
    if (url) return url
  } catch {
    /* not JSON — fall through to text */
  }
  const text = column.text?.trim()
  if (text && /^https?:\/\//i.test(text)) return text
  return null
}

/**
 * Fetch the customer tracking URL for a Monday item, or `null` if absent /
 * unreadable. Best-effort: never throws (the dispatched email falls back to
 * "tracking to follow" copy on null).
 */
export async function fetchCustomerTrackingUrl(
  mondayItemId: string
): Promise<string | null> {
  const columnId = PRODUCTION_COLUMNS.customerTrackingUrl
  const query = `query ($itemIds: [ID!], $columnIds: [String!]) {
    items(ids: $itemIds) { id column_values(ids: $columnIds) { id text value } }
  }`
  try {
    const resp = await mondayApiCall<{
      items?: Array<{ column_values?: MondayLinkColumn[] }>
    }>(query, { itemIds: [String(mondayItemId)], columnIds: [columnId] })
    const column = resp.items?.[0]?.column_values?.[0] ?? null
    return extractUrlFromLinkColumn(column)
  } catch (err) {
    console.error('[tracking-link] fetch failed:', err)
    return null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/monday/__tests__/tracking-link.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/monday/tracking-link.ts lib/monday/__tests__/tracking-link.test.ts
git commit -m "feat: read customer tracking URL from Monday item (link_mky1w9w)"
```

---

### Task 3: Test-org resolver (`lib/orders/tracker-test-org.ts`)

**Files:**
- Create: `lib/orders/tracker-test-org.ts`
- Test: `lib/orders/__tests__/tracker-test-org.test.ts`

**Interfaces:**
- Consumes: `SupabaseClient` type; tables `quotes` (col `organization_id`) and `organizations` (col `is_test`).
- Produces: `isTrackerTestOrg(admin: SupabaseClient, quoteId: string | null | undefined): Promise<boolean>`. Fail-open toward sending: any missing link / error → `false`.

- [ ] **Step 1: Write the failing test**

Create `lib/orders/__tests__/tracker-test-org.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isTrackerTestOrg } from '../tracker-test-org'

/**
 * Chainable Supabase stub that returns a per-table `maybeSingle` result. The
 * table is captured on `from()`, so `quotes` and `organizations` can resolve
 * differently in one call chain.
 */
function makeAdmin(rows: { quotes?: unknown; organizations?: unknown }) {
  let currentTable = ''
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: () =>
      Promise.resolve({
        data: currentTable === 'quotes' ? rows.quotes ?? null : rows.organizations ?? null,
      }),
  }
  const from = vi.fn((t: string) => {
    currentTable = t
    return builder
  })
  return { from } as unknown as SupabaseClient
}

describe('isTrackerTestOrg', () => {
  it('is false (no query) when there is no quote id', async () => {
    const admin = makeAdmin({})
    expect(await isTrackerTestOrg(admin, null)).toBe(false)
    expect((admin.from as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
  })

  it('is false when the quote has no organization', async () => {
    const admin = makeAdmin({ quotes: { organization_id: null } })
    expect(await isTrackerTestOrg(admin, 'q1')).toBe(false)
  })

  it('is true when the organization is a test org', async () => {
    const admin = makeAdmin({ quotes: { organization_id: 'org1' }, organizations: { is_test: true } })
    expect(await isTrackerTestOrg(admin, 'q1')).toBe(true)
  })

  it('is false for a real (non-test) organization', async () => {
    const admin = makeAdmin({ quotes: { organization_id: 'org1' }, organizations: { is_test: false } })
    expect(await isTrackerTestOrg(admin, 'q1')).toBe(false)
  })

  it('is false when the organization row is missing', async () => {
    const admin = makeAdmin({ quotes: { organization_id: 'org1' }, organizations: null })
    expect(await isTrackerTestOrg(admin, 'q1')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/orders/__tests__/tracker-test-org.test.ts`
Expected: FAIL — `Cannot find module '../tracker-test-org'`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/orders/tracker-test-org.ts`:

```ts
/**
 * Resolve whether a job tracker belongs to a test/demo organization
 * (`organizations.is_test`). Used to suppress milestone emails for test orgs,
 * which have live items on the Monday board. Linkage: tracker → quote →
 * organization (the tracker row itself stores no organization_id).
 *
 * Fail-open toward SENDING: any missing link or query error returns false, so a
 * real customer is never silently starved of their milestone email because of a
 * lookup blip.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export async function isTrackerTestOrg(
  admin: SupabaseClient,
  quoteId: string | null | undefined
): Promise<boolean> {
  if (!quoteId) return false

  const { data: quote } = await admin
    .from('quotes')
    .select('organization_id')
    .eq('id', quoteId)
    .maybeSingle()

  const orgId = (quote as { organization_id?: string | null } | null)?.organization_id
  if (!orgId) return false

  const { data: org } = await admin
    .from('organizations')
    .select('is_test')
    .eq('id', orgId)
    .maybeSingle()

  return Boolean((org as { is_test?: boolean | null } | null)?.is_test)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/orders/__tests__/tracker-test-org.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/orders/tracker-test-org.ts lib/orders/__tests__/tracker-test-org.test.ts
git commit -m "feat: resolve organizations.is_test for a tracker via its quote"
```

---

### Task 4: Two-case milestone email copy (`lib/email/tracker-notification.ts`)

**Files:**
- Modify: `lib/email/tracker-notification.ts` (full-file replacement below)
- Test: `lib/email/__tests__/tracker-notification.test.ts` (extend)

**Interfaces:**
- Consumes: unchanged `TrackerEmailParams` (`contactEmail`, `trackerToken`, `jobReference`, `quoteNumber?`, `newStatus`, `trackingNumber?`, `trackingUrl?`, `carrier?`).
- Produces: `sendTrackerStatusEmail(params): Promise<{ success: boolean; error?: string }>` — signature unchanged. Behaviour: copy branches on `newStatus` (`in-production` / `dispatched` / other); dispatched with no tracking renders a "tracking to follow" note instead of the tracking panel.

- [ ] **Step 1: Write the failing tests (append to the existing test file)**

Append these `it` blocks inside the existing `describe('sendTrackerStatusEmail', ...)` in `lib/email/__tests__/tracker-notification.test.ts` (keep the existing CTA-URL test):

```ts
  it('in-production: milestone subject/heading, no tracking block', async () => {
    await sendTrackerStatusEmail({
      contactEmail: 'buyer@acme.test',
      trackerToken: 'tok-1',
      jobReference: 'TPRC-000037',
      newStatus: 'in-production',
    })
    const { subject, html } = sendEmail.mock.calls[0][0]
    expect(subject).toBe('Your order is in production — TPRC-000037')
    expect(html).toContain('Your order is in production')
    expect(html).not.toContain('Track with carrier')
  })

  it('dispatched with tracking: shipped subject + tracking block', async () => {
    await sendTrackerStatusEmail({
      contactEmail: 'buyer@acme.test',
      trackerToken: 'tok-1',
      jobReference: 'TPRC-000037',
      newStatus: 'dispatched',
      trackingNumber: '1234567890',
      trackingUrl: 'https://nzpost.co.nz/track/1234567890',
      carrier: 'NZ Post',
    })
    const { subject, html } = sendEmail.mock.calls[0][0]
    expect(subject).toBe('Your order has shipped — TPRC-000037')
    expect(html).toContain('Your order has shipped')
    expect(html).toContain('Track with carrier')
    expect(html).toContain('https://nzpost.co.nz/track/1234567890')
    expect(html).toContain('NZ Post')
  })

  it('dispatched without tracking: shows a "tracking to follow" note, no tracking block', async () => {
    await sendTrackerStatusEmail({
      contactEmail: 'buyer@acme.test',
      trackerToken: 'tok-1',
      jobReference: 'TPRC-000037',
      newStatus: 'dispatched',
    })
    const { html, text } = sendEmail.mock.calls[0][0]
    expect(html).not.toContain('Track with carrier')
    expect(html.toLowerCase()).toContain('tracking details will follow')
    expect(text.toLowerCase()).toContain('tracking details will follow')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/email/__tests__/tracker-notification.test.ts`
Expected: FAIL — subject is currently `Order update: Production — TPRC-000037` (not the milestone subject) and there is no "tracking details will follow" copy.

- [ ] **Step 3: Replace the implementation**

Replace the entire contents of `lib/email/tracker-notification.ts` with:

```ts
/**
 * Tracker Status Email Notifications
 *
 * Branded HTML email in the Print Room "Peaceful Engineering" look — the same
 * shell (wrapBrandedEmail) and design tokens as the order-confirmation email,
 * so every customer-portal email reads as one family: a white field, a single
 * electric-blue accent, grotesque headings and a monospace reference.
 *
 * Two milestone variants, selected by `newStatus`:
 *   - `in-production` — "Your order is in production", no tracking block.
 *   - `dispatched`    — "Your order has shipped", with a tracking block when a
 *                       tracking number/URL is supplied, or a "tracking to
 *                       follow" note when it is not.
 * Any other status falls back to the generic "status has changed" copy.
 */

import { sendEmail } from './client'
import { getStatusLabel } from '@/lib/job-tracker'
import {
  wrapBrandedEmail,
  escapeHtml,
  BRAND_FONT,
  BRAND_MONO,
  BRAND_ACCENT,
  INK,
  BODY,
  MUTED,
  SURFACE,
} from '@/lib/email/shared'

// Portal-native tracker base. The status email's "View order tracker" CTA links
// into the authed customer portal (/order-tracker/<token>), not the retired
// external Shopify-proxy page. Override origin via NEXT_PUBLIC_SITE_URL.
const PORTAL_ORIGIN =
  process.env.NEXT_PUBLIC_SITE_URL || 'https://portal.theprintroom.nz'

/** Shared small-caps label style (matches order-confirmation.ts). */
const LABEL_STYLE = `font-family:${BRAND_FONT};font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${MUTED};`

interface TrackerEmailParams {
  contactEmail: string
  trackerToken: string
  jobReference: string
  quoteNumber?: string
  newStatus: string
  trackingNumber?: string
  trackingUrl?: string
  carrier?: string
}

interface MilestoneCopy {
  subject: string
  heading: string
  intro: string
  preheader: string
}

/**
 * Subject / heading / intro / preheader keyed on the milestone. `safeRef` is
 * already HTML-escaped for interpolation into `intro`; `subject` and `preheader`
 * are plain text.
 */
function milestoneCopy(newStatus: string, ref: string, safeRef: string): MilestoneCopy {
  if (newStatus === 'in-production') {
    return {
      subject: `Your order is in production — ${ref}`,
      heading: 'Your order is in production',
      intro: `Good news — your order <strong style="color:${INK};font-weight:700;">${safeRef}</strong> is now in production. We&rsquo;ll let you know the moment it ships.`,
      preheader: 'Your order is in production.',
    }
  }
  if (newStatus === 'dispatched') {
    return {
      subject: `Your order has shipped — ${ref}`,
      heading: 'Your order has shipped',
      intro: `Great news — your order <strong style="color:${INK};font-weight:700;">${safeRef}</strong> is on its way.`,
      preheader: 'Your order has shipped.',
    }
  }
  const statusLabel = getStatusLabel(newStatus)
  return {
    subject: `Order update: ${statusLabel} — ${ref}`,
    heading: 'Your order status has changed',
    intro: `Kia ora — your order is now <strong style="color:${INK};font-weight:700;">${escapeHtml(statusLabel)}</strong>. Follow the tracker any time to see the latest.`,
    preheader: `Your order is now ${statusLabel}.`,
  }
}

/**
 * Send a milestone status email for a job tracker.
 */
export async function sendTrackerStatusEmail(
  params: TrackerEmailParams
): Promise<{ success: boolean; error?: string }> {
  const trackerUrl = `${PORTAL_ORIGIN}/order-tracker/${params.trackerToken}`
  const ref = params.quoteNumber || params.jobReference

  const safeUrl = escapeHtml(trackerUrl)
  const safeRef = escapeHtml(ref)

  const copy = milestoneCopy(params.newStatus, ref, safeRef)
  const subject = copy.subject

  // Job reference sub-line, shown when the quote number is the headline reference.
  const subLine =
    params.quoteNumber && params.jobReference && params.quoteNumber !== params.jobReference
      ? `<p style="margin:0 0 24px;font-family:${BRAND_FONT};font-size:13px;line-height:1.5;color:${BODY};">Job reference: <strong style="color:${INK};">${escapeHtml(params.jobReference)}</strong></p>`
      : ''

  const hasTracking = Boolean(params.trackingNumber || params.trackingUrl)

  const trackingPanel = hasTracking
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 0;background-color:${SURFACE};border-radius:12px;">
              <tr>
                <td style="padding:18px 20px;font-family:${BRAND_FONT};font-size:14px;line-height:1.7;color:${BODY};">
                  <div style="${LABEL_STYLE}margin:0 0 8px;">Tracking</div>
                  ${params.trackingNumber ? `<div>Tracking number: <strong style="color:${INK};">${escapeHtml(params.trackingNumber)}</strong></div>` : ''}
                  ${params.carrier ? `<div>Carrier: <strong style="color:${INK};">${escapeHtml(params.carrier)}</strong></div>` : ''}
                  ${params.trackingUrl ? `<div style="margin-top:4px;"><a href="${escapeHtml(params.trackingUrl)}" class="b-link" style="color:${BRAND_ACCENT};text-decoration:underline;">Track with carrier &rarr;</a></div>` : ''}
                </td>
              </tr>
            </table>`
    : ''

  // Dispatched but no tracking resolved yet → tell the customer it will follow.
  const trackingFollowNote =
    params.newStatus === 'dispatched' && !hasTracking
      ? `<p style="margin:22px 0 0;font-family:${BRAND_FONT};font-size:14px;line-height:1.65;color:${BODY};">Your tracking details will follow shortly — we&rsquo;ll send them through as soon as they&rsquo;re available.</p>`
      : ''

  const body = `
            <h1 class="b-h1" style="margin:0 0 18px;font-family:${BRAND_FONT};font-size:30px;line-height:1.12;font-weight:700;letter-spacing:-0.02em;color:${INK};">${copy.heading}</h1>

            <p style="margin:0 0 4px;${LABEL_STYLE}text-transform:none;">Your Reference</p>
            <p style="margin:0 0 ${subLine ? 6 : 24}px;font-family:${BRAND_MONO};font-size:18px;font-weight:700;letter-spacing:0.02em;color:${BRAND_ACCENT};">${safeRef}</p>${subLine}

            <p style="margin:0 0 26px;font-family:${BRAND_FONT};font-size:15px;line-height:1.65;color:${BODY};">${copy.intro}</p>

            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 14px;">
              <tr>
                <td align="center" style="border-radius:9999px;background-color:${BRAND_ACCENT};">
                  <a href="${safeUrl}" target="_blank" style="display:inline-block;background-color:${BRAND_ACCENT};color:#ffffff;border-radius:9999px;padding:15px 34px;font-family:${BRAND_FONT};font-size:15px;font-weight:700;letter-spacing:0.01em;text-decoration:none;">View order tracker</a>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 6px;font-family:${BRAND_FONT};font-size:12px;line-height:1.6;color:${MUTED};">If the button doesn&rsquo;t work, copy and paste this link into your browser:</p>
            <p style="margin:0 0 8px;font-family:${BRAND_MONO};font-size:12px;line-height:1.5;word-break:break-all;"><a href="${safeUrl}" class="b-link" style="color:${BRAND_ACCENT};text-decoration:underline;">${safeUrl}</a></p>
            ${trackingPanel}${trackingFollowNote}
            <p style="margin:22px 0 0;font-family:${BRAND_FONT};font-size:14px;line-height:1.65;color:${BODY};">Questions? Please contact your account manager.</p>

            <p style="margin:30px 0 0;font-family:${BRAND_FONT};font-size:15px;line-height:1.65;color:${BODY};">Thanks,<br/><span style="color:${INK};font-weight:700;">The Print Room team</span></p>`

  const html = wrapBrandedEmail(subject, body, {
    preheader: copy.preheader,
  })

  const introText =
    params.newStatus === 'in-production'
      ? `Your order ${ref} is now in production. We'll let you know the moment it ships.`
      : params.newStatus === 'dispatched'
        ? `Your order ${ref} is on its way.`
        : `Your order is now ${getStatusLabel(params.newStatus)}. Follow the tracker any time to see the latest.`

  const text = `${subject}

Kia ora,

${introText}

Your reference: ${ref}
${params.quoteNumber && params.jobReference && params.quoteNumber !== params.jobReference ? `Job reference: ${params.jobReference}\n` : ''}${params.trackingNumber ? `Tracking number: ${params.trackingNumber}\n` : ''}${params.carrier ? `Carrier: ${params.carrier}\n` : ''}${params.trackingUrl ? `Tracking: ${params.trackingUrl}\n` : ''}${params.newStatus === 'dispatched' && !hasTracking ? `Tracking details will follow shortly.\n` : ''}
View order tracker: ${trackerUrl}

Questions? Please contact your account manager.

Thanks,
The Print Room team`

  return sendEmail({ to: params.contactEmail, subject, html, text })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/email/__tests__/tracker-notification.test.ts`
Expected: PASS — the existing CTA-URL test plus the three new milestone-copy tests all green.

- [ ] **Step 5: Commit**

```bash
git add lib/email/tracker-notification.ts lib/email/__tests__/tracker-notification.test.ts
git commit -m "feat: two-case milestone email copy (in-production / shipped + tracking)"
```

---

### Task 5: Wire the milestone gate into the webhook (`app/api/webhooks/monday/tracker-status/route.ts`)

**Files:**
- Modify: `app/api/webhooks/monday/tracker-status/route.ts` (imports + the `after()` email block)
- Test: `app/api/webhooks/monday/tracker-status/__tests__/route.test.ts` (add mocks, fix one test, add three describes)

**Interfaces:**
- Consumes: `milestoneForLabel`, `milestoneEmailType` (Task 1); `fetchCustomerTrackingUrl` (Task 2); `isTrackerTestOrg` (Task 3); existing `sendTrackerStatusEmail`, `hasEmailBeenSent`, `recordEmailSend`, `getTrackingNumber`, `detectCarrierFromUrl`, `TrackingInfo`.
- Produces: no exported API change — only the `after()` side-effect behaviour changes (label-gated milestone email; dispatched tracking from Monday; test-org suppression; stable de-dup key).

- [ ] **Step 1: Write the failing tests**

In `app/api/webhooks/monday/tracker-status/__tests__/route.test.ts`:

**(1a)** Add two new mock blocks (place them alongside the other `vi.mock` calls, before `import { POST } from '../route'`):

```ts
const fetchCustomerTrackingUrl = vi.fn<(id: string) => Promise<string | null>>(
  () => Promise.resolve('https://www.nzpost.co.nz/tools/tracking/item/AB123456789NZ')
)
vi.mock('@/lib/monday/tracking-link', () => ({
  fetchCustomerTrackingUrl: (id: string) => fetchCustomerTrackingUrl(id),
}))

const isTrackerTestOrg = vi.fn(() => Promise.resolve(false))
vi.mock('@/lib/orders/tracker-test-org', () => ({
  isTrackerTestOrg: (...a: unknown[]) => isTrackerTestOrg(...(a as [])),
}))
```

**(1b)** Extend `beforeEach` (add these two lines to the existing block):

```ts
  fetchCustomerTrackingUrl.mockResolvedValue('https://www.nzpost.co.nz/tools/tracking/item/AB123456789NZ')
  isTrackerTestOrg.mockResolvedValue(false)
```

**(1c)** In `describe('tracker-status route — email de-dup', ...)`: the `statusEvent()` default is "Assign to Production", so the first test ("same event redelivered (hasEmailBeenSent true) → no second email") stays valid — leave it. **Delete** the second test, `it('genuine re-entry with a NEW trigger time → re-emails', ...)` — under once-ever milestone semantics a proof-sent label no longer emails at all. Replace it with:

```ts
  it('asserts the STABLE milestone de-dup key (once ever, not per trigger time)', async () => {
    await post(statusEvent()) // Assign to Production -> in-production
    await flushAfter()
    expect(hasEmailBeenSent).toHaveBeenCalledWith(
      expect.anything(),
      { mondayItemId: '555', emailType: 'milestone-in-production' }
    )
    expect(recordEmailSend).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ emailType: 'milestone-in-production' })
    )
  })
```

**(1d)** Add a new describe block for the gate:

```ts
describe('tracker-status route — milestone email gate', () => {
  it('All Production Complete → in-production email', async () => {
    trackerRow.current = baseTracker({ status: 'proof-approved' })
    await post(statusEvent({ value: { label: { index: 9, text: 'All Production Complete' } } }))
    await flushAfter()
    expect(sendTrackerStatusEmail).toHaveBeenCalledTimes(1)
    expect(sendTrackerStatusEmail.mock.calls[0][0]).toMatchObject({ newStatus: 'in-production' })
  })

  it('Shipped → dispatched email with tracking read from the Monday item', async () => {
    trackerRow.current = baseTracker({ status: 'in-production' })
    await post(statusEvent({ value: { label: { index: 22, text: 'Shipped' } } }))
    await flushAfter()
    expect(fetchCustomerTrackingUrl).toHaveBeenCalledWith('555')
    expect(sendTrackerStatusEmail).toHaveBeenCalledTimes(1)
    expect(sendTrackerStatusEmail.mock.calls[0][0]).toMatchObject({
      newStatus: 'dispatched',
      trackingUrl: 'https://www.nzpost.co.nz/tools/tracking/item/AB123456789NZ',
      carrier: 'NZ Post',
    })
  })

  it('Shipped with no Monday tracking → still sends dispatched (tracking to follow)', async () => {
    trackerRow.current = baseTracker({ status: 'in-production', tracking_info: {} })
    fetchCustomerTrackingUrl.mockResolvedValue(null)
    await post(statusEvent({ value: { label: { index: 22, text: 'Shipped' } } }))
    await flushAfter()
    expect(sendTrackerStatusEmail).toHaveBeenCalledTimes(1)
    const arg = sendTrackerStatusEmail.mock.calls[0][0] as { newStatus: string; trackingUrl?: string }
    expect(arg.newStatus).toBe('dispatched')
    expect(arg.trackingUrl).toBeUndefined()
  })

  it('Partially Shipped → advances the tracker but sends NO email', async () => {
    trackerRow.current = baseTracker({ status: 'proof-approved' })
    await post(statusEvent({ value: { label: { index: 30, text: 'Partially Shipped' } } }))
    expect(supaUpdates).toHaveLength(1) // status still advances (canonical in-production)
    expect(supaUpdates[0].set.status).toBe('in-production')
    await flushAfter()
    expect(sendTrackerStatusEmail).not.toHaveBeenCalled()
  })

  it('Closed Job → advances to dispatched but sends NO email', async () => {
    trackerRow.current = baseTracker({ status: 'in-production' })
    await post(statusEvent({ value: { label: { index: 40, text: 'Closed Job' } } }))
    expect(supaUpdates).toHaveLength(1)
    expect(supaUpdates[0].set.status).toBe('dispatched')
    await flushAfter()
    expect(sendTrackerStatusEmail).not.toHaveBeenCalled()
  })

  it('Proof Sent (Sent: Proof+Invoice/Quote) → advances but sends NO email', async () => {
    trackerRow.current = baseTracker({ status: 'need-proof' })
    await post(statusEvent({ value: { label: { index: 3, text: 'Sent: Proof+Invoice/Quote' } } }))
    expect(supaUpdates).toHaveLength(1)
    expect(supaUpdates[0].set.status).toBe('proof-sent')
    await flushAfter()
    expect(sendTrackerStatusEmail).not.toHaveBeenCalled()
  })
})
```

**(1e)** Add a test-org suppression describe block:

```ts
describe('tracker-status route — test-org suppression', () => {
  it('a test org gets NO milestone email (status still advances)', async () => {
    isTrackerTestOrg.mockResolvedValue(true)
    trackerRow.current = baseTracker({ status: 'in-production' })
    await post(statusEvent({ value: { label: { index: 22, text: 'Shipped' } } }))
    expect(supaUpdates).toHaveLength(1) // advanced to dispatched
    await flushAfter()
    expect(sendTrackerStatusEmail).not.toHaveBeenCalled()
    expect(recordEmailSend).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the route tests to verify they fail**

Run: `npx vitest run app/api/webhooks/monday/tracker-status/__tests__/route.test.ts`
Expected: FAIL — the new `@/lib/monday/tracking-link` / `@/lib/orders/tracker-test-org` mocks reference modules the route does not import yet, and the route still emails on proof-sent / Closed Job / Partially Shipped (so the "NO email" assertions fail). The stable-key assertion fails because the route still calls `statusEmailType`.

- [ ] **Step 3: Update the route imports**

In `app/api/webhooks/monday/tracker-status/route.ts`:

(a) Change the `tracker-email-log` import (drop `statusEmailType`):

```ts
import {
  hasEmailBeenSent,
  recordEmailSend,
  statusEmailType,
} from '@/lib/email/tracker-email-log'
```

to

```ts
import {
  hasEmailBeenSent,
  recordEmailSend,
} from '@/lib/email/tracker-email-log'
```

(b) Add three imports (place after the `tracker-notification` import near the top of the file):

```ts
import { milestoneForLabel, milestoneEmailType } from '@/lib/email/milestone-email'
import { fetchCustomerTrackingUrl } from '@/lib/monday/tracking-link'
import { isTrackerTestOrg } from '@/lib/orders/tracker-test-org'
```

- [ ] **Step 4: Replace the `after()` email block**

In `handleTrackerStatusChange`, replace this block (currently the `if (tracker.customer_email) { ... }` inside `after(async () => {`):

```ts
    if (tracker.customer_email) {
      const emailType = statusEmailType(canonicalKey, event.triggerTime)
      const already = await hasEmailBeenSent(supabase, { mondayItemId, emailType })
      if (!already) {
        const trackingInfo = (tracker.tracking_info as TrackingInfo | null) ?? null
        const trackingUrl = trackingInfo?.url || null
        const carrier = trackingUrl ? detectCarrierFromUrl(trackingUrl) : null
        const result = await sendTrackerStatusEmail({
          contactEmail: tracker.customer_email,
          trackerToken: tracker.tracker_token,
          jobReference: tracker.job_reference,
          quoteNumber: tracker.quote_number || undefined,
          newStatus: canonicalKey,
          trackingNumber: getTrackingNumber(trackingInfo),
          trackingUrl: trackingUrl || undefined,
          carrier: carrier || undefined,
        })
        await recordEmailSend(supabase, {
          mondayItemId,
          trackerToken: tracker.tracker_token,
          customerEmail: tracker.customer_email,
          emailType,
          emailSent: result.success,
          errorMessage: result.error,
          triggerType: 'automatic',
        })
      }
    }
```

with:

```ts
    // Customer milestone email — gated on the RAW Monday label (not the coarse
    // canonical status): only "in production" and "shipped" push. Every other
    // customer-facing transition updates the tracker silently (pull-only).
    const milestone = tracker.customer_email ? milestoneForLabel(displayLabel) : null
    if (milestone) {
      const emailType = milestoneEmailType(milestone)
      const already = await hasEmailBeenSent(supabase, { mondayItemId, emailType })
      // Only pay for the is_test lookup when we are actually about to send.
      const suppressed = already || (await isTrackerTestOrg(supabase, tracker.quote_id))
      if (!suppressed) {
        // Dispatched tracking is read from the Monday item (poller-independent);
        // in-production carries no tracking. Precedence: customer link column →
        // legacy tracking_info → none (email sends with "tracking to follow").
        let trackingUrl: string | undefined
        let trackingNumber: string | undefined
        if (milestone === 'dispatched') {
          const fromMonday = await fetchCustomerTrackingUrl(mondayItemId)
          const legacy = (tracker.tracking_info as TrackingInfo | null)?.url ?? null
          trackingUrl = fromMonday || legacy || undefined
          trackingNumber = trackingUrl ? getTrackingNumber({ number: trackingUrl }) : undefined
        }
        const carrier = trackingUrl ? detectCarrierFromUrl(trackingUrl) ?? undefined : undefined

        const result = await sendTrackerStatusEmail({
          contactEmail: tracker.customer_email as string,
          trackerToken: tracker.tracker_token,
          jobReference: tracker.job_reference,
          quoteNumber: tracker.quote_number || undefined,
          newStatus: milestone,
          trackingNumber,
          trackingUrl,
          carrier,
        })
        await recordEmailSend(supabase, {
          mondayItemId,
          trackerToken: tracker.tracker_token,
          customerEmail: tracker.customer_email,
          emailType,
          emailSent: result.success,
          errorMessage: result.error,
          triggerType: 'automatic',
        })
      }
    }
```

(The `if (tracker.quote_id) { await mirrorStatusToQuote(...) }` block that follows stays exactly as-is.)

- [ ] **Step 5: Run the route tests to verify they pass**

Run: `npx vitest run app/api/webhooks/monday/tracker-status/__tests__/route.test.ts`
Expected: PASS — all describes green, including the pre-existing "customer-facing transition", "non-advancing statuses", "idempotency (gap c)", "auth", and "provisioning" blocks (Assign to Production still emails in-production; production_start_at still stamped).

- [ ] **Step 6: Commit**

```bash
git add app/api/webhooks/monday/tracker-status/route.ts app/api/webhooks/monday/tracker-status/__tests__/route.test.ts
git commit -m "feat: label-gated milestone emails + Monday tracking + test-org guard in tracker webhook"
```

---

### Task 6: Remove the dead `statusEmailType` (`lib/email/tracker-email-log.ts`)

**Files:**
- Modify: `lib/email/tracker-email-log.ts`
- Test: `lib/email/__tests__/tracker-email-log.test.ts` (prune)

**Interfaces:**
- Removes: `statusEmailType` (its per-transition, trigger-time-keyed behaviour is replaced by `milestoneEmailType` from Task 1).
- Unchanged: `hasEmailBeenSent`, `recordEmailSend`.

**Why now (must follow Task 5):** `statusEmailType`'s only caller was the webhook (confirmed: `grep -rn statusEmailType lib app` → route.ts import + call, plus this module and its test). Task 5 repointed the route to `milestoneEmailType` and dropped the `statusEmailType` import, so as of Task 5 the function is dead. Removing it any earlier would leave the route importing a non-existent export. Remove it now.

- [ ] **Step 1: Prune the test file first (make the intent-to-remove explicit)**

In `lib/email/__tests__/tracker-email-log.test.ts`:

1. Change the import line

```ts
import { statusEmailType, hasEmailBeenSent, recordEmailSend } from '../tracker-email-log'
```

to

```ts
import { hasEmailBeenSent, recordEmailSend } from '../tracker-email-log'
```

2. Delete the entire `describe('statusEmailType', () => { ... })` block (the three `it` cases). Keep the `hasEmailBeenSent` and `recordEmailSend` describes unchanged.

- [ ] **Step 2: Run the pruned test to verify it stays green**

Run: `npx vitest run lib/email/__tests__/tracker-email-log.test.ts`
Expected: PASS — the `statusEmailType` cases are gone; `hasEmailBeenSent`/`recordEmailSend` cases still pass. (The function `statusEmailType` still exists in the module at this point but is no longer imported anywhere — the route dropped it in Task 5.)

- [ ] **Step 3: Remove `statusEmailType` from the module + fix the doc comment**

In `lib/email/tracker-email-log.ts`:

(a) Delete this block (the function and its doc comment):

```ts
/**
 * Build the de-dup key for a status-update email. `status_update:<key>:<epochMs>`.
 * `epochMs` is 0 when the trigger time is missing/unparseable — the (rare)
 * fallback still de-dups within a single delivery via the handler's fast-path.
 */
export function statusEmailType(canonicalKey: string, triggerTime: string | null | undefined): string {
  const epoch = triggerTime ? Date.parse(triggerTime) : NaN
  return `status_update:${canonicalKey}:${Number.isNaN(epoch) ? 0 : epoch}`
}
```

(b) Replace the "De-dup semantics" paragraph in the file's top doc comment:

```
 * De-dup semantics = per-transition idempotent (spec §C, decision 2): the email
 * type encodes the canonical stage AND the Monday event's trigger-time epoch,
 * which is stable across Monday's at-least-once re-delivery of the SAME event
 * (so a retry does not re-email) but changes on a genuine re-entry to a stage
 * (e.g. proof-sent → need-proof → proof-sent after a revision — which re-emails).
```

with:

```
 * De-dup semantics = idempotent on a caller-supplied `email_type` key, on
 * `(monday_item_id, email_type)`. Milestone emails pass a STABLE key
 * (`milestone-in-production` / `milestone-dispatched`, see
 * `lib/email/milestone-email.ts`) so each milestone lands once ever — even
 * across a hold/rework re-entry or Monday's at-least-once re-delivery.
```

- [ ] **Step 4: Run the module test again to confirm green after removal**

Run: `npx vitest run lib/email/__tests__/tracker-email-log.test.ts`
Expected: PASS (only `hasEmailBeenSent` / `recordEmailSend` cases remain).

- [ ] **Step 5: Commit**

```bash
git add lib/email/tracker-email-log.ts lib/email/__tests__/tracker-email-log.test.ts
git commit -m "refactor: drop dead statusEmailType (replaced by stable milestone key)"
```

---

### Task 7: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: exit 0, 0 failures. (Pay attention to the six touched/created test files plus any that import the changed modules.)

- [ ] **Step 2: Type-check the touched files**

Run: `npx tsc --noEmit`
Expected: no NEW errors introduced by the six changed/created files. If `tsc` reports a pre-existing baseline of unrelated errors, confirm none of them name: `lib/email/milestone-email.ts`, `lib/monday/tracking-link.ts`, `lib/orders/tracker-test-org.ts`, `lib/email/tracker-notification.ts`, `lib/email/tracker-email-log.ts`, `app/api/webhooks/monday/tracker-status/route.ts`.

- [ ] **Step 3: Lint the touched files**

Run: `npx eslint lib/email/milestone-email.ts lib/monday/tracking-link.ts lib/orders/tracker-test-org.ts lib/email/tracker-notification.ts lib/email/tracker-email-log.ts app/api/webhooks/monday/tracker-status/route.ts`
Expected: 0 errors.

- [ ] **Step 4: Confirm no stray `statusEmailType` references remain**

Run: `grep -rn "statusEmailType" lib app`
Expected: no output (all references removed).

---

## Deploy preconditions (operational, HITL — Jon, not code)

This feature rides the paused Phase 2 cutover; it is inert until Jon:

1. Sets `MONDAY_WEBHOOK_SECRET` on the portal.
2. Un-filters the Monday Job-Status subscription from "Shipped-only" so it also delivers the production labels.
3. Turns on the studio poller kill-switch (`STUDIO_TRACKER_WEBHOOKS_DISABLED`) so the portal is the sole sender.

**Verify before enabling (from the spec):** confirm the studio kill-switch disables only the status/email path and NOT the Starshipit → `link_mky1w9w` write-back. If the kill-switch also stops the link write-back, the dispatched email will fall back to "tracking to follow" until Phase 4 wires Starshipit into the portal.

## Deviations from the spec (for Jon's sign-off)

1. **Supplier tracking link excluded.** Spec §3 listed `link_mkqz77w0` (Supplier Tracking Link) as tracking precedence #2 for the customer email. `lib/monday/column-ids.ts:52` documents that column as inbound-blanks tracking that "must never be exposed to customers." The plan reads ONLY `link_mky1w9w` (Customer Tracker Link), then legacy `tracking_info`, then "tracking to follow." If Jon confirms the supplier column really does hold a customer-facing courier URL on some items, add it back as precedence #2 in `fetchCustomerTrackingUrl`.
2. **`statusEmailType` removed rather than repurposed.** Spec §4 framed this as "change `statusEmailType` to return stable milestone keys." Because the gate must key on the raw Monday *label* (canonical `in-production`/`dispatched` are too coarse — they include Partially Shipped / Closed Job / Ready to Pickup), the milestone logic lives in the new pure `lib/email/milestone-email.ts`, and `statusEmailType` becomes dead and is removed. Same outcome (stable once-ever keys), cleaner seam.
