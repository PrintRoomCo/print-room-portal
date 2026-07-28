# Product-image lightbox + landscape display

**Date:** 2026-07-28
**Status:** Approved (design) — ready for implementation plan
**Repos:** `print-room-portal` (customer, core) + `print-room-staff-portal` (staff preview)
**Origin:** Chris Brun feature requests (Slack, 2026-07-28), scoped down after investigation

---

## Why this exists

Chris asked to reuse the **proof PNG as a product's main image** instead of sourcing
separate web photos ("does not look as good but it works"). For that to be viable, a
proof PNG — usually **landscape** — must display in the portal **scaled down, not
cropped**, and be **clickable to enlarge**.

This spec covers **only** that display slice. It is a deliberate, low-regret cut of a
larger idea: it is needed under every interpretation of Chris's broader request, it is
pure portal-side UI, and it has **zero dependency** on the unresolved Monday-proof loop
(see companion doc `2026-07-28-chris-proof-monday-loop-demo-questions.md`).

Business framing (decided with Jon): the goal is **portal adoption** — lowering the
effort for staff to publish a product by letting them reuse the proof render they
already make. The lightbox is what makes that reuse look acceptable to a club member.

## Scope

**In:**
1. Click-to-enlarge lightbox on the **customer PDP** product image.
2. The same enlarge behaviour on the **staff item hero** so staff can see exactly what
   the club sees and control the pinned image.
3. A display audit confirming landscape product images are not cropped on customer
   product surfaces.

**Out (explicitly deferred):**
- The Monday-proof loop — product↔Monday link, pulling a proof into the portal,
  amending a Monday item with order quantities. Blocked on Chris's demo.
- Pinch/pan zoom beyond fit-to-viewport ("enlarge", not "zoom" — YAGNI).
- Any change to the Monday hand-off, `submit.ts`, or proof pipeline.
- Any DB schema change.

## Current-state findings (verified in code)

- **Customer PDP already does not crop.** `components/shop/ProductImageGallery.tsx`
  renders the active image in an `aspect-square` box with `object-contain p-6`. A
  landscape image already letterboxes rather than cropping. The gallery has thumbnail
  navigation with keyboard support (`ProductImageGallery.keyboard.test.tsx`) but **no
  enlarge/lightbox** — that is the real gap.
- **Grid card already does not crop.** `components/shop/ProductCard.tsx` uses
  `aspect-square` + `object-contain`.
- **Only cropping surface** is `components/proofs/ProofArchiveCard.tsx` (`object-cover`),
  which is the proofs archive — not product display. **Leave it unchanged.**
- **Staff hero:** `print-room-staff-portal` `src/components/catalogues/VariantsHero.tsx`
  renders the item hero and already owns the `card_image_id` pin control
  (set via `PATCH … { card_image_id }`, clear via `{ card_image_id: null }`).
- **No existing lightbox** in either repo (grep: no `lightbox`/enlarge/zoom component).

Net: the display audit is largely a **non-event** — the only build is the lightbox.

## Design

Two small, independent components — one per repo, **not shared** (different design
systems: customer `pr-blue`, staff OEM rules). Same behaviour contract.

### Component: `ImageLightbox` (behaviour contract)

- **Trigger:** click (or Enter/Space on) the main product image opens the overlay.
- **Structure:** a plain `<div role="dialog" aria-modal="true">` overlay rendered in a
  portal — **NOT** a native `<dialog>`, `alert`, `confirm`, or `prompt` (those block the
  browser-automation session and can wedge the page).
- **Image:** shown `object-contain`, constrained to the viewport (`max-w`/`max-h` with
  padding). **Never cropped.** Landscape letterboxes; portrait pillarboxes.
- **Dismiss:** Esc key, backdrop click, and an explicit close button (`aria-label="Close"`).
- **Focus:** focus moves to the overlay on open, is trapped while open, and returns to
  the trigger on close.
- **Multi-image:** if the gallery has more than one view, prev/next controls cycle
  through them inside the overlay (arrow keys + visible buttons). Single image → no arrows.
- **Body scroll** is locked while open.

### Surface 1 — Customer PDP (`print-room-portal`)

- New client component `components/shop/ImageLightbox.tsx`.
- Wire into `ProductImageGallery.tsx`: the main image becomes a `<button>` that opens
  the lightbox at the current `activeItem`; the lightbox receives the full
  `galleryItems` list and current index for prev/next.
- Preserve existing thumbnail behaviour (thumbnails still switch the active view; the
  lightbox opens from the main image).

### Surface 2 — Staff item hero (`print-room-staff-portal`)

- New component `src/components/catalogues/ImageLightbox.tsx` (OEM-styled), same contract.
- Wire into `VariantsHero.tsx`: the hero image opens the lightbox. Purpose is staff
  visibility — "this is what the club sees" — alongside the existing pin control. No new
  data or endpoints; it renders the images `VariantsHero` already has.

## Data flow

None beyond what exists. Both components render image URLs already present in their
host component. No fetch, no DB, no Monday, no cross-repo contract.

## Error handling

- Broken image URL: the lightbox reuses the host's existing `onError`/failed-image
  handling; a failed image shows the same "No image" placeholder rather than an empty
  overlay.
- No network calls, so no network error states.

## Testing

TDD in each repo (vitest):

- **Customer:** extend the gallery tests — opening the lightbox from the main image,
  Esc/backdrop/close dismiss, focus trap + focus return, prev/next cycling, single-image
  hides arrows. Axe check on the open overlay (role/aria/focus).
- **Staff:** analogous component test for `ImageLightbox` + a wiring test that
  `VariantsHero` opens it. Follow OEM pre-flight checklist for the `.tsx`.

## Rollout

- Pure UI in each repo; **independently deployable**, no coordinated release, no
  migration. Customer and staff halves can ship in either order.

## Open items (do not block this slice)

- The entire Monday-proof loop → resolved separately via Chris's demo. See companion doc.
- Whether staff eventually want a one-click "use this proof as main image" affordance
  (today: upload via `AddProductImageModal` + pin via `VariantsHero` already works).
