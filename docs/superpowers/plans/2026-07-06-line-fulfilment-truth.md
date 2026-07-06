# Line Fulfilment Truth (fix `fulfilmentType: 'stocked'` default) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A cart line may only claim `fulfilmentType: 'stocked'` when a stock draw is actually possible; everything else is `'made_to_order'` — fixed at the PDP decision (client) AND enforced by a server-side coercion in checkout submit (defense-in-depth against stale persisted carts).

**Architecture:** Two thin layers, no schema change. (1) Extract the PDP's inline fulfilment ternary into a pure, unit-tested `lineFulfilment()` helper in `lib/shop/fulfilment-mode.ts` whose default is `made_to_order` and which gates `'stocked'` on `orderingOptions().canDrawStock` + per-cell inventory tracking — mirroring what the `submit_b2b_order` RPC already does server-side. (2) In `lib/checkout/submit.ts`, coerce any line CLAIMING `'stocked'` back to `'made_to_order'` when the product's effective nature (catalogue override ?? product base) forbids a draw, before the MOQ guard and the Xero `draws_stock` gate consume the flag.

**Tech Stack:** Next.js App Router, TypeScript strict, Vitest (jsdom + @testing-library/react), Supabase (no migration needed), pnpm.

**Repos:** `print-room-portal` ONLY. `staff-print-room-portal` verified needs NO change (see "What is deliberately NOT changing").

---

## Context for the implementer (read this first)

### The bug

`components/shop/ProductDetailClient.tsx` decides each cart line's `fulfilmentType` at add-to-cart. The current decision (Mode 1 at :936–944, Mode 3 at :1028–1036) is:

```ts
const fulfilmentType: 'stocked' | 'made_to_order' = canChooseOrderIntent
  ? orderIntent === 'bulk' ? 'made_to_order' : 'stocked'
  : backorderable            ? 'made_to_order'
  : tracked && lineQty > available ? 'made_to_order'
  : 'stocked'   // ← BUG: the default
```

Every `'made_to_order'` route requires inventory-tracking signals. A **made_to_order product whose variant is NOT inventory-tracked** (the normal case for production products — no `variant_inventory` row → `tracked === false`) falls through every branch to `'stocked'`.

`'stocked'` is a stock-DRAW claim consumed by three things in this repo:

1. **MOQ guard** — `lib/checkout/submit.ts:402` and `:436` skip `'stocked'` lines → mis-tagged production lines silently bypass MOQ.
2. **Xero draws_stock gate** — `lib/checkout/submit.ts:1411` (`input.lines.some((l) => l.fulfilment_type === 'stocked')`) → every normal production order is flagged `manual_review` instead of auto-drafting an invoice. This is how the bug was found (order TEST-000080, 2026-07-06: all five lines are `made_to_order`-nature products, one got tagged `'stocked'`).
3. **Cart UI** — `lineSignature()` (`lib/cart/types.ts:170`) keys line merging on it; `CartTable.tsx:93–99` oversell guard skips `made_to_order` lines (no behavioural change for untracked lines either way, because `avail === undefined` → guard never fires).

### Why the blast radius is smaller than it looks (verified 2026-07-06)

- **The DB never stores the client flag.** `quote_items` has NO `fulfilment_type` column — it has `qty_from_stock`/`qty_to_make`, written by the `submit_b2b_order` RPC (staff repo, migration `20260618160000_submit_b2b_order_member_permission.sql`), which re-resolves fulfilment SERVER-SIDE from `b2b_catalogue_items.fulfilment_type_override ?? products.fulfilment_type` and only touches `variant_inventory` for `stocked`/`mixed`/`pre_order` natures. Made_to_order never draws. → **No inventory corruption happened; no backfill needed.**
- **Reorder rebuild is already correct.** `lib/reorder/rebuild.ts:61–63` derives the rebuilt line's fulfilmentType from the server-truth `qty_to_make > 0`, not from the old client flag.
- **Prod damage:** exactly one order flagged `xero_invoice_status='manual_review'` since Xero went live (TEST-000080, org "Test Account"). It's a test order; no cleanup required.

### The fix rule (mirrors the RPC)

A line claims `'stocked'` **iff** a draw is actually possible:
- product nature allows a draw (`stocked`/`mixed`) AND the member may draw (`orderingOptions().canDrawStock`), AND
- either the org_admin toggle explicitly chose From-inventory, OR the specific cell is tracked with `lineQty <= available`.

Default in all other cases: `'made_to_order'`.

### Decision matrix (fallback path, i.e. no toggle shown)

| nature × member (`canDrawStock`) | cell tracked? | backorderable? | qty vs stock | OLD tag | NEW tag |
|---|---|---|---|---|---|
| draw not allowed (made_to_order product, or reorder_only member) | no | — | — | **stocked ← BUG** | made_to_order |
| draw not allowed | yes | — | any | qty>avail: MTO / else **stocked ← BUG** | made_to_order |
| draw allowed (stocked/mixed × stock_only/both) | yes | no | qty ≤ avail | stocked | stocked (unchanged) |
| draw allowed | yes | no | qty > avail | made_to_order | made_to_order (unchanged) |
| draw allowed | yes | yes | any | made_to_order | made_to_order (unchanged) |
| draw allowed | no | — | — | **stocked** | made_to_order (defensive; UI already blocks these adds — untracked cells are filtered/short-falled in inventory mode) |

Toggle path (`canChooseOrderIntent === true`, org_admin on a product with stock + tiers): **unchanged** — `bulk → made_to_order`, `inventory → stocked`, and the overflow-split block (:916–932, :994–1026) stays exactly as is.

