# Custom-name Personalisation (Chris feature 2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff enable an optional, free-text "custom name" (e.g. a player/staff name) on chosen products; the customer types it per garment on the PDP, it splits the cart line, persists on the order, and lands in its own Monday production-board column.

**Architecture:** A near-exact **mirror of the shipped feature 1 (MTF location dropdown)**. Two nullable columns (staff repo migration); a shared sanitiser; the value rides `CartLine.customName` into `lineSignature` (splits the line) but never `tierAggregationKey` (pooling stays name-agnostic, like `sizeId`); persists via the existing post-RPC follow-up UPDATE (`submit_b2b_order` untouched); writes to a new Monday subitem column. The two deviations from location: custom-name is **optional (no add-to-cart gate)** and its config is a **plain integer cap** (`custom_name_max_length`, null = off) instead of a dataset FK.

**Tech Stack:** Two Next.js 16 App Router repos sharing one Supabase Postgres — **P** = `print-room-portal` (customer, no migrations) · **S** = `print-room-staff-portal` (schema owner). Vitest. Monday.com GraphQL.

**Spec:** `print-room-portal/docs/superpowers/specs/2026-07-24-custom-name-personalisation-design.md`
**Mirrors:** `print-room-portal/docs/superpowers/plans/2026-07-22-mtf-location-dropdown.md` (feature 1).

## Global Constraints

- **Repos & absolute roots:** P = `/Users/jamierogangeorge/Documents/print-room-portal` · S = `/Users/jamierogangeorge/Documents/print-room-staff-portal`. Every task below is tagged **(P)** or **(S)**.
- **Test runner (both repos):** `npm test` runs `vitest run`. Single file: `npx vitest run <path>`. Vitest config: `environment: jsdom`, `globals: true`, `@` aliased to repo root.
- **Typecheck is diff-against-baseline, NOT hard-zero.** P: `npx tsc --noEmit --incremental false` has **14 pre-existing errors** confined to `lib/__tests__/next-config-redirects.test.ts` and `lib/email/__tests__/tracker-notification.test.ts` (both unrelated). S: `npx tsc --noEmit` has **~20 pre-existing catalogue failures**. "Green" = **no new errors in touched files**.
- **Schema-owner rule (S):** every schema change is a FILE in `S:supabase/migrations/`, applied via `supabase db push`. **NEVER** via MCP `apply_migration` or the Supabase dashboard SQL editor (that caused the 2026-07-20 drift). Shared project ref `bthsxgmcnbvwwgvdveek`. The `.env.local` swap dance (CONTRIBUTING.md): `mv .env.local .env.local.bak && supabase db push ; mv .env.local.bak .env.local` (link once: `supabase link --project-ref bthsxgmcnbvwwgvdveek`).
- **Test/verification emails → `jamie@theprint-room.co.nz`, NEVER `jon@`.**
- **Auto-push hazard:** both portal repos auto-push/merge mid-session under Jon's tooling. Branch off the current mainline, re-check `git rev-parse HEAD`/PR state before acting, and do NOT promise "nothing pushed/merged". **Git is Jon's to drive — commits/PRs on his explicit go.** The per-step `git commit` blocks below are the intended commit points; do not push unless asked.
- **Post-26, not urgent:** this is the post-go-live queue lead. It does NOT block MTF (feature 1).
- **Char cap:** UI default **15**, server ceiling **≤ 30**. Sanitiser allow-list: letters, digits, space, and `- ' . ,`. Case **preserved** and **case-sensitive** in the signature ("Chris" ≠ "CHRIS").
- **Branch:** create `feat/custom-name-personalisation` in BOTH repos off the current mainline.

---

## File-touch map

**P (customer):**
- `lib/cart/custom-name.ts` — **new** shared sanitiser (`sanitiseCustomName`, `MAX_CUSTOM_NAME_LENGTH`).
- `lib/cart/types.ts` — `CartLine.customName`; `lineSignature` trailing segment.
- `lib/cart/normalize.ts` — persist `customName` through the localStorage round-trip.
- `components/cart/CartProvider.tsx` — pass `customName` into both `lineSignature` calls.
- `components/shop/ProductDetailClient.tsx` — `customNameMaxLength` prop, optional text input, thread into all three `addLine` paths.
- `app/(portal)/catalogue/[productId]/page.tsx` — load `custom_name_max_length`, pass to PDP.
- `components/checkout/CheckoutReviewClient.tsx` — map `customName` → `custom_name`.
- `lib/checkout/submit.ts` — `CheckoutLineInput.custom_name`; `buildLineSnapshotUpdate`; Monday read-back select/type/map.
- `app/api/checkout/route.ts` — validate + sanitise `custom_name`.
- `lib/monday/column-ids.ts` — `PRODUCTION_SUBITEM_COLUMNS.customName`.
- `lib/monday/deal-item.ts` — `OrderLineForMonday.customName`; write the new column.

**S (staff):**
- `supabase/migrations/2026072?????_b2b_catalogue_custom_name_and_quote_item_line_custom_name.sql` — **new** (two columns).
- `src/app/api/catalogues/[id]/items/[itemId]/route.ts` — `PATCHABLE` + coercion for `custom_name_max_length`.
- `src/components/catalogues/CatalogueItemEditor.tsx` — number input control.
- the catalogue-item editor **page loader** (grep `line_dataset_id`) — add `custom_name_max_length` to the item select + `CatalogueItemEditorData`.
- `src/lib/monday/column-ids.ts` — `PRODUCTION_SUBITEM_COLUMNS.customName`.
- `src/lib/monday/deal-item.ts` — `OrderLineForMonday.customName`; write the column.
- `src/app/api/orders/[id]/retry-monday-push/route.ts` — select/type/map `line_custom_name`.
- `src/app/api/ordering-periods/[id]/confirm/route.ts` — select/type/map `line_custom_name`.

**Out of scope (YAGNI):** generic `product_line_attributes` table; retrofit of feature 1 into an abstraction; org dataset/CSV; Trade Services config; per-product "required" flag; `production-job.ts` (the approve/ordering production-board path writes no location column either — parity with feature 1).

---

### Task 1 (S): Schema migration — two nullable columns

**Files:**
- Create: `S:supabase/migrations/<TIMESTAMP>_b2b_catalogue_custom_name_and_quote_item_line_custom_name.sql`

**Interfaces:**
- Produces: DB columns `b2b_catalogue_items.custom_name_max_length integer` (null = off) and `quote_items.line_custom_name text` (frozen snapshot). Every later task assumes these names.

**Context:** Mirrors the shipped `20260722042008_org_line_datasets_and_quote_item_location.sql` (sections 3 + 4 only: `add column if not exists` + `comment on column`). Both new columns are plain scalars (no FK), so NO constraint/index/RLS guards are needed. The newest existing migration is `20260722042008_...`; pick a timestamp that sorts AFTER it (today is 2026-07-24).

- [ ] **Step 1: Pick the migration timestamp**

Run: `ls S:supabase/migrations/ | tail -3`
Expected: newest is `20260722042008_org_line_datasets_and_quote_item_location.sql`. Choose a filename `20260724HHMMSS_b2b_catalogue_custom_name_and_quote_item_line_custom_name.sql` where `HHMMSS` is the current UTC time (any value > `20260722042008`).

- [ ] **Step 2: Write the migration file**

