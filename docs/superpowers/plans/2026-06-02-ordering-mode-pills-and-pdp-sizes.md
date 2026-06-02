# Ordering-Mode Pills + PDP In-Stock Size Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drive the customer ordering experience off a catalogue item's effective fulfilment mode — two pills **From inventory** / **Reorder** (mixed → both, role-gated), a catalogue mode filter, and a PDP size picker that in From-inventory mode shows only in-stock sizes with no "Available to order" / status text.

**Architecture:** This builds **on top of** the existing PDP order-mode toggle (`OrderIntentToggle`, commits `907c388`/`0a306eb`) — already two pills gated to org_admin, already mapping to the cart's `'stocked' | 'make_to_stock'` fulfilment. The work is: (1) a pure `lib/shop/fulfilment-mode.ts` that resolves *effective mode* (`fulfilment_type_override ?? products.fulfilment_type`) and answers "which pills apply"; (2) **relabel** the toggle to *From inventory / Reorder* and gate which pills render by effective mode × role; (3) thread the override into the PDP + listing queries (the portal reads `products.fulfilment_type` on the PDP today but **never** reads `fulfilment_type_override`); (4) a catalogue **mode filter**; (5) a `VariantPicker` in-stock-only mode.

**Tech Stack:** Next.js 16 (App Router, server components for queries) · TypeScript · Supabase · Vitest + @testing-library/react + userEvent · Radix Toggle (VariantPicker).

**Repo:** `print-room-portal` — `c:\Users\MSI\Documents\Projects\print-room-portal`. **Branch:** `feat/ordering-mode-pills`.

> ⚠️ **Plan A has SHIPPED + MERGED (2026-06-02).** The role rename is live on `main`: `ProductDetailClient.tsx` already declares `type CustomerRole = 'org_admin' | 'staff'` and uses `customerRole === 'staff'` for `isInventoryMode`. So this plan's "decouple from the role literal" notes are already satisfied — use `customerRole !== 'org_admin'` (or `=== 'staff'`) and do **not** reintroduce `'buyer'`. Also a `feat/product-fulfilment-type` / `merge/pdp-mixed-fulfilment-pill` branch exists — **check it for overlap with this PDP pill work before starting** (it may already implement part of Items 2/3).

---

## ⚠️ Flags & dependencies

- **Soft-depends on Plan B's authored data, not its code.** Reads `b2b_catalogue_items.fulfilment_type_override` (column exists in prod). With no override authored, effective mode falls back to `products.fulfilment_type` (`NOT NULL`, default `made_to_order`), so pills still work — every product is "Reorder" until an AM sets a mode (Plan B). No code dependency on Plan B.
- **Rename-independent (Plan A) — and Plan A is already merged.** Role gating is on derived `isOrgAdmin` (`role === 'org_admin'`).
- **Existing toggle, don't greenfield.** `OrderIntentToggle` (`ProductDetailClient.tsx:1115-1148`) renders "From Stock"/"Made to Order", shown at `:827-829` only when `canChooseOrderIntent`. Build on it.
- **Cart oversell guard stays.** `CartTable` remains the safety net (spec Item 3); this plan does not touch it.

---

## File Structure

- Create: `lib/shop/fulfilment-mode.ts` — effective-mode resolver + pill predicates + labels (the shared spine).
- Modify: `lib/shop/filter-params.ts` — add `mode` filter to `ShopFilters`.
- Modify: `app/(portal)/catalogue/page.tsx` — read effective mode per product, apply the mode filter.
- Modify: the catalogue filter UI (the rail/top-bar) — add the mode pills.
- Modify: `app/(portal)/catalogue/[productId]/page.tsx` — select `fulfilment_type_override`, pass effective mode as `product.fulfilment_type`.
- Modify: `components/shop/ProductDetailClient.tsx` — relabel toggle, gate pill set by effective mode × role, pass `inStockOnly` to `VariantPicker`.
- Modify: `components/shop/VariantPicker.tsx` — `inStockOnly` mode.
- Tests: `lib/shop/__tests__/fulfilment-mode.test.ts`, `lib/shop/__tests__/filter-params.mode.test.ts`, `components/shop/__tests__/VariantPicker.inStockOnly.test.tsx`, `components/shop/__tests__/ProductDetailClient.pills.test.tsx`.

---

## Task 1: Effective-mode spine (pure, TDD core)

