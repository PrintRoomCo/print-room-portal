# Picking-Fee Breakdown Tooltip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show customers *why* the picking fee is what it is — a click-toggled ⓘ popover listing the fee bands (current band highlighted) at the checkout fee row, plus a fee row + the same popover in the cart drawer (whose Total today silently excludes the fee).

**Architecture:** A pure display helper derives band rows from the existing `PICKING_FEE_BANDS` constant so the popover can never drift from the real bands. A dependency-free client component (`PickingFeeInfo`) renders the popover. It mounts in `BilledOrderSummary`'s fee row (covers /checkout and /checkout/review) and in `CartDrawer`, which gains a fee row by threading a new `estimateCartPickingFee()` into its existing `computeOrderBreakdown()` call.

**Tech Stack:** Next.js (app router), React client components, Tailwind, vitest + @testing-library/react (jsdom). No new dependencies.

## Global Constraints

- **GIT IS JON'S — DO NOT commit, push, branch, or merge.** Wherever a normal TDD cycle would commit, instead append the file list to the "What I'd commit" section at the bottom of this plan. (Decision: program guardrails, 2026-07-25.)
- Repo: `/Users/jamierogangeorge/Documents/print-room-portal` (customer portal, **P**). Run all commands from this root.
- No schema — this feature is UI + pure lib only.
- No new npm dependencies (no `@radix-ui/react-tooltip` — the popover is hand-rolled).
- Test command: `npx vitest run <file>` from the repo root.
- `tsc` is **diff-against-baseline**, not hard-zero: P has ~14 pre-existing errors in unrelated test files. Green = no NEW errors in files this plan touches.
- Approved decisions (Jon, 2026-07-25): tooltip on **checkout + cart drawer**; drawer Total **now includes** the fee (accepted visible change); drawer fee is an NZ-assumed estimate, footnote carries the caveat.
- Copy (verbatim): popover heading `Picking fee by goods value`; footnote `Applies to stock-on-hand orders delivered within NZ, based on the order's goods value.`; button aria-label `How the picking fee is calculated`; popover aria-label `Picking fee bands`.

---

### Task 1: Band display helper

**Files:**
- Create: `lib/pricing/picking-fee-display.ts`
- Test: `lib/pricing/picking-fee-display.test.ts`

**Interfaces:**
- Consumes: `PICKING_FEE_BANDS` from `lib/pricing/picking-fee.ts` (`ReadonlyArray<{ maxExclusive: number; fee: number }>` — 100/200/300/400/Infinity → 35/30/25/20/15).
- Produces: `pickingFeeBandRows(): PickingFeeBandRow[]` where `PickingFeeBandRow = { range: string; fee: number }` (ranges `"$0 – $99"` … `"$400+"`), and `activeBandIndex(goodsSubtotal: number): number`. Tasks 2 consumes both.

- [x] **Step 1: Write the failing test**

```ts
// lib/pricing/picking-fee-display.test.ts
import { describe, expect, it } from 'vitest'
import { activeBandIndex, pickingFeeBandRows } from './picking-fee-display'

describe('pickingFeeBandRows', () => {
  it('derives one display row per band with inclusive ranges', () => {
    expect(pickingFeeBandRows()).toEqual([
      { range: '$0 – $99', fee: 35 },
      { range: '$100 – $199', fee: 30 },
      { range: '$200 – $299', fee: 25 },
      { range: '$300 – $399', fee: 20 },
      { range: '$400+', fee: 15 },
    ])
  })
})

describe('activeBandIndex', () => {
  it('maps a goods subtotal to its band', () => {
    expect(activeBandIndex(0)).toBe(0)
    expect(activeBandIndex(99.99)).toBe(0)
    expect(activeBandIndex(100)).toBe(1)
    expect(activeBandIndex(250)).toBe(2)
    expect(activeBandIndex(399.99)).toBe(3)
    expect(activeBandIndex(400)).toBe(4)
    expect(activeBandIndex(10_000)).toBe(4)
  })

  it('treats negative and non-finite input as $0', () => {
    expect(activeBandIndex(-5)).toBe(0)
    expect(activeBandIndex(Number.NaN)).toBe(0)
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/pricing/picking-fee-display.test.ts`
Expected: FAIL — `Cannot find module './picking-fee-display'` (or equivalent resolve error).

