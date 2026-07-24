# Design — Custom-name personalisation (Chris feature 2)

> **Date:** 2026-07-24 · **Author:** grounded code inspection (shipped feature-1 symbols) + `/grilling`
> decisions with Jon.
> **Repos:** **P** = `print-room-portal` (customer) · **S** = `print-room-staff-portal` (schema owner).
> **Status:** design approved (approach + both spec forks locked, 2026-07-24). Next: `writing-plans`.
> **Relationship:** direct **mirror of the shipped feature 1** (MTF location dropdown). See
> `docs/superpowers/plans/2026-07-22-mtf-location-dropdown.md` and
> `docs/2026-07-22-chris-client-features-strategy.md` (feature 2 row).

---

## Goal

Let staff enable an **optional, free-text "custom name"** (e.g. a staff/player name, ≤ ~15 chars) on
chosen products. On the PDP the customer types a name per garment; that value **keeps the cart line
distinct** (2× L "Chris" + 2× L "George" = two lines, not a merged qty-4 line), **persists on the
order**, and lands in its **own Monday production-board column**. This is the "second caller" for
Chris's line-attribute idea — but we build it by **mirroring feature 1's pattern**, not by
generalising feature 1's live code.

## Approach — mirror + shared formatter (locked)

Feature 1 (location) already shipped and is **live/merged** in both repos. Three options were weighed
(full unified abstraction / mirror + shared formatter / pure mirror); **mirror + shared formatter**
was chosen:

- **Do NOT** retrofit feature 1's location into a generic abstraction — that refactors working, live
  code for a single-code-path benefit that only pays off with a *third* attribute kind, which
  Chris's batch does not have (YAGNI).
- **DO** add custom-name as its own thin column-pair mirroring location exactly, so the two value
  paths stay simple and independent.
- **DO** extract the one genuinely-shared piece of pain the strategy flagged: the duplicated
  `variant_label` assembly (4 sites) → a single formatter that both boards and all sites route
  through, so location + custom-name slot in consistently.

## Decisions locked

| Decision | Choice | Why |
|---|---|---|
| Required vs optional | **Optional** (per line) | It's a personalisation add-on. Blank-name lines of the same product still merge; named ones split. Lets a customer order named + blank garments of one product together. Also the simplest schema (single nullable column, no gate). |
| Monday destination | **Own "Custom Name" subitem column** | Consistent with the live Location column; filterable; doesn't re-dirty the subitem title we just fixed (Task 1). Title stays product-name. |
| Per-product cap | **`custom_name_max_length int` nullable** — null = off, value = cap (UI default **15**) | One column = on/off + config, exactly like `line_dataset_id`. Per-product cap comes for free; no global constant to thread. |
| Generalise feature 1? | **No** | Live code; YAGNI. |
| Trade Services surfacing | **Out of scope** | That org doesn't exist in the portal yet. Build the *capability*; enabling it on a client's products is a later config step. |

---

## Mirror map (shipped feature-1 symbol → new feature-2 symbol)

Everything below is a 1:1 mirror of a **real, shipped** symbol (verified in code 2026-07-24), except
the two OPTIONAL/no-gate deviations and the new Monday column.

