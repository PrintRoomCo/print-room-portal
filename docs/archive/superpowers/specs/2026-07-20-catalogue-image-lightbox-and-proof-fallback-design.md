# Catalogue image handling — lightbox, proof-crop fallback image, artwork-column questions — design

**Date:** 2026-07-20 (evidence re-verified against live code + DB 2026-07-25)
**Repos:** `print-room-portal` (customer, branch `main`) and `print-room-staff-portal` (staff, branch `master`) — one shared Supabase project (`bthsxgmcnbvwwgvdveek`).
**Origin:** Chris (Slack, 2026-07-20), three related image asks:
1. Click-to-enlarge images ("landscape images scale down instead of cropping" — the scale-down half already works; the enlarge half does not exist).
2. Use the onboarding "proof PNG" as the catalogue image so Regie stops hand-making web images.
3. Pull the proof image "straight through to the artwork column that is used to create the production proof." **Blocked** pending a walkthrough with Chris — questions only in this doc, no design.

## Summary / recommendation

Three independently shippable pieces, in this order:

- **Phase 1 — Lightbox + proof-card crop fix.** Portal-only, no DB, no cross-repo coupling. Small and self-contained. **Ship immediately.**
- **Phase 2 — Proof-crop fallback catalogue image.** Staff-repo-primary; reuses the existing `designer_snapshot` image source so it needs **no schema migration and no customer-repo change**. Larger than it first looks because the real onboarding artifact is a production-proof *document*, not a clean product shot — so it requires a human crop step. Ship after Phase 1.
- **Ask 3 — artwork-column pull-through.** Structurally circular and touches the production print path. **Do not build.** Question list for the walkthrough is at the end.

---

## Problem 1 — no click-to-enlarge (Ask 1)

### Evidence (current code)

- **Scale-down already works.** Grid tile `components/shop/ProductCard.tsx:45,51` — `object-contain` inside `aspect-square`. PDP main image `components/shop/ProductImageGallery.tsx:207,217` — `object-contain p-6` inside `aspect-square`. Landscape images letterbox; they do not crop. Chris's stated symptom is already handled.
- **The one real crop:** `components/proofs/ProofArchiveCard.tsx:14,19` — a 4:3 tile with `object-cover` on `proof.mockupUrl`. This crops.
- **No enlarge anywhere.** Grep for `lightbox|Lightbox|zoom|enlarge` across the portal returns only Tailwind animation utilities. No dependency, no component. `@radix-ui/react-dialog@^1.1.15` is already a dependency, used directly (no shared wrapper) in `components/cart/CartDrawer.tsx`, `RequestReorderModal.tsx`, and `my-collections/[collectionId]/page.tsx` among others.

### Root cause

Enlarge was simply never built. The scale-vs-crop confusion in Chris's message is because the *proof archive card* (the one `object-cover`) is the surface he was looking at.

### Design — one shared lightbox, wired to four surfaces

A single new component `components/media/ImageLightbox.tsx` (portal), built on `@radix-ui/react-dialog` (following the `CartDrawer.tsx` composition, since there is no shared modal wrapper to reuse). Radix gives focus-trap, `Escape`-to-close, and focus-restore-on-close for free — exactly the a11y guarantees a lightbox needs and the ones the existing gallery keyboard test does not yet cover.

**Contract (deep, small surface):**

```
ImageLightbox({
  open, onOpenChange,
  images: LightboxImage[],   // { url, alt, overlays?: GalleryOverlay[] }
  index, onIndexChange,      // controlled active image
})
```

The caller owns which images and the active index; the component owns presentation, keyboard, focus, and mobile gestures. This keeps every surface's own selection logic intact and lets the PDP pass its overlay data through unchanged.

**Surfaces wired (all four, per decision):**

| Surface | File | Trigger |
|---|---|---|
| Shop grid tile | `components/shop/ProductCard.tsx` | click/Enter on the image |
| PDP main gallery | `components/shop/ProductImageGallery.tsx` | click/Enter on the active image |
| Proof archive card | `components/proofs/ProofArchiveCard.tsx` | click/Enter on the mockup |
| My-collections design tiles + line items | `app/(portal)/my-collections/[collectionId]/page.tsx` (604/606, 776/779, 987/990) | click/Enter on the tile |

