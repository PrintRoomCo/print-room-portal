# Per-Variant Product Views + Print Areas — Companion Design Spec

**Date:** 2026-05-06
**Repos:** `print-room-staff-portal`, Supabase `bthsxgmcnbvwwgvdveek`
**Status:** companion to [`2026-05-06-decoration-styles-design.md`](./2026-05-06-decoration-styles-design.md) — **prerequisite** for that spec's Phase 6 (designer-driven decoration flow).
**Standalone value:** also unblocks accurate per-colour mockups outside the B2B decoration flow (e.g. supplier-imported product images for hats with multiple colourways).

## Why

Suppliers ship products as a **single SKU with multiple colourways under one product row** — e.g. one "Camel Hat" master product with `product_color_swatches` rows for camel, black, navy, white, and `product_variants` rows tying colour × size. The supplier API gives us back a flat image list; we ingest those into `product_images` rows.

When staff sets **print areas** (the on-garment regions where decoration can land), today they're scoped to one image per `(product_id, view)` — so:

- The "left" view of a Camel Hat has *one* image (whichever colourway was first in the supplier feed).
- Print areas sit on that one image.
- A black-cap customer is shown the camel-cap image at decoration time. The mockup is wrong — and worse, the print-area rect drawn on the camel cap might not even line up with the seam-line on the black cap if the photo was framed differently.

Per Jamie 2026-05-06: *"we need to be able to assign the same view key to the same product (multiple left and multiple right) and have the view keys variable dependent ... so when print areas get set they can be for these variables."*

This blocks the designer-driven decoration flow in the [decoration-styles spec](./2026-05-06-decoration-styles-design.md) (Phase 6 of that plan), because the designer's whole point is to render the artwork onto **the right colourway** of the garment — and right now the schema and UI can't represent multiple colourways per view.

## Goal

Two coupled deliverables:

1. **Schema unlock** — drop the unique constraints that pin one image per `(product, view)`; replace with a constraint that allows multiple images per `(product, view)` as long as they have distinct `color_swatch_id`s. (The column already exists.)
2. **Staff-portal editor parity** — `ImagesTab` and `PrintAreasTab` learn how to disambiguate images by `(view, colour swatch)` instead of just `(view)`. Print areas naturally become per-(view, colour) because they already live on the image row (`product_images.print_areas` jsonb).

The view key string itself stays simple ("front", "back", "left", "right") — we do **not** rename to "left camel hat". The colour disambiguation comes from the FK to `product_color_swatches`, which carries the colour label. UI renders composite labels ("Left · Camel") at display time. This keeps the data model clean and matches `feedback_best_data_modelling.md`.

## Non-goals

