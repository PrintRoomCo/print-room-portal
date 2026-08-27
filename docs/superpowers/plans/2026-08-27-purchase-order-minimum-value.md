# Purchase-Order Minimum Order Value ($500) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Block customer purchase orders worth less than 500 units of their billing currency from being submitted through `print-room-portal`, with a clear in-app explanation and a contact route for genuine small runs.

**Architecture:** One pure policy module (`lib/checkout/minimum-order.ts`) is the single source of the rule. `prepareCustomerOrderPartition` attaches its verdict to every prepared partition; `submitCustomerOrder` reads that annotation and throws before the database RPC; the cart drawer and both checkout clients render the same verdict as a banner. No new pricing arithmetic is introduced — the notional value already exists in `prepare.ts` as `goodsValueForBand`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase (shared project, schema owned by `print-room-staff-portal`), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-27-purchase-order-minimum-value-design.md`

## Global Constraints

- Threshold is the code constant `PURCHASE_ORDER_MINIMUM = 500`, applied in **each partition's own billing currency** (NZD 500, AUD 500). No FX conversion anywhere.
- Notional value = goods subtotal + decoration revenue, **excluding GST and the picking fee**, counting prepaid lines at **full value**. This is exactly `goodsValueForBand` in `lib/checkout/prepare.ts:1471`. Never recompute it.
- Four exemptions, OR'd: `organizations.min_order_exempt`, `organizations.is_test`, `intent === 'inventory'`, and a cart where **every** line is an open-period pre-order item.
- The staff portal and the shared `submit_b2b_order_for_country` RPC are **not touched**. Staff placing a small order on a customer's behalf is the intended manual override.
- Contact CTA is `hello@theprint-room.co.nz`, mailto subject `Order below $500 minimum`.
- Ships enforcing at deploy. No feature flag.
- **This repo does not own the database schema.** `print-room-portal/supabase/migrations/README.md` forbids adding migration files here and forbids `apply_migration` / dashboard SQL from any repo. The one schema change lives in `print-room-staff-portal`.
- Test/verification emails go to `jamie@theprint-room.co.nz`, never `jon@`.
- Run the full suite with `npm test`; a single file with `npx vitest run <path>`.

## Findings from codebase exploration that shape this plan

Read these before starting — three of them contradict what the spec assumed.

1. **`app/(portal)/cart/page.tsx` is a 10-line redirect to `/catalogue`.** The spec says "the cart page and drawer". There is only one cart surface: `components/cart/CartDrawer.tsx`. Task 11 targets the drawer alone.

2. **`useCheckoutPreview` only fires when `countryPartitionEnabled` is true** (`components/checkout/useCheckoutPreview.ts:127-130` — `enabled && request ? ... : null`). `.env.local` and `.env.example` both set `CHECKOUT_COUNTRY_PARTITION_ENABLED=false`. So the checkout-layer banner (Task 9) is **dark whenever that flag is off**, and the 422 error banner (Task 8) is the primary customer-facing block in that configuration. Both paths ship; neither is optional.

3. **With partitioning ON, submit failures become a 207 multi-status body, not a top-level error** (`app/api/checkout/route.ts:388` pushes `partitionFailureOutcome(...)`, and line 400-403 returns 207). So the error needs mapping in **two** places in that route, and `MinimumOrderValueError.message` is rendered verbatim to the customer on the 207 path — which is why the error carries the finished sentence, not a bare code.

4. **`organizations.moq_exempt` is never selected.** `lib/checkout/server.ts:117` selects `'id, name, customer_code, is_test'` but line 171 reads `org.moq_exempt` → always `undefined` → `moqExempt` is always `false`. `lib/preview/context.ts:21` even documents the omission. This is a real pre-existing bug and it is **out of scope** — fixing it would silently change MOQ enforcement for orgs staff have already marked exempt. Do not fix it here; Task 12 records it as a follow-up. **Do not repeat the mistake:** Task 4 fetches `min_order_exempt` in its own tolerant query.

5. **`min_order_exempt` will not exist in the database when the portal code is written.** Adding it to the existing `organizations` select would make PostgREST error the whole row → `org` null → `org_not_found` → checkout breaks for every customer. Task 4 therefore uses a **separate, failure-tolerant query**, exactly the pattern `lib/checkout/server.ts:128-132` already uses for `b2b_member_store_grants` ("before it is applied this query just returns null → feature dark").

6. **17 sites construct a `B2BCustomerContext`** (mostly `lib/checkout/__tests__/*`). `minOrderExempt` is therefore declared **optional**, following the existing `isPreview?: boolean` precedent on the same interface. Absent → not exempt → the gate applies, which is the conservative direction.

7. **The preview route needs no change.** `app/api/checkout/preview/route.ts:359` pushes `{ ok: true, partition: prepared }` — the whole prepared object — so `minimumOrder` reaches the client for free once Task 5 lands. Do not add a mapping there.

8. **Mixed carts are already split into two orders before pricing.** `partitionCheckoutLines` (`lib/checkout/partition.ts:59`) sends every `made_to_order` and legacy line to a `purchase_order` partition and every `stocked` line to a `stock_on_hand` partition; the route calls it at `app/api/checkout/route.ts:412` (flag off) and via `buildCheckoutExecutionPlan` (flag on). **Every partition reaching `prepare` is homogeneous.** The spec's mixed-cart worked example ("$600 of stock tees plus one $80 made-to-order hoodie = $680, which passes") therefore cannot happen: the hoodie becomes its own $80 purchase order. This plan implements **per-order** measurement — see "Open decision" below.

## Open decision — per-order vs per-cart measurement

The spec says the minimum is tested against the "whole order". Finding 8 shows one cart can be two orders, which makes that phrase ambiguous, and the two readings give different answers for the same cart.

**This plan implements per-order** (the purchase-order partition is measured alone). That is the reading the architecture already has: `prepare` sees one homogeneous partition, so the annotation and the submit backstop measure the same thing, and the backstop cannot be bypassed by calling the API directly.

The alternative — summing both halves of the cart — would need the route to prepare every partition, total their notional values, and re-evaluate once; the submit backstop would then only ever see one half, so a direct API call could place a small purchase order that the UI would have blocked.

If per-cart is what is wanted, Tasks 2, 5, 7 and 8 change shape. Confirm before starting.

---

### Task 1: Schema — `organizations.min_order_exempt` (STAFF REPO)

This task is executed in `/Users/jamierogangeorge/Documents/print-room-staff-portal`, **not** in this repo. It must be applied and verified before the portal deploy. The column defaults `false`, so it is inert until Task 4 ships.

**Files:**
- Create: `print-room-staff-portal/supabase/migrations/<TIMESTAMP>_organizations_min_order_exempt.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `public.organizations.min_order_exempt boolean not null default false`, read by Task 4.

- [ ] **Step 1: Pick a timestamp strictly newer than the latest existing migration**

```bash
ls /Users/jamierogangeorge/Documents/print-room-staff-portal/supabase/migrations | sort | tail -3
```

Take the newest filename's `YYYYMMDDHHMMSS` prefix and choose a strictly larger one (e.g. if the newest is `20260826130000`, use `20260827120000`). Out-of-order timestamps corrupt the migration ledger.

- [ ] **Step 2: Write the migration**

Create `print-room-staff-portal/supabase/migrations/20260827120000_organizations_min_order_exempt.sql` (substitute your chosen timestamp):

```sql
-- Customer portal: $500 minimum order value on purchase orders.
-- Design: print-room-portal/docs/superpowers/specs/2026-08-27-purchase-order-minimum-value-design.md
--
-- Escape hatch for negotiated accounts, mirroring organizations.moq_exempt.
-- Defaults false, so this column is inert until the customer portal deploys.
alter table public.organizations
  add column if not exists min_order_exempt boolean not null default false;

comment on column public.organizations.min_order_exempt is
  'Customer portal: exempts this org from the $500 purchase-order minimum order value. Mirrors moq_exempt. Set by staff for negotiated accounts.';
```

- [ ] **Step 3: Apply it from the staff repo**

```bash
cd /Users/jamierogangeorge/Documents/print-room-staff-portal && npx supabase db push
```

Expected: the new migration is listed as applied. If `db push` reports pre-existing drift on unrelated migrations, **stop and report it** — do not use `migration repair` opportunistically.

- [ ] **Step 4: Verify the column exists and defaults false**

```bash
cd /Users/jamierogangeorge/Documents/print-room-staff-portal && npx supabase db push --dry-run
```

Expected: "Remote database is up to date." Then confirm the column landed by reading one row:

```sql
select id, min_order_exempt from public.organizations limit 3;
```

Expected: three rows, `min_order_exempt` = `false` on all of them.

- [ ] **Step 5: Commit (staff repo)**

```bash
cd /Users/jamierogangeorge/Documents/print-room-staff-portal
git add supabase/migrations/20260827120000_organizations_min_order_exempt.sql
git commit -m "feat: add organizations.min_order_exempt for the customer portal \$500 minimum"
```

---

### Task 2: The policy module

The whole rule, pure and database-free. Every other task calls into this.

**Files:**
- Create: `lib/checkout/minimum-order.ts`
- Test: `lib/checkout/minimum-order.test.ts`

**Interfaces:**
- Consumes: `OrderType` from `lib/orders/order-type.ts`; `round2` from `lib/pricing/pricingMath.ts`.
- Produces: `PURCHASE_ORDER_MINIMUM`, `MinimumOrderExemptions`, `MinimumOrderStatus`, `evaluateMinimumOrder`, `allLinesArePreOrder`, `CartMinimumOrderView`, `evaluateCartMinimumOrder`.

- [ ] **Step 1: Write the failing test**

Create `lib/checkout/minimum-order.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  PURCHASE_ORDER_MINIMUM,
  allLinesArePreOrder,
  evaluateMinimumOrder,
  type MinimumOrderExemptions,
} from './minimum-order'

const NO_EXEMPTIONS: MinimumOrderExemptions = {
  orgExempt: false,
  isTest: false,
  isInventoryIntent: false,
  allPreOrder: false,
}

function evaluate(
  notionalValue: number,
  overrides: Partial<MinimumOrderExemptions> = {},
  orderType: 'purchase_order' | 'stock_on_hand' = 'purchase_order',
  currency = 'NZD',
) {
  return evaluateMinimumOrder({
    orderType,
    notionalValue,
    currency,
    exemptions: { ...NO_EXEMPTIONS, ...overrides },
  })
}

describe('evaluateMinimumOrder', () => {
  it('exposes the threshold as 500', () => {
    expect(PURCHASE_ORDER_MINIMUM).toBe(500)
  })

  it('gates a purchase order below the minimum', () => {
    const status = evaluate(380)
    expect(status.applies).toBe(true)
    expect(status.met).toBe(false)
    expect(status.threshold).toBe(500)
    expect(status.value).toBe(380)
    expect(status.shortfall).toBe(120)
  })

  it('treats exactly 500.00 as met', () => {
    expect(evaluate(500).met).toBe(true)
    expect(evaluate(500).shortfall).toBe(0)
  })

  it('treats 499.99 as gated', () => {
    const status = evaluate(499.99)
    expect(status.met).toBe(false)
    expect(status.shortfall).toBe(0.01)
  })

  it('rounds the shortfall to cents', () => {
    expect(evaluate(379.99).shortfall).toBe(120.01)
  })

  it('never applies to a stock-on-hand order', () => {
    const status = evaluate(10, {}, 'stock_on_hand')
    expect(status.applies).toBe(false)
    expect(status.met).toBe(true)
    expect(status.shortfall).toBe(0)
  })

  it.each([
    ['orgExempt', { orgExempt: true }],
    ['isTest', { isTest: true }],
    ['isInventoryIntent', { isInventoryIntent: true }],
    ['allPreOrder', { allPreOrder: true }],
  ] as const)('clears the gate when %s is set', (_label, overrides) => {
    const status = evaluate(10, overrides)
    expect(status.applies).toBe(false)
    expect(status.met).toBe(true)
  })

  it('stays cleared when several exemptions combine', () => {
    expect(evaluate(10, { orgExempt: true, isTest: true }).met).toBe(true)
  })

  it('passes the currency through untouched and does not convert', () => {
    const status = evaluate(380, {}, 'purchase_order', 'AUD')
    expect(status.currency).toBe('AUD')
    expect(status.threshold).toBe(500)
    expect(status.shortfall).toBe(120)
  })
})

describe('allLinesArePreOrder', () => {
  it('is true only when every line is a period item', () => {
    const ids = new Set(['a', 'b'])
    expect(allLinesArePreOrder([{ catalogueItemId: 'a' }, { catalogueItemId: 'b' }], ids)).toBe(true)
  })

  it('is false when one line is outside the period — the mixed-cart loophole', () => {
    const ids = new Set(['a'])
    expect(allLinesArePreOrder([{ catalogueItemId: 'a' }, { catalogueItemId: 'z' }], ids)).toBe(false)
  })

  it('is false when a line carries no catalogue identity', () => {
    const ids = new Set(['a'])
    expect(allLinesArePreOrder([{ catalogueItemId: 'a' }, { catalogueItemId: null }], ids)).toBe(false)
  })

  it('is false with no open period and false for an empty cart', () => {
    expect(allLinesArePreOrder([{ catalogueItemId: 'a' }], new Set())).toBe(false)
    expect(allLinesArePreOrder([], new Set(['a']))).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/checkout/minimum-order.test.ts`
Expected: FAIL — `Failed to resolve import "./minimum-order"`.

- [ ] **Step 3: Write the implementation**

Create `lib/checkout/minimum-order.ts`:

```ts
// $500 minimum order value on customer purchase orders.
// Design: docs/superpowers/specs/2026-08-27-purchase-order-minimum-value-design.md
//
// Pure by design: no I/O, no Supabase. The cart hint, the checkout meter and the
// submit backstop all call evaluateMinimumOrder, so they cannot disagree about
// the policy — and the whole rule is unit-testable without a database.
import type { OrderType } from '@/lib/orders/order-type'
import { round2 } from '@/lib/pricing/pricingMath'

/**
 * Applied in each partition's OWN billing currency — NZD 500, AUD 500. There is
 * deliberately no FX conversion: the number a customer is quoted is the number
 * they are measured against.
 */
