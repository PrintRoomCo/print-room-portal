# Checkout → Monday CRM Deals → Auto-Proof Pipeline — Implementation Plan

**Date:** 2026-05-21
**Source spec:** [docs/superpowers/specs/2026-05-21-checkout-monday-proof-pipeline-design.md](../specs/2026-05-21-checkout-monday-proof-pipeline-design.md)
**Repos touched:** `print-room-portal` + `print-room-staff-portal`
**Strategy:** 4 independently shippable stages. Each stage merges to `main` on its own branch. Stages 1–2 can land in either order; Stage 3 depends on 1+2; Stage 4 depends on 3.

---

## Pre-flight (do once before Stage 1)

- [ ] **P1.** Confirm sub-items column is enabled on Monday board `2046357917` (CRM Deals). Board settings → Customise → Subitems toggle. If disabled, enable it. **Owner:** Jamie. **Time:** 2 min.
- [ ] **P2.** Pre-create the `"Portal - Order"` label on the `deal_source` column (`color_mkzhwkjn`) of board `2046357917`. Pick a colour distinct from `"Portal - Reorder"`. **Owner:** Jamie. **Time:** 2 min.
- [ ] **P3.** Confirm the Monday board URL prefix domain. Existing `lib/monday/subitems.ts:103` uses `https://theprint-room-group.monday.com`; reorder.ts and production-job.ts don't construct URLs. Decision: use the same domain for AM email links. If wrong, update at Task 3.4 time.

---

## Stage 1 — Migration + status labels

**Branch:** `feat/checkout-pipeline-stage-1-migration`
**Goal:** Make the new order statuses legal in Supabase. No behaviour change yet — nothing writes the new statuses until Stage 3.

### Task 1.1 — Supabase migration

> **2026-05-21 plan amendment (Stage 1 dispatch finding):** `orders.status` is a Postgres **ENUM** (`order_status`), not a TEXT column with a CHECK constraint. The earlier draft of this task used `ALTER TABLE … DROP/ADD CONSTRAINT orders_status_check`, which is structurally wrong — `DROP` is a no-op and `ADD` fails with `invalid input value for enum order_status`. Canonical enum values as of 2026-05-21: `awaiting-approval, approved, awaiting-production, in-production, fulfilled, shipped, cancelled`. The previous CHECK-list draft omitted `fulfilled`; this is moot because the enum is the source of truth and already has it. Migration shape below is the corrected one.

Create `supabase/migrations/20260521000000_orders_status_proof_review_states.sql`:

```sql
-- 2026-05-21 — Checkout → Monday → Auto-Proof pipeline.
-- Extend the order_status enum to include the two new states introduced by
-- retiring the AM-approve gate. Existing values stay legal (this is additive).
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'awaiting-proof-review';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'awaiting-customer-approval';
```

> Each `ALTER TYPE … ADD VALUE` is its own DDL statement; Supabase's migration runner handles the (Postgres-required) out-of-transaction execution. No rollback path — enum values can't be dropped without a recreate — but additive enum extension is the standard low-risk pattern here.

**Apply:** `mcp__supabase__apply_migration` against project `bthsxgmcnbvwwgvdveek` (no local Supabase stack; writes touch prod-shared dev DB).

**Test:** smoke insert one row of each new status into a scratch row, verify the enum accepts, then `DELETE` the scratch row immediately. Use `mcp__supabase__execute_sql`.

### Task 1.2 — Status labels (portal)

> **2026-05-21 plan amendment (Stage 1 dispatch finding):** `lib/orders/status-labels.ts` does NOT exist in either repo. Status labels are currently inline-scattered — portal: `QuoteStatusChip` map in `app/(portal)/my-collections/[collectionId]/page.tsx` (quote-focused, only handles `awaiting-approval` for orders); staff: `STATUS_OPTIONS` array + `statusPillClass` switch in `OrdersList.tsx`. **Stage 1 creates the canonical file and does NOT refactor the existing inlines** — that's deferred (leave a one-line `// TODO consolidate` comment near each inline so it's greppable). Stage 3 will import from the new canonical file when the UI first needs to display the new statuses.

Create `lib/orders/status-labels.ts` in the customer portal repo with all 9 enum values (the 7 existing + the 2 new) mapped to human strings:

```ts
import type { Database } from '@/types/supabase'

export type OrderStatus = Database['public']['Enums']['order_status']

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  'awaiting-approval': 'Awaiting approval',
  'approved': 'Approved',
  'awaiting-production': 'Queued for production',
  'in-production': 'In production',
  'fulfilled': 'Fulfilled',
  'shipped': 'Shipped',
  'cancelled': 'Cancelled',
  // New (2026-05-21)
  'awaiting-proof-review': 'Preparing proof',
  'awaiting-customer-approval': 'Proof ready — review on your order page',
}

export function orderStatusLabel(status: OrderStatus): string {
  return ORDER_STATUS_LABELS[status] ?? status
}
```

