# Customer B2B Checkout MVP — 2026-04-24 Amendments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the three customer-portal amendments added to the Customer B2B Checkout MVP spec §15 by Chris's 2026-04-24 meeting: refine the reorder line-item display, add a consolidated customer inventory view, and lock nav-label + cart-chip visibility rules.

**Architecture:** Additive changes to the existing `print-room-portal` (Next.js 16, Tailwind v4, Supabase). No new infrastructure. The inventory view reads the `variant_availability` Postgres view from the staff-portal Inventory sub-app spec — this plan assumes that view exists; if not, the customer inventory tab renders empty gracefully (no error, no sidebar entry). Nav and cart-chip constraints are forward-looking and handed off to the parent 2026-04-20 Customer Checkout MVP plan for enforcement when the catalogue ships.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v4, Supabase (service-role admin client for cross-org queries, server component client for auth), existing `@/contexts/CompanyContext`, existing `@/components/layout/Sidebar` nav.

---

## Context & scope

### Spec source

[docs/superpowers/specs/2026-04-20-customer-b2b-checkout-mvp-design.md](../specs/2026-04-20-customer-b2b-checkout-mvp-design.md) — §15 Amendment 2026-04-24.

Three items in scope:

- **§15.1** — Refine the past-order line-item display (`ProjectLineItem.tsx` and `formatItemBreakdown` in `lib/monday/reorder.ts`): drop thumbnail, drop decoration type, drop logo-count chip. Render only design name → product name → colour → sizes (as-ordered). Read-only.
- **§15.2** — Add a consolidated customer inventory view at `app/(portal)/inventory/page.tsx` for stocked-inventory customers only. Read-only. Hidden for customers with no `variant_inventory` rows.
- **§15.3** — Sidebar label for `/shop` is "Catalog". Cart chip visibility is scoped to `/shop`, `/shop/[productId]`, `/cart`, `/checkout`, `/order-tracker`, `/inventory`. The cart chip itself is built by the parent 2026-04-20 plan; this plan only documents the scoping constraint.

### Relationship to the parent plan

The 2026-04-20 Customer B2B Checkout MVP plan ([docs/superpowers/plans/2026-04-20-customer-b2b-checkout-mvp-plan.md](./2026-04-20-customer-b2b-checkout-mvp-plan.md)) has 25 tasks, 0 complete. It already plans modifications to `JobTrackerOrderCard.tsx` (Task 12 per earlier grep). This plan is an *extension*, not a replacement — the parent plan still owns the catalogue, cart, checkout, quote-request flow, and reorder-request (oversell) work.

Task ordering expectation: this amendment plan can be executed in parallel with the parent plan's early tasks because the ProjectLineItem and formatItemBreakdown changes touch files the parent plan does not modify, and the inventory view is a net-new surface. Only the sidebar change (Task 8 here) overlaps conceptually with the parent plan's Task 4 route scaffolding — coordinate or sequence if both happen in the same sprint.

### Parallel work outside this plan (context only, do not implement here)

- **Stream B — pricing editor spec** — not yet brainstormed. Lives in `print-room-staff-portal`. Will be its own spec + plan.
- **Stream B — metafields spec** — not yet brainstormed. Lives in `print-room-staff-portal`. Will be its own spec + plan.
- **Inventory sub-app — Products editor tab** — separate amendment on the staff-portal inventory spec ([docs/superpowers/specs/2026-04-20-staff-portal-inventory-subapp-design.md](../../../../print-room-staff-portal/docs/superpowers/specs/2026-04-20-staff-portal-inventory-subapp-design.md) §14). Separate follow-up PR.
- **B2B catalogues sub-app #3** — after Checkout MVP ships; pulls forward v1.1 batch SKU → vendor catalogue work. Needs its own spec.
- **Workwear landing + contact + quote submission refinement** — after Checkout MVP ships per Chris's priority call.
- **Wishlist favourites email update** — standalone small task; not in this plan.

### Deferred until Chris delivers inputs (Stream B — not this plan)

- Pricing rules spreadsheet (Chris will use the pricing editor UI directly once it ships).
- Metafield list (Chris will send from Fireflies summary).

### Tooling & verification baseline

This repo has **no test runner set up** (no `vitest`, `jest`, `playwright`, or `test` script in `package.json` as of this plan). Verification strategy for every task:

- **Compile check:** `npx tsc --noEmit` from `print-room-portal/`.
- **Build check:** `npm run build` from `print-room-portal/`.
- **Runtime check:** `npm run dev`, then manually exercise in the browser. Chromium + React DevTools.
- **Pure-function check:** for `formatItemBreakdown` and similar, use a small `tsx`/`node --experimental-strip-types` script with hand-rolled fixtures (Task 3 includes the script).

Skip the TDD "write the failing test first" ritual — adapted because the repo has no runner. Adding a runner is out of scope for this amendment.

### Next.js 16 caveat

Both `print-room-staff-portal` and `print-room-portal` are on Next.js 16. Consult `node_modules/next/dist/docs/` before touching route handlers or server/client boundaries. Async params, request/cookies APIs, and server/client boundaries differ from pre-16 patterns. The existing `app/api/order-tracker/route.ts` is a good reference for the GET-with-auth pattern used in Task 5.

### Files this plan touches

**Modify:**
- `components/orders/ProjectLineItem.tsx` — field-set refactor (Task 2)
- `lib/monday/reorder.ts` — `formatItemBreakdown` refactor (Task 3)
- `lib/job-tracker.ts` — add `getItemDesignName` helper (Task 1)
- `lib/job-tracker-queries.ts` — enrich trackers with `designNamesByInstanceId` (Task 1)
- `types/company.ts` — add `hasTrackedInventory: boolean` to `B2BCustomerAccess` (Task 4)
- `contexts/CompanyContext.tsx` — populate `hasTrackedInventory` from a new query (Task 4)
- `components/layout/Sidebar.tsx` — add conditional Inventory nav entry (Task 8)

