# Decoration Styles — Implementation Plan

**Date:** 2026-05-06
**Spec:** [`specs/2026-05-06-decoration-styles-design.md`](../specs/2026-05-06-decoration-styles-design.md)
**Repos:** `print-room-portal` (customer), `print-room-staff-portal` (staff), Supabase `bthsxgmcnbvwwgvdveek` (prod, no staging — writes hit prod)
**Gate:** Jon must sign off on the one-pager + open questions in the spec before Phase 1 starts.

## Build order (across repos)

```
Phase 0  — Schema + storage  (Supabase only)         [migrations 1–4]
Phase 1  — Staff portal — Artwork Library            [staff-portal]
Phase 2  — Staff portal — Org Decorations            [staff-portal]
Phase 3  — Staff portal — Per-catalogue-item picker  [staff-portal]
                                                     [REMOVE method/price columns from CatalogueItemsTable]
Phase 4  — Sanity check (no backfill — Decision #4)  [no migration]
Phase 5  — Customer PDP — Multi-pick swatch + cart   [print-room-portal]
                                                     [PDP shows raw artwork thumb — designer snapshots not yet wired]
                                                     [cart line carries decorations: Decoration[]]
Phase 6  — Customer checkout — submit re-validation  [print-room-portal]
Phase 7  — Cleanup gate (deferred)                   [migration 5 + Postgres functions]
─── manual-apply MVP complete here. ships to prod safely.

Phase 8  — Designer-driven decoration                [BLOCKED on companion plan
                                                      `2026-05-06-per-variant-product-views-plan.md`]
                                                     [designer launch + snapshot+price callback]
                                                     [PDP swatches start preferring snapshots over raw thumbs]
Phase 9  — Customer designer "Save to org library"   [print-room-portal]
                                                     [closes artwork-lifecycle loop, customer→library promotion]
```

Phase 0 must ship before any app code reads the new tables. Phases 1–3 can be done in one staff-portal PR. Phases 5–6 ship as one customer-portal PR. **Phases 0–7 deliver the manual-apply MVP without any designer dependency.** Phase 8 unlocks once per-variant product views land. Phase 9 is orthogonal — can ship before or after Phase 8.

---

## Phase 0 — Schema + storage

### Task 0.1 — Migration 1: `organization_artworks`

**File:** `supabase migration new create_organization_artworks` → `20260506xxxxxx_create_organization_artworks.sql`

```sql
create table public.organization_artworks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  storage_path text not null,
  public_url text not null,
  mime_type text,
  file_size integer,
  sha256 text,
  uploaded_by_user_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, sha256)
);

create index on public.organization_artworks (organization_id, is_active);

alter table public.organization_artworks enable row level security;

create policy "org members can read artworks"
  on public.organization_artworks for select
  using (
    exists (
      select 1 from public.user_organizations uo
      where uo.user_id = auth.uid()
        and uo.organization_id = organization_artworks.organization_id
    )
  );

-- writes done by staff-portal service role; no policy → service-role bypasses RLS.
```

**Verify:** `select count(*) from organization_artworks;` returns 0. RLS verified by `set local role authenticated;` followed by a select with no `user_organizations` row → 0 rows back.

### Task 0.2 — Migration 2: `org_decorations`

**File:** `20260506xxxxxx_create_org_decorations.sql`

```sql
create table public.org_decorations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  artwork_id uuid not null references public.organization_artworks(id) on delete restrict,
  name text not null,
  decoration_method text not null,
  decoration_location_id uuid references public.decoration_locations(id),
  unit_price numeric(10,2) not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name),
  check (decoration_method in ('screenprint','embroidery','heatpress','supacolour','dtf')),
  check (unit_price >= 0)
);

create index on public.org_decorations (organization_id, is_active);
create index on public.org_decorations (artwork_id);

alter table public.org_decorations enable row level security;

create policy "org members can read decorations"
  on public.org_decorations for select
  using (
    exists (
      select 1 from public.user_organizations uo
      where uo.user_id = auth.uid()
        and uo.organization_id = org_decorations.organization_id
    )
  );
```

