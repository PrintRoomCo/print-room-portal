# Spec A — Xero, Stock Handling & Portal UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Source spec:** [`2026-07-15-spec-a-xero-stock-portal-ux.md`](../../2026-07-15-spec-a-xero-stock-portal-ux.md) · **Evidence:** [`2026-07-15-xero-stock-handling-integrations.md`](../../2026-07-15-xero-stock-handling-integrations.md) · **Deferred half:** [`2026-07-15-spec-b-dispatch-integrations-plan.md`](./2026-07-15-spec-b-dispatch-integrations-plan.md)

**Goal:** Ship the decided build-now onboarding changes across the customer portal: the `orders.order_type` foundation, PDP price + mode UX, orders IA two-surface split, Monday note, order-placed notifications, and the simplified Xero draft-quote rule.

**Architecture:** Add an `orders.order_type` foundation, then layer independent portal UX + routing + notification + Xero changes on top. Almost entirely in `print-room-portal` (P), with one staff-portal data-config runbook (item 8). Every non-test order is invoiced; prepaid is deferred to Spec B.

**Tech Stack:** Next.js (app router), TypeScript, Supabase (service-role client), Vitest + Testing Library, Resend email, Slack incoming webhook, Monday.com, Xero (draft quotes).

## Global Constraints

- Repos: **P** = print-room-portal, **S** = print-room-staff-portal.
- Customer roles are ONLY `org_admin` | `staff` (`user_organizations.role`). `buildAccess()` (P `lib/company.ts`) is the single source of "is admin"; `canSeeAllOrgOrders = isOrgAdmin`. Access queries use a service-role client that BYPASSES RLS, so access control is application `.eq()` filtering, not Postgres policy.
- Per-line `fulfilment_type`: `'stocked'` (= Stock on hand, `isInventoryMode` true) | `'made_to_order'` (= Purchase order). The pill is the per-product `OrderIntentToggle` on the PDP.
- NEW foundation this plan adds: `orders.order_type` enum `'stock_on_hand'` | `'purchase_order'`. Interim rule: any `made_to_order` line ⇒ `purchase_order` (mixed cart stays one order until Spec B F1).
- Spec A invoices EVERY non-test order — there is NO paid/not-paid branch anywhere in Spec A. Prepaid is deferred to Spec B.
- Test/verification emails MUST go to `jamie@theprint-room.co.nz`. Production dispatch notifications go to `charlotte@theprint-room.co.nz` (env `DISPATCH_NOTIFICATION_EMAIL` default).
- `XERO_ENABLED` is deploy-dark and set in NO committed env; flipping it live is a release-time decision — this plan must NOT enable it, only make the code correct when it is on.
- Order-placed Slack notification uses env `SLACK_PORTAL_WEBHOOK_URL` and MUST no-op cleanly when the var is unset (ships before the channel exists).
- Demo/test org gate = `organizations.is_test`.
- DRY, YAGNI, TDD, frequent commits. Tests: `cd print-room-portal && npx vitest run <path>`.

Every task's requirements implicitly include this section.

---

## Tasks (in build order)

<!-- ===== Build step 1/8 · cluster: Foundation F-1: orders.order_type enum + stamp at submit ===== -->

### Task: orders.order_type column + classifyOrderType classifier

Adds the Foundation F-1 database column and a single pure classifier that every later Spec-A item (10/11/13/15) reads. This is the interface hub for the cluster.

**Files:**
- Create `/Users/jamierogangeorge/Documents/print-room-portal/lib/orders/order-type.ts` (new pure helper + exported `OrderType` type)
- Create `/Users/jamierogangeorge/Documents/print-room-portal/lib/orders/__tests__/order-type.test.ts` (new unit test; matched by the vitest include glob `lib/**/*.test.ts`)
- Create `/Users/jamierogangeorge/Documents/print-room-portal/supabase/migrations/20260715000000_orders_order_type.sql` (new migration)

**Interfaces:**
- Consumes: nothing (foundation).
- Produces:
  - `type OrderType = 'stock_on_hand' | 'purchase_order'`
  - `classifyOrderType(lines: ReadonlyArray<{ fulfilment_type?: 'stocked' | 'made_to_order' | null }>): OrderType` — returns `'stock_on_hand'` iff `lines` is non-empty AND every line's `fulfilment_type === 'stocked'`; otherwise `'purchase_order'`.
  - DB column `public.orders.order_type text NOT NULL DEFAULT 'purchase_order'` constrained by `orders_order_type_check` to `('stock_on_hand','purchase_order')`.

- [x] **Step 1: Write the failing unit test for classifyOrderType.**
  Create `/Users/jamierogangeorge/Documents/print-room-portal/lib/orders/__tests__/order-type.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { classifyOrderType } from '../order-type'

  describe('classifyOrderType', () => {
    it("returns 'stock_on_hand' when every line is stocked", () => {
      expect(
        classifyOrderType([
          { fulfilment_type: 'stocked' },
          { fulfilment_type: 'stocked' },
        ]),
      ).toBe('stock_on_hand')
    })

    it("returns 'purchase_order' when any line is made_to_order", () => {
      expect(
        classifyOrderType([
          { fulfilment_type: 'stocked' },
          { fulfilment_type: 'made_to_order' },
        ]),
      ).toBe('purchase_order')
    })

    it("returns 'purchase_order' when a line has no fulfilment_type (legacy cart)", () => {
      expect(classifyOrderType([{ fulfilment_type: 'stocked' }, {}])).toBe(
        'purchase_order',
      )
    })

    it("returns 'purchase_order' for an empty line list", () => {
      expect(classifyOrderType([])).toBe('purchase_order')
    })
  })
  ```

- [x] **Step 2: Run the test — expect it to FAIL (module missing).**
  ```
  cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run lib/orders/__tests__/order-type.test.ts
  ```
  Expected FAIL: the suite errors during collection with `Failed to resolve import "../order-type"` (the module does not exist yet).

- [x] **Step 3: Create the classifier to make it pass.**
  Create `/Users/jamierogangeorge/Documents/print-room-portal/lib/orders/order-type.ts`:
  ```ts
  // Foundation F-1 — order-type classification.
  // Derived from the cart's per-line fulfilment_type at submit time. An order is
  // 'stock_on_hand' only when EVERY line is a genuine stock draw ('stocked');
  // any made_to_order line (or an absent/legacy fulfilment_type) makes the whole
  // order a 'purchase_order'. This is the all-stocked twin of the drawsStock
  // predicate (some-stocked) at lib/checkout/submit.ts step 5c.
  // Interim rule (Spec A): a mixed cart stays ONE order classified
  // 'purchase_order'; Spec B F1 will split mixed carts.

  export type OrderType = 'stock_on_hand' | 'purchase_order'

  export interface ClassifiableLine {
    fulfilment_type?: 'stocked' | 'made_to_order' | null
  }

  export function classifyOrderType(
    lines: ReadonlyArray<ClassifiableLine>,
  ): OrderType {
    if (lines.length === 0) return 'purchase_order'
    return lines.every((l) => l.fulfilment_type === 'stocked')
      ? 'stock_on_hand'
      : 'purchase_order'
  }
  ```

- [x] **Step 4: Run the test — expect PASS.**
  ```
  cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run lib/orders/__tests__/order-type.test.ts
  ```
  Expected PASS: `Test Files 1 passed`, `Tests 4 passed`.

- [x] **Step 5: Commit the classifier + test.**
  ```
  git commit -am "feat: add classifyOrderType order-type classifier"
  ```

- [x] **Step 6: Create the migration file.**
  Timestamp rule: pick a `YYYYMMDDHHMMSS` string strictly greater than the latest existing migration, which is `20260702120000_xero_invoice_columns.sql`, using today's date (2026-07-15). Chosen: `20260715000000`.
  Create `/Users/jamierogangeorge/Documents/print-room-portal/supabase/migrations/20260715000000_orders_order_type.sql`:
  ```sql
  -- 2026-07-15 — Foundation F-1: order-type classification.
  -- Every order is typed as either a stock-on-hand draw (all lines fulfilled from
  -- existing inventory) or a purchase order (anything made to order). submit
  -- (lib/checkout/submit.ts) stamps this from the cart's per-line fulfilment_type
  -- via classifyOrderType(); interim rule — a mixed cart is one order classified
  -- 'purchase_order' (Spec B F1 will split mixed carts). Downstream readers
  -- (Past-orders list, invoicing, dispatch: Items 10/11/13/15) branch on this.
  --
  -- text + CHECK (not a native enum type) mirrors the newest precedent on this
  -- table, orders.xero_invoice_status (20260702120000), and keeps the value set
  -- easy to extend in Spec B without an ALTER TYPE.

  alter table public.orders
    add column if not exists order_type text not null default 'purchase_order';

  alter table public.orders
    drop constraint if exists orders_order_type_check;
  alter table public.orders
    add constraint orders_order_type_check
    check (order_type in ('stock_on_hand', 'purchase_order'));

  comment on column public.orders.order_type is
    'stock_on_hand (every line drawn from existing inventory) | purchase_order '
    '(any made-to-order line). Stamped at submit by classifyOrderType(). Interim: '
    'a mixed cart is one order classified purchase_order (Spec B F1 will split).';
  ```
  Applied to the production Supabase project on 2026-07-15 only after Jamie explicitly overrode the original production guardrail. Supabase recorded remote migration `20260715004718_orders_order_type`; no other pending migration was applied or re-run.

- [x] **Step 7: Commit the migration.**
  ```
  git commit -am "feat: add orders.order_type column (Foundation F-1)"
  ```

---

### Task: Stamp order_type on the orders row at submit

Wires `classifyOrderType` into `submitCustomerOrder` so each order persists its type, using the coerced `input.lines` (server-side fulfilment truth is already resolved earlier at submit.ts:448-460, so any false `'stocked'` claim has already been downgraded to `'made_to_order'` before we classify).

**Files:**
- Modify `/Users/jamierogangeorge/Documents/print-room-portal/lib/checkout/submit.ts` (add import after line 14; stamp order_type immediately after the RPC row destructure at line 1076)
- Modify `/Users/jamierogangeorge/Documents/print-room-portal/lib/checkout/__tests__/submit.fulfilment-truth.test.ts` (append a new `describe` block reusing the existing `makeSupabaseStub` / `baseSelects` / `happyRpc` / `buildInput` harness — no changes to existing tests)

**Interfaces:**
- Consumes: order-type classifier — `classifyOrderType(lines): 'stock_on_hand' | 'purchase_order'` from `@/lib/orders/order-type` (previous task).
- Produces: no new exported symbols; persists `orders.order_type` as a side-effect of `submitCustomerOrder`.

- [x] **Step 1: Add the failing wiring assertions.**
  Append this new block to the END of `/Users/jamierogangeorge/Documents/print-room-portal/lib/checkout/__tests__/submit.fulfilment-truth.test.ts` (after the existing `describe(...)` closes at line 398). It reuses the in-file harness — `makeSupabaseStub` already returns `{ admin, writes, rpcCalls }`, and `writes` records every `.update()` payload:
  ```ts
  describe('submitCustomerOrder — order_type stamping (Foundation F-1)', () => {
    const ordersOrderTypeWrite = (
      writes: Array<{ table: string; op: string; payload: unknown }>,
    ) =>
      writes.find(
        (w) =>
          w.table === 'orders' &&
          w.op === 'update' &&
          !Array.isArray(w.payload) &&
          typeof w.payload === 'object' &&
          w.payload !== null &&
          'order_type' in (w.payload as Record<string, unknown>),
      )

    it("stamps order_type='stock_on_hand' when every line is a genuine stock draw", async () => {
      const { admin, writes } = makeSupabaseStub({
        selects: baseSelects({ productNature: 'mixed' }), // keeps the 'stocked' claim
        rpc: happyRpc,
      })

      const result = await submitCustomerOrder(admin, buildInput()) // qty 10, stocked, MOQ-exempt
      expect(result.order_id).toBe(ORDER_ID)
      expect(ordersOrderTypeWrite(writes)?.payload).toMatchObject({
        order_type: 'stock_on_hand',
      })
    })

    it("stamps order_type='purchase_order' for a made_to_order line", async () => {
      const { admin, writes } = makeSupabaseStub({
        selects: baseSelects({ productNature: 'made_to_order' }),
        rpc: happyRpc,
      })

      const result = await submitCustomerOrder(admin, buildInput({ qty: 24 }))
      expect(result.order_id).toBe(ORDER_ID)
      expect(ordersOrderTypeWrite(writes)?.payload).toMatchObject({
        order_type: 'purchase_order',
      })
    })

    it("classifies a mixed cart as 'purchase_order' (interim single-order rule)", async () => {
      const { admin, writes } = makeSupabaseStub({
        selects: baseSelects({ productNature: 'mixed' }),
        rpc: happyRpc,
      })

      // One stocked line (MOQ-exempt) + one made_to_order line on the same
      // (mixed) product whose 24 qty meets MOQ 24 for the production run.
      const input = buildInput({ qty: 5 })
      input.lines.push({
        ...input.lines[0],
        qty: 24,
        cart_line_id: 'line-2',
        fulfilment_type: 'made_to_order',
      })

      const result = await submitCustomerOrder(admin, input)
      expect(result.order_id).toBe(ORDER_ID)
      expect(ordersOrderTypeWrite(writes)?.payload).toMatchObject({
        order_type: 'purchase_order',
      })
    })
  })
  ```

- [x] **Step 2: Run the suite — expect the 3 new cases to FAIL.**
  ```
  cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run lib/checkout/__tests__/submit.fulfilment-truth.test.ts
  ```
  Expected: `Tests 3 failed | 7 passed`. Each new case fails with `expected undefined to match object { order_type: ... }` because `submitCustomerOrder` does not yet write `order_type`, so `ordersOrderTypeWrite(writes)` is `undefined`.

- [x] **Step 3: Import the classifier in submit.ts.**
  Current line 14:
  ```ts
  import { createJobTrackerShellForOrder } from '@/lib/orders/job-tracker'
  ```
  Add the import directly after it:
  ```ts
  import { createJobTrackerShellForOrder } from '@/lib/orders/job-tracker'
  import { classifyOrderType } from '@/lib/orders/order-type'
  ```

- [x] **Step 4: Stamp order_type right after the RPC returns.**
  Current code at submit.ts:1073-1081 (the RPC row destructure, then the decoration-revenue write):
  ```ts
    const rowRaw = Array.isArray(data) ? data[0] : data
    const row = rowRaw as SubmitB2BOrderRow | null
    if (!row) throw new Error('submit_b2b_order returned no row')
    const { quote_id, order_id, order_ref } = row

    // Record decoration revenue separately on the quote so finance can split
    // garment vs decoration without parsing quote_items.decorations jsonb.
    // total_amount already includes decoration via the folded unit_price above.
    if (totalDecorationRevenue > 0) {
  ```
  Insert the order_type stamp between the destructure and the decoration comment:
  ```ts
    const rowRaw = Array.isArray(data) ? data[0] : data
    const row = rowRaw as SubmitB2BOrderRow | null
    if (!row) throw new Error('submit_b2b_order returned no row')
    const { quote_id, order_id, order_ref } = row

    // Foundation F-1 — classify and stamp order_type from the (already
    // nature-coerced, see step 1) cart lines: 'stock_on_hand' iff every line is
    // a genuine stock draw, else 'purchase_order'. The all-stocked twin of the
    // drawsStock (some-stocked) predicate at step 5c. The column defaults to
    // 'purchase_order' at the DB, so this update only ever narrows to
    // 'stock_on_hand' for fully-stocked orders. Plain awaited write (same
    // contract as the decoration_cost update below), not a swallowed side-effect.
    const orderType = classifyOrderType(input.lines)
    await admin.from('orders').update({ order_type: orderType }).eq('id', order_id)

    // Record decoration revenue separately on the quote so finance can split
    // garment vs decoration without parsing quote_items.decorations jsonb.
    // total_amount already includes decoration via the folded unit_price above.
    if (totalDecorationRevenue > 0) {
  ```

- [x] **Step 5: Run the suite — expect PASS.**
  ```
  cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run lib/checkout/__tests__/submit.fulfilment-truth.test.ts
  ```
  Expected: `Tests 10 passed` (7 existing + 3 new). The extra `orders` update is inert for the existing cases (they assert only `order_id` and `createDraftInvoiceForOrder`), so they stay green.

- [x] **Step 6: Commit the wiring.**
  ```
  git commit -am "feat: stamp orders.order_type at checkout submit"
  ```

---

<!-- ===== Build step 2/8 · cluster: items-1-9-per-unit-pdp ===== -->

### Task: Add a "Per unit" row to the PDP price panel (both ordering modes)

Spec items 1+9 (Spec A, build-order 2). Show the per-unit price in BOTH ordering modes on the PDP, sourced from the already-computed pricing. The per-unit value is **already inside** the component: `PriceBreakdown` receives `breakdown: OrderBreakdown`, and on the PDP that breakdown always has exactly one line whose `unitEffective` equals `pricing.unit_price` (built at `ProductDetailClient.tsx:1438-1447`). So the whole change lives in `PriceBreakdown.tsx` + its test — **no prop threading, no `ProductDetailClient` edit**. Because the PDP call site passes `variant="pdp"` regardless of `isInventoryMode` (`ProductDetailClient.tsx:1437-1450`), gating the new row on `variant === 'pdp'` makes it appear in both modes automatically.

**Files:**
- Modify: `/Users/jamierogangeorge/Documents/print-room-portal/components/pricing/PriceBreakdown.test.tsx` — add a single-line fixture after line 14 and three tests after line 49.
- Modify: `/Users/jamierogangeorge/Documents/print-room-portal/components/pricing/PriceBreakdown.tsx` — render body lines 24-30 (add `showPerUnit` flag + the row).

**Interfaces:**
- Consumes (from existing code, verified): `OrderBreakdown` from `/Users/jamierogangeorge/Documents/print-room-portal/lib/pricing/types.ts` — `lines: LineBreakdown[]`, where `LineBreakdown.unitEffective: number` (the catalogue unit price). `PriceBreakdown` props (unchanged): `{ breakdown: OrderBreakdown; variant: 'pdp' | 'cart-totals' | 'checkout-review'; format?: (nzdAmount: number) => string }`. Fallback formatter `formatPrice(n: number) => string` from `@/lib/format/price` (already imported).
- Produces: `PriceBreakdown` pdp variant now renders a muted `Per unit` row = `breakdown.lines[0].unitEffective`, formatted with the same `fmt`. No new prop, no new export.

**Decision gate (resolve before coding, default is decided):** The spec says the per-unit figure is `unitEffective / pricing.unit_price` — the bare catalogue price, **excluding** decoration. When `decorationPerUnit > 0` this means `PerUnit × qty ≠ Subtotal` (Subtotal bakes in decoration). This plan implements the spec's literal choice (`unitEffective`). If product instead wants a decoration-inclusive per-unit, swap the value expression to `breakdown.lines[0].lineNet / breakdown.lines[0].qty`. Proceeding with `unitEffective` unless a human overrides.

- [x] **Step 1: Add a single-line pdp fixture to the test file (RED prep).** The existing `ob` fixture has `lines: []`, so add a separate fixture with one line. Insert immediately after the existing `ob` object (after line 14, before `describe(`):

  ```tsx
  const obPdp = {
    lines: [
      {
        qty: 10,
        unitEffective: 21.5,
        unitGross: 21.5,
        decorationPerUnit: 1.5,
        lineGross: 230.0,
        lineDiscount: 0,
        lineNet: 230.0,
      },
    ],
    grossSubtotal: 230.0,
    decorationTotal: 15.0,
    discountAmount: 0,
    netSubtotal: 230.0,
    gstRate: 0.15,
    gst: 34.5,
    total: 264.5,
  }
  ```

- [x] **Step 2: Write the failing tests.** Insert these three tests inside the `describe('PriceBreakdown', ...)` block, immediately after the existing `honours a custom format prop...` test (after line 49, before the closing `})`):

  ```tsx
  it('pdp variant renders a Per unit row from lines[0].unitEffective', () => {
    render(<PriceBreakdown breakdown={obPdp} variant="pdp" />)
    expect(screen.getByText(/Per unit/i)).toBeDefined()
    expect(screen.getByText(/\$21\.50/)).toBeDefined()
  })

  it('does not render a Per unit row for cart-totals', () => {
    render(<PriceBreakdown breakdown={obPdp} variant="cart-totals" />)
    expect(screen.queryByText(/Per unit/i)).toBeNull()
  })

  it('formats the Per unit value with a custom format prop', () => {
    const format = (n: number) => `A$${(n * 0.9).toFixed(2)}`
    render(<PriceBreakdown breakdown={obPdp} variant="pdp" format={format} />)
    // 21.50 * 0.9 = 19.35
    expect(screen.getByText(/A\$19\.35/)).toBeDefined()
  })
  ```

- [x] **Step 3: Run the tests — expect RED.**

  ```
  cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run components/pricing/PriceBreakdown.test.tsx
  ```

  Expected FAIL on `pdp variant renders a Per unit row...` and `formats the Per unit value...` with `TestingLibraryElementError: Unable to find an element with the text: /Per unit/i` (and the custom-format test fails to find `/A\$19\.35/`). The `does not render...for cart-totals` test already passes. The four pre-existing tests still pass.

- [x] **Step 4: Implement the per-unit row.** In `PriceBreakdown.tsx`, replace the current head of the render body (lines 24-30):

  ```tsx
  export function PriceBreakdown({ breakdown, variant, format }: PriceBreakdownProps) {
    const showShipping = variant === 'cart-totals' || variant === 'checkout-review'
    const fmt = format ?? formatPrice

    return (
      <div className="space-y-1.5 text-sm">
        <Row label="Subtotal" value={breakdown.grossSubtotal} format={fmt} />
  ```

  with:

  ```tsx
  export function PriceBreakdown({ breakdown, variant, format }: PriceBreakdownProps) {
    const showShipping = variant === 'cart-totals' || variant === 'checkout-review'
    // PDP shows a single synthetic line (aggregate qty at one unit price), so the
    // per-unit figure is unambiguous. Cart/checkout can mix unit prices across
    // lines, where a single "per unit" number would mislead — so gate it.
    const showPerUnit = variant === 'pdp' && breakdown.lines.length === 1
    const fmt = format ?? formatPrice

    return (
      <div className="space-y-1.5 text-sm">
        {showPerUnit && (
          <Row
            label="Per unit"
            value={breakdown.lines[0].unitEffective}
            muted
            format={fmt}
          />
        )}
        <Row label="Subtotal" value={breakdown.grossSubtotal} format={fmt} />
  ```

  (Nothing else in the component changes — `Row`, `showShipping`, GST, Total all stay as-is. `breakdown.lines[0]` is safe: the `length === 1` gate guarantees it, and `noUncheckedIndexedAccess` is off so it also typechecks as `LineBreakdown`.)