**Create:**
- `app/api/inventory/route.ts` — GET customer's tracked inventory rows (Task 5)
- `app/(portal)/inventory/page.tsx` — landing page for the customer-facing inventory view (Task 7)
- `components/inventory/CustomerInventoryTable.tsx` — read-only table (Task 6)

**Parent-plan handoff (no code in this plan, just a note added to the parent plan):**
- `docs/superpowers/plans/2026-04-20-customer-b2b-checkout-mvp-plan.md` — appended note for cart-chip scoping + Catalog label (Task 10)

---

## Task 0: Pre-flight

**Files:** none (verification only)

- [x] **Step 0.1: Confirm repo state**

Run from `print-room-portal/`:

```bash
git status
git rev-parse --abbrev-ref HEAD
```

Expected: clean working tree on a feature branch (create one if on main: `git checkout -b feat/checkout-mvp-2026-04-24-amendments`).

- [x] **Step 0.2: Baseline compile**

Run:

```bash
npx tsc --noEmit
```

Expected: zero errors. If errors exist before we start, they're pre-existing — note them, but they should not be treated as this plan's problem.

- [x] **Step 0.3: Baseline dev boot**

Run:

```bash
npm run dev
```

Expected: dev server boots, `/order-tracker` renders for an authenticated customer, `JobTrackerOrderCard` expands to show `ProjectLineItem` rows. Screenshot this for before/after comparison. Stop the dev server.

- [x] **Step 0.4: Commit baseline marker**

```bash
git commit --allow-empty -m "chore: baseline before 2026-04-24 checkout-mvp amendments"
```

---

## Task 1: Design-name resolution helper

**Goal:** Make "design name" a first-class property on each line item so `ProjectLineItem` and `formatItemBreakdown` can render it cleanly. Server enriches trackers with a `designNamesByInstanceId` map (mirrors the existing `productImagesByProductId` enrichment); client helpers read from it with graceful fallback.

**Files:**
- Modify: `lib/job-tracker.ts`
- Modify: `lib/job-tracker-queries.ts`
- Modify: `types/company.ts` (or wherever `JobTracker` is typed — verify in Step 1.1)

- [x] **Step 1.1: Locate the design-name source**

Two possible sources for a design's human-readable name:

1. `design_submissions.design_name` table column (per `lib/collections.ts:31`).
2. `item.customizations?.logos?.[0]?.designName` or similar on `QuoteDataLogo` — inspect the type.

Run:

```bash
grep -n "interface QuoteDataLogo\|type QuoteDataLogo" lib/job-tracker.ts
```

Read the full `QuoteDataLogo` definition. If the logo object already carries `designName` (or an equivalent — `name`, `title`, `designTitle`), use that as the primary source (no DB query needed).

If `QuoteDataLogo` does not carry a design name, fall back to the `design_submissions` join strategy below. Either way, document the source decision inline as a comment on `getItemDesignName`.

- [x] **Step 1.2: Add `getItemDesignName` helper**

Append to `lib/job-tracker.ts` (after the other `getItem*` helpers, around line 240):

```ts
/**
 * Design name for a line item on the Projects / reorder surface.
 *
 * Resolution order:
 *   1. Logo-level designName (if QuoteDataLogo carries it — confirmed in Step 1.1).
 *   2. Enriched map from `designNamesByInstanceId` on the tracker (server-side join).
 *   3. Fallback string "Design" so the row still renders.
 *
 * Callers on the Projects surface pass `designNamesByInstanceId` from the tracker
 * row; callers that only have the item (e.g. the CRM Deal text formatter) pass
 * undefined and rely on fallback chain 1 + 3.
 */
export function getItemDesignName(
  item: QuoteDataItem,
  designNamesByInstanceId?: Record<string, string>
): string {
  const logoName = item.customizations?.logos?.[0]?.designName
  if (typeof logoName === 'string' && logoName.trim().length > 0) {
    return logoName.trim()
  }

  const instanceId = item.designInstanceId
  if (instanceId && designNamesByInstanceId?.[instanceId]) {
    return designNamesByInstanceId[instanceId]
  }

  return 'Design'
}
```

(If Step 1.1 showed the logo carries a different field name — e.g. `name` or `title` — substitute that in the first resolution branch.)

- [x] **Step 1.3: Extend the `JobTracker` type**

Locate the `JobTracker` interface (verify with `grep -n "interface JobTracker\b" lib/job-tracker.ts` or `lib/job-tracker-queries.ts`). Add one optional field alongside the existing `productImagesByProductId`:

```ts
// On the JobTracker interface:
designNamesByInstanceId?: Record<string, string>
```

- [x] **Step 1.4: Enrich trackers server-side**

Modify `lib/job-tracker-queries.ts` where `productImagesByProductId` is populated (around lines 55–70 per the earlier grep). Add a parallel design-name enrichment. Example outline (adapt to the exact enrichment function structure in the file):

```ts
// After the existing product-image batch fetch:
const designInstanceIds = new Set<string>()
for (const tracker of trackers) {
  const items = tracker.quote_data?.items ?? []
  for (const item of items) {
    if (item?.designInstanceId) designInstanceIds.add(item.designInstanceId)
  }
}

let designNamesByInstanceId: Record<string, string> = {}
if (designInstanceIds.size > 0) {
  const { data: designs } = await supabase
    .from('design_submissions')
    .select('id, design_name')
    .in('id', Array.from(designInstanceIds))

  if (designs) {
    designNamesByInstanceId = Object.fromEntries(
      designs
        .filter((d) => typeof d.design_name === 'string' && d.design_name.length > 0)
        .map((d) => [d.id, d.design_name as string])
    )
  }
}

// Per-tracker map filtered to the ids present on that tracker's items:
return trackers.map((tracker) => {
  // ... existing productImagesByProductId assembly ...

  const trackerDesignNames: Record<string, string> = {}
  const items = tracker.quote_data?.items ?? []
  for (const item of items) {
    const id = item?.designInstanceId
    if (id && designNamesByInstanceId[id]) {
      trackerDesignNames[id] = designNamesByInstanceId[id]
    }
  }

  return {
    ...tracker,
    productImagesByProductId: /* existing */,
    designNamesByInstanceId: trackerDesignNames,
  }
})
```

