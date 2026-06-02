# Catalogue Item Fulfilment-Mode Authoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an account manager set a catalogue item's fulfilment mode from the staff catalogue-item editor — writing `b2b_catalogue_items.fulfilment_type_override` only, with "Inherit master" as the default and the master `products` row never touched.

**Architecture:** The column `b2b_catalogue_items.fulfilment_type_override` (`product_fulfilment_type` enum, nullable, default `NULL`) **already exists in prod** — verified read-only 2026-06-02. No migration. The work is purely surfacing it: thread the value through the editor's read model (`CatalogueItemEditorData.item`) → `FormState` → `buildPatch()` → the items PATCH route's `PATCHABLE` allow-list, and add a `Dropdown` whose blank option means "inherit master". The reusable `FULFILMENT_TYPES` / `FULFILMENT_TYPE_LABELS` const already lives in `src/types/products.ts` and is the same one the master-product editor (`DetailsTab.tsx`) uses.

**Tech Stack:** Next.js 16 (App Router) · TypeScript · Supabase (service-role writes via API route) · Vitest · the staff `Dropdown` UI primitive (`@/components/ui/dropdown`).

**Repo:** `print-room-staff-portal` — `c:\Users\MSI\Documents\Projects\print-room-staff-portal`. **Branch:** `feat/catalogue-fulfilment-mode`.

**Independence:** Ships standalone — an AM can author modes before any pill consumes them (Plan C). No dependency on the role rename (Plan A): this surface is staff-only and never reads `user_organizations.role`.

---

## ⚠️ Flags

- **No migration.** The earlier recon claim that a column must be added is **wrong** — `mcp__supabase__execute_sql` on 2026-06-02 confirmed `b2b_catalogue_items.fulfilment_type_override` exists: `data_type=USER-DEFINED`, `udt_name=product_fulfilment_type`, `is_nullable=YES`, `column_default=NULL`. Enum values: `stocked | made_to_order | mixed`. Do **not** author DDL.
- **Master row is never mutated.** The editor writes only to `b2b_catalogue_items` (via `PATCH /api/catalogues/[id]/items/[itemId]`, which does `admin.from('b2b_catalogue_items').update(...)`). The master `products` row is read-only context (`data.master`). Task 4 asserts this explicitly.
- **Staff UI rules.** Per `AGENTS.md`, read `docs/ui/oem-rules.md` before editing the `.tsx`. The new control mirrors the existing `Field`+`Dropdown` pattern already in this codebase, so it inherits the approved styling.

---

## File Structure

- Modify: `src/types/products.ts` — add an "inherit" sentinel helper for the override (small, colocated with `FULFILMENT_TYPES`).
- Modify: `src/app/api/catalogues/[id]/items/[itemId]/route.ts` — add `fulfilment_type_override` to `PATCHABLE` + enum coercion/validation.
- Modify: `src/components/catalogues/CatalogueItemEditor.tsx` — `CatalogueItemEditorData.item` field, `FormState`, `initial()`, `buildPatch()`, `Dropdown` import, the select in the "Catalogue-scoped details" card; surface `master.fulfilment_type` for the inherit hint.
- Modify: the editor's server data loader (the page/loader that builds `CatalogueItemEditorData`) — select `fulfilment_type_override` on the item and `fulfilment_type` on the master.
- Test: `src/app/api/catalogues/[id]/items/[itemId]/__tests__/fulfilment-override.test.ts`, `src/lib/__tests__/fulfilment-override-coerce.test.ts`.

---

## Task 1: Override coercion helper (pure, TDD core)

The PATCH route coerces each override by key-set. Add a typed coercion for the enum override: `''`/`null`/`undefined`→handled, a valid enum value passes, an invalid string is rejected. Keep it pure and unit-tested so the route and the form agree on the contract.

