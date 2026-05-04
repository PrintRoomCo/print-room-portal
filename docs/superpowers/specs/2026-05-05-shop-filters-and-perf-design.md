# Customer Shop Filters & Performance Audit — Design

**Date:** 2026-05-05
**Repo:** `print-room-portal`
**Status:** approved by Jamie

## Goal

Two coupled deliverables in one spec, ordered:

1. **Phase A — perf audit.** Measure where time goes today on `/shop`, output a findings doc, surface the top 2–3 bottlenecks before any new feature work.
2. **Phase B — server-side filters + sort + the perf fixes that are obvious regardless of the audit.** Add a left-rail filter UI to `/shop` with search, brand, category, garment family, sort (name + newest only), and "in stock only". Replace the per-product price RPC loop with a batched RPC. Switch images to Next optimisation. Move `.next` off OneDrive.

Phase A first: we may discover the real bottleneck is something the pre-decided Phase B fixes don't address, and we'd rather know that before writing filter code.

## Non-goals

Out of scope for this spec; either deferred to a follow-up or explicitly not building:

- Variant-level filters (colour, size, price range) — deferred to a follow-up spec triggered by real customer feedback after v1
- Sort by price — deferred until the batched price RPC is in place; sorting by `effective_unit_price` per row is N+1 today
- Infinite scroll / preload-on-hover / PDP prefetch on visibility
- Faceted result counts ("Brand X (12)") — possible follow-up
- Search suggestions, saved searches, favourites — not in MVP at all

## Architecture

**URL-as-state.** All filter state lives in `searchParams`. The `/shop` page already reads `q`, `brand_id`, `page`; we extend that to `category_id`, `garment_family`, `sort`, `in_stock`. No client-side state, no JS store. Filters are bookmarkable, survive reload, and play nicely with `force-dynamic` rendering and the existing Next App Router pattern.

**Server components only.** The new `FilterRail` is a server component that reads `searchParams` and renders a `<form method="GET">`. Submit-on-change for dropdowns/checkboxes (via tiny client wrapper components only where the platform forces it — `<select>` and `<input type="checkbox">` need an `onChange` to auto-submit). Submit-on-enter for the text input.

**Pagination resets on filter change.** The form omits `page`, so any filter submit lands on page 1.

**Catalogue-scoped facet options.** Brand / category / garment-family dropdown options are not the master tables — they're the values actually represented in the customer's catalogue. Otherwise we'd show filters that match nothing.

**Phase A audit drives Phase B task list.** The findings doc produces a fix list. The fixes already pre-committed below are best-practice regardless and won't change based on findings; anything *additional* coming out of the audit gets bolted into the implementation plan when it's written.

## File structure

### New files

- `print-room-portal/components/shop/FilterRail.tsx` — server component rendering the form + filter inputs. Client wrappers for auto-submit only where needed.
- `print-room-portal/components/shop/FilterSheetTrigger.tsx` — client component for the mobile "Filters (3)" button + sheet open/close state.
- `print-room-portal/lib/shop/facets.ts` — `getShopFacets(admin, scopedProductIds)` returning `{ brands, categories, garmentFamilies }`. Each is `Array<{ id: string; name: string }>` (or `Array<string>` for `garmentFamilies` which is a free-text column).
- `print-room-portal/lib/shop/filter-params.ts` — type-safe parser for `searchParams` → `ShopFilters` object + back to URL. Keeps the server page and the FilterRail consistent.
- `print-room-portal/docs/2026-05-05-shop-perf-audit.md` — findings doc (Phase A output, 1 page).
- DB migration: `print-room-staff-portal/supabase/migrations/0003_effective_unit_prices_bulk.sql` — new SQL function for batched pricing. (Migrations live in the staff repo per existing convention.)

### Modified files

- `print-room-portal/app/(portal)/shop/page.tsx` — wire the FilterRail in, swap per-product price loop for the batched RPC, accept the new search params, scope facets to the catalogue product set.
- `print-room-portal/components/shop/ProductCard.tsx` — remove `unoptimized` from `<Image>` (verify storage URL works with Next optimisation first).
- `print-room-portal/next.config.mjs` — add `images.remotePatterns` for the Supabase Storage host so Next can optimise them; optionally set `distDir` to a non-OneDrive path.
- `print-room-portal/components/shop/ProductImageGallery.tsx` — same `unoptimized` removal (matches Task 8 of the MVP plan).

### Deleted files

None in this spec.

## Phase A — perf audit method