**Files:**
- Create: `lib/shop/fulfilment-mode.ts`
- Test: `lib/shop/__tests__/fulfilment-mode.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/shop/__tests__/fulfilment-mode.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  effectiveFulfilment,
  pillsFor,
  matchesMode,
  PILL_LABELS,
} from '../fulfilment-mode'

describe('effectiveFulfilment', () => {
  it('prefers the catalogue override over the master base', () => {
    expect(effectiveFulfilment('stocked', 'made_to_order')).toBe('stocked')
  })
  it('falls back to base when override is null', () => {
    expect(effectiveFulfilment(null, 'made_to_order')).toBe('made_to_order')
  })
  it('falls back to made_to_order when both missing', () => {
    expect(effectiveFulfilment(null, null)).toBe('made_to_order')
  })
})

describe('pillsFor (effective mode × role)', () => {
  it('stocked → only From inventory', () => {
    expect(pillsFor('stocked', true)).toEqual(['from_inventory'])
    expect(pillsFor('stocked', false)).toEqual(['from_inventory'])
  })
  it('made_to_order → only Reorder for admin, empty for restricted', () => {
    expect(pillsFor('made_to_order', true)).toEqual(['reorder'])
    expect(pillsFor('made_to_order', false)).toEqual([])
  })
  it('mixed → both for admin, only From inventory for restricted', () => {
    expect(pillsFor('mixed', true)).toEqual(['from_inventory', 'reorder'])
    expect(pillsFor('mixed', false)).toEqual(['from_inventory'])
  })
})

describe('matchesMode (catalogue filter)', () => {
  it('all → everything', () => {
    expect(matchesMode('stocked', 'all')).toBe(true)
    expect(matchesMode('made_to_order', 'all')).toBe(true)
  })
  it('from_inventory → stocked or mixed', () => {
    expect(matchesMode('stocked', 'from_inventory')).toBe(true)
    expect(matchesMode('mixed', 'from_inventory')).toBe(true)
    expect(matchesMode('made_to_order', 'from_inventory')).toBe(false)
  })
  it('reorder → made_to_order or mixed', () => {
    expect(matchesMode('made_to_order', 'reorder')).toBe(true)
    expect(matchesMode('mixed', 'reorder')).toBe(true)
    expect(matchesMode('stocked', 'reorder')).toBe(false)
  })
})

describe('PILL_LABELS', () => {
  it('uses the spec wording', () => {
    expect(PILL_LABELS.from_inventory).toBe('From inventory')
    expect(PILL_LABELS.reorder).toBe('Reorder')
  })
})
```

- [ ] **Step 2: Run it — verify it fails**

Run: `cd c:/Users/MSI/Documents/Projects/print-room-portal && npx vitest run lib/shop/__tests__/fulfilment-mode.test.ts`
Expected: FAIL — module `../fulfilment-mode` does not exist.

- [ ] **Step 3: Write the spine**

Create `lib/shop/fulfilment-mode.ts`:

```ts
/**
 * Catalogue-item fulfilment nature (mirrors the product_fulfilment_type enum +
 * the staff src/types/products.ts FulfilmentType). Stored as
 * b2b_catalogue_items.fulfilment_type_override, base on products.fulfilment_type.
 */
export type FulfilmentType = 'stocked' | 'made_to_order' | 'mixed'

/** The two customer-facing ordering modes (pills). */
export type Pill = 'from_inventory' | 'reorder'

/** Catalogue filter value, including the unfiltered default. */
export type OrderingMode = 'all' | 'from_inventory' | 'reorder'

export const PILL_LABELS: Record<Pill, string> = {
  from_inventory: 'From inventory',
  reorder: 'Reorder',
}

/** Effective mode = catalogue override ?? master base ?? made_to_order. */
export function effectiveFulfilment(
  override: FulfilmentType | null | undefined,
  base: FulfilmentType | null | undefined,
): FulfilmentType {
  return override ?? base ?? 'made_to_order'
}

/**
 * Which pills apply for a product, given its effective mode and whether the
 * viewer is an org_admin. Restricted members (staff) never get Reorder — they
 * are inventory-only by role (spec Cross-cutting).
 */
export function pillsFor(effective: FulfilmentType, isOrgAdmin: boolean): Pill[] {
  const all: Pill[] =
    effective === 'stocked'
      ? ['from_inventory']
      : effective === 'made_to_order'
        ? ['reorder']
        : ['from_inventory', 'reorder'] // mixed
  return isOrgAdmin ? all : all.filter((p) => p !== 'reorder')
}

/** Catalogue mode filter: does a product's effective mode match the selected filter? */
export function matchesMode(effective: FulfilmentType, mode: OrderingMode): boolean {
  if (mode === 'all') return true
  if (mode === 'from_inventory') return effective === 'stocked' || effective === 'mixed'
  return effective === 'made_to_order' || effective === 'mixed' // reorder
}
```

