# Ordering-Mode Pills + PDP In-Stock Size Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drive the customer ordering experience off a catalogue item's effective fulfilment mode — two pills **From inventory** / **Reorder** (mixed → both, role-gated), a catalogue mode filter, and a PDP size picker that in From-inventory mode shows only in-stock sizes with no "Available to order" / status text.

**Architecture:** This builds **on top of** the existing PDP order-mode toggle (`OrderIntentToggle`, commits `907c388`/`0a306eb`) — that toggle is already two pills gated to org_admin and already maps to the cart's `'stocked' | 'make_to_stock'` fulfilment. The work is: (1) a pure `lib/shop/fulfilment-mode.ts` that resolves *effective mode* (`fulfilment_type_override ?? products.fulfilment_type`) and answers "which pills apply"; (2) **relabel** the toggle to *From inventory / Reorder* and gate which pills render by effective mode × role; (3) thread the override into the PDP + listing queries (the portal reads `products.fulfilment_type` on the PDP today but **never** reads `fulfilment_type_override`); (4) a catalogue **mode filter**; (5) a `VariantPicker` in-stock-only mode. Effective-mode logic is the shared spine so PDP and listing agree.

**Tech Stack:** Next.js 16 (App Router, server components for queries) · TypeScript · Supabase · Vitest + @testing-library/react + userEvent · Radix Toggle (VariantPicker).

**Repo:** `print-room-portal` — `c:\Users\MSI\Documents\Projects\print-room-portal`. **Branch:** `feat/ordering-mode-pills`.

---

## ⚠️ Flags & dependencies

- **Soft-depends on Plan B's authored data, not its code.** This plan reads `b2b_catalogue_items.fulfilment_type_override` (the column exists in prod — verified 2026-06-02). With no override authored yet, effective mode falls back to `products.fulfilment_type` (`NOT NULL`, default `made_to_order`), so the pills still work — every product is "Reorder" until an AM sets a mode (Plan B). No code dependency on Plan B.
- **Rename-independent (Plan A).** All role gating is on **derived `isOrgAdmin`** (`role === 'org_admin'`), never on the restricted-role literal, so this plan does **not** require Plan A to have executed. The PDP currently reads `customerRole === 'buyer'` in two places (`:228`, and the cart-fulfilment fallback) — to stay decoupled, Task 4 replaces those with `customerRole !== 'org_admin'` (semantically identical: "the restricted role"), so this plan is correct whether the live value is `buyer` or `staff`.
- **Existing toggle, don't greenfield.** `OrderIntentToggle` (`ProductDetailClient.tsx:1115-1148`) renders "From Stock"/"Made to Order" and is shown at `:827-829` only when `canChooseOrderIntent`. Build on it.
- **Cart oversell guard stays.** `CartTable` remains the safety net (spec Item 3); this plan does not touch it.

---

## File Structure

- Create: `lib/shop/fulfilment-mode.ts` — effective-mode resolver + pill predicates + labels (the shared spine).
- Modify: `lib/shop/filter-params.ts` — add `mode` filter to `ShopFilters`.
- Modify: `app/(portal)/catalogue/page.tsx` — read effective mode per product, apply the mode filter.
- Modify: the catalogue filter UI (the rail/top-bar that renders existing filters) — add the mode pills.
- Modify: `app/(portal)/catalogue/[productId]/page.tsx` — select `fulfilment_type_override`, pass effective mode as `product.fulfilment_type`.
- Modify: `components/shop/ProductDetailClient.tsx` — relabel toggle, gate pill set by effective mode × role, decouple from the role literal, pass `inStockOnly` to `VariantPicker`.
- Modify: `components/shop/VariantPicker.tsx` — `inStockOnly` mode (in-stock sizes only, no status text).
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
  type OrderingMode,
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

Add the value list + parse (after `const SORT_VALUES …`):

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

