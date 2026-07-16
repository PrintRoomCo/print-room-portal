# Checkout: fix duplicate order emails + speed up "Confirm & place order" — design

**Date:** 2026-07-15
**Branch:** `fix/checkout-dupe-emails-and-place-order-speed`
**Author:** Jon (via Claude)

## Summary

Two problems reported while testing the customer order flow (`print-room-portal`):

1. **"Duplicate" order emails.** Placing an order sends the customer *two* Resend
   emails that both show the order details — one whose subject ends `(Purchase
   order)`. Only one should reach the customer.
2. **Slow / frozen "Confirm & place order".** For large orders there is a long,
   stale-looking gap between pressing the button and the order processing. The
   button gives almost no feedback, so the page looks frozen.

Both are addressed below. Decisions taken with Jon (2026-07-15) are marked
**[decided]**.

---

## Part 1 — the "duplicate" emails

### What actually happens (root cause)

They are **two different emails**, not one email sent twice. Both are dispatched
from the post-commit tail of `submitCustomerOrder` (`lib/checkout/submit.ts`):

| # | Email | Subject | Built / sent | Recipient resolver |
|---|---|---|---|---|
| 1 | Order confirmation | `Order received - <REF>` | `lib/email/order-confirmation.ts:172`, sent at `submit.ts:1731` | `resolveOrderEmailRecipient` |
| 2 | Order-placed dispatch | `Order placed — <REF> (Purchase order)` | `lib/email/order-placed-dispatch.ts:113`, sent at `submit.ts:1814` | `resolveDispatchNotificationRecipient` |

Email #2 is **new** — added as "item 13" (commit `ab595a7`, wired into checkout
in `6350e5d`). Before it, only the confirmation went out. That is why the flow
"now" appears to double-send. The `(Purchase order)` suffix is its order-type
label (`order-placed-dispatch.ts:40`, `:113`).

The two emails go to **different recipients**, decided by whether the org is a
test/demo org (`organizations.is_test`):