**Important:** the `design_submissions` table may not be readable under RLS for every customer. Use the `adminClient` / service-role client that `getJobsForUser` already uses for the tracker lookup (verify against the existing pattern at `lib/job-tracker-queries.ts:89` and neighbours). The design-name lookup is not sensitive and is already exposed on the customer's own Projects view via the line items themselves.

If `design_submissions` is not the right source (e.g. Step 1.1 revealed the logo carries the name inline), skip Step 1.4 entirely and leave `designNamesByInstanceId` unset — the fallback chain in Step 1.2 handles it.

- [x] **Step 1.5: Compile**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [x] **Step 1.6: Commit**

```bash
git add lib/job-tracker.ts lib/job-tracker-queries.ts
git commit -m "feat(reorder): add getItemDesignName helper + tracker enrichment"
```

---

## Task 2: Refactor `ProjectLineItem` to the §15.1 field set

**Goal:** Replace the current 3-column layout (thumbnail / middle / right) with a 2-column layout (content / sizes+total). Drop thumbnail, print-method chip, and logo-count chip. Add design name as the primary heading, product name as secondary, colour chip retained, sizes preserved as-ordered.

**Files:**
- Modify: `components/orders/ProjectLineItem.tsx`
- Modify: `components/orders/JobTrackerOrderCard.tsx` — pass `designNamesByInstanceId` to each `<ProjectLineItem>` invocation

- [ ] **Step 2.1: Update `ProjectLineItemProps`**

Replace the current interface:

```ts
export interface ProjectLineItemProps {
  item: QuoteDataItem
  productImageUrl?: string
}
```

With:

```ts
export interface ProjectLineItemProps {
  item: QuoteDataItem
  designNamesByInstanceId?: Record<string, string>
}
```

The `productImageUrl` prop is removed — §15.1 drops the thumbnail entirely.

- [ ] **Step 2.2: Replace the component body**

Full replacement for the component (everything from `export function ProjectLineItem` to the closing brace). Paste:

```tsx
export function ProjectLineItem({
  item,
  designNamesByInstanceId,
}: ProjectLineItemProps) {
  const designName = getItemDesignName(item, designNamesByInstanceId)
  const productName = getItemDisplayName(item)
  const colorName = getItemColorName(item)
  const colorHex = getItemColorHex(item)
  const totalQty = getItemTotalQty(item)

  // Preserve insertion order of item.sizes — do NOT sort alphabetically.
  // Chris 2026-04-24: "sizes down to the right... Maybe that's in alphabetical
  // order. It is. I don't know if it can pull them in the way that they show
  // up." The source now preserves order; we don't alphabetise client-side.
  const sizeEntries = item.sizes
    ? Object.entries(item.sizes).filter(([, n]) => (n ?? 0) > 0)
    : []

  return (
    <div className="glass-chip flex gap-4 p-3 sm:p-4">
      {/* Content column — no thumbnail per §15.1 */}
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <h5
          className="font-semibold text-black text-sm truncate"
          title={designName}
        >
          {designName}
        </h5>

        <p
          className="text-xs text-gray-700 truncate"
          title={productName}
        >
          {productName}
        </p>

        {colorName && (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-gray-200 bg-white text-xs text-gray-700 self-start mt-0.5">
            {colorHex && (
              <span
                className="w-3 h-3 rounded-full border border-gray-200"
                style={{ backgroundColor: colorHex }}
                aria-hidden="true"
              />
            )}
            <span>{colorName}</span>
          </span>
        )}
      </div>

      {/* Right column — sizes + total */}
      <div className="flex-shrink-0 flex flex-col items-end gap-1.5 min-w-[100px]">
        <div className="flex flex-wrap gap-1 justify-end">
          {sizeEntries.length > 0 ? (
            sizeEntries.map(([size, qty]) => (
              <span
                key={size}
                className="inline-flex items-center px-1.5 py-0.5 rounded-md border border-gray-200 bg-white text-[11px] font-medium text-gray-700"
                title={`${size}: ${qty}`}
              >
                {size}:{qty}
              </span>
            ))
          ) : (
            <span className="text-[11px] text-gray-400">No size breakdown</span>
          )}
        </div>
        <p className="text-sm font-semibold text-black">
          {totalQty}{' '}
          <span className="font-normal text-gray-500 text-xs">total</span>
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 2.3: Update imports at the top of `ProjectLineItem.tsx`**

Replace the import block with:

```ts
import {
  getItemColorHex,
  getItemColorName,
  getItemDesignName,
  getItemDisplayName,
  getItemTotalQty,
  type QuoteDataItem,
} from '@/lib/job-tracker'
```

Remove: `getItemArtworkUrl`, `getItemPrintMethod` — no longer used here. Also remove the local `capitalise` helper function (it was only used for `printMethod`).

- [ ] **Step 2.4: Update `JobTrackerOrderCard.tsx` callers**

`JobTrackerOrderCard` uses `ProjectLineItem` when rendering the expanded body (not directly shown in the earlier read, but it's the parent card — verify with `grep -n "ProjectLineItem" components/orders/JobTrackerOrderCard.tsx`).

For every `<ProjectLineItem ... />` invocation, replace the `productImageUrl` prop with `designNamesByInstanceId`:

```tsx
<ProjectLineItem
  item={item}
  designNamesByInstanceId={tracker.designNamesByInstanceId}