### What is deliberately NOT changing (do not "fix" these)

- **staff-print-room-portal:** zero changes. The RPC is already nature-based; staff UI reads `qty_from_stock`/`qty_to_make`, never a line fulfilment flag; `src/lib/monday/deal-item.ts` doesn't send fulfilment.
- **Mode 2 (variantless multi-size) hardcodes `fulfilmentType: 'made_to_order'`** at `ProductDetailClient.tsx:973` — that is exactly what `lineFulfilment()` would return (variantless ⇒ never tracked ⇒ no toggle), so leave the hardcode alone.
- **Order-level checkout `intent` (`'customer' | 'inventory'`)** and step 4b `mark_inventory_received` — a different axis (destination, not production signal). Untouched.
- **`lineSignature` default param `= 'stocked'`** in `lib/cart/types.ts:175` — a legacy-line display default, not a decision site. Untouched.
- **Pre-existing gaps that are OUT OF SCOPE** (note for Jon, do not bundle):
  - stock_only member + backorderable variant: PDP allows the add, RPC raises `PERMISSION_DENIED` (`v_variant_allow_no_stock` check).
  - stocked-nature product + backorderable oversell: RPC raises `INSUFFICIENT_STOCK` (no server backorder path).
  - Stale localStorage carts keep their old (wrong) tag for cart display/merging until re-added — cosmetic only; Task 3's server coercion neutralises the checkout effects (MOQ + Xero).
- **`orders.xero_invoice_status='manual_review'` on TEST-000080** — leave it; it's the smoke-test order.

### Branch / worktree discipline

- Build in an isolated git worktree (`superpowers:using-git-worktrees`) off **origin/main**, branch `fix/line-fulfilment-truth`. A concurrent session may share the main working dir — never work there.
- `git status -sb` before EVERY commit; commit with explicit pathspecs only (`git add <named files>` / `git commit -- <files>`); never plain `git add .`.
- Do not push to main; do not merge. Push the branch + open a PR at the end (Task 4).

---

### Task 1: Pure `lineFulfilment()` helper

**Files:**
- Modify: `lib/shop/fulfilment-mode.ts` (append at end of file)
- Create: `lib/shop/__tests__/line-fulfilment.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/shop/__tests__/line-fulfilment.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { lineFulfilment, type LineFulfilmentContext } from '../fulfilment-mode'

function ctx(overrides: Partial<LineFulfilmentContext> = {}): LineFulfilmentContext {
  return {
    canDrawStock: true,
    canChooseOrderIntent: false,
    orderIntent: 'inventory',
    tracked: true,
    available: 10,
    backorderable: false,
    lineQty: 5,
    ...overrides,
  }
}

describe('lineFulfilment', () => {
  // Toggle path — unchanged behaviour, toggle choice wins.
  it('toggle + bulk → made_to_order', () => {
    expect(
      lineFulfilment(ctx({ canChooseOrderIntent: true, orderIntent: 'bulk' })),
    ).toBe('made_to_order')
  })
  it('toggle + inventory → stocked', () => {
    expect(
      lineFulfilment(ctx({ canChooseOrderIntent: true, orderIntent: 'inventory' })),
    ).toBe('stocked')
  })

  // THE BUG: no draw path (made_to_order product / reorder_only member) must
  // never claim a stock draw — regardless of tracking state.
  it('no draw path + untracked cell → made_to_order (regression: TEST-000080)', () => {
    expect(
      lineFulfilment(ctx({ canDrawStock: false, tracked: false, available: 0 })),
    ).toBe('made_to_order')
  })
  it('no draw path + tracked cell with plenty of stock → made_to_order', () => {
    expect(
      lineFulfilment(ctx({ canDrawStock: false, tracked: true, available: 100, lineQty: 5 })),
    ).toBe('made_to_order')
  })

  // Drawable product, per-cell routing — unchanged behaviour.
  it('drawable + backorderable → made_to_order', () => {
    expect(lineFulfilment(ctx({ backorderable: true }))).toBe('made_to_order')
  })
  it('drawable + tracked + qty within stock → stocked', () => {
    expect(lineFulfilment(ctx({ tracked: true, available: 10, lineQty: 5 }))).toBe('stocked')
  })
  it('drawable + tracked + qty over stock → made_to_order', () => {
    expect(lineFulfilment(ctx({ tracked: true, available: 4, lineQty: 5 }))).toBe('made_to_order')
  })

  // Flipped default: drawable product but THIS cell has no inventory row —
  // there is nothing to draw, so it is a production run.
  it('drawable + untracked cell → made_to_order', () => {
    expect(lineFulfilment(ctx({ tracked: false, available: 0 }))).toBe('made_to_order')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/shop/__tests__/line-fulfilment.test.ts`
Expected: FAIL — `lineFulfilment` is not exported from `../fulfilment-mode` (SyntaxError/TypeError at import).

- [ ] **Step 3: Write minimal implementation**

Append to `lib/shop/fulfilment-mode.ts` (after `orderingOptions`, end of file):