```sql
-- Feature 2 (custom-name personalisation): optional free-text per-line name.
--
-- Mirrors feature 1 (org line datasets) but needs NO dataset — custom name is
-- free text, not a picklist. Two nullable columns:
--   * b2b_catalogue_items.custom_name_max_length — per customer x product opt-in
--     + cap. NULL = the custom-name input is OFF for this item. A positive int
--     turns it on and caps the PDP input at that many chars (UI default 15).
--     This single column is on/off + config, exactly like line_dataset_id.
--   * quote_items.line_custom_name — frozen label snapshot on the order line
--     (like line_location_label / size_label; no rewrite on later edits). The
--     submit path sets it via the existing post-RPC follow-up UPDATE, so
--     submit_b2b_order is unchanged.

-- 1. Per-product opt-in + cap (nullable = off).
alter table public.b2b_catalogue_items
  add column if not exists custom_name_max_length integer;

comment on column public.b2b_catalogue_items.custom_name_max_length is
  'When set (>0), this product shows an optional free-text "custom name" input '
  'on the PDP, capped at this many chars (UI default 15, ceiling 30). NULL = no '
  'custom-name field. Mirrors line_dataset_id (feature 1) as the single on/off + '
  'config column.';

-- 2. Frozen snapshot of the chosen name on the order line (label-only).
alter table public.quote_items
  add column if not exists line_custom_name text;

comment on column public.quote_items.line_custom_name is
  'Frozen snapshot of the optional PDP custom name for this line (e.g. "Chris"). '
  'NULL when none. Set by the portal checkout follow-up UPDATE (submit_b2b_order '
  'unchanged); read by the Monday production-board push.';
```

- [ ] **Step 3: Verify the SQL parses (dry sanity — no apply yet)**

Run: `grep -c "add column if not exists" S:supabase/migrations/<TIMESTAMP>_b2b_catalogue_custom_name_and_quote_item_line_custom_name.sql`
Expected: `2`