**PDP overlay gotcha (must-not-regress):** the PDP renders artwork overlays as absolutely-positioned `<img>`s using normalized `rect`×`placement` percentages (`ProductImageGallery.tsx:222–247`), and it *deliberately suppresses* them when the active image `source === 'designer_snapshot'` (decorations already baked into the render — comment at 156–158; `activeOverlays` gate at 159–165). The enlarged view **must** re-render the same overlays with the **same suppression rule**, or an enlarged garment loses its print (a regression). The `LightboxImage.overlays` field carries exactly the `GalleryOverlay[]` the gallery already computes; the lightbox re-applies the percentage math at the enlarged size (percentages are resolution-independent, so the same numbers work).

**A11y — match the standard the repo already sets.** `components/shop/__tests__/ProductImageGallery.keyboard.test.tsx` enforces a roving-tabindex tablist: `ArrowLeft/Right`, `Home`, `End`, `toHaveFocus()` assertions, and role-based accessible names on every interactive image. The lightbox adds (via Radix) a focus trap, `Escape`, and focus restore. Within the lightbox, `ArrowLeft/Right` step `index` (wrapping, as the gallery tablist does), the trigger has an accessible name ("Enlarge image"), and the dialog has a `Dialog.Title`. New tests mirror the existing file's structure.

**Mobile:** native pinch-zoom (viewport `<img>` inside a scrollable container, `touch-action: pinch-zoom`), tap-outside / `Escape` / close-button to dismiss. No custom pan/zoom JS in v1 — the browser's pinch is enough and keeps the component small.

**Proof-card crop fix (bundled here):** `ProofArchiveCard.tsx:19` `object-cover` → `object-contain` so the (square, 1200×1200) mockup letterboxes in the 4:3 tile instead of cropping, consistent with grid and PDP. One-line change, shipped with the lightbox that now makes that card clickable.

**Repo ownership / deploy order:** portal only. No DB, no staff-repo change, no ordering constraint. Ships alone.

---

## Problem 2 — Regie hand-makes catalogue images during onboarding (Ask 2)

### Evidence (live DB + code + the real Monday artifact, 2026-07-25)

- **The gap is real and measurable.** 47 active `b2b_catalogue_items`; **18 (38%) have zero published images**. Only 16 have an explicit `card_image_id`. These 18 fall back to the master `product_images` derive or a placeholder.
- **Catalogue images** live in `b2b_catalogue_item_images` (`source`, `view`, `color_swatch_id` NULL = all-colours, `is_published`, `position`, FK-cascade to the item). The card/hero image is chosen by `deriveCardImageUrl` — **duplicated byte-identically in both repos** (`print-room-staff-portal/src/lib/catalogues/card-image.ts:108–130`, `print-room-portal/lib/shop/catalogue-images.ts:46–66`) and locked by a shared test vector (`catalogue-images-derive.vector.test.ts`). The customer grid's `pickCatalogueCardThumbnail` order is **explicit `card_image_id` → `designer_snapshot` mockup → plain-garment derive** — i.e. a rendered mockup already outranks the plain garment.
- **The `source` CHECK** = `staff_upload | designer_snapshot | shopify_port | staff_pick` (live `pg_constraint`). A *new* source value would need a migration **plus** lockstep updates to `deriveCardImageUrl` + the shared vector + `imagePriority`/`sourceRank` rankers **in both repos**.
- **The fragile healer is out of scope's blast radius.** `heal_image_view_invariants()` (hourly cron `front-invariant-healer`, plus statement trigger `tg_enforce_front_per_group`) enforces "every `(product_id, color_swatch_id)` group has a `front` view" — but **only on the master `product_images` table**, not on `b2b_catalogue_item_images`. Phase 2 writes only to the per-org catalogue table, which the healer never touches.
- **Two artifacts are both called "proof."** (a) A clean **1200×1200 square mockup PNG**, white background, no annotations (`renderFabricSnapshotBlob`, staff repo) — shop-safe. (b) The **Allpress production PDF** (`allpress-pdf.ts`) — A4 landscape, signatures/T&Cs/dimensions/pantones — disqualifying.
- **But the onboarding artifact is neither of those clean mockups.** The `design_proofs` builder table is **empty (0 rows)** — never used in prod. For Illustrator/Canva-onboarded orgs, the only asset that exists is a **rasterised proof document manually exported to Monday.** Verified on a real item (Production board `1992701981`, item `2654115326` "Brick and Crust", group Pre-production):
  - **Artwork column `file_mkpesta8` (title "Artwork")** holds **four PNGs**, each **3508×2481 (A4-landscape @ 300dpi)**, named `..._11/_12/_21/_22.png`, uploaded by Kenneth 2026-04-14. Inspected directly: each is a **"FINAL PROOF — DESIGN n" page** — blue header, "Client: BRICK AND CRUST", FRONT/BACK labels, **dimension callouts (85mm/95mm with red measure-lines)**, per-print-area **METHOD: SUPACOLOUR HEAT PRESS / DIMENSIONS / COLOURS** spec bands, and an **"IMPORTANT!!! PLEASE CHECK THAT YOUR ORDER HAS BEEN DELIVERED IN FULL"** footer.
  - **Proof column `file_mkqjp7kh` (title "Proof 🟢")** holds the assembled **PDF** (`Brick and Crust_proof_14 Apr 2026.pdf`).

