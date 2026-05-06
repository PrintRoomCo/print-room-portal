# Per-Variant Product Views + Print Areas — Companion Implementation Plan

**Date:** 2026-05-06
**Spec:** [`specs/2026-05-06-per-variant-product-views-design.md`](../specs/2026-05-06-per-variant-product-views-design.md)
**Repo:** `print-room-staff-portal`, Supabase `bthsxgmcnbvwwgvdveek`
**Unblocks:** Phase 8 of [`2026-05-06-decoration-styles-plan.md`](./2026-05-06-decoration-styles-plan.md). Standalone-shippable — can land before, after, or alongside that plan's Phases 0–7.

## Build order

```
Phase A — Pre-flight grep + audit          [no commits, just discovery]
Phase B — Schema migration                  [1 migration]
Phase C — API surface                       [staff-portal]
Phase D — ImagesTab UI                      [staff-portal]
Phase E — PrintAreasTab UI                  [staff-portal]
Phase F — Smoke test (Camel Hat case)       [manual]
```

---

## Phase A — Pre-flight grep + audit

### Task A.1 — Find supplier-sync `ON CONFLICT` clauses

```bash
# Run from repo roots; record findings before migration
grep -rn "on conflict.*product_id.*view" .
grep -rn "ON CONFLICT (product_id, view)" .
grep -rn "ON CONFLICT (product_id, view_lower)" .
```

If hits found in `sync-jamesharvest-products` or any other supplier sync, the migration must be coordinated with a code update — both at deploy time. Document hit list here before proceeding.

### Task A.2 — Check `view_lower` maintenance

Via Supabase MCP:

```sql
SELECT tgname, pg_get_triggerdef(oid)
FROM pg_trigger
WHERE tgrelid = 'public.product_images'::regclass
  AND NOT tgisinternal;

SELECT pg_get_functiondef(p.oid)
FROM pg_proc p
JOIN pg_trigger t ON t.tgfoid = p.oid
WHERE t.tgrelid = 'public.product_images'::regclass;
```

If a trigger maintains `view_lower`, leave the column. If not, flag for follow-up cleanup migration (out of this plan).

### Task A.3 — Confirm API + types include `color_swatch_id`

Read:
- `print-room-staff-portal/src/types/products.ts` — `ImageRow` shape.
- `print-room-staff-portal/src/types/printAreas.ts` — `ProductImageRow` shape.
- `print-room-staff-portal/src/app/api/products/[id]/images/route.ts` — GET select list, POST body parse.

If `color_swatch_id` isn't in the API response or types, add it as part of Phase C. (Schema-side it's already there — verified via `information_schema.columns`.)

---

## Phase B — Schema migration

### Task B.1 — Migration: `per_variant_product_views`

**File:** `supabase migration new per_variant_product_views` → `20260506xxxxxx_per_variant_product_views.sql`

```sql
-- Drop the constraints that pin one image per (product, view).
DROP INDEX IF EXISTS public.idx_product_images_product_view;
DROP INDEX IF EXISTS public.product_images_product_id_view_lower_uq;

-- New uniqueness: one image per (product, view, colour-swatch-or-sentinel-null).
-- COALESCE handles null color_swatch_id (default/marketing rows).
CREATE UNIQUE INDEX idx_product_images_product_view_swatch_uniq
  ON public.product_images (
    product_id,
    view,
    COALESCE(color_swatch_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- Replace the dropped non-unique lookup with a non-unique equivalent
-- (Postgres won't auto-create one when we drop the unique index).
CREATE INDEX IF NOT EXISTS idx_product_images_product_view
  ON public.product_images (product_id, view);

-- Note: idx_product_images_product_view_swatch_idx already exists (non-unique
-- on (product_id, view, color_swatch_id)) — keep it.
```

### Task B.2 — Apply via MCP

`mcp__claude_ai_Supabase__apply_migration` with the file. After:

```sql
-- Confirm: existing 11107 rows still pass the new constraint.
SELECT product_id, view, COALESCE(color_swatch_id::text, 'null'), COUNT(*) AS n
FROM public.product_images
GROUP BY 1, 2, 3
HAVING COUNT(*) > 1
LIMIT 5;
-- Expect: 0 rows. If non-zero, migration failed silently — investigate before proceeding.
```