**DO NOT `supabase db push` here.** Applying to the shared DB is a gated milestone (Task 12, Jon's go). All downstream unit tests mock Supabase and do not need the columns to exist.

- [ ] **Step 4: Commit**

```bash
cd /Users/jamierogangeorge/Documents/print-room-staff-portal
git add supabase/migrations/<TIMESTAMP>_b2b_catalogue_custom_name_and_quote_item_line_custom_name.sql
git commit -m "feat(schema): add custom_name_max_length + line_custom_name columns (feature 2)"
```

---

### Task 2 (P): Shared custom-name sanitiser

**Files:**
- Create: `P:lib/cart/custom-name.ts`
- Test: `P:lib/cart/__tests__/custom-name.test.ts`

**Interfaces:**
- Produces: `sanitiseCustomName(raw: string | null | undefined, maxLength: number | null | undefined): string | null` and `const MAX_CUSTOM_NAME_LENGTH = 30`. Consumed by the PDP (Task 4) and the checkout route (Task 5).

**Context:** One pure function used on both the client (PDP) and server (checkout route). Trim → strip disallowed chars → collapse whitespace → trim → empty becomes `null` (so blank names merge) → clamp to the per-product cap (falling back to the 30 ceiling). Case is preserved and never folded.

- [ ] **Step 1: Write the failing test**

```ts
// P:lib/cart/__tests__/custom-name.test.ts
import { describe, it, expect } from 'vitest'
import { sanitiseCustomName, MAX_CUSTOM_NAME_LENGTH } from '../custom-name'

describe('sanitiseCustomName', () => {
  it('trims and collapses internal whitespace', () => {
    expect(sanitiseCustomName('  Chris   Smith  ', 15)).toBe('Chris Smith')
  })
  it('allows letters, digits, space, and - \' . ,', () => {
    expect(sanitiseCustomName("Anne-Marie O'Neil Jr., 3", 30)).toBe("Anne-Marie O'Neil Jr., 3")
  })
  it('strips disallowed characters', () => {
    expect(sanitiseCustomName('C@hr!s#', 15)).toBe('Chrs')
  })
  it('preserves case (case-sensitive)', () => {
    expect(sanitiseCustomName('CHRIS', 15)).toBe('CHRIS')
    expect(sanitiseCustomName('chris', 15)).not.toBe(sanitiseCustomName('CHRIS', 15))
  })
  it('returns null for empty / whitespace / all-disallowed input', () => {
    expect(sanitiseCustomName('', 15)).toBeNull()
    expect(sanitiseCustomName('   ', 15)).toBeNull()
    expect(sanitiseCustomName('@@@', 15)).toBeNull()
    expect(sanitiseCustomName(null, 15)).toBeNull()
    expect(sanitiseCustomName(undefined, 15)).toBeNull()
  })
  it('clamps to the per-product cap', () => {
    expect(sanitiseCustomName('abcdefghij', 4)).toBe('abcd')
  })
  it('falls back to the 30-char ceiling when cap is null/invalid', () => {
    const long = 'a'.repeat(40)
    expect(sanitiseCustomName(long, null)).toHaveLength(MAX_CUSTOM_NAME_LENGTH)
    expect(sanitiseCustomName(long, 0)).toHaveLength(MAX_CUSTOM_NAME_LENGTH)
    expect(sanitiseCustomName(long, 999)).toHaveLength(MAX_CUSTOM_NAME_LENGTH)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run lib/cart/__tests__/custom-name.test.ts`
Expected: FAIL — `Failed to resolve import "../custom-name"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// P:lib/cart/custom-name.ts

/** Absolute server-side ceiling for a custom name, regardless of per-product cap. */
export const MAX_CUSTOM_NAME_LENGTH = 30

// Letters (any script), digits, space, and the embroidery/print-safe punctuation
// - ' . , — everything else is stripped. Unicode-aware so macrons etc. survive.
const DISALLOWED = /[^\p{L}\p{N} .,'\-]/gu

/**
 * Normalise an optional PDP custom name. Used on both the client (PDP add) and
 * the server (checkout route defence). Empty-after-sanitise → null so blank
 * names merge; case is preserved (embroidery renders "Chris" ≠ "CHRIS", so they
 * stay distinct cart lines). Clamped to the per-product cap, falling back to the
 * 30-char ceiling when the cap is absent/invalid.
 */
export function sanitiseCustomName(
  raw: string | null | undefined,
  maxLength: number | null | undefined,
): string | null {
  if (raw == null) return null
  let s = String(raw).replace(DISALLOWED, '')
  s = s.replace(/\s+/g, ' ').trim()
  if (s === '') return null
  const cap =
    typeof maxLength === 'number' && maxLength > 0 && maxLength <= MAX_CUSTOM_NAME_LENGTH
      ? Math.trunc(maxLength)
      : MAX_CUSTOM_NAME_LENGTH
  if (s.length > cap) s = s.slice(0, cap).trim()
  return s === '' ? null : s
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/cart/__tests__/custom-name.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/jamierogangeorge/Documents/print-room-portal
git add lib/cart/custom-name.ts lib/cart/__tests__/custom-name.test.ts
git commit -m "feat(cart): add shared sanitiseCustomName helper (feature 2)"
```

---

### Task 3 (P): Cart — split lines on custom name

**Files:**
- Modify: `P:lib/cart/types.ts` (`CartLine` interface ~line 60; `lineSignature` ~195-206)
- Modify: `P:lib/cart/normalize.ts` (`normalizePersisted` ~103-108)
- Modify: `P:components/cart/CartProvider.tsx` (`addLine` ~164-229)
- Test: `P:lib/cart/__tests__/types.test.ts` (extend)

**Interfaces:**
- Consumes: nothing new.
- Produces: `CartLine.customName?: string | null`; `lineSignature(..., customName: string | null = null)` (new 9th positional param). Consumed by CartProvider (this task) and the PDP (Task 4).

**Context:** `locationLabel` is the exact template. `lineSignature` currently ends `...::${variantLabel}::${fulfilmentType}::${decorationSignature(decorations)}`. Append a trailing `::${customName ?? ''}` segment (trailing keeps the diff minimal and can't disturb the existing segments). `customName` must survive the localStorage round-trip (normalize) or two differently-named lines silently re-merge on reload. `recomputeProductTierPrices`' `aggKey` (types.ts:239-240) stays `${productId}::${decorationSignature}` — custom name must NOT pool-split, so it is deliberately left out (parity with `sizeId`/`locationLabel`).

- [ ] **Step 1: Write the failing tests** (append to `P:lib/cart/__tests__/types.test.ts`)

```ts
describe('lineSignature includes custom name', () => {
  const noDeco: CartLineDecoration[] = []

  it('different custom names keep lines distinct', () => {
    const a = lineSignature('p1', 'v1', 'Black / L', noDeco, 'stocked', null, 10, 'MTF Avalon', 'Chris')
    const b = lineSignature('p1', 'v1', 'Black / L', noDeco, 'stocked', null, 10, 'MTF Avalon', 'George')
    expect(a).not.toBe(b)
  })

  it('same custom name merges (identical signature)', () => {
    const a = lineSignature('p1', 'v1', 'Black / L', noDeco, 'stocked', null, 10, 'MTF Avalon', 'Chris')
    const b = lineSignature('p1', 'v1', 'Black / L', noDeco, 'stocked', null, 10, 'MTF Avalon', 'Chris')
    expect(a).toBe(b)
  })

  it('custom name is case-sensitive in the signature', () => {
    const a = lineSignature('p1', 'v1', 'Black / L', noDeco, 'stocked', null, 10, null, 'Chris')
    const b = lineSignature('p1', 'v1', 'Black / L', noDeco, 'stocked', null, 10, null, 'CHRIS')
    expect(a).not.toBe(b)
  })

  it('omitting custom name reproduces the no-name signature (legacy parity)', () => {
    const a = lineSignature('p1', 'v1', 'Black / L', noDeco, 'stocked', null, 10, 'MTF Avalon')
    const b = lineSignature('p1', 'v1', 'Black / L', noDeco, 'stocked', null, 10, 'MTF Avalon', null)
    expect(a).toBe(b)
  })

  it('lines differing only by custom name still pool for tier pricing', () => {
    // Two same-product lines, different names, combined qty 20 → both priced at
    // the 20-qty bracket (custom name must not fragment the pricing pool).
    const bracket: CartLineBracket[] = [
      { min_quantity: 1, max_quantity: 9, unit_price: 10 },
      { min_quantity: 10, max_quantity: null, unit_price: 6 },
    ]
    const mk = (customName: string): CartLine => ({
      lineId: `l-${customName}`,
      productId: 'p1',
      productName: 'Tee',
      variantId: 'v1',
      variantLabel: 'Black / L',
      qty: 10,
      unitPrice: 10,
      imageUrl: null,
      customName,
      decorations: [],
      brackets: bracket,
    })
    const priced = recomputeProductTierPrices([mk('Chris'), mk('George')])
    expect(priced.every((l) => l.unitPrice === 6)).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/cart/__tests__/types.test.ts`
Expected: FAIL — `lineSignature` ignores the 9th arg (distinct-names case fails) and `CartLine` has no `customName` (type error).

- [ ] **Step 3a: Add the `CartLine` field** — in `P:lib/cart/types.ts`, immediately after the `locationLabel` block (~line 60):

```ts
  /**
   * Feature 2 — the optional free-text "custom name" typed on the PDP (e.g. a
   * player/staff name). Splits the cart line (into lineSignature) but not the
   * pricing pool (kept out of the aggregation key, like locationLabel/sizeId).
   * Null/absent = no name (merges). Absent on legacy persisted lines.
   */
  customName?: string | null
```

- [ ] **Step 3b: Extend `lineSignature`** — in `P:lib/cart/types.ts` (~195-206), add the trailing param and segment:

```ts
export function lineSignature(
  productId: string,
  variantId: string,
  variantLabel: string,
  decorations: CartLineDecoration[],
  fulfilmentType: CartLineFulfilmentType = 'stocked',
  catalogueItemId: string | null = null,
  sizeId: number | null = null,
  locationLabel: string | null = null,
  customName: string | null = null,
): string {
  return `${catalogueItemId ?? productId}::${variantId}::${sizeId ?? ''}::${locationLabel ?? ''}::${variantLabel}::${fulfilmentType}::${decorationSignature(decorations)}::${customName ?? ''}`
}
```

- [ ] **Step 3c: Persist through normalize** — in `P:lib/cart/normalize.ts`, immediately after the `locationLabel` block (~103-108):

```ts
      // Feature 2 — the chosen custom name must survive the localStorage
      // round-trip or two differently-named lines silently re-merge on reload.
      customName:
        typeof l.customName === 'string' || l.customName === null
          ? (l.customName ?? null)
          : null,
```

- [ ] **Step 3d: Thread through `addLine`** — in `P:components/cart/CartProvider.tsx`, add `line.customName ?? null` as the 9th arg to the **incoming** signature (~174) and `l.customName ?? null` to the **existing-line** signature (~186):

```tsx
        const incomingSig = lineSignature(
          line.productId,
          line.variantId,
          line.variantLabel,
          line.decorations ?? [],
          line.fulfilmentType,
          line.catalogueItemId ?? null,
          line.sizeId ?? null,
          line.locationLabel ?? null,
          line.customName ?? null,
        )
        const existing = s.lines.find(
          (l) =>
            lineSignature(
              l.productId,
              l.variantId,
              l.variantLabel,
              l.decorations,
              l.fulfilmentType,
              l.catalogueItemId ?? null,
              l.sizeId ?? null,
              l.locationLabel ?? null,
              l.customName ?? null,
            ) ===
            incomingSig,
        )
```

(The new-line branch spreads `...line`, so `customName` is carried onto the persisted line automatically — no change needed there.)

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/cart/__tests__/types.test.ts`
Expected: PASS (all, including the 5 new cases).

- [ ] **Step 5: Typecheck touched files, then commit**

Run: `npx tsc --noEmit --incremental false 2>&1 | grep -E "cart/(types|normalize)|CartProvider"` → Expected: no output (no new errors).

```bash
git add lib/cart/types.ts lib/cart/normalize.ts components/cart/CartProvider.tsx lib/cart/__tests__/types.test.ts
git commit -m "feat(cart): split cart lines on custom name (feature 2)"
```

---

### Task 4 (P): PDP — optional custom-name input

**Files:**
- Modify: `P:components/shop/ProductDetailClient.tsx` (props ~167-170; state ~211-217; three `addLine` paths ~974/1026/1073; render near the location `<select>` ~1585-1612)
- Modify: `P:app/(portal)/catalogue/[productId]/page.tsx` (load ~479-492 area; pass-through ~546-552)
- Test: `P:components/shop/__tests__/ProductDetailClient.custom-name.test.tsx`

**Interfaces:**
- Consumes: `sanitiseCustomName` (Task 2); `CartLine.customName` (Task 3).
- Produces: PDP prop `customNameMaxLength?: number | null`; sets `customName` on every cart line it adds.

**Context:** Mirrors `locationOptions`/`requiresLocation`/`selectedLocationLabel` — but **optional, no gate** (never touches `canSubmitSelection`/`meetsLocation`). One text input, `maxLength` = the cap, applied to all lines in the add (like the single location value). The sanitised value goes onto each `cart.addLine({...})` object at the same spots `locationLabel: selectedLocationLabel` appears.

- [ ] **Step 1: Write the failing test**

```tsx
// P:components/shop/__tests__/ProductDetailClient.custom-name.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ProductDetailClient } from '../ProductDetailClient'

vi.mock('@/components/cart/useCart', () => ({ useCart: () => ({ addLine: vi.fn() }) }))
vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({ format: (n: number) => `$${n}` }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}))

