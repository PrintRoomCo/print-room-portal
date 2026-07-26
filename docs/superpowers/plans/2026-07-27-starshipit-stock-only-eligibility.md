# Starshipit stock-on-hand-only dispatch eligibility (Chris #8) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox syntax.
> **Program note:** git is Jon's. NO commits. `STARSHIPIT_ENABLED` flip, creds (`STARSHIPIT_API_KEY`/`SUBSCRIPTION_KEY`), and the "Print Room Dispatch" account consolidation are all HITL — this plan touches none of them.

**Goal:** Starshipit push-at-placement fires ONLY for stock-on-hand orders; purchase-order (made-to-order) orders skip with a `not_stock_on_hand` audit reason.

**Architecture:** Add an orthogonal `isStockOnHand` signal to the eligibility evaluator (distinct from the inert delivery/pickup `orderType` discriminator), thread it through `pushOrderToStarshipit`, and pass the `isStockOnHandOrder` const already computed in submit step 5d.

**Tech Stack:** TypeScript, vitest. No schema change, no migration (`order_type` already exists on `orders`).

## Global Constraints

- No new prod side-effects; integration stays dark until Jon flips `STARSHIPIT_ENABLED`.
- Do NOT touch `orderType` (delivery/pickup discriminator) semantics, the webhook, client, or config.
- tsc diff-against-baseline (P ~14 pre-existing). Run vitest from P root.

---

### Task 1: Eligibility gate — `not_stock_on_hand`

**Files:**
- Modify: `lib/starshipit/eligibility.ts`
- Test: `lib/starshipit/__tests__/eligibility.test.ts`

**Interfaces:**
- Produces: `StarshipitEligibilityInput.isStockOnHand: boolean`; new reason `'not_stock_on_hand'`.

- [ ] **Step 1: Extend the existing tests** — add `isStockOnHand: true` to `base`, add a stock-gate case + updated precedence:

```ts
  it('skips a purchase-order (made-to-order) order', () => {
    expect(evaluateStarshipitEligibility({ ...base, isStockOnHand: false }))
      .toEqual({ eligible: false, reason: 'not_stock_on_hand' })
  })
  it('precedence: inventory_intent beats not_stock_on_hand', () => {
    expect(evaluateStarshipitEligibility({ ...base, intent: 'inventory', isStockOnHand: false }))
      .toEqual({ eligible: false, reason: 'inventory_intent' })
  })
  it('precedence: not_stock_on_hand beats no_address', () => {
    expect(evaluateStarshipitEligibility({ ...base, isStockOnHand: false, hasDeliveryAddress: false }))
      .toEqual({ eligible: false, reason: 'not_stock_on_hand' })
  })
```

- [ ] **Step 2: Run — expect FAIL** (`isStockOnHand` not in type / gate absent)

Run: `npx vitest run lib/starshipit/__tests__/eligibility.test.ts`

- [ ] **Step 3: Implement** — add to the union type, the input interface, and the gate (after `inventory_intent`, before `non_delivery_type`):

```ts
export type StarshipitIneligibleReason =
  | 'disabled'
  | 'test_org'
  | 'inventory_intent'
  | 'not_stock_on_hand'
  | 'non_delivery_type'
  | 'no_address'
```
```ts
  /** Spec A order_type gate — Starshipit dispatches STOCK orders only. A
   *  purchase-order (any made-to-order line) ships via the production flow. */
  isStockOnHand: boolean
```
```ts
  if (input.intent === 'inventory') return { eligible: false, reason: 'inventory_intent' }
  if (!input.isStockOnHand) return { eligible: false, reason: 'not_stock_on_hand' }
  if (input.orderType != null && input.orderType !== 'delivery')
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run lib/starshipit/__tests__/eligibility.test.ts`

---

### Task 2: Thread `isStockOnHand` through `pushOrderToStarshipit`

**Files:**
- Modify: `lib/starshipit/push-order.ts`
- Test: `lib/starshipit/__tests__/push-order.test.ts`

**Interfaces:**
- Consumes: `StarshipitEligibilityInput.isStockOnHand` (Task 1).
- Produces: `PushOrderToStarshipitArgs.isStockOnHand: boolean`.

- [ ] **Step 1: Add/adjust a test** — a PO order (`isStockOnHand: false`) returns `{ status: 'skipped', reason: 'not_stock_on_hand' }`; existing pushed-case args gain `isStockOnHand: true`. (Match the file's existing mock harness — add `isStockOnHand` to whatever args factory it uses.)

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run lib/starshipit/__tests__/push-order.test.ts`

- [ ] **Step 3: Implement** — add to `PushOrderToStarshipitArgs`:

```ts
  /** Spec A stock/production axis — Starshipit dispatches stock orders only. */
  isStockOnHand: boolean
```
and pass it into the eligibility call:
```ts
  const elig = evaluateStarshipitEligibility({
    enabled: isStarshipitEnabled(),
    intent: args.intent,
    isTestOrg: args.isTestOrg,
    isStockOnHand: args.isStockOnHand,
    hasDeliveryAddress,
    orderType: args.orderType ?? null,
  })
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run lib/starshipit/__tests__/push-order.test.ts`

---

### Task 3: Wire submit step 5d

**Files:**
- Modify: `lib/checkout/submit.ts` (~line 1955 call)

- [ ] **Step 1: Pass the flag** — inside the `pushOrderToStarshipit(admin, {...})` object add `isStockOnHand: isStockOnHandOrder,` (const at submit.ts:1319) and update the stale comment:

```ts
        isTestOrg: ssIsTestOrg,
        isStockOnHand: isStockOnHandOrder,
        customerEmail: input.context.email ?? null,
        shippingAddress,
        // orderType (delivery/pickup) intentionally NOT passed — the portal has
        // no pickup concept. Starshipit dispatch is gated on isStockOnHand (Spec
        // A stock/production axis): PO orders skip via 'not_stock_on_hand'.
```

- [ ] **Step 2: Run the submit + starshipit suites**

Run: `npx vitest run lib/starshipit lib/checkout/__tests__/submit.job-tracker.test.ts`

---

## Full gate (after all tasks)

- [ ] `npx vitest run lib/starshipit` — all green.
- [ ] `npx tsc --noEmit` — no NEW errors vs baseline in touched files.

## What I'd commit (ledger for Jon) — all P, uncommitted

- `lib/starshipit/eligibility.ts` — `isStockOnHand` input + `not_stock_on_hand` reason + gate
- `lib/starshipit/push-order.ts` — arg + pass-through
- `lib/checkout/submit.ts` — pass `isStockOnHand` at 5d + comment
- tests: `eligibility.test.ts`, `push-order.test.ts`
- docs: this plan

## Go-live steps (for Jon — all HITL)

1. Confirm the consolidated "Print Room Dispatch" Starshipit account + set `STARSHIPIT_API_KEY` / `STARSHIPIT_SUBSCRIPTION_KEY` in the portal env.
2. Set `STARSHIPIT_ENABLED=true`.
3. Smoke: place a fully-stocked NZ delivery order → expect a Starshipit order created (audit `ORDER_STARSHIPIT_PUSHED`); place a PO order → expect skip with `not_stock_on_hand`.
