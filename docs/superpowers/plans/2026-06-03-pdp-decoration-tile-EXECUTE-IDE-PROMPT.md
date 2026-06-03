# IDE Prompt — Execute/Verify Plan 2: PDP Decoration Tile

> Paste everything below the line into a fresh coding-agent session with cwd
> `C:\Users\MSI\Documents\Projects\print-room-portal`.
> This prompt executes or verifies Plan 2 only. Do not merge and do not open a PR
> unless Jamie asks.

---

You are an expert TypeScript / Next.js 16 engineer continuing/verifying Plan 2 of
the product-upload pipeline: **"PDP decoration tile + blank-image filter"**
for the customer portal.

## Repo

`C:\Users\MSI\Documents\Projects\print-room-portal`

## Plan

`docs/superpowers/plans/2026-06-03-pdp-decoration-tile.md`

## Source spec

`docs/superpowers/specs/2026-06-03-pdp-decoration-tile-and-blank-image-filter-design.md`

## Goal

Ship the second low-risk, ship-today win:

1. Add a display-only `DecorationTile` under the PDP gallery, fed by existing
   `swatchVisibleDecorations`.
2. Filter the gallery's "blank product image" fallback: the master-scope,
   `color_swatch_id == null`, primary-view base image, when the selected colour
   has at least one colour-specific image. Never empty the gallery.

## Important context

This work may already be implemented or merged. Before editing, check:

```bash
git status --short --branch
git log --oneline -12
```

Then inspect whether these files already contain the Plan 2 changes:

- `components/shop/DecorationTile.tsx`
- `components/shop/__tests__/DecorationTile.test.tsx`
- `components/shop/ProductDetailClient.tsx`
- `lib/shop/catalogue-images.ts`
- `lib/shop/catalogue-images.test.ts`

If the plan is already implemented, do **not** reimplement. Verify the Definition
of Done and report status.

If it is not implemented, execute the plan task-by-task using
`superpowers:executing-plans` or `superpowers:subagent-driven-development`:
Task 0 -> Task 4.

## Pre-flight

- Read `AGENTS.md`.
- This repo is Next.js 16. Before touching any App Router, cache, transition,
  loading, or data-fetching behaviour, read the relevant docs in
  `node_modules/next/dist/docs/`.
- There is **no** `docs/ui/oem-rules.md` in this repo. Do not import staff-portal
  UI rules. Match existing portal PDP/gallery styling instead.
- Portal tests run on **Vitest 2.1.9 + jsdom + `@testing-library/react`**.
  `vitest-axe` is available through the test setup. Use existing component-test
  patterns; component tests under `components/` must be `.test.tsx`.
- Capture baseline before edits:

```bash
npx vitest run
```

Record pass/fail count. Final failures must not increase.

## Critical rules

- Plan 2 only. Do **not** touch pricing, cart totals, DB schema, migrations,
  Supabase, service pricing, setup fees, edge functions, or staff-portal files.
- `DecorationTile` is display-only. It must not fetch, price, mutate, or infer
  decoration data.
- Use existing `swatchVisibleDecorations`; do not add new decoration state.
- Tile image priority is `snapshotUrl ?? artworkUrl`.
- Empty decoration list renders nothing.
- Keep the live hero overlay in `components/shop/ProductImageGallery.tsx` as-is.
  Do not edit that file unless the live code has drifted so far that mounting
  the tile requires it; if so, stop and report the drift.
- Blank-image filter means exactly: drop priority-5 master colour-null primary
  base images when any retained entry is colour-specific. Never filter to an
  empty gallery. Do not hide all undecorated real product photos.
- Match edits by quoted code blocks and semantic anchors, not stale line
  numbers.
- Commit per plan task, with this trailer on each commit:

```text
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

## Expected task shape

Task 0:

- Create or reuse `feat/pdp-decoration-tile`.
- If branch exists or `main` has moved, reconcile safely; no force-push, no
  history rewrite.

Task 1:

- Add failing `DecorationTile` tests first.
- Implement `components/shop/DecorationTile.tsx`.
- Verify:

```bash
npx vitest run "components/shop/__tests__/DecorationTile.test.tsx"
```

Task 2:

- Import and mount `DecorationTile` directly under `<ProductImageGallery>` in
  `components/shop/ProductDetailClient.tsx`.
- Keep `swatchVisibleDecorations` and `product.name` as the only inputs.
- Verify:

```bash
npx tsc --noEmit
npx vitest run "components/shop/__tests__/ProductDetailClient.pills.test.tsx"
```

Task 3:

- Add failing blank-image filter tests in `lib/shop/catalogue-images.test.ts`.
- Implement the pure post-pass in `resolveGalleryImagesForColour`.
- Verify:

```bash
npx vitest run "lib/shop/catalogue-images.test.ts"
```

Task 4:

- Run final validation:

```bash
npx vitest run "components/shop/__tests__/DecorationTile.test.tsx"
npx vitest run "components/shop/__tests__/ProductDetailClient.pills.test.tsx"
npx vitest run "lib/shop/catalogue-images.test.ts"
npx vitest run
npx tsc --noEmit
npm run build
```

- Push the branch if implementation commits were created:

```bash
git push -u origin feat/pdp-decoration-tile
```

## Definition of Done

- `DecorationTile` renders one labelled card per selected-colour decoration and
  renders nothing for no decorations.
- `ProductDetailClient` mounts the tile under the gallery using existing
  swatch-filtered decoration data.
- `resolveGalleryImagesForColour` filters only the master colour-null primary
  fallback when a colour-specific image exists, and never empties the gallery.
- `ProductImageGallery` overlay behaviour is unchanged.
- Baseline vs final Vitest failure count did not increase.
- Targeted tests, full Vitest, `npx tsc --noEmit`, and `npm run build` are green,
  or any pre-existing unrelated failures are reported with exact evidence.
- Branch is pushed if code changed, not merged.

## Report back

Include:

- Files changed.
- Commit list and branch/sha.
- Baseline vs final Vitest counts.
- Targeted test output summary.
- `npx tsc --noEmit` and `npm run build` results.
- Confirmation that `ProductImageGallery` was intentionally not changed.
- Confirmation that pricing, cart, DB, Supabase, migrations, setup-fee files,
  edge functions, and staff portal were intentionally not touched.
- Any line-anchor drift and how you matched the code instead.