### Task B.3 — Smoke insert: prove per-colourway uniqueness works

```sql
-- Pick a real product with at least 2 colour swatches.
WITH p AS (
  SELECT pcs.product_id, pcs.id AS swatch_id, pcs.label
  FROM public.product_color_swatches pcs
  WHERE pcs.is_active = true
  ORDER BY pcs.product_id, pcs.position
  LIMIT 4
)
SELECT * FROM p;
-- Then manually insert two product_images rows with the same (product, view='left')
-- but different color_swatch_id and confirm both succeed.
-- Then attempt a third with the same color_swatch_id and confirm the constraint fires.
-- Roll back the test inserts.
```

---

## Phase C — API surface

### Task C.1 — POST `/api/products/[id]/images`

**File:** `src/app/api/products/[id]/images/route.ts`

- Add `color_swatch_id?: string | null` to the body type.
- Validate (if provided) that the swatch belongs to the product:
  ```ts
  const { data: swatch } = await admin
    .from('product_color_swatches')
    .select('id')
    .eq('id', body.color_swatch_id)
    .eq('product_id', productId)
    .maybeSingle()
  if (body.color_swatch_id && !swatch) return 400 'colour swatch does not belong to this product'
  ```
- Pass `color_swatch_id` through to the insert.
- Confirm the GET select list already returns `color_swatch_id`. (If not, add it.)

### Task C.2 — PATCH `/api/products/[id]/images/[imageId]`

**File:** `src/app/api/products/[id]/images/[imageId]/route.ts`

- Add `color_swatch_id` to the patchable fields (keep the whitelist explicit).
- Same swatch-belongs-to-product validation as C.1.

### Task C.3 — Type extensions

**Files:**
- `src/types/products.ts` — add `color_swatch_id: string | null` to `ImageRow`.
- `src/types/printAreas.ts` — add to `ProductImageRow`.

Verify: `tsc --noEmit` passes.

---

## Phase D — `ImagesTab` UI

**File:** `src/components/products/tabs/ImagesTab.tsx`

### Task D.1 — Replace hardcoded VIEWS with config-driven list

Today: `const VIEWS = [front/back/left/right]`.

Change: pull views from a shared constants file (or derive from `print_area_templates.view` distinct values fetched once on mount). Acceptable list: `front, back, left, right, hood, neck, sleeve, sleeve_left, sleeve_right`. Drop the artificial 4-item cap.

### Task D.2 — Add colour-swatch picker to upload form

Update the `draft` state shape:

```ts
const [draft, setDraft] = useState({
  file_url: '',
  view: 'front',
  alt_text: '',
  color_swatch_id: null as string | null,
})
```

Fetch the product's colour swatches once on mount (existing `product_color_swatches` API or a fresh `/api/products/[id]/swatches` lookup). Render a dropdown with the swatches + a "(no colour — default)" option that maps to `null`.

Pass `color_swatch_id` through `add()` and `uploadFile()` POST bodies.

### Task D.3 — Render images grouped by view, then by colour

Replace the flat list with a sectioned layout:

```
Front
  [no colour]   ▢ image  edit  delete
  Camel         ▢ image  edit  delete
  Black         ▢ image  edit  delete
Back
  [no colour]   ▢ image
…
```

Each row shows a small colour chip (hex from `product_color_swatches.hex`) next to the image thumbnail. The "make primary" / position-reorder controls stay per-row.

### Task D.4 — Composite labels

When showing a single image's metadata anywhere in the UI, format as `"<View> · <Colour>"` (e.g. "Left · Camel") if the image has a `color_swatch_id`, else just `"<View>"`. Centralise in a small helper to avoid drift.

Verify in browser: as staff, on a product with ≥2 colour swatches, upload two images for `view='left'` with different swatches. Both persist; both render in the grouped list.

---

## Phase E — `PrintAreasTab` UI

**File:** `src/components/products/tabs/PrintAreasTab.tsx`

