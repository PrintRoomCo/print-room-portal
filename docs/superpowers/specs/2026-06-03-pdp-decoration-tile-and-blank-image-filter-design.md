# Customer PDP — decoration tile + blank-image filter (Design)

- **Date:** 2026-06-03
- **Status:** Approved design (grilled against the live PDP), ready for implementation planning — one definitional open question (§11)
- **Repo:** `print-room-portal`
- **Related:** [Spec B — manual item pricing](../../../../print-room-staff-portal/docs/superpowers/specs/2026-06-03-manual-item-pricing-mode-design.md) (a `manual_final` item shows the decoration tile but adds no decoration price — the tile is display-only, so the two specs compose cleanly)

---

## 1. Problem

On the customer product page, the decoration the customer is actually buying is **invisible or unclear**, and the gallery is cluttered with blank garment shots. Specifically:

- **Decoration "doesn't show."** The only place decoration appears today is as a **live overlay baked onto the hero image** ([`ProductImageGallery.tsx:75-81,133-158`](../../../components/shop/ProductImageGallery.tsx#L75-L158)) — and only for non-`designer_snapshot` images with a complete print-area + placement. When those conditions aren't met (or the snapshot is trusted as-is), the customer sees a plain garment with no visible logo. There is no explicit "here is your decoration" surface.
- **Blank product images clutter the carousel.** The gallery falls back to generic master base images (the plain, often-wrong-colour garment template) even when a colour has real photos. `imagePriority` already drops non-primary master detail shots, but **primary-view master base images (`scope:'master'`, `color_swatch_id == null`, view ∈ hero/front/…) still render at priority 5** ([`catalogue-images.ts:147-150`](../../../lib/shop/catalogue-images.ts#L147-L150)) — those are the "blank product images" Chris/Jamie want gone.

## 2. Goal

1. A **dedicated decoration tile under the main carousel** that shows, for the selected colour, the decoration(s) on this product — the designer mockup when present, else the artwork — with its name + position.
2. **Filter blank product images** out of the gallery so customers see real product photos / decorated views, not generic blank templates.

## 3. Non-goals (this spec)

- **No** pricing change. The tile is display-only; decoration pricing continues to flow through `ProductDetailClient`'s existing logic (and is suppressed for `manual_final` items per Spec B).
- **No** change to the decoration data layer (`loadCatalogueItemDecorations` / `DecorationOption`) — the tile consumes what's already loaded.
- **No** removal of the live hero overlay (it stays as the on-garment preview); the tile is **additive** (§4 D3).
- **No** change to swatch/colour selection — the tile reacts to the existing `selectedColorSwatchId`.

## 4. Locked decisions (from grill)

| # | Decision | Rationale |
| --- | --- | --- |
| D1 | **New `DecorationTile` under the gallery**, fed by the already-computed `swatchVisibleDecorations` (the selected colour's published decorations). Per decoration: image = `snapshotUrl` › `artworkUrl`; caption = `name` + `positionLabel`. | The data is already loaded + swatch-filtered in `ProductDetailClient`; the tile is pure presentation. |
| D2 | **Blank-image filter = drop primary-view master base images (`scope:'master'`, `color_swatch_id == null`) from the gallery when the selected colour has ≥1 colour-specific image.** Never filter the gallery to empty — if a colour has no other image, the master base stays as last-resort. | Targets exactly the priority-5 fallback that produces blank/wrong-colour shots, without ever leaving a blank PDP. |
| D3 | **Keep the live hero overlay** ([`ProductImageGallery`](../../../components/shop/ProductImageGallery.tsx)) **as-is**; the tile is additive, not a replacement. | The overlay is colour-correct and already handles the snapshot-vs-live distinction; the tile adds an explicit, always-visible decoration surface alongside it. |
| D4 | **All-colour decorations (`snapshotColorSwatchId == null`) show on the tile for every colour.** | Matches the existing `filterDecorationsBySwatch` semantics — a brand logo applied to all colours should always appear. |

## 5. Data (existing — consumed, not changed)

- **Gallery images:** `CatalogueAwareGalleryImage[]` → `resolveGalleryImagesForColour` / `imagePriority` ([`lib/shop/catalogue-images.ts`](../../../lib/shop/catalogue-images.ts)). Priority ladder today: catalogue snapshot (1) › catalogue staff_upload (2) › catalogue color-null (3) › master colour-matched (4) › **master color-null primary-view (5)** › dropped (null). D2 adds a rule at the (5) rung.
- **Decorations:** `DecorationOption[]` from `loadCatalogueItemDecorations` ([`lib/shop/decorations.ts`](../../../lib/shop/decorations.ts)) — already `is_published`-gated; carries `snapshotUrl`, `artworkUrl`, `name`, `positionLabel`, `method`, `snapshotColorSwatchId`. In `ProductDetailClient`, `swatchVisibleDecorations = filterDecorationsBySwatch(decorations, colorSwatchId)` is already computed.

## 6. Surfaces

### 6.1 Decoration tile (D1)

- **New** `components/shop/DecorationTile.tsx`: props `{ decorations: DecorationOption[]; productName: string }`. Renders one image card per decoration (`snapshotUrl ?? artworkUrl`, `object-contain`, oem rounded card) with `name` + `positionLabel` caption; empty array → render nothing (no empty box). Presentational, no fetching. Follow `docs/ui` / oem card conventions (rounded, bordered, `aspect-square`/contained image like the gallery hero).
- [`components/shop/ProductDetailClient.tsx`](../../../components/shop/ProductDetailClient.tsx): mount `<DecorationTile decorations={swatchVisibleDecorations} productName={…} />` directly **under** `<ProductImageGallery>` in the media column. `swatchVisibleDecorations` already exists (~L453-455) — no new state.

### 6.2 Blank-image filter (D2)

- [`lib/shop/catalogue-images.ts`](../../../lib/shop/catalogue-images.ts): in `resolveGalleryImagesForColour`, after building `chosenByView`, drop entries that are `scope:'master' && color_swatch_id == null` (priority-5 base) **iff** at least one retained entry is colour-specific (`color_swatch_id === selectedColorSwatchId`, or a catalogue-scope image). Guard: if dropping would empty the result, keep them. Implement as a post-pass over the map's values (cheap, pure) so `imagePriority`'s ladder is untouched.
- Unit-tested as a pure function (it already is testable in isolation).

## 7. Data flow

1. `ProductDetailClient` loads `images` + `decorations` (server) and tracks `colorSwatchId`.
2. Gallery: `resolveGalleryImagesForColour(images, colorSwatchId)` → now blank-filtered (D2) → hero + thumbnails (+ existing overlay, D3).
3. Tile: `swatchVisibleDecorations` (already filtered, D4) → `<DecorationTile>` under the gallery → image (snapshot › artwork) + caption per decoration.
4. Colour change → both the gallery hero and the tile re-resolve for the new swatch.

## 8. Risk

- **"Blank" over-reach.** D2 must never empty the gallery (the keep-if-would-empty guard) and must not drop a colour-matched master image (priority 4) — only the color-null base (priority 5). Test both.
- **Definitional risk (§11):** if "blank product images" means something else (a literal placeholder URL, or undecorated-vs-decorated), D2's rule needs adjusting. Recommended definition is grounded in the priority ladder; confirm before building.
- **Tile vs overlay redundancy:** with D3 keeping the overlay, a decorated snapshot could appear both as the hero (baked) and in the tile. Acceptable (the tile is the explicit, labelled surface); revisit only if it reads as duplication.
- **Colour leakage:** the tile must honour `filterDecorationsBySwatch` so a White-only logo doesn't show on Black (D4 handles the all-colour case).

## 9. Testing

- **Filter:** a colour with a catalogue/colour-specific image → master color-null base excluded from `resolveGalleryImagesForColour`; a colour with **only** a master base → base retained (no empty gallery); a master colour-matched image (priority 4) is never dropped.
- **Tile:** renders one card per `swatchVisibleDecorations` entry (snapshot when present, else artwork) with name + position; empty → renders nothing; switching swatch swaps the decorations; an all-colour decoration shows on every swatch.
- **Compose with Spec B:** a `manual_final` item still shows the tile (display) while its line total adds no decoration price.
- **Regression:** existing gallery hero/thumbnail/overlay behaviour unchanged for items with real per-colour images.

## 10. Build order

1. `DecorationTile` component + mount in `ProductDetailClient` (visible win; no data changes).
2. Blank-image filter in `catalogue-images.ts` (after §11 is confirmed) + unit tests.

## 11. "Blank product image" — RESOLVED (2026-06-03)

A "blank product image" **is the master-scope, `color_swatch_id == null`, primary-view base image** shown as fallback when a colour has real photos (the priority-5 rung). Confirmed by Jamie 2026-06-03. D2 targets exactly that rung — it does **not** mean a literal placeholder URL, and it does **not** mean "hide all undecorated garment shots" (that would hide real product photos). The §4-D2 rule stands; the never-empty guard remains the safety net.