### Root cause

Chris's framing ("use the proof PNG, it doesn't look as good but it works") assumes the proof PNG is a garment render. **It is a production-proof document.** Putting it whole on the shop grid would show customers a spec sheet with print dimensions and a delivery-error warning — worse than a missing image. The *garment renders inside* the proof are clean and shop-worthy, but each proof page composites two garments plus text on a fixed A4 layout, so extracting one requires a **crop**.

### Decisions (locked with Jon, 2026-07)

1. **Fallback, not replacement.** If no hand-made web image exists, derive the catalogue image from the proof; a later `staff_upload` (or explicit `card_image_id`) always wins. This unblocks onboarding without permanently locking the catalogue to the worse asset. Rationale: the worse asset should never override a real one, and onboarding should stop *blocking* on image creation — both satisfied by "fill only the gap."
2. **Crop a garment (human-in-the-loop).** The whole proof page is disqualifying; the only viable path for the real artifact is a staff crop of one garment region. This also neutralises layout fragility — no assumption that the proof template is machine-parseable (these are hand-exported, and predate the portal's own PDF renderer).
3. **Reuse the `designer_snapshot` source.** No CHECK migration, no ranker/vector churn, and it inherits the two behaviours we want for free: the customer grid already prefers a `designer_snapshot` mockup over the plain garment, and the PDP already suppresses artwork overlays on `designer_snapshot` images (correct — the crop already shows the print on the garment). Trade-off accepted: provenance blurs (a proof-crop is indistinguishable from a designer-tool snapshot in the `source` column). If provenance ever matters, revisit with a dedicated source value.
4. **One-click, staff-initiated, reversible.** No silent auto-writer or cron in the catalogue-image area (which has a history of fragility). Staff trigger it per item, preview the crop, and can delete the row to revert to the master derive.

### Design — "Import web image from proof" (staff repo)

A new control on the staff catalogue-item image surface (`src/components/catalogues/AddProductImageModal.tsx`, opened from `.../items/[itemId]/setup/page.tsx` and `.../[itemId]/page.tsx`):

1. **Provide the source image.** Staff either (a) pastes a Monday asset URL / drops the downloaded proof PNG, or (b) picks from the org's Monday proof assets. **Mapping note:** there is no reliable automatic Monday-item→catalogue-item key (Monday items are production/deal rows; catalogue items are `b2b_catalogue_items`), so the staff member resolves the mapping by choosing the file. That is acceptable precisely because this is a one-click, per-item action — the human is the join.
2. **Crop.** A client-side cropper (e.g. `react-easy-crop`; final lib chosen at build time) lets staff draw a box around a single garment render and confirm. Output is a cropped raster (square-ish garment on white → letterboxes cleanly in the square tile; the surrounding A4 whitespace and all proof chrome are excluded by the crop).
3. **Save through the existing path.** The cropped image is posted as an inline data-URL to the existing staff images API `POST /api/catalogues/[id]/items/[itemId]/images/route.ts` (which already accepts data-URLs and uploads to the `org-artworks` bucket via `uploadCatalogueItemImage`), with `source='designer_snapshot'`, `is_published=true`, and staff-chosen `view` (front/back) and `color_swatch_id` (all-colours or a specific swatch).
4. **Precedence & reversal.** A `staff_upload` image or an explicit `card_image_id` always outranks it (existing `pickCatalogueCardThumbnail` / `deriveCardImageUrl` order). Deleting the row reverts to the master derive (`ON DELETE SET NULL` on `card_image_id` if it had been picked).

**Why this needs no customer-repo change:** because it writes a `designer_snapshot`/`is_published=true` row, the customer read paths already surface it — grid via `pickCatalogueCardThumbnail`, PDP via `resolveGalleryImagesForColour` (`imagePriority` ranks catalogue snapshot highest) with overlays correctly suppressed. Nothing on the customer side special-cases proof-crops, so nothing on the customer side changes.

**Repo ownership / deploy order:** staff repo only (UI + optional Monday-asset fetch helper + `source` value on write). **No customer deploy, no schema migration, no deploy-ordering constraint.** This is the payoff of reusing `designer_snapshot` — the shared-DB deploy-order coupling that has bitten these repos before does not apply here.

**Build-time confirmations (not blockers):** exact source column is verified (`file_mkpesta8` "Artwork"); remaining choices are the crop library and whether to add a small staff-side Monday-asset proxy vs. drag-drop upload.

---

## Ask 3 — proof image → artwork column — BLOCKED (questions only)

**Do not design.** Findings that frame the walkthrough:

- **Direction of flow is `artwork → mockup → proof`.** The proof consumes both the mockup and the source artwork (`allpress-pdf.ts`), and `design_proofs.source_catalogue_item_ids` confirms proofs are built *from* catalogue items. So "proof → artwork column" is **circular** — feeding a derived, garment-composited RGB render back into the slot meant to hold the source print asset.
- **The "artwork column" is Monday File column `file_mkpesta8` ("Artwork")** on Production board `1992701981`. The portals **only read** it (`lib/monday/subitems.ts:210–222`, proxied via `/api/monday-asset`); the only File column either portal **writes** is the *proof* column `file_mkqjp7kh`. Nobody writes `file_mkpesta8` from code — it is populated by hand.
- **Confusingly, that column currently holds rasterised proof pages** (Kenneth's exports), not source print files — so what the column is *for* vs. what it *contains* is already unclear.
- **No print-grade asset exists anywhere in code.** Source artwork is browser-grade RGB (PNG/JPG/SVG, ≤10 MB); the nearest to print-ready is an RGB `vector_svg` variant (`organization_artwork_variants`). No CMYK, no separations, no high-DPI TIFF/EPS.

**Load-bearing risk to establish:** if `file_mkpesta8` is the file **production actually prints from**, then routing a browser-sized RGB proof-crop into it is a production hazard (wrong resolution, wrong colour space, no separations). If it is a **reference thumbnail only**, it is harmless. This determines whether Ask 3 is safe at all.

**Questions for Chris's walkthrough:**
1. When you say "the artwork column that is used to create the production proof," do you mean `file_mkpesta8` ("Artwork") on board 1992701981 — and is that the file production prints from, or a reference/thumbnail?
2. What *should* live in that column — source print files, or the proof pages it currently holds? (It today holds rasterised proof documents, which suggests the column's purpose has drifted.)
3. Which direction do you actually want: proof/onboarding image **into** the artwork column (so production reuses it), or the artwork **out** to the shop? These are different features with different risk.
4. Does production ever consume anything from these repos as print art, or is the real print file always sourced outside them (Illustrator originals, supplier files)?
5. If the intent is "reuse one canonical source asset for both web image and production proof," where should that canonical asset live and who owns writing it — the portal, Monday, or the designer tool?

---

## Phasing & recommended order

1. **Phase 1 — Lightbox + proof-card crop fix.** Portal-only, no DB, no coupling. Ship first.
2. **Phase 2 — Proof-crop fallback image.** Staff-repo-only, no migration, no customer deploy. Ship after Phase 1; needs the crop-library pick only.
3. **Ask 3.** After the walkthrough resolves direction-of-flow and the print-path question. Not before.

## Risks

- **Phase 1:** enlarged PDP view failing to render overlays (mitigated by passing `GalleryOverlay[]` through and re-using the suppression rule); mobile pinch-zoom inconsistency across browsers (mitigated by relying on native `touch-action`, no custom JS). Low overall.
- **Phase 2:** staff crop quality is uneven (mitigated by preview-before-publish + fallback-only + reversible); `designer_snapshot` provenance blur (accepted); a future need to distinguish proof-crops would require the migration we're avoiding now (revisit trigger noted). The healer/`front`-invariant fragility does **not** apply (master table only).
- **Ask 3:** routing a non-print-grade image into the print path — the reason it stays blocked.

## Out of scope / unchanged

- Any new `b2b_catalogue_item_images.source` value / CHECK migration (Phase 2 reuses `designer_snapshot`).
- Any customer-repo change for Phase 2 (read paths already handle `designer_snapshot`).
- Automatic/cron population of catalogue images (explicitly rejected — one-click only).
- The master `product_images` front-invariant healer and its cron/trigger (untouched).
- Server-side rasterisation of the proof **PDF** (`file_mkqjp7kh`) — Phase 2 sources the **PNG** pages in `file_mkpesta8`, so no PDF renderer is introduced.
- Hidden-views / per-(colour,view) hide logic — Phase 2 writes normal catalogue-image rows that the existing hide logic governs unchanged.
- Ask 3 implementation of any kind.