- [x] **Step 5: Run the tests — expect GREEN.**

  ```
  cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run components/pricing/PriceBreakdown.test.tsx
  ```

  Expected: all 7 tests pass (4 original + 3 new).

- [x] **Step 6: Confirm both-modes coverage (no code change).** Verify the PDP call site is mode-agnostic so the row shows for both stocked and made-to-order products:

  ```
  cd /Users/jamierogangeorge/Documents/print-room-portal && sed -n '1436,1450p' components/shop/ProductDetailClient.tsx
  ```

  Confirm the `<PriceBreakdown ... variant="pdp" ...>` block has no `isInventoryMode` conditional wrapping it and builds a one-line breakdown. (Verified at plan time: lines 1437-1450, single line `{ qty, unitEffective: pricing.unit_price, decorationPerUnit }`, `variant="pdp"`, unconditional on mode.) No edit required. Manual QA note for the executor: load one stocked product (isInventoryMode true) and one made-to-order product (isInventoryMode false), select a qty, and confirm each price panel shows a "Per unit" figure equal to its catalogue unit price.

- [x] **Step 7: Commit.**

  ```
  git commit -am "feat: show per-unit price on PDP price panel (both order modes)"
  ```

---

<!-- ===== Build step 3/8 · cluster: items-6-7-hide-availability-and-gate-mode-filter ===== -->

> **Grounding note.** All anchors verified against real code on 2026-07-15. `ProductDetailClient.tsx` lives at `components/shop/`, NOT `app/(portal)/**` (spec path was wrong); its line anchors (badge 1169-1174, `Available` `<th>` 1242, row filter 362-368) are correct. The Ordering-mode `<select>` exists ONLY in `FilterRail.tsx` (70-81) — the desktop catalogue filter row (`PortalTopBar.tsx` → `FilterRow`) has NO ordering-mode select, so Item 7 is fully contained to `FilterRail.tsx` + `catalogue/page.tsx`. `pillsFor` (fulfilment-mode.ts 32-40) is dead in app code (only `fulfilment-mode.test.ts` references it) — leave it untouched, do not wire it.

---

### Task: Hide the multi-size `Available` column and the header `AvailabilityBadge` in Purchase-order mode (Item 6)

**Files:**
- Create `/Users/jamierogangeorge/Documents/print-room-portal/components/shop/__tests__/ProductDetailClient.availability-visibility.test.tsx`
- Modify `/Users/jamierogangeorge/Documents/print-room-portal/components/shop/ProductDetailClient.tsx` — add `showAvailability` after the `isInventoryMode` block (~350); gate the `AvailabilityBadge` (1169-1174); gate the `Available` `<th>` (1242); gate the availability `<td>` (1269-1286); make both `<tfoot>` `colSpan` (1317, 1326) depend on it
- Modify `/Users/jamierogangeorge/Documents/print-room-portal/components/shop/__tests__/ProductDetailClient.inventory-sizes.test.tsx` — tests at 123-134, 136-146, 150-162 pin the OLD behaviour and must move to the new one
- Modify `/Users/jamierogangeorge/Documents/print-room-portal/components/shop/__tests__/ProductDetailClient.permissions.test.tsx` — the chip assertion at line 114 pins the OLD behaviour

**Interfaces:**
- Consumes (internal to component, already present): `isInventoryMode: boolean` (true = Stock-on-hand), `multiSize: boolean`, `colourTotalAvailable: number | undefined`, `availableQty: number | undefined`, `hasBackorderableOrderPath: boolean`, `selectedVariantBackorderable: boolean`.
- Produces: none consumed by other tasks (leaf UI change).

> **⚠ Decision gate (confirm before implementing).** Item 6 says "hide the `Available` column header." The only coherent way to hide a column header without breaking table alignment is to hide the **whole column** (header + body cells) and shrink the `<tfoot>` `colSpan`. As a consequence, in Purchase-order mode the per-size mint **"Available to order"** chips AND the header **"Available to order"** badge (both live inside the hidden column/badge, added 2026-06-29 / 2026-06-03) will no longer render. Four existing tests pinned that old signal and are rewritten below. If those orderability signals must survive in Purchase-order mode, STOP and revise Item 6 before coding. This plan implements the verbatim spec (whole-column + badge hidden in `!isInventoryMode`).

- [x] **Step 1: Write the failing visibility test (both modes).**
  Create `/Users/jamierogangeorge/Documents/print-room-portal/components/shop/__tests__/ProductDetailClient.availability-visibility.test.tsx` (harness mirrors `ProductDetailClient.pills.test.tsx`):
  ```tsx
  import { render, screen } from '@testing-library/react'
  import { describe, it, expect, vi } from 'vitest'
  import { ProductDetailClient } from '../ProductDetailClient'

  vi.mock('@/components/cart/useCart', () => ({ useCart: () => ({ addLine: vi.fn() }) }))
  vi.mock('@/contexts/CurrencyContext', () => ({
    useCurrency: () => ({ format: (n: number) => `$${n}` }),
  }))
  vi.mock('next/navigation', () => ({ useRouter: () => ({ back: vi.fn() }) }))

  const baseProduct = {
    id: 'p1', name: 'Tee', description: null, image_url: null, moq: 1,
    lead_time_days: 7, sizing_type: 'multi_size_with_variants',
    decoration_methods: null, decoration_price: null, sku: null,
    safety_standard: null, specs: null, supports_labels: null,
    default_sizes: null, garment_family: null, brand_name: null,
    category_name: null, catalogueItemId: 'i1',
  }

  function renderPDP(fulfilment_type: 'stocked' | 'made_to_order' | 'mixed') {
    return render(
      <ProductDetailClient
        product={{ ...baseProduct, fulfilment_type }}
        variants={[{
          variant_id: 'v1', color_swatch_id: 'red', color_label: 'Red',
          color_hex: '#f00', color_position: 0, size_id: 1,
          size_label: 'S', size_order: 0,
        }]}
        sizes={[{ size_id: 1, size_label: 'S', size_order: 0 }]}
        brackets={[{ min_quantity: 1, max_quantity: null, unit_price: 10 }]}
        availability={{ 'v1::1': { available_qty: 5, allow_order_without_stock: false } }}
        organizationId="o1"
        customerRole="org_admin"
        orderingPermission="both"
        images={[]}
        colourOptions={[]}
        decorations={[]}
        effectiveMoq={1}
      />,
    )
  }

  describe('PDP availability visibility by ordering mode (Item 6)', () => {
    // stocked → orderingOptions = {draw:true, reorder:false} → isInventoryMode true.
    it('stock-on-hand mode shows the Available column header and stock badge', () => {
      renderPDP('stocked')
      expect(screen.getByRole('columnheader', { name: 'Available' })).toBeInTheDocument()
      expect(screen.getByText(/in stock \(5 available\)/i)).toBeInTheDocument()
    })

    // made_to_order + tracked stock + tiers → canChooseOrderIntent false (no draw
    // path), brackets.length>0 → isInventoryMode false → Purchase-order mode.
    it('purchase-order mode hides the Available column header and stock badge', () => {
      renderPDP('made_to_order')
      expect(screen.queryByRole('columnheader', { name: 'Available' })).not.toBeInTheDocument()
      expect(screen.queryByText(/in stock/i)).not.toBeInTheDocument()
    })
  })
  ```

- [x] **Step 2: Run it — expect RED on the purchase-order case.**
  ```
  cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run components/shop/__tests__/ProductDetailClient.availability-visibility.test.tsx
  ```
  Expected FAIL: the second test throws `expect(element).not.toBeInTheDocument()` — the `columnheader "Available"` and the `In stock (5 available)` badge are still rendered in purchase-order mode. First test passes.

- [x] **Step 3: Move the 4 pre-existing tests to the new behaviour (they now go RED too).**
  In `.../__tests__/ProductDetailClient.inventory-sizes.test.tsx`, replace the reorder-mode test (123-134):
  ```tsx
  // OLD
  it('reorder mode (made_to_order, no stock): all sizes + Available column unchanged', () => {
    // made_to_order + org_admin + tiers, but NO inventory on the selection →
    // canChooseOrderIntent false → reorder mode (all sizes + Available column).
    // (A made_to_order product that DOES carry stock now defaults to inventory
    //  mode with a toggle — restored pre-2026-06-03 behavior; see pills test.)
    renderPDP({ fulfilment_type: 'made_to_order', role: 'org_admin', availability: noStock })
    expect(screen.getByLabelText('Quantity for size S')).toBeInTheDocument()
    expect(screen.getByLabelText('Quantity for size M')).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: 'Available' }),
    ).toBeInTheDocument()
  })
  ```
  ```tsx
  // NEW
  it('reorder mode (made_to_order, no stock): all sizes shown, Available column hidden (Item 6)', () => {
    // made_to_order + org_admin + tiers, but NO inventory on the selection →
    // canChooseOrderIntent false → purchase-order mode. Item 6 hides the whole
    // Available column in purchase-order mode; every size row still renders.
    renderPDP({ fulfilment_type: 'made_to_order', role: 'org_admin', availability: noStock })
    expect(screen.getByLabelText('Quantity for size S')).toBeInTheDocument()
    expect(screen.getByLabelText('Quantity for size M')).toBeInTheDocument()
    expect(
      screen.queryByRole('columnheader', { name: 'Available' }),
    ).not.toBeInTheDocument()
  })
  ```
  Replace the backorderable test (136-146):
  ```tsx
  // OLD
  it('legacy per-size variants display every order-without-stock size as available to order', () => {
    renderPDP({
      fulfilment_type: 'made_to_order',
      role: 'org_admin',
      availability: backorderable,
    })
    expect(screen.getByLabelText('Quantity for size S')).toBeInTheDocument()
    expect(screen.getByLabelText('Quantity for size M')).toBeInTheDocument()
    expect(screen.getAllByText(/Available to order/i)).toHaveLength(3)
    expect(screen.queryByText('Out of stock')).not.toBeInTheDocument()
  })
  ```
  ```tsx
  // NEW
  it('backorderable made-to-order sizes still render, Available column hidden (Item 6)', () => {
    renderPDP({
      fulfilment_type: 'made_to_order',
      role: 'org_admin',
      availability: backorderable,
    })
    expect(screen.getByLabelText('Quantity for size S')).toBeInTheDocument()
    expect(screen.getByLabelText('Quantity for size M')).toBeInTheDocument()
    // Item 6: purchase-order mode hides the whole Available column AND the header
    // badge, so the per-size "Available to order" chips no longer render.
    expect(screen.queryByText(/Available to order/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Out of stock')).not.toBeInTheDocument()
  })
  ```
  Replace the untracked-sizes test (150-162):
  ```tsx
  // OLD
  it('shows "Available to order" per untracked size instead of a — placeholder', () => {
    // ...
    renderPDP({ fulfilment_type: 'made_to_order', role: 'org_admin', availability: {} as never })
    expect(screen.getByLabelText('Quantity for size S')).toBeInTheDocument()
    expect(screen.getByLabelText('Quantity for size M')).toBeInTheDocument()
    // One mint pill per untracked size row. The header AvailabilityBadge renders
    // nothing here (colourTotalAvailable is undefined), so the only matches are
    // the two in-table cells — and the "—" placeholder is gone.
    expect(screen.getAllByText(/Available to order/i)).toHaveLength(2)
  })
  ```
  ```tsx
  // NEW
  it('renders every untracked size row with the Available column hidden (Item 6)', () => {
    // made_to_order + org_admin + NO availability rows → purchase-order mode.
    // Item 6 hides the whole Available column here, so the per-size
    // "Available to order" chips no longer render; the size rows still do.
    renderPDP({ fulfilment_type: 'made_to_order', role: 'org_admin', availability: {} as never })
    expect(screen.getByLabelText('Quantity for size S')).toBeInTheDocument()
    expect(screen.getByLabelText('Quantity for size M')).toBeInTheDocument()
    expect(screen.queryByText(/Available to order/i)).not.toBeInTheDocument()
  })
  ```
  In `.../__tests__/ProductDetailClient.permissions.test.tsx`, replace the chip assertion (line 114) inside `'made_to_order × staff × stock_only with order-without-stock rows → orderable, no dead-zone'`:
  ```tsx
  // OLD (line 114)
    expect(screen.getAllByText(/Available to order/i).length).toBeGreaterThanOrEqual(1)
  ```
  ```tsx
  // NEW — orderability is proven by the Qty input above; Item 6 hides the
  // Available column in purchase-order mode, so the chip no longer renders.
    expect(screen.queryByText(/Available to order/i)).not.toBeInTheDocument()
  ```

- [x] **Step 4: Run the updated existing tests — expect RED.**
  ```
  cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run components/shop/__tests__/ProductDetailClient.inventory-sizes.test.tsx components/shop/__tests__/ProductDetailClient.permissions.test.tsx
  ```
  Expected FAIL: the three inventory-sizes tests and the one permissions test now assert the column/chips are absent, but the current component still renders them (`queryBy... not.toBeInTheDocument()` throws / `getAllByText` still finds chips in the moved tests).

- [x] **Step 5: Derive `showAvailability` from `isInventoryMode`.**
  In `ProductDetailClient.tsx`, insert immediately after the `isInventoryMode` declaration:
  ```tsx
  // OLD
  const isInventoryMode =
    (options.canDrawStock && !options.canReorder) ||
    (currentSelectionHasInventory && brackets.length === 0) ||
    (canChooseOrderIntent && orderIntent === 'inventory')

  // Org_admin drawing From inventory may overflow a size's available stock:
  ```
  ```tsx
  // NEW
  const isInventoryMode =
    (options.canDrawStock && !options.canReorder) ||
    (currentSelectionHasInventory && brackets.length === 0) ||
    (canChooseOrderIntent && orderIntent === 'inventory')

  // Item 6: the stock "Available" column and the header AvailabilityBadge are
  // meaningful only when drawing from existing stock (Stock-on-hand mode). In
  // Purchase-order mode (!isInventoryMode) the order is a production run, so
  // per-size availability is irrelevant — hide both.
  const showAvailability = isInventoryMode

  // Org_admin drawing From inventory may overflow a size's available stock:
  ```

- [x] **Step 6: Gate the header `AvailabilityBadge` (1169-1174).**
  ```tsx
  // OLD
                <AvailabilityBadge
                  availableQty={multiSize ? colourTotalAvailable : availableQty}
                  availableToOrder={
                    multiSize ? hasBackorderableOrderPath : selectedVariantBackorderable
                  }
                />
  ```
  ```tsx
  // NEW
                {showAvailability && (
                  <AvailabilityBadge
                    availableQty={multiSize ? colourTotalAvailable : availableQty}
                    availableToOrder={
                      multiSize ? hasBackorderableOrderPath : selectedVariantBackorderable
                    }
                  />
                )}
  ```

- [x] **Step 7: Gate the `Available` `<th>` (1242).**
  ```tsx
  // OLD
                    <th className="px-5 pt-5 pb-2 font-medium">Size</th>
                    <th className="px-5 pt-5 pb-2 font-medium">Available</th>
                    <th className="px-5 pt-5 pb-2 text-right font-medium">Qty</th>
  ```
  ```tsx
  // NEW
                    <th className="px-5 pt-5 pb-2 font-medium">Size</th>
                    {showAvailability && (
                      <th className="px-5 pt-5 pb-2 font-medium">Available</th>
                    )}
                    <th className="px-5 pt-5 pb-2 text-right font-medium">Qty</th>
  ```

- [x] **Step 8: Gate the availability body `<td>` (1269-1286).**
  Wrap the entire middle `<td>` (the one between the size-label `<td>` and the qty-input `<td>`):
  ```tsx
  // OLD
                        <td className="px-5 py-3 text-xs text-gray-600">
                          {showAvailableToOrderChip ? (
                            <span className="inline-flex rounded-full bg-[rgb(var(--accent-mint))] px-2 py-0.5 text-[10px] font-medium text-[rgb(var(--accent-mint-ink))]">
                              Available to order
                            </span>
                          ) : `${stocked}`}
                          {/* "to be made" is a reorder/MTO concept — qty beyond
                              stock that goes to production. In From-inventory mode
                              the shortfall guard already caps orders at available
                              stock, so we show only the available count there.
                              Suppressed when the pill already says "Available to
                              order" (matches backorderable-row behaviour). */}
                          {(!isInventoryMode || isInventoryOverflowScope) && backorder > 0 && !showAvailableToOrderChip && (
                            <span className="ml-1 text-amber-700">
                              ({backorder} to be made)
                            </span>
                          )}
                        </td>
  ```
  ```tsx
  // NEW
                        {showAvailability && (
                          <td className="px-5 py-3 text-xs text-gray-600">
                            {showAvailableToOrderChip ? (
                              <span className="inline-flex rounded-full bg-[rgb(var(--accent-mint))] px-2 py-0.5 text-[10px] font-medium text-[rgb(var(--accent-mint-ink))]">
                                Available to order
                              </span>
                            ) : `${stocked}`}
                            {/* "to be made" is a reorder/MTO concept — qty beyond
                                stock that goes to production. In From-inventory mode
                                the shortfall guard already caps orders at available
                                stock, so we show only the available count there.
                                Suppressed when the pill already says "Available to
                                order" (matches backorderable-row behaviour). */}
                            {(!isInventoryMode || isInventoryOverflowScope) && backorder > 0 && !showAvailableToOrderChip && (
                              <span className="ml-1 text-amber-700">
                                ({backorder} to be made)
                              </span>
                            )}
                          </td>
                        )}
  ```
  (The row-local `trackedRow`/`stocked`/`backorder`/`showAvailableToOrderChip` consts stay computed and are still referenced inside this JSX, so no unused-var lint; `value` is still used by the Qty input `<td>` below.)

- [x] **Step 9: Shrink the two `<tfoot>` `colSpan`s so the footer matches the visible column count.**
  Line 1317:
  ```tsx
  // OLD
                    <td className="px-5 py-3 text-[11px] font-medium uppercase tracking-[0.08em] text-gray-500" colSpan={2}>
  ```
  ```tsx
  // NEW
                    <td className="px-5 py-3 text-[11px] font-medium uppercase tracking-[0.08em] text-gray-500" colSpan={showAvailability ? 2 : 1}>
  ```
  Line 1326:
  ```tsx
  // OLD
                      <td className="px-5 py-3 text-xs text-gray-500" colSpan={2}>
  ```
  ```tsx
  // NEW
                      <td className="px-5 py-3 text-xs text-gray-500" colSpan={showAvailability ? 2 : 1}>
  ```

- [x] **Step 10: Run the whole shop suite — expect GREEN.**
  ```
  cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run components/shop/__tests__/ProductDetailClient.availability-visibility.test.tsx components/shop/__tests__/ProductDetailClient.inventory-sizes.test.tsx components/shop/__tests__/ProductDetailClient.permissions.test.tsx components/shop/__tests__/ProductDetailClient.layout.test.tsx components/shop/__tests__/ProductDetailClient.inventory-overflow.test.tsx
  ```
  Expected PASS on all. (`layout` = mixed+both+stock toggled to inventory → `showAvailability` true → badge still shown; `inventory-overflow` runs in inventory-overflow scope → inventory mode → column still shown.)

- [x] **Step 11: Commit.**
  ```
  git add -A && git commit -m "feat: hide Available column and stock badge in purchase-order PDP mode"
  ```

---

### Task: Add `memberCanReorder` and gate the catalogue `FilterRail` Ordering-mode filter for stock_only members (Item 7)

**Files:**
- Modify `/Users/jamierogangeorge/Documents/print-room-portal/lib/shop/fulfilment-mode.ts` — add exported `memberCanReorder` after `effectivePermission` (~65); refactor `orderingOptions`' `memberReorder` (line 90) to reuse it
- Modify `/Users/jamierogangeorge/Documents/print-room-portal/lib/shop/__tests__/ordering-options.test.ts` — import (line 2) + new `describe` after line 34
- Create `/Users/jamierogangeorge/Documents/print-room-portal/components/shop/__tests__/FilterRail.test.tsx`
- Modify `/Users/jamierogangeorge/Documents/print-room-portal/components/shop/FilterRail.tsx` — `Props` (9-14), destructure (16), wrap the Ordering-mode `Section` (70-81)
- Modify `/Users/jamierogangeorge/Documents/print-room-portal/app/(portal)/catalogue/page.tsx` — import (line 14) + `FilterRail` call (line 553)

**Interfaces:**
- Consumes: `MemberPermission = 'stock_only' | 'reorder_only' | 'both'` (from `lib/shop/fulfilment-mode.ts`); `context.orderingPermission: MemberPermission` (from `requireB2BCustomerCached()` — already the EFFECTIVE permission, i.e. org_admin is elevated to `'both'`; see `lib/checkout/server.ts:54`).
- Produces:
  - `memberCanReorder(permission: MemberPermission): boolean` — exported from `/Users/jamierogangeorge/Documents/print-room-portal/lib/shop/fulfilment-mode.ts`. Returns `true` for `'reorder_only'` and `'both'`, `false` for `'stock_only'` — the member-side factor of `orderingOptions().canReorder`, i.e. the SAME condition that hides the PDP order-mode pill.
  - `FilterRail` gains optional prop `showModeFilter?: boolean` (default `true`).

- [x] **Step 1: Failing unit test for `memberCanReorder`.**
  In `lib/shop/__tests__/ordering-options.test.ts`, change the import and append a `describe`:
  ```ts
  // OLD (line 2)
  import { effectivePermission, orderingOptions } from '../fulfilment-mode'
  ```
  ```ts
  // NEW
  import { effectivePermission, orderingOptions, memberCanReorder } from '../fulfilment-mode'
  ```
  Append after the existing `orderingOptions` describe (after line 34):
  ```ts
  describe('memberCanReorder (member-side factor of orderingOptions.canReorder)', () => {
    it('stock_only members have no reorder path', () => {
      expect(memberCanReorder('stock_only')).toBe(false)
    })
    it('reorder_only and both members can reorder', () => {
      expect(memberCanReorder('reorder_only')).toBe(true)
      expect(memberCanReorder('both')).toBe(true)
    })
  })
  ```

- [x] **Step 2: Run it — expect RED.**
  ```
  cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run lib/shop/__tests__/ordering-options.test.ts
  ```
  Expected FAIL: `TypeError: memberCanReorder is not a function` (named export does not exist yet).

- [x] **Step 3: Implement `memberCanReorder` and reuse it in `orderingOptions`.**
  In `lib/shop/fulfilment-mode.ts`, insert after `effectivePermission` (after line 65, before `export interface OrderingOptions`):
  ```ts
  /**
   * Does this member's permission ever grant a reorder (production-run) path?
   * True for 'reorder_only' and 'both'; false for 'stock_only'. This is the
   * member-side factor of orderingOptions().canReorder — the SAME condition that
   * hides the PDP order-mode pill for a stock_only member. The catalogue
   * FilterRail ordering-mode filter reuses it so a stock_only member never sees a
   * "Purchase order" filter option they could never act on.
   */
  export function memberCanReorder(permission: MemberPermission): boolean {
    return permission === 'reorder_only' || permission === 'both'
  }
  ```
  Then refactor `orderingOptions` (line 90) to reuse it:
  ```ts
  // OLD
    const memberReorder = permission === 'reorder_only' || permission === 'both'
  ```
  ```ts
  // NEW
    const memberReorder = memberCanReorder(permission)
  ```