- [ ] **Step 4: Run it — verify it passes**

Run the Step 1 command. Expected: PASS (all groups).

- [ ] **Step 5: Commit**

```bash
git checkout -b feat/ordering-mode-pills
git add lib/shop/fulfilment-mode.ts lib/shop/__tests__/fulfilment-mode.test.ts
git commit -m "feat(portal): effective fulfilment-mode resolver + pill predicates"
```

---

## Task 2: Catalogue `mode` filter param (pure, TDD)

**Files:**
- Modify: `lib/shop/filter-params.ts`
- Test: `lib/shop/__tests__/filter-params.mode.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/shop/__tests__/filter-params.mode.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseShopFilters, activeFilterCount, DEFAULT_SHOP_FILTERS } from '../filter-params'

describe('shop filters — ordering mode', () => {
  it('defaults to all', () => {
    expect(DEFAULT_SHOP_FILTERS.mode).toBe('all')
    expect(parseShopFilters({}).mode).toBe('all')
  })
  it('parses the mode query key', () => {
    expect(parseShopFilters({ mode: 'from_inventory' }).mode).toBe('from_inventory')
    expect(parseShopFilters({ mode: 'reorder' }).mode).toBe('reorder')
  })
  it('rejects an unknown mode → all', () => {
    expect(parseShopFilters({ mode: 'banana' }).mode).toBe('all')
  })
  it('counts a non-all mode as an active filter', () => {
    expect(activeFilterCount({ ...DEFAULT_SHOP_FILTERS, mode: 'reorder' })).toBe(1)
    expect(activeFilterCount({ ...DEFAULT_SHOP_FILTERS, mode: 'all' })).toBe(0)
  })
})
```

- [ ] **Step 2: Run it — verify it fails**

Run: `npx vitest run lib/shop/__tests__/filter-params.mode.test.ts`
Expected: FAIL — `mode` not on `ShopFilters`/`DEFAULT_SHOP_FILTERS`; `parseShopFilters` ignores `sp.mode`.

- [ ] **Step 3: Add `mode` to filter-params**

In `lib/shop/filter-params.ts`:

Import the type:

```ts
import type { OrderingMode } from './fulfilment-mode'
```

Add to `ShopFilters` (after `inStock: boolean`):

```ts
  mode: OrderingMode
```

Add to `DEFAULT_SHOP_FILTERS` (after `inStock: false,`):

```ts
  mode: 'all',
```

Add the value list (after `const SORT_VALUES …`):

```ts
const MODE_VALUES: OrderingMode[] = ['all', 'from_inventory', 'reorder']
```

In `parseShopFilters`'s return object (after `inStock: …`):

```ts
    mode: (() => {
      const raw = pickFirst(sp.mode) as OrderingMode | undefined
      return raw && MODE_VALUES.includes(raw) ? raw : 'all'
    })(),
```

In `activeFilterCount` (before `return n`):

```ts
  if (filters.mode !== 'all') n++
```

- [ ] **Step 4: Run it — verify it passes**

Run the Step 1 command. Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/shop/filter-params.ts lib/shop/__tests__/filter-params.mode.test.ts
git commit -m "feat(portal): add ordering-mode filter to shop filters"
```

---

## Task 3: Apply the mode filter to the catalogue listing query

**Files:**
- Modify: `app/(portal)/catalogue/page.tsx` (catalogue-item select `:96-105`, products query `:148-159`)

- [ ] **Step 1: Add the override to the catalogue-item select**

In `app/(portal)/catalogue/page.tsx`, the `b2b_catalogue_items` select (`:99-100`) — add `fulfilment_type_override`:

```ts
        .select('id, source_product_id, fulfilment_type_override, b2b_catalogues!inner(organization_id, is_active)')
```

And widen the `catItemRows` row type (`:105`):

```ts
  const catItemRows = (catItems ?? []) as Array<{
    id: string
    source_product_id: string
    fulfilment_type_override: import('@/lib/shop/fulfilment-mode').FulfilmentType | null
  }>