export const PURCHASE_ORDER_MINIMUM = 500

export interface MinimumOrderExemptions {
  /** organizations.min_order_exempt — negotiated accounts. */
  orgExempt: boolean
  /** organizations.is_test — demo/test orgs. */
  isTest: boolean
  /** Checkout `intent === 'inventory'` — an org restocking its own shelf. */
  isInventoryIntent: boolean
  /** EVERY line is an open-period pre-order item. Mixed carts are not exempt. */
  allPreOrder: boolean
}

export interface MinimumOrderStatus {
  /** False when the order is stock-on-hand or an exemption cleared it. */
  applies: boolean
  /** True when the gate does not block: !applies, or value >= threshold. */
  met: boolean
  threshold: number
  currency: string
  value: number
  /** 0 when met; otherwise threshold - value, rounded to cents. */
  shortfall: number
}

export function evaluateMinimumOrder(input: {
  orderType: OrderType
  notionalValue: number
  currency: string
  exemptions: MinimumOrderExemptions
}): MinimumOrderStatus {
  const { orderType, notionalValue, currency, exemptions } = input
  const exempt =
    exemptions.orgExempt ||
    exemptions.isTest ||
    exemptions.isInventoryIntent ||
    exemptions.allPreOrder
  const applies = orderType === 'purchase_order' && !exempt
  const value = round2(notionalValue)
  const met = !applies || value >= PURCHASE_ORDER_MINIMUM
  return {
    applies,
    met,
    threshold: PURCHASE_ORDER_MINIMUM,
    currency,
    value,
    shortfall: met ? 0 : round2(PURCHASE_ORDER_MINIMUM - value),
  }
}

/**
 * Exemption 4. Requires EVERY line to be a period item: one cheap period item
 * must not exempt an unrelated order. An empty cart, a cart with no open period,
 * and a line without catalogue identity all return false.
 */
export function allLinesArePreOrder(
  lines: ReadonlyArray<{ catalogueItemId?: string | null }>,
  preOrderItemIds: ReadonlySet<string>,
): boolean {
  if (lines.length === 0 || preOrderItemIds.size === 0) return false
  return lines.every(
    (line) => Boolean(line.catalogueItemId) && preOrderItemIds.has(line.catalogueItemId as string),
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/checkout/minimum-order.test.ts`
Expected: PASS — 14 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/checkout/minimum-order.ts lib/checkout/minimum-order.test.ts
git commit -m "feat: add pure \$500 purchase-order minimum policy module"
```

---

### Task 3: The cart-layer two-tier evaluator

The cart cannot resolve inventory intent (a checkout-time toggle) and may not yet have resolved the open period. This adds a second entry point that never falsely blocks. It lives in the same module because it is the same policy.

**Files:**
- Modify: `lib/checkout/minimum-order.ts` (append)
- Test: `lib/checkout/minimum-order.test.ts` (append)

**Interfaces:**
- Consumes: `evaluateMinimumOrder`, `allLinesArePreOrder` from Task 2.
- Produces: `CartMinimumOrderView { status, tentative, blocks }`, `evaluateCartMinimumOrder(input)`.

- [ ] **Step 1: Write the failing test**

Add `evaluateCartMinimumOrder` to the **existing** import from `./minimum-order` at the top of `lib/checkout/minimum-order.test.ts` (do not add a second import statement for the same module), then append:

```ts
function cartView(overrides: Partial<Parameters<typeof evaluateCartMinimumOrder>[0]> = {}) {
  return evaluateCartMinimumOrder({
    orderType: 'purchase_order',
    notionalValue: 380,
    currency: 'NZD',
    orgExempt: false,
    isTest: false,
    canRouteToInventory: false,
    periodLookupPending: false,
    preOrderItemIdsInCart: new Set<string>(),
    lineCatalogueItemIds: ['item-1'],
    ...overrides,
  })
}

describe('evaluateCartMinimumOrder', () => {
  it('blocks when no exemption is still possible', () => {
    const view = cartView()
    expect(view.blocks).toBe(true)
    expect(view.tentative).toBe(false)
    expect(view.status.shortfall).toBe(120)
  })

  it('warns without blocking when the org can route to inventory', () => {
    const view = cartView({ canRouteToInventory: true })
    expect(view.blocks).toBe(false)
    expect(view.tentative).toBe(true)
  })

  it('warns without blocking when a cart line is a pre-order item', () => {
    const view = cartView({
      preOrderItemIdsInCart: new Set(['item-1']),
      lineCatalogueItemIds: ['item-1', 'item-2'],
    })
    expect(view.blocks).toBe(false)
    expect(view.tentative).toBe(true)
  })

  it('warns without blocking while the period lookup is still in flight', () => {
    const view = cartView({ periodLookupPending: true })
    expect(view.blocks).toBe(false)
    expect(view.tentative).toBe(true)
  })

  it('shows nothing when every line is a pre-order item', () => {
    const view = cartView({
      preOrderItemIdsInCart: new Set(['item-1']),
      lineCatalogueItemIds: ['item-1'],
    })
    expect(view.status.applies).toBe(false)
    expect(view.blocks).toBe(false)
    expect(view.tentative).toBe(false)
  })

  it('shows nothing for an exempt org, even under the minimum', () => {
    const view = cartView({ orgExempt: true })
    expect(view.status.applies).toBe(false)
    expect(view.blocks).toBe(false)
    expect(view.tentative).toBe(false)
  })

  it('shows nothing for a test org', () => {
    expect(cartView({ isTest: true }).status.applies).toBe(false)
  })

  it('shows nothing at or over the minimum', () => {
    const view = cartView({ notionalValue: 500 })
    expect(view.blocks).toBe(false)
    expect(view.tentative).toBe(false)
  })

  it('shows nothing for a stock-on-hand cart', () => {
    const view = cartView({ orderType: 'stock_on_hand', notionalValue: 10 })
    expect(view.status.applies).toBe(false)
    expect(view.blocks).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/checkout/minimum-order.test.ts`
Expected: FAIL — `evaluateCartMinimumOrder is not a function` / no matching export.

- [ ] **Step 3: Write the implementation**

Append to `lib/checkout/minimum-order.ts`:

```ts
export interface CartMinimumOrderView {
  status: MinimumOrderStatus
  /** Under the minimum, but an exemption may still apply at checkout — warn, do not block. */
  tentative: boolean
  /** Under the minimum with no exemption left to apply — safe to disable checkout. */
  blocks: boolean
}

/**
 * Cart-layer verdict. The cart is pre-partition and pre-intent, so two of the
 * four exemptions are not knowable here: `intent` is a checkout-time toggle
 * (`addToInventory`, offered to franchise and studio_plus_inventory orgs) and the
 * open period may still be loading. This function therefore degrades to a warning
 * rather than a block whenever an exemption could still land — the cart hint
 * saves a wasted trip to checkout, it is never the only thing blocking an order.
 */
export function evaluateCartMinimumOrder(input: {
  orderType: OrderType
  notionalValue: number
  currency: string
  orgExempt: boolean
  isTest: boolean
  /** The org may flip this order to an inventory restock at checkout. */
  canRouteToInventory: boolean
  /** The open-period lookup has not resolved yet. */
  periodLookupPending: boolean
  /** Cart catalogue item ids that belong to the org's open ordering period. */
  preOrderItemIdsInCart: ReadonlySet<string>
  /** Every cart line's catalogue item id, in cart order. */
  lineCatalogueItemIds: ReadonlyArray<string | null | undefined>
}): CartMinimumOrderView {
  const status = evaluateMinimumOrder({
    orderType: input.orderType,
    notionalValue: input.notionalValue,
    currency: input.currency,
    exemptions: {
      orgExempt: input.orgExempt,
      isTest: input.isTest,
      // Unknowable in the cart. Left false so the gate still evaluates; the
      // `canRouteToInventory` downgrade below is what prevents a false block.
      isInventoryIntent: false,
      allPreOrder: allLinesArePreOrder(
        input.lineCatalogueItemIds.map((catalogueItemId) => ({ catalogueItemId })),
        input.preOrderItemIdsInCart,
      ),
    },
  })
  const under = status.applies && !status.met
  const exemptionStillPossible =
    input.canRouteToInventory ||
    input.periodLookupPending ||
    input.preOrderItemIdsInCart.size > 0
  return {
    status,
    tentative: under && exemptionStillPossible,
    blocks: under && !exemptionStillPossible,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/checkout/minimum-order.test.ts`
Expected: PASS — 23 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/checkout/minimum-order.ts lib/checkout/minimum-order.test.ts
git commit -m "feat: add two-tier cart evaluator for the minimum order gate"
```

---

### Task 4: Read `min_order_exempt` into the checkout context

**Files:**
- Modify: `lib/checkout/server.ts:55` (interface), `:114-133` (the `Promise.all`), `:171` (the returned context)
- Modify: `lib/preview/context.ts:59`
- Test: `lib/checkout/__tests__/server.min-order-exempt.test.ts`

**Interfaces:**
- Consumes: `organizations.min_order_exempt` from Task 1.
- Produces: `B2BCustomerContext.minOrderExempt?: boolean`, consumed by Task 5.

- [ ] **Step 1: Write the failing test**

Create `lib/checkout/__tests__/server.min-order-exempt.test.ts`:

```ts
/**
 * The min_order_exempt read must survive the column being absent — the staff-repo
 * migration lands separately, and a failing select on the shared `organizations`
 * row would blank the whole checkout context (org_not_found for every customer).
 * So it is its own tolerant query, exactly like b2b_member_store_grants.
 */
import { describe, expect, it } from 'vitest'
import { readMinOrderExempt } from '../server'

function stubAdmin(result: { data: unknown; error: unknown }) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => result,
        }),
      }),
    }),
  } as unknown as Parameters<typeof readMinOrderExempt>[0]
}

