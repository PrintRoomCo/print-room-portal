# Chris demo — Monday-proof loop: questions to resolve

**Date:** 2026-07-28
**Purpose:** Chris offered to show how proofs / Monday work today. This is the list of
ambiguities to nail during that demo so the "Monday-proof loop" can be spec'd without
guessing. It has moved every conversation so far — do not spec it until these are answered.

## The core unknown: which direction does the proof flow?

The two accounts we have contradict each other:

- **Chris's Slack messages (portal → Monday):** "upload 1-2 images per product for the
  proof… mapped to the parent item when sent to Monday Artwork column"; "the image file
  (of the proof) could pull straight through to the artwork column that is used to create
  the production proof."
- **Jon's later description (Monday → portal):** "the proof gets made BEFORE ordering…
  Chris wants to reuse the proof document by linking the correlating proof from the
  Monday column into the portal, then after ordering that proof gets amended with the
  confirmed order quantities."

These are opposite. The demo must settle it.

## Questions for Chris

1. **When and where is the proof made?** Before the product is orderable, or per customer
   order? In Monday, in the portal, or in an external tool (e.g. an emailed PNG)?
2. **What exactly is "the Monday column"?** The Artwork column (`file_mkpesta8` on the
   Production board) or a different column/board? Is it on the parent item or a subitem?
3. **Direction:** does the portal need to **push** an image *into* Monday, **pull** a
   proof *out* of Monday to display, or **both** (a loop)?
4. **What is the link between a portal product and its Monday proof/item?** There is
   currently **no** link column on `b2b_catalogue_items` — if the portal must reference a
   Monday item/proof, who sets that link and when?
5. **"Amended with confirmed order quantities" — amend what, exactly?** The Monday item's
   quantity fields? A subitem per size? A regenerated proof document? (Today, per-order
   quantities reach Monday only via the proof-gated `pushOrderProductionToMonday`
   subitem path.)
6. **Does production actually build the proof from the Artwork images,** or does it need a
   rendered proof PDF as well?
7. **Is this per-product (set once at setup) or per-order (regenerated each order)?**
   This decides whether the proof lives on the catalogue item or the order.

## Code facts to bring to the demo

- Portal order submit (`submit.ts` `submitB2BOrder`) creates the Supabase order/quote
  **only** — no Monday push. The Monday push (`pushOrderProductionToMonday`) is gated
  behind a **rendered proof PDF** + staff proof-approval and is **not** wired to portal
  submit today. So Flow-A (catalogue reorder, no per-order proof) portal orders **never
  reach Monday** as things stand.
- A `staff_upload` image on a catalogue item **already** flows into an auto-assembled
  draft proof's mockup slot (`order-assembly.ts` → `pickCatalogueMockup`), and
  `selectProductArtworkUrls` **already** pushes those mockups to the Monday Artwork
  column — but only at proof-approve, which Flow A never triggers.
- `proof_catalogue_links` (proof ↔ catalogue_item ↔ view, `is_primary`) exists in the
  schema but **nothing writes to it** — do not build on it without reviving it deliberately.
- `b2b_catalogue_items` has `image_url` + `card_image_id` but **no Monday/proof link**.

## Likely spec shapes (to confirm after demo, not before)

- **If Monday → portal:** add a link (e.g. `b2b_catalogue_items.monday_item_id` +
  a pulled proof image URL), a staff action to set it, a read path to display the proof,
  and a write path to amend quantities on order.
- **If portal → Monday:** un-gate `pushOrderProductionToMonday` for Flow A (make
  `proofPdf` optional; push Artwork-only from the product's pinned image) and choose a
  trigger.