**Files:**
- Modify: `src/types/products.ts` (append after `FULFILMENT_TYPE_LABELS`, ~`:80`)
- Test: `src/lib/__tests__/fulfilment-override-coerce.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/fulfilment-override-coerce.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { coerceFulfilmentOverride } from '@/types/products'

describe('coerceFulfilmentOverride', () => {
  it('passes through valid enum values', () => {
    expect(coerceFulfilmentOverride('stocked')).toBe('stocked')
    expect(coerceFulfilmentOverride('made_to_order')).toBe('made_to_order')
    expect(coerceFulfilmentOverride('mixed')).toBe('mixed')
  })
  it("maps '' and null to null (inherit master)", () => {
    expect(coerceFulfilmentOverride('')).toBeNull()
    expect(coerceFulfilmentOverride(null)).toBeNull()
  })
  it('returns undefined when the key is absent (no-op)', () => {
    expect(coerceFulfilmentOverride(undefined)).toBeUndefined()
  })
  it('throws on an unknown value', () => {
    expect(() => coerceFulfilmentOverride('banana')).toThrow()
  })
})
```

- [ ] **Step 2: Run it — verify it fails**

Run: `cd c:/Users/MSI/Documents/Projects/print-room-staff-portal && npx vitest run src/lib/__tests__/fulfilment-override-coerce.test.ts`
Expected: FAIL — `coerceFulfilmentOverride` is not exported from `@/types/products`.

- [ ] **Step 3: Add the helper**

In `src/types/products.ts`, append after the `FULFILMENT_TYPE_LABELS` block (after line 80):

```ts
/**
 * Coerce a raw fulfilment-override input for b2b_catalogue_items.fulfilment_type_override.
 * - undefined  → undefined (key absent in PATCH body; route should skip it)
 * - '' or null → null      (explicit "inherit master")
 * - valid enum → the value
 * - anything else → throws (caller maps to a 400)
 */
export function coerceFulfilmentOverride(
  raw: unknown,
): FulfilmentType | null | undefined {
  if (raw === undefined) return undefined
  if (raw === null || raw === '') return null
  if (typeof raw === 'string' && (FULFILMENT_TYPES as readonly string[]).includes(raw)) {
    return raw as FulfilmentType
  }
  throw new Error(`invalid fulfilment_type_override: ${String(raw)}`)
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `npx vitest run src/lib/__tests__/fulfilment-override-coerce.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git checkout -b feat/catalogue-fulfilment-mode
git add src/types/products.ts src/lib/__tests__/fulfilment-override-coerce.test.ts
git commit -m "feat(staff): add coerceFulfilmentOverride helper for catalogue item override"
```

---

## Task 2: PATCH route accepts `fulfilment_type_override`

**Files:**
- Modify: `src/app/api/catalogues/[id]/items/[itemId]/route.ts:7-23,59-82`
- Test: `src/app/api/catalogues/[id]/items/[itemId]/__tests__/fulfilment-override.test.ts` (create)

The route builds `patch` from `body` by iterating `PATCHABLE` and coercing per key-set. We add the override key, route it through `coerceFulfilmentOverride`, and 400 on an invalid value. To keep the test pure, extract the patch-building loop into an exported `buildItemPatch(body)` function and have `PATCH` call it.

- [ ] **Step 1: Write the failing test**

Create `src/app/api/catalogues/[id]/items/[itemId]/__tests__/fulfilment-override.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildItemPatch } from '../route'

