# Checkout Billed-Total Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/checkout` and `/checkout/review` show what will actually be invoiced — prepaid stock draws at $0, the NZ picking fee as its own line — and make the confirmation page, the customer email and the Xero draft all agree with that number.

**Architecture:** One shared pure module, `lib/pricing/order-billing-shape.ts`, computes the billed shape (per-line zeroing, cart→order partitioning, per-order fee/GST/total) and is called by both checkout pages. The server keeps final authority: `submit.ts` still re-resolves billing modes from `variant_inventory` and `draft-invoice.ts` still gates zeroing on `qty_from_stock > 0`. The module makes the client *predict* the server correctly; a `claimed_billing_mode` 409 guard catches the cases where it can't. The billed figures are snapshotted onto `quotes` at submit so the journey after checkout reads what was billed rather than recomputing against mutable data.

**Tech Stack:** Next.js App Router (client components), TypeScript, Supabase (Postgres), Vitest + @testing-library/react, Tailwind.

## Global Constraints

- **Money predicate is `fulfilmentType === 'stocked' && billingMode === 'prepaid'` — never `nature`.** One function (`isPrepaidDrawn`) serves both the badge and the money so they cannot diverge.
- **Picking-fee band basis is full goods value at CURRENT catalogue price, pre-zeroing** (D2 — the ordering event). The existing server behaviour at `submit.ts:1184` is already correct and must not change.
- **Picking-fee band table is unchanged:** `$0-99 = $35, $100-199 = $30, $200-299 = $25, $300-399 = $20, $400+ = $15` (`lib/pricing/picking-fee.ts`).
- **Fee is NZD-only and NZ-ship-to-gated.** Never add AUD/AUS handling — that is a separate deferred epic.
- **Fail closed on unknown billing mode:** null/unknown/fetch-error → `invoice_on_dispatch` (charge the customer). Never fail open to $0.
- **GST rate 0.15**, applied to `billedSubtotal + pickingFee`.
- **`quotes.total_amount` stays the full ex-GST goods value.** Monday, staff order views and reporting read it and must be untouched.
- **Rounding:** use `round2` from `lib/pricing/pricingMath.ts` everywhere, matching `computeOrderBreakdown` (round each line, then round the sum).
- **No `submit_b2b_order` RPC change.** New columns are written post-RPC exactly like `decoration_cost` (`submit.ts:1195`).
- **Copy is fixed by the spec:** `Pre-paid`, `Drawn from pre-paid stock`, `Goods (pre-paid)`, `Picking fee`, `Stock-on-hand order`, `Purchase order`, `Total across N orders`, `You'll receive N invoices.`, `Goods value` (staff email), `Pre-paid status changed — review your cart.`
- **This is a customer-portal change only.** No staff-portal deploy is coupled to it.
- **Line numbers are from the branch point** (`68937c8` on `feat/checkout-billed-total-parity`) and drift as earlier tasks land — Task 13 alone shifts everything below it in `submit.ts` by roughly +17. Locate code by the quoted anchor text; treat the number as a hint, never as the target.
- **`npx tsc --noEmit` is NOT clean at the branch point.** The baseline is **5 pre-existing errors**, all in two test files this work never touches:
  - `lib/__tests__/next-config-redirects.test.ts` — 1 (unused `@ts-expect-error`)
  - `lib/email/__tests__/tracker-notification.test.ts` — 4 (stale `sendTrackerNotification` signature)

  Every "typecheck" step below means **no NEW errors** — expect exactly these 5 and no others. If a sixth appears, or one lands in a file you touched, that one is yours. Do not fix the baseline five as part of this work; they are unrelated and would muddy a money-critical diff.

## Deploy Sequencing

Two deploys, in this order:

1. **Deploy 1 — Task 1 only (the migration).** Additive columns, nothing reads them. Lands ahead of the code safely. **Must not be bundled with any currently-held migration** (volume_display drop, variant_label retirement B, SKUCOLLAPSE 024/025).
2. **Deploy 2 — Tasks 2-16 as ONE unit.** Do not ship partially:
   - UI without persistence (Tasks 14-16) produces a $17.25 → $1,465.20 → $17.25 whiplash — worse than today's consistently-wrong number.
   - UI without the freshness read (Tasks 7-8) renders `$0` from a possibly-days-stale cart snapshot — a number we would not honour.

## Corrections to the spec found during planning

Three things the spec assumed that the code contradicts. All are folded into the tasks below; they are called out here because they change the work, not just the wording.

1. **`resolveLineBillingModes` currently runs AFTER the RPC commits** (`submit.ts:1166`; the RPC is at `submit.ts:1038`). Throwing a drift 409 from there would leave a committed order behind and still fail the customer. Task 13 hoists the resolution to a new step 2c, before the RPC, and reuses the one map at both existing call sites.
2. **`/checkout` never loads store `country`** — `app/(portal)/checkout/page.tsx:18` selects `id, name, city`, while the review page selects `country` too. Without the fix in Task 11, the fee would compute as $0 on `/checkout` and $15 on `/checkout/review` — recreating the exact defect being fixed, in a new place.
3. **`billedOrderShape({ lines, gstRate })` in the spec's interface block omits `shipCountry`**, which `orderPickingFee` requires. The real signature is `billedOrderShape({ lines, gstRate, shipCountry })`. Resolving `shipCountry` is a ~10-line rule that mirrors `submit.ts` and today lives only in `CheckoutReviewClient`; Task 4 extracts it so both pages share it.

Also noted, deliberately **not** actioned: after Task 11-12, `PriceBreakdown`'s `checkout-review` variant has no production caller (`cart-totals` already had none; only `pdp` survives). Leaving it is mild debt; removing it means touching a shared PDP component for no user benefit inside a money-critical deploy. Follow-up, not this plan.

## File Structure

**Created**

| File | Responsibility |
| --- | --- |
| `supabase/migrations/20260717120000_quotes_billed_totals.sql` | Additive `quotes.picking_fee`, `quotes.billed_total` |
| `lib/pricing/order-billing-shape.ts` | **The shared billing module.** Zeroing, partitioning, per-order fee/GST/total |
| `lib/pricing/order-billing-shape.test.ts` | Unit + band-boundary tests |
| `lib/pricing/order-billing-shape.xero-parity.test.ts` | The regression that would have caught the original defect |
| `lib/checkout/ship-country.ts` | Ship-to country resolution shared by both checkout pages |
| `lib/checkout/ship-country.test.ts` | — |
| `app/api/checkout/billing-modes/route.ts` | `GET` — fresh org-scoped variant billing modes |
| `app/api/checkout/__tests__/billing-modes.test.ts` | — |
| `components/checkout/useFreshBillingModes.ts` | Client hook; fail-closed fetch of the above |
| `components/checkout/PrepaidLinePrice.tsx` | Badge + line price cell (`$1,465.20 → $0.00`) |
| `components/checkout/PrepaidLinePrice.test.tsx` | — |
| `components/checkout/BilledOrderSummary.tsx` | Partition groups, per-order totals, breakdown, grand total |
| `components/checkout/BilledOrderSummary.test.tsx` | — |

**Modified**

| File | Change |
| --- | --- |
| `lib/checkout/partition.ts` | Extract the split rule into a shape-agnostic `partitionByFulfilment` |
| `lib/shop/prepaid-tag.ts` (+ test) | `showsPrepaidTag` → `isPrepaidDrawn`; keyed on `fulfilmentType`, not `nature` |
| `app/(portal)/checkout/page.tsx` | Select store `country` |
| `components/checkout/ShipToRow.tsx` | New `prepaidDrawn` prop |
| `components/checkout/CheckoutClient.tsx` | Render the billed shape |
| `components/checkout/CheckoutReviewClient.tsx` | Render the billed shape; deposit off billed subtotal; send `claimed_billing_mode`; drift banner |
| `lib/checkout/submit.ts` | Hoist billing-mode resolution; `BillingModeDriftError`; persist `picking_fee` + `billed_total` |
| `app/api/checkout/route.ts` | Map `BillingModeDriftError` → 409 |
| `app/(portal)/checkout/confirmation/[orderId]/page.tsx` (+ `ConfirmationView.tsx`) | Read `billed_total` / `picking_fee` |
| `lib/email/order-confirmation.ts` | Billed total + picking fee |
| `lib/email/order-placed-dispatch.ts` | Relabel `Total` → `Goods value` |

---

## Task 1: Migration — `quotes.picking_fee` + `quotes.billed_total`

**This task is Deploy 1 and ships alone.** Nothing reads these columns until Deploy 2.

**Files:**
- Create: `supabase/migrations/20260717120000_quotes_billed_totals.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `public.quotes.picking_fee numeric NULL`, `public.quotes.billed_total numeric NULL`. Tasks 14, 15 and 16 read/write them.

- [ ] **Step 1: Confirm no held migration is pending ahead of this one**

Run: `ls supabase/migrations/ | tail -5`

Expected: the newest files are `20260715120000_orders_notifications_dispatched_at.sql` and its neighbours. If any migration in the directory is uncommitted or known-held (volume_display drop, variant_label retirement B, SKUCOLLAPSE 024/025), **stop and ask** — this migration must land on its own, not bundled with a held one.

- [ ] **Step 2: Write the migration**

```sql
-- Checkout billed-total parity (spec 2026-07-17). The customer-facing invoice
-- figures, snapshotted at submit so the confirmation page and the customer email
-- render what was actually billed rather than recomputing against today's
-- variant_inventory.billing_mode — which is mutable, so a recompute would
-- silently rewrite the history of an old order.
--
-- total_amount is deliberately UNCHANGED: it stays the ex-GST GOODS value, so
-- Monday pushes, staff order views and reporting are untouched by this work.
--
-- picking_fee  — the NZ picking fee charged on this order, ex-GST. 0 when none
--                applies (purchase order, non-NZ ship-to).
-- billed_total — ex-GST total actually invoiced: billed goods + picking_fee.
--                Prepaid stock draws contribute 0 goods, so a wholly prepaid
--                order's billed_total is just the picking fee.
--
-- Both nullable: NULL means "order predates this column", which readers must
-- distinguish from 0 (a real, free order).
alter table public.quotes
  add column if not exists picking_fee numeric,
  add column if not exists billed_total numeric;

comment on column public.quotes.picking_fee is
  'NZ picking fee charged on this order, ex-GST. 0 = no fee applies. NULL = order predates the column.';
comment on column public.quotes.billed_total is
  'Ex-GST total actually invoiced: billed goods (prepaid draws count 0) + picking_fee. Distinct from total_amount, which stays the full goods value. NULL = order predates the column.';
```

- [ ] **Step 3: Apply the migration to the database**

Apply via the Supabase MCP `apply_migration` tool with name `quotes_billed_totals` and the SQL body above.

- [ ] **Step 4: Verify the columns exist and are nullable**

Run this SQL via the Supabase MCP `execute_sql` tool:

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'quotes'
  and column_name in ('picking_fee', 'billed_total')
order by column_name;
```

Expected: exactly two rows —
`billed_total | numeric | YES` and `picking_fee | numeric | YES`.

- [ ] **Step 5: Verify existing orders are untouched**

```sql
select count(*) as total_rows,
       count(picking_fee) as picking_fee_set,
       count(billed_total) as billed_total_set
from public.quotes;
```

Expected: `picking_fee_set` and `billed_total_set` are both `0`. Existing rows must be NULL, not backfilled.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260717120000_quotes_billed_totals.sql
git commit -m "feat(db): add quotes.picking_fee + quotes.billed_total

Additive columns for the billed (invoiced) figures, snapshotted at submit.
total_amount stays the full goods value so Monday/reporting are untouched.
Nothing reads these yet — this migration deploys ahead of the code.

Spec: docs/superpowers/specs/2026-07-17-checkout-billed-total-parity-design.md"
```

**Deploy 1 ends here.** Everything below is Deploy 2.

---

## Task 2: Extract the partition rule so client and server share it

The cart→order split rule lives in `partitionCheckoutLines`, typed to the server's snake_case `CheckoutLineInput`. The billing module needs the same rule over camelCase cart lines. Extracting a shape-agnostic core keeps the rule — including the purchase-order-first ordering — in exactly one place.

**Files:**
- Modify: `lib/checkout/partition.ts`
- Test: `lib/checkout/__tests__/partition.test.ts`

**Interfaces:**
- Consumes: `CheckoutLineInput` from `lib/checkout/submit.ts` (unchanged).
- Produces:
  - `partitionByFulfilment<T>(lines: T[], isStocked: (line: T) => boolean): Array<FulfilmentPartition<T>>`
  - `interface FulfilmentPartition<T> { orderType: CheckoutOrderType; lines: T[] }`
  - `partitionCheckoutLines(lines: CheckoutLineInput[]): CheckoutPartition[]` — signature unchanged.
  - Task 5 calls `partitionByFulfilment`.

- [ ] **Step 1: Write the failing test**

Append to `lib/checkout/__tests__/partition.test.ts`:

```ts
import { partitionByFulfilment } from '../partition'