```ts
/** Context for the per-line fulfilment decision on the PDP add-to-cart paths. */
export interface LineFulfilmentContext {
  /** orderingOptions().canDrawStock — product nature × member permission. */
  canDrawStock: boolean
  /** True when the PDP offers the From-inventory / Reorder toggle for this selection. */
  canChooseOrderIntent: boolean
  /** The toggle's current value; ignored when there is no toggle. */
  orderIntent: 'inventory' | 'bulk'
  /** This (colourway, size) cell has an inventory row (variant_inventory). */
  tracked: boolean
  /** Available qty for the cell; 0 when untracked. */
  available: number
  /** allow_order_without_stock for the cell. */
  backorderable: boolean
  lineQty: number
}

/**
 * Which fulfilment a cart line should claim. 'stocked' is a stock-DRAW claim:
 * it exempts the line from MOQ and trips the Xero draws_stock gate at submit,
 * so it may only be claimed when a draw is actually possible — the viewer can
 * draw this product (nature stocked/mixed × member permission) AND either the
 * org_admin toggle chose From-inventory or the cell is tracked with enough
 * stock. Everything else is a production run. Mirrors submit_b2b_order, which
 * never draws inventory for made_to_order/pre_order natures. (Fix 2026-07-06:
 * the old inline ternary DEFAULTED to 'stocked', mis-tagging untracked
 * made_to_order lines and blocking Xero auto-drafts.)
 */
export function lineFulfilment(ctx: LineFulfilmentContext): 'stocked' | 'made_to_order' {
  if (ctx.canChooseOrderIntent) {
    return ctx.orderIntent === 'bulk' ? 'made_to_order' : 'stocked'
  }
  if (!ctx.canDrawStock) return 'made_to_order'
  if (ctx.backorderable) return 'made_to_order'
  if (ctx.tracked) return ctx.lineQty > ctx.available ? 'made_to_order' : 'stocked'
  return 'made_to_order'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run lib/shop/__tests__/line-fulfilment.test.ts`
Expected: PASS (8 tests).

Also run the sibling suites to prove no drift: `pnpm vitest run lib/shop/__tests__/fulfilment-mode.test.ts lib/shop/__tests__/ordering-options.test.ts`
Expected: PASS (unchanged).

- [ ] **Step 5: Commit**

```bash
git status -sb   # verify: on fix/line-fulfilment-truth, only the two named files changed
git add lib/shop/fulfilment-mode.ts lib/shop/__tests__/line-fulfilment.test.ts
git commit -m "feat: add lineFulfilment() — nature-gated per-line fulfilment decision"
```

---

### Task 2: Wire the helper into the PDP (Modes 1 + 3)

**Files:**
- Modify: `components/shop/ProductDetailClient.tsx:934–944` (Mode 1) and `:1028–1036` (Mode 3) + the fulfilment-mode import
- Create: `components/shop/__tests__/ProductDetailClient.fulfilment-fallback.test.tsx`

**Touch ONLY these named files.** Do not reformat surrounding code.

- [ ] **Step 1: Write the failing test**

Create `components/shop/__tests__/ProductDetailClient.fulfilment-fallback.test.tsx` (harness cloned from `ProductDetailClient.inventory-overflow.test.tsx`, with `fulfilment_type: 'made_to_order'` and EMPTY availability — the untracked production product):

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProductDetailClient } from '../ProductDetailClient'

const { addLine } = vi.hoisted(() => ({ addLine: vi.fn() }))
vi.mock('@/components/cart/useCart', () => ({ useCart: () => ({ addLine }) }))
vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({ format: (n: number) => `$${n}` }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ back: vi.fn() }) }))

const baseProduct = {
  id: 'p1',
  name: 'Acrylic Cap',
  description: null,
  image_url: null,
  moq: 24,
  lead_time_days: 7,
  sizing_type: 'multi_size_with_variants',
  decoration_methods: null,
  decoration_price: null,
  sku: null,
  safety_standard: null,
  specs: null,
  supports_labels: null,
  garment_family: null,
  default_sizes: null,
  brand_name: null,
  category_name: null,
  catalogueItemId: 'i1',
  catalogueVariantLabel: null,
}

const variants = [
  {
    variant_id: 'red-s',
    color_swatch_id: 'red',
    color_label: 'Red',
    color_hex: '#f00',
    color_position: 0,
    size_id: 1,
    size_label: 'S',
    size_order: 0,
  },
]

const SIZES = [{ size_id: 1, size_label: 'S', size_order: 0 }]

function renderPDP(
  role: 'org_admin' | 'staff' = 'org_admin',
  orderingPermission: 'stock_only' | 'reorder_only' | 'both' = 'both',
) {
  return render(
    <ProductDetailClient
      product={{ ...baseProduct, fulfilment_type: 'made_to_order' }}
      variants={variants}
      sizes={SIZES}
      brackets={[{ min_quantity: 1, max_quantity: null, unit_price: 10 }]}
      availability={{} as never} // production product: NO inventory rows anywhere
      organizationId="o1"
      customerRole={role}
      orderingPermission={orderingPermission}
      images={[]}
      colourOptions={[]}
      decorations={[]}
      effectiveMoq={24}
    />,
  )
}

beforeEach(() => {
  addLine.mockClear()
  // Pricing is fetched (debounced) before Add-to-cart enables. Stub it OK.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: 'ok', unit_price: 10 }),
    })),
  )
})