> If `@/types/supabase` doesn't export `order_status` (e.g. generated types are stale), define `OrderStatus` as a string-literal union manually with the same 9 values. Note in the commit message which path was taken.

**Test:** `pnpm tsc --noEmit` clean. No existing call-site imports this file yet — the runtime contract for Stage 1 is "additive, no behaviour change."

### Task 1.3 — Status labels (staff portal)

Mirror the same `lib/orders/status-labels.ts` in `print-room-staff-portal/src/lib/orders/status-labels.ts` (same contents, same `OrderStatus` source — pull from staff's own Supabase types generator or hand-roll the union if missing). Same no-refactor-inlines rule applies; same `// TODO consolidate` markers near `OrdersList.tsx`'s `STATUS_OPTIONS` + `statusPillClass`.

**Test:** `npx tsc --noEmit` clean in staff repo.

### Stage 1 done-criteria

- [ ] Migration applied to dev DB; can insert orders with the two new statuses.
- [ ] Status-labels return the new strings for both new states (portal + staff).
- [ ] `tsc --noEmit` clean both repos.
- [ ] No behaviour change at runtime — no code path yet writes the new statuses.

**Commit:** `chore(orders): add awaiting-proof-review + awaiting-customer-approval statuses`

---

## Stage 2 — `deal-item.ts` extraction (refactor)

**Branch:** `feat/checkout-pipeline-stage-2-deal-item`
**Goal:** Move reorder.ts logic to a new file that supports both `reorder` and `order` modes. The existing reorder caller (`app/api/reorder/route.ts`) keeps working unchanged. The new `order` mode is exported but unused by any caller in this stage.

### Task 2.1 — Create `lib/monday/deal-item.ts` (portal)

Create the new file with:

```ts
/**
 * Monday.com CRM Deals integration.
 *
 * Creates items on the CRM Deals board (MONDAY_REORDERS_BOARD_ID) for
 * customer reorders AND customer orders. Items land in the "New Deals"
 * group where AMs route them into their pipeline.
 *
 * Mode-discriminated helpers:
 *  - 'reorder' — preserved verbatim from the retired lib/monday/reorder.ts.
 *    No sub-items. Lines packed into long-text breakdown.
 *  - 'order'   — new for the 2026-05-21 checkout → Monday pipeline.
 *    Adds sub-items per cart line with design-name-prefixed names.
 *    Sets deal_source = "Portal - Order".
 */

import { mondayApiCall } from './client'
import type { MondayCreateItemResponse } from './types'
import type { JobTracker, QuoteDataItem } from '@/lib/job-tracker'
import {
  getItemColorName,
  getItemDesignName,
  getItemDisplayName,
  getItemTotalQty,
} from '@/lib/job-tracker'
import type { ReorderEditedItem } from '@/lib/config/reorder'

// === Shared board config (was lib/monday/reorder.ts) ===

function getBoardId(): string {
  const id = process.env.MONDAY_REORDERS_BOARD_ID
  if (!id) {
    throw new Error(
      'MONDAY_REORDERS_BOARD_ID is not configured — set it to the CRM Deals board id (e.g. 2046357917).'
    )
  }
  return id
}

const DEALS_GROUP_ID = 'topics'

const COL_CUSTOMER_NAME = 'text_mkzjv77f'
const COL_EMAIL = 'email_mkzjab7s'
const COL_PHONE = 'text_mkzjfbgj'
const COL_COMPANY = 'text_mkzjmfef'
const COL_PRODUCT = 'text_mkzj78dx'
const COL_FULL_FORM_RESPONSE = 'long_text_mkzjhs9j'
const COL_DEAL_STAGE = 'deal_stage'
const COL_DEAL_SOURCE = 'color_mkzhwkjn'
const COL_QTY = 'text_mkzjj9j5'
const COL_IN_HAND_DATE = 'date_mm0p5fzc'

const DEAL_STAGE_LABEL = 'New'
const DEAL_SOURCE_REORDER = 'Portal - Reorder'
const DEAL_SOURCE_ORDER = 'Portal - Order'

// === REORDER MODE (preserved from lib/monday/reorder.ts) ===

export interface ReorderData {
  customerEmail: string
  customerName: string
  customerPhone?: string | null
  customerCompany?: string | null
  originalQuoteNumber: string | null
  originalJobReference: string | null
  mondayProjectName: string | null
  deliveryAddress: string
  inHandDate: string
  quantity?: number
  notes?: string
  artworkUrls?: string[]
  proofFileUrls: string[]
  originalItems: QuoteDataItem[]
  designNamesByInstanceId?: Record<string, string>
  editedItems?: ReorderEditedItem[]
}

// (formatProductsCompact, formatItemBreakdown, formatEditedBreakdown,
//  buildFullFormResponse, totalQuantity, createReorderItem,
//  buildReorderDataFromTracker — copy verbatim from existing reorder.ts.
//  No code changes. Total ~250 LOC. Listed here as a placeholder to
//  keep the plan readable; the actual copy is byte-for-byte identical.)

// === ORDER MODE (new) ===

export interface OrderLineForMonday {
  /** quote_items.id — used as key in returned subitemIds map. */
  quoteItemId: string
  productName: string
  variantLabel: string
  /**
   * Decoration name. Defaults to "No decoration" when the line has no
   * decorations attached (resolved at the caller, not here).
   */
  designName: string
  quantity: number
}

export interface OrderDealData {
  customerEmail: string
  customerName: string
  customerCompany: string | null
  orderRef: string
  inHandDate: string | null
  notes: string | null
  totalAmount: number
  lines: OrderLineForMonday[]
}

interface MondayCreateSubitemResponse {
  create_subitem: { id: string }
}

function buildOrderItemName(data: OrderDealData): string {
  const company = data.customerCompany ? ` - ${data.customerCompany}` : ''
  return `${data.customerName}${company} - ${data.orderRef}`
}

function buildOrderFullFormResponse(data: OrderDealData): string {
  const lines: string[] = [
    `Order ref: ${data.orderRef}`,
    `Customer: ${data.customerName}`,
    `Email: ${data.customerEmail}`,
  ]
  if (data.customerCompany) lines.push(`Company: ${data.customerCompany}`)
  lines.push(`Total: $${data.totalAmount.toFixed(2)}`)
  if (data.inHandDate) lines.push(`In-hand: ${data.inHandDate}`)
  lines.push('')
  lines.push('--- Lines ---')
  for (const line of data.lines) {
    lines.push(
      `• ${line.designName}: ${line.productName} — ${line.variantLabel} × ${line.quantity}`,
    )
  }
  lines.push('')
  if (data.notes?.trim()) {
    lines.push('--- Customer notes ---')
    lines.push(data.notes.trim())
    lines.push('')
  }
  lines.push(`Source: B2B Portal — Order`)
  lines.push(`Submitted: ${new Date().toISOString()}`)
  return lines.join('\n')
}

function formatOrderProductsCompact(lines: OrderLineForMonday[]): string {
  if (lines.length === 0) return 'Order — no lines'
  return lines
    .map((l) => `${l.designName} / ${l.productName} x${l.quantity}`)
    .join(', ')
}

function totalOrderQuantity(lines: OrderLineForMonday[]): number {
  return lines.reduce((sum, l) => sum + l.quantity, 0)
}

export async function createOrderDealItem(
  data: OrderDealData,
): Promise<{ itemId: string; itemName: string }> {
  const itemName = buildOrderItemName(data)

  const columnValues: Record<string, unknown> = {
    [COL_CUSTOMER_NAME]: data.customerName,
    [COL_EMAIL]: { email: data.customerEmail, text: data.customerEmail },
    [COL_PRODUCT]: formatOrderProductsCompact(data.lines),
    [COL_FULL_FORM_RESPONSE]: { text: buildOrderFullFormResponse(data) },
    [COL_DEAL_STAGE]: { label: DEAL_STAGE_LABEL },
    [COL_DEAL_SOURCE]: { label: DEAL_SOURCE_ORDER },
  }

  if (data.customerCompany) columnValues[COL_COMPANY] = data.customerCompany
  if (data.inHandDate) columnValues[COL_IN_HAND_DATE] = { date: data.inHandDate }
  const qty = totalOrderQuantity(data.lines)
  if (qty > 0) columnValues[COL_QTY] = String(qty)

  const mutation = `
    mutation CreateOrder($boardId: ID!, $groupId: String!, $itemName: String!, $columnValues: JSON!) {
      create_item(
        board_id: $boardId,
        group_id: $groupId,
        item_name: $itemName,
        column_values: $columnValues,
        create_labels_if_missing: true
      ) {
        id
        name
      }
    }
  `

  const result = await mondayApiCall<MondayCreateItemResponse>(mutation, {
    boardId: getBoardId(),
    groupId: DEALS_GROUP_ID,
    itemName,
    columnValues: JSON.stringify(columnValues),
  })

  console.log('[Monday Order] Created item:', result.create_item.id)
  return { itemId: result.create_item.id, itemName: result.create_item.name }
}

export async function createOrderDealSubitem(
  parentItemId: string,
  line: OrderLineForMonday,
): Promise<{ subitemId: string }> {
  const itemName = `${line.designName}: ${line.productName} — ${line.variantLabel} × ${line.quantity}`

  const mutation = `
    mutation CreateOrderSubitem($parentItemId: ID!, $itemName: String!, $columnValues: JSON) {
      create_subitem(parent_item_id: $parentItemId, item_name: $itemName, column_values: $columnValues) {
        id
      }
    }
  `

  const result = await mondayApiCall<MondayCreateSubitemResponse>(mutation, {
    parentItemId,
    itemName,
    columnValues: JSON.stringify({}),
  })
  return { subitemId: result.create_subitem.id }
}

export async function pushOrderDeal(
  data: OrderDealData,
): Promise<{ itemId: string; subitemIds: Record<string, string> }> {
  const { itemId } = await createOrderDealItem(data)
  const subitemIds: Record<string, string> = {}
  for (const line of data.lines) {
    try {
      const { subitemId } = await createOrderDealSubitem(itemId, line)
      subitemIds[line.quoteItemId] = subitemId
    } catch (err) {
      console.error('[Monday Order] Subitem create failed:', {
        itemId,
        quoteItemId: line.quoteItemId,
        err: err instanceof Error ? err.message : String(err),
      })
      // Subitem failure is non-fatal — item exists, AM can add subitems manually.
      // We DO NOT throw, so partial subitems are preserved on the deal item.
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  return { itemId, subitemIds }
}
```

> **Tests for new code only — don't add tests for the verbatim `reorder` mode copy.** Add `lib/monday/__tests__/deal-item.order-mode.test.ts` that mocks `mondayApiCall` and verifies:
> - `pushOrderDeal` calls `create_item` with `deal_source = "Portal - Order"`, `deal_stage = "New"`, the long-text payload includes order ref + decoration lines.
> - For each line, `create_subitem` is called with the design-prefixed name.
> - Subitem create failure does NOT throw; returns partial `subitemIds`.

### Task 2.2 — Update `app/api/reorder/route.ts` callers

Change imports:

```ts
// before:
import { buildReorderDataFromTracker, createReorderItem } from '@/lib/monday/reorder'
// after:
import { buildReorderDataFromTracker, createReorderItem } from '@/lib/monday/deal-item'
```

Verify the named exports `buildReorderDataFromTracker` and `createReorderItem` survive the copy verbatim (they will, per Task 2.1).

### Task 2.3 — Delete `lib/monday/reorder.ts` (portal)

After Task 2.2 typechecks and the reorder API smoke-passes (manual: submit a reorder against dev, verify Monday item lands).

### Task 2.4 — Mirror to staff-portal (order-mode only)

> **2026-05-21 plan amendment (Stage 2 dispatch finding):** The original "byte-identical mirror" instruction is wrong. The portal `deal-item.ts` reorder-mode section depends on `@/lib/job-tracker` (`JobTracker`, `QuoteDataItem`, helper functions) and `@/lib/config/reorder` (`ReorderEditedItem`) — none of which exist in staff. Staff has no reorder caller (reorder is a customer-only feature) and Stage 4 only consumes `pushOrderDeal` (order mode). Mirror **order-mode only**.

Create `print-room-staff-portal/src/lib/monday/deal-item.ts` containing:
- File header docstring noting this is the order-mode-only mirror of the portal's `deal-item.ts` (deliberate divergence from byte-identical because reorder mode has portal-only dependencies; if staff ever gains a reorder caller, port reorder mode at that time).
- The shared board config block (board id getter, `DEALS_GROUP_ID`, all `COL_*` constants, `DEAL_STAGE_LABEL`, `DEAL_SOURCE_ORDER` — drop `DEAL_SOURCE_REORDER` since reorder mode isn't mirrored).
- The entire ORDER MODE section (types `OrderLineForMonday`, `OrderDealData`; helpers `buildOrderItemName`, `buildOrderFullFormResponse`, `formatOrderProductsCompact`, `totalOrderQuantity`; exports `createOrderDealItem`, `createOrderDealSubitem`, `pushOrderDeal`) — verbatim from portal.

For the `MondayCreateItemResponse` and `MondayCreateSubitemResponse` types: if `src/lib/monday/types.ts` doesn't exist, inline the (trivial) types at the top of `deal-item.ts` rather than creating a new file just for two interfaces. Both are tiny:
```ts
interface MondayCreateItemResponse { create_item: { id: string; name: string } }
interface MondayCreateSubitemResponse { create_subitem: { id: string } }
```

No unit tests in staff this stage (portal's `deal-item.order-mode.test.ts` covers the logic).

### Stage 2 done-criteria

- [ ] Portal: `lib/monday/deal-item.ts` exists; `lib/monday/reorder.ts` deleted; `app/api/reorder/route.ts` imports from new path.
- [ ] Staff portal: `src/lib/monday/deal-item.ts` mirror in place.
- [ ] `tsc --noEmit` clean both repos.
- [ ] Manual smoke: existing reorder flow still creates Monday items (test against dev tracker).
- [ ] New `order-mode` unit tests pass.

**Commit (portal):** `refactor(monday): extract deal-item.ts; reorder.ts retired in favor of mode-discriminated helper`
**Commit (staff):** `chore(monday): mirror deal-item.ts in staff-portal`

---

## Stage 3 — Portal checkout submit wiring

**Branch:** `feat/checkout-pipeline-stage-3-checkout-wiring`
**Goal:** Customer checkout creates a Monday deal item + subitems, flips order to `awaiting-proof-review`, enriches AM email. Order-confirmation copy updated. Production board never touched.

### Task 3.1 — Wire `pushOrderDeal` into `submit.ts` step 5

In [lib/checkout/submit.ts](../../lib/checkout/submit.ts), replace step 5 (currently the `update({ status: 'awaiting-approval' })` block at line ~750) with:

```ts
  // 5. Hold the order for staff proof review. Customer-facing portal flow:
  //    submit → autofill proof + Monday deal + AM email → staff edits → staff
  //    push-to-customer → customer approves. No more AM-approve gate.
  //    See spec: 2026-05-21-checkout-monday-proof-pipeline-design.md.

  // 5a. Push to Monday CRM Deals board. Best-effort: if it fails, order still
  //     commits, audit row records the failure, staff can retry from the order
  //     detail page (Stage 4 surface).
  let mondayItemId: string | null = null
  const subitemIdByQuoteItemId: Record<string, string> = {}
  try {
    const { data: dealLines } = await admin
      .from('quote_items')
      .select(`
        id, product_name, quantity, unit_price, decorations,
        product_variants ( product_color_swatches(label), sizes(label) )
      `)
      .eq('quote_id', quote_id)

    const lines: OrderLineForMonday[] = ((dealLines ?? []) as unknown as Array<{
      id: string
      product_name: string
      quantity: number
      unit_price: number
      decorations: Array<{ name: string }> | null
      product_variants: {
        product_color_swatches: { label: string | null } | { label: string | null }[] | null
        sizes: { label: string | null } | { label: string | null }[] | null
      } | null
    }>).map((row) => {
      const swatch = pickOne(row.product_variants?.product_color_swatches ?? null)
      const size = pickOne(row.product_variants?.sizes ?? null)
      const variantLabel = [swatch?.label, size?.label].filter(Boolean).join(' / ') || '—'
      const designName = row.decorations?.[0]?.name ?? 'No decoration'
      return {
        quoteItemId: row.id,
        productName: row.product_name,
        variantLabel,
        designName,
        quantity: row.quantity,
      }
    })

    // emailTotalAmount is declared AFTER step 5 in the current submit.ts,
    // so it's not in scope here. Compute directly from repriced.
    const totalAmount = repriced.reduce((t, l) => t + l.unit_price * l.qty, 0)

    const { itemId, subitemIds } = await pushOrderDeal({
      customerEmail: input.context.email ?? '',
      customerName: input.context.organizationName,
      customerCompany: input.context.organizationName,
      orderRef: order_ref,
      inHandDate: input.required_by ?? null,
      notes: input.notes ?? null,
      totalAmount,
      lines,
    })

    mondayItemId = itemId
    Object.assign(subitemIdByQuoteItemId, subitemIds)

    // Persist back. Order row gets monday_item_id; each quote_items row gets
    // its monday_subitem_id so the existing tracker-status webhook can match
    // inbound Monday updates to portal-side lines.
    await admin.from('orders').update({ monday_item_id: itemId }).eq('id', order_id)
    for (const [quoteItemId, subitemId] of Object.entries(subitemIds)) {
      await admin
        .from('quote_items')
        .update({ monday_subitem_id: subitemId })
        .eq('id', quoteItemId)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[Checkout] Monday push failed (swallowed)', { orderId: order_id, err: message })
    try {
      await recordAuditEvent(
        {
          orgId: input.context.organizationId,
          actorUserId: input.context.userId,
          action: AUDIT_ACTIONS.ORDER_MONDAY_PUSH_FAILED,
          targetType: 'order',
          targetId: order_id,
          metadata: { order_ref, quote_id, error: message },
        },
        admin,
      )
    } catch {
      // truly best-effort
    }
  }

  // 5b. Flip status to awaiting-proof-review. Replaces the old
  //     'awaiting-approval'. Independent of the Monday push result —
  //     order proceeds even if Monday push failed.
  await admin
    .from('orders')
    .update({ status: 'awaiting-proof-review' })
    .eq('id', order_id)
```

Add imports at top of file:

```ts
import { pushOrderDeal, type OrderLineForMonday } from '@/lib/monday/deal-item'
```

The existing step 5b (proof autofill) and step 6 (email) stay in place after this block.

### Task 3.2 — Add `ORDER_MONDAY_PUSH_FAILED` audit action

In `lib/audit/actions.ts`:

```ts
export const AUDIT_ACTIONS = {
  // ...existing...
  ORDER_MONDAY_PUSH_FAILED: 'order.monday_push_failed',
} as const
```

### Task 3.3 — Schema check + migration: `orders.monday_item_id` + `quote_items.monday_subitem_id`

> **2026-05-21 plan amendment (Stage 3 dispatch finding):** The plan's earlier draft assumed `orders.monday_item_id` already existed because "staff portal writes it today." It does NOT. Staff portal writes to `quotes.monday_item_id` (which holds **Production** board item ids — the legacy AM-gate flow). The new sprint pushes to the **CRM Deals** board, which is a semantically different concept: one Deals item per *order*, attached when the customer submits. We add a NEW column on `orders` rather than reusing the Production-flow column on `quotes`. Rationale: (1) different boards / different lifecycles; (2) Stage 4 PDF-attach already reads `orders.monday_item_id`; (3) `quotes.monday_item_id` becomes vestigial after Stage 4 deletes the Production push and can be cleaned up later. `quote_items.monday_subitem_id` already exists — verified via Supabase information_schema — no migration needed.

Verify via `mcp__supabase__execute_sql` against project `bthsxgmcnbvwwgvdveek`:

```sql
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'orders' AND column_name = 'monday_item_id';
-- expected after this stage: 1 row
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'quote_items' AND column_name = 'monday_subitem_id';
-- expected: 1 row (already present)
```

Create migration `supabase/migrations/20260521000001_orders_monday_item_id.sql`:

```sql
-- 2026-05-21 — Checkout → Monday CRM Deals push.
-- Stores the Monday Deals board item id created at customer checkout. Distinct
-- from quotes.monday_item_id which holds (legacy) Production board item ids
-- and becomes vestigial after Stage 4 retires the AM-approve gate.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS monday_item_id text;
```

Apply via `mcp__supabase__apply_migration` (name: `orders_monday_item_id`).

### Task 3.4 — Enrich AM email in `autofill-for-order.ts` with Monday link

In [lib/proofs/autofill-for-order.ts](../../lib/proofs/autofill-for-order.ts), extend `notifyAmBestEffort` to look up `orders.monday_item_id` and add a Monday link to the email body when present.

Add helper:

```ts
function resolveMondayItemUrl(itemId: string | null): string | null {
  if (!itemId) return null
  const prefix = process.env.MONDAY_BOARD_URL_PREFIX || 'https://theprint-room-group.monday.com'
  const boardId = process.env.MONDAY_REORDERS_BOARD_ID
  if (!boardId) return null
  return `${prefix.replace(/\/+$/, '')}/boards/${boardId}/pulses/${itemId}`
}
```

In `notifyAmBestEffort`, fetch the order row to get `monday_item_id` (alongside the existing reads), pass into `buildAmEmailHtml` + `buildAmEmailText`. Update those builders to render the Monday link as a separate line ("Open in Monday") immediately below the existing "Open proof in staff portal" button. When `mondayItemId === null`, the line is omitted.

Add env var documentation: append `MONDAY_BOARD_URL_PREFIX` to `.env.example` with the default value and a comment.

### Task 3.5 — Update order-confirmation copy

In [app/(portal)/checkout/confirmation/[orderId]/ConfirmationView.tsx](../../app/(portal)/checkout/confirmation/[orderId]/ConfirmationView.tsx):

Replace the post-checkout copy block (search for "we'll send your proof shortly" or whatever the current text reads) with:

```
Order received — we're preparing your proof
```

Verify the `awaiting-customer-approval` branch shows a "Your proof is ready — open the order to review" button linking to `/orders/{orderId}/proof`. The proof page already exists per [app/(portal)/orders/[id]/proof/page.tsx](../../app/(portal)/orders/[id]/proof/page.tsx).

### Task 3.6 — Test: Monday push failure path

Create `lib/checkout/__tests__/submit.monday-push-failure.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { submitCustomerOrder } from '../submit'

vi.mock('@/lib/monday/deal-item', () => ({
  pushOrderDeal: vi.fn().mockRejectedValue(new Error('Monday 500')),
}))

describe('submitCustomerOrder — Monday push failure', () => {
  it('still commits the order and flips to awaiting-proof-review', async () => {
    // Mock supabase admin with submit_b2b_order returning success.
    // Assertions:
    //   - returned order_id + order_ref are non-null
    //   - orders.status was updated to 'awaiting-proof-review' (not awaiting-approval)
    //   - orders.monday_item_id stays NULL
    //   - one audit_events row with action='order.monday_push_failed'
  })
})
```

Stub Supabase admin with chained `.from().select()...` calls returning the success fixtures. Existing `submit_b2b_order` test pattern in `lib/checkout/__tests__/` is the template.

### Task 3.7 — Smoke test against dev

Manual: submit one test order against dev Supabase. Verify:

1. Order persists with `status='awaiting-proof-review'`
2. Monday item appears in board 2046357917 → "New Deals" group with `deal_source = "Portal - Order"`
3. Sub-items present, one per line, format `"{designName}: {productName} — {variantLabel} × {qty}"`
4. AM email arrives with both proof link AND Monday link
5. `design_proofs` row created via existing autofill (unchanged)

### Stage 3 done-criteria

- [ ] All file edits land; `tsc --noEmit` clean.
- [ ] New unit test passes.
- [ ] Existing checkout tests still pass (pre-existing CheckoutClient.review-redirect test still fails on the same CurrencyProvider mock gap as before this branch — not regressed).
- [ ] Dev smoke green per Task 3.7.
- [ ] No staff-portal changes yet — order-approve route still exists but starts seeing orders with `status='awaiting-proof-review'` that it can't action (409 returned per existing route guard). This is fine; it's how Stage 3 ships independently.

**Commit:** `feat(checkout): wire Monday CRM Deals push + auto-proof at customer submit`

---

## Stage 4 — Staff cleanup + proof-approve extension

**Branch:** `feat/checkout-pipeline-stage-4-staff-cleanup`
**Goal:** Move PDF generation into the proof-approve route; delete the order-approve route; add retry-Monday-push surface; rename the dashboard button.

### Task 4.1 — Extend `POST /api/proofs/[id]/approve` (staff portal)

In [src/app/api/proofs/[id]/approve/route.ts](../../../print-room-staff-portal/src/app/api/proofs/[id]/approve/route.ts), between the open-amendments check and the `proof_quality_status='sent_to_customer'` update, add:

```ts
// 2026-05-21 — render production PDF, attach to Monday Deals item.
// Replaces the (deleted) POST /api/orders/:id/approve responsibility.
let mondayAttachmentResult: { attached: boolean; error: string | null } = {
  attached: false,
  error: null,
}
if (proof.order_id) {
  const pdfResult = await prepareOrderProofForApproval(access.admin, proof.order_id, {
    userId: access.context.userId,
    displayName: access.context.displayName,
  })

  if (!pdfResult.ok) {
    return NextResponse.json(
      { error: 'proof_pdf_generation_failed', checklist: pdfResult.checklist },
      { status: 409 },
    )
  }

  // Look up the order's Monday item id (written at checkout in Stage 3).
  const { data: orderRow } = await access.admin
    .from('orders')
    .select('monday_item_id')
    .eq('id', proof.order_id)
    .maybeSingle()

  if (orderRow?.monday_item_id) {
    try {
      await attachPdfToMondayItem(orderRow.monday_item_id, {
        filename: pdfResult.filename,
        buffer: pdfResult.pdf,
      })
      mondayAttachmentResult = { attached: true, error: null }
    } catch (err) {
      mondayAttachmentResult = {
        attached: false,
        error: err instanceof Error ? err.message : String(err),
      }
      // Continue — proof push to customer is the user-facing action;
      // Monday attachment failure goes to audit but doesn't block.
    }
  } else {
    mondayAttachmentResult = {
      attached: false,
      error: 'monday_item_id_missing — checkout-time push likely failed; AM can retry',
    }
  }
}
```

Add the helper `attachPdfToMondayItem` to `src/lib/monday/deal-item.ts` (mirrored from `src/lib/monday/production-job.ts`'s existing attach logic — pull it over before deleting production-job.ts in Task 4.4):

```ts
export async function attachPdfToMondayItem(
  itemId: string,
  file: { filename: string; buffer: Buffer },
): Promise<void> {
  // Implementation: Monday file upload via add_file_to_column or
  // create_update mutation. Existing pattern lives in
  // print-room-staff-portal/src/lib/monday/production-job.ts (search for
  // add_file_to_column or similar). Copy verbatim; reposition under
  // deal-item.ts at the same time.
}
```

After the Monday block, before the existing `proof_quality_status` update, also flip `orders.status` to `awaiting-customer-approval`:

```ts
if (proof.order_id) {
  await access.admin
    .from('orders')
    .update({ status: 'awaiting-customer-approval' })
    .eq('id', proof.order_id)
}
```

Update the route response to include `mondayPdfAttached: mondayAttachmentResult.attached`.

### Task 4.2 — Rename "Approve & send to customer" → "Push to customer"

In [src/components/proofs/proof-editor.tsx](../../../print-room-staff-portal/src/components/proofs/proof-editor.tsx) (search for the button label), update the visible string. No handler changes.

### Task 4.3 — Delete `POST /api/orders/[id]/approve`

Delete file `src/app/api/orders/[id]/approve/route.ts`.

Also delete `src/lib/orders/submit.ts`'s `retryOrderProductionPush` export (and any internal helpers only it used).

### Task 4.4 — Delete `production-job.ts` in both repos

Confirm via grep:

```bash
# portal
grep -rn "production-job" print-room-portal/ --include="*.ts" --include="*.tsx"
# staff
grep -rn "production-job" print-room-staff-portal/ --include="*.ts" --include="*.tsx"
```

After moving `attachPdfToMondayItem` to `deal-item.ts` (Task 4.1) and confirming no other callers remain:

- Delete `print-room-portal/lib/monday/production-job.ts`
- Delete `print-room-staff-portal/src/lib/monday/production-job.ts`

Also remove the now-unused constants `PRODUCTION_BOARD_ID`, `PRODUCTION_SUBITEMS_BOARD_ID`, `PRODUCTION_COLUMNS`, `PRODUCTION_SUBITEM_COLUMNS` from `lib/monday/column-ids.ts` **only if** grep confirms no remaining callers. (`lib/monday/subitems.ts` uses `PRODUCTION_SUBITEM_COLUMNS` for the inbound fetch — likely still needed.)

### Task 4.5 — `OrderDetailClient.tsx` button surgery

In [src/components/orders/OrderDetailClient.tsx](../../../print-room-staff-portal/src/components/orders/OrderDetailClient.tsx):

1. Remove the "Approve order" button + its `onClick` handler + any "are you sure" confirm dialog code attached to it.
2. Add a "Retry Monday push" button visible only when `order.monday_item_id === null`. POSTs to a new route `/api/orders/[id]/retry-monday-push`.

### Task 4.6 — Add retry route

Create `src/app/api/orders/[id]/retry-monday-push/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { requireOrdersStaffAccess } from '@/lib/orders/server'
import { pushOrderDeal, type OrderLineForMonday } from '@/lib/monday/deal-item'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireOrdersStaffAccess()
  if ('error' in auth) return auth.error
  const { id: orderId } = await params

  const { data: order } = await auth.admin
    .from('orders')
    .select('id, monday_item_id, quote_id')
    .eq('id', orderId)
    .maybeSingle()

  if (!order) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (order.monday_item_id) {
    return NextResponse.json({ error: 'already_pushed', mondayItemId: order.monday_item_id }, { status: 409 })
  }

  // Re-fetch order + quote + lines and call pushOrderDeal.
  // (Implementation mirrors the Stage 3 checkout-time block in submit.ts.
  // Extract that block into a shared helper buildOrderDealFromQuoteId in
  // lib/orders/build-monday-payload.ts so this route + checkout share code.)

  // ... pushOrderDeal call, write monday_item_id + subitem ids ...

  return NextResponse.json({ ok: true })
}
```

> Stage 4 sub-refactor: extract the payload-build from Stage 3's submit.ts inline code into `lib/orders/build-monday-payload.ts` (portal) + mirror (staff). The retry route in staff and the checkout in portal both call it. Reduces duplication.

### Task 4.7 — E2E smoke test

Manual walkthrough:

1. Customer submits order on portal. Verify: Monday item lands, AM email arrives with both links, order status = `awaiting-proof-review`, proof draft exists.
2. Staff opens proof in dashboard, makes a small edit, clicks "Push to customer". Verify: PDF generated, PDF attached to Monday item, customer email sent, `orders.status = 'awaiting-customer-approval'`, `proof_quality_status = 'sent_to_customer'`.
3. Customer opens `/orders/{id}/proof`, clicks Approve. Verify: `order_proof_approval_gate = 'approved'`, `orders.status` flips appropriately.
4. Negative: manually NULL out `orders.monday_item_id` for a fresh order, open in staff portal, click "Retry Monday push". Verify Monday item lands, button disappears.

### Stage 4 done-criteria

- [ ] Order-approve route deleted; staff-portal builds and routes-list confirms no orphan.
- [ ] Production-job.ts deleted in both repos.
- [ ] Proof-approve route handles PDF + Monday attachment + status flip.
- [ ] Retry-Monday-push route + button live.
- [ ] Proof editor button renamed.
- [ ] E2E smoke walks happy path + retry path.

**Commits (staff portal, in order):**
1. `feat(proofs): render production PDF + attach to Monday Deals item on push-to-customer`
2. `refactor(orders): delete legacy order-approve route + production-job.ts`
3. `feat(orders): retry Monday push button + route for missing-item recovery`

---

## Out-of-band cleanup (optional, after Stage 4)

- [ ] Delete unused `PRODUCTION_BOARD_ID` / `PRODUCTION_SUBITEMS_BOARD_ID` constants if grep confirms zero remaining callers.
- [ ] Sweep `lib/monday/types.ts` for dead `ProductionJob*` interfaces.
- [ ] Sprint doc per `feedback_end_of_sprint_doc.md` covering: what shipped, the AM-gate retirement rationale, the two new statuses, the retry surface, and the followups (subitem-on-deals-board enabled flag, AM Monday-user assignment).

## Risk recap (from spec)

- Subitems toggle on board 2046357917 — pre-flight P1.
- `"Portal - Order"` label pre-create — pre-flight P2.
- Reorder helper rename — Stage 2 done-criteria includes manual reorder smoke.
- Race between Monday push + autofill in submit.ts — sequential, no real race; comment in file.
- Order-approve route external callers — grep before delete in Task 4.3.
- Monday URL prefix env var fallback — Task 3.4 helper short-circuits to no-link when missing.

## Placeholder scan

No `TBD`, no `TODO`, no `appropriate error handling`, no `similar to existing pattern` without a file ref. Every code block is the actual code to write. ✅