**Output:** `print-room-portal/docs/2026-05-05-shop-perf-audit.md`. One page, table-format. Five measurements, each with: value observed, target, recommended fix, effort estimate.

### Measurements

1. **TTFB on `/shop` (cold + warm).** Use `curl -w "%{time_starttransfer}\n" -o /dev/null -s` against the logged-in dev server. Run 3× cold (kill dev server between), 3× warm. Record both medians. Target: warm <500ms.

2. **Per-product price RPC count + total time.** Wrap `effectiveUnitPrice` in `console.time` / `console.timeEnd` blocks (or a single `Promise.all` timer covering the entire pricing loop). Run one page load with default 24 results. Record: total round-trips, total elapsed ms, ms/call median.

3. **Per-product variant + availability query timing.** Same `console.time` treatment for the variant + `variant_availability` fetches inside the existing `Promise.all`. Two extra round-trips per product. Record: total round-trips, total elapsed ms.

4. **Image transfer size.** Open DevTools network tab, filter to images, reload `/shop`, sum total transferred bytes for product images. Record: total MB, median KB per image, count.

5. **Next dev compile time.** Note the `Compiled /shop in Xs` line on cold start, then after a one-line edit (warm). Record both. Note whether the slow filesystem warning fires.

### Phase A findings doc shape

```markdown
# Shop perf audit — 2026-05-05

| # | Measurement | Observed | Target | Recommended fix | Effort |
|---|---|---|---|---|---|
| 1 | TTFB cold | … | <800ms | … | … |
| 2 | Price RPC | 24 calls / Xms | 1 call / <50ms | Batched RPC (Phase B) | done in B |
| 3 | Variant queries | 48 calls / Xms | … | … | … |
| 4 | Image transfer | XMB | <500KB | Next opt + sizes (Phase B) | done in B |
| 5 | Compile time | Xs | <2s | Move .next off OneDrive | 5 min |

## Notes
- Predicted bottleneck (price RPC) confirmed / disproven
- New bottlenecks discovered: …
- Recommended Phase B additions: …
```

### Phase A acceptance

Audit doc exists with the table populated, all five rows have an observed value (not "n/a"), and any *new* bottlenecks discovered are flagged with a recommended fix that gets added to the Phase B plan.

## Phase B — features and fixes

### Filter rail UI

**Layout (desktop ≥`md:`).** Two-column grid. Left column: 280px sticky `FilterRail`. Right column: existing `<header card>` + product grid.

**Layout (mobile <`md:`).** FilterRail collapses to a "Filters (N)" button at the top of the grid where N is the count of currently-active non-default filters. Clicking opens a full-screen sheet (use existing `Modal` component if it works for full-screen mobile; otherwise inline a `<details>` disclosure). Same form, same submit-on-change behaviour.

**Visual style.** Match existing `/shop` aesthetic:

- Rounded `2xl` corners, white card, `border-gray-100`, `shadow-sm`
- Section labels: `text-xs font-medium uppercase tracking-wide text-gray-400`
- Inputs use the existing `Input` and select pattern from `b2b-accounts/NewOrganisationDialog.tsx` (rounded-full, `bg-gray-50`, `border-gray-200`)

**Filter inputs (in order).**

1. **Search** — `<input type="search" name="q" defaultValue={current}>`. Submit on enter only (no debounce — keeps server-side simple).
2. **Brand** — `<select name="brand_id">` with options from facets. First option `<option value="">All brands</option>`. Auto-submits on change.
3. **Category** — same pattern, `name="category_id"`.
4. **Garment family** — same pattern, `name="garment_family"`. Free-text column, so options are distinct values from the catalogue, sorted alphabetically.
5. **Sort** — `<select name="sort">` with two options: `name` (default), `newest`. Auto-submits.
6. **In stock only** — `<input type="checkbox" name="in_stock" value="1">`. Auto-submits.
7. **Clear all** — `<Link href="/shop">` rendered only when at least one non-default filter is active.

**Active-filter count for mobile button.** Computed in the `<page.tsx>` server component from the parsed `ShopFilters` object: count of non-default fields.

### `ShopFilters` type + parser

`print-room-portal/lib/shop/filter-params.ts`:

```ts
export type ShopSort = 'name' | 'newest'

export interface ShopFilters {
  q: string
  brandId: string | null
  categoryId: string | null
  garmentFamily: string | null
  sort: ShopSort
  inStock: boolean
  page: number
}

export const DEFAULT_SHOP_FILTERS: ShopFilters = {
  q: '',
  brandId: null,
  categoryId: null,
  garmentFamily: null,
  sort: 'name',
  inStock: false,
  page: 1,
}

export function parseShopFilters(
  sp: { [key: string]: string | string[] | undefined },
): ShopFilters {
  // ... trim q, validate sort against allowlist, parse boolean for in_stock,
  // parse positive int for page (default 1, clamp to >= 1)
}

export function activeFilterCount(filters: ShopFilters): number {
  // count non-default fields, excluding `page` (page isn't a filter)
}
```

Both the server `<page.tsx>` and `FilterRail` import from here so they can't drift.

### Catalogue-scoped facets

`print-room-portal/lib/shop/facets.ts`:

```ts
export interface ShopFacets {
  brands: Array<{ id: string; name: string }>
  categories: Array<{ id: string; name: string }>
  garmentFamilies: string[]
}

export async function getShopFacets(
  admin: SupabaseClient,
  scopedProductIds: string[],
): Promise<ShopFacets> {
  if (scopedProductIds.length === 0) {
    return { brands: [], categories: [], garmentFamilies: [] }
  }
  // 3 queries in parallel:
  //   - select distinct brand_id from products where id in (...) join brands
  //   - select distinct category_id ...
  //   - select distinct garment_family ... (filter null/empty), sort alpha
  // Return in alpha order by name (or value for garment_family).
}
```

### Page composition

`print-room-portal/app/(portal)/shop/page.tsx` becomes:

1. `requireB2BCustomer` (existing)
2. Parse `searchParams` via `parseShopFilters`
3. Fetch catalogue product ids (existing)
4. Branch — if `hasCatalogueScope === false`, render the existing empty state. Don't run facets, don't run product query. (See cross-cutting note: Spec 2 removes the `else` branch for the global fallback entirely; until that ships, we keep the current behaviour but server-side filters are only applied when the catalogue exists.)
5. `Promise.all` — facets query + filtered+sorted+paginated product query + total count
6. **Single batched price RPC** for the page's products
7. Variant + availability fetches stay as-is for now (audit will tell us if they need batching too); but we already do them inside `Promise.all` so the wall-clock is one round-trip
8. Render: filter rail (desktop) / filter sheet trigger (mobile) + grid

### Batched price RPC

**Migration file:** `print-room-staff-portal/supabase/migrations/0003_effective_unit_prices_bulk.sql`

```sql
-- Batched companion to effective_unit_price.
-- Returns one row per input product_id with the effective unit price
-- for the given org and per-product qty.
CREATE OR REPLACE FUNCTION public.effective_unit_prices_bulk(
  p_product_ids uuid[],
  p_org_id uuid,
  p_qty_by_product jsonb
)
RETURNS TABLE (product_id uuid, unit_price numeric)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  pid uuid;
BEGIN
  FOREACH pid IN ARRAY p_product_ids LOOP
    RETURN QUERY
    SELECT pid,
           public.effective_unit_price(
             pid,
             p_org_id,
             COALESCE((p_qty_by_product ->> pid::text)::int, 1)
           );
  END LOOP;
END;
$$;
```