```

- [ ] **Step 2: Compute effective mode + intersect scopedProductIds when filtering**

Add the import at the top of the file:

```ts
import { effectiveFulfilment, matchesMode, type FulfilmentType } from '@/lib/shop/fulfilment-mode'
```

After `scopedProductIds` is built (`:130`), when a non-`all` mode is selected, resolve base modes and filter:

```ts
  // Ordering-mode filter (Item 2): keep only products whose effective mode
  // (override ?? base) matches the selected pill. Override is per catalogue
  // item; base is products.fulfilment_type. Falls back to base when no override.
  let modeScopedProductIds = scopedProductIds
  if (filters.mode !== 'all' && scopedProductIds.length > 0) {
    const overrideByProductId = new Map<string, FulfilmentType | null>(
      catItemRows.map((r) => [r.source_product_id, r.fulfilment_type_override]),
    )
    const { data: baseRows } = await admin
      .from('products')
      .select('id, fulfilment_type')
      .in('id', scopedProductIds)
    const baseByProductId = new Map<string, FulfilmentType | null>(
      ((baseRows ?? []) as Array<{ id: string; fulfilment_type: FulfilmentType | null }>).map(
        (r) => [r.id, r.fulfilment_type],
      ),
    )
    modeScopedProductIds = scopedProductIds.filter((pid) =>
      matchesMode(
        effectiveFulfilment(overrideByProductId.get(pid) ?? null, baseByProductId.get(pid) ?? null),
        filters.mode,
      ),
    )
  }
```

Change the main products query's `.in('id', …)` (`:152`) to use the filtered set:

```ts
    .in('id', modeScopedProductIds)
```

Relocate the existing empty-state guard to sit **after** the new block and test `modeScopedProductIds.length === 0` (so a mode with no matches shows the empty state). When `filters.mode === 'all'`, `modeScopedProductIds === scopedProductIds`, so behaviour is unchanged.

- [ ] **Step 2b: Verify**

Run: `npx tsc --noEmit`
Expected: no errors. (Behavioural verification of the listing is manual — Task 8 — since `page.tsx` is a server component with live Supabase reads; the filter *logic* is unit-covered by Task 1's `matchesMode`/`effectiveFulfilment`.)

- [ ] **Step 3: Commit**

```bash
git add "app/(portal)/catalogue/page.tsx"
git commit -m "feat(portal): filter catalogue listing by effective ordering mode"
```

---

## Task 4: Catalogue mode-filter pills (UI)

**Files:**
- Modify: the filter UI component that renders the existing shop filters. Locate in Step 1.

- [ ] **Step 1: Locate the filter UI**

Run: `grep -rn "garment_family\|brand_id\|in_stock" "app/(portal)/catalogue" components/shop --include=*.tsx | grep -i "filter\|rail\|topbar"`
Identify the client component that reads `ShopFilters` and writes the URL query. The mode pills live alongside those controls.

- [ ] **Step 2: Add the mode pills**

In that component, render a segmented control — All / From inventory / Reorder — that sets the `mode` query key (mirroring how the existing controls set their keys; preserve all other params). Use `PILL_LABELS` for the two non-`all` labels:

```tsx
import { PILL_LABELS, type OrderingMode } from '@/lib/shop/fulfilment-mode'

<div role="group" aria-label="Ordering mode" className="flex gap-2">
  {([
    ['all', 'All'],
    ['from_inventory', PILL_LABELS.from_inventory],
    ['reorder', PILL_LABELS.reorder],
  ] as [OrderingMode, string][]).map(([value, label]) => (
    <button
      key={value}
      type="button"
      aria-pressed={filters.mode === value}
      onClick={() => setFilterParam('mode', value === 'all' ? null : value)}
      className={pillClass(filters.mode === value)}
    >
      {label}
    </button>
  ))}
</div>
```

> Replace `setFilterParam`/`pillClass` with the host component's real setter (the one the brand/category controls already use to update one URL key while preserving the rest) and its existing pill/segmented styling class. Setting `mode` to `null` for "All" keeps URLs clean and matches `parseShopFilters` defaulting to `'all'`. Do **not** introduce a new visual treatment.

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add <filter-ui-file>
git commit -m "feat(portal): catalogue ordering-mode filter pills"
```

---

## Task 5: PDP — thread the override + relabel the toggle + gate by effective mode

**Files:**
- Modify: `app/(portal)/catalogue/[productId]/page.tsx` (select `fulfilment_type_override`, pass effective as `product.fulfilment_type`)
- Modify: `components/shop/ProductDetailClient.tsx` (`OrderIntentToggle` labels `:1142`, `canChooseOrderIntent` `:217-220`, `isInventoryMode` `:227-230`)
- Test: `components/shop/__tests__/ProductDetailClient.pills.test.tsx`