describe('buildItemPatch — fulfilment_type_override', () => {
  it('includes a valid override value', () => {
    const { patch } = buildItemPatch({ fulfilment_type_override: 'stocked' })
    expect(patch.fulfilment_type_override).toBe('stocked')
  })
  it("maps '' to null (inherit master)", () => {
    const { patch } = buildItemPatch({ fulfilment_type_override: '' })
    expect(patch.fulfilment_type_override).toBeNull()
  })
  it('omits the key entirely when absent (no accidental clear)', () => {
    const { patch } = buildItemPatch({ name: 'X' })
    expect('fulfilment_type_override' in patch).toBe(false)
  })
  it('flags an invalid value as a 400', () => {
    const { error } = buildItemPatch({ fulfilment_type_override: 'banana' })
    expect(error).toBe('invalid fulfilment_type_override')
  })
  it('never writes to the master products table (catalogue-scoped only)', () => {
    // buildItemPatch only ever returns columns of b2b_catalogue_items.
    const { patch } = buildItemPatch({ fulfilment_type_override: 'mixed', name: 'Y' })
    expect(Object.keys(patch)).not.toContain('fulfilment_type') // master column name
    expect(Object.keys(patch).every((k) => k !== 'products')).toBe(true)
  })
})
```

- [ ] **Step 2: Run it — verify it fails**

Run: `npx vitest run "src/app/api/catalogues/[id]/items/[itemId]/__tests__/fulfilment-override.test.ts"`
Expected: FAIL — `buildItemPatch` not exported; route currently inlines the loop in `PATCH`.

- [ ] **Step 3: Extract `buildItemPatch` and wire the override**

In `src/app/api/catalogues/[id]/items/[itemId]/route.ts`:

Add the import (top of file, after line 5):

```ts
import { coerceFulfilmentOverride } from '@/types/products'
```

Add the key to `PATCHABLE` (line 7-18) — insert after `'base_cost_override'`:

```ts
const PATCHABLE = [
  'name',
  'description',
  'metafields',
  'is_active',
  'sort_order',
  'variant_label',
  'lead_time_days_override',
  'moq_override',
  'sku_override',
  'base_cost_override',
  'fulfilment_type_override',
] as const
```

Extract the patch builder. Replace the inline loop (lines 58–82 inside `PATCH`) by introducing this exported function above `PATCH` and calling it:

```ts
export function buildItemPatch(
  body: Record<string, unknown>,
): { patch: Record<string, unknown>; error?: string } {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const k of PATCHABLE) {
    if (!(k in body)) continue
    if (k === 'fulfilment_type_override') {
      let coerced: ReturnType<typeof coerceFulfilmentOverride>
      try {
        coerced = coerceFulfilmentOverride(body[k])
      } catch {
        return { patch, error: 'invalid fulfilment_type_override' }
      }
      if (coerced === undefined) continue
      patch[k] = coerced
    } else if (INT_OVERRIDE_KEYS.has(k)) {
      const coerced = coerceIntOverride(body[k])
      if (coerced === undefined) continue
      patch[k] = coerced
    } else if (NUMERIC_OVERRIDE_KEYS.has(k)) {
      const coerced = coerceNumericOverride(body[k])
      if (coerced === undefined) continue
      if (coerced !== null && coerced < 0) {
        return { patch, error: 'base_cost_override must be >= 0' }
      }
      patch[k] = coerced
    } else if (TEXT_OVERRIDE_KEYS.has(k)) {
      const coerced = coerceTextOverride(body[k])
      if (coerced === undefined) continue
      patch[k] = coerced
    } else {
      patch[k] = body[k]
    }
  }
  return { patch }
}
```

Then in `PATCH`, replace the old inline `const patch … for (…) { … }` block with:

```ts
  const { patch, error: patchError } = buildItemPatch(body)
  if (patchError) {
    return NextResponse.json({ error: patchError }, { status: 400 })
  }
```

(The downstream `overrideTouched` block at lines 84+ still reads `patch` — leave it; it keys off `INT_OVERRIDE_KEYS` only, so the new enum key doesn't perturb it.)

- [ ] **Step 4: Run it — verify it passes**

Run the Step 2 command. Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add "src/app/api/catalogues/[id]/items/[itemId]/route.ts" "src/app/api/catalogues/[id]/items/[itemId]/__tests__/fulfilment-override.test.ts"
git commit -m "feat(staff): accept fulfilment_type_override in catalogue item PATCH"
```

