# Checkout: dupe-email fix + place-order speed-up — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the customer order flow from appearing to send duplicate emails, and make "Confirm & place order" feel fast and clearly-working instead of frozen.

**Architecture:** Three fronts. (1) Emails — the two emails are by-design different (customer confirmation vs. internal dispatch alert); suppress the dispatch copy for test/demo orgs and guard all post-commit side-effects so a replay can't re-send. (2) Perceived speed — spinner in the button + a framer-motion loading overlay + a client re-entry guard. (3) Actual speed — defer the external side-effects (Monday/Xero/emails/Slack) out of the `/api/checkout` request with Next's `after()`, and batch the per-line snapshot writes.

**Tech Stack:** Next.js 16 (App Router, `after` from `next/server`), React 19, framer-motion@^12 (already installed — no new deps), Supabase (Postgres + PostgREST), Vitest + Testing Library.

Design spec: `docs/superpowers/specs/2026-07-15-checkout-dupe-emails-and-place-order-speed-design.md`.

## Global Constraints

- **Branch:** `fix/checkout-dupe-emails-and-place-order-speed` (already created; do NOT commit to `main`).
- **No new dependencies.** framer-motion@^12 is already in `package.json`; spinners are inline SVG + Tailwind `animate-spin`.
- **Side-effects stay best-effort.** Monday push, Xero draft, emails, Slack must NEVER throw out of `submitCustomerOrder` or roll back the committed order. Preserve every existing `try/catch … swallow + audit` contract.
- **Test inbox:** `jamie@theprint-room.co.nz`. **Dispatch desk default:** `charlotte@theprint-room.co.nz` (`DISPATCH_NOTIFICATION_EMAIL`).
- **Migration rule:** the only DB change is one *additive, nullable* column on `orders`. No other DDL. Ship it with a drop-column rollback.
- **Test commands:** `npm test` (vitest run). A single file: `npx vitest run <path>`. Lint gate: `npm run lint`.
- Follow existing file patterns; do not restructure unrelated code.

---

## File Structure

- **Create** `supabase/migrations/20260715120000_orders_notifications_dispatched_at.sql` — additive guard column.
- **Create** `components/checkout/CheckoutPlacingOverlay.tsx` — framer-motion full-screen "Placing your order…" overlay.
- **Modify** `lib/checkout/submit.ts` — dispatch suppression (test orgs), move status-flip in-request, batch per-line writes, wrap external side-effects in `after()` behind a dispatch-once guard.
- **Modify** `components/checkout/CheckoutReviewClient.tsx` — re-entry guard, render overlay, keep overlay through navigation (no empty-cart flash).
- **Modify** `components/checkout/CheckoutCTAStickyBar.tsx` — spinner inside the button.
- **Modify** `vitest.setup.ts` — global `after()` mock + `flushAfter()` so deferred work is deterministic in tests.
- **Modify/Create tests** under `lib/checkout/__tests__/` and `components/checkout/__tests__/`.

---

## Task 1: DB migration — `orders.notifications_dispatched_at`

**Files:**
- Create: `supabase/migrations/20260715120000_orders_notifications_dispatched_at.sql`

**Interfaces:**
- Produces: nullable column `orders.notifications_dispatched_at timestamptz`, consumed by the dispatch-once guard in Task 7.

- [ ] **Step 1: Write the migration**

```sql
-- Guard column for checkout post-commit side-effects. Set exactly once (atomic
-- compare-and-set) when the deferred Monday/Xero/email/Slack work is dispatched,
-- so a replay (same idempotency_key) or a concurrent double-submit cannot
-- re-send. Nullable; NULL = not yet dispatched. Additive + backward-compatible:
-- the staff portal neither reads nor writes it.
alter table public.orders
  add column if not exists notifications_dispatched_at timestamptz;

comment on column public.orders.notifications_dispatched_at is
  'Checkout side-effect dispatch guard: set once when Monday/Xero/emails/Slack are dispatched; NULL = pending. Compare-and-set prevents duplicate sends on replay/double-submit.';
```