- [ ] **Step 1: Thread the override into the PDP page**

In `app/(portal)/catalogue/[productId]/page.tsx`:
- The `products` select (near `:97`) already selects `fulfilment_type`. Add a read of the catalogue item's `fulfilment_type_override` for this product/org (reuse the catalogue-item row the page already resolves; if not selected, add `fulfilment_type_override` to its `.select('…')`).
- Where the client `product` payload is assembled (`:367`, currently `fulfilment_type: row.fulfilment_type ?? 'made_to_order'`), pass the **effective** mode:

```ts
import { effectiveFulfilment } from '@/lib/shop/fulfilment-mode'

  fulfilment_type: effectiveFulfilment(catalogueItem?.fulfilment_type_override ?? null, row.fulfilment_type),
```

`ProductDetailClient`'s `FulfilmentType` (`:23`) already equals the spine's type, so `product.fulfilment_type` now carries effective mode — no client type change needed.

- [ ] **Step 2: Write the failing test (pill labels + gating)**

Create `components/shop/__tests__/ProductDetailClient.pills.test.tsx`. Mock the hooks the component needs per the existing test setup; render a `mixed` product as org_admin and assert the two relabelled pills exist. (Plan A is merged, so `customerRole` accepts `'staff'`.)

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ProductDetailClient } from '../ProductDetailClient'

vi.mock('@/components/cart/CartProvider', () => ({ useCart: () => ({ addLine: vi.fn() }) }))
vi.mock('@/lib/currency/useCurrency', () => ({ useCurrency: () => ({ format: (n: number) => `$${n}` }) }))

const baseProduct = {
  id: 'p1', name: 'Tee', description: null, image_url: null, moq: 1,
  lead_time_days: 7, sizing_type: 'one_size', decoration_methods: null,
  decoration_price: null, sku: null, safety_standard: null, specs: null,
  supports_labels: null, garment_family: null, default_sizes: null,
  brand_name: null, category_name: null, catalogueItemId: 'i1', catalogueVariantLabel: null,
}

function renderPDP(opts: { fulfilment_type: 'stocked' | 'made_to_order' | 'mixed'; role: 'org_admin' | 'staff' }) {
  return render(
    <ProductDetailClient
      product={{ ...baseProduct, fulfilment_type: opts.fulfilment_type }}
      variants={[]}
      brackets={[{ min_quantity: 1, max_quantity: null, unit_price: 10 }]}
      availability={{}}
      organizationId="o1"
      customerRole={opts.role}
      images={[]}
      colourOptions={[]}
      decorations={[]}
      effectiveMoq={1}
    />,
  )
}

describe('PDP ordering-mode pills', () => {
  it('mixed + org_admin → both relabelled pills, no legacy wording', () => {
    renderPDP({ fulfilment_type: 'mixed', role: 'org_admin' })
    const group = screen.getByRole('group', { name: /order mode/i })
    expect(group).toHaveTextContent('From inventory')
    expect(group).toHaveTextContent('Reorder')
    expect(group).not.toHaveTextContent('From Stock')
    expect(group).not.toHaveTextContent('Made to Order')
  })

  it('restricted role never sees the Reorder pill', () => {
    renderPDP({ fulfilment_type: 'mixed', role: 'staff' })
    expect(screen.queryByRole('group', { name: /order mode/i })).not.toBeInTheDocument()
  })
})
```

> The toggle renders only when both options are choosable (mixed + org_admin + inventory present). Supply `availability`/`variants` with one in-stock variant if the component requires `currentSelectionHasInventory` before the toggle mounts — adjust the fixture once you read the final gating in Step 4.

- [ ] **Step 3: Run it — verify it fails**

Run: `npx vitest run "components/shop/__tests__/ProductDetailClient.pills.test.tsx"`
Expected: FAIL — toggle still renders "From Stock"/"Made to Order".

- [ ] **Step 4: Relabel + gate by effective mode**

In `components/shop/ProductDetailClient.tsx`:

(a) Import labels + relabel `OrderIntentToggle` (`:1142`):

```ts
import { PILL_LABELS } from '@/lib/shop/fulfilment-mode'
```
```tsx
            {mode === 'inventory' ? PILL_LABELS.from_inventory : PILL_LABELS.reorder}