const product = {
  id: 'tee', name: 'Basic Tee', description: null, image_url: null,
  moq: 1, lead_time_days: 14, sizing_type: 'multi_size',
  decoration_methods: null, decoration_price: null, sku: null, safety_standard: null,
  specs: null, supports_labels: null, garment_family: null, default_sizes: null,
  brand_name: null, category_name: null, catalogueItemId: 'i-tee',
  fulfilment_type: 'made_to_order' as const,
}
const variants = [{
  variant_id: 'tee-navy', color_swatch_id: 'navy', color_label: 'Navy', color_hex: '#003',
  color_position: 0, size_id: null, size_label: null, size_order: 0,
}]

function renderPdp(customNameMaxLength: number | null) {
  return render(
    <ProductDetailClient
      product={product}
      variants={variants as never}
      sizes={[]}
      brackets={[{ min_quantity: 1, max_quantity: null, unit_price: 2.34 }]}
      availability={{} as never}
      organizationId="o1"
      customerRole="org_admin"
      orderingPermission="both"
      images={[]}
      colourOptions={[{ id: 'navy', label: 'Navy', hex: '#003', imageUrl: null } as never]}
      decorations={[]}
      effectiveMoq={1}
      customNameMaxLength={customNameMaxLength}
    />,
  )
}

