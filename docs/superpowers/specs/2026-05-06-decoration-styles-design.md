# Decoration Styles — Design Spec

**Date:** 2026-05-06
**Repos:** `print-room-portal`, `print-room-staff-portal`, Supabase project `bthsxgmcnbvwwgvdveek`
**Status:** draft (one-pager already with Jon)
**Supersedes (in part):** `project_decoration_pricing_per_method_artwork_open.md` open question

---

## Why

Today a B2B PDP renders a single line — *"Decoration available + $X / unit"* — driven by the catalogue item's owned `decoration_method` (text) and `decoration_price` (numeric) columns (forked into `b2b_catalogue_items` 2026-05-06, Plan 2a).

That model collapses three orthogonal facts into one row:

1. **What's being applied** — the artwork (logo file).
2. **Where it goes** — the position on the garment (Left Chest, Centre Back, Right Sleeve…).
3. **How it's applied** — the decoration method (embroidery, screenprint, DTF, supacolour, heatpress) and its price.

Real B2B customers buy uniforms with **multiple known decoration styles** — *"Embroidery left chest with our 2024 logo"* and *"DTF back print with the campaign mark"*. They want to pick one (or several) at line-item level on the PDP, see the visual outcome, and have the price reflect the choice. The current schema can't represent any of that.

Per the linked open memory: pricing must vary **by decoration method AND by artwork-per-org**, and decorations must be reusable across products (different garments, or same garment in different colours).

## Goal

Four coupled deliverables:

1. **Org-level Artwork Library** — staff (account managers) upload an org's logos once, into a first-class `organization_artworks` table. Reusable across catalogues, products, and re-orders. Not coupled to one-off designer-tool sessions.
2. **Reusable Decorations** — a named, priced bundle: *(artwork × decoration method × decoration location)*. **Method and price live on the decoration record, not on the catalogue item.** One decoration can be attached to many catalogue items.
3. **Two ways to apply a decoration to a catalogue item:**
   - **Manual** — staff picks decorations from the org's library on the catalogue editor row.
   - **Designer-driven** — staff launches the existing design tool with `(catalogue_item, decoration)` context. The tool positions the artwork on the garment, outputs a **snapshot image** that gets stored on the link record. The snapshot becomes the PDP swatch image (and feeds production artwork).
4. **Customer PDP Decoration Swatches** — replace the current "decoration available" line with a row of decoration swatches (visually styled like the existing colour swatches in [VariantPicker.tsx](../../../components/shop/VariantPicker.tsx)). Swatch image = the designer snapshot if present, falls back to the raw artwork thumbnail. Customer picks one (or none — see open Q1); price recalculates; decoration metadata flows into the cart line, the order, and the production data.

**Critically**, the staff catalogue editor row stops surfacing `decoration_method` and `decoration_price` (the columns added by Plan 2a 2026-05-06). Method and price are now derived from whatever decoration(s) are attached. The "Decoration method" and "Decoration price" columns in [`CatalogueItemsTable.tsx`](../../../../print-room-staff-portal/src/components/catalogues/CatalogueItemsTable.tsx) are removed and replaced with a "Decorations" column showing chips for each attached decoration.

## Non-goals

- **No designer-tool rewrite.** The existing design tool (per `project_proof_iframe_consolidation.md`, currently decoupled) is reused as a snapshot producer. We add: (a) a "configure decoration" launch point from the staff-portal that opens the tool with prefilled `(catalogue_item, decoration)` context, and (b) a snapshot-back POST. We do **not** rebuild the canvas, reposition logic, or constraint engine.
- **No customer-side designer use** in this scope. Only staff configures decorations via the designer; the customer just sees the resulting snapshot on the PDP swatch. (Self-serve customer designer flow remains a separate sub-app.)
- **No graphic-constraints engine.** `product_graphic_constraints` (max W/H/colors per product/method/area) stays unused. Decorations are AM-priced, not rule-engine-priced.
- **No pricing-engine refactor.** `effective_unit_price(product, org, qty)` keeps its current contract (returns garment unit price only). Decoration price stays a separate per-line addon, read from the *selected* `org_decorations.unit_price`. We do **not** extend the canonical pricing function to take a decoration parameter (per `project_b2b_pricing_canonical.md` — never call it directly, never overload its signature without a coordinated cross-repo cutover).
- **No retro of existing 3 PRT catalogue items as a hard migration.** Backfill auto-creates a one-off "Default decoration" `org_decoration` per row that already has `decoration_method`/`decoration_price` set — staff can edit/replace afterward via the new UI.
- **No customer-self-upload of artworks** in scope. Only staff writes to `organization_artworks` in Phase 1.