### Task E.1 — Selection state shape

Change:

```ts
// before
const [selectedView, setSelectedView] = useState<'front'|'back'|'left'|'right'>('front')

// after
const [selection, setSelection] = useState<{
  view: string
  color_swatch_id: string | null
}>({ view: 'front', color_swatch_id: null })
```

### Task E.2 — Image lookup respects swatch

Replace:

```ts
const selectedImage = images.find((img) => (img.view || '').toLowerCase() === selectedView)
```

With:

```ts
const selectedImage = images.find(
  (img) =>
    (img.view || '').toLowerCase() === selection.view &&
    (img.color_swatch_id ?? null) === selection.color_swatch_id,
)
```

### Task E.3 — Colour-chip strip below view tabs

Render the available `(view, color_swatch_id)` combinations as a strip of chips below the view tabs. Each chip is the colour swatch + label. Click → updates `selection.color_swatch_id`.

When the selected view has only one image (the legacy null-swatch case), the strip is empty — print-area editing works exactly as before.

### Task E.4 — "Copy print areas from another colourway"

A small action above the print-area editor: dropdown of other available `(view, colour)` combinations on the same view, "Copy from →" button. On click: copy that image's `print_areas` jsonb into `draftAreas`, mark dirty, save flow stays the same.

This is the high-value action — most catalogue admins will draw rects once on the camel cap and want to reuse them on the black cap.

Verify in browser:
- On a product with two left-view images (camel + black), toggle between them via the colour chip strip → print areas swap.
- Edit the camel rects, save, switch to black, click "Copy from Camel · Left" → black rects update to match. Save. Switch back to camel — unchanged.

---

## Phase F — Smoke test (Camel Hat case)

### Task F.1 — Pick a real product

```sql
SELECT p.id, p.name, COUNT(DISTINCT pcs.id) AS swatch_count
FROM public.products p
JOIN public.product_color_swatches pcs ON pcs.product_id = p.id
WHERE pcs.is_active = true
GROUP BY p.id, p.name
HAVING COUNT(DISTINCT pcs.id) >= 3
LIMIT 5;
```

Pick one (e.g. an Access Canvas Cap with multiple colourways).

### Task F.2 — End-to-end

1. ImagesTab — upload 2 left-view images for 2 different colourways.
2. PrintAreasTab — confirm both images appear in the chip strip; draw print areas on each.
3. Refresh the page — selection state resets to defaults; both images + their print areas persist.
4. Hit `GET /api/products/[id]/images` — both rows in the response with distinct `color_swatch_id`.
5. Run the post-migration uniqueness check from Task B.2 — still 0 violating rows.

### Task F.3 — Regression check on a single-view product

Pick a product with no `color_swatch_id` on its images (the legacy case). Open ImagesTab + PrintAreasTab — confirm everything still works (chip strip is hidden/empty, print-area editing is identical to before).

---

## Verification commands (per phase)

| Phase | Command | Pass condition |
|---|---|---|
| A | grep results recorded | hit list documented or empty |
| B | post-migration GROUP BY check | 0 rows over 1 |
| B | smoke insert + uniqueness probe | 1st 2 succeed, 3rd dup fails |
| C | `tsc --noEmit` | pass both repos |
| D | upload 2 same-view different-swatch images | both persist, both render |
| E | colour chip strip toggle + copy action | rects swap + copy succeeds |
| F | end-to-end on real product | matches design spec acceptance criteria |

---

## Rollback

If anything breaks production:

```sql
DROP INDEX IF EXISTS public.idx_product_images_product_view_swatch_uniq;
CREATE UNIQUE INDEX idx_product_images_product_view
  ON public.product_images (product_id, view);
CREATE UNIQUE INDEX product_images_product_id_view_lower_uq
  ON public.product_images (product_id, view_lower);
```

This restores the prior constraint shape. UI changes can stay — they degrade to "you can pick a colour but only one image per view stays inserted-or-updated" (the unique would replace, which is the prior behaviour). Catalogue surfaces unaffected. Designer-driven decoration flow stays blocked.