The page scopes products via `scopedProductIds`, then queries `products`. To filter by mode we need each product's effective mode (`override ?? base`). The item select already returns `catItemRows` (`id, source_product_id`); we add `fulfilment_type_override`, fetch `fulfilment_type` for the scoped products, compute effective per product, and intersect `scopedProductIds` before the main query.

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

After `scopedProductIds` is built (`:130`) and before the empty-state guard, when a non-`all` mode is selected, resolve base modes and filter. Insert:

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

Then change the main products query's `.in('id', …)` (`:152`) to use the filtered set:

```ts
    .in('id', modeScopedProductIds)
```

And update the empty-state guard (`:132`) to consider the filtered set so a mode with no matches shows the empty state rather than the full catalogue:

```ts
  if (modeScopedProductIds.length === 0) {
```

> Note: `modeScopedProductIds` is declared after the original `scopedProductIds.length === 0` guard in the file. Move that guard to **after** the new block (or duplicate the empty-state for the filtered set). Simplest: relocate the existing empty-state guard to sit right after the new block and test `modeScopedProductIds.length === 0`. When `filters.mode === 'all'`, `modeScopedProductIds === scopedProductIds`, so behaviour is unchanged.

- [ ] **Step 2b: Verify**

Run: `npx tsc --noEmit`
Expected: no errors. (Behavioural verification of the listing is manual — Task 6 — since `page.tsx` is a server component with live Supabase reads; the filter *logic* is unit-covered by Task 1's `matchesMode`/`effectiveFulfilment`.)

- [ ] **Step 3: Commit**

```bash
git add "app/(portal)/catalogue/page.tsx"
git commit -m "feat(portal): filter catalogue listing by effective ordering mode"
```

---

## Task 4: Catalogue mode-filter pills (UI)

**Files:**
- Modify: the filter UI component that renders the existing shop filters (brand/category/sort). Locate in Step 1.

- [ ] **Step 1: Locate the filter UI**

Run: `grep -rn "garment_family\|brand_id\|in_stock" app/(portal)/catalogue components/shop --include=*.tsx | grep -i "filter\|rail\|topbar"`
Identify the client component that reads `ShopFilters` and writes the URL query (it sets `brand_id`, `category_id`, etc. via the router). The mode pills live alongside those controls.

- [ ] **Step 2: Add the mode pills**

In that component, render a segmented control with three options — All / From inventory / Reorder — that sets the `mode` query key (mirroring how the existing controls set their keys; preserve all other params). Use `PILL_LABELS` for the two non-`all` labels:

```tsx
import { PILL_LABELS, type OrderingMode } from '@/lib/shop/fulfilment-mode'

// inside the rendered filters, mirroring the existing control pattern:
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

> Match the host component's actual prop names: it already exposes a setter that updates one URL key while preserving the rest (the existing brand/category controls use it). Use that same setter (named `setFilterParam` above as a placeholder — replace with the real one found in Step 1). Setting `mode` to `null`/omitting it for "All" keeps URLs clean and matches `parseShopFilters` defaulting to `'all'`. Reuse the existing pill/segmented styling class the component already defines for sort/in-stock controls so this inherits approved styling — do **not** introduce a new visual treatment.

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
- Modify: `components/shop/ProductDetailClient.tsx` (`OrderIntentToggle` labels `:1142`, `canChooseOrderIntent` `:217-220`, `isInventoryMode` `:227-230`, cart fulfilment fallbacks `:599-607`/`:667-675`)
- Test: `components/shop/__tests__/ProductDetailClient.pills.test.tsx`

- [ ] **Step 1: Thread the override into the PDP page**

In `app/(portal)/catalogue/[productId]/page.tsx`:
- The `products` select (the recon located it near `:97`) already selects `fulfilment_type`. Add a parallel read of the catalogue item's `fulfilment_type_override` for this product/org (the page already resolves the catalogue item — reuse that row; if not selected, add `fulfilment_type_override` to its `.select('…')`).
- Where the client `product` payload is assembled (recon `:367`, currently `fulfilment_type: row.fulfilment_type ?? 'made_to_order'`), pass the **effective** mode:

```ts
import { effectiveFulfilment } from '@/lib/shop/fulfilment-mode'

// …
  fulfilment_type: effectiveFulfilment(catalogueItem?.fulfilment_type_override ?? null, row.fulfilment_type),
```

`ProductDetailClient`'s `FulfilmentType` (`:23`) already equals the spine's type, so `product.fulfilment_type` now carries effective mode — no client type change needed.

- [ ] **Step 2: Write the failing test (pill labels + gating)**

Create `components/shop/__tests__/ProductDetailClient.pills.test.tsx`. This asserts the relabel and the role/effective-mode gating at the UI level. Mock the hooks the component needs (`useCart`, `useCurrency`) per the existing test setup pattern; render with a `mixed` product as org_admin and assert the two relabelled pills exist:

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

function renderPDP(opts: { fulfilment_type: 'stocked' | 'made_to_order' | 'mixed'; role: 'org_admin' | 'buyer' }) {
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
    renderPDP({ fulfilment_type: 'mixed', role: 'buyer' })
    expect(screen.queryByRole('group', { name: /order mode/i })).not.toBeInTheDocument()
  })
})
```

> The toggle only renders when both options are choosable (mixed + org_admin + inventory present). For the `mixed`+org_admin case the test supplies `brackets` so `brackets.length > 0` holds; if the component additionally requires `currentSelectionHasInventory`, extend the `availability`/`variants` props in the test to include one in-stock variant so the toggle mounts. Adjust the fixture to whatever makes `canChooseOrderIntent` true once you read the final gating in Step 3.

- [ ] **Step 3: Run it — verify it fails**

Run: `npx vitest run "components/shop/__tests__/ProductDetailClient.pills.test.tsx"`
Expected: FAIL — toggle still renders "From Stock"/"Made to Order".

- [ ] **Step 4: Relabel + gate by effective mode**

In `components/shop/ProductDetailClient.tsx`:

(a) Relabel `OrderIntentToggle` (`:1142`) — import the labels and use them:

```ts
import { PILL_LABELS } from '@/lib/shop/fulfilment-mode'
```
```tsx
            {mode === 'inventory' ? PILL_LABELS.from_inventory : PILL_LABELS.reorder}
```

(b) Gate the *choice* on effective mode = `mixed` (only mixed offers both pills; stocked is inventory-only, made_to_order is reorder-only — spec). Update `canChooseOrderIntent` (`:217-220`) to add the effective-mode condition and decouple from the role literal:

```ts
  const isOrgAdminViewer = customerRole === 'org_admin'
  const canChooseOrderIntent =
    isOrgAdminViewer &&
    product.fulfilment_type === 'mixed' &&
    currentSelectionHasInventory &&
    brackets.length > 0
```

(c) Decouple `isInventoryMode` (`:227-230`) from the `'buyer'` literal — use "not org_admin" so this is correct whether the restricted role is `buyer` or `staff` (Plan A independence), and force inventory mode for a `stocked` product:

```ts
  const isInventoryMode =
    !isOrgAdminViewer ||
    product.fulfilment_type === 'stocked' ||
    (currentSelectionHasInventory && brackets.length === 0) ||
    (canChooseOrderIntent && orderIntent === 'inventory')
```

(d) Decouple the two cart-fulfilment fallbacks that branch on `canChooseOrderIntent` (`:599-607` and `:667-675`) — these already key off `canChooseOrderIntent`/`orderIntent`, not the role literal, so they need **no change**. Confirm there is no other `customerRole === 'buyer'` left; if the grep below finds one, replace with `customerRole !== 'org_admin'`:

Run: `grep -n "customerRole === 'buyer'" components/shop/ProductDetailClient.tsx`
Replace each remaining hit with `customerRole !== 'org_admin'`. (Also update the local `type CustomerRole = 'org_admin' | 'buyer'` at `:24` only if Plan A has run; otherwise leave it — it is not the gate scope of this plan.)

- [ ] **Step 5: Run it — verify it passes**

Run the Step 2 command. Expected: PASS (2 tests). Adjust the test fixture per the Step 2 note until `canChooseOrderIntent` mounts the toggle for the mixed+admin case.

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
    // S is in stock → selectable
    expect(screen.getByRole('radio', { name: /^S$/ })).toBeInTheDocument()
    // M (0 qty) and L (untracked) are not offered
    expect(screen.queryByRole('radio', { name: /^M$/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /^L$/ })).not.toBeInTheDocument()
    // no status text / no "Available to order"
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

> The size `ToggleGroup.Item`s render the size label as their accessible name. If the resolved accessible name isn't an exact `S`/`M`/`L` (e.g. it concatenates status text in default mode), relax the default-mode query to `getByText('M')`. Confirm the role/name against the rendered markup when implementing.

- [ ] **Step 2: Run it — verify it fails**

Run: `npx vitest run "components/shop/__tests__/VariantPicker.inStockOnly.test.tsx"`
Expected: FAIL — `inStockOnly` prop doesn't exist; M and L still render; status text still present.

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

Destructure it (in the component signature, after `showSizePicker = true,`):

```ts
  inStockOnly = false,
```

Filter the size list when `inStockOnly`. After `const sizes = Array.from(sizeMap.values()).sort(...)` (`:85`), add:

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

Change the size-block guard + map to use `visibleSizes` (`:129` and `:143`):

```tsx
      {showSizePicker && visibleSizes.length > 0 && (
```
```tsx
            {visibleSizes.map((s) => {
```

Suppress the status block when `inStockOnly`. Wrap the existing `{tracked && ( … )}` block (`:175-195`) so it only renders in default mode:

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

(Because `visibleSizes` already excludes zero-stock/untracked sizes in `inStockOnly` mode, `mutedOutOfStock`/`outOfStock` never apply to a rendered cell there; suppressing the status span is the visible effect.)

- [ ] **Step 4: Run it — verify it passes**

Run the Step 1 command. Expected: PASS (2 tests). Also run the existing picker tests to confirm no regression:
`npx vitest run components/shop/__tests__/VariantPicker.keyboard.test.tsx`
Expected: still PASS.

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

The PDP already computes `isInventoryMode` (Task 5). Pass it to `VariantPicker` wherever the size picker is shown. At `:797-810` the picker uses `showSizePicker={false}` (sizes handled by a separate grid), so add the prop defensively and to any picker instance that renders sizes:

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
For **each** instance where `showSizePicker` is true (or could become true), add `inStockOnly={isInventoryMode}`. (The `showSizePicker={false}` instance is harmless to annotate and future-proofs it.)

> If sizes in `multi_size_with_variants` are rendered by a *separate* grid (e.g. `VariantlessSizeGrid` or an inline per-variant qty grid) rather than `VariantPicker`, Item 3's "in-stock-only" rule must be applied there too. Read the size-grid render around `:797-900` before finishing; if a non-`VariantPicker` grid shows sizes with availability text, apply the same `isInventoryMode` suppression (hide zero-stock/untracked rows + status text). The spec's named anchor is `VariantPicker`, but the acceptance is mode-wide; do not leave a second size surface showing "Available to order" in From-inventory mode.

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

1. As **org_admin**, catalogue listing: All / From inventory / Reorder pills filter the grid (an item with `fulfilment_type_override='stocked'` shows under From inventory + All, not Reorder).
2. PDP of a **mixed** item as org_admin: toggle reads "From inventory" / "Reorder"; switching to From inventory drops volume pricing + lead time; size picker shows only in-stock sizes, no status text; Add to cart → cart line `fulfilmentType: 'stocked'`. Switch to Reorder → full sizes + `make_to_stock`.
3. PDP of a **stocked** item: no toggle, inventory-only, in-stock sizes only.
4. PDP of a **made_to_order** item as org_admin: Reorder only; restricted member → no Reorder pill (and the item is filtered out of their From-inventory view).
5. Checkout submits the correct `fulfilment_type` per line (`lib/checkout/submit.ts` already consumes `fulfilmentType`).

- [ ] **Step 3: Commit any fixups**

```bash
git add -A && git commit -m "test(portal): ordering-mode pills + in-stock sizes fixups"
```

---

## Self-Review

**1. Spec coverage (Items 2 + 3):**
- *Two pills From inventory / Reorder* → Task 5 relabels `OrderIntentToggle`; `PILL_LABELS` is the single source (Task 1). ✅
- *Reorder replaces "Made to order"; mixed → both pills* → `pillsFor` (Task 1); PDP gates choice on `mixed` (Task 5). ✅
- *Effective mode = override ?? base* → `effectiveFulfilment` (Task 1), threaded into PDP (Task 5) + listing (Task 3). ✅
- *Switching filters the catalogue* → `mode` filter param (Task 2) + listing query (Task 3) + pills UI (Task 4). ✅
- *Switching sets the PDP order mode / correct checkout fulfilment_type* → existing toggle → cart `fulfilmentType` → `submit.ts` (unchanged, Task 5 Step 4d confirms). ✅
- *Role gating: staff see only From inventory; Reorder gated on isOrgAdmin* → `pillsFor` filters Reorder for non-admin; PDP `canChooseOrderIntent`/`isInventoryMode` decoupled to `!isOrgAdminViewer` (Task 5). The job-tracker reorder entry is **already** `isOrgAdmin`-gated (`ReorderButton.tsx:36`) — not re-planned. ✅
- *Item 3: From-inventory = in-stock sizes only, no "Available to order", no status* → `VariantPicker.inStockOnly` (Task 6), wired from `isInventoryMode` (Task 7). Reorder mode unchanged (Task 6 second test). CartTable oversell guard untouched. ✅

**2. Placeholder scan:** No "TBD"/"similar to Task N". Code is complete for the pure spine (Task 1), filter param (Task 2), VariantPicker (Task 6 — full markup shown), and the PDP relabel/gate (Task 5). Three steps end in a grep-locate (Task 3 loader is already pinned; Task 4 filter-UI component and Task 7's second size-surface) — these are genuine "find the host then apply this exact code" steps, not vague directives: each gives the precise code to add and a `tsc`/test gate. The filter-UI host and any second size grid weren't pinned during grounding, so locating them by grep is correct rather than hard-coding a stale path.

**3. Type consistency:** `FulfilmentType` is defined once in `lib/shop/fulfilment-mode.ts` and reused by `filter-params.ts` (`OrderingMode`), the listing query (Task 3), and aligns with `ProductDetailClient`'s existing local `FulfilmentType` (`:23`, identical members) so `product.fulfilment_type` carrying effective mode needs no client type edit. `Pill`/`OrderingMode`/`PILL_LABELS` are consistent across Tasks 1/2/4/5. `pillsFor`/`matchesMode`/`effectiveFulfilment` signatures match their call sites.

**Anchor drift adapted:** (a) PDP order-mode toggle **already exists** (`OrderIntentToggle`, `907c388`/`0a306eb`) — this plan relabels + re-gates it rather than building greenfield. (b) `fulfilment_type_override` is **not read anywhere in the portal today** (only `products.fulfilment_type` on the PDP) — Tasks 3 + 5 add the reads. (c) Role gating decoupled from the `'buyer'` literal (`!== 'org_admin'`) so the plan is correct independent of Plan A's execution order. (d) The listing's `inStock` filter is parsed-but-unapplied today; this plan adds a separate `mode` filter and does not rely on `inStock`.