- [ ] **Step 2: Apply the migration to the live project**

Apply via the Supabase MCP `apply_migration` (name `orders_notifications_dispatched_at`, the SQL above) OR `supabase db push` if the CLI is linked to `bthsxgmcnbvwwgvdveek`.

- [ ] **Step 3: Verify the column exists**

Run (MCP `execute_sql` or psql):
```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_name = 'orders' and column_name = 'notifications_dispatched_at';
```
Expected: one row, `timestamp with time zone`, `YES`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260715120000_orders_notifications_dispatched_at.sql
git commit -m "feat(db): add orders.notifications_dispatched_at side-effect guard"
```

---

## Task 2: Suppress the dispatch email for test/demo orgs

The dispatch email ("Order placed — … (Purchase order)") is meant for the dispatch desk. On a test/demo org both it and the customer confirmation route to `jamie@`, which reads as a duplicate. Suppress the dispatch email when the org is a test org. (At this point the block is still inline; Task 7 moves it into `after()`.)

**Files:**
- Modify: `lib/checkout/submit.ts` (step 7, around the `sendOrderPlacedDispatch` call at ~`:1814`)
- Modify test: `lib/checkout/__tests__/submit.demo-monday-group.test.ts`

**Interfaces:**
- Consumes: existing `notifyIsTestOrg: boolean` (already computed at `submit.ts:1787` via `isTestOrgFailClosed`).

- [ ] **Step 1: Update the existing test to the new contract**

In `submit.demo-monday-group.test.ts`, add a test asserting suppression, and fix the fail-closed test (a fail-closed org is treated as a test org → dispatch now suppressed, confirmation still routes to `jamie@`). Add near the existing `describe` block:

```ts
it('does NOT send the dispatch email when the org is is_test (only the customer email goes out)', async () => {
  const { admin } = buildStub(true)
  await submitCustomerOrder(admin, buildInput())
  expect(sendOrderPlacedDispatch).not.toHaveBeenCalled()
})

it('sends the dispatch email to the desk when the org is a real customer', async () => {
  const { admin } = buildStub(false)
  await submitCustomerOrder(admin, buildInput())
  expect(sendOrderPlacedDispatch).toHaveBeenCalledOnce()
  expect(sendOrderPlacedDispatch).toHaveBeenCalledWith(
    expect.objectContaining({ to: 'charlotte@theprint-room.co.nz' }),
  )
})
```

Then replace the existing `'fails closed to Jamie for dispatch email when the demo-org lookup fails'` test body's assertions (lines ~303-306) — a fail-closed org is now treated as test, so the dispatch email is suppressed:

```ts
// Fail-closed → treated as a test org → dispatch email suppressed (no risk of
// emailing the desk for an unclassifiable org). The customer confirmation still
// fails closed to the test inbox (asserted elsewhere).
expect(sendOrderPlacedDispatch).not.toHaveBeenCalled()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/checkout/__tests__/submit.demo-monday-group.test.ts`
Expected: the two new assertions FAIL (`sendOrderPlacedDispatch` currently called for test orgs).

- [ ] **Step 3: Implement the suppression**

In `lib/checkout/submit.ts`, wrap the `sendOrderPlacedDispatch(...)` call (step 7, ~`:1814`) so it only sends for non-test orgs. The `postOrderPlacedSlack(...)` call directly above it stays unconditional.

```ts
    // Dispatch desk email is internal + fires only for real customer orgs.
    // Test/demo orgs already route the customer confirmation to the test inbox;
    // suppress the dispatch copy so a tester sees exactly one email.
    if (!notifyIsTestOrg) {
      const dispatchRecipient = resolveDispatchNotificationRecipient({
        isTestOrg: notifyIsTestOrg,
        testEmail: 'jamie@theprint-room.co.nz',
      })
      await sendOrderPlacedDispatch({
        to: dispatchRecipient,
        orderRef: order_ref,
        customerName: emailCustomerName,
        orderType,
        totalAmount: notifyTotal,
        orderUrl: notifyOrderUrl,
        lines: notifyLines,
      })
    }