- [x] **Step 4: Run — expect GREEN.**
  ```
  cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run lib/shop/__tests__/ordering-options.test.ts
  ```
  Expected PASS: the new `memberCanReorder` cases plus the unchanged 9-combo `orderingOptions` table (behaviour is identical; only the internal expression was extracted).

- [x] **Step 5: Commit.**
  ```
  git add -A && git commit -m "feat: add memberCanReorder predicate for reorder-path gating"
  ```

- [x] **Step 6: Failing component test for the `FilterRail` gate.**
  Create `/Users/jamierogangeorge/Documents/print-room-portal/components/shop/__tests__/FilterRail.test.tsx`:
  ```tsx
  import { render, screen } from '@testing-library/react'
  import { describe, it, expect, vi } from 'vitest'
  import { FilterRail } from '../FilterRail'
  import { DEFAULT_SHOP_FILTERS } from '@/lib/shop/filter-params'

  // Each Section renders a FilterAutoSubmitSelect, which reads the app-router hooks.
  vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    usePathname: () => '/catalogue',
    useSearchParams: () => new URLSearchParams(),
  }))

  const facets = { brands: [], categories: [], garmentFamilies: [] }

  describe('FilterRail ordering-mode gate (Item 7)', () => {
    it('shows the Ordering mode filter by default (member can reorder)', () => {
      render(<FilterRail filters={DEFAULT_SHOP_FILTERS} facets={facets} basePath="/catalogue" />)
      expect(screen.getByText('Ordering mode')).toBeInTheDocument()
    })

    it('hides the Ordering mode filter when showModeFilter is false (stock_only member)', () => {
      render(
        <FilterRail
          filters={DEFAULT_SHOP_FILTERS}
          facets={facets}
          basePath="/catalogue"
          showModeFilter={false}
        />,
      )
      expect(screen.queryByText('Ordering mode')).not.toBeInTheDocument()
      // The rest of the rail is untouched.
      expect(screen.getByText('Brand')).toBeInTheDocument()
    })
  })
  ```
  (`DEFAULT_SHOP_FILTERS` has `mode: 'all'` and no active filters, so `activeFilterCount` is 0 and the `next/link` "Clear all" anchor never renders — no router needed for it.)

- [x] **Step 7: Run it — expect RED.**
  ```
  cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run components/shop/__tests__/FilterRail.test.tsx
  ```
  Expected FAIL: the second test throws `expect(element).not.toBeInTheDocument()` — `FilterRail` ignores the (not-yet-declared) `showModeFilter` prop and still renders the `Ordering mode` section. First test passes.

- [x] **Step 8: Add the `showModeFilter` prop and gate the section.**
  In `components/shop/FilterRail.tsx`, extend `Props` (9-14):
  ```tsx
  // OLD
  interface Props {
    filters: ShopFilters
    facets: ShopFacets
    /** Route to post back to. `/catalogue` for catalogue listing, `/shop` for inventory. */
    basePath: '/catalogue' | '/shop'
  }

  export function FilterRail({ filters, facets, basePath }: Props) {
  ```
  ```tsx
  // NEW
  interface Props {
    filters: ShopFilters
    facets: ShopFacets
    /** Route to post back to. `/catalogue` for catalogue listing, `/shop` for inventory. */
    basePath: '/catalogue' | '/shop'
    /**
     * Whether to show the "Ordering mode" filter. Hidden for stock_only members
     * (memberCanReorder === false) — the same condition that hides the PDP
     * order-mode pill: they can only ever draw from stock, so a "Purchase order"
     * filter option would be inert. Defaults to shown.
     */
    showModeFilter?: boolean
  }

  export function FilterRail({ filters, facets, basePath, showModeFilter = true }: Props) {
  ```
  Wrap the Ordering-mode `Section` (70-81):
  ```tsx
  // OLD
        <Section label="Ordering mode">
          <FilterAutoSubmitSelect
            name="mode"
            defaultValue={filters.mode === 'all' ? '' : filters.mode}
            ariaLabel="Filter by ordering mode"
            options={[
              { value: '', label: 'All' },
              { value: 'from_inventory', label: PILL_LABELS.from_inventory },
              { value: 'reorder', label: PILL_LABELS.reorder },
            ]}
          />
        </Section>
  ```
  ```tsx
  // NEW
        {showModeFilter && (
          <Section label="Ordering mode">
            <FilterAutoSubmitSelect
              name="mode"
              defaultValue={filters.mode === 'all' ? '' : filters.mode}
              ariaLabel="Filter by ordering mode"
              options={[
                { value: '', label: 'All' },
                { value: 'from_inventory', label: PILL_LABELS.from_inventory },
                { value: 'reorder', label: PILL_LABELS.reorder },
              ]}
            />
          </Section>
        )}
  ```

- [x] **Step 9: Run — expect GREEN.**
  ```
  cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run components/shop/__tests__/FilterRail.test.tsx
  ```
  Expected PASS on both.

- [x] **Step 10: Commit.**
  ```
  git add -A && git commit -m "feat: gate catalogue ordering-mode filter behind showModeFilter prop"
  ```

- [x] **Step 11: Wire the catalogue page to hide the filter for stock_only members.**
  In `app/(portal)/catalogue/page.tsx`, extend the import (line 14):
  ```tsx
  // OLD
  import { effectiveFulfilment, matchesMode, type FulfilmentType } from '@/lib/shop/fulfilment-mode'
  ```
  ```tsx
  // NEW
  import { effectiveFulfilment, matchesMode, memberCanReorder, type FulfilmentType } from '@/lib/shop/fulfilment-mode'
  ```
  Pass the gate to `FilterRail` (line 553):
  ```tsx
  // OLD
              <FilterRail filters={filters} facets={facets} basePath="/catalogue" />
  ```
  ```tsx
  // NEW
              <FilterRail
                filters={filters}
                facets={facets}
                basePath="/catalogue"
                showModeFilter={memberCanReorder(context.orderingPermission)}
              />
  ```

- [x] **Step 12: Verify the page compiles with the new prop/import.**
  ```
  cd /Users/jamierogangeorge/Documents/print-room-portal && npx tsc --noEmit
  ```
  Expected: no NEW type errors originating from `app/(portal)/catalogue/page.tsx` or `components/shop/FilterRail.tsx` (`showModeFilter` accepted; `memberCanReorder(context.orderingPermission)` types as `boolean`). (This is a server component with Supabase deps, not unit-testable in isolation; the behaviour is covered by the `FilterRail` + `memberCanReorder` tests, and this step confirms the wiring type-checks.)

- [x] **Step 13: Commit.**
  ```
  git add -A && git commit -m "feat: hide ordering-mode filter for stock-only members"
  ```

---

<!-- ===== Build step 4/8 · cluster: items-3-10-5-orders-ia-two-surface-split ===== -->

## Cluster: Orders IA two-surface split (Items 5, 10, 3)

Splits the single "Orders" experience into two role-appropriate surfaces:
- **Track my Project** (`/tracking` + `/order-tracker`) becomes **admin-only** (Item 5).
- **Orders** → **Past orders** (`/my-collections`) is repointed to placed `stock_on_hand` orders with courier tracking (Item 10) and role-scoped with filters (Item 3).

This is **not** a third unified page. The two surfaces keep their existing routes and clients.

**Cluster-wide dependency (Consumes):** the **Order-type foundation task** adds `orders.order_type` enum `'stock_on_hand' | 'purchase_order'` (interim rule: any `made_to_order` line ⇒ `purchase_order`). All queries below filter `order_type = 'stock_on_hand'` and return nothing until that column exists and is backfilled. Land this cluster after the foundation task.

Repo for every file below: **P = `/Users/jamierogangeorge/Documents/print-room-portal`**. Run tests with `cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run <path>`.

---

### Task: Make the project tracker admin-only (nav gate + server-side redirect) — Item 5

Hides **Track my Project** from the nav for non-admins AND blocks direct-URL access with a server-side `redirect()` (nav-hide alone does not stop `/tracking`).

**Files:**
- Modify `P/lib/nav/portal-nav.ts` (Track my Project item, lines 42–50: flip `requiresOrgAdmin`)
- Modify `P/lib/nav/__tests__/portal-nav.test.ts` (add tracking-gating cases)
- Modify `P/app/(portal)/order-tracker/page.tsx` (lines 1–12: add guard; `/tracking` inherits it via its re-export)
- Create `P/app/(portal)/order-tracker/__tests__/guard.test.tsx` (redirect test)

**Interfaces:**
- Consumes: `getPortalCompanyAccess(): Promise<B2BCustomerAccess | null>` (already exported from `lib/portal-data.ts:81`; the guard reads only `.isOrgAdmin`); `getNavigationItems(access: NavAccess): PortalNavItem[]` (`lib/nav/portal-nav.ts:93`).
- Produces: no downstream type; behavior only (staff → `redirect('/my-collections')` from the tracker; nav row hidden when `!isOrgAdmin`).

Steps:

- [x] **Step 1: Failing nav test — tracker hidden from staff, shown to admin.** Add to `P/lib/nav/__tests__/portal-nav.test.ts` (the `access()` helper + `hrefs()` already exist at lines 4–13):
  ```ts
  describe('getNavigationItems — Track my Project gating (Item 5)', () => {
    it('shows Track my Project to an org_admin', () => {
      expect(hrefs(access({ isOrgAdmin: true }))).toContain('/tracking')
    })
    it('hides Track my Project from a non-admin (staff)', () => {
      expect(hrefs(access({ isOrgAdmin: false }))).not.toContain('/tracking')
    })
  })
  ```
  Run: `cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run lib/nav/__tests__/portal-nav.test.ts` — expect FAIL on "hides Track my Project from a non-admin" (currently `requiresOrgAdmin: false`, so `/tracking` is always present).

- [x] **Step 2: Gate the nav item.** In `P/lib/nav/portal-nav.ts`, the current Track my Project item (lines 42–50) is:
  ```ts
  {
    name: 'Track my Project',
    href: '/tracking',
    iconKey: 'tracking',
    requiresCompany: false,
    requiresLeavers: false,
    requiresOrgAdmin: false,
    requiredTenantTypes: null,
  },
  ```
  Change `requiresOrgAdmin: false` → `requiresOrgAdmin: true` (same mechanism the Inventory item uses at lines 73–81). Re-run the command from Step 1 — expect PASS (all cases).

- [x] **Step 3: Commit.** `git add -A && git commit -m "feat: gate Track my Project nav on org admin"`

- [x] **Step 4: Failing guard test for direct-URL access.** Create `P/app/(portal)/order-tracker/__tests__/guard.test.tsx`:
  ```ts
  import { describe, it, expect, vi, beforeEach } from 'vitest'

  const mocks = vi.hoisted(() => ({
    access: vi.fn(),
    trackerData: vi.fn(async () => ({ trackers: [], isCompanyWide: false, ownerKey: null, preOrders: [] })),
  }))

  vi.mock('next/navigation', () => ({
    redirect: (url: string) => {
      throw new Error(`REDIRECT:${url}`)
    },
  }))

  vi.mock('@/lib/portal-data', () => ({
    getPortalCompanyAccess: mocks.access,
    getPortalOrderTrackerData: mocks.trackerData,
  }))

  // The client is a heavy 'use client' component — stub it so the page module imports cleanly.
  vi.mock('../OrderTrackerClient', () => ({ OrderTrackerClient: () => null }))

  describe('OrderTrackerPage guard (Item 5)', () => {
    beforeEach(() => {
      mocks.trackerData.mockClear()
    })

    it('redirects a staff (non-admin) user to /my-collections and never loads tracker data', async () => {
      mocks.access.mockResolvedValueOnce({ isOrgAdmin: false } as never)
      const { default: OrderTrackerPage } = await import('../page')
      await expect(OrderTrackerPage()).rejects.toThrow('REDIRECT:/my-collections')
      expect(mocks.trackerData).not.toHaveBeenCalled()
    })

    it('redirects an unauthenticated user to /sign-in', async () => {
      mocks.access.mockResolvedValueOnce(null)
      const { default: OrderTrackerPage } = await import('../page')
      await expect(OrderTrackerPage()).rejects.toThrow('REDIRECT:/sign-in')
    })

    it('lets an org_admin through (loads tracker data)', async () => {
      mocks.access.mockResolvedValueOnce({ isOrgAdmin: true } as never)
      const { default: OrderTrackerPage } = await import('../page')
      await OrderTrackerPage()
      expect(mocks.trackerData).toHaveBeenCalledOnce()
    })
  })
  ```
  Run: `cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run "app/(portal)/order-tracker/__tests__/guard.test.tsx"` — expect FAIL (the page has no guard yet: `getPortalCompanyAccess` is not imported/called, so the staff case does not throw and `trackerData` IS called).

- [x] **Step 5: Add the guard.** Replace the whole body of `P/app/(portal)/order-tracker/page.tsx` (current lines 1–12):
  ```ts
  import type { Metadata } from 'next'
  import { OrderTrackerClient } from './OrderTrackerClient'
  import { getPortalOrderTrackerData } from '@/lib/portal-data'

  export const metadata: Metadata = {
    title: 'Track my Project',
  }

  export default async function OrderTrackerPage() {
    const initialData = await getPortalOrderTrackerData()
    return <OrderTrackerClient initialData={initialData} />
  }
  ```
  with:
  ```ts
  import type { Metadata } from 'next'
  import { redirect } from 'next/navigation'
  import { OrderTrackerClient } from './OrderTrackerClient'
  import { getPortalOrderTrackerData, getPortalCompanyAccess } from '@/lib/portal-data'

  export const metadata: Metadata = {
    title: 'Track my Project',
  }

  export default async function OrderTrackerPage() {
    // Item 5: tracker is admin-only. Nav-hide is not enough — block direct URLs.
    // /tracking re-exports this default, so it is covered too.
    const access = await getPortalCompanyAccess()
    if (!access) redirect('/sign-in')
    if (!access.isOrgAdmin) redirect('/my-collections')

    const initialData = await getPortalOrderTrackerData()
    return <OrderTrackerClient initialData={initialData} />
  }
  ```
  Re-run the Step 4 command — expect PASS (all three cases). `/tracking` is automatically guarded because `app/(portal)/tracking/page.tsx` (line 2) does `import OrderTrackerPage from '../order-tracker/page'` and re-exports it — leave that file unchanged.

- [x] **Step 6: Commit.** `git add -A && git commit -m "feat: redirect non-admins away from project tracker"`

---

### Task: Rename Orders → Past orders and repoint to stock_on_hand orders with tracking — Item 10

Renames the nav label and page heading, and repoints the `/my-collections` data source from the org-wide `quotes` list to placed **`stock_on_hand` orders** joined to their quote (for display fields) with **courier tracking** overlaid from `job_trackers.tracking_info`. Implemented as a **new** fetcher (`fetchPastOrdersForUser`) + route so the shared `getPortalAccountData` (account page) is untouched. No reorder action (already absent). Org-wide scope here; role scope is added in the next task.

**Files:**
- Modify `P/lib/nav/portal-nav.ts` (Orders item, lines 51–59: rename label)
- Modify `P/lib/nav/__tests__/portal-nav.test.ts` (assert renamed label)
- Modify `P/lib/portal-data.ts` (add `PastOrderTracking`, `PortalPastOrder`, `PortalPastOrdersData`, `fetchPastOrdersForUser`, `getPortalPastOrdersData`, helpers `mapPastOrderRow`, `overlayTrackingInfo` — after the existing account-data block, around lines 279–287)
- Create `P/app/api/past-orders/route.ts`
- Modify `P/app/(portal)/my-collections/page.tsx` (swap data source)
- Modify `P/app/(portal)/my-collections/MyCollectionsClient.tsx` (heading, types, fetch URL, card → order card with tracking)
- Create `P/app/(portal)/my-collections/__tests__/past-orders.data.test.ts`

**Interfaces:**
- Consumes: `orders.order_type` (`'stock_on_hand' | 'purchase_order'`) from the **Order-type foundation task**; `getSupabaseServer()` (`lib/supabase`), `getPortalUser()` (`lib/portal-data.ts:73`), `cacheTags.accountData` + `cacheRevalidate.accountData` (`lib/cache/tags`, already imported at `portal-data.ts:14`), `getTrackingNumber` + `TrackingInfo` (`lib/job-tracker`), `orderStatusLabel` + `OrderStatus` (`lib/orders/status-labels`).
- Produces: `PortalPastOrder`, `PastOrderTracking`, `PortalPastOrdersData`, `getPortalPastOrdersData(): Promise<PortalPastOrdersData>`; `GET /api/past-orders → PortalPastOrdersData`.

Steps:

- [x] **Step 1: Failing nav label test.** Add to `P/lib/nav/__tests__/portal-nav.test.ts`:
  ```ts
  import { PORTAL_NAV_ITEMS } from '../portal-nav'

  describe('Orders → Past orders rename (Item 10)', () => {
    it('labels the /my-collections item "Past orders"', () => {
      const item = PORTAL_NAV_ITEMS.find((i) => i.href === '/my-collections')
      expect(item?.name).toBe('Past orders')
    })
  })
  ```
  Run: `cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run lib/nav/__tests__/portal-nav.test.ts` — expect FAIL (`name` is still `'Orders'`).

- [x] **Step 2: Rename the nav item.** In `P/lib/nav/portal-nav.ts` the Orders item (lines 51–59) currently starts `name: 'Orders',` — change to `name: 'Past orders',` (leave `href: '/my-collections'` and everything else). Re-run Step 1 command — expect PASS.

- [x] **Step 3: Commit.** `git add -A && git commit -m "feat: rename Orders nav to Past orders"`

- [x] **Step 4: Failing data-layer test for the Past-orders fetcher.** Create `P/app/(portal)/my-collections/__tests__/past-orders.data.test.ts` (mirrors the existing `account-data.order-status.test.tsx` mock harness):
  ```ts
  import { describe, expect, it, vi } from 'vitest'

  const mocks = vi.hoisted(() => ({ admin: { from: vi.fn() } }))

  vi.mock('@/lib/supabase-server-component', () => ({
    getSupabaseServerComponent: vi.fn(async () => ({
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'user-1', email: 'buyer@example.com' } } })) },
    })),
  }))
  vi.mock('@/lib/supabase', () => ({ getSupabaseServer: () => mocks.admin }))
  vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }))

  function builder(result: unknown) {
    const b: Record<string, unknown> = {
      select: vi.fn(() => b),
      eq: vi.fn(() => b),
      in: vi.fn(() => b),
      order: vi.fn(async () => result),
      maybeSingle: vi.fn(async () => result),
    }
    return b
  }

  describe('getPortalPastOrdersData (Item 10)', () => {
    it('returns stock_on_hand orders with tracking overlaid from job_trackers', async () => {
      mocks.admin.from.mockImplementation((table: string) => {
        if (table === 'user_organizations')
          return builder({ data: { organization_id: 'org-1', role: 'org_admin' }, error: null })
        if (table === 'stores') return builder({ data: [], error: null })
        if (table === 'orders')
          return builder({
            data: [
              {
                id: 'order-1',
                status: 'shipped',
                created_at: '2026-05-15T00:00:00.000Z',
                quote_id: 'quote-1',
                quotes: {
                  organization_id: 'org-1',
                  created_by: 'user-1',
                  order_ref: 'PR-1001',
                  quote_number: 'Q-1',
                  reference: null,
                  customer_name: 'Buyer',
                  customer_email: 'buyer@example.com',
                  customer_company: 'PRT',
                  subtotal: 100,
                  total_amount: 115,
                  currency: 'NZD',
                },
              },
            ],
            error: null,
          })
        if (table === 'job_trackers')
          return builder({
            data: [{ quote_id: 'quote-1', tracking_info: { carrier: 'NZ Post', trackingNumber: '1234567890', url: 'https://track/1234567890' } }],
            error: null,
          })
        return builder({ data: null, error: null })
      })

      const { getPortalPastOrdersData } = await import('@/lib/portal-data')
      const data = await getPortalPastOrdersData()
      expect(data.orders).toEqual([
        expect.objectContaining({
          orderId: 'order-1',
          orderRef: 'PR-1001',
          status: 'shipped',
          totalAmount: 115,
          currency: 'NZD',
          tracking: { carrier: 'NZ Post', trackingNumber: '1234567890', url: 'https://track/1234567890' },
        }),
      ])
    })
  })
  ```
  Run: `cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run "app/(portal)/my-collections/__tests__/past-orders.data.test.ts"` — expect FAIL: `getPortalPastOrdersData is not a function` (not yet exported).

  **Execution note:** the supplied mock originally returned the plain builder from terminal `.in()`, unlike Supabase's awaitable query builder, so the tracking fixture could never resolve. During execution `.in()` was corrected to resolve `result`; the production seam and assertion are unchanged.

- [x] **Step 5: Add the Past-orders types.** In `P/lib/portal-data.ts`, after the `PortalAccountData` interface (ends line 50), add:
  ```ts
  export interface PastOrderTracking {
    carrier: string | null
    trackingNumber: string | null
    url: string | null
  }

  export interface PortalPastOrder {
    orderId: string
    quoteId: string | null
    orderRef: string | null
    quoteNumber: string | null
    reference: string | null
    status: string
    customerName: string | null
    customerEmail: string | null
    customerCompany: string | null
    subtotal: number
    totalAmount: number
    currency: string
    createdAt: string
    tracking: PastOrderTracking | null
  }

  export interface PortalPastOrdersData {
    orders: PortalPastOrder[]
    stores: PortalAccountStore[]
    ownerKey: string | null
  }

  interface PastOrderRow {
    id: string
    status: string | null
    created_at: string | null
    quote_id: string | null
    quotes: {
      organization_id: string | null
      created_by: string | null
      order_ref: string | null
      quote_number: string | null
      reference: string | null
      customer_name: string | null
      customer_email: string | null
      customer_company: string | null
      subtotal: number | null
      total_amount: number | null
      currency: string | null
    } | null
  }
  ```

- [x] **Step 6: Add the tracking import.** At the top of `P/lib/portal-data.ts`, line 12 currently is:
  ```ts
  import type { JobTracker } from '@/lib/job-tracker'
  ```
  Change to:
  ```ts
  import { getTrackingNumber, type JobTracker, type TrackingInfo } from '@/lib/job-tracker'
  ```