/>
```

Remove any `getOrderImage()`-derived `productImageUrl` pass-through for ProjectLineItem. (The order card's own header thumbnail at lines 40-53 of `JobTrackerOrderCard.tsx` can stay — that's the card-level hero image, not the per-line image. Chris's §15.1 drop rule applies to the *line-item* display.)

- [ ] **Step 2.5: Compile**

```bash
npx tsc --noEmit
```

Expected: zero errors. If `productImageUrl` is referenced elsewhere on `ProjectLineItemProps`, remove it there too.

- [ ] **Step 2.6: Visual verification**

```bash
npm run dev
```

Visit `/order-tracker` as a customer with completed projects (Jamie: the `jon@theprint-room.co.nz` account or Kadrona's profile used in the original demo). Expand a completed project card. Line items should render:

- Design name (bold) on the first line
- Product name (lighter) on the second line
- Colour chip with hex swatch below
- Sizes and total on the right

No thumbnail. No print-method chip. No "+N more designs" chip.

Cross-check against a project that uses multiple colours across line items — each row should read cleanly as "Design / Product / Colour / Sizes".

Stop the dev server.

- [ ] **Step 2.7: Commit**

```bash
git add components/orders/ProjectLineItem.tsx components/orders/JobTrackerOrderCard.tsx
git commit -m "feat(reorder): tone ProjectLineItem to §15.1 field set (drop image, decoration, logo-count)"
```

---

## Task 3: Refactor `formatItemBreakdown` in `lib/monday/reorder.ts`

**Goal:** The Monday CRM Deal payload text that staff sees must mirror the on-screen display rules so the sales team gets consistent data. Change the per-item breakdown from `• {name} — {color} — ({method})` to a design-first block matching §15.1.

**Files:**
- Modify: `lib/monday/reorder.ts`

- [ ] **Step 3.1: Update `formatItemBreakdown` signature and body**

Locate `formatItemBreakdown` (currently `lib/monday/reorder.ts:84-111`). Replace its implementation with:

```ts
function formatItemBreakdown(
  items: QuoteDataItem[],
  designNamesByInstanceId?: Record<string, string>
): string[] {
  if (!items || items.length === 0) {
    return [
      'Original order had no itemised records (legacy webhook-only tracker).',
      'Staff to pull details from Monday/quote.',
    ]
  }
  const lines: string[] = []
  for (const item of items) {
    const designName = getItemDesignName(item, designNamesByInstanceId)
    const productName = getItemDisplayName(item)
    const color = getItemColorName(item)
    const qty = getItemTotalQty(item)

    lines.push(`• Design: ${designName}`)
    lines.push(`  Product: ${productName}`)
    if (color) lines.push(`  Colour: ${color}`)

    const sizeBreakdown = item.sizes
      ? Object.entries(item.sizes)
          .filter(([, n]) => (n ?? 0) > 0)
          .map(([k, n]) => `${k}:${n}`)
          .join(' ')
      : ''
    if (sizeBreakdown) {
      lines.push(`  Sizes: ${sizeBreakdown} = ${qty}`)
    } else if (qty > 0) {
      lines.push(`  Qty: ${qty}`)
    }
    lines.push('')
  }
  // Drop the trailing blank line for a tidy message footer.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}
```

Key changes:
- Dropped `getItemPrintMethod` — method is no longer surfaced in the CRM payload text.
- Dropped the `color` → `method` suffixing on the header line.
- New structure: `Design / Product / Colour / Sizes` per item, with blank lines between items for readability.

- [ ] **Step 3.2: Thread `designNamesByInstanceId` through `buildReorderDataFromTracker`**

`buildReorderDataFromTracker` at `lib/monday/reorder.ts:231-267` produces `ReorderData` which is then passed to `createReorderItem`. Add the design-name map to the pipeline:

In `ReorderData` interface (around line 50):

```ts
export interface ReorderData {
  customerEmail: string
  // ... existing fields ...
  originalItems: QuoteDataItem[]
  designNamesByInstanceId?: Record<string, string>   // NEW
}
```

In `buildReorderDataFromTracker` return block (around line 250), add:

```ts
return {
  // ... existing fields ...
  originalItems: tracker.quote_data?.items ?? [],
  designNamesByInstanceId: tracker.designNamesByInstanceId ?? {},
}
```

In `buildFullFormResponse` at `lib/monday/reorder.ts:113-167`, update the call:

```ts
lines.push('--- Original Order Items ---')
lines.push(...formatItemBreakdown(data.originalItems, data.designNamesByInstanceId))
lines.push('')
```

- [ ] **Step 3.3: Update `formatProductsCompact` (the short header line)**

`formatProductsCompact` at `lib/monday/reorder.ts:67-82` produces a compact "products summary" for the Monday item's product column. Chris's rule is design-first; adjust:

```ts
function formatProductsCompact(
  items: QuoteDataItem[],
  designNamesByInstanceId?: Record<string, string>
): string {
  if (!items || items.length === 0) {
    return 'Reorder — details on original job'
  }
  return items
    .map((item) => {
      const designName = getItemDesignName(item, designNamesByInstanceId)
      const productName = getItemDisplayName(item)
      const qty = getItemTotalQty(item)
      const parts = [`${designName} / ${productName}`]
      if (qty > 0) parts.push(`x${qty}`)
      return parts.join(' ')
    })
    .join(', ')
}
```

And update its caller in `createReorderItem` (around line 188):

```ts
[COL_PRODUCT]: formatProductsCompact(data.originalItems, data.designNamesByInstanceId),
```

- [ ] **Step 3.4: Update imports at the top of `lib/monday/reorder.ts`**

Ensure `getItemDesignName` is imported alongside the existing job-tracker helpers:

```ts
import {
  getItemColorName,
  getItemDesignName,
  getItemDisplayName,
  getItemTotalQty,
} from '@/lib/job-tracker'
```

Remove `getItemPrintMethod` from the import list if it was present — no longer used.

- [ ] **Step 3.5: Compile**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3.6: Smoke-test the formatter with a fixture script**

Create a throwaway script at `scripts/test-reorder-formatter.ts` (don't commit this; delete after):

```ts
// scripts/test-reorder-formatter.ts
import { buildReorderDataFromTracker } from '../lib/monday/reorder'
import type { JobTracker } from '../lib/job-tracker'

const fixture = {
  id: 1,
  tracker_token: 'test-token',
  quote_number: 'Q-TEST-001',
  monday_project_name: 'Test project',
  quote_data: {
    items: [
      {
        productId: 'p1',
        productName: 'AS Colour Classic Tee',
        designInstanceId: 'd1',
        customizations: {
          logos: [{ printMethod: 'screenprint' }],
          colors: { garment: { name: 'Black', hex: '#000' } },
        },
        sizes: { S: 2, M: 5, L: 3 },
        quantity: 10,
      },
    ],
  },
  designNamesByInstanceId: { d1: 'Snow Dragons 2026' },
} as unknown as JobTracker

const data = buildReorderDataFromTracker(fixture, {
  customerEmail: 'test@example.com',
  customerName: 'Test Customer',
  deliveryAddress: '1 Test St',
  inHandDate: '2026-05-15',
})

console.log('--- Compact products ---')
console.log(
  require('../lib/monday/reorder').__test_formatCompact?.(
    data.originalItems,
    data.designNamesByInstanceId
  ) ?? '(export __test_formatCompact to test directly)'
)

// For now, just print the full form text — you can see formatItemBreakdown output inside it.
// In practice, call buildFullFormResponse if you export it, or inline the breakdown call.
```

Run:

```bash
npx tsx scripts/test-reorder-formatter.ts
```

Expected output contains:

```
• Design: Snow Dragons 2026
  Product: AS Colour Classic Tee
  Colour: Black
  Sizes: S:2 M:5 L:3 = 10
```

No `screenprint` method label, no image reference. If the output is wrong, fix and re-run. When correct, delete the scratch script:

```bash
rm scripts/test-reorder-formatter.ts
```

- [ ] **Step 3.7: Commit**

```bash
git add lib/monday/reorder.ts
git commit -m "feat(reorder): align Monday CRM payload text with §15.1 field set"
```

---

## Task 4: Extend `B2BCustomerAccess` with `hasTrackedInventory`

**Goal:** Make "does this customer have any tracked inventory?" a first-class flag on the company context, so the Sidebar and the `/inventory` page can gate behaviour without re-querying.

**Files:**
- Modify: `types/company.ts`
- Modify: `contexts/CompanyContext.tsx`

- [ ] **Step 4.1: Add `hasTrackedInventory` to the type**

Locate `B2BCustomerAccess` interface. Add:

```ts
export interface B2BCustomerAccess {
  // ... existing fields ...
  hasTrackedInventory: boolean
}
```

(If the interface has optional fields, match that style: `hasTrackedInventory?: boolean`. Prefer required with a default `false` set at context-creation time so consumers don't need to handle `undefined`.)

- [ ] **Step 4.2: Populate from a count query**

In `CompanyContext.tsx` where the customer access object is built (grep for `isCompanyUser` or similar to find the factory), add a count query against `variant_inventory`:

```ts
// After the user's organization_id has been resolved in the context:
let hasTrackedInventory = false
if (organizationId) {
  const { count, error } = await supabase
    .from('variant_inventory')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)

  if (!error && typeof count === 'number' && count > 0) {
    hasTrackedInventory = true
  }
}