- [x] **Step 3: Write minimal implementation**

```ts
// lib/pricing/picking-fee-display.ts
import { PICKING_FEE_BANDS } from './picking-fee'

export interface PickingFeeBandRow {
  /** Inclusive display range, e.g. "$0 – $99" or "$400+". */
  range: string
  fee: number
}

/**
 * Display rows derived from PICKING_FEE_BANDS so the tooltip can never
 * drift from the bands the fee is actually charged on.
 */
export function pickingFeeBandRows(): PickingFeeBandRow[] {
  let start = 0
  return PICKING_FEE_BANDS.map((band) => {
    const range =
      band.maxExclusive === Infinity
        ? `$${start}+`
        : `$${start} – $${band.maxExclusive - 1}`
    const row = { range, fee: band.fee }
    start = band.maxExclusive
    return row
  })
}

/** Index into PICKING_FEE_BANDS for a goods subtotal. Mirrors pickingFeeForGoods clamping. */
export function activeBandIndex(goodsSubtotal: number): number {
  const g = Number.isFinite(goodsSubtotal) ? Math.max(0, goodsSubtotal) : 0
  const index = PICKING_FEE_BANDS.findIndex((band) => g < band.maxExclusive)
  return index === -1 ? PICKING_FEE_BANDS.length - 1 : index
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/pricing/picking-fee-display.test.ts`
Expected: PASS (3 tests).

- [x] **Step 5: Record in "What I'd commit"**

Append `lib/pricing/picking-fee-display.ts` + `lib/pricing/picking-fee-display.test.ts` to the list at the bottom of this plan. **Do not commit.**

---

### Task 2: `PickingFeeInfo` popover component

**Files:**
- Create: `components/pricing/PickingFeeInfo.tsx`
- Test: `components/pricing/PickingFeeInfo.test.tsx`

**Interfaces:**
- Consumes: `pickingFeeBandRows()`, `activeBandIndex(goodsSubtotal)` from Task 1.
- Produces: `<PickingFeeInfo goodsBasis={number} format={(nzdAmount: number) => string} direction?={'up' | 'down'} />` — default `direction="down"`. Tasks 3 and 5 mount it.

- [x] **Step 1: Write the failing test**

Follow the idiom of the existing `components/pricing/PriceBreakdown.test.tsx` (same imports/setup — check it first and mirror its render/expect style if it differs from below).

```tsx
// components/pricing/PickingFeeInfo.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { PickingFeeInfo } from './PickingFeeInfo'

const format = (n: number) => `$${n.toFixed(2)}`

describe('PickingFeeInfo', () => {
  it('is closed until the info button is clicked', async () => {
    render(<PickingFeeInfo goodsBasis={150} format={format} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    await userEvent.click(
      screen.getByRole('button', { name: 'How the picking fee is calculated' }),
    )
    expect(screen.getByRole('dialog', { name: 'Picking fee bands' })).toBeInTheDocument()
  })

  it('lists every band and highlights only the active one', async () => {
    render(<PickingFeeInfo goodsBasis={150} format={format} />)
    await userEvent.click(
      screen.getByRole('button', { name: 'How the picking fee is calculated' }),
    )
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(5)
    expect(rows[1]).toHaveAttribute('data-active')
    expect(rows[1]).toHaveTextContent('$100 – $199')
    expect(rows[1]).toHaveTextContent('$30.00')
    expect(rows[0]).not.toHaveAttribute('data-active')
    expect(rows[4]).not.toHaveAttribute('data-active')
  })

  it('closes on Escape', async () => {
    render(<PickingFeeInfo goodsBasis={0} format={format} />)
    await userEvent.click(
      screen.getByRole('button', { name: 'How the picking fee is calculated' }),
    )
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows the NZ / stock-on-hand caveat', async () => {
    render(<PickingFeeInfo goodsBasis={0} format={format} />)
    await userEvent.click(
      screen.getByRole('button', { name: 'How the picking fee is calculated' }),
    )
    expect(
      screen.getByText(
        'Applies to stock-on-hand orders delivered within NZ, based on the order’s goods value.',
      ),
    ).toBeInTheDocument()
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/pricing/PickingFeeInfo.test.tsx`
Expected: FAIL — module not found.