- [x] **Step 7: Add the fetcher + helpers + public accessor.** In `P/lib/portal-data.ts`, immediately after the existing `getPortalAccountData` accessor (ends at line 287, `})`), add:
  ```ts
  function mapPastOrderRow(row: PastOrderRow): PortalPastOrder {
    return {
      orderId: row.id,
      quoteId: row.quote_id,
      orderRef: row.quotes?.order_ref ?? null,
      quoteNumber: row.quotes?.quote_number ?? null,
      reference: row.quotes?.reference ?? null,
      status: row.status ?? 'awaiting-approval',
      customerName: row.quotes?.customer_name ?? null,
      customerEmail: row.quotes?.customer_email ?? null,
      customerCompany: row.quotes?.customer_company ?? null,
      subtotal: Number(row.quotes?.subtotal ?? 0),
      totalAmount: Number(row.quotes?.total_amount ?? 0),
      currency: row.quotes?.currency ?? 'NZD',
      createdAt: row.created_at ?? new Date().toISOString(),
      tracking: null,
    }
  }

  async function overlayTrackingInfo(
    adminClient: SupabaseClient,
    orders: PortalPastOrder[],
  ): Promise<PortalPastOrder[]> {
    const quoteIds = orders.map((o) => o.quoteId).filter(Boolean) as string[]
    if (quoteIds.length === 0) return orders

    const { data: trackerRows } = await adminClient
      .from('job_trackers')
      .select('quote_id, tracking_info')
      .in('quote_id', quoteIds)

    const byQuoteId = new Map<string, TrackingInfo | null>()
    for (const row of (trackerRows ?? []) as Array<{
      quote_id: string | null
      tracking_info: TrackingInfo | null
    }>) {
      if (!row.quote_id || byQuoteId.has(row.quote_id)) continue
      byQuoteId.set(row.quote_id, row.tracking_info)
    }

    return orders.map((order) => {
      const info = order.quoteId ? byQuoteId.get(order.quoteId) : null
      if (!info) return order
      return {
        ...order,
        tracking: {
          carrier: info.carrier ?? null,
          trackingNumber: getTrackingNumber(info) ?? null,
          url: info.url ?? null,
        },
      }
    })
  }

  const fetchPastOrdersForUser = unstable_cache(
    async (userId: string, email: string | null): Promise<PortalPastOrdersData> => {
      const adminClient = getSupabaseServer()
      const { data: membership } = await adminClient
        .from('user_organizations')
        .select('organization_id, role')
        .eq('user_id', userId)
        .maybeSingle()

      let orders: PortalPastOrder[] = []
      let stores: PortalAccountStore[] = []

      if (membership?.organization_id) {
        const { data: storesData } = await adminClient
          .from('stores')
          .select('id, name, address, location, city, state, country, postal_code, phone')
          .eq('organization_id', membership.organization_id)
          .order('created_at', { ascending: true })
        stores = (storesData || []) as PortalAccountStore[]

        // Past orders = placed stock_on_hand orders. Display fields come from the
        // joined quote (orders carries no org/customer columns). order_type is
        // added by the Order-type foundation task.
        const { data: orderRows } = await adminClient
          .from('orders')
          .select(
            `id, status, created_at, quote_id,
             quotes!inner (
               organization_id, created_by, order_ref, quote_number, reference,
               customer_name, customer_email, customer_company,
               subtotal, total_amount, currency
             )`,
          )
          .eq('order_type', 'stock_on_hand')
          .eq('quotes.organization_id', membership.organization_id)
          .order('created_at', { ascending: false })

        orders = await overlayTrackingInfo(
          adminClient,
          ((orderRows ?? []) as unknown as PastOrderRow[]).map(mapPastOrderRow),
        )
      }

      return {
        orders,
        stores,
        ownerKey: membership?.organization_id
          ? `org:${membership.organization_id}`
          : `user:${userId}`,
      }
    },
    ['portal-past-orders-data'],
    {
      tags: [cacheTags.accountData],
      revalidate: cacheRevalidate.accountData,
    },
  )

  export const getPortalPastOrdersData = cache(async (): Promise<PortalPastOrdersData> => {
    const user = await getPortalUser()
    if (!user) {
      return { orders: [], stores: [], ownerKey: null }
    }
    return fetchPastOrdersForUser(user.id, user.email ?? null)
  })
  ```
  Re-run the Step 4 command — expect PASS.

- [x] **Step 8: Commit.** `git add -A && git commit -m "feat: add getPortalPastOrdersData fetcher with tracking overlay"`

- [x] **Step 9: Add the API route** (the client refetches on org switch — mirrors `/api/account-data`). Create `P/app/api/past-orders/route.ts`:
  ```ts
  import { NextResponse } from 'next/server'
  import { getPortalPastOrdersData } from '@/lib/portal-data'

  export async function GET() {
    return NextResponse.json(await getPortalPastOrdersData())
  }
  ```

- [x] **Step 10: Point the page at the new data.** In `P/app/(portal)/my-collections/page.tsx`, replace the two `getPortalAccountData` references:
  ```ts
  import { getPortalAccountData } from '@/lib/portal-data'
  ...
    const initialData = await getPortalAccountData()
  ```
  with:
  ```ts
  import { getPortalPastOrdersData } from '@/lib/portal-data'
  ...
    const initialData = await getPortalPastOrdersData()
  ```

- [x] **Step 11: Repoint the client type + heading + fetch.** In `P/app/(portal)/my-collections/MyCollectionsClient.tsx`:
  - Line 8 import — replace `import type { PortalAccountData, PortalAccountQuote } from '@/lib/portal-data'` with:
    ```ts
    import type { PortalPastOrdersData, PortalPastOrder } from '@/lib/portal-data'
    import { orderStatusLabel, type OrderStatus } from '@/lib/orders/status-labels'
    import { getTrackingNumber } from '@/lib/job-tracker'
    ```
  - Lines 10–11 — replace `type StatusFilter = 'awaiting' | 'approved'` and `type Quote = PortalAccountQuote` with `type Order = PortalPastOrder`.
  - Lines 22–24 — change the props interface to `interface MyCollectionsClientProps { initialData: PortalPastOrdersData }`.
  - Lines 29–34 — replace the quote state block:
    ```ts
    const [quotes, setQuotes] = useState<Quote[]>(
      initialData.recentQuotes.filter((q) => q.source !== 'b2b-portal-design-collection'),
    )
    const [dataOwnerKey, setDataOwnerKey] = useState(initialData.ownerKey)
    const [dataLoading, setDataLoading] = useState(false)
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('awaiting')
    ```
    with:
    ```ts
    const [orders, setOrders] = useState<Order[]>(initialData.orders)
    const [dataOwnerKey, setDataOwnerKey] = useState(initialData.ownerKey)
    const [dataLoading, setDataLoading] = useState(false)
    ```
    (Filter state is added in the Item 3 task.)
  - Inside the `useEffect` (lines 51–74) rename `setQuotes` → `setOrders`, change the fetch URL and the response mapping:
    - Line 54 `setQuotes([])` → `setOrders([])`.
    - Line 57 `fetch('/api/account-data', { signal: controller.signal })` → `fetch('/api/past-orders', { signal: controller.signal })`.
    - Lines 58–66 replace the `.then` chain body:
      ```ts
      .then((r) => (r.ok ? r.json() : { orders: [], ownerKey: currentOwnerKey }))
      .then((data: PortalPastOrdersData) => {
        if (stale) return
        setOrders(data.orders || [])
        setDataOwnerKey(data.ownerKey ?? currentOwnerKey)
        setDataLoading(false)
      })
      ```
    - Line 71 `setQuotes([])` (in `.catch`) → `setOrders([])`.
  - Lines 82–85 — delete the `filteredQuotes` derivation for now (replaced by the Item 3 filter task). Temporarily use `orders` directly.
  - Line 94 heading — `Orders` → `Past orders`.
  - Lines 98–115 — remove the Awaiting/Approved `FilterChip` block (Item 3 replaces the controls).
  - Lines 118–140 — render loop: `filteredQuotes` → `orders`, `quotes.length` guards → `orders.length`, `<QuoteCard key={quote.id} quote={quote} />` → `<OrderCard key={order.orderId} order={order} />`.