```

(b) Gate the *choice* on effective mode = `mixed` (only mixed offers both pills). Update `canChooseOrderIntent` (`:217-220`):

```ts
  const isOrgAdminViewer = customerRole === 'org_admin'
  const canChooseOrderIntent =
    isOrgAdminViewer &&
    product.fulfilment_type === 'mixed' &&
    currentSelectionHasInventory &&
    brackets.length > 0
```

(c) `isInventoryMode` (`:227-230`) — Plan A already left this as `customerRole === 'staff' || …`. Extend it to force inventory mode for a `stocked` product and reuse `isOrgAdminViewer`:

```ts
  const isInventoryMode =
    !isOrgAdminViewer ||
    product.fulfilment_type === 'stocked' ||
    (currentSelectionHasInventory && brackets.length === 0) ||
    (canChooseOrderIntent && orderIntent === 'inventory')
```

(d) The cart-fulfilment fallbacks (`:599-607`, `:667-675`) already key off `canChooseOrderIntent`/`orderIntent` — no change. Confirm no stray `customerRole === 'buyer'` remains (Plan A removed it):

Run: `grep -n "'buyer'" components/shop/ProductDetailClient.tsx`  → expect no output.

- [ ] **Step 5: Run it — verify it passes**

Run the Step 2 command. Expected: PASS (2 tests). Adjust the fixture per the Step 2 note until `canChooseOrderIntent` mounts the toggle for the mixed+admin case.

- [ ] **Step 6: Typecheck + commit**

```bash
npx tsc --noEmit
git add "app/(portal)/catalogue/[productId]/page.tsx" components/shop/ProductDetailClient.tsx "components/shop/__tests__/ProductDetailClient.pills.test.tsx"
git commit -m "feat(portal): relabel order pills From inventory/Reorder, gate by effective mode"
```

---

## Task 6: VariantPicker — in-stock-only size mode (Item 3)

**Files:**
- Modify: `components/shop/VariantPicker.tsx` (props `:28-36`, size block `:129-201`)
- Test: `components/shop/__tests__/VariantPicker.inStockOnly.test.tsx`

In From-inventory mode the size picker shows **only** sizes with a tracked, in-stock variant for the selected colour, and renders **no** "Available to order" chip and **no** "{qty} in stock"/"0 in stock" status text.

- [ ] **Step 1: Write the failing test**

Create `components/shop/__tests__/VariantPicker.inStockOnly.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { VariantPicker, type VariantRow } from '../VariantPicker'

const variants: VariantRow[] = [
  { variant_id: 'red-s', color_swatch_id: 'red', color_label: 'Red', color_hex: '#f00', color_position: 0, size_id: 1, size_label: 'S', size_order: 0 },
  { variant_id: 'red-m', color_swatch_id: 'red', color_label: 'Red', color_hex: '#f00', color_position: 0, size_id: 2, size_label: 'M', size_order: 1 },
  { variant_id: 'red-l', color_swatch_id: 'red', color_label: 'Red', color_hex: '#f00', color_position: 0, size_id: 3, size_label: 'L', size_order: 2 },
]
const availability = {
  'red-s': { available_qty: 4, allow_order_without_stock: false },
  'red-m': { available_qty: 0, allow_order_without_stock: false },
  // red-l untracked (absent)
} as never

describe('VariantPicker inStockOnly', () => {
  it('shows only in-stock sizes and no status text in inStockOnly mode', () => {
    render(
      <VariantPicker
        variants={variants}
        selectedColorSwatchId="red"
        selectedSizeId={1}
        onChange={vi.fn()}
        availability={availability}
        showSizePicker
        inStockOnly
      />,
    )
    expect(screen.getByRole('radio', { name: /^S$/ })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /^M$/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /^L$/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/in stock/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/available to order/i)).not.toBeInTheDocument()
  })

  it('default mode (inStockOnly off) is unchanged — all sizes + status text show', () => {
    render(
      <VariantPicker
        variants={variants}
        selectedColorSwatchId="red"
        selectedSizeId={1}
        onChange={vi.fn()}
        availability={availability}
        showSizePicker
      />,
    )
    expect(screen.getByRole('radio', { name: /^M$/ })).toBeInTheDocument()
    expect(screen.getByText(/in stock/i)).toBeInTheDocument()
  })
})
```

> If the rendered accessible name isn't exactly `S`/`M`/`L`, relax the default-mode query to `getByText('M')`. Confirm role/name against the markup when implementing.

- [ ] **Step 2: Run it — verify it fails**

Run: `npx vitest run "components/shop/__tests__/VariantPicker.inStockOnly.test.tsx"`
Expected: FAIL — `inStockOnly` prop doesn't exist; M and L still render; status text present.

- [ ] **Step 3: Implement the prop**

In `components/shop/VariantPicker.tsx`:

Add to `VariantPickerProps` (after `showSizePicker?: boolean` at `:35`):

```ts
  /**
   * From-inventory mode (spec Item 3): show ONLY sizes with a tracked,
   * in-stock variant for the selected colour, and suppress the
   * "Available to order" chip + "{qty} in stock" status text. Reorder/default
   * mode (false) is unchanged. CartTable oversell guard remains the net.
   */
  inStockOnly?: boolean