- [x] **Step 3: Write minimal implementation**

```tsx
// components/pricing/PickingFeeInfo.tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { activeBandIndex, pickingFeeBandRows } from '@/lib/pricing/picking-fee-display'

interface PickingFeeInfoProps {
  /** The goods value the fee band is derived from (partition goodsValueForBand / stocked cart goods). */
  goodsBasis: number
  format: (nzdAmount: number) => string
  /** 'up' when the mount sits at the bottom of an overflow-hidden panel (cart drawer). */
  direction?: 'up' | 'down'
}

export function PickingFeeInfo({ goodsBasis, format, direction = 'down' }: PickingFeeInfoProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const active = activeBandIndex(goodsBasis)

  return (
    <span ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        aria-label="How the picking fee is calculated"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex h-4 w-4 items-center justify-center rounded-full border border-gray-300 text-[10px] font-medium leading-none text-gray-500 transition-colors hover:border-gray-400 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-300"
      >
        i
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Picking fee bands"
          className={`absolute left-0 z-30 w-60 rounded-xl border border-gray-200 bg-white p-3 text-left shadow-lg ${
            direction === 'up' ? 'bottom-full mb-2' : 'top-full mt-2'
          }`}
        >
          <p className="mb-2 text-xs font-medium text-gray-900">Picking fee by goods value</p>
          <ul className="space-y-1">
            {pickingFeeBandRows().map((row, index) => (
              <li
                key={row.range}
                data-active={index === active || undefined}
                className="flex items-baseline justify-between rounded px-1.5 py-0.5 text-xs text-gray-600 data-[active]:bg-gray-100 data-[active]:font-medium data-[active]:text-gray-900"
              >
                <span>{row.range}</span>
                <span className="tabular-nums">{format(row.fee)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] leading-snug text-gray-500">
            Applies to stock-on-hand orders delivered within NZ, based on the order&rsquo;s goods
            value.
          </p>
        </div>
      )}
    </span>
  )
}
```

Note the footnote renders `&rsquo;` (curly apostrophe) — the test asserts the curly form `order’s`.

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/pricing/PickingFeeInfo.test.tsx`
Expected: PASS (4 tests).

- [x] **Step 5: Record in "What I'd commit"**

Append both files. **Do not commit.**

---

### Task 3: Mount in the checkout fee row (`BilledOrderSummary`)

**Files:**
- Modify: `components/checkout/BilledOrderSummary.tsx` (`PartitionRows`, the `partition.pickingFee > 0` block — currently `<Row label="Picking fee" … />` at ~line 153)
- Test: `components/checkout/BilledOrderSummary.pickingfee.test.tsx`

**Interfaces:**
- Consumes: `PickingFeeInfo` (Task 2); `partition.goodsValueForBand` + `partition.pickingFee` from `lib/pricing/order-billing-shape.ts` (already on `BilledPartition`); real `billedOrderShape()` for the test fixture.
- Produces: nothing new — a UI mount. Covers both /checkout and /checkout/review (both render `BilledOrderSummary`).

- [x] **Step 1: Write the failing test**

```tsx
// components/checkout/BilledOrderSummary.pickingfee.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { billedOrderShape } from '@/lib/pricing/order-billing-shape'
import { BilledOrderSummary } from './BilledOrderSummary'

const format = (n: number) => `$${n.toFixed(2)}`

function shapeFor(shipCountry: string) {
  // qty 10 × $12 all-in = $120 goods → NZ stock order lands in the $100–$199 band ($30 fee).
  return billedOrderShape({
    lines: [
      {
        lineId: 'l1',
        qty: 10,
        unitPrice: 12,
        decorationPerUnit: 0,
        fulfilmentType: 'stocked' as const,
        billingMode: null,
      },
    ],
    gstRate: 0.15,
    shipCountry,
  })
}