## Why this stack (4-axis)

Per `feedback_web_project_pre_plan_strategy.md`.

- **Rendering & data flow.** PDP stays an RSC `force-dynamic` page (auth-gated, per-org, fast-changing inventory). The new decoration list joins the existing `Promise.all` batch in [shop/[productId]/page.tsx](../../../app/(portal)/shop/[productId]/page.tsx) — one extra Postgres round-trip, server-side. Swatch UI is a Client Component so selection state lives next to qty/variant state in [ProductDetailClient.tsx](../../../components/shop/ProductDetailClient.tsx). CSR/SSG would be wrong: catalogues are per-org with auth — can't share a static asset.
- **Caching.** No CDN cache (force-dynamic, auth-gated). No new revalidate calls; the org's decoration set changes when staff edit it (writes through staff-portal API → next request reads fresh). Acceptable freshness: seconds. No `unstable_cache`.
- **Performance budget.** Adds 1 extra Supabase query (`b2b_catalogue_item_decorations` joined to `org_decorations` joined to `organization_artworks`) — runs in parallel with existing 5 — net +0 round-trips on the critical path. Image weight: each org typically has ≤5 logos; thumbnails served from Supabase Storage CDN. Hydration cost: swatch row is small static markup + click handler. LCP unaffected (PDP gallery image still wins).
- **Ecommerce pattern.** Variant pricing = "B2B rules engine" (existing brackets) + per-line add-on (decoration). Cart state is hybrid (zustand client store, server re-prices on submit per `lib/checkout/submit.ts`). Decoration carried on cart line as an immutable snapshot at add-time (decoration_id + price + artwork URL + position label) — same shape as existing `decorationPrice` field, just richer. Mirrors Shopify's "line-item properties" pattern.

## Architecture

### Three new tables + one new column (clean modelling per `feedback_best_data_modelling.md`)

We propose three new tables rather than overloading `b2b_catalogue_items` with array columns or JSONB blobs. The three concerns are genuinely orthogonal — artworks have their own lifecycle (upload, expire, replace), decorations have prices that need history/audit, and the catalogue-item ↔ decoration relationship is many-to-many (a decoration like "Acme Logo embroidery left chest" attaches to multiple garments).

```
organization_artworks                  -- "the org's logo library"
  id                  uuid pk
  organization_id     uuid fk → organizations(id)  on delete cascade
  name                text not null                 -- e.g. "Acme primary logo"
  storage_path        text not null                 -- bucket key in 'org-artworks'
  public_url          text not null
  mime_type           text
  file_size           integer
  sha256              text
  uploaded_by_user_id uuid                          -- staff_users(id), audit only
  is_active           boolean not null default true
  created_at          timestamptz not null default now()
  updated_at          timestamptz not null default now()
  unique (organization_id, sha256)                  -- de-dupe identical uploads

org_decorations                        -- "a named, priced way to apply an artwork"
  id                       uuid pk
  organization_id          uuid not null fk → organizations(id)  on delete cascade
  artwork_id               uuid not null fk → organization_artworks(id)  on delete restrict
  name                     text not null            -- e.g. "Embroidery — Left Chest"
  decoration_method        text not null            -- 'screenprint'|'embroidery'|'heatpress'|'supacolour'|'dtf'
  decoration_location_id   uuid     fk → decoration_locations(id)
                                                    -- nullable: legacy/free-form positions
  unit_price               numeric(10,2) not null   -- per-garment add-on price
  is_active                boolean not null default true
  sort_order               integer not null default 0
  created_at               timestamptz not null default now()
  updated_at               timestamptz not null default now()
  unique (organization_id, name)                    -- staff can't dup display names
  check (decoration_method in ('screenprint','embroidery','heatpress','supacolour','dtf'))

b2b_catalogue_item_decorations         -- "which decorations are offered on this product line"
  id                       uuid pk
  catalogue_item_id        uuid not null fk → b2b_catalogue_items(id)  on delete cascade
  org_decoration_id        uuid not null fk → org_decorations(id)      on delete restrict
  is_default               boolean not null default false   -- pre-selected on PDP (auto-checked in multi-pick)
  sort_order               integer not null default 0
  -- Designer-computed price override. Null = use org_decoration.unit_price.
  -- Populated when the designer tool computed a context-specific price (colour count, area, qty bracket).
  unit_price_override      numeric(10,2)
  -- Designer-tool snapshot. Populated when staff configured this decoration via the designer;
  -- null when applied manually (PDP swatch falls back to artwork thumbnail).
  snapshot_storage_path    text
  snapshot_url             text
  snapshot_color_swatch_id uuid fk → product_color_swatches(id)        -- which colour the snapshot was taken on
  created_at               timestamptz not null default now()
  unique (catalogue_item_id, org_decoration_id, snapshot_color_swatch_id)
```