| Concern | Feature 1 (location) — shipped | Feature 2 (custom name) — new |
|---|---|---|
| Catalogue config (S) | `b2b_catalogue_items.line_dataset_id uuid?` (null = off) | `b2b_catalogue_items.custom_name_max_length int?` (null = off) |
| Order snapshot (S) | `quote_items.line_location_label text?` | `quote_items.line_custom_name text?` |
| Cart field (P) | `CartLine.locationLabel?: string \| null` (`lib/cart/types.ts:60`) | `CartLine.customName?: string \| null` |
| Cart split (P) | `lineSignature(…, locationLabel)` → `::${locationLabel ?? ''}::` (`types.ts:205`) | append `::${customName ?? ''}::` to the signature |
| Pooling (P) | **NOT** in `tierAggregationKey` (`submit.ts:382`) — pools like `sizeId` | **NOT** in `tierAggregationKey` — identical treatment |
| PDP input (P) | `locationOptions` dropdown; `requiresLocation`/`meetsLocation` **hard-gate** (`ProductDetailClient.tsx:214,1205`) | length-capped **text input**; **OPTIONAL — no gate** (add-to-cart unaffected) |
| Checkout field (P) | `CheckoutLineInput.location_label?` (`submit.ts:103`) | `CheckoutLineInput.custom_name?` |
| Persist (P) | `buildLineSnapshotUpdate` sets `line_location_label` (`submit.ts:380-386`), post-RPC UPDATE | same helper also sets `line_custom_name` |
| Monday read-back (P) | select `line_location_label` → `location:` (`submit.ts:1611,1638`) | select `line_custom_name` → `customName:` |
| Monday write (P) | `line.location` → `PRODUCTION_SUBITEM_COLUMNS.location = 'text_mm5gv8g3'` (`deal-item.ts:602-604`) | `line.customName` → new `PRODUCTION_SUBITEM_COLUMNS.customName = '<new id>'` |
| Staff mirror sites (S) | `retry-monday-push` + `confirm` routes carry `location` | carry `customName` too |

---

## Component design

### 1. Schema (S — migration file, never MCP/dashboard)

One migration: two nullable columns, no new tables (custom-name needs no org dataset).

```sql
-- b2b_catalogue_items: per customer×product opt-in + cap. NULL = custom name off.
alter table public.b2b_catalogue_items
  add column if not exists custom_name_max_length integer;
comment on column public.b2b_catalogue_items.custom_name_max_length is
  'When set (>0), this product shows an optional free-text "custom name" input on the PDP, '
  'capped at this many chars. NULL = no custom-name field. Mirrors line_dataset_id (feature 1).';

-- quote_items: frozen snapshot of the chosen name (label-only, like line_location_label).
alter table public.quote_items
  add column if not exists line_custom_name text;
comment on column public.quote_items.line_custom_name is
  'Frozen snapshot of the optional PDP custom name for this line. NULL when none. Set by the '
  'portal checkout follow-up UPDATE (submit_b2b_order unchanged); read by the Monday push.';
```

- No RLS/grant changes (both are columns on existing, already-policied tables).
- `submit_b2b_order` RPC is **untouched** — persistence rides the existing post-RPC follow-up UPDATE.
- Add `custom_name_max_length` to `normaliseCreate`/`normaliseUpdate` allow-list in
  `S:src/lib/products/schema.ts` and the catalogue-item PATCH allowlist.

### 2. Staff config (S — CatalogueItemEditor)

A single control on the catalogue-item editor mirroring the `line_dataset_id` assignment / the
`fulfilment_type_override` dropdown: a **"Custom name" checkbox** → when on, a **max-length number
input (default 15)**. Off writes `null`; on writes the integer. PATCH route allowlists +
validates (`> 0`, sane ceiling e.g. ≤ 30).

### 3. PDP (P — ProductDetailClient)

- Prop `customNameMaxLength?: number | null` loaded alongside `locationOptions` in
  `app/(portal)/catalogue/[productId]/page.tsx`.
- When set, render a text input (maxlength = cap) beneath the variant controls.
- **Optional:** the input never blocks add-to-cart (no `meetsLocation`-style gate). A product may
  have **both** a location dropdown *and* a custom name — they're independent.
- On add, pass the sanitised value onto the cart line (alongside `locationLabel`).

### 4. Validation (decided — one shared sanitiser, used PDP + checkout)

- Trim; collapse internal runs of whitespace to single spaces.
- Allow letters, digits, spaces, and `- ' . ,` (embroidery/print-safe); strip anything else.
- Empty-after-sanitise ⇒ treat as **no name** (`null`) → the line merges normally.
- Enforce ≤ the product's `custom_name_max_length` (truncate/clamp server-side as defence).
- **Case preserved** and **case-sensitive** in the signature (embroidery renders "Chris" ≠ "CHRIS",
  so they are distinct lines — matches customer intent; documented, low-stakes).

### 5. Cart (P)