- [x] **Step 12: Replace `QuoteCard` with `OrderCard` (adds tracking row + real order-status label).** Replace the `QuoteCard` function (lines 147–196) with:
  ```tsx
  function OrderCard({ order }: { order: Order }) {
    const title =
      order.orderRef ||
      order.reference ||
      order.quoteNumber ||
      `#${order.orderId.slice(0, 8).toUpperCase()}`

    const customer =
      order.customerCompany || order.customerName || order.customerEmail

    const statusLabel = orderStatusLabel(order.status as OrderStatus)
    const trackingNumber = order.tracking?.trackingNumber
    const trackingUrl = order.tracking?.url ?? undefined

    return (
      <Link
        href={`/my-collections/${order.quoteId ?? order.orderId}`}
        className="block rounded-3xl bg-white p-6 transition-colors duration-200 hover:bg-gray-50 active:scale-[0.99]"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="font-semibold text-black">{title}</h3>
            <p className="mt-1 text-sm text-gray-600">
              {new Date(order.createdAt).toLocaleDateString('en-NZ', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })}{' '}
              · {customer}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <p className="font-semibold text-black">
              {formatCurrency(order.totalAmount, order.currency)}{' '}
              <span className="text-sm font-normal text-black">{order.currency}</span>
            </p>
            <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-700">
              {statusLabel}
            </span>
          </div>
        </div>
        <div className="mt-3 border-t border-gray-100 pt-3 text-sm text-gray-500">
          {trackingNumber ? (
            <span>
              Tracking {order.tracking?.carrier ? `(${order.tracking.carrier}) ` : ''}
              {trackingUrl ? (
                <span className="text-gray-700 underline">{trackingNumber}</span>
              ) : (
                <span className="text-gray-700">{trackingNumber}</span>
              )}
            </span>
          ) : (
            <span>Subtotal {formatCurrency(order.subtotal, order.currency)}</span>
          )}
        </div>
      </Link>
    )
  }
  ```
  Note: `getTrackingNumber` is imported for parity with the server overlay but the value is already clean on `order.tracking.trackingNumber`; drop the import if unused to satisfy lint.

- [x] **Step 13: Typecheck + full my-collections test run.** Run `cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run "app/(portal)/my-collections/__tests__/"` — expect PASS (the pre-existing `account-data.order-status.test.tsx` still passes because `getPortalAccountData` is unchanged). Also run `npx tsc --noEmit` if the repo exposes it — expect no new type errors in the touched files.

- [x] **Step 14: Commit.** `git add -A && git commit -m "feat: repoint Past orders to stock_on_hand orders with tracking"`

---

### Task: Role-scope Past orders (staff = own, admin = org) + status/date filters — Item 3

Wires the role gate the codebase already models (`buildAccess().canSeeAllOrgOrders = isOrgAdmin`, `company.ts:233`) into the actual Past-orders query, and adds **status + date** filter controls to both the Past-orders and tracker surfaces. **Store** filter is a Decision gate (no clean per-order store).

**Files:**
- Modify `P/lib/portal-data.ts` (`fetchPastOrdersForUser` order query: add role scope)
- Create `P/lib/orders/past-orders-filter.ts` (pure `withinDateRange` + `filterPastOrders`)
- Create `P/lib/orders/__tests__/past-orders-filter.test.ts`
- Create `P/app/(portal)/my-collections/__tests__/past-orders.scope.test.ts`
- Modify `P/app/(portal)/my-collections/MyCollectionsClient.tsx` (filter state + controls)
- Modify `P/app/(portal)/order-tracker/OrderTrackerClient.tsx` (date-range filter)

**Interfaces:**
- Consumes: `PortalPastOrder`, `getPortalPastOrdersData` (from the repoint task); `JobTracker.created_at` (`lib/job-tracker.ts`); `OrderStatus` + `orderStatusLabel` (`lib/orders/status-labels`).
- Produces: `withinDateRange(iso: string, from: string | null, to: string | null): boolean`; `filterPastOrders(orders: PortalPastOrder[], f: PastOrderFilters): PortalPastOrder[]`; `interface PastOrderFilters { status: string; from: string | null; to: string | null }`.

Steps:

- [x] **Step 1: Failing scope test — staff sees only own orders.** Create `P/app/(portal)/my-collections/__tests__/past-orders.scope.test.ts`. It captures the `.eq()` calls on the `orders` builder to prove the `created_by` filter is applied for staff and omitted for admins:
  ```ts
  import { describe, expect, it, vi } from 'vitest'

  const mocks = vi.hoisted(() => ({ admin: { from: vi.fn() }, ordersEq: vi.fn() }))

  vi.mock('@/lib/supabase-server-component', () => ({
    getSupabaseServerComponent: vi.fn(async () => ({
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'user-1', email: 'b@x.co' } } })) },
    })),
  }))
  vi.mock('@/lib/supabase', () => ({ getSupabaseServer: () => mocks.admin }))
  vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }))

  function membershipBuilder(role: string) {
    const b: Record<string, unknown> = {
      select: vi.fn(() => b),
      eq: vi.fn(() => b),
      maybeSingle: vi.fn(async () => ({ data: { organization_id: 'org-1', role }, error: null })),
    }
    return b
  }
  function ordersBuilder() {
    const b: Record<string, unknown> = {
      select: vi.fn(() => b),
      eq: vi.fn((col: string, val: unknown) => {
        mocks.ordersEq(col, val)
        return b
      }),
      order: vi.fn(async () => ({ data: [], error: null })),
    }
    return b
  }
  function emptyBuilder() {
    const b: Record<string, unknown> = {
      select: vi.fn(() => b),
      eq: vi.fn(() => b),
      in: vi.fn(() => b),
      order: vi.fn(async () => ({ data: [], error: null })),
    }
    return b
  }

  async function run(role: string) {
    mocks.ordersEq.mockClear()
    mocks.admin.from.mockImplementation((table: string) => {
      if (table === 'user_organizations') return membershipBuilder(role)
      if (table === 'orders') return ordersBuilder()
      return emptyBuilder()
    })
    vi.resetModules()
    const { getPortalPastOrdersData } = await import('@/lib/portal-data')
    await getPortalPastOrdersData()
    return mocks.ordersEq.mock.calls
  }

  describe('Past-orders role scope (Item 3)', () => {
    it('staff: scopes orders to quotes.created_by = userId', async () => {
      const calls = await run('staff')
      expect(calls).toContainEqual(['order_type', 'stock_on_hand'])
      expect(calls).toContainEqual(['quotes.organization_id', 'org-1'])
      expect(calls).toContainEqual(['quotes.created_by', 'user-1'])
    })
    it('org_admin: does NOT add the created_by filter', async () => {
      const calls = await run('org_admin')
      expect(calls).toContainEqual(['quotes.organization_id', 'org-1'])
      expect(calls).not.toContainEqual(['quotes.created_by', 'user-1'])
    })
  })
  ```
  Run: `cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run "app/(portal)/my-collections/__tests__/past-orders.scope.test.ts"` — expect FAIL on the staff case (the repoint query is org-only; no `created_by` filter yet).

- [x] **Step 2: Add the role scope.** In `P/lib/portal-data.ts` `fetchPastOrdersForUser`, replace the single-expression order query (added in the repoint task) with a builder that conditionally adds the owner filter — mirroring the pre-order scoping at lines 155–169:
  ```ts
  const canSeeAllOrgOrders = membership.role === 'org_admin'

  let orderQuery = adminClient
    .from('orders')
    .select(
      `id, status, created_at, quote_id,
       quotes!inner (
         organization_id, created_by, order_ref, quote_number, reference,
         customer_name, customer_email, customer_company,
         subtotal, total_amount, currency
       )`,
    )
    .eq('order_type', 'stock_on_hand')
    .eq('quotes.organization_id', membership.organization_id)
    .order('created_at', { ascending: false })

  // staff (non-admin) see only their own placed stock orders; org_admin sees the
  // whole org. This is the same rule buildAccess().canSeeAllOrgOrders encodes.
  if (!canSeeAllOrgOrders) {
    orderQuery = orderQuery.eq('quotes.created_by', userId)
  }

  const { data: orderRows } = await orderQuery
  ```
  Re-run the Step 1 command — expect PASS. Then re-run the repoint task's data test (`past-orders.data.test.ts`, whose membership mock has `role: 'org_admin'`) to confirm no regression — expect PASS.

- [x] **Step 3: Commit.** `git add -A && git commit -m "feat: role-scope Past orders (staff own, admin org)"`

- [x] **Step 4: Failing test for the pure filter helpers.** Create `P/lib/orders/__tests__/past-orders-filter.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { withinDateRange, filterPastOrders } from '../past-orders-filter'
  import type { PortalPastOrder } from '@/lib/portal-data'

  function order(over: Partial<PortalPastOrder>): PortalPastOrder {
    return {
      orderId: over.orderId ?? 'o',
      quoteId: null,
      orderRef: null,
      quoteNumber: null,
      reference: null,
      status: over.status ?? 'shipped',
      customerName: null,
      customerEmail: null,
      customerCompany: null,
      subtotal: 0,
      totalAmount: 0,
      currency: 'NZD',
      createdAt: over.createdAt ?? '2026-05-15T10:00:00.000Z',
      tracking: null,
    }
  }

  describe('withinDateRange', () => {
    it('is inclusive of both bounds on the date portion', () => {
      expect(withinDateRange('2026-05-15T23:59:00Z', '2026-05-15', '2026-05-15')).toBe(true)
      expect(withinDateRange('2026-05-14T00:00:00Z', '2026-05-15', null)).toBe(false)
      expect(withinDateRange('2026-05-16T00:00:00Z', null, '2026-05-15')).toBe(false)
    })
    it('treats null bounds as open', () => {
      expect(withinDateRange('2026-01-01T00:00:00Z', null, null)).toBe(true)
    })
  })

  describe('filterPastOrders', () => {
    const orders = [
      order({ orderId: 'a', status: 'shipped', createdAt: '2026-05-10T00:00:00Z' }),
      order({ orderId: 'b', status: 'in-production', createdAt: '2026-05-20T00:00:00Z' }),
    ]
    it('status "all" keeps everything', () => {
      expect(filterPastOrders(orders, { status: 'all', from: null, to: null })).toHaveLength(2)
    })
    it('filters by exact status', () => {
      expect(filterPastOrders(orders, { status: 'shipped', from: null, to: null }).map((o) => o.orderId)).toEqual(['a'])
    })
    it('filters by date range', () => {
      expect(filterPastOrders(orders, { status: 'all', from: '2026-05-15', to: null }).map((o) => o.orderId)).toEqual(['b'])
    })
  })
  ```
  Run: `cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run lib/orders/__tests__/past-orders-filter.test.ts` — expect FAIL: cannot resolve `../past-orders-filter`.

- [x] **Step 5: Implement the pure helpers.** Create `P/lib/orders/past-orders-filter.ts`:
  ```ts
  import type { PortalPastOrder } from '@/lib/portal-data'

  export interface PastOrderFilters {
    status: string // 'all' or an order_status value
    from: string | null // 'yyyy-mm-dd' inclusive
    to: string | null // 'yyyy-mm-dd' inclusive
  }

  /** Inclusive date-range test on the date portion of an ISO timestamp. */
  export function withinDateRange(iso: string, from: string | null, to: string | null): boolean {
    const day = iso.slice(0, 10)
    if (from && day < from) return false
    if (to && day > to) return false
    return true
  }

  export function filterPastOrders(orders: PortalPastOrder[], f: PastOrderFilters): PortalPastOrder[] {
    return orders.filter((o) => {
      if (f.status !== 'all' && o.status !== f.status) return false
      return withinDateRange(o.createdAt, f.from, f.to)
    })
  }
  ```
  Re-run the Step 4 command — expect PASS.

- [x] **Step 6: Commit.** `git add -A && git commit -m "feat: add pure past-orders filter helpers"`

- [x] **Step 7: Wire filters into the Past-orders client.** In `P/app/(portal)/my-collections/MyCollectionsClient.tsx`:
  - Add import: `import { filterPastOrders } from '@/lib/orders/past-orders-filter'`.
  - Add filter state next to `orders`:
    ```ts
    const [statusFilter, setStatusFilter] = useState<string>('all')
    const [dateFrom, setDateFrom] = useState<string>('')
    const [dateTo, setDateTo] = useState<string>('')
    ```
  - Derive options + filtered list before `return`:
    ```ts
    const statusOptions = Array.from(new Set(orders.map((o) => o.status)))
    const filteredOrders = filterPastOrders(orders, {
      status: statusFilter,
      from: dateFrom || null,
      to: dateTo || null,
    })
    ```
  - Between the `<header>` and the results block, render the controls (only when there is data), and change the results loop to iterate `filteredOrders`, with the "no matches" empty state keyed on `orders.length > 0`:
    ```tsx
    {orders.length > 0 && (
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-full bg-gray-100 px-4 py-1.5 text-xs font-medium text-gray-700"
        >
          <option value="all">All statuses</option>
          {statusOptions.map((s) => (
            <option key={s} value={s}>
              {orderStatusLabel(s as OrderStatus)}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="rounded-full bg-gray-100 px-4 py-1.5 text-xs text-gray-700"
          aria-label="From date"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="rounded-full bg-gray-100 px-4 py-1.5 text-xs text-gray-700"
          aria-label="To date"
        />
      </div>
    )}
    ```
    Then in the results block use `filteredOrders.length > 0 ? (...map OrderCard...) : orders.length > 0 ? (<PortalEmptyState title="No matches" body="Try widening the status or date filters." />) : (<PortalEmptyState title="Nothing here yet" .../>)`.

- [x] **Step 8: Failing tracker date-filter test (behavioural, via the helper).** The tracker already filters by status (`active`/`completed`) + search; Item 3 adds a date range reusing `withinDateRange`. Add a focused case to `P/lib/orders/__tests__/past-orders-filter.test.ts` proving the tracker will use the same inclusive semantics on `created_at`:
  ```ts
  describe('tracker date filter reuse', () => {
    it('keeps a tracker created inside the range', () => {
      expect(withinDateRange('2026-06-01T08:00:00Z', '2026-06-01', '2026-06-30')).toBe(true)
    })
    it('drops a tracker created before the range', () => {
      expect(withinDateRange('2026-05-31T23:00:00Z', '2026-06-01', null)).toBe(false)
    })
  })
  ```
  Run: `cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run lib/orders/__tests__/past-orders-filter.test.ts` — expect PASS (helper already exists; this locks the contract the tracker relies on).

- [x] **Step 9: Add the date range to the tracker client.** In `P/app/(portal)/order-tracker/OrderTrackerClient.tsx`:
  - Add import: `import { withinDateRange } from '@/lib/orders/past-orders-filter'`.
  - Add state next to `statusFilter` (line 29): `const [dateFrom, setDateFrom] = useState('')` and `const [dateTo, setDateTo] = useState('')`.
  - In the `filteredTrackers` `useMemo` (lines 81–100), after the status filter and before the search filter, add:
    ```ts
    if (dateFrom || dateTo) {
      result = result.filter((t) => withinDateRange(t.created_at, dateFrom || null, dateTo || null))
    }
    ```
    and add `dateFrom, dateTo` to the dependency array (line 100).
  - In the controls row (the `<div className="mb-6 flex flex-col gap-3 sm:flex-row">` at line 139), add two `<input type="date">` controls bound to `dateFrom`/`dateTo` (same styling as the search input, `aria-label` "From date"/"To date").

- [x] **Step 10: Decision gate — store filter (BLOCKED).** Item 3 asks for a store filter on both surfaces, but there is **no clean per-order store**: a `stock_on_hand` order can span multiple stores via `quote_items.ship_to_store_id`, and `job_trackers.location_id` is Monday-fed and frequently null. Do **not** build the store dropdown until a human decides the attribution rule (e.g. "primary store = first `ship_to_store_id`", or add an `orders.store_id`). `PortalPastOrdersData.stores` and `OrderTrackerClient`'s tracker `location_id` are already available to feed it once the rule is chosen. Leave a `// TODO(store-filter): blocked on store-attribution decision` marker at each control row; no code beyond the marker in this task.

- [x] **Step 11: Full run + commit.** Run `cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run lib/orders/__tests__/past-orders-filter.test.ts "app/(portal)/my-collections/__tests__/" "app/(portal)/order-tracker/__tests__/"` — expect PASS. Then `git add -A && git commit -m "feat: add status and date filters to Past orders and tracker"`.

**Acceptance (whole cluster):** a `staff` user sees **Past orders** listing only their own placed `stock_on_hand` orders (with tracking) and can filter by status/date; the **Track my Project** nav row is hidden for them and hitting `/tracking` or `/order-tracker` directly redirects to `/my-collections`. An `org_admin` (and individuals) see both surfaces, org-wide, with the same filters. The account page (`/account`) is unaffected — it still uses the untouched `getPortalAccountData`.

---

<!-- ===== Build step 5/8 · cluster: item-4-suppress-demo-payment-terms ===== -->

### Task: Suppress demo payment-terms block in CheckoutReviewClient via organizations.is_test

Today `CheckoutReviewClient` renders the deposit/payment-terms block whenever `depositPct > 0 || paymentTerms` (line 442), with no test-org branch, so the demo org shows "Payment terms: net30" even at 0% deposit. `organizations.is_test` already exists in the DB (read in `lib/checkout/submit.ts` at lines 1334, 1525, 1646) but does NOT reach this component. We thread `is_test` through `B2BCustomerContext` (the same server context the review page already uses for `paymentTerms`/`defaultDepositPercent`), pass it as a new `isTest` prop, and gate the block with `!isTest`. Real orgs (`is_test=false`) are unchanged. No schema change.

**Files:**
- Modify `/Users/jamierogangeorge/Documents/print-room-portal/lib/checkout/server.ts` — `B2BCustomerContext` interface (lines 20-23) + org select (lines 103-105) + context object (line 139)
- Modify `/Users/jamierogangeorge/Documents/print-room-portal/lib/preview/context.ts` — org select (line 23) + context object (line 43)
- Modify `/Users/jamierogangeorge/Documents/print-room-portal/components/checkout/CheckoutReviewClient.tsx` — `CheckoutReviewClientProps` (lines 29-34), destructure (lines 41-46), render condition (line 442)
- Modify `/Users/jamierogangeorge/Documents/print-room-portal/app/(portal)/checkout/review/page.tsx` — JSX props (lines 25-30)
- Modify `/Users/jamierogangeorge/Documents/print-room-portal/components/checkout/__tests__/CheckoutReviewClient.conflict.test.tsx` — `renderReview` helper (lines 58-67) + new `describe` block (append after line 221)

**Interfaces:**
- Consumes: existing `organizations.is_test` (boolean column, already in DB); existing `B2BCustomerContext` from `lib/checkout/server.ts`; existing `CheckoutReviewClientProps` from `components/checkout/CheckoutReviewClient.tsx`. No dependency on the `order_type` foundation or any other task in this plan.
- Produces:
  - `B2BCustomerContext.isTest: boolean` (in `lib/checkout/server.ts`) — set by both `requireB2BCustomer` and `buildPreviewContext`.
  - `CheckoutReviewClientProps.isTest: boolean` (in `components/checkout/CheckoutReviewClient.tsx`) — required prop.

---

- [x] **Step 1: Thread `isTest` into the `B2BCustomerContext` type**

  In `/Users/jamierogangeorge/Documents/print-room-portal/lib/checkout/server.ts`, current interface (lines 20-23):
  ```ts
    organizationName: string
    customerCode: string | null
    b2bAccountId: string | null
    tierLevel: number | null
  ```
  Change to add the field after `customerCode`:
  ```ts
    organizationName: string
    customerCode: string | null
    /** organizations.is_test — demo/test org gate. Suppresses the deposit/payment-terms UI on review; mirrors the server-side is_test reads in lib/checkout/submit.ts. */
    isTest: boolean
    b2bAccountId: string | null
    tierLevel: number | null
  ```

- [x] **Step 2: Select `is_test` and populate it in `requireB2BCustomer`**

  Same file, current org select (lines 103-105):
  ```ts
      admin.from('organizations')
        .select('id, name, customer_code')
        .eq('id', membership.organization_id).single(),
  ```
  Change to:
  ```ts
      admin.from('organizations')
        .select('id, name, customer_code, is_test')
        .eq('id', membership.organization_id).single(),
  ```
  Then in the returned context object, current (line 139):
  ```ts
        customerCode: org.customer_code,
        b2bAccountId: b2b?.id ?? null,
  ```
  Change to (cast mirrors the existing `moq_exempt` cast on the same `org` row at line 151):
  ```ts
        customerCode: org.customer_code,
        isTest: Boolean((org as { is_test?: boolean | null }).is_test),
        b2bAccountId: b2b?.id ?? null,
  ```

- [x] **Step 3: Mirror the change in `buildPreviewContext`**

  In `/Users/jamierogangeorge/Documents/print-room-portal/lib/preview/context.ts`, current org select (line 23):
  ```ts
      admin.from('organizations').select('id, name, customer_code').eq('id', membership.organization_id).single(),
  ```
  Change to:
  ```ts
      admin.from('organizations').select('id, name, customer_code, is_test').eq('id', membership.organization_id).single(),
  ```
  Then in the `context` object, current (line 43):
  ```ts
      customerCode: org.customer_code,
      b2bAccountId: b2b?.id ?? null,
  ```
  Change to:
  ```ts
      customerCode: org.customer_code,
      isTest: Boolean((org as { is_test?: boolean | null }).is_test),
      b2bAccountId: b2b?.id ?? null,
  ```

- [x] **Step 4: Typecheck the plumbing**

  Run:
  ```
  cd /Users/jamierogangeorge/Documents/print-room-portal && npx tsc --noEmit
  ```
  Expected: PASS with no new errors. (`B2BCustomerContext` now requires `isTest`, and both builders supply it. The review page and component still compile because we have not yet made the component prop required.) If tsc reports pre-existing unrelated errors in other files, confirm none are in `lib/checkout/server.ts` or `lib/preview/context.ts`.

- [x] **Step 5: Commit the context plumbing**
  ```
  git commit -am "chore: thread organizations.is_test through checkout server context"
  ```

- [x] **Step 6: Write the failing component test (RED)**

  In `/Users/jamierogangeorge/Documents/print-room-portal/components/checkout/__tests__/CheckoutReviewClient.conflict.test.tsx`, replace the `renderReview` helper (current lines 58-67):
  ```tsx
  function renderReview() {
    return render(
      <CheckoutReviewClient
        stores={[{ id: 'store-1', name: 'Main store', city: 'Auckland' }]}
        customerCode="CUST-1"
        paymentTerms="net20"
        defaultDepositPercent={null}
      />,
    )
  }
  ```
  with a version that threads optional overrides (keeps every existing `renderReview()` call valid — defaults reproduce today's props):
  ```tsx
  function renderReview(overrides?: { isTest?: boolean; paymentTerms?: string | null }) {
    return render(
      <CheckoutReviewClient
        stores={[{ id: 'store-1', name: 'Main store', city: 'Auckland' }]}
        customerCode="CUST-1"
        paymentTerms={overrides?.paymentTerms ?? 'net20'}
        defaultDepositPercent={null}
        isTest={overrides?.isTest ?? false}
      />,
    )
  }
  ```
  Then append this new `describe` block at the end of the file (after the closing `})` of `CheckoutReviewClient line display`, current line 221):
  ```tsx
  describe('CheckoutReviewClient payment terms visibility', () => {
    it('shows the payment terms block for a real (non-test) org', async () => {
      vi.mocked(fetch).mockResolvedValue(okJson({ imagesByLineId: {} }))

      renderReview({ isTest: false, paymentTerms: 'net30' })

      expect(await screen.findByText(/payment terms:/i)).toBeInTheDocument()
      expect(screen.getByText('net30')).toBeInTheDocument()
    })

    it('hides the payment terms block for a test/demo org', async () => {
      vi.mocked(fetch).mockResolvedValue(okJson({ imagesByLineId: {} }))

      renderReview({ isTest: true, paymentTerms: 'net30' })

      // Wait for the review to hydrate (product line only renders in the full view).
      await screen.findByText('Test tee')
      expect(screen.queryByText(/payment terms:/i)).not.toBeInTheDocument()
      expect(screen.queryByText('net30')).not.toBeInTheDocument()
    })
  })
  ```
  Run:
  ```
  cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run components/checkout/__tests__/CheckoutReviewClient.conflict.test.tsx
  ```
  Expected: FAIL on `hides the payment terms block for a test/demo org` — vitest/esbuild strips the unknown `isTest` prop at runtime, so the component still renders the block; the assertion fails with `expect(element).not.toBeInTheDocument()` → "Received element is present in the document: <p>Payment terms: <span>net30</span></p>". The `shows...` test passes (block still renders); existing conflict/display tests still pass.

- [x] **Step 7: Add the `isTest` prop and gate the block (GREEN)**

  In `/Users/jamierogangeorge/Documents/print-room-portal/components/checkout/CheckoutReviewClient.tsx`, current props interface (lines 29-34):
  ```tsx
  interface CheckoutReviewClientProps {
    stores: StoreOption[]
    customerCode: string | null
    paymentTerms: string | null
    defaultDepositPercent: number | null
  }
  ```
  Change to:
  ```tsx
  interface CheckoutReviewClientProps {
    stores: StoreOption[]
    customerCode: string | null
    paymentTerms: string | null
    defaultDepositPercent: number | null
    /** organizations.is_test — when true, hide the deposit/payment-terms block (demo org). */
    isTest: boolean
  }
  ```
  Current destructure (lines 41-46):
  ```tsx
  export function CheckoutReviewClient({
    stores,
    customerCode,
    paymentTerms,
    defaultDepositPercent,
  }: CheckoutReviewClientProps) {
  ```
  Change to:
  ```tsx
  export function CheckoutReviewClient({
    stores,
    customerCode,
    paymentTerms,
    defaultDepositPercent,
    isTest,
  }: CheckoutReviewClientProps) {
  ```
  Current render condition (line 442):
  ```tsx
          {(depositPct > 0 || paymentTerms) && (
  ```
  Change to:
  ```tsx
          {!isTest && (depositPct > 0 || paymentTerms) && (
  ```

- [x] **Step 8: Wire the review page to pass `isTest`**

  In `/Users/jamierogangeorge/Documents/print-room-portal/app/(portal)/checkout/review/page.tsx`, current JSX (lines 25-30):
  ```tsx
      <CheckoutReviewClient
        stores={stores}
        customerCode={context.customerCode}
        paymentTerms={context.paymentTerms}
        defaultDepositPercent={context.defaultDepositPercent}
      />
  ```
  Change to:
  ```tsx
      <CheckoutReviewClient
        stores={stores}
        customerCode={context.customerCode}
        paymentTerms={context.paymentTerms}
        defaultDepositPercent={context.defaultDepositPercent}
        isTest={context.isTest}
      />
  ```

- [x] **Step 9: Run the component test (PASS) and typecheck**

  Run:
  ```
  cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run components/checkout/__tests__/CheckoutReviewClient.conflict.test.tsx
  ```
  Expected: PASS — all tests green, including `hides the payment terms block for a test/demo org` (block now gated by `!isTest`) and `shows the payment terms block for a real (non-test) org`.

  Then run:
  ```
  cd /Users/jamierogangeorge/Documents/print-room-portal && npx tsc --noEmit
  ```
  Expected: PASS — `isTest` is now a required prop and the only production caller (`review/page.tsx`) plus the test helper both supply it.

- [x] **Step 10: Commit the component gate**
  ```
  git commit -am "feat: hide checkout payment-terms block for demo (is_test) orgs"
  ```

---

<!-- ===== Build step 6/8 · cluster: items-11-13-stock-note-order-placed-notify ===== -->

## Cluster: Items 11 + 13 — stock-on-hand Monday note; order-placed Slack + dispatch email

**Shared context (grounded):**
- `submitCustomerOrder` in `P lib/checkout/submit.ts` (1685 lines) is the single order-placement path. It already, for EVERY order, pushes to Monday (step 5a, item created ~line 1339, `mondayItemId`/`itemId` in scope) and creates a `job_trackers` shell (step 4c). So Item 11's "stock_on_hand orders STILL push to Monday and STILL create a job_tracker" needs **no** change to preserve those — the only new behaviour is the note.
- `postItemUpdate(itemId, body)` from `@/lib/monday/updates` is already imported (line 17) and already used for the Xero manual-review note (~1551). Item 11 reuses it.
- Email send path: `sendEmail({ to, subject, html, text })` → `SendEmailResult` from `@/lib/email/client`; branded shell `wrapBrandedEmail(subject, bodyContent, { preheader })` + `escapeHtml` + colour/font consts from `@/lib/email/shared`.
- Deep link origin: `NEXT_PUBLIC_SITE_URL || 'https://portal.theprintroom.nz'` (per `tracker-notification.ts:27`). The only order_id-keyed page is `/checkout/confirmation/[orderId]` → deep link `${origin}/checkout/confirmation/${order_id}`.
- **Consumed foundation (earlier cluster):** in-scope `const orderType: 'stock_on_hand' | 'purchase_order'` in `submitCustomerOrder`, derived by the interim rule (any `made_to_order` line ⇒ `purchase_order`, else `stock_on_hand`) and persisted to `orders.order_type`, available from ≈ line 1077 onward (so it is in scope at step 5a and after step 6). See uncertainties for the DB-read fallback if the foundation exposes only the column.

---

### Task: Stock-on-hand Monday production-hold note (Item 11)

**Files:**
- Create `P lib/monday/order-type-note.ts`
- Create `P lib/monday/__tests__/order-type-note.test.ts`
- Modify `P lib/checkout/submit.ts` — add import (after line 17); insert note block in step 5a between the subitem-persistence loop (ends line 1366) and the job-tracker stamp comment (line 1368)

**Interfaces:**
- Consumes:
  - Order-type foundation — in-scope `orderType: 'stock_on_hand' | 'purchase_order'` in `submitCustomerOrder` (`P lib/checkout/submit.ts`), set after the `submit_b2b_order` RPC (≈ line 1077).
  - `postItemUpdate(itemId: string, body: string): Promise<string | null>` from `@/lib/monday/updates` (already imported at line 17).
  - In-scope locals at the insertion point: `itemId: string` (the created Monday item id), `order_id: string`.
- Produces:
  - `STOCK_ON_HAND_MONDAY_NOTE: string`
  - `stockOnHandMondayNote(orderType: 'stock_on_hand' | 'purchase_order'): string | null` (`P lib/monday/order-type-note.ts`)

**Steps:**

- [x] **Step 1: Write the failing test for the note helper.** Create `P lib/monday/__tests__/order-type-note.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { stockOnHandMondayNote, STOCK_ON_HAND_MONDAY_NOTE } from '../order-type-note'

  describe('stockOnHandMondayNote', () => {
    it('returns the fixed production-hold copy for stock_on_hand', () => {
      expect(stockOnHandMondayNote('stock_on_hand')).toBe(
        'Stock-on-hand order — pull from existing stock. Do not produce. Xero draft quote raised — invoice before dispatch.',
      )
      expect(stockOnHandMondayNote('stock_on_hand')).toBe(STOCK_ON_HAND_MONDAY_NOTE)
    })

    it('returns null for purchase_order (no note)', () => {
      expect(stockOnHandMondayNote('purchase_order')).toBeNull()
    })
  })
  ```

- [x] **Step 2: Run it — expect FAIL.** `cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run lib/monday/__tests__/order-type-note.test.ts`
  Expected: fails to resolve import — `Failed to load .../lib/monday/order-type-note` (Cannot find module `../order-type-note`).

- [x] **Step 3: Create the helper.** Create `P lib/monday/order-type-note.ts`:
  ```ts
  /**
   * Item 11 — the fixed note stamped on a Monday order card when the order is
   * stock-on-hand, telling the floor to pull from stock rather than produce.
   * Copy is unconditional in Spec A. Purchase orders get no note.
   */
  export const STOCK_ON_HAND_MONDAY_NOTE =
    'Stock-on-hand order — pull from existing stock. Do not produce. Xero draft quote raised — invoice before dispatch.'

  export function stockOnHandMondayNote(
    orderType: 'stock_on_hand' | 'purchase_order',
  ): string | null {
    return orderType === 'stock_on_hand' ? STOCK_ON_HAND_MONDAY_NOTE : null
  }
  ```

- [x] **Step 4: Run it — expect PASS.** `cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run lib/monday/__tests__/order-type-note.test.ts`
  Expected: `2 passed`.

- [x] **Step 5: Commit.** `git commit -am "feat: stock-on-hand Monday note copy helper (item 11)"`

- [x] **Step 6: Add the import to submit.ts.** In `P lib/checkout/submit.ts`, current lines 17-18:
  ```ts
  import { postItemUpdate } from '@/lib/monday/updates'
  import { formatShippingAddress } from '@/lib/checkout/shipping-address'
  ```
  becomes:
  ```ts
  import { postItemUpdate } from '@/lib/monday/updates'
  import { stockOnHandMondayNote } from '@/lib/monday/order-type-note'
  import { formatShippingAddress } from '@/lib/checkout/shipping-address'
  ```

- [x] **Step 7: Insert the note block in step 5a.** In `P lib/checkout/submit.ts`, current lines 1361-1368:
  ```ts
      for (const [quoteItemId, subitemId] of Object.entries(subitemIds)) {
        await admin
          .from('quote_items')
          .update({ monday_subitem_id: subitemId })
          .eq('id', quoteItemId)
      }

      // Stamp the same Monday item id onto the job_trackers shell created in
  ```
  becomes:
  ```ts
      for (const [quoteItemId, subitemId] of Object.entries(subitemIds)) {
        await admin
          .from('quote_items')
          .update({ monday_subitem_id: subitemId })
          .eq('id', quoteItemId)
      }

      // Item 11 — stock-on-hand orders carry a fixed production-hold note on their
      // Monday card so the floor pulls from stock instead of producing. Purchase
      // orders get no note. Own try/catch so a note failure never marks the whole
      // Monday push as failed (mirrors the Xero manual-review note in step 5c).
      const stockNote = stockOnHandMondayNote(orderType)
      if (stockNote) {
        try {
          await postItemUpdate(itemId, stockNote)
        } catch (noteErr) {
          console.error('[Checkout] stock-on-hand Monday note failed (swallowed)', {
            orderId: order_id,
            err: noteErr instanceof Error ? noteErr.message : String(noteErr),
          })
        }
      }

      // Stamp the same Monday item id onto the job_trackers shell created in
  ```
  **Decision gate:** if the order-type foundation does NOT expose an in-scope `orderType` local (only the persisted column), prepend inside step 5a (before this block, after `mondayItemId` is set):
  ```ts
      const orderType =
        ((await admin.from('orders').select('order_type').eq('id', order_id).maybeSingle())
          .data as { order_type: 'stock_on_hand' | 'purchase_order' } | null)?.order_type ??
        'purchase_order'
  ```

- [x] **Step 8: Type-check the wiring.** `cd /Users/jamierogangeorge/Documents/print-room-portal && npx tsc --noEmit`
  Expected: no errors (if `orderType` is unresolved, the foundation task is not yet merged — apply the Decision gate above).

- [x] **Step 9: Confirm the wiring is present.** `cd /Users/jamierogangeorge/Documents/print-room-portal && grep -n "stockOnHandMondayNote" lib/checkout/submit.ts`
  Expected: the import line and one `const stockNote = stockOnHandMondayNote(orderType)` usage.

- [x] **Step 10: Commit.** `git commit -am "feat: post stock-on-hand production-hold note to Monday at checkout (item 11)"`

---

### Task: Order-placed Slack notification module (Item 13)

**Files:**
- Create `P lib/notifications/slack-order-placed.ts`
- Create `P lib/notifications/__tests__/slack-order-placed.test.ts`

**Interfaces:**
- Consumes: none (leaf module; reads `process.env.SLACK_PORTAL_WEBHOOK_URL` and global `fetch`).
- Produces:
  - `interface OrderPlacedSummaryLine { productName: string; variantLabel: string; quantity: number }`
  - `interface OrderPlacedNotification { orderRef: string; customerName: string; orderType: 'stock_on_hand' | 'purchase_order'; totalAmount: number; orderUrl: string; lines: OrderPlacedSummaryLine[] }`
  - `summariseOrderLines(lines: OrderPlacedSummaryLine[]): string`
  - `buildOrderPlacedSlackMessage(n: OrderPlacedNotification): { text: string; blocks: unknown[] }`
  - `postOrderPlacedSlack(n: OrderPlacedNotification): Promise<{ ok: boolean; skipped?: boolean; error?: string }>`

**Steps:**

- [x] **Step 1: Write the failing test.** Create `P lib/notifications/__tests__/slack-order-placed.test.ts`:
  ```ts
  import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
  import {
    buildOrderPlacedSlackMessage,
    postOrderPlacedSlack,
    type OrderPlacedNotification,
  } from '../slack-order-placed'

  const SAVED = { ...process.env }
  afterEach(() => {
    process.env = { ...SAVED }
    vi.restoreAllMocks()
  })

  const sample: OrderPlacedNotification = {
    orderRef: 'TPRC-000042',
    customerName: 'Anytime Fitness',
    orderType: 'stock_on_hand',
    totalAmount: 349.5,
    orderUrl: 'https://portal.theprintroom.nz/checkout/confirmation/ord-1',
    lines: [
      { productName: 'Classic Tee', variantLabel: 'Black / M', quantity: 10 },
      { productName: 'Hoodie', variantLabel: '—', quantity: 2 },
    ],
  }

  describe('buildOrderPlacedSlackMessage', () => {
    it('includes ref, total, deep link, type and item summary in the blocks', () => {
      const { text, blocks } = buildOrderPlacedSlackMessage(sample)
      const json = JSON.stringify(blocks)
      expect(text).toContain('TPRC-000042')
      expect(json).toContain('TPRC-000042')
      expect(json).toContain('$349.50')
      expect(json).toContain('https://portal.theprintroom.nz/checkout/confirmation/ord-1')
      expect(json).toContain('Classic Tee')
      expect(json).toContain('Stock on hand')
    })
  })

  describe('postOrderPlacedSlack', () => {
    beforeEach(() => {
      delete process.env.SLACK_PORTAL_WEBHOOK_URL
    })

    it('no-ops (no fetch) when SLACK_PORTAL_WEBHOOK_URL is unset', async () => {
      const f = vi.fn()
      vi.stubGlobal('fetch', f)
      const res = await postOrderPlacedSlack(sample)
      expect(res).toEqual({ ok: true, skipped: true })
      expect(f).not.toHaveBeenCalled()
    })

    it('POSTs the Block Kit payload to the webhook when set', async () => {
      process.env.SLACK_PORTAL_WEBHOOK_URL = 'https://hooks.slack.test/abc'
      const f = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' })
      vi.stubGlobal('fetch', f)
      const res = await postOrderPlacedSlack(sample)
      expect(res).toEqual({ ok: true })
      expect(f).toHaveBeenCalledTimes(1)
      const [url, init] = f.mock.calls[0]
      expect(url).toBe('https://hooks.slack.test/abc')
      expect(init.method).toBe('POST')
      expect(init.body).toContain('TPRC-000042')
    })
  })
  ```

- [x] **Step 2: Run it — expect FAIL.** `cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run lib/notifications/__tests__/slack-order-placed.test.ts`
  Expected: `Cannot find module '../slack-order-placed'`.

- [x] **Step 3: Create the module.** Create `P lib/notifications/slack-order-placed.ts`:
  ```ts
  /**
   * Item 13 — order-placed Slack notification.
   *
   * Posts a Block Kit message to the ops channel via the incoming webhook in
   * SLACK_PORTAL_WEBHOOK_URL. Ships BEFORE that channel/webhook exists, so a
   * missing env var is a clean no-op (never throws, never logs an error) — the
   * order must not care whether Slack is wired up yet.
   */

  export interface OrderPlacedSummaryLine {
    productName: string
    variantLabel: string
    quantity: number
  }

  export interface OrderPlacedNotification {
    orderRef: string
    /** Ordering org / customer display name. */
    customerName: string
    orderType: 'stock_on_hand' | 'purchase_order'
    totalAmount: number
    /** Absolute portal deep link to the order. */
    orderUrl: string
    lines: OrderPlacedSummaryLine[]
  }

  const ORDER_TYPE_LABEL: Record<OrderPlacedNotification['orderType'], string> = {
    stock_on_hand: 'Stock on hand',
    purchase_order: 'Purchase order',
  }

  function formatMoney(n: number): string {
    return `$${n.toFixed(2)}`
  }

  function hasVariant(label: string): boolean {
    const v = label.trim()
    return v.length > 0 && v !== '-' && v !== '—'
  }

  /** Compact one-line-per-item summary shared by the Slack + email bodies. */
  export function summariseOrderLines(lines: OrderPlacedSummaryLine[]): string {
    if (lines.length === 0) return '—'
    return lines
      .map((l) => `• ${l.productName}${hasVariant(l.variantLabel) ? ` (${l.variantLabel})` : ''} ×${l.quantity}`)
      .join('\n')
  }

  export function buildOrderPlacedSlackMessage(
    n: OrderPlacedNotification,
  ): { text: string; blocks: unknown[] } {
    const text = `New order ${n.orderRef} — ${n.customerName} — ${formatMoney(n.totalAmount)}`
    const blocks: unknown[] = [
      {
        type: 'header',
        text: { type: 'plain_text', text: `New order ${n.orderRef}` },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Customer:*\n${n.customerName}` },
          { type: 'mrkdwn', text: `*Type:*\n${ORDER_TYPE_LABEL[n.orderType]}` },
          { type: 'mrkdwn', text: `*Total:*\n${formatMoney(n.totalAmount)}` },
        ],
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*Items*\n${summariseOrderLines(n.lines)}` },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Open order' },
            url: n.orderUrl,
          },
        ],
      },
    ]
    return { text, blocks }
  }

  export async function postOrderPlacedSlack(
    n: OrderPlacedNotification,
  ): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
    const webhookUrl = process.env.SLACK_PORTAL_WEBHOOK_URL
    if (!webhookUrl) return { ok: true, skipped: true }
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildOrderPlacedSlackMessage(n)),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        return { ok: false, error: `Slack webhook HTTP ${res.status}: ${body}` }
      }
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
  ```

- [x] **Step 4: Run it — expect PASS.** `cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run lib/notifications/__tests__/slack-order-placed.test.ts`
  Expected: `3 passed`.

- [x] **Step 5: Commit.** `git commit -am "feat: order-placed Slack Block Kit builder + no-op-safe poster (item 13)"`

---

### Task: Order-placed dispatch email + recipient resolver (Item 13)

**Files:**
- Create `P lib/checkout/dispatch-notification-recipient.ts`
- Create `P lib/checkout/__tests__/dispatch-notification-recipient.test.ts`
- Create `P lib/email/order-placed-dispatch.ts`
- Create `P lib/email/__tests__/order-placed-dispatch.test.ts`

**Interfaces:**
- Consumes:
  - `sendEmail(params: { to: string; subject: string; html: string; text?: string }): Promise<SendEmailResult>` and `type SendEmailResult` from `@/lib/email/client`.
  - `wrapBrandedEmail(subject: string, bodyContent: string, opts?: { preheader?: string }): string`, `escapeHtml(value: string): string`, and consts `BRAND_FONT, BRAND_MONO, BRAND_ACCENT, INK, BODY, MUTED, LINE, SURFACE` (string) from `@/lib/email/shared`.
- Produces:
  - `resolveDispatchNotificationRecipient(opts: { isTestOrg: boolean; testEmail: string }): string` (`P lib/checkout/dispatch-notification-recipient.ts`)
  - `interface OrderPlacedDispatchParams { to: string; orderRef: string; customerName: string; orderType: 'stock_on_hand' | 'purchase_order'; totalAmount: number; orderUrl: string; lines: Array<{ productName: string; variantLabel: string; quantity: number; unitPrice: number }> }`
  - `buildOrderPlacedDispatchEmail(params: OrderPlacedDispatchParams): { subject: string; html: string; text: string }`
  - `sendOrderPlacedDispatch(params: OrderPlacedDispatchParams): Promise<SendEmailResult>` (`P lib/email/order-placed-dispatch.ts`)

**Steps:**

- [x] **Step 1: Write the failing recipient-resolver test.** Create `P lib/checkout/__tests__/dispatch-notification-recipient.test.ts`:
  ```ts
  import { describe, it, expect, afterEach } from 'vitest'
  import { resolveDispatchNotificationRecipient } from '../dispatch-notification-recipient'

  const SAVED = { ...process.env }
  afterEach(() => {
    process.env = { ...SAVED }
  })

  describe('resolveDispatchNotificationRecipient', () => {
    it('routes production orders to charlotte@ by default', () => {
      delete process.env.DISPATCH_NOTIFICATION_EMAIL
      expect(
        resolveDispatchNotificationRecipient({ isTestOrg: false, testEmail: 'jamie@theprint-room.co.nz' }),
      ).toBe('charlotte@theprint-room.co.nz')
    })

    it('honours DISPATCH_NOTIFICATION_EMAIL override for production', () => {
      process.env.DISPATCH_NOTIFICATION_EMAIL = 'dispatch@theprint-room.co.nz'
      expect(
        resolveDispatchNotificationRecipient({ isTestOrg: false, testEmail: 'jamie@theprint-room.co.nz' }),
      ).toBe('dispatch@theprint-room.co.nz')
    })

    it('routes test/demo orgs to the test inbox (jamie@), never the dispatch desk', () => {
      process.env.DISPATCH_NOTIFICATION_EMAIL = 'dispatch@theprint-room.co.nz'
      expect(
        resolveDispatchNotificationRecipient({ isTestOrg: true, testEmail: 'jamie@theprint-room.co.nz' }),
      ).toBe('jamie@theprint-room.co.nz')
    })
  })
  ```

- [x] **Step 2: Run it — expect FAIL.** `cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run lib/checkout/__tests__/dispatch-notification-recipient.test.ts`
  Expected: `Cannot find module '../dispatch-notification-recipient'`.

- [x] **Step 3: Create the resolver.** Create `P lib/checkout/dispatch-notification-recipient.ts`:
  ```ts
  /**
   * Item 13 — recipient for the internal order-placed dispatch notification.
   * Production orders notify the dispatch desk (DISPATCH_NOTIFICATION_EMAIL,
   * default charlotte@theprint-room.co.nz). Test/demo orgs (organizations.is_test)
   * must never notify the real desk — route to the test inbox instead.
   *
   * NOTE: distinct from resolveOrderEmailRecipient (which routes prod → the
   * customer). This notification always targets a fixed staff address in prod.
   */
  export function resolveDispatchNotificationRecipient(opts: {
    isTestOrg: boolean
    testEmail: string
  }): string {
    if (opts.isTestOrg) return opts.testEmail
    return process.env.DISPATCH_NOTIFICATION_EMAIL || 'charlotte@theprint-room.co.nz'
  }
  ```

- [x] **Step 4: Run it — expect PASS.** `cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run lib/checkout/__tests__/dispatch-notification-recipient.test.ts`
  Expected: `3 passed`.

- [x] **Step 5: Write the failing dispatch-email test.** Create `P lib/email/__tests__/order-placed-dispatch.test.ts` (mirrors the Resend-mock pattern in `tracker-notification.test.ts`):
  ```ts
  import { describe, it, expect, vi, beforeEach } from 'vitest'

  interface EmailArgs {
    to: string
    subject: string
    html: string
    text: string
  }
  const sendEmail = vi.fn((_a: EmailArgs) => Promise.resolve({ success: true, messageId: 'm1' }))
  vi.mock('../client', () => ({
    sendEmail: (a: EmailArgs) => sendEmail(a),
  }))

  import {
    buildOrderPlacedDispatchEmail,
    sendOrderPlacedDispatch,
    type OrderPlacedDispatchParams,
  } from '../order-placed-dispatch'

  const params: OrderPlacedDispatchParams = {
    to: 'charlotte@theprint-room.co.nz',
    orderRef: 'TPRC-000042',
    customerName: 'Anytime Fitness',
    orderType: 'stock_on_hand',
    totalAmount: 349.5,
    orderUrl: 'https://portal.theprintroom.nz/checkout/confirmation/ord-1',
    lines: [{ productName: 'Classic Tee', variantLabel: 'Black / M', quantity: 10, unitPrice: 34.95 }],
  }

  describe('buildOrderPlacedDispatchEmail', () => {
    it('renders ref, deep link, line summary, total and order type', () => {
      const { subject, html, text } = buildOrderPlacedDispatchEmail(params)
      expect(subject).toContain('TPRC-000042')
      expect(html).toContain('TPRC-000042')
      expect(html).toContain('https://portal.theprintroom.nz/checkout/confirmation/ord-1')
      expect(html).toContain('Classic Tee')
      expect(html).toContain('$349.50')
      expect(html).toContain('Stock on hand')
      expect(text).toContain('Open order: https://portal.theprintroom.nz/checkout/confirmation/ord-1')
    })
  })

  describe('sendOrderPlacedDispatch', () => {
    beforeEach(() => sendEmail.mockClear())
    it('sends to the provided recipient with the built subject', async () => {
      await sendOrderPlacedDispatch(params)
      expect(sendEmail).toHaveBeenCalledTimes(1)
      const arg = sendEmail.mock.calls[0][0]
      expect(arg.to).toBe('charlotte@theprint-room.co.nz')
      expect(arg.subject).toContain('TPRC-000042')
    })
  })
  ```

- [x] **Step 6: Run it — expect FAIL.** `cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run lib/email/__tests__/order-placed-dispatch.test.ts`
  Expected: `Cannot find module '../order-placed-dispatch'`.

- [x] **Step 7: Create the dispatch-email module.** Create `P lib/email/order-placed-dispatch.ts`:
  ```ts
  /**
   * Item 13 — internal order-placed dispatch email. Sent to the dispatch desk
   * (or the test inbox for demo orgs) the moment an order posts, reusing the same
   * branded shell as the customer order-confirmation so staff mail reads on-brand.
   * Pure build + thin send; best-effort is handled at the call site (submit.ts).
   */
  import { sendEmail, type SendEmailResult } from '@/lib/email/client'
  import {
    wrapBrandedEmail,
    escapeHtml,
    BRAND_FONT,
    BRAND_MONO,
    BRAND_ACCENT,
    INK,
    BODY,
    MUTED,
    LINE,
    SURFACE,
  } from '@/lib/email/shared'

  export interface OrderPlacedDispatchParams {
    to: string
    orderRef: string
    /** Ordering org / customer display name. */
    customerName: string
    orderType: 'stock_on_hand' | 'purchase_order'
    totalAmount: number
    /** Absolute portal deep link to the order. */
    orderUrl: string
    lines: Array<{
      productName: string
      variantLabel: string
      quantity: number
      unitPrice: number
    }>
  }

  const ORDER_TYPE_LABEL: Record<OrderPlacedDispatchParams['orderType'], string> = {
    stock_on_hand: 'Stock on hand',
    purchase_order: 'Purchase order',
  }

  function formatMoney(n: number): string {
    return `$${n.toFixed(2)}`
  }

  function hasVariant(label: string): boolean {
    const v = label.trim()
    return v.length > 0 && v !== '-' && v !== '—'
  }

  export function buildOrderPlacedDispatchEmail(params: OrderPlacedDispatchParams): {
    subject: string
    html: string
    text: string
  } {
    const typeLabel = ORDER_TYPE_LABEL[params.orderType]
    const labelStyle = `font-family:${BRAND_FONT};font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${MUTED};`
    const headCell = `padding:0 0 10px;border-bottom:2px solid ${INK};${labelStyle}`
    const cellBase = `padding:12px 0;border-bottom:1px solid ${LINE};vertical-align:top;`
    const numCell = `${cellBase}text-align:right;font-family:${BRAND_MONO};font-size:14px;white-space:nowrap;padding-left:16px;`

    const rowsHtml = params.lines
      .map((line) => {
        const name = escapeHtml(line.productName)
        const variant = escapeHtml(line.variantLabel)
        return `<tr>
                <td style="${cellBase}"><span style="font-family:${BRAND_FONT};font-size:15px;font-weight:600;color:${INK};">${name}</span>${
                  hasVariant(line.variantLabel)
                    ? `<br/><span style="font-family:${BRAND_FONT};font-size:12px;color:${MUTED};">${variant}</span>`
                    : ''
                }</td>
                <td style="${numCell}color:${BODY};">${line.quantity}</td>
                <td style="${numCell}color:${INK};">${formatMoney(line.unitPrice * line.quantity)}</td>
              </tr>`
      })
      .join('')

    const body = `
              <p style="margin:0 0 10px;${labelStyle}">New order</p>
              <h1 class="b-h1" style="margin:0 0 18px;font-family:${BRAND_FONT};font-size:30px;line-height:1.12;font-weight:700;letter-spacing:-0.02em;color:${INK};">Order placed</h1>

              <p style="margin:0 0 4px;${labelStyle}">Reference</p>
              <p style="margin:0 0 18px;font-family:${BRAND_MONO};font-size:18px;font-weight:700;letter-spacing:0.02em;color:${BRAND_ACCENT};">${escapeHtml(params.orderRef)}</p>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;background-color:${SURFACE};border-radius:12px;">
                <tr><td style="padding:16px 18px;font-family:${BRAND_FONT};font-size:14px;line-height:1.7;color:${BODY};">
                  <div>Customer: <strong style="color:${INK};">${escapeHtml(params.customerName)}</strong></div>
                  <div>Order type: <strong style="color:${INK};">${escapeHtml(typeLabel)}</strong></div>
                </td></tr>
              </table>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
                <thead><tr>
                  <th align="left" style="${headCell}text-align:left;">Item</th>
                  <th align="right" style="${headCell}text-align:right;padding-left:16px;">Qty</th>
                  <th align="right" style="${headCell}text-align:right;padding-left:16px;">Total</th>
                </tr></thead>
                <tbody>${rowsHtml}
                </tbody>
                <tfoot><tr>
                  <td colspan="2" style="padding:16px 0 0;text-align:right;${labelStyle}">Total</td>
                  <td style="padding:16px 0 0 16px;text-align:right;font-family:${BRAND_MONO};font-size:18px;font-weight:700;color:${INK};white-space:nowrap;">${formatMoney(params.totalAmount)}</td>
                </tr></tfoot>
              </table>

              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 0;">
                <tr><td align="center" style="border-radius:9999px;background-color:${BRAND_ACCENT};">
                  <a href="${escapeHtml(params.orderUrl)}" target="_blank" style="display:inline-block;background-color:${BRAND_ACCENT};color:#ffffff;border-radius:9999px;padding:15px 34px;font-family:${BRAND_FONT};font-size:15px;font-weight:700;text-decoration:none;">Open order</a>
                </td></tr>
              </table>`

    const subject = `Order placed — ${params.orderRef} (${typeLabel})`
    const html = wrapBrandedEmail(subject, body, {
      preheader: `${params.customerName} — ${formatMoney(params.totalAmount)}`,
    })

    const textLines = params.lines
      .map(
        (l) =>
          `${l.productName}${hasVariant(l.variantLabel) ? ` (${l.variantLabel})` : ''} x ${l.quantity} = ${formatMoney(l.unitPrice * l.quantity)}`,
      )
      .join('\n')
    const text =
      `Order placed — ${params.orderRef} (${typeLabel})\n\n` +
      `Customer: ${params.customerName}\n` +
      `Order type: ${typeLabel}\n\n` +
      `${textLines}\n\n` +
      `Total: ${formatMoney(params.totalAmount)}\n\n` +
      `Open order: ${params.orderUrl}\n`

    return { subject, html, text }
  }

  export async function sendOrderPlacedDispatch(
    params: OrderPlacedDispatchParams,
  ): Promise<SendEmailResult> {
    const { subject, html, text } = buildOrderPlacedDispatchEmail(params)
    return sendEmail({ to: params.to, subject, html, text })
  }
  ```

- [x] **Step 8: Run it — expect PASS.** `cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run lib/email/__tests__/order-placed-dispatch.test.ts`
  Expected: `2 passed`.

- [x] **Step 9: Commit.** `git commit -am "feat: order-placed dispatch email + recipient resolver (item 13)"`

---

### Task: Wire order-placed Slack + dispatch email into checkout submit (Item 13)

**Files:**
- Modify `P lib/checkout/submit.ts` — add 3 imports (after line 18); insert a best-effort "step 7" block between the end of step 6 (line 1681) and `return { order_id, order_ref }` (line 1683)

**Interfaces:**
- Consumes:
  - `postOrderPlacedSlack(n: OrderPlacedNotification): Promise<{ ok: boolean; skipped?: boolean; error?: string }>` from `@/lib/notifications/slack-order-placed`.
  - `sendOrderPlacedDispatch(params: OrderPlacedDispatchParams): Promise<SendEmailResult>` from `@/lib/email/order-placed-dispatch`.
  - `resolveDispatchNotificationRecipient(opts: { isTestOrg: boolean; testEmail: string }): string` from `@/lib/checkout/dispatch-notification-recipient`.
  - Order-type foundation — in-scope `orderType: 'stock_on_hand' | 'purchase_order'`.
  - In-scope locals at the insertion point (verified): `order_id: string`, `order_ref: string`, `emailCustomerName: string` (1588), `emailLines: OrderConfirmationLine[]` = `{ productName; variantLabel; quantity; unitPrice }` (1584), `emailTotalAmount: number | null` (1585), `repriced` (line objects `{ product_name; qty; unit_price }`, 589), `admin`, `input.context.organizationId`.
- Produces: nothing new (call-site glue).

**Steps:**

- [x] **Step 1: Add the imports.** In `P lib/checkout/submit.ts`, current line 18:
  ```ts
  import { formatShippingAddress } from '@/lib/checkout/shipping-address'
  ```
  becomes (append three lines):
  ```ts
  import { formatShippingAddress } from '@/lib/checkout/shipping-address'
  import { postOrderPlacedSlack } from '@/lib/notifications/slack-order-placed'
  import { sendOrderPlacedDispatch } from '@/lib/email/order-placed-dispatch'
  import { resolveDispatchNotificationRecipient } from '@/lib/checkout/dispatch-notification-recipient'
  ```
  (If Item 11's `stockOnHandMondayNote` import was already added, keep it — these are additive.)

- [x] **Step 2: Insert the step-7 notification block before `return`.** In `P lib/checkout/submit.ts`, current lines 1678-1684:
  ```ts
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error'
      console.error('[Checkout] Order-confirmation email failed:', message)
    }

    return { order_id, order_ref }
  }
  ```
  becomes:
  ```ts
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error'
      console.error('[Checkout] Order-confirmation email failed:', message)
    }

    // 7. Order-placed dispatch notification (Item 13). Fires for EVERY order the
    //    moment it commits: a Block Kit Slack message (no-op until the webhook env
    //    exists) plus an email to the dispatch desk (charlotte@ in prod, or the
    //    test inbox for demo orgs). Best-effort — a notification failure must
    //    never break the order. Reuses the step-6 email summary + a portal deep
    //    link to the order's confirmation page (the only order_id-keyed route).
    try {
      const notifyOrderUrl = `${
        process.env.NEXT_PUBLIC_SITE_URL || 'https://portal.theprintroom.nz'
      }/checkout/confirmation/${order_id}`

      const notifyLines =
        emailLines.length > 0
          ? emailLines
          : repriced.map((l) => ({
              productName: l.product_name,
              variantLabel: '—',
              quantity: l.qty,
              unitPrice: l.unit_price,
            }))
      const notifyTotal =
        emailTotalAmount ?? repriced.reduce((t, l) => t + l.unit_price * l.qty, 0)

      const { data: notifyOrgFlag } = await admin
        .from('organizations')
        .select('is_test')
        .eq('id', input.context.organizationId)
        .maybeSingle()
      const notifyIsTestOrg = Boolean((notifyOrgFlag as { is_test?: boolean } | null)?.is_test)

      await postOrderPlacedSlack({
        orderRef: order_ref,
        customerName: emailCustomerName,
        orderType,
        totalAmount: notifyTotal,
        orderUrl: notifyOrderUrl,
        lines: notifyLines.map((l) => ({
          productName: l.productName,
          variantLabel: l.variantLabel,
          quantity: l.quantity,
        })),
      })

      const dispatchRecipient = resolveDispatchNotificationRecipient({
        isTestOrg: notifyIsTestOrg,
        testEmail: process.env.DEMO_TEST_EMAIL || 'jamie@theprint-room.co.nz',
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
    } catch (e) {
      console.error('[Checkout] order-placed dispatch notification failed (swallowed)', {
        orderId: order_id,
        err: e instanceof Error ? e.message : String(e),
      })
    }

    return { order_id, order_ref }
  }
  ```
  **Decision gate (deep link):** the notification links Charlotte into the customer-portal confirmation page (the only order_id-keyed route). If the dispatch desk should instead land on a staff-portal order URL, swap `notifyOrderUrl` for the staff origin — do NOT invent a route; confirm the staff order path first.
  **Decision gate (orderType):** if the foundation exposes only `orders.order_type` (no in-scope local), add the DB-read fallback from the Item 11 task before this block.

- [x] **Step 3: Type-check the wiring.** `cd /Users/jamierogangeorge/Documents/print-room-portal && npx tsc --noEmit`
  Expected: no errors. (An `orderType` unresolved error means the order-type foundation is not merged yet — apply the Decision gate.)

- [x] **Step 4: Lint the changed file.** `cd /Users/jamierogangeorge/Documents/print-room-portal && npx eslint lib/checkout/submit.ts lib/notifications/slack-order-placed.ts lib/email/order-placed-dispatch.ts lib/checkout/dispatch-notification-recipient.ts`
  Expected: no errors.

- [x] **Step 5: Run the full cluster suite.** `cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run lib/monday/__tests__/order-type-note.test.ts lib/notifications/__tests__/slack-order-placed.test.ts lib/checkout/__tests__/dispatch-notification-recipient.test.ts lib/email/__tests__/order-placed-dispatch.test.ts`
  Expected: all pass (2 + 3 + 3 + 2 = 10).

- [ ] **Step 6: Decision gate — manual smoke on a test org.** **DEFERRED (human/external verification):** placing a real demo order is intentionally not automated. No verification email was sent. When run, it must target `jamie@theprint-room.co.nz` and leave `SLACK_PORTAL_WEBHOOK_URL` unset. Place a real order on a demo/test org (`organizations.is_test = true`). Verify: (a) the dispatch email arrives at `jamie@theprint-room.co.nz` (NOT charlotte@) with the order ref, line summary, total, order-type label and the `/checkout/confirmation/<order_id>` link; (b) with `SLACK_PORTAL_WEBHOOK_URL` unset, the server log shows no Slack error and the order completes normally. Do not enable the Slack webhook or any prod env as part of this task.

- [x] **Step 7: Commit.** `git commit -am "feat: send order-placed Slack + dispatch email at checkout (item 13)"`

---

<!-- ===== Build step 7/8 · cluster: Item 15: Xero draft-quote eligibility rewrite ===== -->

## Cluster: Item 15 — Xero draft-quote eligibility rewrite (Spec A)

**What changes and why.** `evaluateXeroEligibility` currently blocks two categories from auto-drafting: prepay orgs (`paymentTerms === 'prepay'` → `prepay_org`) and any stock-draw order (`drawsStock` → `draws_stock`), both routed to a `manual_review` queue. Spec A invoices **every** non-test order — purchase orders and stock-on-hand alike — with **no** paid/unpaid or stock-draw branch. So both gates and both reasons are deleted, the input is trimmed, and the orchestrator's `manual_review`-for-prepay/draws branch (which references the now-deleted reasons and would fail `tsc`) is removed in the same commit. Prepay is deferred to Spec B.

**Grounding note.** Verified against the real files (baseline `npx vitest run lib/xero/__tests__/eligibility.test.ts lib/xero/__tests__/create-draft.test.ts` → 13 passed). `paymentTerms` and `drawsStock` on `XeroEligibilityInput` are consumed **only** by the two gates being removed, so both are dropped from that interface. `paymentTerms` is still needed elsewhere in `draft-invoice.ts` (it feeds `expiryDateFor` in `buildDraftQuotePayload`) but as a field of `CreateDraftInvoiceArgs`, not of `XeroEligibilityInput` — that stays. Repo has `strict: true` but no `noUnusedLocals`; `next build` typechecks.

> **Decision gate — do NOT enable Xero here.** `XERO_ENABLED` is deploy-dark and set in no committed env. This plan only makes the code correct when the flag is on. Flipping it live is a separate release-time call.

**Acceptance (both tasks done, `XERO_ENABLED` on):** a non-test purchase order and a non-test stock-on-hand order each create exactly one draft; a test-org order creates none.

---

### Task: Rewrite Xero eligibility to Spec A and realign the orchestrator

**Files:**
- Modify `/Users/jamierogangeorge/Documents/print-room-portal/lib/xero/eligibility.ts` (full file, 1-43 — rewrite the reason union, `XeroEligibilityInput`, and `evaluateXeroEligibility`)
- Modify `/Users/jamierogangeorge/Documents/print-room-portal/lib/xero/__tests__/eligibility.test.ts` (full file, 1-53 — rewrite to the new contract)
- Modify `/Users/jamierogangeorge/Documents/print-room-portal/lib/xero/draft-invoice.ts` (the `CreateDraftInvoiceArgs.drawsStock` field ~212; the `evaluateXeroEligibility` call 235-241; the ineligible block 243-266)
- Modify `/Users/jamierogangeorge/Documents/print-room-portal/lib/xero/__tests__/create-draft.test.ts` (remove the manual_review case 84-91; add a stock-draw-drafts case inside the `— eligible` describe)

**Interfaces:**
- **Consumes:** `isXeroEnabled(): boolean` and `getXeroConfig(): XeroConfig` from `lib/xero/config.ts` (existing, unchanged). `xeroFetch`, `recordAuditEvent`, `AUDIT_ACTIONS.ORDER_XERO_DRAFTED` (existing, unchanged).
- **Produces:** `evaluateXeroEligibility(input: XeroEligibilityInput): XeroEligibility` where `XeroEligibilityInput = { xeroEnabled: boolean; existingInvoiceId: string | null; isTestOrg: boolean }`, `XeroEligibility = { eligible: boolean; reason: XeroEligibilityReason }`, `XeroEligibilityReason = 'ok' | 'disabled' | 'already_drafted' | 'test_org'`. `createDraftInvoiceForOrder(admin, args)` — public signature unchanged; `CreateDraftInvoiceArgs.drawsStock` and `.paymentTerms` retained; `CreateDraftInvoiceResult.status` unchanged (`'manual_review'` now unreachable).

- [x] **Step 1: Rewrite the eligibility unit test to the Spec-A contract (RED).**
  Replace the whole of `lib/xero/__tests__/eligibility.test.ts` with:
  ```ts
  // lib/xero/__tests__/eligibility.test.ts
  import { describe, it, expect } from 'vitest'
  import { evaluateXeroEligibility, type XeroEligibilityInput } from '../eligibility'

  const base: XeroEligibilityInput = {
    xeroEnabled: true,
    existingInvoiceId: null,
    isTestOrg: false,
  }

  describe('evaluateXeroEligibility', () => {
    it('drafts a non-test order with no existing draft (any order type)', () => {
      // Spec A: purchase orders AND stock-on-hand orders both draft — no
      // order-type, payment-terms, or stock-draw branch remains.
      expect(evaluateXeroEligibility(base)).toEqual({ eligible: true, reason: 'ok' })
    })

    it('ignores legacy prepay / stock-draw inputs — no such gate remains (Spec A)', () => {
      // Older callers spread paymentTerms + drawsStock; the new rule ignores them.
      const legacy = { ...base, paymentTerms: 'prepay', drawsStock: true } as XeroEligibilityInput
      expect(evaluateXeroEligibility(legacy)).toEqual({ eligible: true, reason: 'ok' })
    })

    it('skips when the feature flag is off (checked first, fully inert)', () => {
      expect(evaluateXeroEligibility({ ...base, xeroEnabled: false, isTestOrg: true }))
        .toEqual({ eligible: false, reason: 'disabled' })
    })

    it('skips when already drafted (dedup)', () => {
      expect(evaluateXeroEligibility({ ...base, existingInvoiceId: 'inv-9' }))
        .toEqual({ eligible: false, reason: 'already_drafted' })
    })

    it('skips test orgs (keep the real ledger clean)', () => {
      expect(evaluateXeroEligibility({ ...base, isTestOrg: true }))
        .toEqual({ eligible: false, reason: 'test_org' })
    })

    it('precedence: disabled > already_drafted > test_org', () => {
      expect(evaluateXeroEligibility({
        xeroEnabled: true, existingInvoiceId: 'inv', isTestOrg: true,
      })).toEqual({ eligible: false, reason: 'already_drafted' })
    })
  })
  ```
  Run: `cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run lib/xero/__tests__/eligibility.test.ts`
  Expected **FAIL** on `ignores legacy prepay / stock-draw inputs`: the old rule still trips the prepay gate — `AssertionError: expected { eligible: false, reason: 'prepay_org' } to deeply equal { eligible: true, reason: 'ok' }`. (The other 5 tests already pass against the old code.)

- [x] **Step 2: Move the orchestrator's stock-draw case from manual_review to drafted (RED).**
  In `lib/xero/__tests__/create-draft.test.ts`, delete the manual_review case. Old (lines 83-92):
  ```ts
  describe('createDraftInvoiceForOrder — ineligible', () => {
    it('flags manual_review on a stock-draw order (no Xero call)', async () => {
      const { admin, updates } = fakeAdmin({ cachedContactId: null, quoteItems: [] })
      const res = await createDraftInvoiceForOrder(admin, { ...args, drawsStock: true })
      expect(res).toEqual({ status: 'manual_review', reason: 'draws_stock' })
      expect(mockFetch).not.toHaveBeenCalled()
      expect(updates).toContainEqual({ table: 'orders', payload: { xero_invoice_status: 'manual_review' } })
      expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'order.xero_manual_review' }), admin)
    })

    it('skips (no write, no audit) when the flag is off', async () => {
  ```
  New:
  ```ts
  describe('createDraftInvoiceForOrder — ineligible', () => {
    it('skips (no write, no audit) when the flag is off', async () => {
  ```
  Then add a drafts-a-stock-draw case at the end of the `— eligible` describe. Old (lines 79-81):
  ```ts
      expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'order.xero_drafted' }), admin)
    })
  })
  ```
  New:
  ```ts
      expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'order.xero_drafted' }), admin)
    })

    it('drafts a stock-draw order now — the draws_stock gate is gone (Spec A)', async () => {
      // Spec A invoices stock-on-hand orders too. cachedContactId set → the only
      // xeroFetch is POST /Quotes.
      mockFetch.mockResolvedValueOnce({ Quotes: [{ QuoteID: 'quote-xero-2', QuoteNumber: 'QU-0002' }] })
      const { admin, updates } = fakeAdmin({ cachedContactId: 'c-1', quoteItems: [] })
      const res = await createDraftInvoiceForOrder(admin, { ...args, drawsStock: true })
      expect(res).toEqual({ status: 'drafted', reason: 'ok', invoiceId: 'quote-xero-2', invoiceNumber: 'QU-0002' })
      expect(updates).toContainEqual({ table: 'orders', payload: { xero_invoice_id: 'quote-xero-2', xero_invoice_number: 'QU-0002', xero_invoice_status: 'drafted' } })
      expect(updates).not.toContainEqual({ table: 'orders', payload: { xero_invoice_status: 'manual_review' } })
    })
  })
  ```
  Run: `cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run lib/xero/__tests__/create-draft.test.ts`
  Expected **FAIL** on the new case: the old orchestrator still routes `drawsStock: true` to manual_review — `AssertionError: expected { status: 'manual_review', reason: 'draws_stock' } to deeply equal { status: 'drafted', reason: 'ok', … }`.

- [x] **Step 3: Implement the trimmed rule and realign the orchestrator (GREEN).**
  These two edits are type-coupled and land together (narrowing the union / trimming the input breaks `draft-invoice.ts` until it is realigned).

  (a) Replace the whole of `lib/xero/eligibility.ts` with:
  ```ts
  // lib/xero/eligibility.ts

  export type XeroIneligibleReason = 'disabled' | 'already_drafted' | 'test_org'
  export type XeroEligibilityReason = 'ok' | XeroIneligibleReason

  export interface XeroEligibilityInput {
    /** isXeroEnabled() result. */
    xeroEnabled: boolean
    /** orders.xero_invoice_id — non-null means a draft already exists. */
    existingInvoiceId: string | null
    /** organizations.is_test. */
    isTestOrg: boolean
  }

  export interface XeroEligibility {
    eligible: boolean
    reason: XeroEligibilityReason
  }

  /**
   * Draft a Xero DRAFT quote iff ALL hold: feature on, not already drafted, and
   * not a test org. Spec A: EVERY non-test order is invoiced — purchase orders
   * and stock-on-hand orders alike. There is no order-type, payment-terms, or
   * stock-draw branch (prepay is deferred to Spec B). Order of checks defines
   * precedence (see test): disabled/already_drafted → fully inert; test_org →
   * the caller records xero_invoice_status='skipped'.
   */
  export function evaluateXeroEligibility(input: XeroEligibilityInput): XeroEligibility {
    if (!input.xeroEnabled) return { eligible: false, reason: 'disabled' }
    if (input.existingInvoiceId) return { eligible: false, reason: 'already_drafted' }
    if (input.isTestOrg) return { eligible: false, reason: 'test_org' }
    return { eligible: true, reason: 'ok' }
  }
  ```

  (b) In `lib/xero/draft-invoice.ts`, trim the eligibility call and delete the prepay/draws manual_review branch. Old (lines 235-266):
  ```ts
    const elig = evaluateXeroEligibility({
      xeroEnabled: isXeroEnabled(),
      existingInvoiceId: args.existingInvoiceId,
      isTestOrg: args.isTestOrg,
      paymentTerms: args.paymentTerms,
      drawsStock: args.drawsStock,
    })

    if (!elig.eligible) {
      // prepay + stock-draw are billable-but-uncostable in v1 → Charlotte's queue.
      if (elig.reason === 'prepay_org' || elig.reason === 'draws_stock') {
        await admin.from('orders').update({ xero_invoice_status: 'manual_review' }).eq('id', args.orderId)
        await recordAuditEvent(
          {
            orgId: args.organizationId,
            actorUserId: args.actorUserId,
            action: AUDIT_ACTIONS.ORDER_XERO_MANUAL_REVIEW,
            targetType: 'order',
            targetId: args.orderId,
            metadata: { order_ref: args.orderRef, reason: elig.reason },
          },
          admin,
        )
        return { status: 'manual_review', reason: elig.reason }
      }
      // test_org → record a 'skipped' status (keeps the ledger clean, no nag).
      if (elig.reason === 'test_org') {
        await admin.from('orders').update({ xero_invoice_status: 'skipped' }).eq('id', args.orderId)
      }
      // 'disabled' / 'already_drafted' → fully inert (no write, no audit).
      return { status: 'skipped', reason: elig.reason }
    }
  ```
  New:
  ```ts
    // Spec A: every non-test order is invoiced — purchase orders and stock-on-hand
    // alike. No payment-terms or stock-draw gate remains. (args.drawsStock is still
    // computed upstream and passed through for Spec B, but is no longer consulted.)
    const elig = evaluateXeroEligibility({
      xeroEnabled: isXeroEnabled(),
      existingInvoiceId: args.existingInvoiceId,
      isTestOrg: args.isTestOrg,
    })

    if (!elig.eligible) {
      // test_org → record a 'skipped' status (keeps the ledger clean, no nag).
      if (elig.reason === 'test_org') {
        await admin.from('orders').update({ xero_invoice_status: 'skipped' }).eq('id', args.orderId)
      }
      // 'disabled' / 'already_drafted' → fully inert (no write, no audit).
      return { status: 'skipped', reason: elig.reason }
    }
  ```

  (c) In `lib/xero/draft-invoice.ts`, annotate the now-inert field so the deferral is explicit. Old (line 212, inside `CreateDraftInvoiceArgs`):
  ```ts
    isTestOrg: boolean
    drawsStock: boolean
    existingInvoiceId: string | null
  ```
  New:
  ```ts
    isTestOrg: boolean
    /** Computed stock-draw truth. Ignored by Spec A eligibility (every order
     *  drafts); retained for Spec B and still surfaced to callers/tests. */
    drawsStock: boolean
    existingInvoiceId: string | null
  ```

  Run: `cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run lib/xero/__tests__/eligibility.test.ts lib/xero/__tests__/create-draft.test.ts`
  Expected **PASS**: `Test Files  2 passed (2)` / `Tests  11 passed (11)` (6 eligibility + 5 create-draft).
  Then confirm the build typechecks (this is what catches the removed union members): `cd /Users/jamierogangeorge/Documents/print-room-portal && npx tsc --noEmit` — expect no errors under `lib/xero` (`AUDIT_ACTIONS.ORDER_XERO_MANUAL_REVIEW` stays defined in `lib/audit/actions.ts`; it is simply no longer referenced here).

- [x] **Step 4: Commit.**
  `cd /Users/jamierogangeorge/Documents/print-room-portal && git commit -am "feat: draft a Xero quote for every non-test order (Spec A eligibility)"`

---

### Task: Correct now-stale stock-draw / manual_review comments

Comment-only accuracy pass. Three comments still assert that a `'stocked'` line "trips the Xero draws_stock gate" and is flagged `manual_review` — false under Spec A. The `'stocked'` claim still exempts a line from MOQ, so that half stays. No behavior change; no new test.

**Files:**
- Modify `/Users/jamierogangeorge/Documents/print-room-portal/lib/checkout/submit.ts` (step-5c header comment 1515-1520; fulfilment-coercion comment 426-434)
- Modify `/Users/jamierogangeorge/Documents/print-room-portal/lib/shop/fulfilment-mode.ts` (`lineFulfilment` docblock 114-124)

**Interfaces:** Consumes nothing; produces nothing. Depends on the eligibility rewrite task only for factual accuracy.

- [x] **Step 1: Fix the step-5c header comment in `submit.ts`.** Old (lines 1515-1520):
  ```ts
    // 5c. Best-effort Xero DRAFT quote for fully-billable orders. Mirrors the
    //     Monday/email side-effects: never throws, audits on failure. Ineligible
    //     orders (test org, prepay org, or ANY stock-draw line) are flagged
    //     xero_invoice_status='manual_review' for Charlotte instead of drafted.
    //     Stock-draw is read from the cart lines' fulfilment_type — the submit RPC
    //     payload does not persist per-line stock qty (see the p_lines map above).
  ```
  New:
  ```ts
    // 5c. Best-effort Xero DRAFT quote. Mirrors the Monday/email side-effects:
    //     never throws, audits on failure. Spec A: EVERY non-test order drafts —
    //     purchase orders and stock-on-hand alike. Only a test org is skipped
    //     (xero_invoice_status='skipped'); disabled/already-drafted are inert.
    //     drawsStock is still computed from the cart lines' fulfilment_type and
    //     passed through for Spec B, but no longer gates the draft.
  ```

- [x] **Step 2: Fix the fulfilment-coercion comment in `submit.ts`.** Old (lines 426-429):
  ```ts
    // Server-side fulfilment truth (2026-07-06). 'stocked' is a stock-DRAW claim
    // that exempts a line from MOQ (below) and trips the Xero draws_stock gate
    // (step 5c) — so it may only stand when the product's effective nature
    // actually allows a draw. submit_b2b_order resolves fulfilment the same way
  ```
  New:
  ```ts
    // Server-side fulfilment truth (2026-07-06). 'stocked' is a stock-DRAW claim
    // that exempts a line from MOQ (below) — so it may only stand when the
    // product's effective nature actually allows a draw. (Spec A no longer gates
    // Xero on stock-draw; the coercion still matters for MOQ + Spec B.)
    // submit_b2b_order resolves fulfilment the same way
  ```

- [x] **Step 3: Fix the `lineFulfilment` docblock in `fulfilment-mode.ts`.** Old (lines 114-117):
  ```ts
  /**
   * Which fulfilment a cart line should claim. 'stocked' is a stock-DRAW claim:
   * it exempts the line from MOQ and trips the Xero draws_stock gate at submit,
   * so it may only be claimed when a draw is actually possible — the viewer can
  ```
  New:
  ```ts
  /**
   * Which fulfilment a cart line should claim. 'stocked' is a stock-DRAW claim:
   * it exempts the line from MOQ at submit (Spec A no longer gates Xero on it),
   * so it may only be claimed when a draw is actually possible — the viewer can
  ```

- [x] **Step 4: Verify nothing broke, then commit.**
  Run: `cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run lib/checkout/__tests__/submit.fulfilment-truth.test.ts` — expect **PASS** (behavior unchanged; the `drawsStock` assertions still hold because submit.ts still computes and passes it).
  Then: `cd /Users/jamierogangeorge/Documents/print-room-portal && git commit -am "chore: correct stale stock-draw/manual_review comments"`

---

<!-- ===== Build step 8/8 · cluster: item14-login-help-item8-demo-pill ===== -->

### Task: "Trouble logging in?" mailto link on the portal sign-in page (Item 14)

**Files:**
- Create: `/Users/jamierogangeorge/Documents/print-room-portal/app/(auth)/sign-in/__tests__/SignInClient.test.tsx` (new component test, whole file)
- Modify: `/Users/jamierogangeorge/Documents/print-room-portal/app/(auth)/sign-in/SignInClient.tsx` (lines 193-200 — the `mt-3 text-right` "Forgot password?" block, inside the password-mode `<form>`)

**Interfaces:**
- Consumes: nothing from earlier tasks. Uses the existing default export `SignInPage` from `app/(auth)/sign-in/SignInClient.tsx` (a `<Suspense>` wrapper around the `SignIn` client component), the two-tab mode switch (`'Email code'` / `'Password'` buttons), and the existing `href="/reset-password"` "Forgot password?" anchor.
- Produces: nothing load-bearing for later tasks (leaf UI change). Adds a static `<a href="mailto:jamie@theprint-room.co.nz">Trouble logging in?</a>` beside "Forgot password?" in password mode.

Grounding notes (verified against real code):
- The `SignIn` component defaults to `mode = 'code'` (line 32). "Forgot password?" only renders in **password mode** (lines 193-200), so the help link is placed there, literally adjacent to it. The email-code screen (default) does not render it — see the Decision gate below and `uncertainties`.
- Test-mock shape mirrors the sibling auth test `app/(auth)/reset-password/__tests__/ResetPasswordClient.test.tsx`. `SignInClient` additionally calls `useSearchParams()` (line 29), so the `next/navigation` mock must expose `useSearchParams` returning an object with a `.get()` method (the real code calls `.get('returnTo' | 'error' | 'error_description')`). It also calls `useAuth()` for `{ signIn, requestEmailCode, verifyEmailCode }` (line 30). `AuthScene` → `MerchPile` (framer-motion `whileInView`) renders fine under jsdom because `vitest.setup.ts` already stubs `IntersectionObserver`; the sibling `RequestAccessClient` test renders the same `AuthScene` with only the `next/image` + `hcaptcha` mocks and passes.

- [x] **Step 1: Write the failing component test.** Create `/Users/jamierogangeorge/Documents/print-room-portal/app/(auth)/sign-in/__tests__/SignInClient.test.tsx` with:
  ```tsx
  import { forwardRef } from 'react'
  import { render, screen } from '@testing-library/react'
  import userEvent from '@testing-library/user-event'
  import { beforeEach, describe, expect, it, vi } from 'vitest'
  import SignInPage from '../SignInClient'

  const mocks = vi.hoisted(() => ({
    push: vi.fn(),
    signIn: vi.fn(),
    requestEmailCode: vi.fn(),
    verifyEmailCode: vi.fn(),
  }))

  vi.mock('next/image', () => ({
    default: ({ alt = '', width: _width, height: _height, priority: _priority, ...props }: {
      alt?: string
      width?: number
      height?: number
      priority?: boolean
    }) => (
      // eslint-disable-next-line @next/next/no-img-element
      <img alt={alt} {...props} />
    ),
  }))

  vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: mocks.push }),
    useSearchParams: () => ({ get: () => null }),
  }))

  vi.mock('@hcaptcha/react-hcaptcha', () => ({
    default: forwardRef(function MockHCaptcha(_props, _ref) {
      return <div data-testid="hcaptcha" />
    }),
  }))

  vi.mock('@/contexts/AuthContext', () => ({
    useAuth: () => ({
      signIn: mocks.signIn,
      requestEmailCode: mocks.requestEmailCode,
      verifyEmailCode: mocks.verifyEmailCode,
    }),
  }))

  beforeEach(() => {
    process.env.NEXT_PUBLIC_HCAPTCHA_SITEKEY = 'site-key'
    mocks.push.mockClear()
  })

  describe('SignIn login-help link', () => {
    it('shows a "Trouble logging in?" mailto link beside Forgot password (password mode)', async () => {
      const user = userEvent.setup()
      render(<SignInPage />)

      // Forgot-password + login-help links live in password mode; switch to it.
      await user.click(screen.getByRole('button', { name: 'Password' }))

      const help = screen.getByRole('link', { name: /trouble logging in/i })
      expect(help).toHaveAttribute('href', 'mailto:jamie@theprint-room.co.nz')

      // Sanity: it sits next to the existing Forgot-password link.
      expect(
        screen.getByRole('link', { name: /forgot password/i }),
      ).toHaveAttribute('href', '/reset-password')
    })
  })
  ```

- [x] **Step 2: Run the test — expect FAIL.**
  ```
  cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run "app/(auth)/sign-in/__tests__/SignInClient.test.tsx"
  ```
  Expected failure (the link does not exist yet): `TestingLibraryElementError: Unable to find an accessible element with the role "link" and name `/trouble logging in/i``.

- [x] **Step 3: Add the mailto link beside "Forgot password?".** In `/Users/jamierogangeorge/Documents/print-room-portal/app/(auth)/sign-in/SignInClient.tsx`, replace the current block at lines 193-200:
  ```tsx
            <div className="mt-3 text-right">
              <a
                href="/reset-password"
                className="text-sm font-semibold text-black underline-offset-4 hover:underline"
              >
                Forgot password?
              </a>
            </div>
  ```
  with (keeps "Forgot password?" right-aligned, adds the help link on the same row so it is literally "near Forgot password?"):
  ```tsx
            <div className="mt-3 flex items-center justify-between gap-4">
              <a
                href="mailto:jamie@theprint-room.co.nz"
                className="text-sm font-semibold text-black underline-offset-4 hover:underline"
              >
                Trouble logging in?
              </a>
              <a
                href="/reset-password"
                className="text-sm font-semibold text-black underline-offset-4 hover:underline"
              >
                Forgot password?
              </a>
            </div>
  ```

- [x] **Step 4: Run the test — expect PASS.**
  ```
  cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run "app/(auth)/sign-in/__tests__/SignInClient.test.tsx"
  ```
  Expected: `1 passed`.

- [x] **Step 5: Commit.**
  ```
  git commit -am "feat: add 'Trouble logging in?' mailto link to sign-in page"
  ```

- [ ] **Step 6 (Decision gate — DEFERRED to human confirmation; do NOT resolve in code): confirm recipient + visibility.** Two open threads, both surfaced to Jon/Jamie before this ships; neither blocks the code above:
  1. **Recipient address.** Spec flags whether customer login-help should point at `hello@theprint-room.co.nz` instead of `jamie@theprint-room.co.nz`. The jamie@ convention matches the staff-invite footer (`src/lib/email/templates/staff-invite.ts:180`) and the memory rule that test/verification mail goes to jamie@ — but this is a **customer-facing production** link, so it may warrant hello@. If they choose hello@, change the single `href` string and the test's expected value.
  2. **Mode visibility.** As specified ("near Forgot password?"), the link only renders in **password mode**. The default screen is email-code mode, where a stuck user sees no help link. If they want it always visible, move the anchor out of the password `<form>` (e.g. beside the "Explore the demo" link at lines 298-304) — that is a different placement than the spec's decided behaviour, so confirm first.

---

### Task: Set the three remaining demo catalogue items to fulfilment "Both" so all four show the PDP pill (Item 8 — data-config RUNBOOK)

**No code. No deploy. Executable by Chris or Jamie directly against the staff portal UI + Supabase.** This is a data-config change to `b2b_catalogue_items.fulfilment_type_override`, not a code change — there is nothing to build, test, or ship.

**Execution note (2026-07-15): DEFERRED to Chris/Jamie, Steps 1–7 below.** The runbook anchors and option mapping were verified against the staff portal. A read-only production query confirmed the expected pre-run state: Classic Tee resolves to `mixed`; Stencil Hood, Access Faded Cap, and Recycled Light Duffel Bag resolve to `made_to_order`. No live data was changed by this implementation run.

**Files:** none created or modified. (Reference only: the "Fulfilment mode" dropdown lives in `/Users/jamierogangeorge/Documents/print-room-staff-portal/src/components/catalogues/CatalogueItemEditor.tsx` lines 541-563; the demo product/org identity is defined in `/Users/jamierogangeorge/Documents/print-room-staff-portal/scripts/demo-org/config.ts`.)

**Interfaces:**
- Consumes: the staff catalogue-item editor's "Fulfilment mode" `<Dropdown>` (`CatalogueItemEditor.tsx:545-562`). Verified option → value mapping (from `CATALOGUE_FULFILMENT_LABELS`, lines 30-34, over `FULFILMENT_TYPES = ['stocked','made_to_order','mixed']`):
  - `""` → "Inherit master (…)" → persists `fulfilment_type_override = null`
  - `"stocked"` → "Stocked (check + reserve inventory)"
  - `"made_to_order"` → "Re-order"
  - **`"mixed"` → "Both (draw stock, reorder the rest)"  ← the value to select**
  Selecting a value only updates local form state; it is persisted by `buildPatch()` (lines 205-206, sends `fulfilment_type_override`) when the sidebar form's primary button is clicked. **The human MUST click Save/Publish after each selection.**
- Produces: no interfaces. State outcome: all four demo `b2b_catalogue_items` resolve `coalesce(fulfilment_type_override, products.fulfilment_type) = 'mixed'`.

Grounding notes (verified):
- The PDP order-mode pill (the `OrderIntentToggle`, `role="group"` named "order mode") mounts when `canChooseOrderIntent` is true, which requires `options.canDrawStock && options.canReorder` (`components/shop/ProductDetailClient.tsx:336-340`). Per `orderingOptions()` (`lib/shop/fulfilment-mode.ts:83-94`), only a **`'mixed'`** product nature yields both `canDrawStock` and `canReorder`; `'stocked'` gives draw-only and `'made_to_order'` gives reorder-only (no toggle). Confirmed by `components/shop/__tests__/ProductDetailClient.pills.test.tsx` (mixed → both pills; stocked/made_to_order → no toggle).
- The demo member is seeded role `staff` with `ordering_permission = 'both'` (`scripts/demo-org/seed-identity.ts:86-88`). `effectivePermission('staff','both') = 'both'` (`fulfilment-mode.ts:59-65`), so for a `'mixed'` product `canDrawStock && canReorder` both hold → the demo user WILL see the pill. Runtime pill also needs stock present + volume tiers (`ProductDetailClient.tsx:336-340`); the demo seed already provides both (INVENTORY_PLAN stock states + the copied Anytime "Winter 26" price ladder / decoration ladder in `config.ts`), so no extra data setup is needed.
- Only **Classic Tee** currently carries `fulfilment_type_override = 'mixed'`; the other three (Stencil Hood, Access Faded Cap, Recycled Light Duffel Bag) inherit the master's `fulfilment_type`, so they must be switched to "Both". Demo identity: org `Print Room Demo` (`organizations.customer_code = 'DEMO'`, `is_test = true`), catalogue `Print Room Demo — Studio Collection`.

- [ ] **Step 1: Open the demo catalogue in the staff portal.** Sign in to the staff portal, go to Catalogues, and open **Print Room Demo — Studio Collection** (org "Print Room Demo", code DEMO). You should see four items: Classic Tee, Stencil Hood, Access Faded Cap, Recycled Light Duffel Bag.

- [ ] **Step 2: Set "Stencil Hood" to Both.** Open the **Stencil Hood** item. In the right sidebar, in the **"Catalogue-scoped details"** card, open the **"Fulfilment mode"** dropdown and select **"Both (draw stock, reorder the rest)"**. Then click the sidebar's primary button at the bottom of that card group — **"Save changes"** if the item is already Published, or **"Publish"** if it is still a Draft. (Selecting the dropdown alone does NOT save; the primary submit persists `fulfilment_type_override`.) Confirm the "Saved at …" timestamp appears.

- [ ] **Step 3: Set "Access Faded Cap" to Both.** Repeat Step 2 for the **Access Faded Cap** item: Fulfilment mode → **"Both (draw stock, reorder the rest)"** → **Save changes / Publish**. (This item is undecorated in the demo seed — that does not affect the pill; the pill keys off fulfilment nature + stock + tiers, all present.)

- [ ] **Step 4: Set "Recycled Light Duffel Bag" to Both.** Repeat Step 2 for the **Recycled Light Duffel Bag** item: Fulfilment mode → **"Both (draw stock, reorder the rest)"** → **Save changes / Publish**.

- [ ] **Step 5: (Leave "Classic Tee" as-is.)** No action — it already has `fulfilment_type_override = 'mixed'`. Only verify in Step 6.

- [ ] **Step 6: Verify all four resolve to a pill-capable ('mixed') fulfilment.** Run this read-only query in the Supabase SQL editor (or via `mcp__supabase__execute_sql`) against the production project:
  ```sql
  select
    p.name,
    ci.sort_order,
    ci.fulfilment_type_override,
    coalesce(ci.fulfilment_type_override, p.fulfilment_type) as effective_fulfilment
  from b2b_catalogue_items ci
  join b2b_catalogues c    on c.id = ci.catalogue_id
  join organizations o     on o.id = c.organization_id
  join products p          on p.id = ci.source_product_id
  where o.customer_code = 'DEMO'
    and o.is_test = true
  order by ci.sort_order nulls last, p.name;
  ```
  **Expected:** four rows (Classic Tee, Stencil Hood, Access Faded Cap, Recycled Light Duffel Bag), every `effective_fulfilment = 'mixed'`. If the demo org has more than one catalogue and extra rows appear, add `and c.name = 'Print Room Demo — Studio Collection'` to the `where` clause. If any row is not `'mixed'`, re-open that item and redo Steps 2-4 (make sure you clicked Save/Publish).

- [ ] **Step 7: Smoke-check the demo store.** Enter the demo ("Explore the demo" on the sign-in page), open each of the four products' PDPs, and confirm each shows the order-mode pill ("Stock on hand" / "Purchase order"). No deploy is involved — the change is live data as soon as Steps 2-4 are saved.

---

## Open threads / decision gates

- **[Foundation F-1: orders.order_type enum + stamp at submit]** Echo onto job_trackers: the spec says 'echo onto job_trackers if it helps the Past-orders query'. No Past-orders query exists in repo P today (grep for past-orders/pastOrders returned nothing) and job_trackers has no order_type column. Decision gate for the Items 10/11/13/15 authors: read orders.order_type directly (authoritative) rather than adding a job_trackers column now (YAGNI). If a job_trackers echo is later required, it is a separate migration + a one-line add to the createJobTrackerShellForOrder row.
- **[Foundation F-1: orders.order_type enum + stamp at submit]** DDL shape: implemented as text + CHECK constraint (following the xero_invoice_status precedent) rather than a native `create type ... as enum`. Behaviour is identical (NOT NULL, default purchase_order, two legal values). If a native enum type is preferred, swap only the migration DDL — the TS union type and all app code are unchanged.
- **[Foundation F-1: orders.order_type enum + stamp at submit]** Applied to production on 2026-07-15 only after Jamie explicitly overrode the original production guardrail. Supabase recorded remote migration `20260715004718_orders_order_type`; verification confirmed the column/default/check constraint and zero invalid rows. No other pending migration was applied or re-run.
- **[Foundation F-1: orders.order_type enum + stamp at submit]** The post-RPC order_type update is intentionally NOT best-effort (no swallowing try/catch) — it mirrors the plain awaited decoration_cost update at submit.ts:1082. Because the DB column defaults to 'purchase_order', a failed update leaves a valid (conservatively-typed) row, but a thrown error would abort the submit. If reviewers want it swallowed like the Monday/job-tracker side-effects, wrap it in the same audit-on-failure pattern — flagged for the review checkpoint.
- **[items-1-9-per-unit-pdp]** Decoration exclusion is a product decision. Per the spec's explicit wording ('sourced from unitEffective / pricing.unit_price') the plan shows the bare catalogue unit price and EXCLUDES decorationPerUnit. Consequence: when decorationPerUnit > 0, PerUnit x qty will NOT equal the Subtotal (Subtotal = qty x (unitEffective + decorationPerUnit)). A 'Decision gate' step is included; if product wants the customer-facing per-unit to be decoration-inclusive, change the value to breakdown.lines[0].lineNet / breakdown.lines[0].qty. Defaulting to unitEffective as the spec dictates.
- **[items-1-9-per-unit-pdp]** No ProductDetailClient render test exists (components/shop has no *.test.tsx), so 'both a stocked and a made-to-order product show a correct per-unit figure' is verified by the component-level PriceBreakdown test plus a code-read confirming the PDP call site is mode-agnostic. If an end-to-end assertion on the two modes is wanted, that needs a new PDP test harness (out of scope here).
- **[items-6-7-hide-availability-and-gate-mode-filter]** DECISION GATE (Item 6 scope): the spec says 'hide the Available column header', but the only table-coherent implementation hides the WHOLE column (header + body cells) plus the header badge in Purchase-order mode. Side effect: the per-size mint 'Available to order' chips AND the header 'Available to order' badge stop rendering in Purchase-order mode (they live inside the hidden column/badge). Four existing tests pinned the old signal and are rewritten by this plan (inventory-sizes.test.tsx tests at 123/136/150; permissions.test.tsx line 114). If those orderability signals must survive in Purchase-order mode, revise Item 6 before implementing.
- **[items-6-7-hide-availability-and-gate-mode-filter]** Item 7 hides only the FilterRail ordering-mode <select> for stock_only members; it does NOT clamp filters.mode to 'all'. A stock_only member deep-linking /catalogue?mode=reorder would still hit server-side matchesMode filtering (likely empty results) even though the control is hidden. Spec only asked to hide the select — confirm whether the query should also be forced to 'all' for stock_only members.
- **[items-6-7-hide-availability-and-gate-mode-filter]** Step 12 uses `npx tsc --noEmit` to verify the catalogue-page wiring; if the repo's baseline already has unrelated type errors, scope the check to 'no new errors from catalogue/page.tsx or FilterRail.tsx' (there is no dedicated typecheck script confirmed in this cluster's scope).
- **[items-3-10-5-orders-ia-two-surface-split]** Decision gate (store filter): Item 3 asks for a 'store' filter on both surfaces, but orders have no single store — a stock_on_hand order can span multiple stores via quote_items.ship_to_store_id, and job_trackers.location_id is Monday-fed and often null. The plan implements status + date filters concretely and leaves the store dropdown behind an explicit Decision-gate step. Needs a product decision on how to attribute one store to an order before the dropdown is built.
- **[items-3-10-5-orders-ia-two-surface-split]** Redirect target for a non-admin (staff) hitting /order-tracker or /tracking: the plan uses redirect('/my-collections') (their Past orders home). Confirm this vs '/catalogue' (which is what inventory/page.tsx uses for its denial).
- **[items-3-10-5-orders-ia-two-surface-split]** fetchAccountDataForUser (the account page's org-wide quotes list) is left unscoped by role in this cluster because it now only serves the account page. If staff should also see only their own quotes on the /account page, that is a separate follow-up decision — flagged rather than silently changed.
- **[items-3-10-5-orders-ia-two-surface-split]** Hard dependency: the queries in Item 10/Item 3 filter .eq('order_type','stock_on_hand'); they return zero rows until the Order-type foundation task has added orders.order_type and backfilled it. This cluster must land after that foundation task.
- **[items-3-10-5-orders-ia-two-surface-split]** Past-orders card link target is kept as the quote id → /my-collections/[collectionId] (that client route resolves a quote/collection by collectionId and already works). Confirm this is the desired destination for a placed order vs the /checkout/confirmation/[orderId] page.
- **[item-4-suppress-demo-payment-terms]** Behaviour scope (confirmed against spec, flagged for reviewer): gating with `!isTest` hides BOTH the 'Payment terms' line AND the 'Expected deposit' line for test/demo orgs, because both live inside the single `{(depositPct > 0 || paymentTerms) && ...}` block. Spec says 'Suppress the deposit/payment-terms block', so hiding both is intended. Real orgs (is_test=false) are unchanged.
- **[item-4-suppress-demo-payment-terms]** Typecheck verification uses `npx tsc --noEmit` (no `typecheck` npm script exists — scripts are dev/build/start/lint/test). If the repo currently has unrelated pre-existing tsc errors, treat the check as 'no NEW error introduced in the touched files'; `next build` is the fallback typecheck.
- **[item-4-suppress-demo-payment-terms]** requireB2BCustomer/buildPreviewContext have no dedicated unit-test harness (they need Supabase mocks), so the plumbing step is verified by tsc + the existing component test suite staying green, not by a new server test. This matches how paymentTerms/defaultDepositPercent were originally threaded.
- **[items-11-13-stock-note-order-placed-notify]** order_type foundation dependency: this cluster CONSUMES an in-scope `const orderType: 'stock_on_hand' | 'purchase_order'` in submitCustomerOrder (declared by an earlier build-order cluster after the submit_b2b_order RPC returns, ≈ line 1077, and persisted to orders.order_type). If the foundation only writes the column and does NOT expose the local, apply the Decision-gate fallback in each wiring task: `const orderType = ((await admin.from('orders').select('order_type').eq('id', order_id).maybeSingle()).data as { order_type: 'stock_on_hand' | 'purchase_order' } | null)?.order_type ?? 'purchase_order'`.
- **[items-11-13-stock-note-order-placed-notify]** Item 13 payload: Spec A lists the notification contents as order ref / customer-org / line summary / total / deep link and does NOT name order_type, but the cluster header states 'Both consume orders.order_type' and stock-on-hand is operationally load-bearing (invoice-before-dispatch). I included order_type as one context field/line in both the Slack blocks and the dispatch email. If the reviewer wants it strictly omitted, drop the `orderType` field from OrderPlacedNotification/OrderPlacedDispatchParams and the two ORDER_TYPE_LABEL renders — no other change.
- **[items-11-13-stock-note-order-placed-notify]** Dispatch deep link points at the customer-portal confirmation page (${PORTAL_ORIGIN}/checkout/confirmation/${order_id}) because that is the only order_id-keyed route that exists. Charlotte is staff; if the desk wants a staff-portal order URL instead, that is an origin/path change in the wiring task (Decision gate noted there) — not resolved here.
- **[items-11-13-stock-note-order-placed-notify]** The wiring task adds a 4th organizations.is_test read in submit.ts (step 5a, 5c, 6 already each read it). Left as an independent read for a minimal, self-contained diff; a follow-up could hoist a single is_test read shared by steps 5a/5c/6/7. Flagged, not done.
- **[items-11-13-stock-note-order-placed-notify]** SLACK_PORTAL_WEBHOOK_URL and DISPATCH_NOTIFICATION_EMAIL are not set in any committed env (grep-confirmed absent). postOrderPlacedSlack no-ops cleanly when the webhook is unset; the dispatch email always sends (to charlotte@ in prod / jamie@ for test orgs). No env flip is required by this plan to ship safely.
- **[Item 15: Xero draft-quote eligibility rewrite]** Decision gate — XERO_ENABLED stays deploy-dark. This plan only makes the code correct WHEN the flag is on; it is set in no committed env. Flipping it live is a separate release call and must NOT happen in this work.
- **[Item 15: Xero draft-quote eligibility rewrite]** Deliberate deferral: CreateDraftInvoiceResult.status keeps the 'manual_review' member and submit.ts keeps its manual-review Monday-note block (step 5c, lines 1549-1562), even though Spec A can no longer produce that status. Removing them now cascades into an unused postItemUpdate import + a write-only mondayItemId. Left intact as a forward-compat seam for Spec B (prepay handling). Flag for a Spec-B cleanup if Spec B does not reuse it.
- **[Item 15: Xero draft-quote eligibility rewrite]** Deliberate keep: CreateDraftInvoiceArgs.drawsStock is retained even though eligibility no longer reads it — submit.ts still computes it from coerced fulfilment_type and lib/checkout/__tests__/submit.fulfilment-truth.test.ts asserts it as the observable of server-side fulfilment truth (4 cases). Spec B (paid vs unpaid stock) will consume it. Deleting it would force churn on the MOQ-coercion suite and lose that coverage.
- **[item14-login-help-item8-demo-pill]** Item 14 recipient (spec-flagged open thread): whether customer login-help should use hello@theprint-room.co.nz instead of jamie@theprint-room.co.nz. Plan implements jamie@ per the decided spec text; if changed, update the one href + the test's expected value. This is a customer-facing PROD link (the memory 'test emails to jamie@' rule is about outbound test mail, not a customer support address), so this genuinely needs a human call.
- **[item14-login-help-item8-demo-pill]** Item 14 visibility scope: 'near Forgot password?' places the link only in password mode; the DEFAULT email-code screen shows no help link. Implemented per spec (password mode). Decision needed on whether to also surface it in email-code mode / always (would require relocating the anchor outside the password form, e.g. near the 'Explore the demo' link at lines 298-304) — captured as a Decision gate step, not resolved in code.
- **[item14-login-help-item8-demo-pill]** Item 8 has no automated test cycle (data-config runbook). Verification is the Step 6 SQL + Step 7 manual smoke check. The runbook assumes exactly the four demo products from scripts/demo-org/config.ts still exist in the DEMO org catalogue; if the demo org has been re-seeded or renamed, confirm the four item names before applying.

Additional standing threads from the spec: item 14 login-help address (`jamie@` assumed; switch to `hello@` if customer-facing default is preferred); item 13 scope (notify on all placements vs stock-on-hand only — start with all); `XERO_ENABLED` flip-to-live is a release-time call; Slack channel + webhook depend on Chris freeing an integration slot.