The `snapshot_*` columns let the same decoration carry multiple per-colour snapshots on the same catalogue item: e.g. "Embroidery — Left Chest" with the artwork rendered onto the camel-coloured cap AND the black cap as separate link rows. PDP picks the snapshot whose `snapshot_color_swatch_id` matches the customer's selected colour, falling back to the next snapshot in `sort_order`, falling back to the raw artwork thumbnail.

### Why three tables, not one or two

- One table (everything denormed onto `b2b_catalogue_items`): can't reuse decorations across products. Re-uploads logo per garment. Doesn't model what Jamie wants.
- Two tables (skip `organization_artworks`, store storage_path on `org_decorations`): means re-uploading the same logo for every (method, position) pair. An org with 1 logo and 3 decorations would have 3 storage rows. Audit/replace flow gets ugly. Not clean per `feedback_best_data_modelling.md`.
- Three tables: each row is one fact. Replacing a logo is one update on `organization_artworks`. Adding a new decoration method is one insert on `org_decorations`. Wiring it to a product line is one insert on `b2b_catalogue_item_decorations`.

### Why a join table (not an array column on `b2b_catalogue_items`)

- Native FK integrity (deleting an `org_decoration` cascades obviously vs an array needing app-side cleanup).
- Per-link `is_default` and `sort_order` belong on the link, not the decoration (the same decoration may be pre-selected on shirt A but optional on hoodie B).
- Future: per-link price overrides, per-link availability windows, per-link min-qty. Trivial column adds vs JSONB schema dance.

### Existing `decoration_method` + `decoration_price` columns on `b2b_catalogue_items`

**Phase 1**: keep them. Backfill creates one `org_decoration` per existing row that has values, links it via `b2b_catalogue_item_decorations`, marks it `is_default=true`. New writes from staff editor stop populating them.

**Phase 2 (deferred, separate migration)**: drop both columns once portal + staff-portal + Postgres functions (`catalogue_unit_price`, `designer_submit_to_catalogue`) are off them. Tracked in plan as a follow-up gate.

### Pricing chain (does NOT touch canonical `effective_unit_price`)

Per `project_b2b_pricing_canonical.md`, **no app code may call `get_unit_price` directly**, and `effective_unit_price` is the single canonical garment-pricing entry point. Decoration is layered on top, not into.