**Verify:** insert + select via service role works; an authenticated session with no `user_organizations` row gets 0 results.

### Task 0.3 — Migration 3: `b2b_catalogue_item_decorations`

**File:** `20260506xxxxxx_create_b2b_catalogue_item_decorations.sql`

```sql
create table public.b2b_catalogue_item_decorations (
  id uuid primary key default gen_random_uuid(),
  catalogue_item_id uuid not null references public.b2b_catalogue_items(id) on delete cascade,
  org_decoration_id uuid not null references public.org_decorations(id) on delete restrict,
  is_default boolean not null default false,
  sort_order integer not null default 0,
  -- Designer-computed price override (Phase 8). Null = use org_decoration.unit_price.
  unit_price_override numeric(10,2),
  -- Designer-tool snapshot (Phase 8). Nullable: manual-apply rows leave these null.
  snapshot_storage_path text,
  snapshot_url text,
  snapshot_color_swatch_id uuid references public.product_color_swatches(id) on delete set null,
  created_at timestamptz not null default now(),
  -- A given decoration may have one row per colour-swatch snapshot on the same item.
  -- COALESCE handles "no colour" (manual-apply has snapshot_color_swatch_id = null).
  unique (catalogue_item_id, org_decoration_id, snapshot_color_swatch_id),
  check (unit_price_override is null or unit_price_override >= 0)
);

create index on public.b2b_catalogue_item_decorations (catalogue_item_id);
create index on public.b2b_catalogue_item_decorations (org_decoration_id);

alter table public.b2b_catalogue_item_decorations enable row level security;

create policy "org members can read catalogue-item decorations"
  on public.b2b_catalogue_item_decorations for select
  using (
    exists (
      select 1
      from public.b2b_catalogue_items ci
      join public.b2b_catalogues c on c.id = ci.catalogue_id
      join public.user_organizations uo on uo.organization_id = c.organization_id
      where ci.id = b2b_catalogue_item_decorations.catalogue_item_id
        and uo.user_id = auth.uid()
    )
  );
```

**Verify:** mirror of `b2b_catalogue_items` policy semantics. Cross-org read returns 0.

### Task 0.4 — Migration 4: storage bucket `org-artworks`

**File:** `20260506xxxxxx_storage_bucket_org_artworks.sql`

```sql
insert into storage.buckets (id, name, public)
  values ('org-artworks', 'org-artworks', true)
  on conflict (id) do nothing;

-- public read for artwork files
create policy "public read on org-artworks"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'org-artworks');

-- writes via service role only (staff portal); no insert/update/delete policy
```

**Verify:** `select * from storage.buckets where id='org-artworks';` returns 1 row. Anon GET on a known path returns the file once one is uploaded.

### Task 0.5 — Apply via Supabase MCP

Use `mcp__claude_ai_Supabase__apply_migration` for each, **in order**. After each, `list_migrations` to confirm. Bail out if any fail.

---

## Phase 1 — Staff portal: Org Artwork Library

Repo: `print-room-staff-portal`.

### Task 1.1 — API: list + upload artworks

**Files:**
- `src/app/api/orgs/[orgId]/artworks/route.ts` — `GET` (list active artworks) + `POST` (multipart upload → Supabase Storage → INSERT row).
- `src/app/api/orgs/[orgId]/artworks/[artworkId]/route.ts` — `PATCH` (rename, soft-delete via `is_active`), `DELETE` (hard delete + storage object delete).

Auth: `requireCataloguesStaffAccess` (or whichever existing helper gates staff API routes — confirm at task time). Use service-role admin client.

Verify: curl tests with a valid staff session: POST a 50 KB PNG → row inserted, file in bucket. GET → returns the row. PATCH → `name` updates. DELETE → row gone, storage object gone.

### Task 1.2 — UI: Artwork manager