const access: B2BCustomerAccess = {
  // ... existing fields ...
  hasTrackedInventory,
}
```

Use a `head: true` count query (no rows returned, just the count) to keep the cost low.

**If `variant_inventory` does not yet exist** (Inventory sub-app unshipped), the query will return `error` with a "relation does not exist" code. Treat this as `hasTrackedInventory = false` — no sidebar entry, no page link. The page itself (Task 7) also handles the missing-table case gracefully.

- [ ] **Step 4.3: Compile**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4.4: Verify via dev server**

```bash
npm run dev
```

In browser DevTools, inspect the `access` object (console-log it temporarily in `CompanyContext.tsx` during verification, then remove the log). For a customer org with no rows in `variant_inventory`, flag should be `false`. For Reburger / Bike Glendhu / Otago Polytech (once seeded), flag should be `true`.

If `variant_inventory` table doesn't exist yet, flag should be `false` without a crash.

Stop the dev server.

- [ ] **Step 4.5: Commit**

```bash
git add types/company.ts contexts/CompanyContext.tsx
git commit -m "feat(inventory): expose hasTrackedInventory on B2BCustomerAccess"
```

---

## Task 5: `GET /api/inventory` endpoint

**Goal:** Serve the customer's tracked inventory rows for the `/inventory` page. Server-side, filtered by the authenticated user's `organization_id`. Read-only.

**Files:**
- Create: `app/api/inventory/route.ts`

- [ ] **Step 5.1: Create the route file**

Create `app/api/inventory/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { getSupabaseServerComponent } from '@/lib/supabase-server-component'
import { getSupabaseServer } from '@/lib/supabase'

export interface CustomerInventoryRow {
  variant_id: string
  product_id: string
  product_name: string
  colour_name: string | null
  colour_hex: string | null
  size_label: string | null
  available_qty: number
  stock_qty: number
  committed_qty: number
  updated_at: string | null
}