describe('BilledOrderSummary picking-fee info', () => {
  it('mounts the info button beside the fee row for an NZ stock order', () => {
    render(
      <BilledOrderSummary
        shape={shapeFor('New Zealand')}
        format={format}
        renderLine={(line) => <span>{line.lineId}</span>}
        defaultBreakdownOpen
      />,
    )
    expect(
      screen.getByRole('button', { name: 'How the picking fee is calculated' }),
    ).toBeInTheDocument()
  })

  it('renders no info button when there is no fee (non-NZ ship-to)', () => {
    render(
      <BilledOrderSummary
        shape={shapeFor('Australia')}
        format={format}
        renderLine={(line) => <span>{line.lineId}</span>}
        defaultBreakdownOpen
      />,
    )
    expect(
      screen.queryByRole('button', { name: 'How the picking fee is calculated' }),
    ).toBeNull()
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/checkout/BilledOrderSummary.pickingfee.test.tsx`
Expected: FAIL — first test can't find the button (fee row renders plain `Row`, no info button yet). Second test may already pass; that's fine.

- [x] **Step 3: Write minimal implementation**

In `components/checkout/BilledOrderSummary.tsx`:

Add the import at the top:

```tsx
import { PickingFeeInfo } from '@/components/pricing/PickingFeeInfo'
```

Replace the fee-row block inside `PartitionRows`:

```tsx
      {partition.pickingFee > 0 && (
        <Row label="Picking fee" value={partition.pickingFee} format={format} />
      )}
```

with:

```tsx
      {partition.pickingFee > 0 && (
        <div className="flex items-baseline justify-between">
          <span className="flex items-center gap-1.5 text-gray-700">
            Picking fee
            <PickingFeeInfo goodsBasis={partition.goodsValueForBand} format={format} />
          </span>
          <span className="font-medium tabular-nums text-gray-900">
            {format(partition.pickingFee)}
          </span>
        </div>
      )}
```

(The spans mirror `Row`'s non-bold, non-muted classes exactly, so the row's look is unchanged.)

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/checkout/BilledOrderSummary.pickingfee.test.tsx`
Expected: PASS (2 tests).

- [x] **Step 5: Guard against regressions in neighbours**

Run: `npx vitest run lib/pricing/order-billing-shape.test.ts lib/pricing/order-billing-shape.xero-parity.test.ts`
Expected: PASS — Task 3 must not change any billing math.

- [x] **Step 6: Record in "What I'd commit"**

Append the modified + new test file. **Do not commit.**

---

### Task 4: Drawer fee estimate helpers

**Files:**
- Modify: `lib/pricing/order-picking-fee.ts` (append two exports)
- Test: `lib/pricing/order-picking-fee.test.ts` (append a describe block — do not touch existing tests)

**Interfaces:**
- Consumes: `pickingFeeForGoods` (already imported in this file), `round2` from `./pricingMath`, `allInUnitPrice` + `CartLine` type from `@/lib/cart/types`.
- Produces: `stockedGoodsValue(lines: CartLine[]): number` and `estimateCartPickingFee(lines: CartLine[]): number`. Task 5 consumes both.

- [x] **Step 1: Write the failing test**

Append to `lib/pricing/order-picking-fee.test.ts` (mirror the file's existing import style — it already imports from `./order-picking-fee`):

```ts
import type { CartLine } from '@/lib/cart/types'
import { estimateCartPickingFee, stockedGoodsValue } from './order-picking-fee'

function cartLine(over: Partial<CartLine>): CartLine {
  return {
    lineId: 'l1',
    productId: 'p1',
    productName: 'Tee',
    variantId: 'v1',
    variantLabel: 'Black',
    qty: 1,
    unitPrice: 10,
    imageUrl: null,
    decorations: [],
    fulfilmentType: 'stocked',
    ...over,
  }
}

describe('stockedGoodsValue / estimateCartPickingFee', () => {
  it('sums only stocked lines at the all-in unit price', () => {
    const lines = [
      cartLine({ lineId: 'a', qty: 5, unitPrice: 20 }), // stocked: $100
      cartLine({ lineId: 'b', qty: 10, unitPrice: 50, fulfilmentType: 'made_to_order' }),
    ]
    expect(stockedGoodsValue(lines)).toBe(100)
    expect(estimateCartPickingFee(lines)).toBe(30) // $100–$199 band
  })

  it('folds decoration unit prices into the goods value', () => {
    const lines = [
      cartLine({
        qty: 10,
        unitPrice: 8,
        decorations: [
          {
            linkId: 'lk1',
            decorationId: 'd1',
            name: 'Emb',
            method: 'embroidery',
            positionLabel: null,
            unitPrice: 2,
            artworkUrl: null,
            snapshotUrl: null,
          },
        ],
      }),
    ]
    expect(stockedGoodsValue(lines)).toBe(100) // 10 × ($8 + $2)
    expect(estimateCartPickingFee(lines)).toBe(30)
  })

  it('excludes legacy lines without a fulfilmentType (they submit as purchase orders)', () => {
    const lines = [cartLine({ fulfilmentType: undefined, qty: 10, unitPrice: 10 })]
    expect(stockedGoodsValue(lines)).toBe(0)
    expect(estimateCartPickingFee(lines)).toBe(0)
  })

  it('returns 0 fee for an empty or PO-only cart (no fee row shown)', () => {
    expect(estimateCartPickingFee([])).toBe(0)
    expect(
      estimateCartPickingFee([cartLine({ fulfilmentType: 'made_to_order' })]),
    ).toBe(0)
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/pricing/order-picking-fee.test.ts`
Expected: new tests FAIL — `stockedGoodsValue` not exported. Pre-existing tests still PASS.

- [x] **Step 3: Write minimal implementation**

Append to `lib/pricing/order-picking-fee.ts`:

```ts
import { allInUnitPrice, type CartLine } from '@/lib/cart/types'
import { round2 } from './pricingMath'
```

(merge into the existing import block at the top of the file), then:

```ts
/**
 * Goods value of the cart's STOCKED lines — the drawer-side picking-fee band
 * basis. Mirrors order-billing-shape's goodsValueForBand: full all-in value,
 * per-line rounding then a rounded sum; lines without a fulfilmentType submit
 * as purchase orders, so they are excluded here too.
 */
export function stockedGoodsValue(lines: CartLine[]): number {
  return round2(
    lines
      .filter((line) => line.fulfilmentType === 'stocked')
      .reduce((total, line) => total + round2(line.qty * allInUnitPrice(line)), 0),
  )
}

/**
 * Drawer-side fee estimate. Assumes an NZ ship-to (the drawer cannot know the
 * address yet; checkout recomputes with the real one). 0 when the cart has no
 * stocked goods — the drawer then shows no fee row.
 */
export function estimateCartPickingFee(lines: CartLine[]): number {
  const goods = stockedGoodsValue(lines)
  if (goods <= 0) return 0
  return pickingFeeForGoods(goods)
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/pricing/order-picking-fee.test.ts`
Expected: PASS — all pre-existing + 4 new tests.

- [x] **Step 5: Record in "What I'd commit"**

Append the two modified files. **Do not commit.**

---

### Task 5: Cart drawer — fee row + fee-inclusive Total

**Files:**
- Modify: `components/cart/CartDrawer.tsx` (breakdown `useMemo` at ~lines 41-52; footer block at ~lines 95-123)

**Interfaces:**
- Consumes: `stockedGoodsValue`, `estimateCartPickingFee` (Task 4); `PickingFeeInfo` with `direction="up"` (Task 2 — the drawer's footer is at the bottom of an `overflow-hidden` panel, a downward popover would clip); existing `computeOrderBreakdown`'s optional `pickingFee` input.
- Produces: nothing consumed later — final wiring. **Accepted visible change:** the drawer Total now includes the fee.

- [x] **Step 1: Modify the breakdown computation**

In `components/cart/CartDrawer.tsx`, add imports:

```tsx
import { estimateCartPickingFee, stockedGoodsValue } from '@/lib/pricing/order-picking-fee'
import { PickingFeeInfo } from '@/components/pricing/PickingFeeInfo'
```

Replace the `breakdown` memo:

```tsx
  const breakdown = useMemo(
    () =>
      computeOrderBreakdown({
        lines: cart.lines.map((line) => ({
          qty: line.qty,
          unitEffective: line.unitPrice,
          decorationPerUnit: decorationPerUnit(line),
        })),
        gstRate: 0.15,
        pickingFee: estimateCartPickingFee(cart.lines),
      }),
    [cart.lines],
  )
  const stockedGoods = useMemo(() => stockedGoodsValue(cart.lines), [cart.lines])
```

- [x] **Step 2: Add the fee row above the Total**

In the sticky footer, insert between `<PeriodSavingsBar …/>` and the existing Total `div`:

```tsx
              {breakdown.pickingFee > 0 && (
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="flex items-center gap-1.5 text-sm text-gray-500">
                    Picking fee
                    <PickingFeeInfo goodsBasis={stockedGoods} format={format} direction="up" />
                  </span>
                  <span className="text-sm tabular-nums text-gray-700">
                    {format(breakdown.pickingFee)}
                  </span>
                </div>
              )}
```

- [x] **Step 3: Verify the wiring type-checks and nothing regressed**

Run: `npx tsc --noEmit 2>&1 | grep -E "CartDrawer|PickingFeeInfo|BilledOrderSummary|picking-fee" ; npx vitest run lib/pricing components/pricing components/checkout/BilledOrderSummary.pickingfee.test.tsx`
Expected: no tsc errors in the touched files; all listed vitest suites PASS.

(The drawer's fee logic is pure and covered by Task 4; the popover by Task 2. The drawer itself is thin wiring behind several context providers — no new component test. Manual smoke happens at the Task 6 checkpoint.)

- [x] **Step 4: Record in "What I'd commit"**

Append `components/cart/CartDrawer.tsx`. **Do not commit.**

---

### Task 6: Full-suite gate + hand-off note

**Files:**
- Modify: this plan (check boxes, fill "What I'd commit")

- [x] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — same pass/fail profile as the pre-work baseline (record the baseline count before Task 1 if not already noted).

- [x] **Step 2: Run tsc against baseline**

Run: `npx tsc --noEmit 2>&1 | tail -5`
Expected: only the ~14 pre-existing errors in unrelated test files; NO errors in any file this plan touched.

- [x] **Step 3: Complete the hand-off note below and checkpoint with Jon**

---

## What I'd commit (running list — Jon executes)

_All executed 2026-07-25 — suite green (1036 passed; 1 pre-existing failure in ProductDetailClient.fulfilment-fallback.test.tsx, confirmed failing on pristine main @494f2ca), tsc = 14-error baseline unchanged._

- [x] `lib/pricing/picking-fee-display.ts` (new)
- [x] `lib/pricing/picking-fee-display.test.ts` (new)
- [x] `components/pricing/PickingFeeInfo.tsx` (new)
- [x] `components/pricing/PickingFeeInfo.test.tsx` (new)
- [x] `components/checkout/BilledOrderSummary.tsx` (modified — fee row mounts info button)
- [x] `components/checkout/BilledOrderSummary.pickingfee.test.tsx` (new)
- [x] `lib/pricing/order-picking-fee.ts` (modified — drawer estimate helpers)
- [x] `lib/pricing/order-picking-fee.test.ts` (modified — new describe block)
- [x] `components/cart/CartDrawer.tsx` (modified — fee row + fee-inclusive Total)
- [x] `docs/superpowers/plans/2026-07-25-picking-fee-tooltip.md` (this plan)
- [x] `docs/2026-07-22-chris-client-features-strategy.md` (Phase 0 decisions appended)

**Suggested branch:** `feat/picking-fee-tooltip` off `main` — ⚠️ repoint upstream to `origin/feat/picking-fee-tooltip` immediately after branching (both repos auto-push to the branch upstream).

**Go-live:** no flags, no schema, no env — deploys with the next customer-portal deploy. Visible change to note in the PR: cart-drawer Total now includes the NZ picking-fee estimate.