**Files:**
- `src/app/(portal)/b2b-accounts/[orgId]/artworks/page.tsx` — server component, fetches list, mounts client manager.
- `src/components/b2b-accounts/ArtworkLibrary.tsx` — grid of thumbnails, each with name, replace button, delete button.
- `src/components/b2b-accounts/ArtworkUploadDialog.tsx` — file input (image/png, image/jpeg, image/svg+xml, max 5 MB), name field, on-submit POSTs multipart to Task 1.1.

Verify in browser: as staff, hit `/b2b-accounts/<PRT-org-id>/artworks`, upload a file, see it in the grid. Reload → still there. Delete → gone.

### Task 1.3 — Surface the route in nav

Add a tab on the existing org page (whatever route serves `/b2b-accounts/[orgId]`) linking to `…/artworks` and `…/decorations` (Phase 2). Inspect existing tab pattern in `src/app/(portal)/b2b-accounts/...` and mirror it.

---

## Phase 2 — Staff portal: Org Decorations

### Task 2.1 — API: list + create + edit decorations

**Files:**
- `src/app/api/orgs/[orgId]/decorations/route.ts` — `GET` (list with artwork joined), `POST` (insert).
- `src/app/api/orgs/[orgId]/decorations/[decorationId]/route.ts` — `PATCH`, `DELETE`.

Body shape on POST/PATCH: `{ artwork_id, name, decoration_method, decoration_location_id, unit_price, is_active, sort_order }`. Server validates `decoration_method` enum, `unit_price >= 0`, `artwork_id` belongs to the same org.

Verify: POST → row in `org_decorations`. GET joins to artwork URL + name. PATCH updates price.

### Task 2.2 — UI: Decorations table + form