---

## Task 3: Editor read model — thread the value in

The editor's `CatalogueItemEditorData.item` and the server loader that builds it don't carry the override yet. Add the field to the type and select it server-side; add the master's `fulfilment_type` for the inherit hint.

**Files:**
- Modify: `src/components/catalogues/CatalogueItemEditor.tsx:37-54` (`item` shape), `:55-65` (`master` shape)
- Modify: the editor's data loader (find it — Step 1)

- [ ] **Step 1: Locate the loader**

Run: `grep -rn "lead_time_days_override" src/app/ src/lib/ --include=*.ts --include=*.tsx`
The loader is the server file that selects `b2b_catalogue_items` columns into `CatalogueItemEditorData.item` (it already selects `lead_time_days_override, moq_override, sku_override, base_cost_override`). Note its path; you will add `fulfilment_type_override` to that `.select(...)` and `fulfilment_type` to the master `products` select.

- [ ] **Step 2: Extend the `item` and `master` types**

In `CatalogueItemEditor.tsx`, add to the `item` object type (after `base_cost_override: number | null` at line 50):

```ts
    fulfilment_type_override: FulfilmentType | null
```

Add to the `master` object type (after `is_b2b_only: boolean` at line 64):

```ts
    fulfilment_type: FulfilmentType | null
```

Add the import at the top of the file:

```ts
import { FULFILMENT_TYPES, FULFILMENT_TYPE_LABELS, type FulfilmentType } from '@/types/products'
```

- [ ] **Step 3: Extend the loader selects**

In the loader located in Step 1:
- The `b2b_catalogue_items` select for the item → add `fulfilment_type_override`.
- The master `products` select → add `fulfilment_type`.