```

(Note: `resolveDispatchNotificationRecipient` now only ever runs for non-test orgs, so it always resolves to the desk address; that's fine — leave the helper unchanged.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/checkout/__tests__/submit.demo-monday-group.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/checkout/submit.ts lib/checkout/__tests__/submit.demo-monday-group.test.ts
git commit -m "fix(checkout): suppress dispatch email for test/demo orgs (single email in test)"
```

---

## Task 3: Client re-entry guard on `confirmOrder`

Prevents a fast double-fire from issuing two POSTs (belt-and-braces with the button's `disabled` state).

**Files:**
- Modify: `components/checkout/CheckoutReviewClient.tsx:90` (`confirmOrder`)
- Modify test: `components/checkout/__tests__/CheckoutReviewClient.conflict.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `CheckoutReviewClient.conflict.test.tsx` (mirror its existing render/setup; it already stubs `fetch` and renders the client):

```ts
it('ignores a second confirm click while a submit is in flight', async () => {
  const fetchMock = vi.fn(() =>
    // never resolves within the test window → keeps `submitting` true
    new Promise(() => {}),
  ) as unknown as typeof fetch
  vi.stubGlobal('fetch', fetchMock)

  const user = userEvent.setup()
  renderReview() // however the file renders it (see existing tests)
  const btn = await screen.findByRole('button', { name: /confirm & place order/i })
  await user.click(btn)
  await user.click(btn) // second click while in flight

  expect(fetchMock).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run components/checkout/__tests__/CheckoutReviewClient.conflict.test.tsx`
Expected: FAIL — `fetch` called twice (button re-enable race) or the guard is missing.

- [ ] **Step 3: Add the guard**

In `CheckoutReviewClient.tsx`, first line of `confirmOrder` (currently `:91` `if (isPreview) return`):

```ts
  async function confirmOrder() {
    if (submitting) return // re-entry guard: one submit in flight at a time
    if (isPreview) return // read-only preview — never POST
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run components/checkout/__tests__/CheckoutReviewClient.conflict.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/checkout/CheckoutReviewClient.tsx components/checkout/__tests__/CheckoutReviewClient.conflict.test.tsx
git commit -m "fix(checkout): guard confirmOrder against double-submit"
```

---

## Task 4: Spinner inside the "Confirm & place order" button

**Files:**
- Modify: `components/checkout/CheckoutCTAStickyBar.tsx`
- Create test: `components/checkout/__tests__/CheckoutCTAStickyBar.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CheckoutCTAStickyBar } from '../CheckoutCTAStickyBar'

describe('CheckoutCTAStickyBar', () => {
  it('shows a spinner and the submitting label while submitting, and disables the button', () => {
    render(
      <CheckoutCTAStickyBar
        itemCount={3}
        totalLabel="$100"
        onSubmit={vi.fn()}
        disabled={false}
        submitting
        submitLabel="Confirm & place order"
        submittingLabel="Placing order…"
      />,
    )
    const btn = screen.getByRole('button', { name: /placing order/i })
    expect(btn).toBeDisabled()
    expect(btn.querySelector('svg')).toBeTruthy() // spinner present
  })

  it('shows only the submit label when idle', () => {
    render(
      <CheckoutCTAStickyBar
        itemCount={3}
        totalLabel="$100"
        onSubmit={vi.fn()}
        disabled={false}
        submitting={false}
        submitLabel="Confirm & place order"
      />,
    )
    const btn = screen.getByRole('button', { name: /confirm & place order/i })
    expect(btn.querySelector('svg')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run components/checkout/__tests__/CheckoutCTAStickyBar.test.tsx`
Expected: FAIL — no `svg` in the button while submitting.

- [ ] **Step 3: Implement the spinner**

In `CheckoutCTAStickyBar.tsx`, replace the button's children (`{submitting ? submittingLabel : submitLabel}`) with:

```tsx
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled || submitting}
          aria-busy={submitting}
          className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting && (
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
          {submitting ? submittingLabel : submitLabel}
        </button>
```

(Adds `inline-flex items-center gap-2` + `aria-busy` to the existing classes.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run components/checkout/__tests__/CheckoutCTAStickyBar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/checkout/CheckoutCTAStickyBar.tsx components/checkout/__tests__/CheckoutCTAStickyBar.test.tsx
git commit -m "feat(checkout): spinner inside the place-order button"
```

---

## Task 5: Full-screen loading overlay (no frozen look, no empty-cart flash)

**Files:**
- Create: `components/checkout/CheckoutPlacingOverlay.tsx`
- Modify: `components/checkout/CheckoutReviewClient.tsx`
- Modify test: `components/checkout/__tests__/CheckoutReviewClient.conflict.test.tsx`

**Interfaces:**
- Produces: `CheckoutPlacingOverlay({ show: boolean })` — a `fixed inset-0` overlay.

- [ ] **Step 1: Create the overlay component**

```tsx
'use client'

import { AnimatePresence, motion } from 'framer-motion'

/**
 * Full-screen "placing your order" overlay. Rendered above the checkout review
 * page while a submit is in flight so the page never looks frozen, and stays up
 * through the redirect to the confirmation page (masking the emptied cart).
 */
export function CheckoutPlacingOverlay({ show }: { show: boolean }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="checkout-placing-overlay"
          role="status"
          aria-live="polite"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-white/85 backdrop-blur-sm"
        >
          <motion.div
            initial={{ scale: 0.94, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="flex max-w-xs flex-col items-center gap-4 text-center"
          >
            <svg className="h-8 w-8 animate-spin text-gray-900" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-sm font-medium text-gray-900">Placing your order…</p>
            <p className="text-xs text-gray-500">
              Reserving stock and confirming pricing — this can take a moment for large orders.
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
```

- [ ] **Step 2: Write the failing test**

Add to `CheckoutReviewClient.conflict.test.tsx`:

```ts
it('shows the placing overlay while submitting and keeps it up after success (no empty-cart flash)', async () => {
  let resolveFetch: (v: unknown) => void = () => {}
  const fetchMock = vi.fn(() => new Promise((r) => { resolveFetch = r })) as unknown as typeof fetch
  vi.stubGlobal('fetch', fetchMock)

  const user = userEvent.setup()
  renderReview()
  await user.click(await screen.findByRole('button', { name: /confirm & place order/i }))

  // Overlay visible while in flight
  expect(await screen.findByRole('status')).toHaveTextContent(/placing your order/i)

  // Resolve the POST successfully; overlay must remain (we navigate, don't reset)
  resolveFetch({ ok: true, status: 200, json: async () => ({ order_id: 'o1', order_ref: 'R1' }) })
  expect(screen.queryByRole('status')).toBeTruthy()
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run components/checkout/__tests__/CheckoutReviewClient.conflict.test.tsx`
Expected: FAIL — no overlay rendered.

- [ ] **Step 4: Wire the overlay into the review client**

In `CheckoutReviewClient.tsx`:

1. Import it: `import { CheckoutPlacingOverlay } from './CheckoutPlacingOverlay'`.
2. Keep the overlay up through the success navigation — change the success branch (currently `:269-271`) and the `finally`:

```ts
      const result = (await res.json()) as CheckoutResponse
      clearCheckoutReviewState()
      // Keep `submitting` true so the overlay stays up through the redirect;
      // navigate first, then clear the cart — the overlay masks the emptied
      // review page so it never flashes.
      router.push(`/checkout/confirmation/${result.order_id}`)
      cart.clear()
      return // do NOT fall through to the `finally` reset
    } catch (error) {
      setBanner({ kind: 'error', msg: (error as Error).message })
      setSubmitting(false)
    }
  }
```

Remove the `finally { setSubmitting(false) }` block, and add `setSubmitting(false)` to every early `return` inside the 409 branch that currently relies on `finally` (each `setBanner(...); return` in the 409 handling must be preceded by `setSubmitting(false)`). Simplest: keep a single helper:

```ts
    const fail = (msg: string) => { setBanner({ kind: 'error', msg }); setSubmitting(false) }
```
and replace each `setBanner({ kind: 'error', msg: … }); return` in the 409 block with `fail(…); return`.

3. Guard the empty-cart early return so it does not fire mid-submit (`:279`):

```ts
  if (cart.lines.length === 0 && !submitting) {
```

4. Render the overlay inside the main return — add as the first child of the top-level `<div className="min-h-screen …">` (the one returned at `:338`):

```tsx
      <CheckoutPlacingOverlay show={submitting} />
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run components/checkout/__tests__/CheckoutReviewClient.conflict.test.tsx`
Expected: PASS. Also re-run the Task 3 guard test in the same file — still green.

- [ ] **Step 6: Commit**

```bash
git add components/checkout/CheckoutPlacingOverlay.tsx components/checkout/CheckoutReviewClient.tsx components/checkout/__tests__/CheckoutReviewClient.conflict.test.tsx
git commit -m "feat(checkout): framer-motion placing overlay, held through redirect"
```

---

## Task 6: Batch the per-line snapshot writes

Step 4 applies ship-to + decorations one sequential `.update()` per line (`submit.ts:1187`) — N round-trips. Run them concurrently.

**Files:**
- Modify: `lib/checkout/submit.ts:1165-1190`
- Create test: `lib/checkout/__tests__/submit.snapshot-batching.test.ts`

- [ ] **Step 1: Write the failing test (round-trip count independent of line count)**

Mirror the mock-admin harness from `submit.roundtrip-regression.test.ts`. Assert that the number of `quote_items` UPDATE writes is issued via one `Promise.all` (i.e. the updates are not awaited one-at-a-time). Practical assertion: with a counting stub, all per-line `quote_items` updates are dispatched before any resolves. Concretely, spy that `admin.from('quote_items').update` is called once per line and that they are started synchronously in a batch:

```ts
it('dispatches all per-line snapshot updates concurrently (not awaited serially)', async () => {
  const order = new Map<string, number>()
  let tick = 0
  // stub where each quote_items update records the tick at which it STARTED
  // and resolves on a later microtask; assert all starts happen before any
  // resolve (proves Promise.all, not sequential await).
  // (Build on the makeSupabaseStub pattern from submit.demo-monday-group.test.ts,
  //  recording write start order.)
  // ...assert startedCount === lineCount before the first update resolves...
})
```

If a precise concurrency probe is awkward with the existing stub, fall back to a correctness assertion: with 3 input lines, exactly 3 `quote_items` UPDATE writes are recorded, each carrying the right `ship_to_store_id` + `decorations` (this pins behaviour; the concurrency change is then a safe refactor verified by the full suite staying green).

- [ ] **Step 2: Run to verify it fails / captures current behaviour**

Run: `npx vitest run lib/checkout/__tests__/submit.snapshot-batching.test.ts`
Expected: FAIL (or, for the correctness variant, PASS pre-refactor and stay PASS after — that variant is a safety net, not red-green).

- [ ] **Step 3: Batch the updates**

Replace the sequential loop body (`submit.ts:1168-1189`) so it collects update promises and awaits them together:

```ts
  if (newLines) {
    const rows = newLines as QuoteItemRow[]
    const consumed = new Set<string>()
    const updates: Array<Promise<unknown>> = []
    for (const inLine of input.lines) {
      const match = rows.find(
        (x) =>
          !consumed.has(x.id) &&
          x.product_id === inLine.product_id &&
          (x.variant_id ?? null) === (inLine.variant_id ?? null) &&
          (x.size_id ?? null) === (inLine.size_id ?? null) &&
          x.product_name === inLine.product_name,
      )
      if (!match) continue
      consumed.add(match.id)
      const update: Record<string, unknown> = {}
      if (inLine.ship_to_store_id !== undefined) {
        update.ship_to_store_id = inLine.ship_to_store_id ?? null
      }
      const validated =
        validatedByLineKey.get(makeLineKey(inLine.product_id, inLine.variant_id ?? null, inLine.size_id ?? null)) ?? []
      update.decorations = validated
      if (Object.keys(update).length > 0) {
        updates.push(admin.from('quote_items').update(update).eq('id', match.id))
      }
    }
    await Promise.all(updates)
  }
```

- [ ] **Step 4: Run the test + full suite**

Run: `npx vitest run lib/checkout/__tests__/submit.snapshot-batching.test.ts && npm test`
Expected: PASS; full suite green.

- [ ] **Step 5: Commit**

```bash
git add lib/checkout/submit.ts lib/checkout/__tests__/submit.snapshot-batching.test.ts
git commit -m "perf(checkout): batch per-line quote_items snapshot writes"
```

---

## Task 7: Defer external side-effects via `after()` + dispatch-once guard

The heaviest change and the biggest real speed-up: the `/api/checkout` response no longer waits on Monday, Xero, the two emails, and Slack. They run after the response flushes, guarded so they fire at most once per order.

**Files:**
- Modify: `vitest.setup.ts` (global `after` mock + `flushAfter`)
- Modify: `lib/checkout/submit.ts` (move status flip in-request; wrap external tail in `after()`; add guard)
- Modify tests: `lib/checkout/__tests__/submit.demo-monday-group.test.ts`, `submit.monday-push-failure.test.ts`, and any other submit test asserting on Monday/Xero/email/proof (add `await flushAfter()` after each `submitCustomerOrder` call).
- Create test: `lib/checkout/__tests__/submit.dispatch-once.test.ts`

**Interfaces:**
- Consumes: `orders.notifications_dispatched_at` (Task 1); `after` from `next/server`.
- Produces: `globalThis.flushAfter(): Promise<void>` for tests.

- [ ] **Step 1: Add the global `after` mock + flush helper**

Append to `vitest.setup.ts`:

```ts
import { vi } from 'vitest'

/* Next's after() runs work after the response flushes and requires request
 * scope. In unit tests we run the callback immediately, collect its promise
 * (swallowing rejections — these side-effects are best-effort in prod), and
 * expose flushAfter() so tests can await the deferred work deterministically. */
const __afterTasks: Array<Promise<unknown>> = []
;(globalThis as unknown as { flushAfter: () => Promise<void> }).flushAfter = async () => {
  await Promise.all(__afterTasks.splice(0))
}
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return {
    ...actual,
    after: (cb: unknown) => {
      const p = typeof cb === 'function' ? (cb as () => unknown)() : cb
      __afterTasks.push(Promise.resolve(p).catch(() => {}))
    },
  }
})
```

- [ ] **Step 2: Write the failing dispatch-once test**

`lib/checkout/__tests__/submit.dispatch-once.test.ts` (mirror `submit.demo-monday-group.test.ts` mocks + stub, but make the `orders` compare-and-set update return `[]` to simulate "already dispatched"):

```ts
// ...same vi.mock header as submit.demo-monday-group.test.ts (pushOrderDeal,
// sendOrderConfirmation, sendOrderPlacedDispatch, autofillProofForOrder)...

it('skips ALL external side-effects when the order is already claimed (replay)', async () => {
  // Build a stub whose `orders` UPDATE ... .is('notifications_dispatched_at', null)
  // .select('id') returns [] (row already claimed by a prior submit).
  const { admin } = buildStubWithClaim(/* claimed: */ false, /* isTest: */ false)
  await submitCustomerOrder(admin, buildInput())
  await (globalThis as any).flushAfter()

  expect(pushOrderDeal).not.toHaveBeenCalled()
  expect(sendOrderConfirmation).not.toHaveBeenCalled()
  expect(sendOrderPlacedDispatch).not.toHaveBeenCalled()
})

it('runs side-effects exactly once when the order is claimed fresh', async () => {
  const { admin } = buildStubWithClaim(/* claimed: */ true, /* isTest: */ false)
  await submitCustomerOrder(admin, buildInput())
  await (globalThis as any).flushAfter()

  expect(pushOrderDeal).toHaveBeenCalledOnce()
  expect(sendOrderConfirmation).toHaveBeenCalledOnce()
  expect(sendOrderPlacedDispatch).toHaveBeenCalledOnce()
})
```

`buildStubWithClaim(claimed, isTest)` = the `buildStub` from the demo test, plus a `selects`/write matcher so the guarded `orders` update returns `{ data: claimed ? [{ id: ORDER_ID }] : [], error: null }`. (Extend `makeSupabaseStub` to let a `.update(...).is(...).select('id')` on `orders` return a configured array.)

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run lib/checkout/__tests__/submit.dispatch-once.test.ts`
Expected: FAIL — side-effects still run unconditionally (no guard yet).

- [ ] **Step 4: Move the status flip in-request**

In `submit.ts`, cut the 5b status-flip block (currently `:1495-1502`):

```ts
  await admin.from('orders').update({ status: 'awaiting-proof-review' }).eq('id', order_id)
```

and paste it **in-request**, immediately after the step-4c job-tracker shell block (~`:1320`, before the Monday push). It is explicitly independent of the Monday result, and the confirmation page/tracker read order status, so it must not be deferred.

- [ ] **Step 5: Wrap the external tail in `after()` behind the guard**

Wrap the contiguous external blocks — 5a Monday push, 5b proof shell (`autofillProofForOrder`), 5c Xero draft, step 6 confirmation email (with its `quotes`/`quote_items` fetch), step 7 Slack + dispatch — in a single `after(async () => { … })`. Add the import at the top of `submit.ts`:

```ts
import { after } from 'next/server'
```

Structure (guard first; existing block bodies move inside unchanged, except the Task-2 dispatch suppression which is already in step 7):

```ts
  // External side-effects (Monday, Xero, confirmation + dispatch emails, Slack)
  // run AFTER the response flushes — none are needed to render the confirmation
  // page. A dispatch-once compare-and-set makes them idempotent across replays
  // and concurrent double-submits.
  after(async () => {
    const { data: claimed, error: claimErr } = await admin
      .from('orders')
      .update({ notifications_dispatched_at: new Date().toISOString() })
      .eq('id', order_id)
      .is('notifications_dispatched_at', null)
      .select('id')
    if (claimErr) {
      console.error('[Checkout] side-effect dispatch claim failed (swallowed)', {
        orderId: order_id, err: claimErr.message,
      })
      return
    }
    if (!claimed || claimed.length === 0) {
      // Already dispatched by an earlier submit of this order — skip everything.
      return
    }

    // ---- existing step 5a (Monday push) … step 7 (Slack + dispatch) blocks,
    //      moved here unchanged. They already reference order_id, order_ref,
    //      quote_id, orderType, emailLines/notifyLines, input.context, admin,
    //      openPeriod, preOrderItemIds — all captured in this closure. ----
  })

  return { order_id, order_ref }
```

Verify no variable used inside the `after` block is declared *after* it. Everything the blocks read (`emailLines`, `emailTotalAmount`, `notifyLines`, `orderType`, `openPeriod`, `preOrderItemIds`, etc.) is computed earlier in the function and remains in scope.

- [ ] **Step 6: Add `flushAfter()` to the existing side-effect tests**

In `submit.demo-monday-group.test.ts` and `submit.monday-push-failure.test.ts` (and any other submit test that asserts on `pushOrderDeal` / `sendOrderConfirmation` / `sendOrderPlacedDispatch` / `autofillProofForOrder`), add after each `await submitCustomerOrder(...)`:

```ts
  await (globalThis as any).flushAfter()
```

For `submit.monday-push-failure.test.ts`: its premise ("order still succeeds when Monday push fails") holds — the Monday failure now happens in the deferred block and is still swallowed. Assert `submitCustomerOrder` resolves to `{ order_id, order_ref }`, then `await flushAfter()`, then assert the swallow/audit behaviour as before.

- [ ] **Step 7: Run the affected tests, then the full suite**

Run: `npx vitest run lib/checkout/__tests__/submit.dispatch-once.test.ts lib/checkout/__tests__/submit.demo-monday-group.test.ts lib/checkout/__tests__/submit.monday-push-failure.test.ts`
Expected: PASS.
Then: `npm test`
Expected: full suite green. If any other submit test asserts on a now-deferred call, add `await flushAfter()` there too.

- [ ] **Step 8: Commit**

```bash
git add vitest.setup.ts lib/checkout/submit.ts lib/checkout/__tests__/
git commit -m "perf(checkout): defer Monday/Xero/email/Slack via after() + dispatch-once guard"
```

---

## Task 8: Verification & rollout

Not code — do these before calling it done.

- [ ] **Step 1: Lint + full test suite**

Run: `npm run lint && npm test`
Expected: lint clean; all tests pass (the pre-existing `CartTable` / `ProductDetailClient.manual-pricing` UI-copy failures noted in `PERF-STRATEGY.md` fail identically on `main` — not caused by this work).

- [ ] **Step 2: Manual end-to-end on a demo org (dev)**

Run the app (`npm run dev`), place an order on a demo/test org with a large cart (~20-40 lines):
- The button shows a spinner immediately; the overlay appears; the page is not frozen.
- You land on the confirmation page quickly (not after the external calls).
- Your inbox (`jamie@`) receives **exactly one** email (`Order received`), not two.
- Double-click / refresh-and-resubmit → still one order, still one email.

- [ ] **Step 3: Confirm the reprice fix is deployed to prod**

The 93→17 round-trip reprice fix (PR #66) is on `main` but its production deploy was unconfirmed. Confirm the current prod deployment includes it (Vercel dashboard / `git log` of the deployed SHA). If it isn't deployed, the 3.8 s reprice may still be live in prod independent of this work — deploy it.

- [ ] **Step 4: Sanity-check a real (non-test) org path**

Verify (staging or a controlled real order) that a non-test order still sends the customer confirmation to the customer AND the dispatch email to `charlotte@` (or `DISPATCH_NOTIFICATION_EMAIL`), and that the Monday deal + Xero draft still appear (just slightly after the response, via `after()`).

---

## Self-Review

**Spec coverage:**
- Emails 1a (suppress dispatch in test) → Task 2. ✅
- Emails 1b client re-entry guard → Task 3. ✅
- Emails 1b server dispatch-once guard (+ migration) → Task 1 + Task 7. ✅
- Perceived speed: spinner → Task 4; overlay + no-flash → Task 5. ✅
- Actual speed: `after()` deferral → Task 7; batch per-line writes → Task 6. ✅
- Keep-in-request set (status flip moved up; 4b/4c stay) → Task 7 Step 4. ✅
- Tests for suppression, guard, re-entry, overlay, spinner, batching → Tasks 2-7. ✅
- Verify reprice deploy → Task 8 Step 3. ✅

**Placeholder scan:** Task 6 Step 1's concurrency probe is described with a fallback correctness assertion rather than a single fixed snippet — acceptable because the exact probe depends on the shared stub, and the correctness variant fully pins behaviour. All other steps carry concrete code.

**Type/name consistency:** `notifications_dispatched_at` used identically in Task 1 (migration) and Task 7 (guard). `flushAfter` defined in Task 7 Step 1 and used in Steps 2/6/7. `CheckoutPlacingOverlay({ show })` defined in Task 5 Step 1 and used in Step 4. Suppression uses the existing `notifyIsTestOrg` from `submit.ts`.