(Implementation detail: this is a thin wrapper looping `effective_unit_price` server-side. It removes the **N HTTP round-trips** which is the actual bottleneck — the SQL execution time per product was already cheap. A future optimisation could rewrite as a single set-based query, but that's out of scope; the goal here is "1 round-trip not 24".)

**Client wrapper.** Add to `print-room-portal/lib/shop/effective-price.ts`:

```ts
export interface BulkPriceResult {
  prices: Map<string, EffectivePriceResult>
}

export async function effectiveUnitPricesBulk(
  admin: SupabaseClient,
  productIds: string[],
  orgId: string,
  qtyByProduct: Record<string, number>,
): Promise<BulkPriceResult> {
  if (productIds.length === 0) return { prices: new Map() }
  const { data, error } = await admin.rpc('effective_unit_prices_bulk', {
    p_product_ids: productIds,
    p_org_id: orgId,
    p_qty_by_product: qtyByProduct,
  })
  if (error) {
    console.warn('[shop/pricing] effective_unit_prices_bulk failed', error.message)
    return { prices: new Map() }
  }
  const map = new Map<string, EffectivePriceResult>()
  for (const row of (data ?? []) as Array<{ product_id: string; unit_price: number | null }>) {
    const value = Number(row.unit_price ?? 0)
    map.set(
      row.product_id,
      Number.isFinite(value) && value > 0
        ? { unitPrice: value, status: 'ok' }
        : { unitPrice: 0, status: 'missing' },
    )
  }
  return { prices: map }
}
```

The shop page replaces its per-product `effectiveUnitPrice` loop with one `effectiveUnitPricesBulk` call before entering the result mapping.

### Image optimisation

**Goal:** flip `unoptimized` off, configure Next image optimisation for Supabase Storage URLs, get correct `sizes`.

**Steps:**

1. Identify the Supabase Storage public URL host. Check `NEXT_PUBLIC_SUPABASE_URL` (project ref) and confirm via `select storage_url from a real product_image` to know the host.
2. In `print-room-portal/next.config.mjs`, add:

```js
images: {
  remotePatterns: [
    {
      protocol: 'https',
      hostname: '<project-ref>.supabase.co',
      pathname: '/storage/v1/object/public/**',
    },
  ],
}
```

3. Remove `unoptimized` from `<Image>` in `ProductCard.tsx` and `ProductImageGallery.tsx`. Verify a real image still renders. (If the URLs come back signed/private, optimisation breaks — fall back to leaving `unoptimized` on the gallery thumbs and only optimising `ProductCard`.)
4. Confirm `sizes` is correct on `ProductCard` for the 2/3/4-col grid. The grid is `grid-cols-2 md:grid-cols-3 lg:grid-cols-4`, so `sizes="(min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw"`.

### Dev compile time fix

**Goal:** stop OneDrive cloud-sync touching `.next/dev` on every file write.

Two options:

- **Option A (preferred):** add `distDir: 'C:/dev-cache/print-room-portal/.next'` to `next.config.mjs`. Pro: works without touching OneDrive config. Con: the path is Jamie-specific; document it as such with a comment, OR read from `process.env.NEXT_DIST_DIR` and fall back to default.
- **Option B:** OneDrive "Always keep on this device" + add `.next` to OneDrive's exclusion list via Windows GUI. Manual, harder to document.

Spec picks **A with env var fallback**. Plan documents Option B in the commit message as the alt for engineers without write access to a non-OneDrive path.

### Acceptance criteria

Phase A:

- [ ] Audit doc exists at `print-room-portal/docs/2026-05-05-shop-perf-audit.md`
- [ ] All 5 measurements have an observed value
- [ ] Any new bottlenecks (beyond the 5 pre-listed) get added to the Phase B plan

Phase B:

- [ ] Filter rail renders on desktop, sheet on mobile, with all 7 controls
- [ ] Filter state lives in URL; reload preserves; back/forward works; "Clear all" returns to `/shop`
- [ ] Brand / category / garment-family options scoped to the customer's catalogue (verified manually with a 2-catalogue test)
- [ ] Search filters server-side via `ilike`
- [ ] "In stock only" filters out products with no in-stock variants for the customer's org
- [ ] Sort by name / newest works; sort by price is NOT in the menu
- [ ] Active-filter count appears on the mobile button
- [ ] `effective_unit_prices_bulk` migration applied; one bulk call per page load (verified by dev-tools network or `console.log` in dev)
- [ ] `<Image>` on `ProductCard` is Next-optimised; total transferred bytes for `/shop` images ≥ 70% lower than baseline (audit measurement #4)
- [ ] `npx tsc --noEmit` clean in `print-room-portal`
- [ ] Dev compile time on `/shop` warm-edit cycle <2s OR documented why not (e.g. user kept OneDrive default for now)

## Cross-cutting concerns

- **Spec 2 dependency:** the global B2B fallback removal in Spec 2 simplifies the page's branch to "no catalogue → empty state, full stop". This spec keeps the existing branch intact; merge order doesn't matter, but the simpler branch from Spec 2 makes the filter code on `page.tsx` cleaner. If Spec 2 ships first the filter code is written against the simpler version; if this spec ships first, Spec 2 deletes a few lines of dead code from this work.
- **MVP plan dependency:** Task 8 in `c:\Users\MSI\.claude\plans\2026-05-05-mvp-completion.md` already touches `ProductImageGallery.tsx`. If that plan ships first, Phase B's image-opt change to that file is just removing `unoptimized` on an already-correctly-sorted gallery. If this spec ships first, Task 8 still applies cleanly. No real conflict.
- **Pricing memory:** `effective_unit_price` (and the new bulk wrapper) are the only price functions app code is allowed to call. `get_unit_price` direct calls are still forbidden — Tasks 1 + 2 of the MVP plan close the existing direct-call bugs.

## Open questions

None — all clarifying questions answered in the brainstorming session.