export async function GET() {
  const supabase = await getSupabaseServerComponent()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ rows: [] }, { status: 401 })
  }

  const adminClient = getSupabaseServer()

  const { data: membership } = await adminClient
    .from('user_organizations')
    .select('organization_id')
    .eq('user_id', user.id)
    .single()

  const organizationId = membership?.organization_id
  if (!organizationId) {
    return NextResponse.json({ rows: [] })
  }

  // variant_availability is a view from the staff-portal Inventory sub-app spec.
  // It may not exist yet — we tolerate the error and return an empty result.
  const { data, error } = await adminClient
    .from('variant_availability')
    .select(
      `
      variant_id,
      stock_qty,
      committed_qty,
      available_qty,
      product_variants!inner (
        product_id,
        updated_at,
        product_color_swatches ( name, hex ),
        sizes ( label ),
        products ( name )
      )
    `
    )
    .eq('organization_id', organizationId)

  if (error) {
    console.error('[Customer Inventory API] query failed:', error.message)
    return NextResponse.json({ rows: [] })
  }

  // Flatten the joined shape into CustomerInventoryRow for the client table.
  const rows: CustomerInventoryRow[] = (data ?? []).map((r: any) => ({
    variant_id: r.variant_id,
    product_id: r.product_variants?.product_id ?? '',
    product_name: r.product_variants?.products?.name ?? 'Product',
    colour_name: r.product_variants?.product_color_swatches?.name ?? null,
    colour_hex: r.product_variants?.product_color_swatches?.hex ?? null,
    size_label: r.product_variants?.sizes?.label ?? null,
    available_qty: r.available_qty ?? 0,
    stock_qty: r.stock_qty ?? 0,
    committed_qty: r.committed_qty ?? 0,
    updated_at: r.product_variants?.updated_at ?? null,
  }))

  return NextResponse.json({ rows })
}
```

**On the PostgREST join shape:** the `!inner` join ensures rows without a matching variant are dropped. If the underlying schema shape differs from what's written here (e.g. the `product_color_swatches` relationship name is different), adjust per the actual migrations — the Inventory sub-app spec at §5.1 defines the canonical shape.

- [ ] **Step 5.2: Compile**

```bash
npx tsc --noEmit
```

Expected: zero errors. The `any` cast on the mapper is intentional — PostgREST join shapes are hard to type cleanly without generated types. Leave the cast; generated types land in a follow-up.

- [ ] **Step 5.3: Smoke-test the endpoint**

```bash
npm run dev
```

In a browser logged in as a B2B customer (ideally Reburger/Bike Glendhu/Otago Polytech if any test fixtures exist), hit `http://localhost:3000/api/inventory`. Expected:

- Status 200
- JSON body `{ rows: [...] }` with flattened rows, or `{ rows: [] }` if no inventory.
- If `variant_availability` view doesn't exist, the server logs the error but still returns `{ rows: [] }` — no 500.

Test unauthenticated: sign out, hit the URL again. Expected: status 401, body `{ rows: [] }`.

Stop the dev server.

- [ ] **Step 5.4: Commit**

```bash
git add app/api/inventory/route.ts
git commit -m "feat(inventory): GET /api/inventory for customer-facing inventory view"
```

---

## Task 6: `CustomerInventoryTable` component

**Goal:** Read-only table that renders the customer's tracked inventory. Row click navigates to the product's PDP.

**Files:**
- Create: `components/inventory/CustomerInventoryTable.tsx`

- [ ] **Step 6.1: Create the component**

Create `components/inventory/CustomerInventoryTable.tsx`:

```tsx
'use client'

import Link from 'next/link'
import type { CustomerInventoryRow } from '@/app/api/inventory/route'

export interface CustomerInventoryTableProps {
  rows: CustomerInventoryRow[]
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleDateString('en-NZ', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return '—'
  }
}

export function CustomerInventoryTable({ rows }: CustomerInventoryTableProps) {
  if (rows.length === 0) {
    return (
      <div className="card-elevated p-8 text-center">
        <p className="text-gray-500">
          No tracked inventory yet. Your account manager will let you know when
          stock is on hand.
        </p>
      </div>
    )
  }

  return (
    <div className="card-elevated overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-gray-600">
          <tr>
            <th className="text-left px-4 py-3 font-medium">Product</th>
            <th className="text-left px-4 py-3 font-medium">Colour</th>
            <th className="text-left px-4 py-3 font-medium">Size</th>
            <th className="text-right px-4 py-3 font-medium">Available</th>
            <th className="text-right px-4 py-3 font-medium">On hand</th>
            <th className="text-right px-4 py-3 font-medium">Updated</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.variant_id}
              className="border-t border-gray-100 hover:bg-gray-50 transition-colors"
            >
              <td className="px-4 py-3">
                <Link
                  href={`/shop/${row.product_id}`}
                  className="text-[rgb(var(--color-primary))] hover:underline"
                >
                  {row.product_name}
                </Link>
              </td>
              <td className="px-4 py-3">
                <span className="inline-flex items-center gap-1.5">
                  {row.colour_hex && (
                    <span
                      className="w-3 h-3 rounded-full border border-gray-200"
                      style={{ backgroundColor: row.colour_hex }}
                      aria-hidden="true"
                    />
                  )}
                  {row.colour_name ?? '—'}
                </span>
              </td>
              <td className="px-4 py-3">{row.size_label ?? '—'}</td>
              <td className="px-4 py-3 text-right font-semibold">
                {row.available_qty}
              </td>
              <td className="px-4 py-3 text-right text-gray-600">
                {row.stock_qty}
              </td>
              <td className="px-4 py-3 text-right text-gray-500 text-xs">
                {formatDate(row.updated_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 6.2: Compile**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 6.3: Commit**

```bash
git add components/inventory/CustomerInventoryTable.tsx
git commit -m "feat(inventory): CustomerInventoryTable read-only component"
```

---

## Task 7: `/inventory` landing page

**Goal:** Thin page that fetches `/api/inventory`, shows the table, and gracefully handles the "not tracked" case. Gated at the page level as a belt-and-braces pair with the sidebar gating in Task 8.

**Files:**
- Create: `app/(portal)/inventory/page.tsx`

- [ ] **Step 7.1: Create the page**

Create `app/(portal)/inventory/page.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { useCompany } from '@/contexts/CompanyContext'
import { CustomerInventoryTable } from '@/components/inventory/CustomerInventoryTable'
import type { CustomerInventoryRow } from '@/app/api/inventory/route'