(Both are existing `.select('…')` string lists; append the column names. The master `products.fulfilment_type` is `NOT NULL` in the DB so it always resolves; type it `FulfilmentType | null` defensively for legacy joins.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors *only* where `FormState`/`initial()`/the JSX don't yet handle the new field — those are fixed in Task 4. If errors appear elsewhere (e.g. a test fixture building `CatalogueItemEditorData` without the new fields), update those fixtures to include `fulfilment_type_override: null` / `fulfilment_type: 'made_to_order'`.

- [ ] **Step 5: Commit**

```bash
git add src/components/catalogues/CatalogueItemEditor.tsx <loader-file-from-step-1>
git commit -m "feat(staff): load fulfilment_type_override + master fulfilment_type into editor"
```

---

## Task 4: Form state + select control

**Files:**
- Modify: `src/components/catalogues/CatalogueItemEditor.tsx` — `FormState` (`:74-84`), `initial()` (`:86-100`), `buildPatch()` (`:146-179`), the "Catalogue-scoped details" card (`:318-383`), add `Dropdown` import.
- Test: `src/components/catalogues/__tests__/CatalogueItemEditor.fulfilment.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `src/components/catalogues/__tests__/CatalogueItemEditor.fulfilment.test.tsx`. Assert the form renders the select with the master's mode as the inherit hint and the override preselected:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { CatalogueItemEditor, type CatalogueItemEditorData } from '../CatalogueItemEditor'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

function data(overrides: Partial<CatalogueItemEditorData['item']> = {}): CatalogueItemEditorData {
  return {
    catalogue: { id: 'c1', organization_id: 'o1', name: 'Cat' },
    organization: { id: 'o1', name: 'Org' },
    item: {
      id: 'i1', catalogue_id: 'c1', source_product_id: 'p1', variant_label: null,
      name: 'Tee', description: null, is_active: true, sort_order: null,
      metafields: {}, lead_time_days_override: null, moq_override: null,
      sku_override: null, base_cost_override: null, conversion_snapshot: null,
      fulfilment_type_override: 'stocked',
      created_at: '', updated_at: '', ...overrides,
    },
    master: {
      id: 'p1', name: 'Tee', description: null, image_url: null, sku: null,
      base_cost: null, lead_time_days: null, moq: null, is_b2b_only: false,
      fulfilment_type: 'made_to_order',
    },
    colours: [], images: [], pricingLadder: [] as never, cardImageUrl: null,
    variants: [], orgArtworks: [],
  }
}

describe('CatalogueItemEditor fulfilment-mode select', () => {
  it('renders the fulfilment-mode control with the override preselected', () => {
    render(<CatalogueItemEditor data={data()} />)
    const control = screen.getByLabelText('Fulfilment mode')
    expect(control).toBeInTheDocument()
  })
  it('shows the master mode as the inherit hint', () => {
    render(<CatalogueItemEditor data={data({ fulfilment_type_override: null })} />)
    expect(screen.getByText(/Master: Made to order/i)).toBeInTheDocument()
  })
})
```

> If the staff `Dropdown` primitive renders a native `<select>` with `aria-label`, `getByLabelText('Fulfilment mode')` resolves it. If it renders a custom button (Radix-style), switch the query to `screen.getByRole('button', { name: /fulfilment mode/i })` to match the actual primitive — check `@/components/ui/dropdown` before finalising.

- [ ] **Step 2: Run it — verify it fails**

Run: `npx vitest run "src/components/catalogues/__tests__/CatalogueItemEditor.fulfilment.test.tsx"`
Expected: FAIL — no control labelled "Fulfilment mode" exists yet (and TS: `FormState` has no `fulfilment_type_override`).

- [ ] **Step 3: Add the form field + select**

In `CatalogueItemEditor.tsx`:

Add `Dropdown` to the UI import line:

```ts
import { Dropdown } from '@/components/ui/dropdown'
```

`FormState` (after `base_cost_override: string` at line 83) — store the override as a string, `''` = inherit:

```ts
  fulfilment_type_override: string
```

`initial()` (after the `base_cost_override` line ~98):

```ts
    fulfilment_type_override: data.item.fulfilment_type_override ?? '',
```

`buildPatch()` (inside the returned object, after `base_cost_override: …` at ~176) — `''` → `null`, else the value:

```ts
      fulfilment_type_override:
        form.fulfilment_type_override === '' ? null : form.fulfilment_type_override,
```

Add the control to the "Catalogue-scoped details" `Card` (it's a non-override, catalogue-level setting — it belongs in this card alongside name/variant_label/sort_order, **not** in the "Per-org overrides" card, because "Inherit master" is its own first-class option). Insert a new `Field` inside the `grid` (after the "Sort order" `Field` at line 356, before "Description"):

```tsx
            <Field
              id="cie-fulfilment-mode"
              label="Fulfilment mode"
              hint={
                master?.fulfilment_type
                  ? `Master: ${FULFILMENT_TYPE_LABELS[master.fulfilment_type]}`
                  : 'Master: —'
              }
            >
              <Dropdown
                size="md"
                ariaLabel="Fulfilment mode"
                value={form.fulfilment_type_override}
                onValueChange={(v) => set('fulfilment_type_override', v)}
                options={[
                  {
                    value: '',
                    label: master?.fulfilment_type
                      ? `Inherit master (${FULFILMENT_TYPE_LABELS[master.fulfilment_type]})`
                      : 'Inherit master',
                  },
                  ...FULFILMENT_TYPES.map((ft) => ({
                    value: ft,
                    label: FULFILMENT_TYPE_LABELS[ft],
                  })),
                ]}
              />
            </Field>
```

> The "Catalogue-scoped details" card header already reads *"Edits here only affect this catalogue's copy. The master product is unchanged."* — that copy correctly covers this control. The select writes `fulfilment_type_override`; it never sends `fulfilment_type`, so the master row is untouched (asserted in Task 2 Step 1's final test).

- [ ] **Step 4: Run it — verify it passes**

Run the Step 1 command. Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/components/catalogues/CatalogueItemEditor.tsx "src/components/catalogues/__tests__/CatalogueItemEditor.fulfilment.test.tsx"
git commit -m "feat(staff): fulfilment-mode select on catalogue item editor (inherit master default)"
```

---

## Task 5: End-to-end round-trip + full verification

**Files:** none new

- [ ] **Step 1: Manual round-trip checklist (staff, against test catalogue only)**

Document for the executor (no automated browser step here — staff portal has no E2E harness in scope):
1. Open a catalogue item editor for an item on a **test** catalogue.
2. Set Fulfilment mode → "Stocked (check + reserve inventory)" → Save.
3. Confirm `router.refresh()` shows the value persisted (re-open: select shows Stocked).
4. Verify via MCP read-only: `SELECT fulfilment_type_override FROM b2b_catalogue_items WHERE id = '<item>';` → `stocked`.
5. Verify the master is untouched: `SELECT fulfilment_type FROM products WHERE id = '<source_product_id>';` → unchanged from before.
6. Set the mode back to "Inherit master" → Save → DB shows `NULL`.

- [ ] **Step 2: Full suite + build**

```bash
cd c:/Users/MSI/Documents/Projects/print-room-staff-portal && npx vitest run && npm run build
```
Expected: all green, build succeeds.

- [ ] **Step 3: Commit any fixture updates**

```bash
git add -A && git commit -m "test(staff): fixtures carry fulfilment_type_override + master fulfilment_type"
```

---

## Self-Review

**1. Spec coverage (Item 4):**
- *Add a control that writes `b2b_catalogue_items.fulfilment_type_override`* → Tasks 2 (route) + 4 (select). ✅
- *Options stocked / made_to_order / mixed* → Task 4 select sources `FULFILMENT_TYPES`. ✅
- *Default = inherit master `products.fulfilment_type`* → blank option labelled "Inherit master (…)"; `''`→`null` in `buildPatch`; master mode shown as hint (Task 4). ✅
- *Write to override only, never touch master `products`* → Task 2 writes `b2b_catalogue_items` exclusively; Task 2 Step 1's final assertion proves `patch` carries no master column; loader (Task 3) only *reads* master. ✅
- *Acceptance: set/clear the mode; unset = inherits master* → set (Task 4), clear via "Inherit master" → `null` (Task 5 Step 1.6). ✅
- *Value drives which pill the product appears under (Item 2)* → out of scope here; Plan C consumes the column. Noted, not duplicated.

**2. Placeholder scan:** No "TBD"/"similar to". Every code step is complete. The one lookup-by-grep (Task 3 Step 1, locating the loader) is unavoidable — the loader path wasn't pinned during grounding — but it is bounded: the grep key (`lead_time_days_override`) appears only in the loader's select and the editor, so it resolves to exactly the file that must change, and Task 3 Step 4 (`tsc`) verifies the thread-through compiled.

**3. Type consistency:** `FulfilmentType` (`'stocked'|'made_to_order'|'mixed'`) and `FULFILMENT_TYPES`/`FULFILMENT_TYPE_LABELS` are imported from one source (`@/types/products`) everywhere — the `item.fulfilment_type_override` type, the `master.fulfilment_type` type, the select options, and the hint label all use it. `coerceFulfilmentOverride` returns `FulfilmentType | null | undefined`, matching the column's nullable enum. `FormState.fulfilment_type_override` is `string` (`''` = inherit) and is normalised to `null | FulfilmentType` only at the `buildPatch` boundary — consistent with how the route's `coerceFulfilmentOverride` also treats `''`→`null`.

**Anchor drift adapted:** The recon agent claimed a column needed adding — **corrected**: the column already exists (verified via Supabase MCP), so this plan has **no migration**. The editor's server loader path was not pinned during grounding, so Task 3 Step 1 locates it by a grep on a column it provably already selects rather than hard-coding a stale path.