- Add `customName?: string | null` to `CartLine` + the persist allow-list in `lib/cart/normalize.ts`.
- Thread through `CartProvider.addLine`.
- Extend `lineSignature()` with a `customName` segment (splits distinct names; null/blank merges).
- Leave `tierAggregationKey` untouched (name-agnostic pooling, exactly like `locationLabel`/`sizeId`).

### 6. Checkout (P)

- `CheckoutLineInput.custom_name?: string | null`; POST body carries it from `CheckoutReviewClient`.
- `buildLineSnapshotUpdate` also maps `custom_name` → `line_custom_name` (same additive,
  never-clobber `!== undefined` semantics).
- The Monday read-back select (`submit.ts:1611`) adds `line_custom_name`; the row→line map
  (`submit.ts:1638`) adds `customName: row.line_custom_name ?? null`.
- `app/api/checkout/route.ts` validation accepts/sanitises the field (shape guard).

### 7. Monday (P + S mirror)

- Create a **"Custom Name"** text column on the subitems board (`1992701983`) via the Monday MCP;
  capture the real id into `PRODUCTION_SUBITEM_COLUMNS.customName` in **both** repos' `column-ids.ts`.
- `deal-item.ts`: add `customName: string | null` to `OrderLineForMonday`; write it to the new
  column when non-blank (mirror the `line.location` block at `deal-item.ts:602-604`).
- Mirror in the staff duplicates: `retry-monday-push/route.ts` + the ordering-period `confirm` route.

### 8. Shared `variant_label` formatter (the "+ formatter" half)

Extract the duplicated garment-label assembly (`${product_name} — ${variant_label} × ${qty}`,
`production-job.ts:84` + `deal-item.ts` + the 4 `variant_label` sites: `submit.ts:199`,
`ordering-periods/[id]/confirm`, `orders/[id]/retry-monday-push`, `quotes/approve.ts`) into **one
pure formatter**. Route both boards + all sites through it. Location + custom-name remain **their own
columns** (not folded into the label) — the formatter is purely the dedup the strategy flagged, so
future title/label changes live in one place.

---

## Out of scope (YAGNI guardrails)

- No generic `product_line_attributes` table; no retrofit of feature 1's location into an abstraction.
- No org dataset / CSV importer (custom-name is free text, not a picklist).
- No Trade Services (or any) client product-config — that's a later ops step once such an org exists.
- No per-product "required" custom-name (optional-only). Add a `required` flag later iff a client asks.
- No global char constant — the cap is the per-product column.

## Testing strategy

- **P unit:** `lineSignature` splits on distinct `customName`, merges on null/blank; `tierAggregationKey`
  unchanged by name (pooling parity test).
- **P unit:** shared sanitiser (trim/collapse/allow-list/clamp/empty→null) table test.
- **P unit:** `buildLineSnapshotUpdate` maps `custom_name`→`line_custom_name`, additive/never-clobber.
- **P unit:** `deal-item` writes the new column when present, omits when blank; title unchanged.
- **P unit:** the extracted `variant_label` formatter — characterisation test pinning current output
  for a fixture, then all sites delegate (no output drift).
- **Manual e2e:** catalogue toggle on → PDP name input → two names split into two lines → checkout →
  `quote_items.line_custom_name` set → Monday Custom Name column populated. Test emails → `jamie@`.

## Cross-cutting notes

- **Schema-owner rule (S):** the migration is a file in `S:supabase/migrations/`, applied via
  `supabase db push` (the `.env.local` swap dance), **never** MCP `apply_migration`/dashboard.
- **`tsc` is diff-against-baseline**, not hard-zero (P has ~14 pre-existing errors in unrelated test
  files; S ~20 catalogue failures). "Green" = no new errors in touched files.
- **Auto-push hazard:** both portal repos auto-push/merge mid-session under Jon's tooling; branch off
  the current mainline, re-check `git rev-parse HEAD`/PR state, and don't promise "nothing pushed."
  Git is Jon's to drive — commits/PRs on his go.
- **Post-26, not urgent:** this is the post-go-live queue lead. It does not block MTF (feature 1).

## Open items / handoffs

- Monday "Custom Name" column: created at build time via MCP; real id captured then.
- Confirm the UI default cap (15) and the server ceiling (≤ 30 suggested) with Jon at build time.