**Files:**
- `src/app/(portal)/b2b-accounts/[orgId]/decorations/page.tsx` — server component.
- `src/components/b2b-accounts/DecorationsTable.tsx` — rows: thumbnail | name | method badge | location | price | active | edit | delete.
- `src/components/b2b-accounts/DecorationFormDialog.tsx` — fields: artwork picker (dropdown sourced from Task 1.1's GET), name, method (5-option select), location (dropdown of `decoration_locations` rows + free-text fallback), unit price.

Decoration locations source: hit `select id, location, placement_key from decoration_locations where is_active order by sort_order` once, hand to client. (If RLS becomes an issue — `decoration_locations` has RLS disabled per advisory — use service role for the read.)

Verify: create a decoration via UI, see it in the table. Edit price. Delete.

---

## Phase 3 — Staff portal: Per-catalogue-item decoration picker

### Task 3.1 — API: link/unlink decorations on a catalogue item

**File:** `src/app/api/catalogues/[id]/items/[itemId]/decorations/route.ts`

- `GET` → list `b2b_catalogue_item_decorations` for the item, joined to `org_decorations` + `organization_artworks`.
- `POST` → body `{ org_decoration_id, is_default?, sort_order? }`, insert. Validate that the decoration's `organization_id` matches the catalogue's org.
- `DELETE /api/catalogues/[id]/items/[itemId]/decorations/[linkId]` → unlink.
- `PATCH /api/catalogues/[id]/items/[itemId]/decorations/[linkId]` → update `is_default` / `sort_order`. Server enforces "max one `is_default=true` per item" by clearing others on a set.

### Task 3.2 — UI: cell on `CatalogueItemsTable` + remove method/price columns

**Files modified:**
- `src/components/catalogues/CatalogueItemsTable.tsx` —
  - **REMOVE** the "Decoration method" `<select>` column (currently lines ~150–169).
  - **REMOVE** the "Decoration price" `<Input>` column (currently lines ~170–188).
  - **REMOVE** corresponding `<th>` headers (currently lines ~110–111).
  - **ADD** a "Decorations" column rendering `<CatalogueItemDecorationsCell />`.
  - The `patchItem` PATCH path no longer needs to send `decoration_method` / `decoration_price`. (Server still accepts them for back-compat until Phase 7 drops them.)
- `src/components/catalogues/CatalogueItemDecorationsCell.tsx` — new — chip stack of attached decorations (each chip = thumbnail + name + price) + "Manage" button opening a popover/dialog. Dialog: list current attached decorations + an "Add decoration" search-select filtering the org's `org_decorations` not yet attached, per-row "Remove" + `is_default` toggle + sort up/down.
- `src/components/catalogues/CatalogueEditor.tsx` — modify `CatalogueEditorItem` type to drop `decoration_method` and `decoration_price` (or keep them as optional/legacy for one PR, removed in the next). The new `decorations: AttachedDecoration[]` field carries the data.

Verify in browser:
- Open a PRT catalogue. Confirm method/price cells are gone, Decorations column renders.
- Manage decorations on an item, attach two, mark one default, save, reload → state persists.
- A catalogue item with no attached decorations shows an empty-state "Add decoration →" CTA.

### Task 3.3 — Update item GET shape

**File:** `src/app/api/catalogues/[id]/items/route.ts`

The existing GET selects `decoration_method, decoration_price`. Add a joined `decorations` field via a follow-up query (or a single Postgres function call) that returns the attached decorations with thumbnail URL + name + unit_price + is_default. Pass into `CatalogueEditorItem.decorations`.

Verify: fetch the route in browser DevTools, confirm the new `decorations` array is populated.

---

## Phase 4 — (no migration; existing items become "no decoration" until staff sets them up)

Per Decision #4 (Jon, 2026-05-06): **no backfill placeholder artwork**. Migration 5 from earlier drafts is **dropped**.

The existing 3 PRT catalogue items have `decoration_method` + `decoration_price` data in their forked columns. After Phase 3 ships, those columns are no longer surfaced in the staff editor and no `b2b_catalogue_item_decorations` rows exist for them. The PDP renders without a decoration swatch row (allowed per Decision #1 — "no decoration path allowed"). Staff configures real decorations via the new flow when ready; the legacy column data stays in the DB until Phase 7 drops it.

### Task 4.1 — Manual sanity check after Phase 3 ships

Via Supabase MCP `execute_sql`:

```sql
-- expect: 0 rows. nothing in the link table yet.
select count(*) from public.b2b_catalogue_item_decorations;

-- expect: 3 rows. the legacy columns still hold their pre-fork data.
select ci.name, ci.decoration_method, ci.decoration_price
from public.b2b_catalogue_items ci
order by ci.name;
```

Visit `/shop/<one of the 3 product ids>` as a PRT user — confirm the page renders cleanly with no decoration swatch row, no errors, no "decoration available" placeholder.

### Task 4.2 — Document for staff

Drop a one-line note in the staff catalogue editor empty-state ("No decorations attached. Add one →") so the AM understands the gap and can rebuild the 3 items at their own pace.

---

## Phase 5 — Customer PDP: swatch picker + cart

### Task 5.1 — Type defs + helper

**File:** `print-room-portal/lib/shop/decorations.ts` (new)

```ts
export interface DecorationOption {
  linkId: string              // b2b_catalogue_item_decorations.id
  decorationId: string        // org_decorations.id
  name: string                // "Embroidery — Left Chest"
  method: string              // 'embroidery'|'screenprint'|...
  positionLabel: string | null
  unitPrice: number           // resolved: COALESCE(link.unit_price_override, decoration.unit_price)
  artworkUrl: string
  artworkName: string
  snapshotUrl: string | null  // designer-rendered mockup (Phase 8); null in Phase 5
  snapshotColorSwatchId: string | null
  isDefault: boolean
  sortOrder: number
}

export async function loadCatalogueItemDecorations(
  admin: SupabaseClient,
  catalogueItemId: string,
): Promise<DecorationOption[]>
```

The helper runs one query joining `b2b_catalogue_item_decorations` → `org_decorations` → `organization_artworks` → `decoration_locations(location)`, returns the typed array sorted by `sort_order`. **Effective `unitPrice` is resolved server-side via `COALESCE(link.unit_price_override, org_decorations.unit_price)`** — the client never sees the raw override column.

### Task 5.2 — Wire into PDP server fetch

**File:** `app/(portal)/shop/[productId]/page.tsx`

Add the helper call to the existing `Promise.all` batch (after `bracketsQuery`). Pass the result to `<ProductDetailClient decorations={…} />`.

Verify: `console.log` once, confirm 1 decoration comes back for backfilled PRT items.

### Task 5.3 — `DecorationSwatchPicker.tsx` (multi-pick)

**File:** `components/shop/DecorationSwatchPicker.tsx` (new)

Mirrors [VariantPicker.tsx](../../../components/shop/VariantPicker.tsx) shape, but **multi-pick** per Decision #2:

- Each swatch is a 40×40 rounded-square button with `background-image: url(snapshotUrl ?? artworkUrl)` (object-cover), border + ring on selected, dim opacity on unselected.
- Selected swatches show a small checkmark badge in the top-right corner.
- Caption row beneath each swatch: `<method-shorthand> · <position-label>` (e.g. "EMB · L. Chest"). Method shorthand map: `screenprint→SP, embroidery→EMB, heatpress→HP, supacolour→SC, dtf→DTF`.
- Section header: "Decoration" + selection summary on the right: `"2 selected · +$13.00 / unit"`.
- A trailing "None" pill (per Decision #1 — no-decoration path allowed) clears the entire selection. Pre-selected on items with zero decorations attached.
- All `is_default=true` decorations are auto-checked on mount.
- Click toggles individual swatches.

Props:

```ts
interface DecorationSwatchPickerProps {
  decorations: DecorationOption[]
  selectedLinkIds: ReadonlySet<string>
  onChange: (next: ReadonlySet<string>) => void
}
```

### Task 5.4 — Wire selection into pricing + cart

**File:** `components/shop/ProductDetailClient.tsx`

- Accept `decorations: DecorationOption[]` prop.
- State: `const [selectedLinkIds, setSelectedLinkIds] = useState<Set<string>>(new Set(decorations.filter(d => d.isDefault).map(d => d.linkId)))`.
- Compute `selectedDecorations = decorations.filter(d => selectedLinkIds.has(d.linkId))`.
- Compute `decorationPerUnit = selectedDecorations.reduce((s, d) => s + d.unitPrice, 0)`.
- Replace the existing `decoration available + $X` block (lines 208–217) with `<DecorationSwatchPicker decorations={decorations} selectedLinkIds={selectedLinkIds} onChange={setSelectedLinkIds} />`.
- Pass `decorationPerUnit` into `computeOrderBreakdown`.
- In `handleAddToCart`, snapshot the **array** of decorations onto the cart line.

### Task 5.5 — Extend `CartLine` type to carry an array

**File:** `lib/cart/types.ts`

```ts
export interface CartLineDecoration {
  linkId: string                 // b2b_catalogue_item_decorations.id (re-validated on submit)
  decorationId: string           // org_decorations.id
  name: string
  method: string
  positionLabel: string | null
  unitPrice: number              // snapshot of resolved price at add-time
  artworkUrl: string
  snapshotUrl: string | null
}

export interface CartLine {
  // …existing…
  decorations: CartLineDecoration[]    // empty array = no decoration (allowed)
}
```

Remove the legacy `decorationPrice?: number | null` field. Grep for `decorationPrice` on the customer portal during this task — every read site needs to migrate to `line.decorations.reduce((s, d) => s + d.unitPrice, 0)`. Flag each in the diff.

### Task 5.6 — Cart UI shows multiple decoration chips

**File:** find the cart-line row component (likely `components/cart/CartLineRow.tsx` or similar — confirm at task time). Render a chip stack: each decoration = 24×24 artwork/snapshot thumbnail + decoration name + `+$X.XX`, wrapped in flex-wrap. Empty state if `decorations.length === 0` (no chip rendered).

Verify in browser: select 2 decorations on the PDP, add to cart, open cart — both chips render with their unit prices summed in the line total.

### Task 5.7 — Smoke test the full PDP→cart loop

In a browser as a PRT user:
1. Visit a PRT catalogue product — see decoration swatches.
2. Change qty — verify total = `unit × qty + decoration × qty + GST`.
3. Add to cart — line appears with decoration chip.
4. Open cart — chip renders.
5. Refresh — cart persisted (zustand local persistence still works).

---

## Phase 6 — Customer checkout: submit re-validation

### Task 6.1 — Re-read & re-assert each decoration on submit

**File:** `lib/checkout/submit.ts`

For each cart line, iterate `line.decorations`. For each:

1. SELECT `b2b_catalogue_item_decorations` by `linkId`, joined to `org_decorations` + `organization_artworks`.
2. Assert `org_decorations.organization_id == context.organizationId` (no cross-org reuse).
3. Assert `b2b_catalogue_item_decorations.catalogue_item_id` resolves to the line's catalogue item (via the line's `productId → catalogue_item.source_product_id`).
4. Resolve effective price: `effective = COALESCE(link.unit_price_override, org_decoration.unit_price)`. Compare to snapshot `decoration.unitPrice`. If drift > $0 (no tolerance — staff/designer edits are explicit), return structured error `decoration_price_drift` carrying `{ lineId, linkId, was, now }`.
5. On success, persist all decorations for the line onto the order line. (Where orders live: confirm at task time — likely `orders.line_items` jsonb or a dedicated `order_lines` table. Use a `decorations: CartLineDecoration[]` jsonb column or a sibling `order_line_decorations` table; pick whichever matches the existing order persistence shape.)

### Task 6.2 — Error UX on drift

If submit returns `decoration_price_drift`, the checkout page surfaces a "Decoration pricing has changed — review your cart" inline error and bumps the affected line to a re-quote state. Reuse the existing tier-drift error pattern if one exists; otherwise add a minimal block.

Verify: simulated drift — manually `update org_decorations set unit_price = unit_price + 1 where id = X;` in MCP, attempt submit, confirm error. Reset.

---

## Phase 7 — Cleanup gate (deferred — separate PR, separate day)

### Task 7.1 — Confirm no caller reads `b2b_catalogue_items.decoration_method` or `decoration_price`

Grep both repos. Check the two Postgres functions that bit us in Plan 2a (`catalogue_unit_price`, `designer_submit_to_catalogue`) — neither should read those columns anymore. If either does, fix it first.

```sql
select pg_get_functiondef(p.oid)
from pg_proc p
where p.proname in ('catalogue_unit_price','designer_submit_to_catalogue','effective_unit_price');
```

### Task 7.2 — Migration 6: drop the columns

**File:** `20260507xxxxxx_drop_decoration_columns_from_b2b_catalogue_items.sql`

```sql
alter table public.b2b_catalogue_items
  drop column decoration_method,
  drop column decoration_price;
```

### Task 7.3 — Remove forked-column references in staff editor

Update `CatalogueEditor.tsx`, `CatalogueItemsTable.tsx`, the GET/POST/PATCH item routes, the GET item shape — strip `decoration_method` + `decoration_price` from selects/inserts/types. The decoration UI (Phase 3) supersedes these.

Tracker memory item to update on completion: `project_b2b_catalogue_fork_plan_2a.md` — add a "Plan 2a → Plan 3 superseded the forked decoration columns" line.

---

## Verification commands (per phase)

| Phase | Command | Pass condition |
|---|---|---|
| 0 | `mcp_supabase list_migrations` | 4 new migrations show as applied |
| 0 | RLS smoke (anon select) | 0 rows on each new table |
| 1 | curl POST a 1KB PNG to artworks API | row in `organization_artworks`, file in bucket |
| 2 | curl POST a decoration | row in `org_decorations`, FK valid |
| 3 | UI attach + reload | link row persists; `is_default` checkboxes preserved on multi-pick |
| 4 | `select count(*) from b2b_catalogue_item_decorations;` | = 0 (no backfill, per Decision #4) |
| 5 | PDP renders + multi-pick + cart add | screen recording: 2 swatches selected → cart shows 2 chips |
| 6 | `pnpm test lib/checkout` (if tests exist) + manual drift test on each decoration | drift on any decoration → structured error pinpointing which one |
| 7 | `select column_name from information_schema.columns where table_name='b2b_catalogue_items' and column_name in ('decoration_method','decoration_price');` | 0 rows |
| 8 | designer round-trip: launch → save → callback → reload | snapshot URL + `unit_price_override` populated on link row |
| 9 | customer designer "Save to org library" + dedup re-save | first call inserts; second call returns existing artwork id |

End of Phase 7, both repos: `tsc --noEmit` passes; lint passes; PRT happy-path order through PDP → cart → checkout → submit succeeds with new decoration metadata persisted. **Manual-apply MVP is shippable.**

---

## Phase 8 — Designer-driven decoration (BLOCKED on companion plan)

**Hard prerequisite:** [`2026-05-06-per-variant-product-views-plan.md`](./2026-05-06-per-variant-product-views-plan.md) (companion). Do **not** start Phase 8 tasks until that plan is shipped — the designer needs per-(view, colour) print areas to render snapshots correctly.

### Task 8.1 — Designer launch helper

**File:** `print-room-staff-portal/src/lib/designer/launch.ts` (new)

```ts
export interface DesignerLaunchContext {
  catalogue_item_id: string
  org_decoration_id: string
  link_id: string                    // b2b_catalogue_item_decorations.id
  product_id: string
  color_swatch_id: string | null
  return_url: string                 // back to catalogue editor with this item open
}

export function buildDesignerLaunchUrl(ctx: DesignerLaunchContext): string
```

The URL includes a short-lived signed token the designer tool exchanges for staff-side write access on the snapshot callback (reuse whatever JWT pattern survived `project_proof_iframe_consolidation.md` decoupling — confirm at task time).

### Task 8.2 — "Configure with designer" launch button

**File:** `src/components/catalogues/CatalogueItemDecorationsCell.tsx` (modify Task 3.2 output)

Each attached decoration chip gains a small "🖌 Configure" icon button. Click → open the designer in a new tab via `buildDesignerLaunchUrl(...)`. After save, designer redirects back to `return_url`; on mount the editor refetches and shows the snapshot thumbnail in the chip.

### Task 8.3 — Snapshot + price callback API

**File:** `src/app/api/designer/snapshot-callback/route.ts` (new)

`POST` body:

```ts
{
  link_id: string
  snapshot_storage_path: string
  snapshot_url: string
  snapshot_color_swatch_id: string | null
  unit_price_override: number | null   // designer-computed price, null = use org default
  signed_token: string
}
```

Verify token, then `UPDATE b2b_catalogue_item_decorations SET snapshot_*=..., unit_price_override=... WHERE id = link_id`. Auth: signed token, NOT user session (designer may run server-side and not carry the staff cookie).

If the designer wants to write multiple per-colour snapshots in one round-trip, accept an array form — but single-row form is the v1 contract.

### Task 8.4 — Designer-tool side wiring (separate sub-app)

Out of this repo. Track as a follow-up issue against the design-tool sub-app:
- Read launch context from URL params.
- Load product image + per-(view, colour) print areas via existing API.
- On "Save and return": compose snapshot, upload to Storage `org-artworks/{org_id}/snapshots/{link_id}-{color_swatch_id}.png`, POST to Task 8.3.
- Redirect to `return_url`.

### Task 8.5 — PDP swatch image preference

**File:** `print-room-portal/components/shop/DecorationSwatchPicker.tsx` (modify Task 5.3 output)

The Phase 5 type already carries `snapshotUrl` and `snapshotColorSwatchId`. Pre-Phase-8 they're always null; post-Phase-8 they're populated by the designer.

Once Phase 8 lands, the loader (`lib/shop/decorations.ts`) returns one `DecorationOption` per snapshot row — i.e. the same `org_decoration` may appear multiple times in the array, once per `(snapshot_color_swatch_id)`. Update the loader to group decorations by `decorationId` for the picker:

```ts
const swatchImage =
  decoration.snapshotsByColor.get(selectedColorSwatchId) ??
  decoration.snapshotsByColor.values().next().value ??
  decoration.artworkUrl
```

Pseudocode for the grouped option:

```ts
interface DecorationOption {
  // …Phase 5 fields…
  snapshotsByColor: Map<string | null, string>   // color_swatch_id → snapshot_url
}
```

Now the swatch shows the positioned mockup if available for the customer's selected colour, falls back to the first available snapshot, falls back to the raw artwork. Selection state still keys on a single `linkId` per decoration (multi-pick across decorations, single-snapshot per decoration on display).

### Task 8.6 — End-to-end smoke test

1. Companion plan shipped — Camel Hat has per-colour `product_images` rows with print areas.
2. Staff opens PRT catalogue → Camel Hat row → Decorations → "Embroidery — Left Chest" chip → Configure with designer.
3. Designer opens with the camel-cap image + Left Chest print area pre-selected.
4. Staff positions the Acme logo, saves. Designer composites → uploads → POSTs callback → redirects back.
5. Reload catalogue editor — chip now shows the snapshot thumbnail.
6. Repeat for the black-cap colourway. Two snapshot rows now exist for the same `(catalogue_item, decoration)`.
7. Customer (PRT user) opens `/shop/<camel-hat-id>` → swatch shows the camel-cap-with-logo composite. Switch colour to black → swatch updates to the black-cap-with-logo composite.

End of Phase 8: PDP shows true mockups. Manual-apply path still works for orgs without the designer round-trip.

---

## Phase 9 — Customer designer "Save to org library"

**Order:** lands after Phase 8. Orthogonal blast radius — the customer-side designer change doesn't touch staff portal or PDP.

### Task 9.1 — API endpoint to promote a `design_artwork` row

**File:** `print-room-portal/app/api/designer/save-to-org-library/route.ts` (new)

`POST` body: `{ design_artwork_id: string, name?: string }`. Server-side:

1. Auth: `requireB2BCustomer()` — must be in an org.
2. Resolve the source `design_artwork` row. Assert `designs.org_id === context.organizationId`.
3. Server-side Storage copy: download object from `design-artwork` bucket → re-upload to `org-artworks/{org_id}/{new_artwork_id}-{slug}.{ext}`.
4. Compute SHA256 from the downloaded bytes.
5. INSERT into `organization_artworks` with `ON CONFLICT (organization_id, sha256) DO UPDATE SET updated_at=now() RETURNING id`. Dedup wins — if the same logo was already saved, returns the existing row.
6. Return `{ artwork_id, was_existing: boolean }`.

### Task 9.2 — UI: "Save to organisation library" button in customer designer

**File:** in the customer-side designer flow (separate sub-app or component cluster — confirm at task time).

After artwork upload succeeds in the designer, show a small "Save to organisation library" button. Click → POST to Task 9.1. Toast on success: "Saved to your library — your account manager can now use this for production."

If `was_existing: true`, toast says "Already in your library." (Acknowledges the dedup, doesn't error.)

### Task 9.3 — Smoke test

1. As a PRT user, open the customer designer, upload a logo.
2. Click "Save to organisation library."
3. As staff, open `/b2b-accounts/<PRT-org-id>/artworks` — the logo appears in the library with the expected metadata.
4. Repeat with the same file → toast says "already in your library", staff library shows one row (not two).
5. Convert the library artwork into a decoration (Phase 2 staff UI), attach to a catalogue item (Phase 3), confirm PDP renders.

End of Phase 9: customer-uploaded logos can flow into the org library without staff intervention. Closes the artwork-lifecycle loop.