describe('readMinOrderExempt', () => {
  it('returns true when the flag is set', async () => {
    const admin = stubAdmin({ data: { min_order_exempt: true }, error: null })
    await expect(readMinOrderExempt(admin, 'org-1')).resolves.toBe(true)
  })

  it('returns false when the flag is unset', async () => {
    const admin = stubAdmin({ data: { min_order_exempt: false }, error: null })
    await expect(readMinOrderExempt(admin, 'org-1')).resolves.toBe(false)
  })

  it('returns false when the column does not exist yet', async () => {
    const admin = stubAdmin({
      data: null,
      error: { message: 'column organizations.min_order_exempt does not exist' },
    })
    await expect(readMinOrderExempt(admin, 'org-1')).resolves.toBe(false)
  })

  it('returns false when the query throws outright', async () => {
    const admin = {
      from: () => {
        throw new Error('network down')
      },
    } as unknown as Parameters<typeof readMinOrderExempt>[0]
    await expect(readMinOrderExempt(admin, 'org-1')).resolves.toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/checkout/__tests__/server.min-order-exempt.test.ts`
Expected: FAIL — `readMinOrderExempt is not a function`.

- [ ] **Step 3: Add the field to the interface**

In `lib/checkout/server.ts`, immediately after the `moqExempt: boolean` line (currently line 55) and before the `orderingPermission` doc comment, insert:

```ts
  /**
   * organizations.min_order_exempt. Clears the $500 purchase-order minimum for
   * negotiated accounts. Optional because ~17 sites construct this context
   * (mostly checkout tests); absent is read as NOT exempt, so the gate applies —
   * the conservative direction for a hard stop.
   */
  minOrderExempt?: boolean
```

- [ ] **Step 4: Add the tolerant reader**

In `lib/checkout/server.ts`, add this exported function immediately above `export const requireB2BCustomerCached` (currently line 182):

```ts
/**
 * Own query on purpose. The column ships from print-room-staff-portal on its own
 * schedule; folding it into the `organizations` select would make PostgREST error
 * the whole row while it is missing, blanking the checkout context for everyone.
 * Any failure reads as "not exempt" — same posture as the b2b_member_store_grants
 * read above.
 */
export async function readMinOrderExempt(
  admin: SupabaseClient,
  organizationId: string,
): Promise<boolean> {
  try {
    const { data, error } = await admin
      .from('organizations')
      .select('min_order_exempt')
      .eq('id', organizationId)
      .maybeSingle()
    if (error) return false
    return Boolean((data as { min_order_exempt?: boolean | null } | null)?.min_order_exempt)
  } catch {
    return false
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run lib/checkout/__tests__/server.min-order-exempt.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 6: Call it from `requireB2BCustomer`**

In `lib/checkout/server.ts`, find the `if (!org) return { kind: 'org_not_found' }` guard (currently line 134) and insert the call immediately **after** it — after the guard, so the failure path does not pay for an extra query:

```ts
  if (!org) return { kind: 'org_not_found' }

  const minOrderExempt = await readMinOrderExempt(admin, membership.organization_id)
```

Leave the existing `Promise.all` at lines 114-133 untouched: folding this select into it would reintroduce the failure mode Finding 5 describes.

Then in the returned context object, immediately after the `moqExempt: Boolean(...)` line (currently line 171), insert:

```ts
      minOrderExempt,
```

- [ ] **Step 7: Set it in the preview context**

In `lib/preview/context.ts`, immediately after the `moqExempt: false,` line (currently line 59), insert:

```ts
    // Staff previews never bypass the $500 minimum — a preview must show the
    // customer exactly what the customer would hit.
    minOrderExempt: false,
```

- [ ] **Step 8: Verify nothing else broke**

Run: `npx tsc --noEmit`
Expected: no NEW errors mentioning `minOrderExempt` or `B2BCustomerContext`. (Record any pre-existing errors before this task so you can tell them apart.)

Run: `npx vitest run lib/checkout app/api/checkout`
Expected: PASS — the existing checkout suites are unaffected because `minOrderExempt` is optional.

- [ ] **Step 9: Commit**

```bash
git add lib/checkout/server.ts lib/preview/context.ts lib/checkout/__tests__/server.min-order-exempt.test.ts
git commit -m "feat: read organizations.min_order_exempt into the checkout context"
```

---

### Task 5: Annotate prepared partitions with the verdict

This is where all four exemptions become fully resolvable, so this annotation is the authoritative verdict. It must not throw: a throw would collapse the partition into an `ok: false` pricing failure and discard the totals the customer needs to see.

**Files:**
- Modify: `lib/checkout/prepare.ts:60-73` (interface), `~:1520` (compute), `~:1542` (attach)
- Test: `lib/checkout/__tests__/prepare.minimum-order.test.ts`

**Interfaces:**
- Consumes: `evaluateMinimumOrder`, `allLinesArePreOrder` (Task 2); `B2BCustomerContext.minOrderExempt` (Task 4).
- Produces: `PreparedCheckoutPartition.minimumOrder: MinimumOrderStatus`, consumed by Task 7 (the submit backstop) and Task 10 (both checkout clients, via the preview outcome — see Finding 7).

- [ ] **Step 1: Write the failing test**

Create `lib/checkout/__tests__/prepare.minimum-order.test.ts`:

```ts
/**
 * The prepared annotation is the AUTHORITATIVE verdict — submit reads it rather
 * than recomputing, so the displayed and enforced answers cannot diverge.
 *
 * These tests drive the REAL prepareCustomerOrderPartition through the fan-out
 * stub, because the three things only prepare can get wrong are the notional
 * value it feeds in (prepaid lines at full value), the currency it picks, and the
 * two exemptions the cart cannot see.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/monday/deal-item', () => ({
  pushOrderDeal: vi.fn().mockResolvedValue({ itemId: 'mky-1', subitemIds: {} }),
}))

import { prepareCustomerOrderPartition } from '../prepare'
import { makeFanoutStub, makeContext, type StubConfig } from './fanout-test-stub'
import type { CheckoutInput } from '../submit'
import type { BillingCountryConfig } from '@/lib/account/org-countries'

const ORG = 'org-1'
const CAT = 'cat-1'
const ITEM = 'item-tee'
const PRODUCT = 'prod-tee'

const NZ: BillingCountryConfig = {
  code: 'NZ',
  name: 'New Zealand',
  currency: 'NZD',
  taxRate: 0.15,
  taxLabel: 'GST 15%',
  isDefault: true,
}
const AU: BillingCountryConfig = {
  code: 'AU',
  name: 'Australia',
  currency: 'AUD',
  taxRate: 0.1,
  taxLabel: 'GST 10%',
  isDefault: false,
}

function world(garmentUnitPrice: number): StubConfig {
  return {
    items: [
      { id: ITEM, sourceProductId: PRODUCT, priceMode: 'computed' as const, catalogueId: CAT },
    ],
    products: [{ id: PRODUCT, name: 'Tee' }],
    links: [],
    garmentUnitPrice,
    garmentUnitPriceForCurrency: () => garmentUnitPrice,
    enabledCountries: [NZ, AU],
  }
}

function input(
  qty: number,
  overrides: {
    minOrderExempt?: boolean
    intent?: 'customer' | 'inventory'
    billingMode?: 'prepaid' | 'invoice_on_dispatch'
  } = {},
): CheckoutInput {
  return {
    context: { ...makeContext(ORG), minOrderExempt: overrides.minOrderExempt ?? false },
    idempotency_key: `idem-${qty}`,
    ...(overrides.intent ? { intent: overrides.intent } : {}),
    lines: [
      {
        product_id: PRODUCT,
        product_name: 'Tee',
        variant_id: 'var-1',
        qty,
        unit_price: 10,
        catalogueItemId: ITEM,
        fulfilment_type: 'made_to_order',
        decorations: [],
        ...(overrides.billingMode
          ? { claimed_billing_mode: overrides.billingMode }
          : {}),
      },
    ],
  } as unknown as CheckoutInput
}

function options(country: BillingCountryConfig) {
  return { countryPartitionEnabled: true, partitionKey: `${country.code}:po`, country }
}

describe('prepareCustomerOrderPartition minimumOrder annotation', () => {
  it('gates a purchase-order partition under the minimum', async () => {
    const stub = makeFanoutStub(world(10))
    const prepared = await prepareCustomerOrderPartition(stub.admin, input(30), options(NZ))
    expect(prepared.minimumOrder.applies).toBe(true)
    expect(prepared.minimumOrder.met).toBe(false)
    expect(prepared.minimumOrder.value).toBe(300)
    expect(prepared.minimumOrder.shortfall).toBe(200)
    expect(prepared.minimumOrder.currency).toBe('NZD')
  })

  it('clears a partition at exactly the minimum', async () => {
    const stub = makeFanoutStub(world(10))
    const prepared = await prepareCustomerOrderPartition(stub.admin, input(50), options(NZ))
    expect(prepared.minimumOrder.met).toBe(true)
    expect(prepared.minimumOrder.shortfall).toBe(0)
  })

  it('measures an AU partition in AUD with no conversion', async () => {
    const stub = makeFanoutStub(world(10))
    const prepared = await prepareCustomerOrderPartition(stub.admin, input(46), options(AU))
    expect(prepared.minimumOrder.currency).toBe('AUD')
    expect(prepared.minimumOrder.threshold).toBe(500)
    expect(prepared.minimumOrder.value).toBe(460)
    expect(prepared.minimumOrder.met).toBe(false)
  })

  it('evaluates NZ and AU partitions of one cart independently', async () => {
    const stub = makeFanoutStub(world(10))
    const nz = await prepareCustomerOrderPartition(stub.admin, input(60), options(NZ))
    const au = await prepareCustomerOrderPartition(stub.admin, input(30), options(AU))
    expect(nz.minimumOrder.met).toBe(true)
    expect(au.minimumOrder.met).toBe(false)
  })

  it('counts a prepaid line at full notional value, not its $0 billed value', async () => {
    const stub = makeFanoutStub(world(10))
    const prepared = await prepareCustomerOrderPartition(
      stub.admin,
      input(60, { billingMode: 'prepaid' }),
      options(NZ),
    )
    // Billed total is 0 for a fully prepaid order; the gate must still see $600.
    expect(prepared.minimumOrder.value).toBe(600)
    expect(prepared.minimumOrder.met).toBe(true)
  })

  it('clears an exempt org under the minimum', async () => {
    const stub = makeFanoutStub(world(10))
    const prepared = await prepareCustomerOrderPartition(
      stub.admin,
      input(30, { minOrderExempt: true }),
      options(NZ),
    )
    expect(prepared.minimumOrder.applies).toBe(false)
    expect(prepared.minimumOrder.met).toBe(true)
  })

  it('clears an inventory-intent order under the minimum', async () => {
    const stub = makeFanoutStub(world(10))
    const prepared = await prepareCustomerOrderPartition(
      stub.admin,
      input(30, { intent: 'inventory' }),
      options(NZ),
    )
    expect(prepared.minimumOrder.applies).toBe(false)
  })

  it('never throws — a gated partition still returns its totals', async () => {
    const stub = makeFanoutStub(world(10))
    const prepared = await prepareCustomerOrderPartition(stub.admin, input(30), options(NZ))
    // The customer must keep their order summary at the moment they need to act on it.
    expect(prepared.totals.total).toBeGreaterThan(0)
    expect(prepared.lines).toHaveLength(1)
  })
})
```

> **Note for the implementer:** `StubConfig` is defined at `lib/checkout/__tests__/fanout-test-stub.ts:71-124`. If a field above does not match the current stub, or a prepared line needs another fixture row (a `stores` entry, an `enabledCountryCodes` list), fix the fixture — never the production code. `lib/checkout/__tests__/submit.pooled-decoration.test.ts` and `country-partition-flag-off-parity.test.ts` are worked examples of the same fixture shape. If `claimed_billing_mode: 'prepaid'` triggers a `BillingModeDriftError`, set the stub's canonical mode for `var-1` to prepaid instead of claiming it on the line.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/checkout/__tests__/prepare.minimum-order.test.ts`
Expected: FAIL — every case errors with `Cannot read properties of undefined (reading 'applies')`, because `prepared.minimumOrder` does not exist yet.

- [ ] **Step 3: Add the field to `PreparedCheckoutPartition`**

In `lib/checkout/prepare.ts`, add the import alongside the existing error imports near the top of the file:

```ts
import {
  allLinesArePreOrder,
  evaluateMinimumOrder,
  type MinimumOrderStatus,
} from '@/lib/checkout/minimum-order'
```

Then change the interface (currently lines 60-73) from:

```ts
export interface PreparedCheckoutPartition {
  key: string
  country: BillingCountryConfig
  orderType: 'purchase_order' | 'stock_on_hand'
  lines: PreparedCheckoutLine[]
  pricingPoolLines: CheckoutLineInput[]
  totals: {
```

to:

```ts
export interface PreparedCheckoutPartition {
  key: string
  country: BillingCountryConfig
  orderType: 'purchase_order' | 'stock_on_hand'
  /**
   * The AUTHORITATIVE $500 minimum verdict for this partition. All four
   * exemptions are resolvable here, so submit READS this rather than
   * recomputing — the displayed verdict and the enforced verdict cannot diverge.
   * Never throws: a throw would collapse the partition into an ok:false pricing
   * failure and discard the totals the customer needs in order to act.
   */
  minimumOrder: MinimumOrderStatus
  lines: PreparedCheckoutLine[]
  pricingPoolLines: CheckoutLineInput[]
  totals: {
```

- [ ] **Step 4: Compute and attach it**

In `lib/checkout/prepare.ts`, immediately after the `const billedTotal = billedOrderTotal(...)` call and before `const tax = round2(...)` (currently line 1541), insert:

```ts
  const minimumOrder = evaluateMinimumOrder({
    orderType,
    // Already goods + decoration, ex-GST, ex pick fee, prepaid lines at full
    // value. The gate introduces no pricing arithmetic of its own.
    notionalValue: goodsValueForBand,
    // Flag on: this partition's country. Flag off: the org's default row.
    currency: billingCountry.currency,
    exemptions: {
      orgExempt: input.context.minOrderExempt === true,
      isTest: input.context.isTest,
      isInventoryIntent: input.intent === 'inventory',
      allPreOrder: allLinesArePreOrder(input.lines, preOrderItemIds),
    },
  })
```

Then in the `const prepared: PreparedCheckoutPartition = {` literal, immediately after the `orderType,` line (currently line 1545), insert:

```ts
    minimumOrder,
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run lib/checkout`
Expected: PASS. `npx tsc --noEmit` must report no new errors.

- [ ] **Step 6: Commit**

```bash
git add lib/checkout/prepare.ts lib/checkout/__tests__/prepare.minimum-order.test.ts
git commit -m "feat: annotate prepared checkout partitions with the minimum-order verdict"
```

---

### Task 6: Customer-facing copy

One module owns the sentence, so the cart banner, the checkout banner and the API error message cannot drift apart. Split from the policy because a reviewer can reasonably reject the wording while approving the rule.

**Files:**
- Create: `lib/checkout/minimum-order-copy.ts`
- Test: `lib/checkout/minimum-order-copy.test.ts`

**Interfaces:**
- Consumes: `MinimumOrderStatus` (Task 2); `formatCurrency` from `lib/currency/format.ts`.
- Produces: `MINIMUM_ORDER_CONTACT_EMAIL`, `MinimumOrderCopy { sentence, lead, ctaLabel, mailto }`, `minimumOrderCopy(status, opts?)`. Consumed by Tasks 7, 8, 9, 11.

- [ ] **Step 1: Write the failing test**

Create `lib/checkout/minimum-order-copy.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { evaluateMinimumOrder } from './minimum-order'
import { MINIMUM_ORDER_CONTACT_EMAIL, minimumOrderCopy } from './minimum-order-copy'

function gated(value: number, currency = 'NZD') {
  return evaluateMinimumOrder({
    orderType: 'purchase_order',
    notionalValue: value,
    currency,
    exemptions: {
      orgExempt: false,
      isTest: false,
      isInventoryIntent: false,
      allPreOrder: false,
    },
  })
}

describe('minimumOrderCopy', () => {
  it('states the threshold, the order value and the shortfall', () => {
    const copy = minimumOrderCopy(gated(380))
    expect(copy.sentence).toBe(
      'Made-to-order orders have a $500 minimum (excl. GST). This order is $380 — ' +
        'add $120 to continue, or talk to us about smaller runs.',
    )
  })

  it('keeps cents when the amounts are not whole', () => {
    const copy = minimumOrderCopy(gated(379.5))
    expect(copy.sentence).toContain('This order is $379.50')
    expect(copy.sentence).toContain('add $120.50 to continue')
  })

  it('softens the wording when an exemption may still apply', () => {
    const copy = minimumOrderCopy(gated(380), { tentative: true })
    expect(copy.sentence).toBe(
      'Made-to-order orders have a $500 minimum (excl. GST). This order may be below ' +
        'the minimum at $380 — add $120, or talk to us about smaller runs.',
    )
  })

  it('splits the sentence so the CTA can render as an inline link', () => {
    const copy = minimumOrderCopy(gated(380))
    expect(copy.sentence).toBe(`${copy.lead}${copy.ctaLabel}.`)
    expect(copy.ctaLabel).toBe('talk to us about smaller runs')
  })

  it('builds a mailto with a prefilled subject', () => {
    const copy = minimumOrderCopy(gated(380))
    expect(copy.mailto).toBe(
      `mailto:${MINIMUM_ORDER_CONTACT_EMAIL}?subject=${encodeURIComponent('Order below $500 minimum')}`,
    )
  })

  it('renders AUD amounts in AUD', () => {
    const copy = minimumOrderCopy(gated(460, 'AUD'))
    expect(copy.sentence).toContain('$500 minimum')
    expect(copy.sentence).toContain('This order is $460')
    expect(copy.sentence).toContain('add $40 to continue')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/checkout/minimum-order-copy.test.ts`
Expected: FAIL — `Failed to resolve import "./minimum-order-copy"`.

- [ ] **Step 3: Write the implementation**

Create `lib/checkout/minimum-order-copy.ts`:

```ts
// Customer-facing copy for the $500 purchase-order minimum. One module so the
// cart banner, the checkout banner and the API error message cannot drift apart.
import { formatCurrency } from '@/lib/currency/format'
import type { MinimumOrderStatus } from '@/lib/checkout/minimum-order'

export const MINIMUM_ORDER_CONTACT_EMAIL = 'hello@theprint-room.co.nz'

export interface MinimumOrderCopy {
  /** The complete sentence. Use where a link cannot render (API message, aria-label). */
  sentence: string
  /** Everything before the CTA, so the CTA can be an inline <a>. Ends with ", or ". */
  lead: string
  ctaLabel: string
  mailto: string
}

/**
 * "$500.00 minimum" reads badly, "$379.50" must keep its cents. Whole amounts
 * drop the decimals; fractional amounts keep them. Guarded on Number.isInteger
 * rather than string-matching, so it is locale-safe.
 */
function money(amount: number, currency: string): string {
  const formatted = formatCurrency(amount, currency)
  return Number.isInteger(amount) ? formatted.replace(/[.,]00\b/, '') : formatted
}

export function minimumOrderCopy(
  status: MinimumOrderStatus,
  options: { tentative?: boolean } = {},
): MinimumOrderCopy {
  const threshold = money(status.threshold, status.currency)
  const value = money(status.value, status.currency)
  const shortfall = money(status.shortfall, status.currency)
  const lead = options.tentative
    ? `Made-to-order orders have a ${threshold} minimum (excl. GST). This order may be ` +
      `below the minimum at ${value} — add ${shortfall}, or `
    : `Made-to-order orders have a ${threshold} minimum (excl. GST). This order is ` +
      `${value} — add ${shortfall} to continue, or `
  const ctaLabel = 'talk to us about smaller runs'
  return {
    sentence: `${lead}${ctaLabel}.`,
    lead,
    ctaLabel,
    mailto:
      `mailto:${MINIMUM_ORDER_CONTACT_EMAIL}` +
      `?subject=${encodeURIComponent(`Order below ${threshold} minimum`)}`,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/checkout/minimum-order-copy.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/checkout/minimum-order-copy.ts lib/checkout/minimum-order-copy.test.ts
git commit -m "feat: add shared customer copy for the minimum order gate"
```

---

### Task 7: The typed error and the submit backstop

The hard stop. Nothing under-minimum reaches the database even if the UI is bypassed, a stale tab replays a request, or a client-side check is defeated.

**Files:**
- Modify: `lib/checkout/errors.ts` (append)
- Modify: `lib/checkout/submit.ts:41-70` (imports/re-exports), `:353` (the throw)
- Test: `lib/checkout/__tests__/submit.minimum-order.test.ts`

**Interfaces:**
- Consumes: `MinimumOrderStatus` (Task 2); `minimumOrderCopy` (Task 6); `prepared.minimumOrder` (Task 5).
- Produces: `MinimumOrderValueError { code: 'minimum_order_value', status, message }`, re-exported from `lib/checkout/submit.ts`. Consumed by Task 8.

- [ ] **Step 1: Write the failing test**

Create `lib/checkout/__tests__/submit.minimum-order.test.ts`:

```ts
/**
 * The submit backstop. The single property that matters: when the gate blocks,
 * `submit_b2b_order_for_country` is NEVER called. Everything else about the
 * order is irrelevant if a sub-minimum order can reach the database.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/monday/deal-item', () => ({
  pushOrderDeal: vi.fn().mockResolvedValue({ itemId: 'mky-1', subitemIds: {} }),
}))
vi.mock('@/lib/email/order-confirmation', () => ({
  sendOrderConfirmation: vi.fn().mockResolvedValue({ success: true }),
}))
vi.mock('@/lib/proofs/autofill-for-order', () => ({
  autofillProofForOrder: vi.fn().mockResolvedValue({ proofId: null, skipped: null }),
}))
vi.mock('@/lib/orders/job-tracker', () => ({
  createJobTrackerShellForOrder: vi
    .fn()
    .mockResolvedValue({ trackerId: 't-test', trackerToken: 'TOKEN-X' }),
}))
vi.mock('@/lib/monday/updates', () => ({
  postItemUpdate: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/xero/draft-invoice', () => ({
  createDraftInvoiceForOrder: vi.fn().mockResolvedValue({ status: 'skipped', reason: 'test' }),
}))

import {
  MinimumOrderValueError,
  submitCustomerOrder,
  type CheckoutInput,
} from '../submit'
import { makeFanoutStub, makeContext, type StubConfig } from './fanout-test-stub'

const ORG = 'org-1'
const CAT = 'cat-1'
const ITEM = 'item-tee'
const PRODUCT = 'prod-tee'

/** One made-to-order tee line. Unit price and qty are the test's only lever. */
function world(garmentUnitPrice: number): StubConfig {
  return {
    items: [
      {
        id: ITEM,
        sourceProductId: PRODUCT,
        priceMode: 'computed' as const,
        catalogueId: CAT,
      },
    ],
    products: [{ id: PRODUCT, name: 'Tee' }],
    links: [],
    garmentUnitPrice,
  }
}

function input(
  qty: number,
  overrides: { minOrderExempt?: boolean; intent?: 'customer' | 'inventory' } = {},
): CheckoutInput {
  return {
    context: {
      ...makeContext(ORG),
      minOrderExempt: overrides.minOrderExempt ?? false,
    },
    idempotency_key: `idem-${qty}-${overrides.intent ?? 'customer'}`,
    ...(overrides.intent ? { intent: overrides.intent } : {}),
    lines: [
      {
        product_id: PRODUCT,
        product_name: 'Tee',
        variant_id: 'var-1',
        qty,
        unit_price: 10,
        catalogueItemId: ITEM,
        fulfilment_type: 'made_to_order',
        decorations: [],
      },
    ],
  } as unknown as CheckoutInput
}

let stub: ReturnType<typeof makeFanoutStub>

function submitRpcCalls() {
  return stub.rpcCalls.filter((call) => call.name === 'submit_b2b_order_for_country')
}

describe('submitCustomerOrder minimum order value', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws before the order RPC when a purchase order is under the minimum', async () => {
    stub = makeFanoutStub(world(10))
    // 30 x $10 = $300 notional, under $500.
    await expect(submitCustomerOrder(stub.admin, input(30))).rejects.toBeInstanceOf(
      MinimumOrderValueError,
    )
    expect(submitRpcCalls()).toHaveLength(0)
  })

  it('carries the status and a customer-ready message on the error', async () => {
    stub = makeFanoutStub(world(10))
    const error = await submitCustomerOrder(stub.admin, input(30)).catch((e) => e)
    expect(error).toBeInstanceOf(MinimumOrderValueError)
    expect(error.code).toBe('minimum_order_value')
    expect(error.status.threshold).toBe(500)
    expect(error.status.value).toBe(300)
    expect(error.status.shortfall).toBe(200)
    expect(error.message).toContain('$500 minimum')
    expect(error.message).toContain('talk to us about smaller runs')
  })

  it('lets an order at the minimum through to the RPC', async () => {
    stub = makeFanoutStub(world(10))
    // 50 x $10 = $500 exactly.
    await submitCustomerOrder(stub.admin, input(50))
    expect(submitRpcCalls()).toHaveLength(1)
  })

  it('lets an exempt org through under the minimum', async () => {
    stub = makeFanoutStub(world(10))
    await submitCustomerOrder(stub.admin, input(30, { minOrderExempt: true }))
    expect(submitRpcCalls()).toHaveLength(1)
  })

  it('lets an inventory-intent order through under the minimum', async () => {
    stub = makeFanoutStub(world(10))
    await submitCustomerOrder(stub.admin, input(30, { intent: 'inventory' }))
    expect(submitRpcCalls()).toHaveLength(1)
  })
})
```

> **Note for the implementer:** `makeFanoutStub`'s `StubConfig` shape is defined at `lib/checkout/__tests__/fanout-test-stub.ts:71-124` and `makeContext` at `:529`. If a field name in `world()` or `input()` above does not match the current stub — the stub has grown over time — fix the fixture to match the stub, never the other way around. Read `lib/checkout/__tests__/submit.pooled-decoration.test.ts` for a worked example of the same fixture shape.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/checkout/__tests__/submit.minimum-order.test.ts`
Expected: FAIL — `MinimumOrderValueError` is not exported from `../submit`.

- [ ] **Step 3: Add the error class**

Append to `lib/checkout/errors.ts`:

```ts
export class MinimumOrderValueError extends Error {
  readonly code = 'minimum_order_value'
  readonly status: MinimumOrderStatus

  constructor(status: MinimumOrderStatus) {
    // The message IS the customer-facing sentence, not a code. With country
    // partitioning on, submit failures come back as a 207 outcome whose `error`
    // string is rendered verbatim (app/api/checkout/route.ts:388), so a bare
    // code would surface to the customer as gibberish.
    super(minimumOrderCopy(status).sentence)
    this.name = 'MinimumOrderValueError'
    this.status = status
  }
}
```

and add these imports at the top of `lib/checkout/errors.ts`, after the existing `BillingMode` import:

```ts
import type { MinimumOrderStatus } from '@/lib/checkout/minimum-order'
import { minimumOrderCopy } from '@/lib/checkout/minimum-order-copy'
```

- [ ] **Step 4: Re-export it from submit.ts**

In `lib/checkout/submit.ts`, add `MinimumOrderValueError,` to the import block from `@/lib/checkout/errors` (currently lines 41-57, alphabetically after `MemberAccessDriftError`), and add the same name to the `export { ... }` block (currently lines 59-68, same position).

- [ ] **Step 5: Throw it in `submitCustomerOrder`**

In `lib/checkout/submit.ts`, immediately after the closing `} = preparedCheckoutInternalsFor(prepared)` line (currently line 353) and before `const isStockOnHandOrder = ...`, insert:

```ts
  // The $500 hard stop. READ the prepared verdict, never recompute it — prepare
  // resolved all four exemptions, and re-deriving here would let the displayed
  // and enforced answers drift apart. Placed before every side effect so nothing
  // is written for an order that cannot be placed.
  if (!prepared.minimumOrder.met) {
    throw new MinimumOrderValueError(prepared.minimumOrder)
  }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run lib/checkout/__tests__/submit.minimum-order.test.ts`
Expected: PASS — 5 tests.

Run: `npx vitest run lib/checkout`
Expected: PASS. Existing submit suites use `makeContext`, whose orders are large enough or whose `orderType` is stock — if any suite now fails with `MinimumOrderValueError`, that suite's fixture is a sub-$500 purchase order; add `minOrderExempt: true` to **that suite's context** rather than weakening the gate.

- [ ] **Step 7: Commit**

```bash
git add lib/checkout/errors.ts lib/checkout/submit.ts lib/checkout/__tests__/submit.minimum-order.test.ts
git commit -m "feat: block sub-\$500 purchase orders before the checkout RPC"
```

---

### Task 8: Map the error in the checkout API route

Two mappings, because the route has two failure shapes: a 207 per-partition outcome when country partitioning is on, and a top-level catch when it is off.

**Files:**
- Modify: `app/api/checkout/route.ts:4-16` (imports), `~:107` (`partitionFailureOutcome`), `~:473` (the catch)
- Test: `app/api/checkout/__tests__/route.minimum-order.test.ts`

**Interfaces:**
- Consumes: `MinimumOrderValueError` (Task 7).
- Produces: HTTP 422 `{ code: 'minimum_order_value', status, message }`; 207 outcome `{ ok: false, code: 'minimum_order_value', error, detail }`. Consumed by Task 9.

- [ ] **Step 1: Write the failing test**

Create `app/api/checkout/__tests__/route.minimum-order.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))
vi.mock('@/lib/checkout/server', () => ({ requireB2BCustomerApi: vi.fn() }))

const submitMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/checkout/submit', async () => {
  const errors = await import('@/lib/checkout/errors')
  return {
    ...errors,
    submitCustomerOrder: submitMock,
  }
})

import { MinimumOrderValueError } from '@/lib/checkout/errors'
import { requireB2BCustomerApi } from '@/lib/checkout/server'
import { POST } from '../route'

const GATED = {
  applies: true,
  met: false,
  threshold: 500,
  currency: 'NZD',
  value: 380,
  shortfall: 120,
}

function body() {
  return {
    idempotency_key: 'idem-1',
    terms_accepted: true,
    terms_version: 'v1',
    lines: [
      {
        product_id: 'p1',
        product_name: 'Tee',
        variant_id: 'v1',
        qty: 10,
        unit_price: 38,
        fulfilment_type: 'made_to_order',
        decorations: [],
      },
    ],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireB2BCustomerApi).mockResolvedValue({
    admin: { from: vi.fn(), rpc: vi.fn() },
    context: {
      organizationId: 'org-1',
      customerCode: 'ACME',
      role: 'org_admin',
      storeIds: [],
      branchStoreIds: [],
      defaultStoreId: null,
      orderingPermission: 'both',
    },
  } as unknown as Awaited<ReturnType<typeof requireB2BCustomerApi>>)
})

describe('POST /api/checkout minimum order value', () => {
  it('returns 422 with the code, the status and the customer message', async () => {
    submitMock.mockRejectedValue(new MinimumOrderValueError(GATED))

    const res = await POST(
      new Request('http://localhost/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body()),
      }),
    )

    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.code).toBe('minimum_order_value')
    expect(json.status).toEqual(GATED)
    expect(json.message).toContain('$500 minimum')
  })
})
```

> **Note for the implementer:** the route performs several validations before it reaches `submitCustomerOrder` (terms, ship-to scope, country enablement). If this test 400s instead of 422, read `app/api/checkout/route.ts:153-270` and extend the request body / mocked context until the request reaches submit. Do not relax the route's validations to make the test pass.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/api/checkout/__tests__/route.minimum-order.test.ts`
Expected: FAIL — status is 500 (the generic fall-through), not 422.

- [ ] **Step 3: Import the error**

In `app/api/checkout/route.ts`, add `MinimumOrderValueError,` to the import block from `@/lib/checkout/submit` (currently lines 4-16), alphabetically after `MemberAccessDriftError`.

- [ ] **Step 4: Map it in `partitionFailureOutcome`**

In `app/api/checkout/route.ts`, immediately before the existing `if (error instanceof MoqViolationError) {` branch (currently line 107), insert:

```ts
  if (error instanceof MinimumOrderValueError) {
    // `error` renders verbatim in the partition failure UI, and
    // MinimumOrderValueError.message is already the finished sentence.
    return { ...base, code: error.code, error: error.message, detail: error.status }
  }
```

- [ ] **Step 5: Map it in the top-level catch**

In `app/api/checkout/route.ts`, immediately before the existing `if (e instanceof MoqViolationError) {` branch in the catch block (currently line 473), insert:

```ts
    if (e instanceof MinimumOrderValueError) {
      // 422, not 409: nothing raced or drifted — the order is simply too small.
      return NextResponse.json(
        { code: e.code, status: e.status, message: e.message },
        { status: 422 },
      )
    }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run app/api/checkout/__tests__/route.minimum-order.test.ts`
Expected: PASS — 1 test.

Run: `npx vitest run app/api/checkout`
Expected: PASS — the existing route suites are unaffected.

- [ ] **Step 7: Commit**

```bash
git add app/api/checkout/route.ts app/api/checkout/__tests__/route.minimum-order.test.ts
git commit -m "feat: map MinimumOrderValueError to 422 and to a partition outcome"
```

---

### Task 9: The shared notice component

**Files:**
- Create: `components/checkout/MinimumOrderNotice.tsx`
- Test: `components/checkout/__tests__/MinimumOrderNotice.test.tsx`

**Interfaces:**
- Consumes: `MinimumOrderStatus` (Task 2); `minimumOrderCopy` (Task 6).
- Produces: `<MinimumOrderNotice status={...} tentative={...} />`. Consumed by Tasks 10, 11.

- [ ] **Step 1: Write the failing test**

Create `components/checkout/__tests__/MinimumOrderNotice.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MinimumOrderNotice } from '../MinimumOrderNotice'

const GATED = {
  applies: true,
  met: false,
  threshold: 500,
  currency: 'NZD',
  value: 380,
  shortfall: 120,
}

describe('MinimumOrderNotice', () => {
  it('states the threshold, the value and the shortfall', () => {
    render(<MinimumOrderNotice status={GATED} />)
    const notice = screen.getByTestId('minimum-order-notice')
    expect(notice.textContent).toBe(
      'Made-to-order orders have a $500 minimum (excl. GST). This order is $380 — ' +
        'add $120 to continue, or talk to us about smaller runs.',
    )
  })

  it('renders the CTA as a mailto link with a prefilled subject', () => {
    render(<MinimumOrderNotice status={GATED} />)
    const link = screen.getByRole('link', { name: 'talk to us about smaller runs' })
    expect(link).toHaveAttribute(
      'href',
      `mailto:hello@theprint-room.co.nz?subject=${encodeURIComponent('Order below $500 minimum')}`,
    )
  })

  it('announces a hard block as an alert', () => {
    render(<MinimumOrderNotice status={GATED} />)
    expect(screen.getByRole('alert')).toBeTruthy()
  })

  it('uses the softer wording and a status role when tentative', () => {
    render(<MinimumOrderNotice status={GATED} tentative />)
    expect(screen.getByTestId('minimum-order-notice').textContent).toContain(
      'may be below the minimum at $380',
    )
    expect(screen.getByRole('status')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run components/checkout/__tests__/MinimumOrderNotice.test.tsx`
Expected: FAIL — `Failed to resolve import "../MinimumOrderNotice"`.

- [ ] **Step 3: Write the component**

Create `components/checkout/MinimumOrderNotice.tsx`:

```tsx
'use client'

import type { MinimumOrderStatus } from '@/lib/checkout/minimum-order'
import { minimumOrderCopy } from '@/lib/checkout/minimum-order-copy'

/**
 * The one rendering of the $500 gate. Shared by the cart drawer and both
 * checkout clients so the customer reads the same sentence wherever they meet it.
 *
 * `tentative` = the cart could not rule out an exemption (inventory intent is a
 * checkout-time toggle; the open period may still be loading). It softens the
 * wording and drops the alert role, because the order may still go through.
 */
export function MinimumOrderNotice({
  status,
  tentative = false,
}: {
  status: MinimumOrderStatus
  tentative?: boolean
}) {
  const copy = minimumOrderCopy(status, { tentative })
  return (
    <div
      data-testid="minimum-order-notice"
      role={tentative ? 'status' : 'alert'}
      className={`rounded-xl border p-4 text-sm ${
        tentative
          ? 'border-amber-200 bg-amber-50 text-amber-900'
          : 'border-red-200 bg-red-50 text-red-900'
      }`}
    >
      {copy.lead}
      <a className="font-medium underline" href={copy.mailto}>
        {copy.ctaLabel}
      </a>
      .
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run components/checkout/__tests__/MinimumOrderNotice.test.tsx`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add components/checkout/MinimumOrderNotice.tsx components/checkout/__tests__/MinimumOrderNotice.test.tsx
git commit -m "feat: add shared minimum-order notice component"
```

---

### Task 10: Wire the gate into both checkout clients

Two surfaces: `/checkout` (proceed to review) and `/checkout/review` (place order). The banner from the prepared annotation renders only when country partitioning is on — that is the only configuration in which the preview runs. The 422 handler is unconditional and carries the block when the flag is off.

**Files:**
- Modify: `components/checkout/CheckoutClient.tsx:~249` (derive), `:274-284` (gate), `:383` (render)
- Modify: `components/checkout/CheckoutReviewClient.tsx:~218` (derive), `:442` (422 handler), `:761` (render), `:982-990` (gate)
- Test: `components/checkout/__tests__/CheckoutReviewClient.minimum-order.test.tsx`

**Interfaces:**
- Consumes: `prepared.minimumOrder` via `PreviewPartitionOutcome` (Task 5); 422 body (Task 8); `MinimumOrderNotice` (Task 9).
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

Create `components/checkout/__tests__/CheckoutReviewClient.minimum-order.test.tsx`:

```tsx
/**
 * The 422 path is the PRIMARY customer-facing block whenever
 * CHECKOUT_COUNTRY_PARTITION_ENABLED is off, because useCheckoutPreview does not
 * fire in that configuration. This test pins the mapping from the API body to the
 * banner, without standing up the whole review screen.
 */
import { describe, expect, it } from 'vitest'
import { minimumOrderCopy } from '@/lib/checkout/minimum-order-copy'
import { readMinimumOrderRejection } from '../CheckoutReviewClient'

describe('readMinimumOrderRejection', () => {
  it('renders the server message when the API sends one', () => {
    const status = {
      applies: true,
      met: false,
      threshold: 500,
      currency: 'NZD',
      value: 380,
      shortfall: 120,
    }
    expect(
      readMinimumOrderRejection({
        code: 'minimum_order_value',
        status,
        message: minimumOrderCopy(status).sentence,
      }),
    ).toContain('add $120 to continue')
  })

  it('rebuilds the message from the status when the API omits it', () => {
    expect(
      readMinimumOrderRejection({
        code: 'minimum_order_value',
        status: {
          applies: true,
          met: false,
          threshold: 500,
          currency: 'AUD',
          value: 460,
          shortfall: 40,
        },
      }),
    ).toContain('add $40 to continue')
  })

  it('falls back to a generic sentence when the body is unusable', () => {
    expect(readMinimumOrderRejection({})).toBe('This order could not be submitted.')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run components/checkout/__tests__/CheckoutReviewClient.minimum-order.test.tsx`
Expected: FAIL — `readMinimumOrderRejection` is not exported.

- [ ] **Step 3: Add the exported helper to the review client**

In `components/checkout/CheckoutReviewClient.tsx`, add these imports near the existing checkout imports:

```ts
import type { MinimumOrderStatus } from '@/lib/checkout/minimum-order'
import { minimumOrderCopy } from '@/lib/checkout/minimum-order-copy'
import { MinimumOrderNotice } from './MinimumOrderNotice'
```

Then add this exported function immediately above `export function CheckoutReviewClient({` (currently line 94):

```ts
/**
 * Turns a 422 body into banner text. The server already sends the finished
 * sentence; the status rebuild is the belt-and-braces path for an older
 * deployment that sends only `status`.
 */
export function readMinimumOrderRejection(body: {
  code?: string
  status?: MinimumOrderStatus
  message?: string
}): string {
  if (body.message) return body.message
  if (body.status) return minimumOrderCopy(body.status).sentence
  return 'This order could not be submitted.'
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run components/checkout/__tests__/CheckoutReviewClient.minimum-order.test.tsx`
Expected: PASS — 3 tests.

- [ ] **Step 5: Handle the 422 in `confirmOrder`**

In `components/checkout/CheckoutReviewClient.tsx`, immediately before the existing `if (res.status === 409) {` (currently line 442), insert:

```ts
      if (res.status === 422) {
        const data = (await res.json().catch(() => ({}))) as {
          code?: string
          status?: MinimumOrderStatus
          message?: string
        }
        setBanner({ kind: 'error', msg: readMinimumOrderRejection(data) })
        return
      }
```

- [ ] **Step 6: Derive the blocked partitions and gate the Place Order button**

In `components/checkout/CheckoutReviewClient.tsx`, immediately after the `previewFailures` declaration (which begins at line 219), insert:

```ts
  // Only populated when country partitioning is on — useCheckoutPreview does not
  // fire otherwise, and the 422 handler above carries the block in that case.
  const minimumOrderBlocks = previewSuccesses
    .map((outcome) => outcome.partition.minimumOrder)
    .filter((status) => !status.met)
```

Then in the `<CheckoutCTAStickyBar>` `disabled={...}` expression (currently lines 982-990), add a final clause so it reads:

```tsx
        disabled={
          !pricingReady ||
          isPreview ||
          !customerCode ||
          minimumOrderBlocks.length > 0 ||
          (countryPartitionEnabled &&
            (preview.status !== 'ready' ||
              preview.partitions.length === 0 ||
              previewFailures.length > 0))
        }
```

- [ ] **Step 7: Render the notice on the review screen**

In `components/checkout/CheckoutReviewClient.tsx`, immediately after the closing `)}` of the existing `{banner && (...)}` block (currently line 761), insert:

```tsx
      {minimumOrderBlocks.map((status) => (
        <MinimumOrderNotice key={`${status.currency}-${status.value}`} status={status} />
      ))}
```

- [ ] **Step 8: Do the same on the first checkout screen**

In `components/checkout/CheckoutClient.tsx`, add the import:

```ts
import { MinimumOrderNotice } from './MinimumOrderNotice'
```

Immediately after the `previewFailures` declaration (which begins at line 250), insert:

```ts
  const minimumOrderBlocks = previewSuccesses
    .map((outcome) => outcome.partition.minimumOrder)
    .filter((status) => !status.met)
```

Add the clause to `canSubmitOrder` (currently lines 274-284) so it reads:

```ts
  const canSubmitOrder =
    !submitting &&
    cart.lines.length > 0 &&
    !customerCodeMissing &&
    !mixedCustom &&
    !customIncomplete &&
    !buyerMisconfigured &&
    minimumOrderBlocks.length === 0 &&
    (!countryPartitionEnabled ||
      (preview.status === 'ready' &&
        preview.partitions.length > 0 &&
        previewFailures.length === 0))
```

And immediately after the closing `)}` of the `{banner && (...)}` block (currently line 383), insert:

```tsx
      {minimumOrderBlocks.map((status) => (
        <MinimumOrderNotice key={`${status.currency}-${status.value}`} status={status} />
      ))}
```

- [ ] **Step 9: Verify**

Run: `npx vitest run components/checkout`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 10: Commit**

```bash
git add components/checkout/CheckoutClient.tsx components/checkout/CheckoutReviewClient.tsx components/checkout/__tests__/CheckoutReviewClient.minimum-order.test.tsx
git commit -m "feat: surface and enforce the minimum order gate in both checkout clients"
```

---

### Task 11: Cart drawer hint

The advisory layer. It may warn on an order checkout later clears; it must never be the only thing blocking one.

**Files:**
- Create: `components/cart/usePeriodSummary.ts`
- Modify: `app/(portal)/layout.tsx:31-55`, `contexts/CompanyContext.tsx:14-19` and `:27-39` and `:93-96`
- Modify: `components/cart/CartDrawer.tsx`
- Test: `components/cart/__tests__/CartDrawer.minimum-order.test.tsx`

**Interfaces:**
- Consumes: `evaluateCartMinimumOrder` (Task 3); `MinimumOrderNotice` (Task 9); `classifyOrderType` from `lib/orders/order-type.ts`; `readMinOrderExempt` (Task 4).
- Produces: `usePeriodSummary(catalogueItemIds) => { preOrderItemIds, loading }`; `useCompany().minimumOrderExemptions: { orgExempt, isTest }`.

- [ ] **Step 1: Write the failing test**

Create `components/cart/__tests__/CartDrawer.minimum-order.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CartLine } from '@/lib/cart/types'

vi.mock('@/app/(portal)/cart/PeriodSavingsBar', () => ({
  PeriodSavingsBar: () => null,
}))
vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({ format: (n: number) => `$${n.toFixed(2)}` }),
}))
vi.mock('@/components/layout/PortalTopBarContext', () => ({
  useCartDrawer: () => ({ open: true, setOpen: vi.fn() }),
}))
vi.mock('next/navigation', () => ({
  usePathname: () => '/catalogue',
  useRouter: () => ({ push: vi.fn() }),
}))

const company = vi.hoisted(() => ({
  value: {
    access: { role: 'org_admin', isBuyer: false, tenantType: null },
    countryPartitionEnabled: false,
    defaultBillingCountry: {
      code: 'NZ',
      name: 'New Zealand',
      currency: 'NZD',
      taxRate: 0.15,
      taxLabel: 'GST 15%',
      isDefault: true,
    },
    minimumOrderExemptions: { orgExempt: false, isTest: false },
  },
}))
vi.mock('@/contexts/CompanyContext', () => ({
  useCompany: () => company.value,
}))

const cart = vi.hoisted(() => ({ lines: [] as CartLine[] }))
vi.mock('../useCart', () => ({
  useCart: () => ({
    lines: cart.lines,
    updateLine: vi.fn(),
    removeLine: vi.fn(),
    setFulfilmentType: vi.fn(),
  }),
}))

import { CartDrawer } from '../CartDrawer'

function line(overrides: Partial<CartLine> = {}): CartLine {
  return {
    lineId: 'line-1',
    productId: 'product-1',
    productName: 'Canvas Tote',
    variantId: 'variant-1',
    variantLabel: 'Natural',
    qty: 38,
    unitPrice: 10,
    imageUrl: null,
    decorations: [],
    fulfilmentType: 'made_to_order',
    catalogueItemId: 'item-1',
    ...overrides,
  } as CartLine
}

/** No open ordering period. */
function stubNoPeriod() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ period: null, items: [] }) })),
  )
}