- **No supplier-sync changes.** Whatever populates `product_images` from the supplier API keeps doing what it does. We just stop blocking it from inserting per-colourway images. (If the sync is currently de-duping on `(product, view)` and dropping rows, that's a sync-side fix tracked separately.)
- **No colour-swatch model rewrite.** `product_color_swatches` (8421 rows) and `product_variants` (variant table tying colour × size) are unchanged.
- **No designer-tool changes in this spec.** The designer integration that *consumes* per-variant print areas is in the decoration-styles spec.
- **No new view keys.** `front/back/left/right/hood/neck/etc.` stay as text values on `product_images.view`. We're only changing how many rows can share each view value.
- **No PDP-facing change.** The customer portal's PDP image gallery already iterates `product_images` by position; the only thing it might need is to *prefer* an image whose `color_swatch_id` matches the customer's selected colour swatch — which is a small follow-up, not in scope here.

## Why this stack (4-axis)

- **Rendering & data flow.** Staff portal is the only surface affected. Existing pages stay server-rendered (or whatever they are today — see file structure). New UI is client-side state extension to the existing tabs. No framework-level change.
- **Caching.** No CDN cache impact. Existing tabs fetch via REST API on mount; we just return more rows per view.
- **Performance.** `idx_product_images_product_view` (the unique index we're dropping) was also serving as a query index. We replace it with a non-unique `(product_id, view)` index + the new unique on `(product_id, view, color_swatch_id)`. Existing query patterns continue to use the index. Net cost: one extra column in the unique key. Negligible.
- **Ecommerce patterns.** N/A — this is staff tooling.

## Architecture

### Schema changes

```sql
-- Drop the constraints that block multi-image-per-view
DROP INDEX IF EXISTS public.idx_product_images_product_view;
DROP INDEX IF EXISTS public.product_images_product_id_view_lower_uq;

-- New: allow many images per (product, view) but no two with the same colour swatch
-- COALESCE handles "image with no colour swatch" (default/hero/marketing rows).
CREATE UNIQUE INDEX idx_product_images_product_view_swatch_uniq
  ON public.product_images (
    product_id,
    view,
    COALESCE(color_swatch_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- Keep a non-unique lookup index for "list all images for this (product, view)"
CREATE INDEX IF NOT EXISTS idx_product_images_product_view
  ON public.product_images (product_id, view);
```

`product_images.print_areas` (jsonb) already lives on the row, so per-(view, colour) print areas come for free once the per-row uniqueness is established.

### `image_type` distinction

The existing `image_type` check constraint already supports `'product' | 'marketing' | 'swatch'`. We continue treating `'swatch'` as the per-colour primary, and `'marketing'` rows are excluded from the print-area workflow (no constraint change needed; the UI just filters by `image_type='product'`).

### Staff-portal `ImagesTab` updates

`src/components/products/tabs/ImagesTab.tsx`:

- Hardcoded `VIEWS = front/back/left/right` extends to a config-driven list (front/back/left/right/hood/neck/sleeve/etc. — pick from a constants file or `print_area_templates.view`).
- Add a colour-swatch picker next to the view dropdown in the upload form. Source: existing `product_color_swatches` for the product, plus a "(no colour — default)" option that maps to `null`.
- Group the rendered images by view, then by colour swatch, with a colour chip next to each row. Composite label: "Left · Camel".

### Staff-portal `PrintAreasTab` updates

`src/components/products/tabs/PrintAreasTab.tsx`:

- Replace the `(typeof VIEWS)[number]` selectedView state with `{ view: string; color_swatch_id: string | null }`.
- Replace `images.find(view===selectedView)` with `images.find(img => img.view === sel.view && img.color_swatch_id === sel.color_swatch_id)`.
- Add a colour-chip strip below the view tabs. Each chip = a distinct `(view, color_swatch_id)` combination present on `images`. Click → load that image's `print_areas`.
- Persist a "copy print areas from another colourway" action — common case: staff already drew the rects on the camel cap, wants the same rects on the black cap (rect is colourway-independent for hats). One button: "Copy from Camel · Left → Black · Left".

### API route updates

- `GET /api/products/[id]/images` — already returns the rows; no shape change beyond verifying `color_swatch_id` is included in the JSON. (Quick code check during plan execution.)
- `POST /api/products/[id]/images` — accept `color_swatch_id` in the body; validate it FK-resolves to the product's swatches.
- `PATCH /api/products/[id]/images/[imageId]` — accept `color_swatch_id` (allow editing).

### `product_images.view_lower` column

The schema also has a generated-style `view_lower` column with its own unique index `(product_id, view_lower)`. Dropping the unique on `view` alone leaves the `view_lower` constraint blocking us. Migration drops both. (`view_lower` looks like a defensive lowercase shadow; we're not touching the column itself, just the unique-on-it.)

### Backfill

None. The existing 11,107 rows are already valid under the new constraint (every product-view pair currently has at most one image, so `COALESCE(color_swatch_id, sentinel)` is unique by construction). The new constraint passes a `CREATE UNIQUE INDEX` on existing data without violations.

We **don't** retro-tag existing images with `color_swatch_id` — staff edits as needed. Most products that don't carry per-colour images keep the `null` swatch and continue to work.

## File structure

### Modified

- `print-room-staff-portal/src/components/products/tabs/ImagesTab.tsx`
- `print-room-staff-portal/src/components/products/tabs/PrintAreasTab.tsx`
- `print-room-staff-portal/src/types/products.ts` — extend `ImageRow` shape (likely already has `color_swatch_id`; verify).
- `print-room-staff-portal/src/types/printAreas.ts` — extend `ProductImageRow`.
- `print-room-staff-portal/src/app/api/products/[id]/images/route.ts` — accept `color_swatch_id` on POST.
- `print-room-staff-portal/src/app/api/products/[id]/images/[imageId]/route.ts` — accept on PATCH.

### New

- (none — all changes are extensions of existing files)

### Migrations

- `20260506_per_variant_product_views.sql` — drops 2 unique indexes, creates 2 new indexes.

## Acceptance criteria

- A "Camel Hat" master product with `product_color_swatches` for camel + black can have:
  - Image 1: `view='left'`, `color_swatch_id=<camel>`, with print areas drawn for the camel left view.
  - Image 2: `view='left'`, `color_swatch_id=<black>`, with separate print areas drawn for the black left view.
- Both rows persist; both render in the new `ImagesTab` UI grouped under "Left".
- `PrintAreasTab` lets staff toggle between "Left · Camel" and "Left · Black" and edit each set of print areas independently.
- "Copy print areas from <other colour>" action duplicates rects to the target image.
- Existing products with one image per view continue to work with `color_swatch_id = null` rows.
- `tsc --noEmit` passes; no API consumer breaks (run staff-portal smoke + the supplier-sync's `INSERT … ON CONFLICT (product_id, view) DO UPDATE` if any — see open Q1).
- The decoration-styles Phase 6 designer launch passes `(catalogue_item_id, color_swatch_id)` and the designer can fetch the matching `product_images` row + its print areas via existing API.

## Open questions

1. **Supplier-sync behaviour.** Does `sync-jamesharvest-products` (or whichever sync writes to `product_images`) currently `INSERT ... ON CONFLICT (product_id, view) DO UPDATE`? If yes, that ON CONFLICT clause needs updating to the new `(product_id, view, color_swatch_id_or_sentinel)` constraint name. **Recommendation: grep before plan execution; if found, include the fix in the same migration commit.**
2. **`product_allowed_views_manual` / `product_allowed_views_override`.** Both have `(product_id, view)` as their PK (0 rows today, so blast radius is low). Do we extend these to `(product_id, view, color_swatch_id)` too, or leave them as "this product allows this view in general"? **Recommendation: leave them alone — "allowed views" is a product-level concern, not per-colour. Print areas are per-colour; allowed views are not.**
3. **`view_lower` column.** Is this column actively maintained by app code or a trigger? If a trigger, the trigger+index combo may be defensive lowercasing for case-insensitive uniqueness — dropping just the index leaves the column orphan-maintained. **Recommendation: check `pg_trigger` during plan execution; if no trigger and no app writer, drop the column too in a follow-up cleanup migration.**
4. **PDP image preference.** Should the customer portal PDP gallery prefer a `color_swatch_id`-matching image when the customer selects a colour? Today the PDP iterates by `position`. **Recommendation: out of scope here — but note for a follow-up `print-room-portal/components/shop/ProductImageGallery.tsx` change.**