describe('PDP fulfilment fallback — untracked made_to_order product', () => {
  it('org_admin add tags the line made_to_order, NOT stocked (regression: TEST-000080)', async () => {
    renderPDP('org_admin', 'both')
    fireEvent.change(screen.getByLabelText('Quantity for size S'), {
      target: { value: '24' }, // meets MOQ 24 (activeMoq applies: not inventory mode)
    })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /add to cart/i })).toBeEnabled(),
    )
    fireEvent.click(screen.getByRole('button', { name: /add to cart/i }))

    expect(addLine).toHaveBeenCalledTimes(1)
    expect(addLine).toHaveBeenCalledWith(
      expect.objectContaining({
        variantId: 'red-s',
        qty: 24,
        fulfilmentType: 'made_to_order',
      }),
    )
  })

  it('reorder_only staff add also tags made_to_order', async () => {
    renderPDP('staff', 'reorder_only')
    fireEvent.change(screen.getByLabelText('Quantity for size S'), {
      target: { value: '24' },
    })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /add to cart/i })).toBeEnabled(),
    )
    fireEvent.click(screen.getByRole('button', { name: /add to cart/i }))

    expect(addLine).toHaveBeenCalledTimes(1)
    expect(addLine).toHaveBeenCalledWith(
      expect.objectContaining({ fulfilmentType: 'made_to_order' }),
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run components/shop/__tests__/ProductDetailClient.fulfilment-fallback.test.tsx`
Expected: FAIL — both tests receive `fulfilmentType: 'stocked'` (the bug).

- [ ] **Step 3: Implement — replace the two inline ternaries**

In `components/shop/ProductDetailClient.tsx`:

3a. Add `lineFulfilment` to the existing import from `@/lib/shop/fulfilment-mode` (the statement currently importing `effectivePermission, orderingOptions`, around line 23–27).

3b. Replace the Mode 1 block (currently :934–945):

OLD:
```ts
          // Fulfilment decision: toggle choice wins for org_admin; buyer/no-toggle
          // auto-routes backorderable to made_to_order, else stock-vs-qty.
          const fulfilmentType: 'stocked' | 'made_to_order' = canChooseOrderIntent
            ? orderIntent === 'bulk'
              ? 'made_to_order'
              : 'stocked'
            : backorderable
              ? 'made_to_order'
              : tracked && lineQty > available
                ? 'made_to_order'
                : 'stocked'
          cart.addLine({ ...baseLine, qty: lineQty, fulfilmentType })
```

NEW:
```ts
          // Fulfilment decision: toggle choice wins for org_admin; otherwise a
          // line only claims a stock draw when one is actually possible —
          // drawable product (nature × permission) + tracked cell with enough
          // stock. Untracked cells of made_to_order products are production
          // runs, NOT 'stocked' (fix 2026-07-06; see lineFulfilment).
          const fulfilmentType = lineFulfilment({
            canDrawStock: options.canDrawStock,
            canChooseOrderIntent,
            orderIntent,
            tracked,
            available,
            backorderable,
            lineQty,
          })
          cart.addLine({ ...baseLine, qty: lineQty, fulfilmentType })
```

3c. Replace the Mode 3 block (currently :1028–1036):

OLD:
```ts
    const oneSizeFulfilment: 'stocked' | 'made_to_order' = canChooseOrderIntent
      ? orderIntent === 'bulk'
        ? 'made_to_order'
        : 'stocked'
      : selectedVariantBackorderable
        ? 'made_to_order'
        : tracksThisVariant && qty > (availableQty ?? 0)
          ? 'made_to_order'
          : 'stocked'
```

NEW:
```ts
    const oneSizeFulfilment = lineFulfilment({
      canDrawStock: options.canDrawStock,
      canChooseOrderIntent,
      orderIntent,
      tracked: tracksThisVariant,
      available: availableQty ?? 0,
      backorderable: selectedVariantBackorderable,
      lineQty: qty,
    })
```

Leave the overflow-split blocks (:916–932 and :994–1026) and the Mode 2 hardcode (:973) untouched.

- [ ] **Step 4: Run tests to verify pass + no regressions**

Run: `pnpm vitest run components/shop/__tests__/ProductDetailClient.fulfilment-fallback.test.tsx`
Expected: PASS (2 tests).

Run: `pnpm vitest run components/shop/__tests__`
Expected: same pass/fail set as before this task EXCEPT the new file passing — the only pre-existing failure in this directory is the known `ProductDetailClient.manual-pricing` baseline failure. The inventory-overflow suites (`.test.tsx` and `.onesize.test.tsx`) MUST still pass (they cover the unchanged toggle/overflow/tracked paths).

- [ ] **Step 5: Commit**

```bash
git status -sb   # verify branch + only the two named files
git add components/shop/ProductDetailClient.tsx components/shop/__tests__/ProductDetailClient.fulfilment-fallback.test.tsx
git commit -m "fix: PDP fulfilment fallback — untracked/made_to_order lines are production runs, not 'stocked'"
```

---

### Task 3: Server-side fulfilment truth in checkout submit

**Files:**
- Modify: `lib/checkout/submit.ts:377–455` (the 1c MOQ-guard section — extend the two selects, add the coercion loop, move the production-qty map below it)
- Create: `lib/checkout/__tests__/submit.fulfilment-truth.test.ts`

Why: carts persist in localStorage — lines tagged `'stocked'` by the OLD client code will keep arriving after deploy, and a hostile client can claim anything. The server must not trust the flag for products whose nature forbids a draw. The Xero gate at :1411 reads the same `input.lines`, so coercing in place fixes MOQ + Xero in one spot.

- [ ] **Step 1: Write the failing test**

Create `lib/checkout/__tests__/submit.fulfilment-truth.test.ts`. The Supabase stub + fixtures are cloned from `submit.pre-approved-inventory.test.ts` (same table-keyed select matcher); the deltas are `moqExempt: false`, `moq: 24`, a `fulfilment_type` on the products row, and a mocked Xero orchestrator:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks (hoisted) — same shape as submit.pre-approved-inventory.test.ts, plus
// the Xero orchestrator so we can assert the drawsStock input it receives.
// ---------------------------------------------------------------------------

vi.mock('@/lib/monday/deal-item', () => ({
  pushOrderDeal: vi.fn().mockResolvedValue({ itemId: 'mky-1', subitemIds: {} }),
}))

vi.mock('@/lib/email/order-confirmation', () => ({
  sendOrderConfirmation: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('@/lib/proofs/autofill-for-order', () => ({
  autofillProofForOrder: vi.fn().mockResolvedValue({ proofId: null, skipped: null }),
}))

vi.mock('@/lib/monday/updates', () => ({
  postItemUpdate: vi.fn().mockResolvedValue(undefined),
}))

const { createDraftInvoiceForOrder } = vi.hoisted(() => ({
  createDraftInvoiceForOrder: vi
    .fn()
    .mockResolvedValue({ status: 'skipped', reason: 'disabled' }),
}))
vi.mock('@/lib/xero/draft-invoice', () => ({ createDraftInvoiceForOrder }))

import {
  submitCustomerOrder,
  MoqViolationError,
  type CheckoutInput,
} from '../submit'

type AnyRow = Record<string, unknown>

interface RecordedWrite {
  table: string
  op: 'insert' | 'update'
  payload: AnyRow | AnyRow[]
  filters: Array<{ column: string; value: unknown }>
}

interface SelectResponse {
  data: AnyRow | AnyRow[] | null
  error: { message: string } | null
}

interface SelectMatcher {
  table: string
  response: SelectResponse
}

interface RpcCallRecord {
  name: string
  args: AnyRow | undefined
}

function makeSupabaseStub(opts: {
  selects: SelectMatcher[]
  rpc: (name: string, args: AnyRow | undefined, callIndex: number) => {
    data: unknown
    error: { message: string } | null
  }
}) {
  const writes: RecordedWrite[] = []
  const rpcCalls: RpcCallRecord[] = []

  function builderFor(table: string) {
    const filters: Array<{ column: string; value: unknown }> = []
    let pendingWrite: { op: 'insert' | 'update'; payload: AnyRow | AnyRow[] } | null = null

    const matchSelect = (): SelectResponse =>
      opts.selects.find((m) => m.table === table)?.response ?? { data: [], error: null }

    const settle = (): SelectResponse => {
      if (pendingWrite) {
        writes.push({ table, op: pendingWrite.op, payload: pendingWrite.payload, filters: [...filters] })
        return { data: null, error: null }
      }
      return matchSelect()
    }

    const builder = {
      select: (_cols?: string) => builder,
      insert: (payload: AnyRow | AnyRow[]) => {
        pendingWrite = { op: 'insert', payload }
        return builder
      },
      update: (payload: AnyRow) => {
        pendingWrite = { op: 'update', payload }
        return builder
      },
      eq: (column: string, value: unknown) => {
        filters.push({ column, value })
        return builder
      },
      in: (column: string, value: unknown) => {
        filters.push({ column, value })
        return builder
      },
      is: (column: string, value: unknown) => {
        filters.push({ column, value })
        return builder
      },
      gt: (_column: string, _value: unknown) => builder,
      order: (_col: string, _opts?: unknown) => builder,
      limit: (_n: number) => builder,
      single: async () => settle(),
      maybeSingle: async () => {
        const r = settle()
        if (Array.isArray(r.data)) return { data: r.data[0] ?? null, error: r.error }
        return r
      },
      then<R1 = SelectResponse, R2 = never>(
        resolve: (v: SelectResponse) => R1 | PromiseLike<R1>,
        reject?: (reason: unknown) => R2 | PromiseLike<R2>,
      ): PromiseLike<R1 | R2> {
        try {
          return Promise.resolve(settle()).then(resolve, reject)
        } catch (err) {
          return Promise.reject(err).then(undefined, reject) as PromiseLike<R2>
        }
      },
    }
    return builder
  }

  const admin = {
    from: vi.fn((table: string) => builderFor(table)),
    rpc: vi.fn(async (name: string, args?: AnyRow) => {
      const callIndex = rpcCalls.filter((c) => c.name === name).length
      rpcCalls.push({ name, args })
      return opts.rpc(name, args, callIndex)
    }),
    auth: {
      admin: {
        getUserById: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      },
    },
  } as unknown as Parameters<typeof submitCustomerOrder>[0]

  return { admin, writes, rpcCalls }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PRODUCT_ID = '00000000-0000-0000-0000-000000000001'
const CAT_ITEM_ID = '00000000-0000-0000-0000-000000000aaa'
const ORG_ID = '00000000-0000-0000-0000-0000000000ff'
const MEMBERSHIP_ID = '00000000-0000-0000-0000-000000000bbb'
const USER_ID = '00000000-0000-0000-0000-000000000ccc'
const ORDER_ID = '00000000-0000-0000-0000-000000000111'
const QUOTE_ID = '00000000-0000-0000-0000-000000000222'
const VARIANT_ID = '00000000-0000-0000-0000-000000000333'
const QUOTE_ITEM_ID = 'qi-1'

function buildInput(
  lineOverrides: Partial<CheckoutInput['lines'][number]> = {},
): CheckoutInput {
  return {
    context: {
      userId: USER_ID,
      membershipId: MEMBERSHIP_ID,
      role: 'org_admin',
      email: 'buyer@acme.test',
      fullName: 'Sam Buyer',
      organizationId: ORG_ID,
      organizationName: 'Acme Co',
      customerCode: 'ACME',
      b2bAccountId: null,
      tierLevel: null,
      paymentTerms: 'net20',
      contractNotes: null,
      pricingMode: null,
      defaultDepositPercent: null,
      storeIds: [],
      defaultStoreId: null,
      tenantType: null,
      allowsMultiStoreOrdering: false,
      moqExempt: false, // MOQ ENFORCED — this suite tests the MOQ × fulfilment interaction
      orderingPermission: 'both',
    },
    idempotency_key: 'idem-fulfilment-1',
    required_by: null,
    notes: null,
    internal_notes: null,
    lines: [
      {
        product_id: PRODUCT_ID,
        product_name: 'Acrylic Cap',
        variant_id: VARIANT_ID,
        qty: 10, // below MOQ 24 — only passes if the line escapes MOQ as 'stocked'
        decorations: [],
        cart_line_id: 'line-1',
        fulfilment_type: 'stocked', // the (possibly false) client claim under test
        ...lineOverrides,
      },
    ],
  }
}

function baseSelects(opts: {
  productNature: string
  itemNatureOverride?: string | null
}): SelectMatcher[] {
  return [
    { table: 'user_organizations', response: { data: { role: 'org_admin' }, error: null } },
    {
      table: 'b2b_catalogue_items',
      response: {
        data: [
          {
            id: CAT_ITEM_ID,
            source_product_id: PRODUCT_ID,
            moq_override: null,
            fulfilment_type_override: opts.itemNatureOverride ?? null,
          },
        ],
        error: null,
      },
    },
    {
      table: 'products',
      response: {
        data: [{ id: PRODUCT_ID, moq: 24, fulfilment_type: opts.productNature }],
        error: null,
      },
    },
    {
      table: 'quote_items',
      response: {
        data: [
          {
            id: QUOTE_ITEM_ID,
            product_id: PRODUCT_ID,
            variant_id: VARIANT_ID,
            product_name: 'Acrylic Cap',
            quantity: 10,
            unit_price: 10,
            decorations: [],
            product_variants: null,
          },
        ],
        error: null,
      },
    },
    {
      table: 'quotes',
      response: {
        data: {
          id: QUOTE_ID,
          organization_id: ORG_ID,
          customer_name: 'Acme Co',
          customer_email: 'buyer@acme.test',
          order_ref: 'ORD-FULFIL-1',
          total_amount: 100,
          required_by: null,
          payment_terms: 'net20',
        },
        error: null,
      },
    },
  ]
}

function happyRpc(name: string): { data: unknown; error: { message: string } | null } {
  if (name === 'effective_unit_price') return { data: 10, error: null }
  if (name === 'submit_b2b_order') {
    return {
      data: [{ quote_id: QUOTE_ID, order_id: ORDER_ID, order_ref: 'ORD-FULFIL-1' }],
      error: null,
    }
  }
  return { data: null, error: null }
}

beforeEach(() => {
  vi.clearAllMocks()
  createDraftInvoiceForOrder.mockResolvedValue({ status: 'skipped', reason: 'disabled' })
})

describe('submitCustomerOrder — server-side fulfilment truth', () => {
  it("coerces a false 'stocked' claim on a made_to_order product: MOQ applies and rejects", async () => {
    const { admin } = makeSupabaseStub({
      selects: baseSelects({ productNature: 'made_to_order' }),
      rpc: happyRpc,
    })

    await expect(submitCustomerOrder(admin, buildInput())).rejects.toBeInstanceOf(
      MoqViolationError,
    )
  })

  it("honours a 'stocked' claim on a mixed product: line stays MOQ-exempt and the order commits", async () => {
    const { admin } = makeSupabaseStub({
      selects: baseSelects({ productNature: 'mixed' }),
      rpc: happyRpc,
    })

    const result = await submitCustomerOrder(admin, buildInput())
    expect(result.order_id).toBe(ORDER_ID)
  })

  it("Xero gate sees drawsStock=false after coercion (made_to_order nature)", async () => {
    const { admin } = makeSupabaseStub({
      // qty meets MOQ so the order commits and reaches step 5c.
      selects: baseSelects({ productNature: 'made_to_order' }),
      rpc: happyRpc,
    })

    const result = await submitCustomerOrder(
      admin,
      buildInput({ qty: 24 }),
    )
    expect(result.order_id).toBe(ORDER_ID)
    expect(createDraftInvoiceForOrder).toHaveBeenCalledTimes(1)
    expect(createDraftInvoiceForOrder).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ drawsStock: false }),
    )
  })

  it('Xero gate still sees drawsStock=true for a genuine draw (mixed nature)', async () => {
    const { admin } = makeSupabaseStub({
      selects: baseSelects({ productNature: 'mixed' }),
      rpc: happyRpc,
    })

    const result = await submitCustomerOrder(admin, buildInput())
    expect(result.order_id).toBe(ORDER_ID)
    expect(createDraftInvoiceForOrder).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ drawsStock: true }),
    )
  })

  it('catalogue-item fulfilment override beats the product base (override mixed on a made_to_order base)', async () => {
    const { admin } = makeSupabaseStub({
      selects: baseSelects({
        productNature: 'made_to_order',
        itemNatureOverride: 'mixed',
      }),
      rpc: happyRpc,
    })

    // Line carries the exact catalogue item id → override applies → claim stands.
    const result = await submitCustomerOrder(
      admin,
      buildInput({ catalogueItemId: CAT_ITEM_ID }),
    )
    expect(result.order_id).toBe(ORDER_ID)
    expect(createDraftInvoiceForOrder).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ drawsStock: true }),
    )
  })

  it('legacy line without a claim is untouched (still MOQ-applicable)', async () => {
    const { admin } = makeSupabaseStub({
      selects: baseSelects({ productNature: 'made_to_order' }),
      rpc: happyRpc,
    })

    await expect(
      submitCustomerOrder(admin, buildInput({ fulfilment_type: undefined })),
    ).rejects.toBeInstanceOf(MoqViolationError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/checkout/__tests__/submit.fulfilment-truth.test.ts`
Expected: FAIL —
- test 1 resolves instead of rejecting (false 'stocked' claim currently skips MOQ),
- test 3 receives `drawsStock: true` (claim currently trusted).
Tests 2, 4, 5, 6 may already pass (they assert unchanged behaviour) — that is fine.

- [ ] **Step 3: Implement — coercion in `lib/checkout/submit.ts`**

Replace the section from the `productionQtyByProductId` block through the `overrideByProductId` map (currently :395–430) with the following. Net effect: (a) both selects gain the fulfilment columns, (b) nature maps are built, (c) claims are coerced, (d) the production-qty map is built AFTER coercion, (e) the MOQ-violation loop (:431–455) is left exactly as is below this.

OLD (for orientation — this is the code being replaced):
```ts
  // Qty per product destined for a NEW production run — i.e. excluding lines
  // fulfilled from existing stock. MOQ is checked against this, not the grand
  // total: stock that has already been made carries no minimum. A line only
  // escapes MOQ when it explicitly declares fulfilment_type 'stocked'; an
  // absent value (legacy carts) conservatively still counts toward MOQ.
  const productionQtyByProductId = new Map<string, number>()
  for (const line of input.lines) {
    if (line.fulfilment_type === 'stocked') continue
    productionQtyByProductId.set(
      line.product_id,
      (productionQtyByProductId.get(line.product_id) ?? 0) + line.qty,
    )
  }

  const [{ data: productMoqRows }, { data: catItemMoqRows }] = await Promise.all([
    admin
      .from('products')
      .select('id, moq')
      .in('id', productIds),
    admin
      .from('b2b_catalogue_items')
      .select('source_product_id, moq_override')
      .in('source_product_id', productIds)
      .in('id', Array.from(grantedItemIds)),
  ])
  const productMoqById = new Map(
    ((productMoqRows ?? []) as Array<{ id: string; moq: number | null }>).map(
      (r) => [r.id, r.moq],
    ),
  )
  const overrideByProductId = new Map(
    ((catItemMoqRows ?? []) as Array<{
      source_product_id: string
      moq_override: number | null
    }>).map((r) => [r.source_product_id, r.moq_override]),
  )
```

NEW:
```ts
  const [{ data: productMoqRows }, { data: catItemMoqRows }] = await Promise.all([
    admin
      .from('products')
      .select('id, moq, fulfilment_type')
      .in('id', productIds),
    admin
      .from('b2b_catalogue_items')
      .select('id, source_product_id, moq_override, fulfilment_type_override')
      .in('source_product_id', productIds)
      .in('id', Array.from(grantedItemIds)),
  ])
  const productRows = (productMoqRows ?? []) as Array<{
    id: string
    moq: number | null
    fulfilment_type: string | null
  }>
  const catItemRows = (catItemMoqRows ?? []) as Array<{
    id: string
    source_product_id: string
    moq_override: number | null
    fulfilment_type_override: string | null
  }>
  const productMoqById = new Map(productRows.map((r) => [r.id, r.moq]))
  const overrideByProductId = new Map(
    catItemRows.map((r) => [r.source_product_id, r.moq_override]),
  )

  // Server-side fulfilment truth (2026-07-06). 'stocked' is a stock-DRAW claim
  // that exempts a line from MOQ (below) and trips the Xero draws_stock gate
  // (step 5c) — so it may only stand when the product's effective nature
  // actually allows a draw. submit_b2b_order resolves fulfilment the same way
  // (catalogue override ?? product base) and never draws inventory for
  // made_to_order/pre_order natures, so a 'stocked' claim there is always
  // wrong — the old PDP fallback bug, stale persisted carts, or a hostile
  // client. Coerce in place so every downstream reader of input.lines sees
  // the truth. Absent claims (legacy carts) stay absent: MOQ-conservative.
  const natureByProductId = new Map(productRows.map((r) => [r.id, r.fulfilment_type]))
  const natureOverrideByCatItemId = new Map(
    catItemRows.map((r) => [r.id, r.fulfilment_type_override]),
  )
  const natureOverrideByProductId = new Map<string, string>()
  for (const r of catItemRows) {
    if (
      r.fulfilment_type_override != null &&
      !natureOverrideByProductId.has(r.source_product_id)
    ) {
      natureOverrideByProductId.set(r.source_product_id, r.fulfilment_type_override)
    }
  }
  for (const line of input.lines) {
    if (line.fulfilment_type !== 'stocked') continue
    const effectiveNature =
      (line.catalogueItemId != null
        ? natureOverrideByCatItemId.get(line.catalogueItemId)
        : null) ??
      natureOverrideByProductId.get(line.product_id) ??
      natureByProductId.get(line.product_id) ??
      'made_to_order'
    if (effectiveNature !== 'stocked' && effectiveNature !== 'mixed') {
      line.fulfilment_type = 'made_to_order'
    }
  }

  // Qty per product destined for a NEW production run — i.e. excluding lines
  // fulfilled from existing stock. MOQ is checked against this, not the grand
  // total: stock that has already been made carries no minimum. A line only
  // escapes MOQ when it declares fulfilment_type 'stocked' AND the claim
  // survived the nature coercion above; an absent value (legacy carts)
  // conservatively still counts toward MOQ. Built AFTER coercion on purpose.
  const productionQtyByProductId = new Map<string, number>()
  for (const line of input.lines) {
    if (line.fulfilment_type === 'stocked') continue
    productionQtyByProductId.set(
      line.product_id,
      (productionQtyByProductId.get(line.product_id) ?? 0) + line.qty,
    )
  }
```

Notes for the implementer:
- The `moqViolations` loop below (:431–455) and everything else in the file stays byte-identical.
- Deviation from the RPC, accepted: when a line has NO `catalogueItemId` and multiple granted catalogue items of the same product carry different non-null overrides, the RPC tiebreaks by `created_at desc`; here we take the first non-null in fetch order. Current flows always send `catalogueItemId`, so this path is theoretical.
- `pre_order` (a nature that exists in the staff enum but not portal's `FulfilmentType`) is handled by the string-typed maps: it is neither `'stocked'` nor `'mixed'`, so a claim on it coerces to `'made_to_order'` — matching the RPC, which never treats pre_order as a draw of on-hand stock.

- [ ] **Step 4: Run tests to verify pass + no regressions**

Run: `pnpm vitest run lib/checkout/__tests__/submit.fulfilment-truth.test.ts`
Expected: PASS (6 tests).

Run: `pnpm vitest run lib/checkout/__tests__`
Expected: all other submit suites unchanged (they stub `products` without `fulfilment_type` → nature resolves to `null` → falls back to `'made_to_order'` → any `'stocked'` claims in those fixtures coerce; verify none of those suites asserted MOQ-skip-via-stocked with `moqExempt: false` — as of 2026-07-06 they all run with `moqExempt: true`, so behaviour is unchanged. If one fails, fix its fixture by adding `fulfilment_type: 'mixed'` to its products row — do NOT weaken the coercion).

- [ ] **Step 5: Commit**

```bash
git status -sb
git add lib/checkout/submit.ts lib/checkout/__tests__/submit.fulfilment-truth.test.ts
git commit -m "fix: server-side fulfilment truth — coerce false 'stocked' claims before MOQ + Xero gates"
```

---

### Task 4: Full gates, push, PR

**Files:** none new.

- [ ] **Step 1: Type check**

Run: `pnpm exec tsc --noEmit`
Expected: exit 0, no errors.

- [ ] **Step 2: Full test suite**

Run: `pnpm vitest run`
Expected: ONLY the pre-existing baseline failures (5 as of 2026-07-02: CartTable, CheckoutClient.review-redirect, ProductDetailClient.manual-pricing families). Zero NEW failures; the three new suites pass.

- [ ] **Step 3: Production build**

Run: `pnpm build`
Expected: exit 0.

- [ ] **Step 4: Push branch + open PR (do NOT merge)**

```bash
git status -sb        # confirm fix/line-fulfilment-truth, clean tree
git push -u origin fix/line-fulfilment-truth
gh pr create --base main --title "fix: line fulfilment truth — stop defaulting untracked lines to 'stocked'" --body "$(cat <<'EOF'
## Summary
- PDP add-to-cart defaulted fulfilmentType to 'stocked' for untracked cells, so every normal made_to_order order line claimed a stock draw
- Effects: production lines silently bypassed server MOQ; Xero auto-drafting flagged fully-billable orders manual_review (found via TEST-000080)
- Fix 1 (client): new nature-gated lineFulfilment() helper wired into PDP Modes 1+3; default is made_to_order, 'stocked' only when a draw is actually possible
- Fix 2 (server, defense-in-depth): submit.ts coerces false 'stocked' claims (stale persisted carts / hostile clients) using the same catalogue-override ?? product-nature precedence as submit_b2b_order, before the MOQ guard and Xero draws_stock gate
- No schema change; no staff-portal change (RPC already resolves fulfilment server-side; quote_items has no fulfilment_type column); reorder rebuild already derives from qty_to_make

## Test plan
- [x] lib/shop/__tests__/line-fulfilment.test.ts — decision matrix (8 cases)
- [x] components/shop/__tests__/ProductDetailClient.fulfilment-fallback.test.tsx — untracked made_to_order product tags made_to_order (regression for TEST-000080)
- [x] lib/checkout/__tests__/submit.fulfilment-truth.test.ts — coercion × MOQ × Xero drawsStock (6 cases)
- [x] tsc 0 / build 0 / full suite = baseline-only failures
- [ ] Post-deploy smoke (Task 5)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

### Task 5: Post-merge production verification (HUMAN GATE — Jon)

No code. After the PR merges and Vercel deploys:

- [ ] **Step 1: Made-to-order smoke order** — place a small portal order on a made_to_order product (e.g. Acrylic Cap) from the Test Account org, qty ≥ its MOQ.
- [ ] **Step 2: Verify Xero drafts it** — expect a DRAFT invoice in Xero, and:

```sql
select o.id, o.xero_invoice_status, o.xero_invoice_number
from orders o order by o.created_at desc limit 1;
-- expect xero_invoice_status = 'drafted' (NOT 'manual_review')
```

- [ ] **Step 3: Verify manual_review still fires for genuine draws** — place an order that draws tracked stock (e.g. an Anytime Fitness stocked item) → expect `manual_review` + the ⚠️ Monday note. This proves the gate wasn't just turned off.
- [ ] **Step 4: MOQ spot-check** — on a made_to_order product with MOQ > 1, try submitting under MOQ (edit qty in cart) → expect the MOQ violation, not a silent pass.
- [ ] **Step 5:** Nothing to clean up in prod — the only mis-flagged row is TEST-000080 (test order; leave as-is).