beforeEach(() => {
  vi.unstubAllGlobals()
  stubNoPeriod()
  cart.lines = [line()]
  company.value.access = { role: 'org_admin', isBuyer: false, tenantType: null }
  company.value.minimumOrderExemptions = { orgExempt: false, isTest: false }
})

describe('CartDrawer $500 minimum', () => {
  it('shows the notice and disables checkout when no exemption is possible', async () => {
    render(<CartDrawer />)
    await waitFor(() =>
      expect(screen.getByTestId('minimum-order-notice')).toBeTruthy(),
    )
    expect(screen.getByTestId('minimum-order-notice').textContent).toContain(
      'add $120 to continue',
    )
    expect(
      screen.getByRole('button', { name: 'Proceed to Checkout' }),
    ).toBeDisabled()
  })

  it('warns but leaves checkout enabled when the org can route to inventory', async () => {
    company.value.access = { role: 'org_admin', isBuyer: false, tenantType: 'franchise' }
    render(<CartDrawer />)
    await waitFor(() =>
      expect(screen.getByTestId('minimum-order-notice')).toBeTruthy(),
    )
    expect(screen.getByTestId('minimum-order-notice').textContent).toContain(
      'may be below the minimum',
    )
    expect(
      screen.getByRole('button', { name: 'Proceed to Checkout' }),
    ).not.toBeDisabled()
  })

  it('shows nothing for an exempt org', async () => {
    company.value.minimumOrderExemptions = { orgExempt: true, isTest: false }
    render(<CartDrawer />)
    await waitFor(() =>
      expect(screen.queryByTestId('minimum-order-notice')).toBeNull(),
    )
    expect(
      screen.getByRole('button', { name: 'Proceed to Checkout' }),
    ).not.toBeDisabled()
  })

  it('shows nothing once the cart clears the minimum', async () => {
    cart.lines = [line({ qty: 50 })]
    render(<CartDrawer />)
    await waitFor(() =>
      expect(screen.queryByTestId('minimum-order-notice')).toBeNull(),
    )
  })

  it('shows nothing for a stocked cart', async () => {
    cart.lines = [line({ fulfilmentType: 'stocked' })]
    render(<CartDrawer />)
    await waitFor(() =>
      expect(screen.queryByTestId('minimum-order-notice')).toBeNull(),
    )
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run components/cart/__tests__/CartDrawer.minimum-order.test.tsx`
Expected: FAIL — `minimum-order-notice` is never found.

- [ ] **Step 3: Write the period-membership hook**

Create `components/cart/usePeriodSummary.ts`:

```ts
'use client'

import { useEffect, useMemo, useState } from 'react'

const EMPTY: ReadonlySet<string> = new Set()

export interface PeriodMembership {
  /** Cart catalogue item ids that belong to the org's open ordering period. */
  preOrderItemIds: ReadonlySet<string>
  /** True until the lookup resolves. Callers must not hard-block while true. */
  loading: boolean
}

/**
 * Which cart items are pre-order period items.
 *
 * /api/period/summary returns rows from period_progress_for_org filtered to the
 * requested ids, so an item appearing in `items` IS in the open period. The qty
 * we send is irrelevant to membership, so it is fixed at 1.
 *
 * Note: PeriodSavingsBar issues the same GET for its savings copy. Collapsing the
 * two would mean making that component presentational and rewriting its tests —
 * out of scope here. See the follow-ups in the plan.
 */
export function usePeriodSummary(
  catalogueItemIds: ReadonlyArray<string>,
): PeriodMembership {
  const key = useMemo(
    () => [...new Set(catalogueItemIds)].sort().join('|'),
    [catalogueItemIds],
  )
  const [settled, setSettled] = useState<{ key: string; ids: ReadonlySet<string> }>({
    key: '',
    ids: EMPTY,
  })

  useEffect(() => {
    if (!key) return
    const controller = new AbortController()
    const params = new URLSearchParams()
    for (const id of key.split('|')) params.append('item', `${id}:1`)

    fetch(`/api/period/summary?${params.toString()}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { items?: Array<{ catalogueItemId: string }> } | null) => {
        if (controller.signal.aborted) return
        setSettled({
          key,
          ids: new Set((body?.items ?? []).map((item) => item.catalogueItemId)),
        })
      })
      // A failed lookup leaves `loading` true, which downgrades a block to a
      // warning. Erring toward "do not block" is the whole point of this layer.
      .catch(() => {})

    return () => controller.abort()
  }, [key])

  if (!key) return { preOrderItemIds: EMPTY, loading: false }
  return settled.key === key
    ? { preOrderItemIds: settled.ids, loading: false }
    : { preOrderItemIds: EMPTY, loading: true }
}
```

- [ ] **Step 4: Carry the org exemptions to the client**

In `contexts/CompanyContext.tsx`, add to `CompanyContextType` (currently lines 14-19):

```ts
  /**
   * organizations.min_order_exempt + is_test, resolved server-side in the portal
   * layout. Read by the cart drawer so an exempt org never sees the $500 notice.
   */
  minimumOrderExemptions: { orgExempt: boolean; isTest: boolean }
```

Add the prop to the `CompanyProvider` signature (currently lines 27-39):

```ts
export function CompanyProvider({
  children,
  initialAccess = null,
  initialUserId = null,
  countryPartitionEnabled = false,
  defaultBillingCountry,
  minimumOrderExemptions = { orgExempt: false, isTest: false },
}: {
  children: ReactNode
  initialAccess?: B2BCustomerAccess | null
  initialUserId?: string | null
  countryPartitionEnabled?: boolean
  defaultBillingCountry: BillingCountryConfig
  minimumOrderExemptions?: { orgExempt: boolean; isTest: boolean }
}) {
```

And add `minimumOrderExemptions,` to the context value object (currently lines 93-96).

- [ ] **Step 5: Resolve the exemptions in the portal layout**

In `app/(portal)/layout.tsx`, inside `CountryAwareCompanyProvider`, immediately after the `defaultBillingCountry` assignment (currently lines 31-33), insert:

```ts
  // Same tolerant read as the checkout context: min_order_exempt ships from the
  // staff repo on its own schedule, so a missing column must not blank the org.
  const minimumOrderExemptions = initialAccess?.companyId
    ? {
        orgExempt: await readMinOrderExempt(getSupabaseServer(), initialAccess.companyId),
        isTest: await readOrgIsTest(getSupabaseServer(), initialAccess.companyId),
      }
    : { orgExempt: false, isTest: false }
```

Add the import:

```ts
import { readMinOrderExempt, readOrgIsTest } from '@/lib/checkout/server'
```

And pass it to the provider (currently lines 41-46):

```tsx
    <CompanyProvider
      initialAccess={initialAccess}
      initialUserId={initialUserId}
      countryPartitionEnabled={countryPartitionEnabled}
      defaultBillingCountry={defaultBillingCountry}
      minimumOrderExemptions={minimumOrderExemptions}
    >
```

Add `readOrgIsTest` to `lib/checkout/server.ts`, immediately below `readMinOrderExempt`:

```ts
/** organizations.is_test, for surfaces that hold no B2BCustomerContext. */
export async function readOrgIsTest(
  admin: SupabaseClient,
  organizationId: string,
): Promise<boolean> {
  const { data } = await admin
    .from('organizations')
    .select('is_test')
    .eq('id', organizationId)
    .maybeSingle()
  return Boolean((data as { is_test?: boolean | null } | null)?.is_test)
}
```

- [ ] **Step 6: Render the notice in the cart drawer**

In `components/cart/CartDrawer.tsx`, add the imports:

```ts
import { classifyOrderType } from '@/lib/orders/order-type'
import { evaluateCartMinimumOrder } from '@/lib/checkout/minimum-order'
import { MinimumOrderNotice } from '@/components/checkout/MinimumOrderNotice'
import { usePeriodSummary } from './usePeriodSummary'
```

Add `minimumOrderExemptions` to the `useCompany()` destructure (currently lines 20-24):

```ts
  const {
    access,
    countryPartitionEnabled,
    defaultBillingCountry,
    minimumOrderExemptions,
  } = useCompany()
```

Immediately after the `stockedGoods` memo (currently line 70), insert:

```ts
  const cartCatalogueItemIds = useMemo(
    () => cart.lines.flatMap((line) => (line.catalogueItemId ? [line.catalogueItemId] : [])),
    [cart.lines],
  )
  const period = usePeriodSummary(cartCatalogueItemIds)
  // Mirrors CheckoutClient exactly: only these tenant types are offered the
  // inventory toggle, and only for a non-buyer.
  const canRouteToInventory =
    !access?.isBuyer &&
    (access?.tenantType === 'studio_plus_inventory' || access?.tenantType === 'franchise')
  const minimumOrder = useMemo(
    () =>
      evaluateCartMinimumOrder({
        // Same mapping the checkout preview sends, so cart and server agree:
        // an absent fulfilmentType is NOT 'stocked' and makes the cart a
        // purchase order.
        orderType: classifyOrderType(
          cart.lines.map((line) => ({ fulfilment_type: line.fulfilmentType })),
        ),
        // netSubtotal is goods + decoration ex-GST, excluding the picking fee.
        notionalValue: breakdown.netSubtotal,
        currency: canonicalCurrency ?? defaultBillingCountry.currency,
        orgExempt: minimumOrderExemptions.orgExempt,
        isTest: minimumOrderExemptions.isTest,
        canRouteToInventory: Boolean(canRouteToInventory),
        periodLookupPending: period.loading,
        preOrderItemIdsInCart: period.preOrderItemIds,
        lineCatalogueItemIds: cart.lines.map((line) => line.catalogueItemId),
      }),
    [
      cart.lines,
      breakdown.netSubtotal,
      canonicalCurrency,
      defaultBillingCountry.currency,
      minimumOrderExemptions.orgExempt,
      minimumOrderExemptions.isTest,
      canRouteToInventory,
      period.loading,
      period.preOrderItemIds,
    ],
  )
```

> `canonicalCurrency` is declared at line 79, after `stockedGoods`. Move the `const canonicalCurrency = cart.lines[0]?.priceCurrency` line above this block so it is defined before use.

Add the block to `canCheckout` (currently line 78):

```ts
  const canCheckout =
    cart.lines.length > 0 && !oversell && !moqShort && !minimumOrder.blocks
```

And immediately before the `{(oversell || moqShort) && (` block in the sticky footer (currently line 187), insert:

```tsx
              {(minimumOrder.blocks || minimumOrder.tentative) && (
                <div className="mb-2">
                  <MinimumOrderNotice
                    status={minimumOrder.status}
                    tentative={minimumOrder.tentative}
                  />
                </div>
              )}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run components/cart/__tests__/CartDrawer.minimum-order.test.tsx`
Expected: PASS — 5 tests.

Run: `npx vitest run components/cart`
Expected: PASS. The three existing `CartDrawer.*.test.tsx` suites mock `useCompany`; each needs `minimumOrderExemptions: { orgExempt: false, isTest: false }` added to its mocked value and a `fetch` stub for `/api/period/summary`. Add those, do not weaken the component.

- [ ] **Step 8: Commit**

```bash
git add components/cart/usePeriodSummary.ts components/cart/CartDrawer.tsx components/cart/__tests__ contexts/CompanyContext.tsx "app/(portal)/layout.tsx" lib/checkout/server.ts
git commit -m "feat: warn and gate on the \$500 minimum in the cart drawer"
```

---

### Task 12: Full verification and rollout notes

**Files:**
- Modify: `docs/superpowers/specs/2026-08-27-purchase-order-minimum-value-design.md` (follow-ups section)

- [ ] **Step 1: Run the whole suite**

Run: `npm test`
Expected: PASS. Compare the failure list against the pre-work baseline; there must be no new failures.

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no new errors. Record any pre-existing ones.

- [ ] **Step 3: Manual smoke (local dev)**

Run: `npm run dev`

Check each of these against a real org:

1. Cart with one made-to-order line under $500, org not exempt, no open period → amber-free red notice, "Proceed to Checkout" disabled.
2. Raise the qty past $500 → notice disappears, button enables.
3. Flip the line to `stocked` → notice never appears.
4. A franchise org under $500 → softer "may be below the minimum" wording, button **enabled**.
5. Force through to `/checkout/review` and place the order → red banner with the same sentence, no order created. Confirm in Supabase that no `orders` row appeared.

- [ ] **Step 4: Record the follow-ups**

Append to the "Follow-ups (out of scope)" section of `docs/superpowers/specs/2026-08-27-purchase-order-minimum-value-design.md`:

```markdown
- **`organizations.moq_exempt` is never read.** `lib/checkout/server.ts:117` selects
  `'id, name, customer_code, is_test'` but line 171 reads `org.moq_exempt`, so
  `context.moqExempt` is permanently `false`. `lib/preview/context.ts:21` documents
  the omission. Deliberately not fixed alongside the minimum-order work: fixing it
  would silently relax MOQ for every org staff has already flagged exempt, which
  needs its own decision.
- **Duplicate `/api/period/summary` GET in the cart drawer.** `usePeriodSummary` and
  `PeriodSavingsBar` each fetch it. Collapsing them means lifting the summary into
  `CartDrawer` and making `PeriodSavingsBar` presentational, which rewrites
  `components/cart/__tests__/PeriodSavingsBar.test.tsx`.
- **The checkout-layer banner is dark while `CHECKOUT_COUNTRY_PARTITION_ENABLED` is
  off**, because `useCheckoutPreview` does not fire in that configuration. The 422
  banner and the cart hint carry the block until the flag is on everywhere.
```

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-08-27-purchase-order-minimum-value-design.md
git commit -m "docs: record minimum-order follow-ups"
```

- [ ] **Step 6: Deploy in order**

1. Confirm Task 1's migration is applied in production (`select min_order_exempt from organizations limit 1;` succeeds).
2. Deploy `print-room-portal`.
3. Re-run the Step 3 smoke against production with a real sub-$500 made-to-order cart, and confirm no order row is created.

Do not deploy the portal before step 1. The reads are tolerant, so a portal deploy without the column degrades to "nobody is exempt" rather than breaking — but staff would have no way to grant an exemption.