- **Effective decoration unit price** = `COALESCE(b2b_catalogue_item_decorations.unit_price_override, org_decorations.unit_price)`. Computed on the server at PDP load and re-validated on submit.
- PDP server fetch: load decorations for the catalogue item (joined), pass to client. Each decoration option arrives with its already-resolved `unitPrice`.
- Client: customer **multi-picks** decorations on the swatch picker. State: `selectedDecorationIds: Set<string>`. `decorationPerUnit` in `computeOrderBreakdown(...)` = `sum(selected.map(d => d.unitPrice))`. If empty set → `decorationPerUnit = 0` (the no-decoration path is allowed, see Decision #1).
- Cart line snapshots an **array** at add-time: `decorations: [{ decorationId, name, method, positionLabel, unitPrice, artworkUrl, snapshotUrl? }, ...]`.
- `lib/checkout/submit.ts` re-validates each decoration in the array: re-reads by id, re-asserts org-ownership, re-asserts the link row still exists, re-resolves the effective price (override-or-default), compares to the snapshot. Drift on any decoration → structured error pinpointing which line/decoration changed.

### Visual reference for swatches

The new `DecorationSwatchPicker` mirrors [VariantPicker.tsx](../../../components/shop/VariantPicker.tsx) — round buttons, ring-on-selected. Three differences vs colour swatches:

- **Multi-pick** (per Decision #2). Selected swatches show a checkmark badge in the corner; unselected are dim. Click toggles. A trailing "None" pill clears the entire selection.
- Background = artwork thumbnail (40×40 from Supabase Storage) for manual-apply decorations, OR the designer snapshot if present (Phase 8). Not a solid hex.
- Below each swatch: small caption with method shorthand + position (e.g. "EMB · L. Chest"). Colour swatches don't have this; decorations need it because the artwork thumbnail is identical across method/position variants of the same logo.

Selection summary above the picker: "2 decorations selected · +$13.00 / unit" (sum across selected decorations).

### Staff editor surfaces

Two new sections in `print-room-staff-portal`:

1. **Org Artwork Library** at `/b2b-accounts/[orgId]/artworks` (or as a tab on the existing org page). Upload, list, replace, soft-delete. Storage bucket: `org-artworks` (new), staff-write-only RLS, public-read.
2. **Org Decorations** at `/b2b-accounts/[orgId]/decorations`. Create/edit decoration: pick artwork from library, pick method, pick location (free-form text or `decoration_locations` row), set unit price.
3. **Per-catalogue-item Decoration Picker** — new tab on `CatalogueEditor` (`tab='decorations'` next to `items|tiers|assignment|settings`), or inline expander on each row in `CatalogueItemsTable`. Multi-select decorations (filter to ones where `org_decorations.organization_id` = the catalogue's org), set `is_default`, set `sort_order`.

### RLS

- `organization_artworks`: SELECT for users in the org (`user_organizations.organization_id` = artwork's org); INSERT/UPDATE/DELETE staff-only via service-role admin client.
- `org_decorations`: SELECT for org members; staff-only writes.
- `b2b_catalogue_item_decorations`: SELECT inferred via `catalogue_item_id → b2b_catalogues.organization_id` join (mirror existing `b2b_catalogue_items` policy); staff-only writes.

### Storage bucket

New bucket `org-artworks` (public-read, ~5 MB max per file, image/* mimes). Path pattern: `{organization_id}/{artwork_id}-{slug}.{ext}`. Distinct from existing `design-artwork` bucket (designer-tool, per-design) and `quote-artwork` bucket (anon quote pipeline).

### Designer-tool integration (in scope this round)

| Surface | Source | Lifecycle | Org-attached? | Reusable? |
|---|---|---|---|---|
| `quote_artwork` | anon quote form | session | no | no |
| `design_artwork` | logged-in designer tool | per-design | yes (via `designs.org_id`) | no |
| `organization_artworks` (new) | staff upload | persistent | yes (direct FK) | yes |

**Two ways staff applies a decoration to a catalogue item:**

1. **Manual** — pick decorations from the org library on the catalogue editor row (chip-stack picker). No snapshot. PDP swatch shows the raw artwork thumbnail. Cheap, fast, no designer round-trip.
2. **Designer-driven** — staff clicks "Configure with designer" on a per-row decoration picker. The staff-portal opens the existing designer tool (separate sub-app) with prefilled context: `{ catalogue_item_id, org_decoration_id, product_id, color_swatch_id, return_url }`. Staff positions the artwork on the print-area template. On save, the designer:
   - Renders a snapshot (composited garment image + positioned artwork) and uploads it to Storage (bucket: `org-artworks`, path `{org_id}/snapshots/{link_id}-{color_swatch_id}.png`).
   - POSTs back to `/api/catalogues/[id]/items/[itemId]/decorations/[linkId]` with `{ snapshot_storage_path, snapshot_url, snapshot_color_swatch_id }`.

The designer-tool ↔ staff-portal handoff reuses the existing JWT pattern (or whichever auth bridge survives `project_proof_iframe_consolidation.md`). The `return_url` carries staff back to the catalogue editor with the snapshot already saved.

**Phase 9 — customer-side designer "Save to org library" CTA (in scope this round).** A button in the customer-side designer flow that copies the current `design_artwork` row into `organization_artworks` (server-side Storage copy from `design-artwork` bucket → `org-artworks` bucket, INSERT new row, sha256 dedup wins → returns existing row if logo already in library). Surfaces the new artwork in the org's library for the AM to subsequently turn into decorations. Lands after Phase 8 — orthogonal blast radius.

### Dependency: per-variant product views + print areas (companion spec)

The designer-driven flow above presupposes that print areas can be set per-(product × view × colour-variant). Today they can't:

- `product_images` has `color_swatch_id` (nullable, FK already exists), so per-colour images are storable.
- BUT a UNIQUE INDEX `idx_product_images_product_view` on `(product_id, view)` and a sister `(product_id, view_lower)` enforce one image per (product, view) — so you can't have a "left" image for camel AND a "left" image for black on the same product.
- Staff-portal `ImagesTab.tsx` hardcodes 4 views (front/back/left/right) with no colour picker; `PrintAreasTab.tsx` uses `images.find(view===…)` first-match — wouldn't disambiguate by colour.

This is a meaningful refactor of the master product editor and is **a hard prerequisite for the designer-driven decoration flow** (Phase 6 of the plan). It's tracked in a separate companion spec: [`2026-05-06-per-variant-product-views-design.md`](./2026-05-06-per-variant-product-views-design.md). The decoration-styles plan can ship Phases 0–5 (manual-apply path + PDP swatches with raw artwork thumbnails) **without** the companion plan landing, then unlock Phase 6 once it does.

### Print area templates

`print_area_templates` (12 rows, per `category × view`, jsonb `print_areas[]` with `key|name|shape.rect|maxSizeMm`) is the canonical garment-region definition. Not wired in Phase 1 — `org_decorations.decoration_location_id` references the simpler `decoration_locations` lookup (Left Chest, Centre Back, etc.) instead.

Phase 2 wiring (deferred): add nullable `org_decorations.print_area_key` text + `print_area_template_view text` to enable mockup rendering. Until that lands, position is text-labelled only.

## Data model summary table

| Table | Owns | Lifecycle | Multiplicity to catalogue line |
|---|---|---|---|
| `organization_artworks` | logo file pointer + metadata | created once, replaced rarely | n/a |
| `org_decorations` | name, method, location, price | created once per (artwork, method, position) bundle | n/a |
| `b2b_catalogue_item_decorations` | which decorations a line offers | edited per catalogue line | many-to-many |
| `b2b_catalogue_items` (existing) | the catalogue line itself | per-org, per-product | 1 |

## File structure

### `print-room-portal` — new files

- `app/(portal)/shop/[productId]/page.tsx` — modified, +1 query.
- `components/shop/DecorationSwatchPicker.tsx` — new client component.
- `lib/shop/decorations.ts` — new helpers (load, type defs).
- `lib/checkout/submit.ts` — modified, validate selected decoration on submit.
- `lib/cart/types.ts` — modified, extend `CartLine` with decoration metadata.
- `components/cart/CartLineRow.tsx` (or whichever surfaces a line in cart UI) — modified to display decoration thumbnail + label.
- `components/shop/ProductDetailClient.tsx` — modified, mount the picker, wire selection into `computeOrderBreakdown`.
- `app/api/shop/products/[id]/route.ts` — modified if the GET-product endpoint also needs decorations (check during plan).

### `print-room-staff-portal` — new files

- `src/app/(portal)/b2b-accounts/[orgId]/artworks/page.tsx` — new page (server) + Client artwork manager.
- `src/app/(portal)/b2b-accounts/[orgId]/decorations/page.tsx` — new page + Client manager.
- `src/components/b2b-accounts/ArtworkLibrary.tsx` — new.
- `src/components/b2b-accounts/ArtworkUploadDialog.tsx` — new.
- `src/components/b2b-accounts/DecorationsTable.tsx` — new.
- `src/components/b2b-accounts/DecorationFormDialog.tsx` — new.
- `src/components/catalogues/CatalogueItemDecorationsCell.tsx` — new (per-row picker on CatalogueItemsTable, with "Configure with designer" launch button).
- `src/app/api/orgs/[orgId]/artworks/route.ts` — new GET/POST.
- `src/app/api/orgs/[orgId]/artworks/[artworkId]/route.ts` — new PATCH/DELETE.
- `src/app/api/orgs/[orgId]/decorations/route.ts` — new GET/POST.
- `src/app/api/orgs/[orgId]/decorations/[decorationId]/route.ts` — new PATCH/DELETE.
- `src/app/api/catalogues/[id]/items/[itemId]/decorations/route.ts` — new GET/POST/DELETE for the link table.
- `src/app/api/catalogues/[id]/items/[itemId]/decorations/[linkId]/route.ts` — new PATCH (snapshot upsert) / DELETE.
- `src/app/api/designer/snapshot-callback/route.ts` — new POST endpoint the designer tool calls back to with `{ link_id, snapshot_storage_path, snapshot_url, snapshot_color_swatch_id }`.
- `src/lib/designer/launch.ts` — new helper that builds the designer launch URL with prefilled context + signed return token.
- `src/components/catalogues/CatalogueEditor.tsx` — modified, wire the new cell into items table.
- `src/components/catalogues/CatalogueItemsTable.tsx` — **modified, REMOVE the "Decoration method" and "Decoration price" columns**, ADD a "Decorations" column rendering `<CatalogueItemDecorationsCell />` (chip-stack of attached decorations + Manage button). Method/price are now derived facts, not editable cells.

### Supabase — new migrations (one per logical change)

1. `20260506_create_organization_artworks.sql`
2. `20260506_create_org_decorations.sql`
3. `20260506_create_b2b_catalogue_item_decorations.sql` (includes `snapshot_*` columns from day one)
4. `20260506_storage_bucket_org_artworks.sql` (bucket + policy)
5. `20260506_backfill_decorations_from_existing_catalogue_items.sql`
6. `20260507_drop_decoration_columns_from_b2b_catalogue_items.sql` — **deferred** to a follow-up commit, ships only after the staff editor stops surfacing the columns AND all 3 callers (customer portal PDP fallback, staff-portal API GET shape, 2 Postgres functions `catalogue_unit_price` + `designer_submit_to_catalogue`) have moved off them. Listed in the plan as a separate gate.

## Acceptance criteria

- Staff opens `/b2b-accounts/<PRT-org-id>/artworks`, uploads a 1 MB PNG → row appears in `organization_artworks`, file in `org-artworks` bucket, public_url renders.
- Staff opens `/b2b-accounts/<PRT-org-id>/decorations`, creates *"Embroidery — Left Chest"* using the uploaded artwork → row appears in `org_decorations` with `unit_price=8.00`.
- Staff opens an existing PRT catalogue item, attaches the decoration via the new picker → row appears in `b2b_catalogue_item_decorations` with `is_default=true`.
- Customer (signed in to PRT) opens `/shop/<productId>` → swatches render: artwork thumbnail + caption "EMB · L. Chest". The decoration is pre-selected.
- Customer changes qty → price updates: `unit_price × qty + decoration.unit_price × qty`. Matches existing `PriceBreakdown`.
- Customer adds to cart → cart line carries `{decorationId, decorationName, artworkUrl, decorationUnitPrice, positionLabel}`. Cart UI shows the decoration thumbnail next to the variant label.
- Customer submits checkout → `lib/checkout/submit.ts` re-reads the decoration, re-validates ownership + attachment + price within tolerance, persists to the order. Drift > tolerance fails the submit with a clear error.
- Existing 3 PRT catalogue items still render with their pre-existing decoration (now sourced via the link table from a backfilled `org_decoration`). No regressions on price.
- `tsc --noEmit` passes both repos.
- RLS smoke test: anon role gets nothing from the three new tables; authenticated user from a *different* org gets nothing for PRT's rows.

## Decisions (Jon-signed-off 2026-05-06)

1. **No-decoration path allowed.** Most catalogue items will have a decoration, but the swatch row carries a "None" option. Cart line's decoration array is allowed to be empty. Default decoration pre-selected when a catalogue item has any.
2. **Multi-decoration per garment.** A single cart line can carry one *or more* decorations on the same garment (e.g. embroidery left chest + DTF back). PDP swatch picker is **multi-pick**. Cart line carries an array of decoration snapshots. Total per-unit decoration price = `sum(decoration.unitPrice)` over selected decorations.
3. **Decoration prices computed by designer; can be org-specific.** Two layers:
   - `org_decorations.unit_price` = default for the (artwork, method, position) bundle at the org level. Used for manual-apply (Phase 5) and as a fallback.
   - `b2b_catalogue_item_decorations.unit_price_override` = per-link override (NEW column). The designer tool writes here when it computes a context-specific price (colour count, area size, qty bracket etc.). Effective price = `COALESCE(link.unit_price_override, org_decoration.unit_price)`. Org-specificity is already implicit because `org_decorations` is per-org.
4. **No backfill placeholder artwork.** Drop migration 5. Existing 3 PRT catalogue items lose their derived decoration display when the staff editor stops surfacing the columns; their `decoration_method`/`decoration_price` data stays in the DB until Phase 7 drops it. Staff sets up real decorations via the new flow when ready. The "no decoration path allowed" decision (#1) means PDP still renders cleanly in the meantime — just without a decoration swatch row.
5. **Designer-tool "Save to org library" in scope.** Customer-side designer (currently uploads to `design_artwork` per-design, ephemeral) gets a "Save to organisation library" CTA that copies the file into `organization_artworks` (server-side Storage copy + INSERT, sha256 dedup wins). This is **Phase 9** — orthogonal to the staff designer-driven flow, lands after Phase 8.