```

Destructure it (after `showSizePicker = true,`):

```ts
  inStockOnly = false,
```

After `const sizes = Array.from(sizeMap.values()).sort(...)` (`:85`), add:

```ts
  // In-stock-only: keep a size only if the variant for the *selected colour*
  // is tracked with available_qty > 0. Zero-stock and untracked sizes are not
  // selectable (no "available to order" path in From-inventory mode).
  const visibleSizes = inStockOnly
    ? sizes.filter((s) => {
        const variantForSize = variants.find(
          (v) => v.color_swatch_id === selectedColorSwatchId && v.size_id === s.id,
        )
        if (!variantForSize || !availability) return false
        const a = availability[variantForSize.variant_id]
        return a !== undefined && a.available_qty > 0
      })
    : sizes
```

Change the size-block guard + map to use `visibleSizes` (`:129`, `:143`):

```tsx
      {showSizePicker && visibleSizes.length > 0 && (
```
```tsx
            {visibleSizes.map((s) => {
```

Suppress the status block when `inStockOnly` — wrap the existing `{tracked && ( … )}` block (`:175-195`):

```tsx
                  <span>{s.label}</span>
                  {!inStockOnly && tracked && (
                    showBackorderableChip ? (
                      <span className="mt-0.5 inline-flex rounded-full bg-[rgb(var(--accent-mint))] px-2 py-0.5 text-[10px] font-medium text-[rgb(var(--accent-mint-ink))]">
                        Available to order
                      </span>
                    ) : (
                      <span
                        className={`mt-0.5 text-[10px] font-normal ${
                          isSelected
                            ? 'text-white/80'
                            : mutedOutOfStock
                              ? 'text-gray-400'
                              : (qty ?? 0) <= 5
                                ? 'text-amber-600'
                                : 'text-gray-500'
                        }`}
                      >
                        {outOfStock ? '0 in stock' : `${qty} in stock`}
                      </span>
                    )
                  )}
```

- [ ] **Step 4: Run it — verify it passes**

Run the Step 1 command. Expected: PASS (2 tests). Also run the existing picker tests:
`npx vitest run components/shop/__tests__/VariantPicker.keyboard.test.tsx` → still PASS.

- [ ] **Step 5: Commit**

```bash
git add components/shop/VariantPicker.tsx "components/shop/__tests__/VariantPicker.inStockOnly.test.tsx"
git commit -m "feat(portal): VariantPicker in-stock-only size mode for From-inventory"
```

---

## Task 7: Wire `inStockOnly` from the PDP

**Files:**
- Modify: `components/shop/ProductDetailClient.tsx` (every `<VariantPicker>` render — `:797-810` and any other)

- [ ] **Step 1: Pass the prop**

Pass `isInventoryMode` to `VariantPicker` wherever the size picker is shown. At `:797-810`:

```tsx
            <VariantPicker
              variants={variants}
              colorOptions={pickerColourOptions}
              selectedColorSwatchId={colorSwatchId}
              selectedSizeId={sizeId}
              availability={availability}
              showSizePicker={false}
              inStockOnly={isInventoryMode}
              onChange={({ colorSwatchId: c, sizeId: s }) => {
                setColorSwatchId(c)
                setSizeId(s)
              }}
            />
```

Run: `grep -n "<VariantPicker" components/shop/ProductDetailClient.tsx`
For **each** instance where `showSizePicker` is true (or could become true), add `inStockOnly={isInventoryMode}`.

> If sizes in `multi_size_with_variants` are rendered by a *separate* grid (e.g. `VariantlessSizeGrid` or an inline per-variant qty grid) rather than `VariantPicker`, Item 3's rule must be applied there too. Read the size-grid render around `:797-900`; if a non-`VariantPicker` grid shows sizes with availability text, apply the same `isInventoryMode` suppression (hide zero-stock/untracked rows + status text). The spec's named anchor is `VariantPicker`, but the acceptance is mode-wide.

- [ ] **Step 2: Verify + commit**

Run: `npx tsc --noEmit && npx vitest run components/shop`
Expected: green.

```bash
git add components/shop/ProductDetailClient.tsx
git commit -m "feat(portal): drive VariantPicker in-stock-only from PDP inventory mode"
```

---

## Task 8: Full verification

**Files:** none

- [ ] **Step 1: Full suite + build**

Run: `cd c:/Users/MSI/Documents/Projects/print-room-portal && npx vitest run && npm run build`
Expected: all green, build succeeds.

- [ ] **Step 2: Manual smoke (test catalogue, both roles)**

1. As **org_admin**, catalogue listing: All / From inventory / Reorder pills filter the grid (a `stocked` item shows under From inventory + All, not Reorder).
2. PDP of a **mixed** item as org_admin: toggle reads "From inventory" / "Reorder"; From inventory drops volume pricing + lead time; size picker shows only in-stock sizes, no status text; Add to cart → cart line `fulfilmentType: 'stocked'`. Reorder → full sizes + `make_to_stock`.
3. PDP of a **stocked** item: no toggle, inventory-only, in-stock sizes only.
4. PDP of a **made_to_order** item as org_admin: Reorder only; restricted member → no Reorder pill (item filtered out of their From-inventory view).
5. Checkout submits the correct `fulfilment_type` per line.

- [ ] **Step 3: Commit any fixups**

```bash
git add -A && git commit -m "test(portal): ordering-mode pills + in-stock sizes fixups"
```

---

## Self-Review

**1. Spec coverage (Items 2 + 3):**
- *Two pills From inventory / Reorder* → Task 5 relabels `OrderIntentToggle`; `PILL_LABELS` single source (Task 1). ✅
- *Reorder replaces "Made to order"; mixed → both pills* → `pillsFor` (Task 1); PDP gates choice on `mixed` (Task 5). ✅
- *Effective mode = override ?? base* → `effectiveFulfilment` (Task 1), threaded into PDP (Task 5) + listing (Task 3). ✅
- *Switching filters the catalogue* → `mode` filter param (Task 2) + listing query (Task 3) + pills UI (Task 4). ✅
- *Sets the PDP order mode / correct checkout fulfilment_type* → existing toggle → cart `fulfilmentType` → `submit.ts` (unchanged; Task 5 Step 4d confirms). ✅
- *Role gating: staff see only From inventory; Reorder gated on isOrgAdmin* → `pillsFor` filters Reorder for non-admin; PDP gating on `isOrgAdminViewer` (Task 5). Job-tracker reorder entry already `isOrgAdmin`-gated (`ReorderButton.tsx:36`) — not re-planned. ✅
- *Item 3: From-inventory in-stock sizes only, no "Available to order", no status* → `VariantPicker.inStockOnly` (Task 6), wired from `isInventoryMode` (Task 7). Reorder mode unchanged (Task 6 second test). CartTable untouched. ✅

**2. Placeholder scan:** No "TBD"/"similar to Task N". Code complete for the pure spine (Task 1), filter param (Task 2), VariantPicker (Task 6 — full markup), PDP relabel/gate (Task 5). The grep-locate steps (Task 4 filter-UI host; Task 7 second size surface) give the exact code to add + a `tsc`/test gate; those hosts weren't pinned during grounding, so locating by grep is correct rather than hard-coding a stale path.

**3. Type consistency:** `FulfilmentType` defined once in `lib/shop/fulfilment-mode.ts`, reused by `filter-params.ts`, the listing query, and aligns with `ProductDetailClient`'s existing local `FulfilmentType` (`:23`, identical members). `Pill`/`OrderingMode`/`PILL_LABELS` consistent across Tasks 1/2/4/5. `pillsFor`/`matchesMode`/`effectiveFulfilment` signatures match call sites.

**Anchor drift adapted:** (a) PDP order-mode toggle **already exists** — relabel + re-gate, not greenfield. (b) `fulfilment_type_override` is **not read in the portal today** — Tasks 3 + 5 add the reads. (c) **Plan A shipped + merged**, so `ProductDetailClient` already uses `'staff'` (not `'buyer'`); this plan reuses `isOrgAdminViewer`/`=== 'staff'` and never reintroduces the old literal. (d) The listing's `inStock` filter is parsed-but-unapplied today; this plan adds a separate `mode` filter, independent of `inStock`. (e) Check the pre-existing `feat/product-fulfilment-type` branch for overlap before starting.