describe('PDP — optional custom name (feature 2)', () => {
  it('renders a maxlength-capped input when the product allows it', () => {
    renderPdp(12)
    const input = screen.getByLabelText(/Custom name/i) as HTMLInputElement
    expect(input).toBeInTheDocument()
    expect(input.maxLength).toBe(12)
  })

  it('does NOT render the input when custom name is off (null)', () => {
    renderPdp(null)
    expect(screen.queryByLabelText(/Custom name/i)).not.toBeInTheDocument()
  })

  it('does not gate add-to-cart (input left blank, button still enabled)', () => {
    renderPdp(12)
    const addBtn = screen.getByRole('button', { name: /Add to cart|Checking price|Ordering opens/i })
    expect(addBtn).not.toBeDisabled()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run components/shop/__tests__/ProductDetailClient.custom-name.test.tsx`
Expected: FAIL — no `Custom name` input (prop unknown/ignored).

- [ ] **Step 3a: Add the prop** — in `P:components/shop/ProductDetailClient.tsx` `interface Props` (right after `locationOptions?`, ~line 169):

```ts
  /** Feature 2 — per-product custom-name cap. null/absent = no custom-name input. */
  customNameMaxLength?: number | null
```

And in the destructure defaults (~189-191, alongside `locationOptions = []`):

```tsx
  customNameMaxLength = null,
```

- [ ] **Step 3b: Add state** — near the location state (~211-217):

```ts
  // Feature 2 — optional free-text custom name. No gate (unlike location): a
  // blank input just means "no name" and the line merges normally. The sanitised
  // value rides every cart line added (via lineSignature) onto the order + Monday.
  const allowsCustomName =
    typeof customNameMaxLength === 'number' && customNameMaxLength > 0
  const [customNameInput, setCustomNameInput] = useState('')
  const sanitisedCustomName = sanitiseCustomName(customNameInput, customNameMaxLength)
```

Add the import at the top of the file (near the other `@/lib/cart` imports):

```ts
import { sanitiseCustomName } from '@/lib/cart/custom-name'
```

- [ ] **Step 3c: Thread into all three add paths** — add `customName: sanitisedCustomName,` immediately after each `locationLabel: selectedLocationLabel,` line (mode 1 baseLine ~974, mode 2 ~1026, mode 3 ~1073). Mode-1 example:

```tsx
            catalogueItemId: product.catalogueItemId,
            locationLabel: selectedLocationLabel,
            customName: sanitisedCustomName,
            billingMode: billingModeForVariant(variant.variant_id),
```

(Repeat the single `customName: sanitisedCustomName,` line in the mode-2 and mode-3 `cart.addLine({ ... })` objects, right after their `locationLabel: selectedLocationLabel,`.)

- [ ] **Step 3d: Render the input** — in `P:components/shop/ProductDetailClient.tsx`, immediately AFTER the closing `)}` of the `{requiresLocation && ( … )}` block (~line 1612):

```tsx
            {allowsCustomName && (
              <div className="mt-4">
                <label
                  htmlFor="pdp-custom-name"
                  className="mb-1 block text-sm font-medium text-gray-900"
                >
                  Custom name <span className="font-normal text-gray-500">(optional)</span>
                </label>
                <input
                  id="pdp-custom-name"
                  type="text"
                  maxLength={customNameMaxLength ?? undefined}
                  value={customNameInput}
                  onChange={(e) => setCustomNameInput(e.target.value)}
                  placeholder="e.g. a name to print"
                  className="w-full rounded-2xl border border-black/15 px-4 py-2.5 text-sm"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Up to {customNameMaxLength} characters. Leave blank for no name.
                </p>
              </div>
            )}
```

- [ ] **Step 3e: Load + pass the cap** — in `P:app/(portal)/catalogue/[productId]/page.tsx`, in the returned data object next to `locationOptions,` (~551):

```ts
      // Feature 2 — per-product custom-name cap. null = no custom-name input.
      customNameMaxLength: catItem.custom_name_max_length ?? null,
```

Then where `<ProductDetailClient ... locationOptions={data.locationOptions} />` is rendered in the same file, add the prop:

```tsx
        customNameMaxLength={data.customNameMaxLength}
```

(If `catItem` is selected with an explicit column list rather than `*`, add `custom_name_max_length` to that select. Grep `line_dataset_id` in this file to confirm how `catItem` is fetched and mirror it.)

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run components/shop/__tests__/ProductDetailClient.custom-name.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit --incremental false 2>&1 | grep -E "ProductDetailClient|catalogue/\[productId\]"` → Expected: no output.

```bash
git add components/shop/ProductDetailClient.tsx "app/(portal)/catalogue/[productId]/page.tsx" components/shop/__tests__/ProductDetailClient.custom-name.test.tsx
git commit -m "feat(pdp): optional custom-name input (feature 2)"
```

---

### Task 5 (P): Checkout — carry + persist the custom name

**Files:**
- Modify: `P:components/checkout/CheckoutReviewClient.tsx` (~173-174, the cart→input map)
- Modify: `P:lib/checkout/submit.ts` (`CheckoutLineInput` ~103; `buildLineSnapshotUpdate` ~372-389)
- Modify: `P:app/api/checkout/route.ts` (validation loop ~82-99)
- Test: `P:lib/checkout/__tests__/submit.custom-name.test.ts`

**Interfaces:**
- Consumes: `sanitiseCustomName` (Task 2); `CartLine.customName` (Task 3).
- Produces: `CheckoutLineInput.custom_name?: string | null`; `buildLineSnapshotUpdate` writes `line_custom_name`. Consumed by the Monday read-back (Task 8).

**Context:** Exact mirror of `location_label` → `line_location_label`. `buildLineSnapshotUpdate` is additive/never-clobber (`!== undefined`). The route mirrors the location shape-guard AND additionally sanitises server-side (defence against forged POSTs), clamping to the 30 ceiling — it cannot know the per-product cap (the route does not batch-load catalogue items), so ceiling-only is the pragmatic defence; the PDP `maxLength` + Task 4 sanitiser is the primary cap.

- [ ] **Step 1: Write the failing test**

```ts
// P:lib/checkout/__tests__/submit.custom-name.test.ts
import { describe, it, expect } from 'vitest'
import { buildLineSnapshotUpdate } from '../submit'

describe('buildLineSnapshotUpdate — custom name', () => {
  it('includes line_custom_name when provided', () => {
    const u = buildLineSnapshotUpdate({ custom_name: 'Chris' }, [])
    expect(u).toMatchObject({ line_custom_name: 'Chris' })
  })
  it('sets null when custom_name is explicitly null', () => {
    const u = buildLineSnapshotUpdate({ custom_name: null }, [])
    expect(u.line_custom_name).toBeNull()
  })
  it('omits line_custom_name when the field is absent (legacy line)', () => {
    const u = buildLineSnapshotUpdate({}, [])
    expect('line_custom_name' in u).toBe(false)
  })
  it('still carries the location label alongside (no regression)', () => {
    const u = buildLineSnapshotUpdate({ location_label: 'MTF Avalon', custom_name: 'Chris' }, [])
    expect(u).toMatchObject({ line_location_label: 'MTF Avalon', line_custom_name: 'Chris' })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/checkout/__tests__/submit.custom-name.test.ts`
Expected: FAIL — `custom_name` not on the `Pick<...>` type and `line_custom_name` not set.

- [ ] **Step 3a: Add the input field** — in `P:lib/checkout/submit.ts`, `CheckoutLineInput`, right after `location_label?` (~103):

```ts
  /** Feature 2 — optional PDP custom name; snapshotted to quote_items.line_custom_name. */
  custom_name?: string | null
```

- [ ] **Step 3b: Extend `buildLineSnapshotUpdate`** — widen the `Pick` and add the assignment (~372-389):

```ts
export function buildLineSnapshotUpdate(
  inLine: Pick<CheckoutLineInput, 'ship_to_store_id' | 'location_label' | 'custom_name'>,
  validatedDecorations: CheckoutLineDecorationInput[],
): Record<string, unknown> {
  const update: Record<string, unknown> = {}
  if (inLine.ship_to_store_id !== undefined) update.ship_to_store_id = inLine.ship_to_store_id ?? null
  if (inLine.location_label !== undefined) update.line_location_label = inLine.location_label ?? null
  if (inLine.custom_name !== undefined) update.line_custom_name = inLine.custom_name ?? null
  update.decorations = validatedDecorations
  return update
}
```

- [ ] **Step 3c: Map cart→input** — in `P:components/checkout/CheckoutReviewClient.tsx`, right after `location_label: line.locationLabel ?? null,` (~174):

```ts
            // Feature 2 — snapshot the optional custom name onto quote_items.line_custom_name.
            custom_name: line.customName ?? null,
```

- [ ] **Step 3d: Validate + sanitise in the route** — in `P:app/api/checkout/route.ts`, inside the per-line loop, right after the `location_label` guard (~99):

```ts
    // Feature 2 — custom_name shape guard + server-side sanitise (defence). The
    // PDP maxLength + client sanitiser is the primary cap; the route cannot know
    // the per-product cap (it does not batch-load catalogue items), so it clamps
    // to the 30-char ceiling only. Mutate in place so both part.lines and
    // pricing_pool_lines carry the sanitised value.
    if (
      l.custom_name !== undefined &&
      l.custom_name !== null &&
      typeof l.custom_name !== 'string'
    ) {
      return NextResponse.json(
        { error: 'custom_name must be a string or null' },
        { status: 400 },
      )
    }
    if (typeof l.custom_name === 'string') {
      l.custom_name = sanitiseCustomName(l.custom_name, null)
    }
```

Add the import at the top of the route:

```ts
import { sanitiseCustomName } from '@/lib/cart/custom-name'
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/checkout/__tests__/submit.custom-name.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit --incremental false 2>&1 | grep -E "checkout/submit|checkout/route|CheckoutReviewClient"` → Expected: no output.

```bash
git add lib/checkout/submit.ts components/checkout/CheckoutReviewClient.tsx app/api/checkout/route.ts lib/checkout/__tests__/submit.custom-name.test.ts
git commit -m "feat(checkout): persist optional custom name onto the order line (feature 2)"
```

---

### Task 6: Monday "Custom Name" subitem column (MCP) + wire both `column-ids.ts`

**Files:**
- Modify: `P:lib/monday/column-ids.ts` (`PRODUCTION_SUBITEM_COLUMNS` ~64-104)
- Modify: `S:src/lib/monday/column-ids.ts` (`PRODUCTION_SUBITEM_COLUMNS` ~53-95)

**Interfaces:**
- Produces: `PRODUCTION_SUBITEM_COLUMNS.customName` (identical literal id in BOTH repos). Consumed by Tasks 7 & 11.

**Context:** Mirror the feature-1 `location` column (`text_mm5gv8g3`), created 2026-07-22 on the **subitems** board `1992701983`. This is a one-time side-effectful MCP op; the real id is only known after creation, so create first, then paste the SAME literal into both repos.

- [ ] **Step 1: Create the column via Monday MCP**

Call `mcp__claude_ai_monday_com__create_column` with:
- `boardId`: `1992701983` (Production subitems board)
- `columnType`: `text`
- `columnTitle`: `Custom Name`

Capture the returned column `id` (shape `text_...`). Call it `<CUSTOM_NAME_COL_ID>` below.

- [ ] **Step 2: Wire the customer repo** — in `P:lib/monday/column-ids.ts`, add after the `decoration:` line inside `PRODUCTION_SUBITEM_COLUMNS`:

```ts
  // "Custom Name" — the optional free-text per-line name (feature 2). Text column
  // created on the Production subitems board 1992701983. Its own column, like
  // Location; the subitem title stays product-name.
  customName: '<CUSTOM_NAME_COL_ID>',
```

- [ ] **Step 3: Wire the staff repo** — in `S:src/lib/monday/column-ids.ts`, add the identical line (same literal id) after the `decoration:` line inside `PRODUCTION_SUBITEM_COLUMNS`.

- [ ] **Step 4: Typecheck both**

Run (P): `cd /Users/jamierogangeorge/Documents/print-room-portal && npx tsc --noEmit --incremental false 2>&1 | grep column-ids` → Expected: no output.
Run (S): `cd /Users/jamierogangeorge/Documents/print-room-staff-portal && npx tsc --noEmit 2>&1 | grep column-ids` → Expected: no output.

- [ ] **Step 5: Commit (each repo)**

```bash
cd /Users/jamierogangeorge/Documents/print-room-portal
git add lib/monday/column-ids.ts
git commit -m "feat(monday): add Custom Name subitem column id (feature 2)"
cd /Users/jamierogangeorge/Documents/print-room-staff-portal
git add src/lib/monday/column-ids.ts
git commit -m "feat(monday): add Custom Name subitem column id (feature 2)"
```

---

### Task 7 (P): Customer Monday push — write + read back the custom name

**Files:**
- Modify: `P:lib/monday/deal-item.ts` (`OrderLineForMonday` ~391-406; `buildOrderSubitemColumnValues` ~586-613)
- Modify: `P:lib/checkout/submit.ts` (read-back select ~1608-1614; row type ~1616-1627; map ~1631-1640)
- Test: `P:lib/monday/__tests__/deal-item.order-mode.test.ts` (extend)

**Interfaces:**
- Consumes: `PRODUCTION_SUBITEM_COLUMNS.customName` (Task 6); `quote_items.line_custom_name` (Task 1); `buildLineSnapshotUpdate` write (Task 5).
- Produces: `OrderLineForMonday.customName: string | null`; the read-back map sets `customName`.

**Context:** `OrderLineForMonday.customName` must exist before the submit.ts read-back map can set it (else tsc fails), so both edits ship together. The write mirrors the `line.location` block (skip blank). The read-back mirrors `line_location_label`.

- [ ] **Step 1: Write the failing test** — extend `P:lib/monday/__tests__/deal-item.order-mode.test.ts`. Add `customName` to the fixture's three lines (line 1 `customName: 'Chris'`, lines 2 & 3 `customName: null`) and add this assertion inside the existing "writes the Location and Decoration columns" `describe`:

```ts
  it('writes the Custom Name column when present, omits it when blank', async () => {
    mockedCall
      .mockResolvedValueOnce({ create_item: { id: '900', name: 'Acme Co' } })
      .mockResolvedValue({ create_subitem: { id: 'sub-1' } })
    await pushOrderDeal(fixture) // line 1: customName 'Chris'; lines 2/3: null

    const cv1 = JSON.parse((mockedCall.mock.calls[1][1] as { columnValues: string }).columnValues)
    expect(cv1[PRODUCTION_SUBITEM_COLUMNS.customName]).toBe('Chris')

    const cv2 = JSON.parse((mockedCall.mock.calls[2][1] as { columnValues: string }).columnValues)
    expect(PRODUCTION_SUBITEM_COLUMNS.customName in cv2).toBe(false)
  })
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/monday/__tests__/deal-item.order-mode.test.ts`
Expected: FAIL — `customName` not on `OrderLineForMonday` (type error) / column not written.

- [ ] **Step 3a: Add the type field** — in `P:lib/monday/deal-item.ts`, `OrderLineForMonday`, after `location: string | null` (~404):

```ts
  /** Feature 2 — optional custom name for this line; null when none. */
  customName: string | null
```

- [ ] **Step 3b: Write the column** — in `buildOrderSubitemColumnValues`, immediately after the `line.location` block (~604):

```ts
  // Feature 2 — the optional custom name, its own subitem column.
  if (line.customName?.trim()) {
    columnValues[PRODUCTION_SUBITEM_COLUMNS.customName] = line.customName.trim()
  }
```

- [ ] **Step 3c: Read it back** — in `P:lib/checkout/submit.ts`:

Add `line_custom_name` to the read-back `.select(...)` (~1611):

```ts
        .select(`
          id, product_name, quantity, unit_price, decorations, size_label, line_location_label, line_custom_name,
          product_variants ( product_color_swatches(label) )
        `)
```

Add to the row type (~1616-1627), after `line_location_label: string | null`:

```ts
        line_custom_name: string | null
```

Add to the row→line map (~1631-1640), after `location: row.line_location_label ?? null,`:

```ts
          customName: row.line_custom_name ?? null,
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/monday/__tests__/deal-item.order-mode.test.ts`
Expected: PASS (existing + new).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit --incremental false 2>&1 | grep -E "monday/deal-item|checkout/submit"` → Expected: no output.

```bash
git add lib/monday/deal-item.ts lib/checkout/submit.ts lib/monday/__tests__/deal-item.order-mode.test.ts
git commit -m "feat(monday): write + read back the custom name on customer orders (feature 2)"
```

---

### Task 8 (S): Catalogue-item PATCH — accept `custom_name_max_length`

**Files:**
- Modify: `S:src/app/api/catalogues/[id]/items/[itemId]/route.ts` (`PATCHABLE` ~11-27; `buildItemPatch` ~66-152)
- Test: `S:src/app/api/catalogues/[id]/items/[itemId]/route.test.ts` (extend)

**Interfaces:**
- Consumes: `custom_name_max_length` column (Task 1).
- Produces: PATCH accepts `custom_name_max_length` (int 1–30, or null to clear). Consumed by the editor (Task 9).

**Context:** `custom_name_max_length` is a `b2b_catalogue_items` column, so it lives in `buildItemPatch` (like `line_dataset_id`), NOT `schema.ts`. Reuse `coerceIntOverride` (returns `undefined`=absent / `null`=empty / truncated int) and add a 1–30 range check. No cross-org FK check (it's a plain int).

- [ ] **Step 1: Write the failing tests** — extend `S:src/app/api/catalogues/[id]/items/[itemId]/route.test.ts` (mirrors the `line_dataset_id` describe ~104-118):

```ts
describe('buildItemPatch — custom_name_max_length', () => {
  it('passes a positive integer through', () => {
    expect(buildItemPatch({ custom_name_max_length: 15 }).patch).toMatchObject({
      custom_name_max_length: 15,
    })
  })
  it('coerces a numeric string', () => {
    expect(buildItemPatch({ custom_name_max_length: '20' }).patch.custom_name_max_length).toBe(20)
  })
  it('coerces empty string / null to null (custom name off)', () => {
    expect(buildItemPatch({ custom_name_max_length: '' }).patch.custom_name_max_length).toBeNull()
    expect(buildItemPatch({ custom_name_max_length: null }).patch.custom_name_max_length).toBeNull()
  })
  it('rejects values below 1 or above 30', () => {
    expect(buildItemPatch({ custom_name_max_length: 0 }).error).toBeTruthy()
    expect(buildItemPatch({ custom_name_max_length: 31 }).error).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/jamierogangeorge/Documents/print-room-staff-portal && npx vitest run "src/app/api/catalogues/[id]/items/[itemId]/route.test.ts"`
Expected: FAIL — `custom_name_max_length` is dropped (not in `PATCHABLE`), so the passthrough/reject cases fail.

- [ ] **Step 3a: Add to `PATCHABLE`** — in the route, add `'custom_name_max_length',` to the `PATCHABLE` array (after `'line_dataset_id',`).

- [ ] **Step 3b: Add the coercion branch** — in `buildItemPatch`, add a branch before the final `else` (mirrors the int-with-validation shape):

```ts
    } else if (k === 'custom_name_max_length') {
      // Feature 2 — per-product custom-name cap. null = off; else an int 1..30
      // (UI default 15). Reuses the same int coercion as the override keys.
      const coerced = coerceIntOverride(body[k])
      if (coerced === undefined) continue
      if (coerced !== null && (coerced < 1 || coerced > 30)) {
        return { patch, error: 'custom_name_max_length must be between 1 and 30' }
      }
      patch[k] = coerced
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run "src/app/api/catalogues/[id]/items/[itemId]/route.test.ts"`
Expected: PASS (existing + 4 new).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit 2>&1 | grep "items/\[itemId\]/route"` → Expected: no output.

```bash
git add "src/app/api/catalogues/[id]/items/[itemId]/route.ts" "src/app/api/catalogues/[id]/items/[itemId]/route.test.ts"
git commit -m "feat(catalogue): accept custom_name_max_length on the item PATCH (feature 2)"
```

---

### Task 9 (S): CatalogueItemEditor — custom-name control

**Files:**
- Modify: `S:src/components/catalogues/CatalogueItemEditor.tsx` (data prop ~43-81; `FormState`/`initial` ~98-126; `buildPatch` ~192-227; control ~579-616 card)
- Modify: the catalogue-item **editor page loader** (grep `line_dataset_id` under `src/app/**` to find where `CatalogueItemEditorData.item` is selected)
- Test: `S:src/components/catalogues/__tests__/CatalogueItemEditor.custom-name.test.tsx`

**Interfaces:**
- Consumes: PATCH accepts `custom_name_max_length` (Task 8).
- Produces: staff can set the per-product cap; the PDP loader (Task 4) reads the column.

**Context:** A single number input mirroring `moq_override`/`base_cost_override` (empty string → `null` = off; a value = on + cap), placed in the "Catalogue-scoped details" card beside the Location dropdown. **Deviation from spec, flagged for Jon:** the spec described a checkbox + conditional number input; a bare number input (empty = off, placeholder shows the default 15) delivers the same capability, matches the four sibling override controls in the same card exactly, and needs no new Checkbox primitive. Same on/off + cap, less surface.

- [ ] **Step 1: Write the failing test**

```tsx
// S:src/components/catalogues/__tests__/CatalogueItemEditor.custom-name.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CatalogueItemEditor } from '../CatalogueItemEditor'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

// Minimal data fixture — mirror CatalogueItemEditor.fulfilment.test.tsx.
const data = {
  catalogue: { id: 'cat-1', organization_id: 'org-1' },
  item: {
    id: 'item-1', catalogue_id: 'cat-1', source_product_id: 'prod-1',
    name: 'Basic Tee', description: null, is_active: true, sort_order: null,
    metafields: {}, lead_time_days_override: null, moq_override: null,
    sku_override: null, base_cost_override: null, fulfilment_type_override: null,
    price_mode: 'computed' as const, volume_display_hidden_bands: [],
    line_dataset_id: null, custom_name_max_length: null,
    created_at: '', updated_at: '',
  },
  master: null,
  colours: [], pricingLadder: { bands: [] } as never, cardImageUrl: null, cardImageId: null,
  variants: [], orgArtworks: [], locationDatasets: [],
}

describe('CatalogueItemEditor — custom name (feature 2)', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as never
  })

  it('sends custom_name_max_length in the PATCH when a value is entered', async () => {
    render(<CatalogueItemEditor data={data as never} />)
    const input = screen.getByLabelText(/Custom name/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: '15' } })
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }))
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body)
    expect(body.custom_name_max_length).toBe(15)
  })

  it('sends null when the field is left blank', async () => {
    render(<CatalogueItemEditor data={data as never} />)
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }))
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body)
    expect(body.custom_name_max_length).toBeNull()
  })
})
```

(If the real `CatalogueItemEditor` prop/spelling differs from this fixture, copy the exact fixture shape from `src/components/catalogues/__tests__/CatalogueItemEditor.fulfilment.test.tsx` and add the two new item keys `custom_name_max_length: null`.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run "src/components/catalogues/__tests__/CatalogueItemEditor.custom-name.test.tsx"`
Expected: FAIL — no `Custom name` input.

- [ ] **Step 3a: Extend the data prop type** — in `CatalogueItemEditor.tsx`, `item` shape (~43-64), after `line_dataset_id: string | null`:

```ts
    custom_name_max_length: number | null
```

- [ ] **Step 3b: Extend `FormState` + `initial()`** — add `custom_name_max_length: string` to `FormState` (after `line_dataset_id: string`), and in `initial()` (after the `line_dataset_id` line):

```ts
    custom_name_max_length:
      data.item.custom_name_max_length == null ? '' : String(data.item.custom_name_max_length),
```

- [ ] **Step 3c: Extend `buildPatch()`** — after the `line_dataset_id` line (~226):

```ts
      custom_name_max_length:
        form.custom_name_max_length.trim() === ''
          ? null
          : Number.isFinite(Number(form.custom_name_max_length))
            ? Math.trunc(Number(form.custom_name_max_length))
            : null,
```

- [ ] **Step 3d: Add the control** — in the "Catalogue-scoped details" card, immediately after the Location `<Field>` block (~616):

```tsx
              <Field
                id="cie-custom-name-max"
                label="Custom name (PDP)"
              >
                <Input
                  form={formId}
                  type="number"
                  min={1}
                  max={30}
                  step={1}
                  value={form.custom_name_max_length}
                  onChange={(e) => set('custom_name_max_length', e.target.value)}
                  placeholder="Off — set a max length (e.g. 15) to enable"
                />
              </Field>
```

- [ ] **Step 3e: Load the column** — in the editor page loader (grep `line_dataset_id` under `src/app/**`), add `custom_name_max_length` to the `b2b_catalogue_items` select and to the object passed as `data.item`.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run "src/components/catalogues/__tests__/CatalogueItemEditor.custom-name.test.tsx"`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit 2>&1 | grep -E "CatalogueItemEditor"` → Expected: no output.

```bash
git add src/components/catalogues/CatalogueItemEditor.tsx "src/components/catalogues/__tests__/CatalogueItemEditor.custom-name.test.tsx" <editor-page-loader-path>
git commit -m "feat(catalogue): custom-name max-length control on the item editor (feature 2)"
```

---

### Task 10 (S): Staff Monday mirror — write + read back the custom name

**Files:**
- Modify: `S:src/lib/monday/deal-item.ts` (`OrderLineForMonday` ~84-97; `createOrderDealSubitem` ~199-235)
- Modify: `S:src/app/api/orders/[id]/retry-monday-push/route.ts` (select/type/map ~85-140)
- Modify: `S:src/app/api/ordering-periods/[id]/confirm/route.ts` (select/type/map ~64-108)

**Interfaces:**
- Consumes: `PRODUCTION_SUBITEM_COLUMNS.customName` (Task 6); `quote_items.line_custom_name` (Task 1).
- Produces: staff re-push + ordering-period confirm both carry the custom name to Monday.

**Context:** The staff repo has its own `OrderLineForMonday` (deal-item.ts:84-97) and its own column WRITE in `createOrderDealSubitem`. Two routes build `OrderLineForMonday[]` locally and must add `line_custom_name` to their select, row type, and map. Pure mirror of `line_location_label`. Covered by typecheck + the Task 12 e2e (these are DB-integration paths with no isolated unit tests today).

- [ ] **Step 1: Add the type field** — in `S:src/lib/monday/deal-item.ts`, `OrderLineForMonday`, after `location: string | null` (~95):

```ts
  /** Feature 2 — optional custom name for this line; null when none. */
  customName: string | null
```

- [ ] **Step 2: Write the column** — in `createOrderDealSubitem`, after the `line.location` write block (~226):

```ts
  if (line.customName?.trim()) {
    columnValues[PRODUCTION_SUBITEM_COLUMNS.customName] = line.customName.trim()
  }
```

- [ ] **Step 3: retry-monday-push route** — in `S:src/app/api/orders/[id]/retry-monday-push/route.ts`:
  - add `line_custom_name` to the `.select(...)` string (after `line_location_label,`),
  - add `line_custom_name: string | null` to the `DealLineRow` type,
  - add `customName: row.line_custom_name ?? null,` to the returned map object (after `location: row.line_location_label ?? null,`).

- [ ] **Step 4: ordering-periods confirm route** — in `S:src/app/api/ordering-periods/[id]/confirm/route.ts`, make the identical three edits (select, `LineRow` type, map object).

- [ ] **Step 5: Typecheck (no new errors) + build guard**

Run: `npx tsc --noEmit 2>&1 | grep -E "monday/deal-item|retry-monday-push|ordering-periods/\[id\]/confirm"` → Expected: no output.
Run: `npx vitest run "src/lib/orders/__tests__/submit.test.ts"` → Expected: PASS (production-board path unaffected — proves no regression).

- [ ] **Step 6: Commit**

```bash
git add src/lib/monday/deal-item.ts "src/app/api/orders/[id]/retry-monday-push/route.ts" "src/app/api/ordering-periods/[id]/confirm/route.ts"
git commit -m "feat(monday): carry custom name on staff re-push + ordering confirm (feature 2)"
```

---

### Task 11: Full suite + typecheck gate (both repos)

**Files:** none (verification).

- [ ] **Step 1: Customer repo — full suite + baseline typecheck**

Run: `cd /Users/jamierogangeorge/Documents/print-room-portal && npm test`
Expected: all pass except the pre-existing `ProductDetailClient.fulfilment-fallback.test.tsx` failure documented in [[mtf-location-dropdown-feature]] (verify it is the SAME failure, not a new one).
Run: `npx tsc --noEmit --incremental false 2>&1 | grep -vE "next-config-redirects|tracker-notification"` → Expected: no output (only the 14 baseline errors remain, in those two unrelated files).

- [ ] **Step 2: Staff repo — full suite + baseline typecheck**

Run: `cd /Users/jamierogangeorge/Documents/print-room-staff-portal && npm test`
Expected: no NEW failures vs the ~20 pre-existing catalogue baseline.
Run: `npx tsc --noEmit 2>&1 | wc -l` → Expected: the count matches the pre-existing baseline (no new touched-file errors).

- [ ] **Step 3: Commit any baseline notes if needed** (usually none).

---

### Task 12 (S + ops): Apply migration + end-to-end smoke — GATED (Jon's go)

**Files:** none (ops). **This task requires Jon's explicit go — it writes to the shared prod DB and pushes a Monday deal.**

- [ ] **Step 1: Apply the migration** (Jon, from the staff repo root)

```bash
supabase link --project-ref bthsxgmcnbvwwgvdveek   # once, if not already linked
mv .env.local .env.local.bak && supabase db push ; mv .env.local.bak .env.local
```

- [ ] **Step 2: Verify the columns exist** (read-only, MCP `execute_sql` is fine for a SELECT)

```sql
select column_name, data_type from information_schema.columns
where (table_name='b2b_catalogue_items' and column_name='custom_name_max_length')
   or (table_name='quote_items' and column_name='line_custom_name');
```
Expected: 2 rows (`integer`, `text`).

- [ ] **Step 3: Enable on one test product** — in the staff catalogue editor, set "Custom name (PDP)" = `15` on a test-org catalogue item; Save. Confirm the PATCH succeeds.

- [ ] **Step 4: PDP → cart split** — on that product's PDP, add qty with name "Chris", then again with "George". Confirm the cart shows **two** lines (not a merged qty-2), and a blank-name add of the same product merges normally.

- [ ] **Step 5: Checkout → DB snapshot** — place the order (a test org so no customer email fires; **any test/verification email must go to `jamie@theprint-room.co.nz`, never `jon@`**). Then verify:

```sql
select line_custom_name, quantity from quote_items
where quote_id = '<the-new-quote-id>' order by line_custom_name;
```
Expected: rows carrying `Chris` / `George` / `null`.

- [ ] **Step 6: Monday** — open the pushed production deal; confirm the subitem **Custom Name** column shows `Chris` on the named line and is blank on the unnamed line; the subitem **title is still the product name** (unchanged).

- [ ] **Step 7: Record outcome** in the PR / hand back to Jon. Update [[custom-name-personalisation-design]] memory to "SHIPPED+LIVE" once confirmed.

---

### Task 13 (OPTIONAL / deferrable): Shared `variant_label` formatter

> **This task is independent of the custom-name feature and can be deferred or dropped.** Custom name writes its OWN Monday column, so it does not depend on the label. This is the "+ formatter" dedup the spec flagged; it carries real regression risk across live Monday-push paths for zero functional gain to custom-name. Do it only if Jon wants the cleanup now.

**Reality (from grounding):** the sites are NOT a clean 4-way duplicate.
- **P:** `submit.ts:1629` and `submit.ts:2038` share `[swatch?.label, size_label].filter(Boolean).join(' / ') || '—'`. `lib/reorder/rebuild.ts:70` is a third. `deal-item.ts:445` is a `× qty` *title* template, not a label.
- **S:** `orders/submit.ts:199-210`, `retry-monday-push:128-129`, `ordering-periods/.../confirm:97` share the `' / '` join with `|| '—'`; `email/inventory-updated.ts:93` shares the shape but falls back to `'variant'`. `quotes/approve.ts:124` is a **genuinely different** formatter (`brand — category` with `' — '`) — leave it alone.

**Scope (per repo, no cross-repo sharing — they're separate codebases):**
- Create `P:lib/monday/variant-label.ts` and `S:src/lib/monday/variant-label.ts`, each exporting:

```ts
export function formatVariantLabel(
  colour: string | null | undefined,
  size: string | null | undefined,
  opts: { fallback?: string } = {},
): string {
  return [colour, size].filter(Boolean).join(' / ') || (opts.fallback ?? '—')
}
```

- [ ] **Step 1: Characterisation test** (each repo) — pin current output for fixtures: `('Black','XL')→'Black / XL'`, `('Black',null)→'Black'`, `(null,null)→'—'`, and with `{fallback:'variant'}` the empty case → `'variant'`.
- [ ] **Step 2: Delegate the `' / '` join sites** to `formatVariantLabel` (P: `submit.ts:1629`, `submit.ts:2038`; S: `orders/submit.ts`, `retry-monday-push`, `confirm`, and `inventory-updated` with `{fallback:'variant'}`). Do NOT touch `approve.ts` (`brand — category`) or the `× qty` title templates.
- [ ] **Step 3:** Run the touched files' existing tests (e.g. S `submit.test.ts:327` `variant_label` assertion) — Expected: unchanged output, all green.
- [ ] **Step 4:** Commit each repo separately.

---

## Self-review (against the spec)

- **Spec §1 schema** → Task 1 (both columns, exact names). ✔
- **Spec §2 staff config** → Tasks 8 (PATCH) + 9 (editor). ✔ (UI simplified from checkbox→number input; flagged in Task 9 for Jon — same capability.)
- **Spec §3 PDP (optional, no gate)** → Task 4. ✔
- **Spec §4 validation (shared sanitiser)** → Task 2 (+ used in Tasks 4 & 5). ✔
- **Spec §5 cart (signature, not pooling)** → Task 3 (incl. pooling-parity test). ✔
- **Spec §6 checkout (buildLineSnapshotUpdate, read-back, route)** → Tasks 5 + 7. ✔
- **Spec §7 Monday (new column, both repos)** → Tasks 6, 7, 10. ✔
- **Spec §8 shared formatter** → Task 13, explicitly optional (spec's "4 sites" corrected to the real, messier inventory). ✔
- **Spec testing strategy** → per-task TDD + Task 11 suite gate + Task 12 e2e. ✔
- **Spec out-of-scope guardrails** (no abstraction retrofit, no dataset/CSV, no Trade Services, no `required` flag, `production-job.ts` untouched) → honoured; stated in the file-touch map. ✔

**Type consistency:** `customName` (camelCase) on `CartLine` + `OrderLineForMonday` (both repos); `custom_name` (snake) on `CheckoutLineInput` + route body; `line_custom_name` (DB) on `quote_items`; `custom_name_max_length` (DB/PATCH/FormState). `sanitiseCustomName(raw, maxLength)` signature identical at both call sites. `PRODUCTION_SUBITEM_COLUMNS.customName` identical literal in both repos. `lineSignature` 9th param `customName` consistent across definition (Task 3b) and both call sites (Task 3d). ✔