describe('partitionByFulfilment', () => {
  it('splits an arbitrary line shape via the supplied predicate', () => {
    const lines = [
      { id: 'a', mode: 'stocked' },
      { id: 'b', mode: 'made_to_order' },
      { id: 'c', mode: 'stocked' },
    ]
    expect(partitionByFulfilment(lines, (l) => l.mode === 'stocked')).toEqual([
      { orderType: 'purchase_order', lines: [{ id: 'b', mode: 'made_to_order' }] },
      {
        orderType: 'stock_on_hand',
        lines: [
          { id: 'a', mode: 'stocked' },
          { id: 'c', mode: 'stocked' },
        ],
      },
    ])
  })

  it('returns purchase_order FIRST (the primary/tracked order)', () => {
    const lines = [{ stocked: true }, { stocked: false }]
    const out = partitionByFulfilment(lines, (l) => l.stocked)
    expect(out.map((p) => p.orderType)).toEqual(['purchase_order', 'stock_on_hand'])
  })

  it('never returns an empty-lines partition', () => {
    expect(partitionByFulfilment([{ stocked: true }], (l) => l.stocked)).toEqual([
      { orderType: 'stock_on_hand', lines: [{ stocked: true }] },
    ])
  })

  it('returns [] for empty input', () => {
    expect(partitionByFulfilment([], () => true)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/checkout/__tests__/partition.test.ts`
Expected: FAIL — `partitionByFulfilment is not a function` (or a TS resolution error on the import).

- [ ] **Step 3: Implement**

Replace the whole body of `lib/checkout/partition.ts` with:

```ts
import type { CheckoutLineInput } from '@/lib/checkout/submit'

export type CheckoutOrderType = 'purchase_order' | 'stock_on_hand'

export interface FulfilmentPartition<T> {
  orderType: CheckoutOrderType
  lines: T[]
}

export type CheckoutPartition = FulfilmentPartition<CheckoutLineInput>

/**
 * The split rule, independent of line shape: a line joins 'stock_on_hand' iff
 * `isStocked` says it draws stock; everything else joins 'purchase_order'.
 * purchase_order is returned FIRST (the primary/tracked order), then
 * stock_on_hand. Never returns an empty-lines partition; returns [] for empty
 * input.
 *
 * Generic because two callers hold different line shapes: the server submits
 * snake_case CheckoutLineInput, while the customer checkout summary
 * (lib/pricing/order-billing-shape.ts) holds camelCase cart lines. One rule in
 * one place, so the order groups the customer sees are the orders the server
 * actually creates.
 */
export function partitionByFulfilment<T>(
  lines: T[],
  isStocked: (line: T) => boolean,
): Array<FulfilmentPartition<T>> {
  const purchaseOrder: T[] = []
  const stockOnHand: T[] = []
  for (const line of lines) {
    if (isStocked(line)) stockOnHand.push(line)
    else purchaseOrder.push(line)
  }
  const out: Array<FulfilmentPartition<T>> = []
  if (purchaseOrder.length > 0) out.push({ orderType: 'purchase_order', lines: purchaseOrder })
  if (stockOnHand.length > 0) out.push({ orderType: 'stock_on_hand', lines: stockOnHand })
  return out
}

/**
 * Split checkout lines into at most two homogeneous orders by fulfilment.
 * A line joins the 'stock_on_hand' partition iff its fulfilment_type is
 * exactly 'stocked' (a stock DRAW). 'made_to_order' AND absent/legacy lines
 * join 'purchase_order' — matching submit_b2b_order's MOQ-conservative
 * treatment of an absent fulfilment_type.
 */
export function partitionCheckoutLines(lines: CheckoutLineInput[]): CheckoutPartition[] {
  return partitionByFulfilment(lines, (line) => line.fulfilment_type === 'stocked')
}
```

- [ ] **Step 4: Run the tests — new AND pre-existing**

Run: `npx vitest run lib/checkout/__tests__/partition.test.ts`
Expected: PASS, including every pre-existing `partitionCheckoutLines` test. Those are the proof the refactor preserved behaviour — if any fails, the extraction is wrong, not the test.

- [ ] **Step 5: Typecheck the existing callers**

Run: `npx tsc --noEmit`
Expected: no errors. `CheckoutPartition` changed from an interface to a type alias with an identical shape; `app/api/checkout/route.ts` imports it and must still compile.

- [ ] **Step 6: Keep the submit import type-only**

Confirm the first line of `lib/checkout/partition.ts` is still `import type { CheckoutLineInput }` — with the `type` keyword — and not a plain `import`.

Until now `partition.ts` was server-only. From Task 5 it is pulled into `order-billing-shape.ts`, which `CheckoutClient` (a `'use client'` component) imports — so `partition.ts` enters the client bundle for the first time. The `type` keyword is what stops TypeScript from following the edge into `submit.ts`, which reaches `next/server`'s `after()` and the Supabase admin client. Drop the keyword and the client build pulls the entire server submit path in behind it.

Run: `npm run build`
Expected: builds clean. If it fails resolving a server-only module from a client chunk, that import is the cause.

- [ ] **Step 7: Commit**

```bash
git add lib/checkout/partition.ts lib/checkout/__tests__/partition.test.ts
git commit -m "refactor(checkout): extract shape-agnostic partitionByFulfilment

The cart->order split rule (incl. purchase-order-first ordering) now lives in
one generic so the client billing module can share it with the server instead
of restating it against camelCase cart lines."
```

---

## Task 3: Fix the prepaid predicate — key it on `fulfilmentType`, not `nature`

`showsPrepaidTag` takes the product's `nature` and returns true for `'mixed'`. Xero zeroes on `qty_from_stock > 0`, so a made-to-order line of a mixed-nature prepaid variant is **charged** while showing the "Pre-paid" badge. Cosmetic today; the moment Task 5 wires money to this predicate it becomes a $0-shown / full-charged money bug.

Renaming it to `isPrepaidDrawn` is the point of the task, not decoration: one function, one name, used by both the badge and the money, so the spec's "badge and money cannot diverge" is enforced by the type system rather than by discipline.

**Files:**
- Modify: `lib/shop/prepaid-tag.ts`
- Modify: `lib/shop/prepaid-tag.test.ts`
- Modify: `components/checkout/CheckoutReviewClient.tsx:10` (import) and `:460` (call site)

**Interfaces:**
- Consumes: `BillingMode` from `lib/shop/billing-mode.ts`; `CartLineFulfilmentType` from `lib/cart/types.ts`.
- Produces: `isPrepaidDrawn(fulfilmentType: CartLineFulfilmentType | undefined, billingMode: BillingMode | null): boolean` — Tasks 5, 9, 12 and 14 call it. Also `showsPrepaidStockBadge(nature: FulfilmentType, billingMode: BillingMode | null): boolean` (see the correction below). `showsPrepaidTag` no longer exists.

**CORRECTION (found during execution).** This task originally claimed one production caller and said to fix any other "the same way". That was wrong, and `tsc` caught it: **the PDP is a second caller** (`components/shop/ProductDetailClient.tsx:1137`) passing `product.fulfilment_type`, which is `FulfilmentType` — including `'mixed'`.

The two surfaces ask different questions:

- **PDP** — "*can* this product be drawn from prepaid stock?" A capability, asked before the customer picks an ordering mode. `'mixed'` must answer **yes**.
- **Checkout** — "*is* this line a prepaid draw?" A fact, knowable only after the choice. This is the money predicate.

Routing the PDP through `isPrepaidDrawn` would type-error on `'mixed'` and silently drop the badge from mixed-nature prepaid products. So the file exports **two** predicates: `isPrepaidDrawn` (money; chosen `fulfilmentType`; `'mixed'` not expressible) and `showsPrepaidStockBadge` (PDP; product `nature`; informational, must never drive a price). The spec's "badge and money cannot diverge" still holds where it matters — the *checkout* badge and the money are one function.

One existing test also changed fixture: `CheckoutReviewClient.billing-mode.test.tsx` drove the made-to-order case via `nature` while leaving the default `fulfilmentType: 'stocked'` — a line the PDP cannot produce. It now drives `fulfilmentType`. The assertion and its intent are unchanged.

- [ ] **Step 1: Write the failing test**

Replace the whole of `lib/shop/prepaid-tag.test.ts` with:

```ts
import { describe, it, expect } from 'vitest'
import { isPrepaidDrawn } from './prepaid-tag'

describe('isPrepaidDrawn', () => {
  it('true for a prepaid line that draws stock', () => {
    expect(isPrepaidDrawn('stocked', 'prepaid')).toBe(true)
  })

  // The defect this rename fixes. A made-to-order line of a prepaid variant is
  // PRODUCED, so Xero charges it (qty_from_stock = 0). The old predicate took
  // the product's `nature` and returned true for 'mixed', badging a line we bill
  // in full.
  it('false for a prepaid line that is made to order', () => {
    expect(isPrepaidDrawn('made_to_order', 'prepaid')).toBe(false)
  })

  it('false for a stocked line that is not prepaid', () => {
    expect(isPrepaidDrawn('stocked', 'invoice_on_dispatch')).toBe(false)
  })

  it('false when billingMode is null (legacy line — fail closed, charge it)', () => {
    expect(isPrepaidDrawn('stocked', null)).toBe(false)
  })

  it('false when fulfilmentType is absent (legacy line — treated as produced)', () => {
    expect(isPrepaidDrawn(undefined, 'prepaid')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/shop/prepaid-tag.test.ts`
Expected: FAIL — `isPrepaidDrawn is not a function`.

- [ ] **Step 3: Implement**

Replace the whole of `lib/shop/prepaid-tag.ts` with:

```ts
import type { BillingMode } from './billing-mode'
import type { CartLineFulfilmentType } from '@/lib/cart/types'

/**
 * Is this line a prepaid stock DRAW — goods the org has already paid for, so we
 * invoice them at $0?
 *
 * The single predicate behind BOTH the customer "Pre-paid" badge and the billed
 * price. They must never diverge: a badge that says "Pre-paid" on a line we
 * charge in full is a lie, and a $0 line we invoice in full is a money bug.
 *
 * Keyed on `fulfilmentType` — the CHOSEN mode — and deliberately never on
 * `nature`, the product's capability. A 'mixed'-nature product can be ordered
 * either way; only the choice decides whether stock is drawn. This mirrors the
 * server's zeroing gate in draft-invoice.ts (qty_from_stock > 0): a prepaid
 * variant's made-to-order line is produced, and produced goods are charged.
 *
 * Absent fulfilmentType (legacy persisted line) → treated as produced, i.e.
 * charged. Unknown/null billingMode → charged. Both fail closed by design.
 */
export function isPrepaidDrawn(
  fulfilmentType: CartLineFulfilmentType | undefined,
  billingMode: BillingMode | null,
): boolean {
  if (billingMode !== 'prepaid') return false
  return fulfilmentType === 'stocked'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/shop/prepaid-tag.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Update the one existing call site**

In `components/checkout/CheckoutReviewClient.tsx`, change the import on line 10:

```ts
import { isPrepaidDrawn } from '@/lib/shop/prepaid-tag'
```

and replace the badge block at lines 460-467 with:

```tsx
{isPrepaidDrawn(line.fulfilmentType, line.billingMode ?? null) && (
  <span className="mt-1 inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
    Pre-paid
  </span>
)}
```

Note the `line.nature as 'stocked' | 'made_to_order' | 'mixed'` cast is gone. That cast was the defect wearing a disguise: it silenced the type error that would otherwise have flagged `nature` being passed where the chosen mode belongs. Task 12 replaces this block again with the shared component; it is corrected here so the tree is never left in a state where the badge is knowingly wrong.

- [ ] **Step 6: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests pass. There is exactly one production caller — if `tsc` reports another, fix it the same way.

- [ ] **Step 7: Commit**

```bash
git add lib/shop/prepaid-tag.ts lib/shop/prepaid-tag.test.ts components/checkout/CheckoutReviewClient.tsx
git commit -m "fix(checkout): prepaid predicate keys on fulfilmentType, not nature

showsPrepaidTag took the product's nature and returned true for 'mixed', so a
made-to-order line of a mixed-nature prepaid variant showed the Pre-paid badge
while Xero charged it (qty_from_stock = 0). Renamed to isPrepaidDrawn and keyed
on the CHOSEN fulfilment, matching the server's zeroing gate.

Cosmetic today; wiring money to the old predicate would have made it a
\$0-shown / full-charged bug."
```

---

## Task 4: Extract ship-to country resolution

The picking fee is NZ-gated, so the billed shape needs the ship-to country. The rule ("the custom address when every line ships custom, else the FIRST STOCKED line's store") lives only in `CheckoutReviewClient:85-95` and mirrors `submit.ts`. `/checkout` needs it too; duplicating it would let the two pages drift on the exact gate this work exists to align.

**Files:**
- Create: `lib/checkout/ship-country.ts`
- Test: `lib/checkout/ship-country.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `resolveShipCountry(input: { lines: ShipCountryLine[]; perLineShipTo: Record<string, string | null>; customAddressCountry: string | null | undefined; countryByStoreId: Map<string, string | null> }): string | null` and `interface ShipCountryLine { lineId: string; fulfilmentType?: 'stocked' | 'made_to_order' }`. Tasks 11 and 12 call it.

- [ ] **Step 1: Write the failing test**

Create `lib/checkout/ship-country.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveShipCountry } from './ship-country'

const stores = new Map<string, string | null>([
  ['store-nz', 'NZ'],
  ['store-au', 'Australia'],
  ['store-blank', null],
])

describe('resolveShipCountry', () => {
  it("uses the FIRST STOCKED line's store, not the first cart line", () => {
    // The stocked partition submits as its own order, so a made-to-order line
    // sitting first in the cart must not decide the stock order's fee gate.
    expect(
      resolveShipCountry({
        lines: [
          { lineId: 'a', fulfilmentType: 'made_to_order' },
          { lineId: 'b', fulfilmentType: 'stocked' },
        ],
        perLineShipTo: { a: 'store-au', b: 'store-nz' },
        customAddressCountry: null,
        countryByStoreId: stores,
      }),
    ).toBe('NZ')
  })

  it('uses the custom address country when every line ships custom', () => {
    expect(
      resolveShipCountry({
        lines: [{ lineId: 'a', fulfilmentType: 'stocked' }],
        perLineShipTo: { a: null },
        customAddressCountry: 'New Zealand',
        countryByStoreId: stores,
      }),
    ).toBe('New Zealand')
  })

  it('is null when lines are mixed custom and store (v1 rejects this cart anyway)', () => {
    expect(
      resolveShipCountry({
        lines: [
          { lineId: 'a', fulfilmentType: 'stocked' },
          { lineId: 'b', fulfilmentType: 'stocked' },
        ],
        perLineShipTo: { a: null, b: 'store-nz' },
        customAddressCountry: 'NZ',
        countryByStoreId: stores,
      }),
    ).toBe('NZ')
  })

  it('is null when there is no stocked line (purchase order — no fee anyway)', () => {
    expect(
      resolveShipCountry({
        lines: [{ lineId: 'a', fulfilmentType: 'made_to_order' }],
        perLineShipTo: { a: 'store-nz' },
        customAddressCountry: null,
        countryByStoreId: stores,
      }),
    ).toBeNull()
  })

  it("is null when the stocked line's store has no country recorded", () => {
    expect(
      resolveShipCountry({
        lines: [{ lineId: 'a', fulfilmentType: 'stocked' }],
        perLineShipTo: { a: 'store-blank' },
        customAddressCountry: null,
        countryByStoreId: stores,
      }),
    ).toBeNull()
  })

  it('is null for an unknown store id', () => {
    expect(
      resolveShipCountry({
        lines: [{ lineId: 'a', fulfilmentType: 'stocked' }],
        perLineShipTo: { a: 'store-gone' },
        customAddressCountry: null,
        countryByStoreId: stores,
      }),
    ).toBeNull()
  })

  it('is null for an empty cart', () => {
    expect(
      resolveShipCountry({
        lines: [],
        perLineShipTo: {},
        customAddressCountry: 'NZ',
        countryByStoreId: stores,
      }),
    ).toBeNull()
  })
})
```

Note the third test: `b` has a store, so `allCustom` is false, so the first stocked line (`a`, custom) yields no store id... and the *next* stocked line is `b`. The expectation `'NZ'` encodes that we take the first stocked line **that has a store**. Implement exactly that — it is what makes a mixed cart resolve at all, and v1 rejects mixed custom/store carts at the API anyway.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/checkout/ship-country.test.ts`
Expected: FAIL — cannot find module `./ship-country`.

- [ ] **Step 3: Implement**

Create `lib/checkout/ship-country.ts`:

```ts
export interface ShipCountryLine {
  lineId: string
  fulfilmentType?: 'stocked' | 'made_to_order'
}

/**
 * The order's ship-to country, mirroring the server's single-shipping-address
 * resolution in submit.ts: the one-time address when EVERY line ships custom,
 * otherwise the first STOCKED line's store.
 *
 * Stocked-first, not cart-first: F1 submits the stocked partition as its own
 * stock_on_hand order, so a made-to-order line sitting first in the cart must
 * not decide that order's region. This drives the NZ picking-fee gate, so
 * /checkout, /checkout/review, the Xero draft and the Monday billing note all
 * have to agree on it — hence one shared function rather than a copy per page.
 *
 * Returns null when it cannot be determined (no stocked line, unknown store, or
 * a store with no country recorded). Null fails the NZ gate, so the fee is 0 —
 * under-charging a fee is recoverable; quoting a fee we cannot justify is not.
 */
export function resolveShipCountry(input: {
  lines: ShipCountryLine[]
  perLineShipTo: Record<string, string | null>
  customAddressCountry: string | null | undefined
  countryByStoreId: Map<string, string | null>
}): string | null {
  if (input.lines.length === 0) return null

  const allCustom = input.lines.every((line) => input.perLineShipTo[line.lineId] === null)
  if (allCustom) return input.customAddressCountry ?? null

  for (const line of input.lines) {
    if (line.fulfilmentType !== 'stocked') continue
    const storeId = input.perLineShipTo[line.lineId]
    if (!storeId) continue
    return input.countryByStoreId.get(storeId) ?? null
  }
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/checkout/ship-country.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/checkout/ship-country.ts lib/checkout/ship-country.test.ts
git commit -m "feat(checkout): extract shared ship-to country resolution

The NZ picking-fee gate needs the ship-to country on both checkout pages; the
rule lived only on the review page. One function so the two pages cannot drift
on the gate this work exists to align."
```

---

## Task 5: The shared billing module

The heart of the work. One pure function that answers "what will this cart actually be invoiced?" — called by both checkout pages so the number the customer agrees to is the number that reaches Xero.

**Files:**
- Create: `lib/pricing/order-billing-shape.ts`
- Test: `lib/pricing/order-billing-shape.test.ts`

**Interfaces:**
- Consumes: `partitionByFulfilment`, `CheckoutOrderType` (Task 2); `isPrepaidDrawn` (Task 3); `orderPickingFee` from `lib/pricing/order-picking-fee.ts`; `round2` from `lib/pricing/pricingMath.ts`; `BillingMode`; `CartLineFulfilmentType`.
- Produces: `billedOrderShape(input: { lines: BilledLineInput[]; gstRate: number; shipCountry: string | null | undefined }): BilledOrderShape`, plus exported types `BilledLineInput`, `BilledLine`, `BilledPartition`, `BilledOrderShape` and the helper `allInUnitPriceOf(line: BilledLineInput): number`. Tasks 6, 10, 11 and 12 consume these.

- [ ] **Step 1: Write the failing test**

Create `lib/pricing/order-billing-shape.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { billedOrderShape, type BilledLineInput } from './order-billing-shape'

function line(over: Partial<BilledLineInput> = {}): BilledLineInput {
  return {
    lineId: 'l1',
    qty: 120,
    unitPrice: 12.21,
    decorationPerUnit: 0,
    fulfilmentType: 'stocked',
    billingMode: 'prepaid',
    ...over,
  }
}

const NZ = { gstRate: 0.15, shipCountry: 'NZ' as string | null }

describe('billedOrderShape — zeroing', () => {
  // Chris's exact case: 120 x Staple Tee @ $12.21 drawn from prepaid stock.
  it('zeroes a prepaid stock draw and bills only the picking fee', () => {
    const shape = billedOrderShape({ lines: [line()], ...NZ })
    expect(shape.partitions).toHaveLength(1)
    const p = shape.partitions[0]
    expect(p.orderType).toBe('stock_on_hand')
    expect(p.lines[0].billed).toBe(false)
    expect(p.lines[0].billedUnitPrice).toBe(0)
    expect(p.lines[0].goodsValue).toBe(1465.2)
    expect(p.billedSubtotal).toBe(0)
    expect(p.prepaidGoodsValue).toBe(1465.2)
    expect(p.goodsValueForBand).toBe(1465.2)
    expect(p.pickingFee).toBe(15)
    expect(p.gst).toBe(2.25)
    expect(p.total).toBe(17.25)
    expect(shape.grandTotal).toBe(17.25)
    expect(shape.invoiceCount).toBe(1)
  })

  // The `nature` defect, now in money terms.
  it('CHARGES a made-to-order line of a prepaid variant', () => {
    const shape = billedOrderShape({
      lines: [line({ fulfilmentType: 'made_to_order', qty: 10, unitPrice: 20 })],
      ...NZ,
    })
    const p = shape.partitions[0]
    expect(p.orderType).toBe('purchase_order')
    expect(p.lines[0].billed).toBe(true)
    expect(p.lines[0].billedUnitPrice).toBe(20)
    expect(p.billedSubtotal).toBe(200)
    expect(p.prepaidGoodsValue).toBe(0)
  })

  it('charges a stocked line that is not prepaid', () => {
    const shape = billedOrderShape({
      lines: [line({ billingMode: 'invoice_on_dispatch', qty: 10, unitPrice: 50 })],
      ...NZ,
    })
    const p = shape.partitions[0]
    expect(p.lines[0].billed).toBe(true)
    expect(p.billedSubtotal).toBe(500)
    expect(p.pickingFee).toBe(15) // stock_on_hand order — fee applies as it does today
    expect(p.total).toBe(592.25) // 500 + 15 + 77.25
  })

  it('fails closed on a null billing mode (legacy line)', () => {
    const shape = billedOrderShape({
      lines: [line({ billingMode: null, qty: 10, unitPrice: 50 })],
      ...NZ,
    })
    expect(shape.partitions[0].lines[0].billed).toBe(true)
    expect(shape.partitions[0].billedSubtotal).toBe(500)
  })

  it('folds decoration into the all-in unit price', () => {
    const shape = billedOrderShape({
      lines: [line({ billingMode: 'invoice_on_dispatch', qty: 10, unitPrice: 20, decorationPerUnit: 5 })],
      ...NZ,
    })
    expect(shape.partitions[0].lines[0].goodsValue).toBe(250)
    expect(shape.partitions[0].billedSubtotal).toBe(250)
  })
})

describe('billedOrderShape — GST', () => {
  it('excludes prepaid goods from GST (GST rides on fee only)', () => {
    const shape = billedOrderShape({ lines: [line()], ...NZ })
    expect(shape.partitions[0].gst).toBe(2.25) // 15 * 0.15 — NOT (1465.20 + 15) * 0.15
  })

  it('applies GST to billed goods plus fee', () => {
    const shape = billedOrderShape({
      lines: [line({ billingMode: 'invoice_on_dispatch', qty: 10, unitPrice: 50 })],
      ...NZ,
    })
    expect(shape.partitions[0].gst).toBe(77.25) // (500 + 15) * 0.15
  })
})

describe('billedOrderShape — picking-fee band basis (D2)', () => {
  // D2 is only observable at a band boundary. Without pre-zeroing banding, a
  // prepaid order's goods read $0 and EVERY prepaid order would land in the
  // $0-99 band at $35 instead of its real band.
  it('bands on FULL goods, pre-zeroing — not on the billed $0', () => {
    const shape = billedOrderShape({ lines: [line()], ...NZ })
    expect(shape.partitions[0].goodsValueForBand).toBe(1465.2)
    expect(shape.partitions[0].pickingFee).toBe(15) // $400+ band, NOT the $35 of a $0 order
  })

  it.each([
    [99.99, 35],
    [100, 30],
    [199.99, 30],
    [200, 25],
    [299.99, 25],
    [300, 20],
    [399.99, 20],
    [400, 15],
  ])('goods %s -> fee %s at the band edge', (goods, fee) => {
    const shape = billedOrderShape({
      lines: [line({ qty: 1, unitPrice: goods, billingMode: 'prepaid' })],
      ...NZ,
    })
    expect(shape.partitions[0].goodsValueForBand).toBe(goods)
    expect(shape.partitions[0].pickingFee).toBe(fee)
  })

  // The case that makes D2 a real decision rather than a formality: current
  // catalogue price and the original prepaid purchase price straddle a boundary.
  // 25 x $12.21 = $305.25 -> $20 band. Had we banded on the original $10.50
  // (25 x $10.50 = $262.50) it would be the $25 band. Current price wins.
  it('bands on current catalogue price where original and current differ', () => {
    const shape = billedOrderShape({
      lines: [line({ qty: 25, unitPrice: 12.21 })],
      ...NZ,
    })
    expect(shape.partitions[0].goodsValueForBand).toBe(305.25)
    expect(shape.partitions[0].pickingFee).toBe(20)
  })

  it('bands on EVERY line in the partition, prepaid or not', () => {
    const shape = billedOrderShape({
      lines: [
        line({ lineId: 'a', qty: 10, unitPrice: 20, billingMode: 'prepaid' }), // 200, zeroed
        line({ lineId: 'b', qty: 10, unitPrice: 25, billingMode: 'invoice_on_dispatch' }), // 250, billed
      ],
      ...NZ,
    })
    const p = shape.partitions[0]
    expect(p.goodsValueForBand).toBe(450) // both lines
    expect(p.billedSubtotal).toBe(250) // only the billed one
    expect(p.pickingFee).toBe(15) // $400+ band off 450
  })
})

describe('billedOrderShape — region gate', () => {
  it.each([['Australia'], ['United States'], [''], [null]])(
    'no fee for a non-NZ ship-to (%s)',
    (shipCountry) => {
      const shape = billedOrderShape({
        lines: [line({ billingMode: 'invoice_on_dispatch' })],
        gstRate: 0.15,
        shipCountry: shipCountry as string | null,
      })
      expect(shape.partitions[0].pickingFee).toBe(0)
    },
  )
})

describe('billedOrderShape — mixed cart (D3)', () => {
  const mixed = () =>
    billedOrderShape({
      lines: [
        line({ lineId: 'tee', qty: 120, unitPrice: 12.21, fulfilmentType: 'stocked', billingMode: 'prepaid' }),
        line({
          lineId: 'hoodie',
          qty: 50,
          unitPrice: 40,
          fulfilmentType: 'made_to_order',
          billingMode: 'invoice_on_dispatch',
        }),
      ],
      ...NZ,
    })

  it('splits into two partitions, purchase_order first', () => {
    expect(mixed().partitions.map((p) => p.orderType)).toEqual(['purchase_order', 'stock_on_hand'])
    expect(mixed().invoiceCount).toBe(2)
  })

  it('gives the purchase order no picking fee', () => {
    const po = mixed().partitions[0]
    expect(po.pickingFee).toBe(0)
    expect(po.billedSubtotal).toBe(2000)
    expect(po.gst).toBe(300)
    expect(po.total).toBe(2300)
  })

  it('gives the stock order its own fee and total', () => {
    const stock = mixed().partitions[1]
    expect(stock.pickingFee).toBe(15)
    expect(stock.billedSubtotal).toBe(0)
    expect(stock.total).toBe(17.25)
  })

  it('sums to the grand total across both orders', () => {
    expect(mixed().grandTotal).toBe(2317.25)
    expect(mixed().billedSubtotal).toBe(2000)
  })
})

describe('billedOrderShape — edges', () => {
  it('returns an empty shape for an empty cart', () => {
    expect(billedOrderShape({ lines: [], ...NZ })).toEqual({
      partitions: [],
      grandTotal: 0,
      billedSubtotal: 0,
      invoiceCount: 0,
      gstRate: 0.15,
    })
  })

  it('treats an absent fulfilmentType as a purchase order (never zeroed)', () => {
    const shape = billedOrderShape({
      lines: [line({ fulfilmentType: undefined, qty: 10, unitPrice: 20 })],
      ...NZ,
    })
    expect(shape.partitions[0].orderType).toBe('purchase_order')
    expect(shape.partitions[0].lines[0].billed).toBe(true)
  })

  it('treats a negative decoration figure as 0', () => {
    const shape = billedOrderShape({
      lines: [line({ billingMode: 'invoice_on_dispatch', qty: 1, unitPrice: 100, decorationPerUnit: -5 })],
      ...NZ,
    })
    expect(shape.partitions[0].lines[0].goodsValue).toBe(100)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/pricing/order-billing-shape.test.ts`
Expected: FAIL — cannot find module `./order-billing-shape`.

- [ ] **Step 3: Implement**

Create `lib/pricing/order-billing-shape.ts`:

```ts
import { partitionByFulfilment, type CheckoutOrderType } from '@/lib/checkout/partition'
import { isPrepaidDrawn } from '@/lib/shop/prepaid-tag'
import type { BillingMode } from '@/lib/shop/billing-mode'
import type { CartLineFulfilmentType } from '@/lib/cart/types'
import { orderPickingFee } from './order-picking-fee'
import { round2 } from './pricingMath'

export interface BilledLineInput {
  /** Stable cart line id — how a caller maps a shaped line back to its own row. */
  lineId: string
  qty: number
  /** Garment unit price, ex decoration (CartLine.unitPrice). */
  unitPrice: number
  /** Folded decoration per garment (lib/cart/types decorationPerUnit). */
  decorationPerUnit: number
  /** The CHOSEN mode. Absent (legacy line) → purchase order, never zeroed. */
  fulfilmentType?: CartLineFulfilmentType
  /** FRESH variant billing mode. null → invoice_on_dispatch (fail closed). */
  billingMode: BillingMode | null
}

export interface BilledLine extends BilledLineInput {
  /** false ⇒ a prepaid stock draw: already paid for, invoiced at $0. */
  billed: boolean
  /** The all-in unit price as invoiced: 0 when !billed. */
  billedUnitPrice: number
  /**
   * qty × all-in unit price at CURRENT catalogue price. ALWAYS the full value,
   * billed or not — it drives both the struck-through display figure and the
   * picking-fee band (D2).
   */
  goodsValue: number
}

export interface BilledPartition {
  orderType: CheckoutOrderType
  lines: BilledLine[]
  /**
   * Full goods value of EVERY line in this partition, pre-zeroing — the
   * picking-fee band basis (D2: the ordering event, at current catalogue price).
   * Per-partition, because the server bands each submitted order separately.
   */
  goodsValueForBand: number
  /** Goods actually invoiced. Prepaid draws contribute 0. */
  billedSubtotal: number
  /**
   * Goods NOT invoiced because they were drawn from prepaid stock. Rendered as
   * "Drawn from pre-paid stock": once the goods line reads $0 this is the only
   * place goodsValueForBand appears, and without it the customer cannot derive
   * why the fee is $15 rather than $35.
   */
  prepaidGoodsValue: number
  pickingFee: number
  gst: number
  total: number
}

export interface BilledOrderShape {
  partitions: BilledPartition[]
  /** Sum of every partition total, inc GST. What the customer pays. */
  grandTotal: number
  /** Sum of every partition's billedSubtotal, ex-GST. The deposit basis. */
  billedSubtotal: number
  /** One Xero quote per partition. 2 ⇒ "You'll receive 2 invoices." */
  invoiceCount: number
  /** Echoed back so the UI can label the GST row without a second source. */
  gstRate: number
}

/** Customer-facing all-in unit price: garment plus any folded decoration. */
export function allInUnitPriceOf(line: BilledLineInput): number {
  const deco = Number.isFinite(line.decorationPerUnit) ? Math.max(0, line.decorationPerUnit) : 0
  return line.unitPrice + deco
}

/**
 * The billed shape of a checkout cart: what each line is invoiced at, how the
 * cart splits into orders, and each order's fee, GST and total.
 *
 * Single source of truth for the customer-facing billed figures, shared by
 * /checkout and /checkout/review so the number the customer agrees to is the
 * number that reaches the Xero draft. Same rationale as order-picking-fee.ts,
 * one layer up.
 *
 * This PREDICTS the server; it is not the authority. submit.ts re-resolves
 * billing modes from variant_inventory and draft-invoice.ts still gates zeroing
 * on qty_from_stock > 0. Prediction is safe because the PDP caps a stock-on-hand
 * line at available stock and the no-partial-draw rule turns a short prepaid
 * order into a separate MOQ purchase order — so 'stocked' implies the line draws
 * its FULL quantity. A stock race between cart and submit is already caught by
 * the existing OUT_OF_STOCK 409.
 *
 * Rounding mirrors computeOrderBreakdown: round each line, then round the sum.
 */
export function billedOrderShape(input: {
  lines: BilledLineInput[]
  gstRate: number
  shipCountry: string | null | undefined
}): BilledOrderShape {
  const partitions = partitionByFulfilment(
    input.lines,
    (line) => line.fulfilmentType === 'stocked',
  ).map(({ orderType, lines }): BilledPartition => {
    const shaped = lines.map((line): BilledLine => {
      const billed = !isPrepaidDrawn(line.fulfilmentType, line.billingMode)
      const allIn = allInUnitPriceOf(line)
      return {
        ...line,
        billed,
        billedUnitPrice: billed ? allIn : 0,
        goodsValue: round2(line.qty * allIn),
      }
    })

    const goodsValueForBand = round2(shaped.reduce((total, l) => total + l.goodsValue, 0))
    const billedSubtotal = round2(
      shaped.reduce((total, l) => (l.billed ? total + l.goodsValue : total), 0),
    )
    const prepaidGoodsValue = round2(
      shaped.reduce((total, l) => (l.billed ? total : total + l.goodsValue), 0),
    )
    // Only a stock_on_hand order can carry a fee; a purchase order always gets 0.
    const pickingFee = orderPickingFee({
      isStockOnHand: orderType === 'stock_on_hand',
      shipCountry: input.shipCountry,
      goodsSubtotal: goodsValueForBand,
    })
    const gst = round2((billedSubtotal + pickingFee) * input.gstRate)

    return {
      orderType,
      lines: shaped,
      goodsValueForBand,
      billedSubtotal,
      prepaidGoodsValue,
      pickingFee,
      gst,
      total: round2(billedSubtotal + pickingFee + gst),
    }
  })

  return {
    partitions,
    grandTotal: round2(partitions.reduce((total, p) => total + p.total, 0)),
    billedSubtotal: round2(partitions.reduce((total, p) => total + p.billedSubtotal, 0)),
    invoiceCount: partitions.length,
    gstRate: input.gstRate,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/pricing/order-billing-shape.test.ts`
Expected: PASS — all tests, including every band-edge case.

- [ ] **Step 5: Commit**

```bash
git add lib/pricing/order-billing-shape.ts lib/pricing/order-billing-shape.test.ts
git commit -m "feat(pricing): add billedOrderShape — the shared billed-figure module

One pure function answering 'what will this cart be invoiced?': prepaid stock
draws at \$0, per-partition picking fee banded on FULL goods pre-zeroing (D2),
GST on billed goods + fee only.

Predicts the server; does not replace it. submit.ts still re-resolves billing
modes and draft-invoice.ts still gates zeroing on qty_from_stock."
```

---

## Task 6: The Xero parity test

The most valuable test in this plan. It is the regression that would have caught the original defect: it fails the moment checkout and the Xero draft disagree about a prepaid order.

Compares **ex-GST** figures (`billedSubtotal + pickingFee` vs the sum of Xero line amounts) because Xero applies tax itself — that is the honest comparison.

**Files:**
- Create: `lib/pricing/order-billing-shape.xero-parity.test.ts`

**Interfaces:**
- Consumes: `billedOrderShape` (Task 5); `buildDraftLines`, `buildPickFeeLine` from `lib/xero/draft-invoice.ts` (unchanged).
- Produces: nothing.

- [ ] **Step 1: Write the test**

Create `lib/pricing/order-billing-shape.xero-parity.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { billedOrderShape, type BilledLineInput } from './order-billing-shape'
import { buildDraftLines, buildPickFeeLine } from '@/lib/xero/draft-invoice'

/**
 * Parity: what checkout shows must equal what Xero drafts.
 *
 * This is the regression that would have caught the original defect — checkout
 * quoting $1,684.98 on an order Xero drafts at $17.25. It compares the ex-GST
 * figures because Xero applies tax itself: shape.billedSubtotal + pickingFee
 * against the sum of the draft's line amounts.
 *
 * The two sides reach the answer by genuinely different routes. The shape zeroes
 * on (fulfilmentType === 'stocked' && billingMode === 'prepaid') from cart data;
 * buildDraftLines zeroes on (qty_from_stock > 0 && key ∈ prepaidDrawnLineKeys)
 * from persisted quote_items. If those two ever stop agreeing, this fails.
 */

interface Fixture {
  cart: BilledLineInput
  /** The persisted quote_item the same line becomes. unit_price is all-in
   *  (submit.ts folds decoration in before the RPC). */
  xero: {
    product_id: string
    variant_id: string | null
    size_id: number | null
    qty_from_stock: number
    product_name: string
    quantity: number
    unit_price: number
    size_label: string | null
    decorations: null
    product_variants: null
  }
  /** True iff the variant is prepaid — feeds prepaidDrawnLineKeys. */
  prepaidVariant: boolean
}

function fixture(over: {
  lineId: string
  productId: string
  variantId: string
  qty: number
  allInUnitPrice: number
  fulfilmentType: 'stocked' | 'made_to_order'
  prepaidVariant: boolean
}): Fixture {
  return {
    cart: {
      lineId: over.lineId,
      qty: over.qty,
      unitPrice: over.allInUnitPrice,
      decorationPerUnit: 0,
      fulfilmentType: over.fulfilmentType,
      billingMode: over.prepaidVariant ? 'prepaid' : 'invoice_on_dispatch',
    },
    xero: {
      product_id: over.productId,
      variant_id: over.variantId,
      size_id: null,
      // The server's draw signal: a stocked line draws its full qty (no partial
      // draws); a made-to-order line draws none.
      qty_from_stock: over.fulfilmentType === 'stocked' ? over.qty : 0,
      product_name: over.lineId,
      quantity: over.qty,
      unit_price: over.allInUnitPrice,
      size_label: null,
      decorations: null,
      product_variants: null,
    },
    prepaidVariant: over.prepaidVariant,
  }
}

function xeroExGstTotal(fixtures: Fixture[], pickingFee: number): number {
  const prepaidDrawnLineKeys = new Set(
    fixtures
      .filter((f) => f.prepaidVariant)
      .map((f) => `${f.xero.product_id}::${f.xero.variant_id ?? ''}::${f.xero.size_id ?? ''}`),
  )
  const lines = buildDraftLines(
    fixtures.map((f) => f.xero),
    prepaidDrawnLineKeys,
  )
  if (pickingFee > 0) lines.push(buildPickFeeLine(pickingFee))
  return Math.round(lines.reduce((t, l) => t + l.quantity * l.unitAmount, 0) * 100) / 100
}

function assertParity(fixtures: Fixture[], shipCountry: string | null) {
  const shape = billedOrderShape({
    lines: fixtures.map((f) => f.cart),
    gstRate: 0.15,
    shipCountry,
  })
  // One Xero quote per partition, so compare per partition.
  for (const partition of shape.partitions) {
    const ids = new Set(partition.lines.map((l) => l.lineId))
    const mine = fixtures.filter((f) => ids.has(f.cart.lineId))
    expect(xeroExGstTotal(mine, partition.pickingFee)).toBe(
      Math.round((partition.billedSubtotal + partition.pickingFee) * 100) / 100,
    )
  }
  return shape
}

describe('checkout <-> Xero draft parity', () => {
  it('agrees on a prepaid stock draw (the original defect)', () => {
    const shape = assertParity(
      [
        fixture({
          lineId: 'tee',
          productId: 'p1',
          variantId: 'v1',
          qty: 120,
          allInUnitPrice: 12.21,
          fulfilmentType: 'stocked',
          prepaidVariant: true,
        }),
      ],
      'NZ',
    )
    // Pin the actual numbers so a future change to BOTH sides in lockstep still
    // has to be deliberate.
    expect(shape.partitions[0].billedSubtotal).toBe(0)
    expect(shape.partitions[0].pickingFee).toBe(15)
  })

  it('agrees on a non-prepaid stock order', () => {
    assertParity(
      [
        fixture({
          lineId: 'tee',
          productId: 'p1',
          variantId: 'v1',
          qty: 10,
          allInUnitPrice: 50,
          fulfilmentType: 'stocked',
          prepaidVariant: false,
        }),
      ],
      'NZ',
    )
  })

  it('agrees on a prepaid variant ordered made-to-order (charged both sides)', () => {
    const shape = assertParity(
      [
        fixture({
          lineId: 'hoodie',
          productId: 'p2',
          variantId: 'v2',
          qty: 10,
          allInUnitPrice: 40,
          fulfilmentType: 'made_to_order',
          prepaidVariant: true,
        }),
      ],
      'NZ',
    )
    expect(shape.partitions[0].billedSubtotal).toBe(400)
  })

  it('agrees on a mixed cart, per partition', () => {
    const shape = assertParity(
      [
        fixture({
          lineId: 'tee',
          productId: 'p1',
          variantId: 'v1',
          qty: 120,
          allInUnitPrice: 12.21,
          fulfilmentType: 'stocked',
          prepaidVariant: true,
        }),
        fixture({
          lineId: 'hoodie',
          productId: 'p2',
          variantId: 'v2',
          qty: 50,
          allInUnitPrice: 40,
          fulfilmentType: 'made_to_order',
          prepaidVariant: false,
        }),
      ],
      'NZ',
    )
    expect(shape.invoiceCount).toBe(2)
  })

  it('agrees on a non-NZ order (no fee either side)', () => {
    assertParity(
      [
        fixture({
          lineId: 'tee',
          productId: 'p1',
          variantId: 'v1',
          qty: 120,
          allInUnitPrice: 12.21,
          fulfilmentType: 'stocked',
          prepaidVariant: true,
        }),
      ],
      'Australia',
    )
  })
})
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run lib/pricing/order-billing-shape.xero-parity.test.ts`
Expected: PASS — 5 tests. This one passes on first write because Tasks 3 and 5 already aligned the two sides; it exists to *stay* passing.

- [ ] **Step 3: Prove the test actually bites**

Temporarily break the zeroing predicate in `lib/pricing/order-billing-shape.ts` — change `const billed = !isPrepaidDrawn(...)` to `const billed = true`.

Run: `npx vitest run lib/pricing/order-billing-shape.xero-parity.test.ts`
Expected: FAIL on "agrees on a prepaid stock draw" — `expected 15 to be 1480.2`. That is the original defect being caught.

**Revert the change** and re-run to confirm PASS. A parity test that cannot fail is worse than no test — it is a false assurance.

- [ ] **Step 4: Commit**

```bash
git add lib/pricing/order-billing-shape.xero-parity.test.ts
git commit -m "test(pricing): assert checkout <-> Xero draft parity

The regression that would have caught the original defect: checkout quoting
\$1,684.98 on an order Xero drafts at \$17.25. Compares ex-GST figures per
partition, with the two sides reaching the answer by different routes (cart
billingMode vs persisted qty_from_stock)."
```

---

## Task 7: `GET /api/checkout/billing-modes`

The cart's `billingMode` snapshot is taken on the PDP and can be days stale. Once goods render $0, a stale snapshot means showing $17.25 on an order we would invoice at $1,684.98. This endpoint is the fresh read.

**Files:**
- Create: `app/api/checkout/billing-modes/route.ts`
- Test: `app/api/checkout/__tests__/billing-modes.test.ts`

**Interfaces:**
- Consumes: `requireB2BCustomerApi` from `lib/checkout/server.ts`; `resolveLineBillingModes` from `lib/checkout/resolve-line-billing-modes.ts` (both unchanged).
- Produces: `GET /api/checkout/billing-modes?variant_ids=<comma-separated uuids>` → `200 { modeByVariantId: Record<string, 'prepaid' | 'invoice_on_dispatch'> }`. Task 8 calls it.

- [ ] **Step 1: Write the failing test**

Create `app/api/checkout/__tests__/billing-modes.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const requireB2BCustomerApi = vi.fn()
const resolveLineBillingModes = vi.fn()

vi.mock('@/lib/checkout/server', () => ({
  requireB2BCustomerApi: (...args: unknown[]) => requireB2BCustomerApi(...args),
}))
vi.mock('@/lib/checkout/resolve-line-billing-modes', () => ({
  resolveLineBillingModes: (...args: unknown[]) => resolveLineBillingModes(...args),
}))

const { GET } = await import('../billing-modes/route')

const admin = {} as never

beforeEach(() => {
  vi.clearAllMocks()
  requireB2BCustomerApi.mockResolvedValue({
    admin,
    context: { organizationId: 'org-1' },
  })
  resolveLineBillingModes.mockResolvedValue(new Map([['v1', 'prepaid']]))
})

function req(qs: string) {
  return new Request(`http://localhost/api/checkout/billing-modes${qs}`)
}

describe('GET /api/checkout/billing-modes', () => {
  it('returns the fresh mode map for the requested variants', async () => {
    const res = await GET(req('?variant_ids=v1,v2'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ modeByVariantId: { v1: 'prepaid' } })
  })

  it('scopes the read to the CALLER org, never a client-supplied one', async () => {
    await GET(req('?variant_ids=v1&organization_id=someone-else'))
    expect(resolveLineBillingModes).toHaveBeenCalledWith(admin, 'org-1', ['v1'])
  })

  it('dedupes and trims the variant ids', async () => {
    await GET(req('?variant_ids=v1,%20v1%20,v2,'))
    expect(resolveLineBillingModes).toHaveBeenCalledWith(admin, 'org-1', ['v1', 'v2'])
  })

  it('returns an empty map for no variant ids without hitting the DB', async () => {
    const res = await GET(req(''))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ modeByVariantId: {} })
    expect(resolveLineBillingModes).not.toHaveBeenCalled()
  })

  it('rejects an over-long variant list rather than issuing an unbounded IN', async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `v${i}`).join(',')
    const res = await GET(req(`?variant_ids=${ids}`))
    expect(res.status).toBe(400)
    expect(resolveLineBillingModes).not.toHaveBeenCalled()
  })

  it('propagates the auth failure response', async () => {
    const error = new Response(null, { status: 401 })
    requireB2BCustomerApi.mockResolvedValue({ error })
    expect(await GET(req('?variant_ids=v1'))).toBe(error)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/api/checkout/__tests__/billing-modes.test.ts`
Expected: FAIL — cannot find module `../billing-modes/route`.

- [ ] **Step 3: Implement**

Create `app/api/checkout/billing-modes/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { requireB2BCustomerApi } from '@/lib/checkout/server'
import { resolveLineBillingModes } from '@/lib/checkout/resolve-line-billing-modes'

/**
 * Bound on one request's variant list. A checkout cart never approaches this;
 * the cap exists so a hand-rolled URL cannot turn one GET into an unbounded
 * IN (...) against variant_inventory.
 */
const MAX_VARIANT_IDS = 200

/**
 * Fresh per-variant billing modes for the caller's org.
 *
 * The cart's billingMode is snapshotted on the PDP and can be days stale. Once
 * checkout renders prepaid goods at $0, a stale snapshot means quoting $17.25 on
 * an order we would invoice at $1,684.98 — so the money renders from this, never
 * from the cart.
 *
 * Org scope comes from the session, never from the query string. Uses the same
 * resolveLineBillingModes as submit, so the fresh read and the authoritative
 * read cannot diverge.
 */
export async function GET(request: Request) {
  const auth = await requireB2BCustomerApi()
  if ('error' in auth) return auth.error

  const raw = new URL(request.url).searchParams.get('variant_ids') ?? ''
  const variantIds = Array.from(
    new Set(
      raw
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0),
    ),
  )

  if (variantIds.length === 0) {
    return NextResponse.json({ modeByVariantId: {} })
  }
  if (variantIds.length > MAX_VARIANT_IDS) {
    return NextResponse.json(
      { error: `At most ${MAX_VARIANT_IDS} variant_ids per request` },
      { status: 400 },
    )
  }

  const modes = await resolveLineBillingModes(
    auth.admin,
    auth.context.organizationId,
    variantIds,
  )
  return NextResponse.json({ modeByVariantId: Object.fromEntries(modes) })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/api/checkout/__tests__/billing-modes.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add app/api/checkout/billing-modes/route.ts app/api/checkout/__tests__/billing-modes.test.ts
git commit -m "feat(checkout): add GET /api/checkout/billing-modes

Fresh org-scoped variant billing modes so checkout renders \$0 from live data,
not from a cart snapshot that can be days old. Reuses submit's own
resolveLineBillingModes; org scope comes from the session, never the query."
```

---

## Task 8: `useFreshBillingModes` hook

**Files:**
- Create: `components/checkout/useFreshBillingModes.ts`

**Interfaces:**
- Consumes: `GET /api/checkout/billing-modes` (Task 7); `BillingMode`.
- Produces: `useFreshBillingModes(lines: Array<{ variantId: string }>, enabled?: boolean): { modeByVariantId: Record<string, BillingMode>; status: 'loading' | 'ready' | 'error' }`. Tasks 11 and 12 call it.

- [ ] **Step 1: Implement**

Modelled on the existing `components/cart/useCartLineFrontImages.ts` (same abort/effect shape).

Create `components/checkout/useFreshBillingModes.ts`:

```ts
'use client'

import { useEffect, useMemo, useState } from 'react'
import type { BillingMode } from '@/lib/shop/billing-mode'

const EMPTY_MODES: Record<string, BillingMode> = {}

export type FreshBillingModesStatus = 'loading' | 'ready' | 'error'

/**
 * Fresh per-variant billing modes for the cart.
 *
 * The cart's own billingMode is a PDP snapshot and can be days stale. Because
 * checkout now renders prepaid goods at $0, the money must come from here.
 *
 * Fail-closed by construction: on fetch failure the map is left EMPTY, so every
 * line resolves to a null mode and bills at full price. That over-quotes a
 * prepaid customer, which is recoverable; under-quoting is not. The submit-time
 * `claimed_billing_mode` 409 catches genuine drift either way.
 *
 * `status` lets callers hold the total back for the sub-second fetch rather than
 * flashing a wrong number. 'error' is still a usable, fail-closed answer — hence
 * separate from 'loading'.
 */
export function useFreshBillingModes(
  lines: Array<{ variantId: string }>,
  enabled = true,
): { modeByVariantId: Record<string, BillingMode>; status: FreshBillingModesStatus } {
  const variantIds = useMemo(
    () =>
      Array.from(
        new Set(lines.map((line) => line.variantId).filter((id) => id.length > 0)),
      ).sort(),
    [lines],
  )
  const query = useMemo(() => variantIds.join(','), [variantIds])
  const [modeByVariantId, setModeByVariantId] = useState<Record<string, BillingMode>>({})
  const [status, setStatus] = useState<FreshBillingModesStatus>('loading')

  useEffect(() => {
    if (!enabled || query.length === 0) {
      setModeByVariantId({})
      setStatus('ready')
      return
    }

    const controller = new AbortController()
    setStatus('loading')

    fetch(`/api/checkout/billing-modes?variant_ids=${encodeURIComponent(query)}`, {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data: { modeByVariantId?: Record<string, BillingMode> }) => {
        if (controller.signal.aborted) return
        setModeByVariantId(data?.modeByVariantId ?? {})
        setStatus('ready')
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        if ((error as { name?: string })?.name === 'AbortError') return
        // Fail closed: empty map ⇒ every line bills at full price.
        setModeByVariantId({})
        setStatus('error')
      })

    return () => controller.abort()
  }, [enabled, query])

  return {
    modeByVariantId: enabled && query.length > 0 ? modeByVariantId : EMPTY_MODES,
    status,
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/checkout/useFreshBillingModes.ts
git commit -m "feat(checkout): add useFreshBillingModes hook

Fail-closed fresh read of variant billing modes: on error the map stays empty,
so every line bills at full price. Exposes status so callers can hold the total
back for the fetch rather than flashing a wrong number."
```

---

## Task 9: `PrepaidLinePrice` — the badge and the struck-through price

Both checkout pages must render `$1,465.20 → $0.00` and the "Pre-paid" badge identically. One component, two call sites.

**Files:**
- Create: `components/checkout/PrepaidLinePrice.tsx`
- Test: `components/checkout/PrepaidLinePrice.test.tsx`

**Interfaces:**
- Consumes: nothing but props.
- Produces: `PrepaidBadge()` and `PrepaidLinePrice({ goodsValue, billed, format }: { goodsValue: number; billed: boolean; format: (n: number) => string })`. Tasks 11 and 12 use both.

- [ ] **Step 1: Write the failing test**

Create `components/checkout/PrepaidLinePrice.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PrepaidBadge, PrepaidLinePrice } from './PrepaidLinePrice'

const format = (n: number) => `$${n.toFixed(2)}`

describe('PrepaidLinePrice', () => {
  it('shows the goods value struck through, then $0.00, when not billed', () => {
    render(<PrepaidLinePrice goodsValue={1465.2} billed={false} format={format} />)
    const struck = screen.getByText('$1465.20')
    expect(struck).toBeInTheDocument()
    expect(struck.tagName).toBe('S')
    expect(screen.getByText('$0.00')).toBeInTheDocument()
  })

  it('shows only the goods value when billed', () => {
    render(<PrepaidLinePrice goodsValue={2000} billed format={format} />)
    expect(screen.getByText('$2000.00')).toBeInTheDocument()
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument()
  })

  it('explains the strike-through to screen readers', () => {
    render(<PrepaidLinePrice goodsValue={1465.2} billed={false} format={format} />)
    // A bare <s> conveys nothing without sight; the reason has to be in the DOM.
    expect(screen.getByText(/drawn from pre-paid stock/i)).toBeInTheDocument()
  })
})

describe('PrepaidBadge', () => {
  it('renders the Pre-paid label', () => {
    render(<PrepaidBadge />)
    expect(screen.getByText('Pre-paid')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/checkout/PrepaidLinePrice.test.tsx`
Expected: FAIL — cannot find module `./PrepaidLinePrice`.

- [ ] **Step 3: Implement**

Create `components/checkout/PrepaidLinePrice.tsx`:

```tsx
/**
 * The customer's "this line costs nothing" signal, in one place so /checkout and
 * /checkout/review cannot render it differently.
 *
 * `billed` must come from the billed shape (lib/pricing/order-billing-shape),
 * never from a local guess — the badge and the money are the same predicate by
 * construction (isPrepaidDrawn), and that is the point.
 */
export function PrepaidBadge() {
  return (
    <span className="mt-1 inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
      Pre-paid
    </span>
  )
}

export function PrepaidLinePrice({
  goodsValue,
  billed,
  format,
}: {
  /** Full goods value at current catalogue price — always shown. */
  goodsValue: number
  /** false ⇒ prepaid stock draw: struck through, invoiced at $0. */
  billed: boolean
  format: (nzdAmount: number) => string
}) {
  if (billed) {
    return <span className="font-semibold tabular-nums text-gray-900">{format(goodsValue)}</span>
  }
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <s className="tabular-nums text-gray-400">{format(goodsValue)}</s>
      <span aria-hidden="true" className="text-gray-400">
        →
      </span>
      <span className="font-semibold tabular-nums text-gray-900">{format(0)}</span>
      <span className="sr-only">— drawn from pre-paid stock, no charge</span>
    </span>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/checkout/PrepaidLinePrice.test.tsx`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add components/checkout/PrepaidLinePrice.tsx components/checkout/PrepaidLinePrice.test.tsx
git commit -m "feat(checkout): add PrepaidLinePrice + PrepaidBadge

One component for the '\$1,465.20 -> \$0.00' line and the Pre-paid badge, so both
checkout pages render the prepaid signal identically. Strike-through carries an
sr-only explanation."
```

---

## Task 10: `BilledOrderSummary` — partition groups, per-order totals, breakdown

Owns the *structure* of the billed shape. The pages own what a line row looks like and pass it in via `renderLine`.

**Files:**
- Create: `components/checkout/BilledOrderSummary.tsx`
- Test: `components/checkout/BilledOrderSummary.test.tsx`

**Interfaces:**
- Consumes: `BilledOrderShape`, `BilledLine`, `BilledPartition` (Task 5).
- Produces: `BilledOrderSummary({ shape, format, renderLine, defaultBreakdownOpen }: { shape: BilledOrderShape; format: (n: number) => string; renderLine: (line: BilledLine) => React.ReactNode; defaultBreakdownOpen?: boolean })`. Tasks 11 and 12 render it.

- [ ] **Step 1: Write the failing test**

Create `components/checkout/BilledOrderSummary.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BilledOrderSummary } from './BilledOrderSummary'
import { billedOrderShape, type BilledLineInput } from '@/lib/pricing/order-billing-shape'

const format = (n: number) =>
  `$${n.toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function line(over: Partial<BilledLineInput> = {}): BilledLineInput {
  return {
    lineId: 'tee',
    qty: 120,
    unitPrice: 12.21,
    decorationPerUnit: 0,
    fulfilmentType: 'stocked',
    billingMode: 'prepaid',
    ...over,
  }
}

const prepaidShape = () =>
  billedOrderShape({ lines: [line()], gstRate: 0.15, shipCountry: 'NZ' })

const mixedShape = () =>
  billedOrderShape({
    lines: [
      line(),
      line({
        lineId: 'hoodie',
        qty: 50,
        unitPrice: 40,
        fulfilmentType: 'made_to_order',
        billingMode: 'invoice_on_dispatch',
      }),
    ],
    gstRate: 0.15,
    shipCountry: 'NZ',
  })

const renderLine = (l: { lineId: string }) => <div data-testid={`row-${l.lineId}`}>{l.lineId}</div>

describe('BilledOrderSummary — single prepaid order', () => {
  it('shows the billed total, not the goods value', () => {
    render(
      <BilledOrderSummary shape={prepaidShape()} format={format} renderLine={renderLine} defaultBreakdownOpen />,
    )
    expect(screen.getByText('$17.25')).toBeInTheDocument()
    expect(screen.queryByText('$1,684.98')).not.toBeInTheDocument()
  })

  it('surfaces the banding figure — without it the fee is underivable', () => {
    render(
      <BilledOrderSummary shape={prepaidShape()} format={format} renderLine={renderLine} defaultBreakdownOpen />,
    )
    expect(screen.getByText('Drawn from pre-paid stock')).toBeInTheDocument()
    expect(screen.getByText('$1,465.20')).toBeInTheDocument()
  })

  it('labels prepaid goods and shows the picking fee and GST', () => {
    render(
      <BilledOrderSummary shape={prepaidShape()} format={format} renderLine={renderLine} defaultBreakdownOpen />,
    )
    expect(screen.getByText('Goods (pre-paid)')).toBeInTheDocument()
    expect(screen.getByText('Picking fee')).toBeInTheDocument()
    expect(screen.getByText('$15.00')).toBeInTheDocument()
    expect(screen.getByText('GST (15%)')).toBeInTheDocument()
    expect(screen.getByText('$2.25')).toBeInTheDocument()
  })

  it('renders the line row via renderLine', () => {
    render(<BilledOrderSummary shape={prepaidShape()} format={format} renderLine={renderLine} />)
    expect(screen.getByTestId('row-tee')).toBeInTheDocument()
  })

  it('shows no order-group headers for a single order', () => {
    render(<BilledOrderSummary shape={prepaidShape()} format={format} renderLine={renderLine} />)
    expect(screen.queryByText('Stock-on-hand order')).not.toBeInTheDocument()
    expect(screen.queryByText(/You'll receive/)).not.toBeInTheDocument()
  })
})

describe('BilledOrderSummary — mixed cart', () => {
  it('groups the lines under their order headings', () => {
    render(<BilledOrderSummary shape={mixedShape()} format={format} renderLine={renderLine} />)
    expect(screen.getByText('Purchase order')).toBeInTheDocument()
    expect(screen.getByText('Stock-on-hand order')).toBeInTheDocument()
    expect(screen.getByTestId('row-tee')).toBeInTheDocument()
    expect(screen.getByTestId('row-hoodie')).toBeInTheDocument()
  })

  it('shows a per-order total for each group', () => {
    render(<BilledOrderSummary shape={mixedShape()} format={format} renderLine={renderLine} />)
    expect(screen.getAllByText('Order total')).toHaveLength(2)
    expect(screen.getByText('$2,300.00')).toBeInTheDocument()
    expect(screen.getByText('$17.25')).toBeInTheDocument()
  })

  it('states the grand total and the invoice count', () => {
    render(<BilledOrderSummary shape={mixedShape()} format={format} renderLine={renderLine} />)
    expect(screen.getByText('Total across 2 orders')).toBeInTheDocument()
    expect(screen.getByText('$2,317.25')).toBeInTheDocument()
    expect(screen.getByText("You'll receive 2 invoices.")).toBeInTheDocument()
  })

  it('shows no picking fee on the purchase-order group', () => {
    render(<BilledOrderSummary shape={mixedShape()} format={format} renderLine={renderLine} />)
    // One fee row only — the stock order's.
    expect(screen.getAllByText('Picking fee')).toHaveLength(1)
  })
})

describe('BilledOrderSummary — non-prepaid order', () => {
  it('labels goods "Subtotal" and omits the prepaid row', () => {
    const shape = billedOrderShape({
      lines: [line({ billingMode: 'invoice_on_dispatch', qty: 10, unitPrice: 50 })],
      gstRate: 0.15,
      shipCountry: 'NZ',
    })
    render(<BilledOrderSummary shape={shape} format={format} renderLine={renderLine} defaultBreakdownOpen />)
    expect(screen.getByText('Subtotal')).toBeInTheDocument()
    expect(screen.queryByText('Drawn from pre-paid stock')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/checkout/BilledOrderSummary.test.tsx`
Expected: FAIL — cannot find module `./BilledOrderSummary`.

- [ ] **Step 3: Implement**

Create `components/checkout/BilledOrderSummary.tsx`:

```tsx
import type { ReactNode } from 'react'
import type {
  BilledLine,
  BilledOrderShape,
  BilledPartition,
} from '@/lib/pricing/order-billing-shape'

const ORDER_TYPE_LABEL: Record<BilledPartition['orderType'], string> = {
  purchase_order: 'Purchase order',
  stock_on_hand: 'Stock-on-hand order',
}

interface BilledOrderSummaryProps {
  shape: BilledOrderShape
  format: (nzdAmount: number) => string
  /** Renders one cart line row. Called per line, in partition order. */
  renderLine: (line: BilledLine) => ReactNode
  /** Review opens the breakdown by default; checkout leaves it collapsed. */
  defaultBreakdownOpen?: boolean
}

/**
 * Renders the billed shape: line rows grouped into the orders they will actually
 * become, each order's own fee/GST/total, and the grand total.
 *
 * Owns the STRUCTURE only — the caller passes `renderLine` because /checkout
 * renders a ship-to row and /checkout/review renders an image+decoration card.
 * Everything money-shaped lives here so the two pages cannot disagree, which is
 * the whole point of this work.
 *
 * A mixed cart shows its two groups because the split into two orders (and two
 * Xero quotes) is already real — today's single total just hides it.
 */
export function BilledOrderSummary({
  shape,
  format,
  renderLine,
  defaultBreakdownOpen = false,
}: BilledOrderSummaryProps) {
  const multi = shape.invoiceCount > 1

  return (
    <>
      {shape.partitions.map((partition) => (
        <section
          key={partition.orderType}
          className={multi ? 'mb-5 rounded-2xl border border-gray-100 p-5' : undefined}
        >
          {multi && (
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-500">
              {ORDER_TYPE_LABEL[partition.orderType]}
            </h3>
          )}
          <div className="divide-y divide-gray-100">
            {partition.lines.map((line) => (
              <div key={line.lineId}>{renderLine(line)}</div>
            ))}
          </div>
          {multi && (
            <div className="mt-4 space-y-1.5 border-t border-gray-200 pt-3 text-sm">
              <PartitionRows partition={partition} gstRate={shape.gstRate} format={format} />
              <div className="border-t border-gray-100 pt-1.5">
                <Row label="Order total" value={partition.total} bold format={format} />
              </div>
            </div>
          )}
        </section>
      ))}

      <div className="mt-6 flex items-baseline justify-between border-t border-gray-200 pt-5">
        <span className="text-base font-medium text-gray-900">
          {multi ? `Total across ${shape.invoiceCount} orders` : 'Total'}
        </span>
        <span className="text-xl font-medium text-gray-900">{format(shape.grandTotal)}</span>
      </div>
      <p className="mt-1 text-xs text-gray-500">incl. GST · billed per account terms</p>
      {multi && (
        <p className="mt-1 text-xs text-gray-500">
          You&apos;ll receive {shape.invoiceCount} invoices.
        </p>
      )}

      {!multi && shape.partitions.length === 1 && (
        <details open={defaultBreakdownOpen} className="mt-3">
          <summary className="cursor-pointer select-none text-xs text-gray-500 hover:text-gray-700">
            Show breakdown
          </summary>
          <div className="mt-3 space-y-1.5 text-sm">
            <PartitionRows
              partition={shape.partitions[0]}
              gstRate={shape.gstRate}
              format={format}
              showShipping
            />
            <div className="mt-1 border-t border-gray-100 pt-1.5">
              <Row label="Total" value={shape.partitions[0].total} bold format={format} />
            </div>
          </div>
        </details>
      )}
    </>
  )
}

function PartitionRows({
  partition,
  gstRate,
  format,
  showShipping,
}: {
  partition: BilledPartition
  gstRate: number
  format: (n: number) => string
  showShipping?: boolean
}) {
  const hasPrepaid = partition.prepaidGoodsValue > 0
  return (
    <>
      <Row
        label={hasPrepaid ? 'Goods (pre-paid)' : 'Subtotal'}
        value={partition.billedSubtotal}
        format={format}
      />
      {/*
        Load-bearing, not decoration: once goods read $0 this is the ONLY place
        the picking-fee band basis appears. Without it the customer cannot tell
        why the fee is $15 rather than $35.
      */}
      {hasPrepaid && (
        <div className="flex items-baseline justify-between pl-3">
          <span className="text-xs text-gray-500">Drawn from pre-paid stock</span>
          <span className="text-xs tabular-nums text-gray-500">
            {format(partition.prepaidGoodsValue)}
          </span>
        </div>
      )}
      {showShipping && (
        <div className="flex items-baseline justify-between">
          <span className="text-gray-700">Shipping</span>
          <span className="font-medium text-gray-900">Included</span>
        </div>
      )}
      {partition.pickingFee > 0 && (
        <Row label="Picking fee" value={partition.pickingFee} format={format} />
      )}
      <Row label={`GST (${Math.round(gstRate * 100)}%)`} value={partition.gst} muted format={format} />
    </>
  )
}

function Row({
  label,
  value,
  bold,
  muted,
  format,
}: {
  label: string
  value: number
  bold?: boolean
  muted?: boolean
  format: (n: number) => string
}) {
  return (
    <div className="flex items-baseline justify-between">
      <span className={muted ? 'text-gray-500' : 'text-gray-700'}>{label}</span>
      <span
        className={
          bold
            ? 'text-base font-semibold tabular-nums text-gray-900'
            : muted
              ? 'tabular-nums text-gray-700'
              : 'font-medium tabular-nums text-gray-900'
        }
      >
        {format(value)}
      </span>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/checkout/BilledOrderSummary.test.tsx`
Expected: PASS — 10 tests.

- [ ] **Step 5: Commit**

```bash
git add components/checkout/BilledOrderSummary.tsx components/checkout/BilledOrderSummary.test.tsx
git commit -m "feat(checkout): add BilledOrderSummary

Renders the billed shape: rows grouped into the orders they become, per-order
fee/GST/total, grand total, and the load-bearing 'Drawn from pre-paid stock'
row that keeps the fee band derivable once goods read \$0. Pages pass renderLine
so only the money structure is shared."
```

---

## Task 11: Wire `/checkout`

Chris's screenshot. Today this page passes no `pickingFee`, renders no badge, and — the trap — never loads store `country`, so a naive wiring would silently compute a $0 fee here and $15 on review.

**Files:**
- Modify: `app/(portal)/checkout/page.tsx:18`
- Modify: `components/checkout/ShipToRow.tsx`
- Modify: `components/checkout/CheckoutClient.tsx`

**Interfaces:**
- Consumes: `billedOrderShape`, `BilledLine` (Task 5); `resolveShipCountry` (Task 4); `useFreshBillingModes` (Task 8); `PrepaidBadge`, `PrepaidLinePrice` (Task 9); `BilledOrderSummary` (Task 10).
- Produces: `ShipToRow` gains `prepaidDrawn?: boolean` and `billedGoodsValue?: number`. No other file consumes these.

- [ ] **Step 1: Load store country on the checkout page**

In `app/(portal)/checkout/page.tsx`, change line 18 from `.select('id, name, city')` to:

```ts
    .select('id, name, city, country')
```

Without this the NZ gate fails on `/checkout` and the fee renders $0 here while `/checkout/review` shows $15 — the exact class of defect this work removes. The review page already selects it (`app/(portal)/checkout/review/page.tsx:21`).

- [ ] **Step 2: Update the StoreOption doc comment**

In `components/checkout/ShipToRow.tsx`, the `country` field's comment says "only the checkout review page loads it". Replace that comment with:

```ts
  /** Free-text ship-to country. Loaded by BOTH checkout pages — it region-gates
   *  the NZ picking fee, so a page that omits it would quote a $0 fee while the
   *  other quotes $15. */
  country?: string | null
```

- [ ] **Step 3: Add the prepaid props to ShipToRow**

In `components/checkout/ShipToRow.tsx`, add to `ShipToRowProps`:

```ts
  /**
   * From the billed shape (never a local guess): true ⇒ this line is a prepaid
   * stock draw and is invoiced at $0.
   */
  prepaidDrawn?: boolean
  /** Full goods value from the billed shape. Falls back to the cart's own
   *  all-in line total when the shape hasn't resolved yet. */
  billedGoodsValue?: number
```

Add `prepaidDrawn`, `billedGoodsValue` to the destructured params, import the components:

```tsx
import { PrepaidBadge, PrepaidLinePrice } from './PrepaidLinePrice'
```

Replace the line-total render at line 105 (`{format(allInLineTotal(line))}`) with:

```tsx
<PrepaidLinePrice
  goodsValue={billedGoodsValue ?? allInLineTotal(line)}
  billed={!prepaidDrawn}
  format={format}
/>
```

And render `{prepaidDrawn && <PrepaidBadge />}` immediately after the product name element in the same row.

- [ ] **Step 4: Wire CheckoutClient**

In `components/checkout/CheckoutClient.tsx`:

Replace the `computeOrderBreakdown` / `PriceBreakdown` imports (lines 15-16) with:

```tsx
import { billedOrderShape, type BilledLine } from '@/lib/pricing/order-billing-shape'
import { resolveShipCountry } from '@/lib/checkout/ship-country'
import { useFreshBillingModes } from './useFreshBillingModes'
import { BilledOrderSummary } from './BilledOrderSummary'
```

Replace the `breakdown` / `depositAmount` block (lines 127-140) with:

```tsx
  const { modeByVariantId, status: billingStatus } = useFreshBillingModes(cart.lines)
  // Hold the total back for the sub-second fresh read rather than flashing a
  // number we might not honour. 'error' is a usable fail-closed answer (empty
  // map ⇒ every line bills at full price), so only 'loading' blocks.
  const pricingReady = billingStatus !== 'loading'

  const storeById = useMemo(() => {
    const map = new Map<string, StoreOption>()
    for (const store of stores) map.set(store.id, store)
    return map
  }, [stores])

  const shipCountry = useMemo(
    () =>
      resolveShipCountry({
        lines: cart.lines,
        perLineShipTo,
        customAddressCountry: customAddress.country,
        countryByStoreId: new Map(
          Array.from(storeById.entries()).map(([id, store]) => [id, store.country ?? null]),
        ),
      }),
    [cart.lines, perLineShipTo, customAddress.country, storeById],
  )

  const shape = useMemo(
    () =>
      billedOrderShape({
        lines: cart.lines.map((line) => ({
          lineId: line.lineId,
          qty: line.qty,
          unitPrice: line.unitPrice,
          decorationPerUnit: decorationPerUnit(line),
          fulfilmentType: line.fulfilmentType,
          // FRESH mode only — the cart's own billingMode snapshot is a PDP
          // reading and can be days stale. Absent ⇒ null ⇒ billed (fail closed).
          billingMode: modeByVariantId[line.variantId] ?? null,
        })),
        gstRate: 0.15,
        shipCountry,
      }),
    [cart.lines, modeByVariantId, shipCountry],
  )

  const lineById = useMemo(
    () => new Map(cart.lines.map((line) => [line.lineId, line])),
    [cart.lines],
  )
  const depositPct = defaultDepositPercent ?? 0
  // Off the BILLED subtotal: a deposit on stock the org already paid for would
  // be asking twice.
  const depositAmount = (shape.billedSubtotal * depositPct) / 100
```

Replace the line list + totals block (lines 253-294 — the `<div className="divide-y divide-gray-100">` through the closing `</details>`) with:

```tsx
        <BilledOrderSummary
          shape={shape}
          format={format}
          renderLine={(billedLine: BilledLine) => {
            const line = lineById.get(billedLine.lineId)
            if (!line) return null
            return (
              <ShipToRow
                line={line}
                stores={selectableStores}
                format={format}
                value={perLineShipTo[line.lineId] ?? null}
                catalogueFrontImageUrl={frontImageByLineId[line.lineId] ?? null}
                onChange={(next) =>
                  setPerLineShipTo((prev) => ({ ...prev, [line.lineId]: next }))
                }
                disabled={submitting !== false}
                allowCustom={!buyerMisconfigured}
                hideShipTo={inventoryMode}
                prepaidDrawn={!billedLine.billed}
                billedGoodsValue={billedLine.goodsValue}
              />
            )
          }}
        />
```

Add the `BilledLine` type import:

```tsx
import { billedOrderShape, type BilledLine } from '@/lib/pricing/order-billing-shape'
```

Update the sticky bar (line 434):

```tsx
        totalLabel={pricingReady ? format(shape.grandTotal) : '—'}
```

- [ ] **Step 5: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests pass.

- [ ] **Step 6: Verify by hand**

Run: `npm run dev`, sign in as an org with a prepaid variant, add 120 of it to the cart, open `/checkout`.

Expected:
- The line shows a "Pre-paid" badge and `$1,465.20 → $0.00`.
- Total reads **$17.25** (not $1,684.98).
- "Show breakdown" reveals `Goods (pre-paid) $0.00`, `Drawn from pre-paid stock $1,465.20`, `Picking fee $15.00`, `GST (15%) $2.25`.
- In devtools Network, `GET /api/checkout/billing-modes?variant_ids=…` returns 200 with `{"modeByVariantId":{"…":"prepaid"}}`.
- Block that request (devtools → Network → block request URL) and reload: the total falls back to **$1,684.98**. That is the fail-closed path working — over-quote, never under-quote.

- [ ] **Step 7: Commit**

```bash
git add "app/(portal)/checkout/page.tsx" components/checkout/ShipToRow.tsx components/checkout/CheckoutClient.tsx
git commit -m "feat(checkout): render the billed total on /checkout

The page from Chris's screenshot: prepaid draws at \$0, picking fee as a line,
deposit off the billed subtotal. Also loads store country here for the first
time — without it the NZ fee gate would fail on /checkout and quote \$0 while
/checkout/review quoted \$15."
```

---

## Task 12: Wire `/checkout/review`

Same shape, plus the submit-side drift claim and its banner.

**Files:**
- Modify: `components/checkout/CheckoutReviewClient.tsx`

**Interfaces:**
- Consumes: everything from Tasks 4, 5, 8, 9, 10; `isPrepaidDrawn` no longer needed here (the shape supplies `billed`).
- Produces: the checkout POST body gains `claimed_billing_mode` per line. Task 13 reads it.

- [ ] **Step 1: Replace the pricing block**

In `components/checkout/CheckoutReviewClient.tsx`:

Replace the `computeOrderBreakdown` / `orderPickingFee` / `PriceBreakdown` / `isPrepaidDrawn` imports with:

```tsx
import { billedOrderShape, type BilledLine } from '@/lib/pricing/order-billing-shape'
import { resolveShipCountry } from '@/lib/checkout/ship-country'
import { useFreshBillingModes } from './useFreshBillingModes'
import { BilledOrderSummary } from './BilledOrderSummary'
import { PrepaidBadge, PrepaidLinePrice } from './PrepaidLinePrice'
```

Replace the `shipCountry` memo (lines 85-95) with:

```tsx
  const shipCountry = useMemo<string | null>(() => {
    if (!reviewState) return null
    return resolveShipCountry({
      lines: cart.lines,
      perLineShipTo: reviewState.perLineShipTo,
      customAddressCountry: reviewState.customAddress.country,
      countryByStoreId: new Map(
        Array.from(storeById.entries()).map(([id, store]) => [id, store.country ?? null]),
      ),
    })
  }, [reviewState, cart.lines, storeById])
```

Replace the `breakdown` memo and `depositAmount` (lines 97-124) with:

```tsx
  const { modeByVariantId, status: billingStatus } = useFreshBillingModes(cart.lines)
  const pricingReady = billingStatus !== 'loading'

  const shape = useMemo(
    () =>
      billedOrderShape({
        lines: cart.lines.map((line) => ({
          lineId: line.lineId,
          qty: line.qty,
          unitPrice: line.unitPrice,
          decorationPerUnit: decorationPerUnit(line),
          fulfilmentType: line.fulfilmentType,
          billingMode: modeByVariantId[line.variantId] ?? null,
        })),
        gstRate: 0.15,
        shipCountry,
      }),
    [cart.lines, modeByVariantId, shipCountry],
  )

  const lineById = useMemo(
    () => new Map(cart.lines.map((line) => [line.lineId, line])),
    [cart.lines],
  )
  const depositPct = defaultDepositPercent ?? 0
  // Off the BILLED subtotal — never charge a deposit on prepaid stock.
  const depositAmount = (shape.billedSubtotal * depositPct) / 100
```

- [ ] **Step 2: Send the claimed billing mode**

In `confirmOrder`, add to each line in the POST body (after `claimed_manual_decoration`):

```ts
            // Drift guard (D4). The server re-resolves and 409s on ANY mismatch,
            // in both directions: even drift that favours the customer means the
            // page disagreed with the quote, which is the defect being fixed.
            // Null for a variantless line — nothing to claim.
            claimed_billing_mode: line.variantId
              ? modeByVariantId[line.variantId] ?? 'invoice_on_dispatch'
              : null,
```

- [ ] **Step 3: Handle the drift 409**

Add to the 409 response type (after `priceDrift`):

```ts
          billingDrift?: Array<{
            cartLineId: string | null
            productId: string
            productName: string
            claimedBillingMode: string
            canonicalBillingMode: string
          }>
```

And add this handler immediately before the `unit_price_drift` handler:

```ts
        if (data.error === 'billing_mode_drift') {
          setBanner({
            kind: 'error',
            msg: 'Pre-paid status changed — review your cart.',
          })
          return
        }
```

- [ ] **Step 4: Replace the line list and totals**

Replace the block from `<div className="divide-y divide-gray-100">` (line 429) through the closing `</details>` (line 506) with:

```tsx
        <BilledOrderSummary
          shape={shape}
          format={format}
          defaultBreakdownOpen
          renderLine={(billedLine: BilledLine) => {
            const line = lineById.get(billedLine.lineId)
            if (!line) return null
            const imageUrl = cartLineDisplayImageUrl(line, {
              catalogueFrontImageUrl: frontImageByLineId[line.lineId] ?? null,
            })
            const visibleDecorations = line.decorations.filter(
              (decoration) => !isGenericCustomDecorationName(decoration.name),
            )
            return (
              <article className="py-5 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-gray-50">
                      {imageUrl ? (
                        <Image
                          src={imageUrl}
                          alt=""
                          fill
                          sizes="80px"
                          className="object-contain p-1"
                          unoptimized
                        />
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-base font-medium text-gray-900">{line.productName}</h3>
                      {/* From the billed shape, so the badge and the $0 are the
                          same decision — they cannot disagree. */}
                      {!billedLine.billed && <PrepaidBadge />}
                      <p className="mt-1 text-xs tracking-wide text-gray-500">{line.variantLabel}</p>
                      <p className="text-xs text-gray-500">qty {line.qty}</p>
                      {visibleDecorations.length > 0 && (
                        <ul className="mt-2 space-y-1 text-xs text-gray-600">
                          {visibleDecorations.map((decoration) => (
                            <li key={decoration.linkId}>{decoration.name}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                  <div className="text-right text-sm">
                    <p className="text-gray-500">Unit {format(allInUnitPrice(line))}</p>
                    <div className="mt-1">
                      <PrepaidLinePrice
                        goodsValue={billedLine.goodsValue}
                        billed={billedLine.billed}
                        format={format}
                      />
                    </div>
                  </div>
                </div>
              </article>
            )
          }}
        />
```

Remove the now-unused `allInLineTotal` import if `tsc` flags it.

- [ ] **Step 5: Gate the CTA on the fresh read**

In the `<CheckoutCTAStickyBar>` at line 584, change these two props only — leave `itemCount`, `onSubmit`, `submitting`, `submitLabel` and `submittingLabel` exactly as they are:

```tsx
        totalLabel={pricingReady ? format(shape.grandTotal) : '—'}
        disabled={!pricingReady || isPreview || !customerCode}
```

Unlike `/checkout`, this page gates the button: confirming here places the order, and it must not be placed against a total that has not resolved.

- [ ] **Step 6: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add components/checkout/CheckoutReviewClient.tsx
git commit -m "feat(checkout): render the billed total on /checkout/review

Same billed shape as /checkout, deposit off the billed subtotal, and the
claimed_billing_mode drift claim + banner. Badge now comes from the shape, so
badge and money are one decision."
```

---

## Task 13: Server drift guard — hoist the resolution, then 409

**The ordering matters and is the whole risk of this task.** `resolveLineBillingModes` currently runs at `submit.ts:1166`, *after* the RPC commits at `submit.ts:1038`. Throwing a 409 from there would leave a committed order behind and still fail the customer. The resolution must move before the RPC.

**Files:**
- Modify: `lib/checkout/submit.ts`
- Modify: `app/api/checkout/route.ts`
- Test: `lib/checkout/__tests__/submit.billing-mode-drift.test.ts`

**Interfaces:**
- Consumes: `resolveLineBillingModes`; `BillingMode`.
- Produces: `CheckoutLineInput.claimed_billing_mode?: BillingMode | null`; `interface BillingModeDrift { cartLineId: string | null; productId: string; productName: string; claimedBillingMode: BillingMode; canonicalBillingMode: BillingMode }`; `class BillingModeDriftError extends Error { readonly drift: BillingModeDrift[] }` (message `'billing_mode_drift'`). The route maps it to `409 { error: 'billing_mode_drift', billingDrift }`.

- [ ] **Step 1: Write the failing test**

Create `lib/checkout/__tests__/submit.billing-mode-drift.test.ts`. Model the Supabase stub on the existing `lib/checkout/__tests__/submit.drift-characterization.test.ts` — read that file first and mirror its stub shape rather than inventing one.

```ts
import { describe, it, expect } from 'vitest'
import { buildBillingModeDrift } from '../submit'

describe('buildBillingModeDrift', () => {
  const canonical = new Map([
    ['v-prepaid', 'prepaid' as const],
    ['v-billed', 'invoice_on_dispatch' as const],
  ])

  const line = (over: Record<string, unknown> = {}) => ({
    product_id: 'p1',
    product_name: 'Staple Tee',
    variant_id: 'v-prepaid',
    qty: 10,
    cart_line_id: 'l1',
    ...over,
  })

  it('is empty when the claim matches', () => {
    expect(
      buildBillingModeDrift([line({ claimed_billing_mode: 'prepaid' })], canonical),
    ).toEqual([])
  })

  // Drift AGAINST the customer: they'd be charged for goods the page showed at $0.
  it('flags a claim of prepaid on a variant that is now billed', () => {
    expect(
      buildBillingModeDrift(
        [line({ variant_id: 'v-billed', claimed_billing_mode: 'prepaid' })],
        canonical,
      ),
    ).toEqual([
      {
        cartLineId: 'l1',
        productId: 'p1',
        productName: 'Staple Tee',
        claimedBillingMode: 'prepaid',
        canonicalBillingMode: 'invoice_on_dispatch',
      },
    ])
  })

  // Drift FOR the customer still 409s: the page disagreed with the quote, and
  // that disagreement is the whole defect being fixed.
  it('flags a claim of billed on a variant that is now prepaid', () => {
    expect(
      buildBillingModeDrift(
        [line({ claimed_billing_mode: 'invoice_on_dispatch' })],
        canonical,
      ),
    ).toHaveLength(1)
  })

  it('skips a line with no claim (legacy cart)', () => {
    expect(buildBillingModeDrift([line()], canonical)).toEqual([])
    expect(buildBillingModeDrift([line({ claimed_billing_mode: null })], canonical)).toEqual([])
  })

  it('treats an unknown variant as invoice_on_dispatch (fail closed)', () => {
    expect(
      buildBillingModeDrift(
        [line({ variant_id: 'v-gone', claimed_billing_mode: 'prepaid' })],
        canonical,
      ),
    ).toHaveLength(1)
  })

  it('treats a variantless line as invoice_on_dispatch', () => {
    expect(
      buildBillingModeDrift(
        [line({ variant_id: null, claimed_billing_mode: 'invoice_on_dispatch' })],
        canonical,
      ),
    ).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/checkout/__tests__/submit.billing-mode-drift.test.ts`
Expected: FAIL — `buildBillingModeDrift is not exported`.

- [ ] **Step 3: Add the type, the error and the pure builder**

In `lib/checkout/submit.ts`, add to `CheckoutLineInput` (after `claimed_manual_decoration`):

```ts
  /**
   * The cart's claimed per-variant billing class at submit time (D4). The server
   * re-resolves from variant_inventory and throws BillingModeDriftError on ANY
   * mismatch, in BOTH directions — even drift that favours the customer means
   * checkout disagreed with the quote. Absent for legacy carts, which skip the
   * guard (mirrors the has_brackets gate on unit_price_drift).
   */
  claimed_billing_mode?: BillingMode | null
```

Add next to the other drift types and errors (near `UnitPriceDrift` / `UnitPriceDriftError`):

```ts
export interface BillingModeDrift {
  cartLineId: string | null
  productId: string
  productName: string
  claimedBillingMode: BillingMode
  canonicalBillingMode: BillingMode
}

export class BillingModeDriftError extends Error {
  readonly drift: BillingModeDrift[]
  constructor(drift: BillingModeDrift[]) {
    super('billing_mode_drift')
    this.name = 'BillingModeDriftError'
    this.drift = drift
  }
}

/**
 * Compare each line's claimed billing mode against the canonical one. Pure, so
 * the both-directions rule is testable without a database.
 *
 * A line with no claim is skipped (legacy cart). An unknown variant, or no
 * variant at all, resolves to invoice_on_dispatch — the same fail-closed rule as
 * resolve-line-billing-modes.ts.
 */
export function buildBillingModeDrift(
  lines: Array<
    Pick<CheckoutLineInput, 'product_id' | 'product_name' | 'variant_id' | 'cart_line_id' | 'claimed_billing_mode'>
  >,
  canonicalByVariant: Map<string, BillingMode>,
): BillingModeDrift[] {
  const drift: BillingModeDrift[] = []
  for (const line of lines) {
    if (line.claimed_billing_mode == null) continue
    const canonical: BillingMode = line.variant_id
      ? canonicalByVariant.get(line.variant_id) ?? 'invoice_on_dispatch'
      : 'invoice_on_dispatch'
    if (line.claimed_billing_mode !== canonical) {
      drift.push({
        cartLineId: line.cart_line_id ?? null,
        productId: line.product_id,
        productName: line.product_name,
        claimedBillingMode: line.claimed_billing_mode,
        canonicalBillingMode: canonical,
      })
    }
  }
  return drift
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/checkout/__tests__/submit.billing-mode-drift.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Hoist the resolution to before the RPC**

In `lib/checkout/submit.ts`, insert a new step **2c** immediately after the `unitPriceDrift` throw (currently ends line 653) and before step 2b's comment block:

```ts
  // 2c. Per-variant billing modes + the drift guard (spec 2026-07-17 D4).
  //     MUST run before the RPC at step 3: this throws, and a throw after the
  //     RPC would leave a committed order behind while still failing the
  //     customer. The resolved map is reused at step 5c (Xero zeroing) and by
  //     the Monday billing note, so there is exactly ONE read per submit.
  const billingVariantIds = Array.from(
    new Set(input.lines.map((l) => l.variant_id).filter((v): v is string => !!v)),
  )
  const billingModeByVariant = await resolveLineBillingModes(
    admin,
    input.context.organizationId,
    billingVariantIds,
  )
  const billingModeDrift = buildBillingModeDrift(input.lines, billingModeByVariant)
  if (billingModeDrift.length > 0) {
    throw new BillingModeDriftError(billingModeDrift)
  }
```

Then **delete** the now-duplicated resolution at the old site (lines 1163-1170 — the `billingVariantIds` const through the `resolveLineBillingModes` call). Leave the `orderBillingLines` / `needsInvoicing` / `pickFee` block that follows it exactly as it is; it now reads the hoisted `billingModeByVariant`.

- [ ] **Step 6: Verify the hoist compiles and nothing else moved**

Run: `npx tsc --noEmit`
Expected: no errors. If `billingModeByVariant` reports as redeclared, the old block was not fully removed. If it reports as undefined at line ~1171 or ~1700, the new block was inserted too late — it must be above the `admin.rpc('submit_b2b_order', …)` call.

- [ ] **Step 7: Map the error to a 409**

In `app/api/checkout/route.ts`, add `BillingModeDriftError` to the import list from `@/lib/checkout/submit`, and add this handler immediately after the `UnitPriceDriftError` handler:

```ts
    if (e instanceof BillingModeDriftError) {
      return NextResponse.json(
        { error: 'billing_mode_drift', billingDrift: e.drift },
        { status: 409 },
      )
    }
```

- [ ] **Step 8: Run the full suite**

Run: `npx vitest run`
Expected: all tests pass — in particular every pre-existing `lib/checkout/__tests__/submit.*.test.ts`. Those cover the submit path end to end and are the proof the hoist did not disturb it.

- [ ] **Step 9: Commit**

```bash
git add lib/checkout/submit.ts app/api/checkout/route.ts lib/checkout/__tests__/submit.billing-mode-drift.test.ts
git commit -m "feat(checkout): 409 on billing_mode_drift, in both directions

Hoists resolveLineBillingModes from after the RPC to step 2c, before it: the
guard throws, and a throw after the RPC would leave a committed order behind.
One read per submit, reused by the Xero zeroing and the Monday note.

Drift 409s even when it favours the customer — checkout disagreeing with the
quote IS the defect."
```

---

## Task 14: Persist the billed figures

Snapshot, never recompute. `billing_mode` is mutable: re-opening an old order must show what was billed, not what today's rules would bill.

**Files:**
- Modify: `lib/checkout/submit.ts`

**Interfaces:**
- Consumes: `quotes.picking_fee`, `quotes.billed_total` (Task 1); `isPrepaidDrawn` (Task 3); `round2`; the existing `pickFee`, `repriced` and `orderBillingLines` locals.
- Produces: `billedOrderTotal(lines: BilledTotalLine[], pickFee: number): number` and `interface BilledTotalLine { stocked: boolean; billingMode: BillingMode; goodsValue: number; decorationRevenue: number }`, both exported from `lib/checkout/submit.ts`. `quotes.picking_fee` and `quotes.billed_total` written per order — Tasks 15 and 16 read them.

The billed rule is the risky part of this task, so it goes in a pure exported function and is tested directly. That is also why no Supabase stub is needed here.

- [ ] **Step 1: Write the failing test**

Create `lib/checkout/__tests__/submit.billed-total.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { billedOrderTotal } from '../submit'

const prepaidDraw = { stocked: true, billingMode: 'prepaid' as const, goodsValue: 1465.2, decorationRevenue: 0 }
const billedStock = { stocked: true, billingMode: 'invoice_on_dispatch' as const, goodsValue: 500, decorationRevenue: 0 }
const prepaidProduced = { stocked: false, billingMode: 'prepaid' as const, goodsValue: 400, decorationRevenue: 0 }

describe('billedOrderTotal', () => {
  // Chris's case: 120 tees drawn from prepaid stock bill nothing but the fee.
  it('bills only the picking fee for a wholly prepaid draw', () => {
    expect(billedOrderTotal([prepaidDraw], 15)).toBe(15)
  })

  it('bills goods plus the fee for a non-prepaid stock order', () => {
    expect(billedOrderTotal([billedStock], 15)).toBe(515)
  })

  // The `nature` defect in server terms: produced goods are charged even when
  // the variant is prepaid, matching draft-invoice.ts's qty_from_stock gate.
  it('CHARGES a prepaid variant that was produced, not drawn', () => {
    expect(billedOrderTotal([prepaidProduced], 0)).toBe(400)
  })

  it('excludes decoration on a prepaid draw — it was paid for with the stock', () => {
    expect(billedOrderTotal([{ ...prepaidDraw, decorationRevenue: 240 }], 15)).toBe(15)
  })

  it('includes decoration on a billed line', () => {
    expect(billedOrderTotal([{ ...billedStock, decorationRevenue: 50 }], 15)).toBe(565)
  })

  it('sums a mixed set', () => {
    expect(billedOrderTotal([prepaidDraw, billedStock], 15)).toBe(515)
  })

  it('is the fee alone for an empty line set', () => {
    expect(billedOrderTotal([], 15)).toBe(15)
  })

  it('rounds to cents', () => {
    expect(
      billedOrderTotal([{ ...billedStock, goodsValue: 0.1, decorationRevenue: 0.2 }], 0),
    ).toBe(0.3)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/checkout/__tests__/submit.billed-total.test.ts`
Expected: FAIL — `billedOrderTotal is not exported`.

- [ ] **Step 3: Add the pure function**

In `lib/checkout/submit.ts`, add near `buildBillingModeDrift` (from Task 13):

```ts
export interface BilledTotalLine {
  /** fulfilment_type === 'stocked' — this line DREW stock. */
  stocked: boolean
  billingMode: BillingMode
  /** qty × repriced garment unit price, ex decoration. */
  goodsValue: number
  /** qty × per-unit decoration for this line. */
  decorationRevenue: number
}

/**
 * The ex-GST figure we actually invoice: goods + decoration for every line that
 * is NOT a prepaid stock draw, plus the picking fee.
 *
 * Decoration on a prepaid draw is excluded too — it was paid for along with the
 * stock. Handled per line rather than folded into goodsValue because decoration
 * revenue is tracked separately for finance (quotes.decoration_cost).
 *
 * Uses the same isPrepaidDrawn predicate as the customer-facing shape, so the
 * server and the checkout page cannot disagree about which lines are free.
 */
export function billedOrderTotal(lines: BilledTotalLine[], pickFee: number): number {
  const billedGoods = lines.reduce((total, line) => {
    if (isPrepaidDrawn(line.stocked ? 'stocked' : 'made_to_order', line.billingMode)) {
      return total
    }
    return total + line.goodsValue + line.decorationRevenue
  }, 0)
  return round2(billedGoods + pickFee)
}
```

Add the imports if not already present:

```ts
import { round2 } from '@/lib/pricing/pricingMath'
import { isPrepaidDrawn } from '@/lib/shop/prepaid-tag'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/checkout/__tests__/submit.billed-total.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Capture per-line decoration revenue**

`totalDecorationRevenue` is accumulated in the loop at lines 1019-1031 but never kept per line, and the billed rule needs it per line. Add the array to that same loop — do not build a second one, or the two can disagree.

In `lib/checkout/submit.ts`, replace lines 1019-1031 with:

```ts
  const decorationCostByLineKey = new Map<string, number>()
  // Index-aligned to `repriced` (and therefore to input.lines and
  // orderBillingLines, both .map over it). The billed-total rule below needs the
  // per-line figure; the running total keeps its existing meaning and value.
  const decorationRevenueByLineIndex: number[] = []
  let totalDecorationRevenue = 0
  for (const l of repriced) {
    const lineKey = makeLineKey(l.product_id, l.variant_id ?? null, l.size_id ?? null)
    // Manual-final lines bill ONE combined figure (validated entries are $0
    // metadata); computed lines sum the per-placement prices.
    const manualDeco = manualDecorationByLineKey.get(lineKey)
    const validated = validatedByLineKey.get(lineKey) ?? []
    const perUnit =
      manualDeco != null ? manualDeco : validated.reduce((s, d) => s + d.unitPrice, 0)
    decorationCostByLineKey.set(lineKey, perUnit)
    const lineRevenue = perUnit * l.qty
    decorationRevenueByLineIndex.push(lineRevenue)
    totalDecorationRevenue += lineRevenue
  }
```

`totalDecorationRevenue` is unchanged in value — it still feeds `decoration_cost`, the fee band and `total_amount`, none of which this work touches.

- [ ] **Step 6: Write the billed figures post-RPC**

In `lib/checkout/submit.ts`, insert this immediately after the `decoration_cost` write block (which ends at line 1200) and before the `recordAuditEvent` call:

```ts
  // The BILLED figures (spec 2026-07-17 D5) — what the customer is actually
  // invoiced, as against total_amount, which stays the full goods value so
  // Monday, staff order views and reporting are untouched.
  //
  // A SNAPSHOT, never recomputed on read: variant_inventory.billing_mode is
  // mutable, so re-deriving this later would silently rewrite what an old order
  // was billed.
  //
  // Written post-RPC with a plain update, exactly like decoration_cost above —
  // which is why neither needs a submit_b2b_order change.
  const billedTotal = billedOrderTotal(
    orderBillingLines.map((billing, index) => ({
      stocked: billing.stocked,
      billingMode: billing.billingMode,
      goodsValue: repriced[index].unit_price * repriced[index].qty,
      decorationRevenue: decorationRevenueByLineIndex[index] ?? 0,
    })),
    pickFee,
  )
  await admin
    .from('quotes')
    .update({ picking_fee: round2(pickFee), billed_total: billedTotal })
    .eq('id', quote_id)
```

- [ ] **Step 7: Run the full checkout suite**

Run: `npx tsc --noEmit && npx vitest run lib/checkout/__tests__/`
Expected: no type errors; PASS, including every pre-existing submit test. Those are the proof that touching the decoration loop changed nothing about `total_amount` or `decoration_cost`.

- [ ] **Step 8: Commit**

```bash
git add lib/checkout/submit.ts lib/checkout/__tests__/submit.billed-total.test.ts
git commit -m "feat(checkout): snapshot picking_fee + billed_total at submit

What the customer is actually invoiced, written post-RPC like decoration_cost —
no RPC change. A snapshot, never recomputed: billing_mode is mutable, so
re-deriving later would rewrite what an old order was billed.

total_amount untouched — Monday and reporting still read the goods value."
```

---

## Task 15: Confirmation page reads the billed total

Live divergence today: the page shows $1,465.20 for an order checkout quoted at $17.25.

**Files:**
- Modify: `app/(portal)/checkout/confirmation/[orderId]/page.tsx`
- Modify: `app/(portal)/checkout/confirmation/[orderId]/ConfirmationView.tsx`

**Interfaces:**
- Consumes: `quotes.billed_total`, `quotes.picking_fee` (Tasks 1, 14).
- Produces: `ConfirmationView` gains props `pickingFee: number` and `prepaidGoodsValue: number`.

- [ ] **Step 1: Select the new columns**

In `page.tsx`, add `picking_fee, billed_total` to the `quotes!inner (…)` select list, and to the `OrderRow['quotes']` interface:

```ts
    picking_fee: number | null
    billed_total: number | null
```

- [ ] **Step 2: Derive the billed figures**

Replace the totals block (lines 148-153) with:

```ts
  // Stored total_amount / total_price is the ex-GST GOODS value. billed_total is
  // what we actually invoice: prepaid stock draws count 0, plus the picking fee.
  //
  // Both are read, not recomputed — billing_mode is mutable, so re-deriving
  // would rewrite the history of an old order.
  //
  // billed_total is NULL for orders placed before the column existed. Those
  // orders had no prepaid zeroing and no fee line, so the goods value IS what
  // was billed — fall back to it rather than rendering $0.
  const goodsExGst = Number(order.quotes.subtotal ?? order.total_price ?? 0)
  const decorationCost = Number(order.quotes.decoration_cost ?? 0)
  const pickingFee = Number(order.quotes.picking_fee ?? 0)
  const billedExGst =
    order.quotes.billed_total != null ? Number(order.quotes.billed_total) : goodsExGst
  const prepaidGoodsValue = Math.round(Math.max(0, goodsExGst - (billedExGst - pickingFee)) * 100) / 100
  const storedTax = Number(order.quotes.tax ?? 0)
  // storedTax was computed off the goods value, so it is only trustworthy when
  // nothing was zeroed. Otherwise derive GST from what is actually billed.
  const gst =
    prepaidGoodsValue === 0 && storedTax > 0
      ? storedTax
      : Math.round(billedExGst * GST_RATE * 100) / 100
  const totalIncGst = Math.round((billedExGst + gst) * 100) / 100
```

- [ ] **Step 3: Pass the new props**

Change the `<ConfirmationView …>` props: `subtotalExGst={billedExGst}` (was `subtotalExGst`), and add:

```tsx
          pickingFee={pickingFee}
          prepaidGoodsValue={prepaidGoodsValue}
```

- [ ] **Step 4: Render them**

In `ConfirmationView.tsx`, add to the props interface:

```ts
  /** NZ picking fee charged on this order, ex-GST. 0 when none applies. */
  pickingFee: number
  /** Goods drawn from pre-paid stock and NOT invoiced. 0 for a normal order. */
  prepaidGoodsValue: number
```

Destructure both, and in the totals column replace the `Subtotal (ex-GST)` row with:

```tsx
              <div className="flex items-baseline justify-between">
                <span className="text-gray-600">
                  {prepaidGoodsValue > 0 ? 'Goods (pre-paid)' : 'Subtotal (ex-GST)'}
                </span>
                <span className="tabular-nums">{format(subtotalExGst - pickingFee)}</span>
              </div>
              {prepaidGoodsValue > 0 && (
                <div className="flex items-baseline justify-between pl-3">
                  <span className="text-xs text-gray-500">Drawn from pre-paid stock</span>
                  <span className="text-xs tabular-nums text-gray-500">
                    {format(prepaidGoodsValue)}
                  </span>
                </div>
              )}
              {pickingFee > 0 && (
                <div className="flex items-baseline justify-between">
                  <span className="text-gray-600">Picking fee</span>
                  <span className="tabular-nums">{format(pickingFee)}</span>
                </div>
              )}
```

- [ ] **Step 5: Typecheck and run the suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests pass.

- [ ] **Step 6: Verify by hand**

Place a prepaid order end to end in dev. The confirmation page must show **$17.25**, `Goods (pre-paid) $0.00`, `Drawn from pre-paid stock $1,465.20`, `Picking fee $15.00` — the same figures as `/checkout/review`.

Then open a pre-existing order placed before this deploy (any order in `my-collections`). It must render exactly as it does today — `billed_total` is NULL there and the fallback must hold.

- [ ] **Step 7: Commit**

```bash
git add "app/(portal)/checkout/confirmation/[orderId]/page.tsx" "app/(portal)/checkout/confirmation/[orderId]/ConfirmationView.tsx"
git commit -m "fix(checkout): confirmation page shows the billed total

Was showing \$1,465.20 for an order checkout quoted at \$17.25 — divergence that
is live today, before Xero is even enabled. Reads the billed_total snapshot;
NULL (pre-deploy orders) falls back to the goods value."
```

---

## Task 16: Emails

Customer email gets the billed figure. Staff dispatch email keeps the goods figure — staff care what is leaving the building — relabelled so it cannot be read as an invoice.

**Files:**
- Modify: `lib/email/order-confirmation.ts`
- Modify: `lib/email/order-placed-dispatch.ts`
- Modify: `lib/checkout/submit.ts` (the email call sites)

**Interfaces:**
- Consumes: `quotes.billed_total`, `quotes.picking_fee`.
- Produces: `sendOrderConfirmation` params gain `pickingFee: number` and `prepaidGoodsValue: number`; `totalAmount` becomes the billed figure. The dispatch email's `totalAmount` is unchanged in value, relabelled in copy.

- [ ] **Step 1: Relabel the staff dispatch email**

In `lib/email/order-placed-dispatch.ts`, change the totals-row label at line 102 and the column header at line 97 from `Total` to `Goods value`. Add above the params interface:

```ts
/**
 * NOTE: totalAmount here is the GOODS value, not the invoice. Staff care what is
 * leaving the building, and a prepaid order's invoice is just the picking fee —
 * a dispatch note reading "$17.25" for 120 tees would be actively misleading.
 * Labelled "Goods value" so it cannot be mistaken for what the customer pays.
 */
```

- [ ] **Step 2: Add the billed figures to the customer email**

In `lib/email/order-confirmation.ts`, add to the params interface:

```ts
  /** NZ picking fee, ex-GST. 0 when none applies. */
  pickingFee: number
  /** Goods drawn from pre-paid stock and NOT invoiced. 0 for a normal order. */
  prepaidGoodsValue: number
```

`totalAmount` keeps its name but now carries the BILLED figure. Add to its doc comment:

```ts
  /** What the customer is invoiced, ex-GST: billed goods + pickingFee. Prepaid
   *  stock draws contribute 0. NOT the goods value — see the dispatch email for
   *  that. */
  totalAmount: number
```

In the HTML totals block (around line 142), add above the total row:

```ts
${
  params.prepaidGoodsValue > 0
    ? `<tr><td colspan="2" style="padding:6px 0 0;text-align:right;font-size:12px;color:#6b7280;">Drawn from pre-paid stock</td><td style="padding:6px 0 0 16px;text-align:right;font-family:${BRAND_MONO};font-size:12px;color:#6b7280;white-space:nowrap;">${formatMoney(params.prepaidGoodsValue)}</td></tr>`
    : ''
}${
  params.pickingFee > 0
    ? `<tr><td colspan="2" style="padding:6px 0 0;text-align:right;font-size:13px;color:#374151;">Picking fee</td><td style="padding:6px 0 0 16px;text-align:right;font-family:${BRAND_MONO};font-size:13px;color:#374151;white-space:nowrap;">${formatMoney(params.pickingFee)}</td></tr>`
    : ''
}
```

And in the plain-text body (around line 190), before the `Total:` line:

```ts
    (params.prepaidGoodsValue > 0
      ? `Drawn from pre-paid stock: ${formatMoney(params.prepaidGoodsValue)}\n`
      : '') +
    (params.pickingFee > 0 ? `Picking fee: ${formatMoney(params.pickingFee)}\n` : '') +
```

- [ ] **Step 3: Feed them from submit**

In `lib/checkout/submit.ts`, extend the email payload fetch (line 1845) to select the new columns:

```ts
        .select('customer_name, total_amount, picking_fee, billed_total, required_by, payment_terms')
```

Add the matching fields to `QuoteRowForEmail`, then replace the `emailTotalAmount` assignment (line 1850):

```ts
        // The BILLED figure — what we invoice. NULL only for orders that predate
        // the column, which cannot happen on this path (we just wrote it), but
        // fall back to goods rather than emailing $0 if it somehow is.
        emailTotalAmount =
          quote.billed_total != null ? Number(quote.billed_total) : Number(quote.total_amount)
        emailPickingFee = Number(quote.picking_fee ?? 0)
        emailPrepaidGoodsValue =
          Math.round(
            Math.max(0, Number(quote.total_amount) - (emailTotalAmount - emailPickingFee)) * 100,
          ) / 100
```

Declare `emailPickingFee` and `emailPrepaidGoodsValue` alongside `emailTotalAmount` (line 1838), both defaulting to `0`. Pass them to `sendOrderConfirmation` (line 1910):

```ts
          pickingFee: emailPickingFee,
          prepaidGoodsValue: emailPrepaidGoodsValue,
```

The `fallbackTotal` at line 1894 is used only when the quote fetch fails; leave it as the goods sum and pass `pickingFee: 0, prepaidGoodsValue: 0` in that case — an email that over-quotes on a failed fetch is the same fail-closed trade as everywhere else.

- [ ] **Step 4: Typecheck and run the suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests pass. If existing email tests assert on the dispatch email's "Total" string, update them to "Goods value" — that rename is the intent, not a regression.

- [ ] **Step 5: Verify by hand**

Place a prepaid order in dev as a **test org**, so both emails route to `jamie@theprint-room.co.nz` (never `jon@`).

Expected:
- Customer email total reads **$17.25**, with `Drawn from pre-paid stock $1,465.20` and `Picking fee $15.00`.
- Staff dispatch email reads **Goods value $1,465.20** — the label changed, the figure did not.

- [ ] **Step 6: Commit**

```bash
git add lib/email/order-confirmation.ts lib/email/order-placed-dispatch.ts lib/checkout/submit.ts
git commit -m "fix(checkout): customer email shows the billed total; staff shows goods

Customer email was showing the goods value for an order we invoice at the
picking fee. Staff dispatch keeps the goods figure — they care what leaves the
building — relabelled Total -> Goods value so it can't be read as an invoice."
```

---

## Manual verification before Deploy 2

The unit tests prove the module; these prove the journey. Run them against dev with a **test org** (`organizations.is_test = true`) so emails route to `jamie@theprint-room.co.nz`.

- [ ] **The whole prepaid journey agrees.** Place 120 × a prepaid stocked variant, NZ ship-to. Every surface must read **$17.25**: `/checkout`, `/checkout/review`, the confirmation page, the customer email. Confirm `quotes.billed_total = 15` and `quotes.picking_fee = 15` for the order, and that `quotes.total_amount` is still `1465.20`.

- [ ] **Staff and Monday still see the goods value.** The dispatch email reads `Goods value $1,465.20`. The Monday deal's total is unchanged from today.

- [ ] **The mixed cart splits.** Add a prepaid stocked line and a made-to-order line. Review shows two groups, two order totals, "You'll receive 2 invoices." Submit creates two orders, and each order's `billed_total` matches its group.

- [ ] **The drift guard fires.** Load `/checkout/review` with a prepaid line, then flip that variant's `billing_mode` to `invoice_on_dispatch` in Supabase, then confirm. Expected: a 409 and the banner "Pre-paid status changed — review your cart." **Then flip it back and re-test in the other direction** — set a billed variant to `prepaid` after the page loads. It must 409 too. Drift that favours the customer is still drift.

- [ ] **Fail-closed holds.** Block `/api/checkout/billing-modes` in devtools and reload `/checkout`. The prepaid order must quote the FULL $1,684.98, not $17.25.

- [ ] **Old orders are untouched.** Open an order placed before this deploy from `my-collections`. It renders exactly as it did — `billed_total` is NULL and the fallback holds.

- [ ] **A normal order is unaffected.** Place a non-prepaid stocked order. Fee and total behave exactly as they do today; no prepaid rows appear anywhere.