- **Real customer org** — `resolveOrderEmailRecipient` returns the customer
  (`lib/checkout/order-email-recipient.ts`), `resolveDispatchNotificationRecipient`
  returns the dispatch desk `DISPATCH_NOTIFICATION_EMAIL` (default
  `charlotte@theprint-room.co.nz`, `lib/checkout/dispatch-notification-recipient.ts`).
  → the **customer receives exactly one email** (#1); the desk receives #2.
- **Test/demo org (`is_test = true`)** — *both* resolvers fall back to the test
  inbox `jamie@theprint-room.co.nz`. → the tester's inbox receives **both**.

So the "duplicate to the customer" is the **test-inbox collision**: because the
order was placed on a demo org, #1 and #2 both land at `jamie@`. On a real order
the customer already gets only one.

### Secondary vector — double-submit re-sends the side-effects

`quotes.idempotency_key` carries a **partial unique index**
(`idx_quotes_idempotency_key`, `UNIQUE … WHERE idempotency_key IS NOT NULL`) and
the `submit_b2b_order` RPC dedupes on it, so **a double-submit can never create
two orders** (the second insert either finds the existing order and returns it,
or hits the unique violation). *However*, `submit.ts` runs its post-commit
side-effects (Monday, Xero, both emails, Slack) **unconditionally after the RPC
returns — even on an idempotent replay** — and `confirmOrder` has no re-entry
guard (`CheckoutReviewClient.tsx:90`). So a replay (e.g. refresh-and-resubmit
with the same key, or a fast double-fire before the button disables) can send
each email a second time.

### Fix **[decided: keep dispatch, fix the test doubling + guard double-submit]**

**1a. Suppress the dispatch email for test/demo orgs.** In `submit.ts` step 7,
guard the `sendOrderPlacedDispatch` call with `if (!notifyIsTestOrg)`. Production
is unchanged (customer → confirmation, `charlotte@` → dispatch). Test/demo orgs
send **only** the customer confirmation to `jamie@`, so testing mirrors what a
real customer sees. The Slack post (`postOrderPlacedSlack`, `submit.ts:1797`)
stays unconditional — it targets a channel, not the tester's inbox, and is a
no-op locally anyway (`SLACK_PORTAL_WEBHOOK_URL` unset →
`lib/notifications/slack-order-placed.ts:88` returns `{ ok: true, skipped: true }`).

**1b. Make post-commit side-effects fire at most once per order (two layers):**

- **Client re-entry guard.** Add `if (submitting) return` at the top of
  `confirmOrder` (`CheckoutReviewClient.tsx:90`). Closes the within-render
  double-fire window at the source.
- **Server dispatch-once guard.** Add a nullable column
  `orders.notifications_dispatched_at timestamptz`. Before dispatching the
  external side-effects, perform an atomic compare-and-set:

  ```ts
  const { data: claimed } = await admin
    .from('orders')
    .update({ notifications_dispatched_at: new Date().toISOString() })
    .eq('id', order_id)
    .is('notifications_dispatched_at', null)
    .select('id')
  if (!claimed || claimed.length === 0) return // someone already dispatched
  ```

  Only the winner runs Monday / Xero / emails / Slack. Race-safe for concurrent
  submits and idempotent across replays. This lives *inside* the deferred
  `after()` block introduced in Part 2 (§3a), so the guard and the work move
  together.

**Migration:** `orders.notifications_dispatched_at` is an **additive, nullable**
column on the shared `orders` table — backward-compatible; the staff portal
neither reads nor writes it. Ships as one reviewable migration with a
drop-column rollback.

---

## Part 2 — the slow / frozen "Confirm & place order"

### What actually happens

Two independent problems.

**A. Perceived — the button barely signals it is working.** On submit,
`CheckoutReviewClient` sets `submitting` (`:116`) and posts to `/api/checkout`;
`CheckoutCTAStickyBar` (`components/checkout/CheckoutCTAStickyBar.tsx`) only swaps
the label to "Placing order…" and dims to `opacity-50`. There is **no spinner and
no overlay**, and the rest of the page stays fully static — so a multi-second
submit looks frozen. On success the handler also `cart.clear()`s *before*
`router.push` (`:269–271`), which momentarily re-renders the review page into its
empty-cart state before navigation.

**B. Actual latency — the request blocks on external APIs it doesn't need to.**
The expensive *reprice/validation fan-out* (once 3.8 s at 40 lines) was **already
fixed** on 2026-07-14 (Track A — `PERF-STRATEGY.md`; batched link-select +
deduped price RPCs are present in the current tree at `submit.ts:704–782`) and
now costs ~0.6 s. What remains is the **post-commit tail**: after the order
commits, `/api/checkout` still `await`s, in series, before responding:

| Work | Site | Nature |
|---|---|---|
| Monday CRM push (+ `monday_item_id` stamp) | `submit.ts:1392`, `:1413` | external API |
| Xero draft invoice | `submit.ts:1604` | external API |
| Customer confirmation email | `submit.ts:1731` | external (Resend) |
| Slack order-placed post | `submit.ts:1797` | external |
| Dispatch email | `submit.ts:1814` | external (Resend) |

Four to five external round-trips, none of which the confirmation page depends
on. The route `await`s `submitCustomerOrder` fully, then `revalidateTag`s, then
returns (`app/api/checkout/route.ts:98–111`); the client then `router.push`es to
`/checkout/confirmation/<order_id>`, one more round-trip.

Additionally, step 4's per-line snapshot writes (ship-to + decorations) run **one
sequential `.update()` per line** (`submit.ts:1187`) — N round-trips that scale
with order size.

### Fix **[decided: full scope — client UX + `after()` deferral + batch writes]**

**2. Perceived speed (client).** Files: `CheckoutCTAStickyBar.tsx`,
`CheckoutReviewClient.tsx`, new `components/checkout/CheckoutPlacingOverlay.tsx`.

- **Spinner inside the button** — render an inline `animate-spin` SVG before the
  "Placing order…" label when `submitting`; keep the existing `disabled` state.
  (Directly answers "a loading spinner inside the button after being pressed".)
- **Full-screen loading overlay** — `CheckoutPlacingOverlay`, a `fixed inset-0`
  scrim + branded spinner + "Placing your order…", animated in/out with
  **framer-motion** (`AnimatePresence` + `motion.div`; already a dependency,
  `framer-motion@^12`). Optional rotating reassurance copy ("Reserving stock…",
  "Confirming pricing…"). Rendered at the top of the component tree, gated on
  `submitting`, so it also covers the empty-cart state.
- **No frozen / empty-cart flash** — keep `submitting` true on success and keep
  the overlay mounted through `router.push`; navigate *before* clearing the cart
  (or clear on the confirmation page) so the emptied review page never flashes.
  `submitting` is only reset to false on the error / 409 paths.

**3a. Actual speed — defer external side-effects with `after()`.** Import
`{ after } from 'next/server'` (stable in Next 16). Wrap the Monday push, Xero
draft, confirmation email, Slack post, and dispatch email in a single
`after(async () => { … })` in `submit.ts`, fronted by the §1b dispatch-once
compare-and-set. `/api/checkout` then returns as soon as the page-critical rows
are written; the notifications/integrations run right after the response flushes,
in the same invocation.

- **Stays in-request** (the confirmation page / order-tracker / stock integrity
  depend on them): the `submit_b2b_order` commit, `order_type` stamp
  (`submit.ts:1101`), `ORDER_SUBMIT` audit (`:1141`), step 4 line snapshot
  (batched — §3b), step 4b pre-approved inventory (inventory intent only,
  `:1203`), step 4c job-tracker shell (`:1285`).
- **Moves to `after()`:** Monday (`:1392`), Xero (`:1604`), confirmation email
  (`:1731`), Slack (`:1797`), dispatch email (`:1814`).
- **Error semantics unchanged:** every one of these blocks is *already*
  best-effort/swallowed today, so running them post-response is not a regression.
  `monday_item_id` fills in slightly later; the confirmation page does not read it.

**3b. Batch the per-line snapshot writes.** Replace the sequential per-line
`.update()` loop at `submit.ts:1168–1189` with a single `Promise.all` over the
per-line updates (mirrors the reprice-fix pattern), so N lines cost ~1 round-trip
of wall-clock instead of N. (Optional stretch: collapse to one bulk `upsert`.)

---

## Testing

- **Unit — test-org dispatch suppression:** extend the checkout submit tests to
  assert `sendOrderPlacedDispatch` is *not* called when the org is a test org,
  and *is* called (to the desk address) when it is not.
- **Unit — dispatch-once guard:** a second `submitCustomerOrder` with the same
  idempotency_key (replay) dispatches zero external side-effects (compare-and-set
  loses).
- **Component — re-entry guard:** a second click while `submitting` issues no
  second `fetch`.
- **Component — overlay:** overlay renders while `submitting`; button shows the
  spinner; no empty-cart flash on the success path.
- **Regression:** the existing checkout suite (`npm test`) stays green, including
  the reprice round-trip regression test. `after()`-deferred work must still
  receive identical payloads (assert the deferred callback is scheduled with the
  same arguments the inline calls used).

## Acceptance criteria

- Test/demo order → tester's inbox receives **one** email (`Order received`).
  Real order → customer one, `charlotte@` one.
- Double-click, or refresh-and-resubmit with the same key → **never** two of any
  email, and never two orders.
- `/api/checkout` response time for a 40-line test order drops from
  "reprice + 4 external APIs" to roughly the commit + page-critical writes
  (~0.6–0.8 s); the button shows a spinner and the overlay appears immediately on
  press — no frozen look.
- Existing tests green; new tests above added.

## Risks / notes

- **`after()` failures are invisible to the user.** Acceptable because these
  side-effects are already swallowed today; failures continue to log + audit.
- **One shared-DB migration** (`orders.notifications_dispatched_at`, additive
  nullable) — low risk, staff portal unaffected; rollback = drop column.
- **Verify the reprice fix is deployed to prod.** My working notes flag PR #66
  (the 93→17 round-trip fix) as merged to `main` but *deploy-unconfirmed*. If the
  slowness was observed against production, the 3.8 s reprice may still be live
  there independent of this work — confirm the deploy.
- Scope is deliberately the *submit* flow the user pointed at; no unrelated
  checkout refactoring.

## Out of scope

- Wiring up `SLACK_PORTAL_WEBHOOK_URL` (staff Slack alerts remain a no-op until
  that env exists — unchanged by this work).
- Track B shared-DB debt (`PERF-STRATEGY.md`) — separate effort.
- A queue/worker for the deferred side-effects; `after()` is sufficient at
  current volume.