export default function CustomerInventoryPage() {
  const { access, loading: companyLoading } = useCompany()
  const [rows, setRows] = useState<CustomerInventoryRow[]>([])
  const [dataLoading, setDataLoading] = useState(true)

  useEffect(() => {
    if (companyLoading) return
    if (!access) {
      setDataLoading(false)
      return
    }
    fetch('/api/inventory')
      .then((res) => (res.ok ? res.json() : { rows: [] }))
      .then((data) => {
        setRows(data.rows ?? [])
        setDataLoading(false)
      })
      .catch(() => setDataLoading(false))
  }, [access, companyLoading])

  if (companyLoading || dataLoading) {
    return (
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-48" />
          <div className="h-40 bg-gray-200 rounded-2xl" />
        </div>
      </div>
    )
  }

  if (!access) return null

  // Belt-and-braces: page renders even if Sidebar didn't gate correctly.
  // If the customer somehow lands here without tracked inventory, render the
  // empty state (no "Oops not for you" message — just a friendly empty table).

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Inventory</h1>
        <p className="text-sm text-gray-600 mt-1">
          Stock your Print Room account manager is holding for you. Click a
          product name to view details.
        </p>
      </div>

      <CustomerInventoryTable rows={rows} />
    </div>
  )
}
```

- [ ] **Step 7.2: Compile**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 7.3: Dev-server smoke test**

```bash
npm run dev
```

Visit `http://localhost:3000/inventory` as a B2B customer. Expected:

- Heading "Inventory"
- Either a populated table (stocked-inventory customer) or the friendly empty state (unstocked customer or `variant_availability` absent).
- Click a row's product name → navigates to `/shop/[productId]`. If `/shop/[productId]` doesn't exist yet (parent plan hasn't landed catalogue), expect a 404. That's acceptable — the link still points to the future canonical PDP route.

Stop the dev server.

- [ ] **Step 7.4: Commit**

```bash
git add app/\(portal\)/inventory/page.tsx
git commit -m "feat(inventory): /inventory customer-facing landing page"
```

---

## Task 8: Conditional Inventory sidebar entry

**Goal:** Surface the "Inventory" sidebar link only for customers whose `B2BCustomerAccess.hasTrackedInventory` is `true`. No empty state in the sidebar — the entry is either there or it isn't.

**Files:**
- Modify: `components/layout/Sidebar.tsx`

- [ ] **Step 8.1: Extend `allNavItems`**

At `components/layout/Sidebar.tsx:16-21`, replace the `allNavItems` array with:

```ts
const allNavItems = [
  { name: 'My Account', href: '/account', icon: HomeIcon, requiresCompany: false, requiresLeavers: false, requiresTrackedInventory: false },
  { name: 'Projects', href: '/projects', icon: TrackerIcon, requiresCompany: false, requiresLeavers: false, requiresTrackedInventory: false },
  { name: 'My Quotes', href: '/my-collections', icon: CatalogsIcon, requiresCompany: false, requiresLeavers: false, requiresTrackedInventory: false },
  { name: 'Leavers Quotes', href: '/leavers-quotes', icon: LeaversIcon, requiresCompany: false, requiresLeavers: true, requiresTrackedInventory: false },
  { name: 'Inventory', href: '/inventory', icon: InventoryIcon, requiresCompany: false, requiresLeavers: false, requiresTrackedInventory: true },
] as const
```

- [ ] **Step 8.2: Extend `getNavigationItems`**

Replace the function body at lines 24-30 with:

```ts
function getNavigationItems(customer: B2BCustomerAccess) {
  return allNavItems.filter((item) => {
    if (item.requiresCompany && !customer.isCompanyUser) return false
    if (item.requiresLeavers && !customer.canUseLeavers) return false
    if (item.requiresTrackedInventory && !customer.hasTrackedInventory) return false
    return true
  })
}
```

- [ ] **Step 8.3: Add `InventoryIcon` component**

Append alongside the other icon functions (after `LeaversIcon`):

```tsx
function InventoryIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m-8-14l8 4m-8-4v10l8 4m0-10v10"
      />
    </svg>
  )
}
```

- [ ] **Step 8.4: Compile**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 8.5: Dev-server verification**

```bash
npm run dev
```

Log in as:
- A customer with `hasTrackedInventory = false` → Inventory entry is **absent** from the sidebar.
- A customer with `hasTrackedInventory = true` → Inventory entry is **present** and clicking it navigates to `/inventory`.

Stop the dev server.

- [ ] **Step 8.6: Commit**

```bash
git add components/layout/Sidebar.tsx
git commit -m "feat(inventory): conditional Inventory sidebar entry gated by hasTrackedInventory"
```

---

## Task 9: End-to-end smoke verification

**Goal:** Confirm the full §15.1 + §15.2 path works in a single dev-server session.

**Files:** none (verification only).

- [ ] **Step 9.1: Boot fresh**

```bash
npx tsc --noEmit && npm run build
```

Expected: both succeed with zero errors.

- [ ] **Step 9.2: Dev session**

```bash
npm run dev
```

- [ ] **Step 9.3: Reorder flow check**

- Log in as a customer with completed past projects.
- Navigate to `/order-tracker`.
- Expand a completed project card.
- Confirm line items render per §15.1: design name, product name, colour chip, sizes as-ordered. No thumbnail. No print-method chip. No logo-count chip.
- Click **Reorder**.
- Modal opens. Fill delivery address, in-hand date, optional qty, optional notes.
- Submit. Expected: success toast, Monday CRM Deal created (check Monday's Deals board → "New Deals" group → the new item's text field should follow the Design/Product/Colour/Sizes pattern).

- [ ] **Step 9.4: Customer inventory flow check**

- Log in as a customer with tracked inventory (Reburger/Bike Glendhu/Otago Polytech, assuming the Inventory sub-app is live; otherwise log as any customer and expect the Inventory tab to be absent).
- Sidebar has **Inventory** entry.
- Click it → `/inventory` renders the table with tracked rows.
- Click a product-name link → navigates to `/shop/[productId]` (404 if catalogue isn't built yet; that's acceptable).
- Log in as a customer **without** tracked inventory → Inventory entry is absent from the sidebar.
- Direct-navigate to `/inventory` while logged in as a non-stocked customer → page loads with the empty state (not a crash).

- [ ] **Step 9.5: Commit the verification pass (marker)**

```bash
git commit --allow-empty -m "chore: verified §15.1 + §15.2 flows end-to-end"
```

---

## Task 10: Parent-plan handoff for §15.3 cart-chip + Catalog label

**Goal:** The cart chip itself is built by the parent 2026-04-20 Customer Checkout MVP plan. This task does not add code — it adds a clear constraint block to the parent plan so whoever picks up the cart-chip tasks doesn't miss §15.3.

**Files:**
- Modify: `docs/superpowers/plans/2026-04-20-customer-b2b-checkout-mvp-plan.md`

- [ ] **Step 10.1: Append a constraint block**

At the end of `docs/superpowers/plans/2026-04-20-customer-b2b-checkout-mvp-plan.md`, append:

```markdown

---

## Constraints added by 2026-04-24 amendments plan

The amendments plan at [2026-04-24-customer-checkout-mvp-amendments-plan.md](./2026-04-24-customer-checkout-mvp-amendments-plan.md) adds two forward-looking constraints this plan must honour when implementing the catalogue and cart surfaces:

### Catalogue nav label

- The `/shop` sidebar entry must render with the label **"Catalog"** (not "Shop"). Matches the Shopify vocabulary customers know. Route path stays `/shop`.

### Cart-chip visibility

When the cart chip/indicator is added to the layout (part of this plan's cart tasks), its visibility must be scoped to the following routes only:

- `/shop`
- `/shop/[productId]`
- `/cart`
- `/checkout`
- `/order-tracker`
- `/inventory`

On all other portal routes (`/account`, `/my-collections`, `/projects`, `/leavers-quotes`, etc.), the cart chip must not render. Use `usePathname()` from `next/navigation` and a `startsWith` check against the scoped route list.

Rationale: Chris's 2026-04-24 call — customers on non-ordering pages shouldn't see a cart indicator, to avoid confusion between browsing contexts.
```

- [ ] **Step 10.2: Commit**

```bash
git add docs/superpowers/plans/2026-04-20-customer-b2b-checkout-mvp-plan.md
git commit -m "docs(plan): add §15.3 cart-chip + Catalog label constraints to parent plan"
```

---

## Self-review checklist (run after completing all tasks)

**Spec coverage:**
- [x] §15.1 reorder line-item display refinement — Tasks 2, 3
- [x] §15.1 read-only requirement — preserved (ProjectLineItem has no editable inputs)
- [x] §15.2 consolidated inventory view — Tasks 5, 6, 7
- [x] §15.2 sidebar gating by `variant_inventory` presence — Tasks 4, 8
- [x] §15.3 Catalog nav label — Task 10 (handoff to parent plan)
- [x] §15.3 cart-chip scoping — Task 10 (handoff to parent plan)

**Placeholder scan:** No `TBD`, `TODO`, or unspecified logic in tasks.

**Type consistency:**
- `getItemDesignName(item, designNamesByInstanceId?)` — same signature in Task 1 definition, Task 2 import, Task 3 import.
- `CustomerInventoryRow` — defined in Task 5, consumed in Tasks 6 and 7.
- `hasTrackedInventory` — declared in Task 4 type, consumed in Task 8 gating.

**External dependencies:**
- `variant_availability` view (staff-portal Inventory sub-app spec §5.1) — handled gracefully if absent.
- `design_submissions` table (existing — used by `lib/collections.ts`) — no schema change needed.
- `variant_inventory` table — handled gracefully if absent (Task 4 traps the error).

**Not fabricated:**
- Every file path was confirmed via grep/read before this plan was written.
- `QuoteDataItem` type shape confirmed at `lib/job-tracker.ts:135-151`.
- `B2BCustomerAccess` confirmed at `types/company.ts` (location) — field list to be confirmed in Step 4.1.

---

## Out-of-scope reminders

This plan does **not** cover:

- **Inventory sub-app Products-editor tab** (staff portal) — separate spec amendment §14; separate PR.
- **Pricing editor spec + plan** (staff portal) — pending brainstorming.
- **Metafields spec + plan** (staff portal) — pending brainstorming.
- **B2B catalogues sub-app #3** (staff portal) — pending spec brainstorming.
- **Workwear landing + contact + quote submission refinement** — after Checkout MVP ships.
- **Wishlist favourites email update** — standalone.
- **Test-runner introduction** — this repo has no test infrastructure; verification is compile + dev-server + manual. Adding a runner is a follow-up.
- **Catalogue / shop / cart / checkout / quote-request / reorder-request** — owned by the parent 2026-04-20 plan.

---

## Dependencies & follow-ups

**Unblocks:**
- Parent 2026-04-20 plan catalogue tasks can now honour the Catalog label + cart-chip scoping constraints from day one.

**Blocks:**
- None. Each task in this plan is self-contained.

**Soft dependencies:**
- Task 5 + 7 render gracefully without `variant_availability`, but will only show real data once the staff-portal Inventory sub-app's 27-task plan has landed its migration (Task 1 of that plan).

---

## Execution handoff

Plan complete. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints for review.

Which approach?
