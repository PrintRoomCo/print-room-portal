# MTF Location Dropdown (Feature 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an org (MTF) attach a required, org-scoped "location" dropdown to chosen products so each garment carries a selected branch, that value keeps the cart line distinct, persists on the order, and lands in a Monday production-board column — and fix the subitem-title bug so the feature ships on a correct structure.

**Architecture:** Schema + all staff tooling live in `print-room-staff-portal` (it owns the shared Supabase schema). A new `org_line_datasets` (named list) + `org_line_dataset_values` (~60 rows) pair is CSV-imported once per org and assigned per product via a nullable `b2b_catalogue_items.line_dataset_id`. The customer portal (`print-room-portal`) reads the assigned dataset's values on the PDP, hard-gates add-to-cart on a selection, carries the selected **label** on the cart line (into `lineSignature` only, never the tier key), and snapshots it to `quote_items.line_location_label` via the existing post-RPC follow-up UPDATE. Monday's subitem builder writes that label to a new Location column; a separate first task fixes the subitem title.

**Tech Stack:** Next.js 16 (both repos, App Router), TypeScript (strict), Supabase (Postgres + RLS, service-role routes), Vitest, `csv-parse/sync`, Monday.com GraphQL.

## Global Constraints

- **Schema changes are migration files in `print-room-staff-portal/supabase/migrations/`, applied via `supabase db push`.** NEVER via the Supabase dashboard or MCP `apply_migration` (that caused the drift fixed 2026-07-20). The `.env.local` dotenv quirk means schema commands run as: `mv .env.local .env.local.bak && supabase db push ; mv .env.local.bak .env.local` (project already linked to `bthsxgmcnbvwwgvdveek`). Deferred (not-ready) migrations go in `db/pending-migrations/`, not `supabase/migrations/`.
- **`print-room-portal` has NO migrations** — its `supabase/migrations/README.md` says the directory is intentionally empty; all schema for either app is authored in the staff repo.
- **The location dropdown is REQUIRED with NO default** — hard-gate add-to-cart (mirror the MOQ gate). A default risks a silent wrong-location order.
- **Per-garment grain:** the selected value goes into `lineSignature()` (distinct lines) but MUST NOT go into `tierAggregationKey` / `recomputeProductTierPrices` (product+decoration pooling is unaffected) — exactly how `sizeId` is handled today.
- **Monday board structure is Jon's to own; confirm "location-as-column" (not item title) with Chris before creating the column.** New Monday columns are created via the Monday MCP; capture the real column IDs into `column-ids.ts`.
- **Test/verification emails go to `jamie@theprint-room.co.nz`, never `jon@`.**
- **Typecheck is diff-against-baseline, not hard-zero:** customer repo `npx tsc --noEmit --incremental false` has 14 pre-existing errors confined to `lib/__tests__/next-config-redirects.test.ts` and `lib/email/__tests__/tracker-notification.test.ts` (both unrelated); staff repo `npx tsc --noEmit` has ~20 pre-existing catalogue failures. "Green" = no NEW errors in touched files.
- **Deadline: 26 July = hard MTF go-live**, solo (Jamie + Claude assist). Task 1 (title fix) ships independently and first; the go-live ops track (Appendix) runs in parallel.
- **Naming (locked for type-consistency across tasks):** tables `org_line_datasets` / `org_line_dataset_values`; catalogue column `line_dataset_id`; order-line snapshot column `quote_items.line_location_label` (text, label-only snapshot — no per-line value FK; see Task 2 note); CartLine field `locationLabel`; PDP prop `locationOptions: LocationOption[]` where `LocationOption = { value: string; label: string }` (value = `org_line_dataset_values.id`); POST/checkout field `location_label`; Monday field `location`; CRUD base `/api/orgs/[orgId]/line-datasets`; CSV parser `parseDatasetValuesCsv`.

---

## File Structure

**`print-room-staff-portal` (schema + tooling):**
- Create: `supabase/migrations/<ts>_org_line_datasets_and_quote_item_location.sql` — the one feature-1 migration (2 new tables + 2 new columns).
- Create: `src/lib/line-datasets/parse-values-csv.ts` — pure CSV→rows parser (models `bulk-members.ts`). Test alongside.
- Create: `src/app/api/orgs/[orgId]/line-datasets/route.ts` (GET list + POST create) and `.../[datasetId]/route.ts` (PATCH + DELETE) — models `org_decorations` CRUD.
- Create: `src/app/api/orgs/[orgId]/line-datasets/[datasetId]/values/route.ts` (PUT dry-run/apply replace) — models the `b2b_catalogue_item_colors` PUT + `bulk-members` dry-run contract.
- Create: `src/app/(portal)/b2b-accounts/[orgId]/line-datasets/page.tsx` + `src/components/b2b-accounts/LineDatasetsPanel.tsx` + `src/components/b2b-accounts/LineDatasetValuesDialog.tsx` — management UI (models `DecorationsTable` + `BulkUploadDialog`).
- Modify: `src/components/catalogues/CatalogueItemEditor.tsx`, `src/app/api/catalogues/[id]/items/[itemId]/route.ts`, `src/app/(portal)/catalogues/[id]/items/[itemId]/page.tsx` — add the per-product `line_dataset_id` assignment dropdown.
- Modify: `src/app/api/orders/[id]/retry-monday-push/route.ts` + `src/lib/monday/deal-item.ts` (if the file exists here) — mirror the customer-repo Monday changes.

**`print-room-portal` (customer):**
- Modify: `lib/cart/types.ts` (CartLine + `lineSignature`), `lib/cart/normalize.ts` (persist whitelist), `components/cart/CartProvider.tsx` (thread into `addLine`).
- Modify: `components/shop/ProductDetailClient.tsx` (dropdown + gate) and `app/(portal)/catalogue/[productId]/page.tsx` (load `locationOptions`).
- Modify: `components/checkout/CheckoutReviewClient.tsx` (POST body), `lib/checkout/submit.ts` (`CheckoutLineInput` + follow-up UPDATE), `app/api/checkout/route.ts` (validation).
- Modify: `lib/monday/deal-item.ts` (title fix + location/decoration columns), `lib/monday/column-ids.ts` (new subitem column IDs).

---

## Task 1: Monday subitem title bug fix — SHIP INDEPENDENTLY, DO FIRST

Fixes every current order (not just MTF): subitem titles read `Custom Decoration: {product}` because `designName` defaults to the decoration's name. No schema, no board changes — shippable today. Decoration text is **not lost** (it stays in the Job Specs long-text at `deal-item.ts:443`); Task 11 elevates it to its own column.

**Files:**
- Modify: `print-room-portal/lib/monday/deal-item.ts:607`
- Test: `print-room-portal/lib/monday/__tests__/deal-item.order-mode.test.ts`
- Verify (separate repo): `print-room-staff-portal` — check whether it has its own `src/lib/monday/deal-item.ts` with the same line and mirror the fix.

**Interfaces:**
- Consumes: `createOrderDealSubitem(parentItemId, line: OrderLineForMonday)` (unchanged signature).
- Produces: subitem `item_name` === `line.productName` (no `designName` prefix).

- [ ] **Step 1: Write the failing test** — add to `deal-item.order-mode.test.ts` (the fixture at the top already has a line with `productName: 'Basic Tee'`, `designName: 'Logo Front'`):

```ts
it('subitem name is the product name only (no decoration prefix)', async () => {
  mockedCall
    .mockResolvedValueOnce({ create_item: { id: '900', name: 'Acme Co' } }) // parent
    .mockResolvedValue({ create_subitem: { id: 'sub-1' } })                 // subitems
  await pushOrderDeal(fixture)

  // First create_subitem call (calls[1]) — assert the item_name variable.
  const subitemCall = mockedCall.mock.calls[1]
  expect(subitemCall[1]).toMatchObject({ itemName: 'Basic Tee' })
  expect(subitemCall[1].itemName).not.toContain(':')
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/monday/__tests__/deal-item.order-mode.test.ts -t "product name only"`
Expected: FAIL — `itemName` is currently `'Logo Front: Basic Tee'`.

- [ ] **Step 3: Apply the one-line fix** — `deal-item.ts:607`:

```ts
// before:
  const itemName = `${line.designName}: ${line.productName}`
// after:
  const itemName = line.productName
```

- [ ] **Step 4: Run the test to verify it passes, and the whole order-mode suite**

Run: `npx vitest run lib/monday/__tests__/deal-item.order-mode.test.ts`
Expected: PASS (all tests, including the new one).

- [ ] **Step 5: Mirror in the staff repo if present**

Run: `grep -rn 'designName}: ${line.productName' /Users/jamierogangeorge/Documents/print-room-staff-portal/src`
If it matches (staff repo has its own `deal-item.ts`), apply the identical `const itemName = line.productName` change there and run that repo's `npx vitest run <file>`. If no match, note "staff repo has no duplicate subitem-title site" in the commit body.

- [ ] **Step 6: Commit**

```bash
git -C /Users/jamierogangeorge/Documents/print-room-portal add lib/monday/deal-item.ts lib/monday/__tests__/deal-item.order-mode.test.ts
git -C /Users/jamierogangeorge/Documents/print-room-portal commit -m "fix(monday): subitem title is product name, not decoration-prefixed"
```

---

## Task 2: Feature-1 schema migration (staff repo)

One migration file: the two dataset tables + the two consumer columns. Mirrors the `org_decorations` shape (uuid PK via `gen_random_uuid()`, `organization_id` FK `ON DELETE CASCADE`, `UNIQUE(organization_id, name)`, RLS via `user_organizations`, blanket 3-role grants).

**Design note — label-only order snapshot.** `quote_items` stores only `line_location_label text` (a frozen snapshot of the chosen label, exactly like `size_label` snapshots the size). No per-line value FK: an order line should freeze the label at order time (a later branch rename must not rewrite history), the label is all Monday/display/filtering need, and it halves the threading surface. `org_line_dataset_values` still has its own `id` PK (drives the values CRUD + the PDP option keys); `b2b_catalogue_items.line_dataset_id` FKs the **dataset**, not a value.

**Files:**
- Create: `print-room-staff-portal/supabase/migrations/<ts>_org_line_datasets_and_quote_item_location.sql` (use a real UTC timestamp for `<ts>`, e.g. `20260722HHMMSS`).

**Interfaces:**
- Produces (consumed by Tasks 3–11): tables `public.org_line_datasets(id uuid, organization_id uuid, name text, created_at, updated_at)`, `public.org_line_dataset_values(id uuid, dataset_id uuid, label text, position int, created_at)`; columns `public.b2b_catalogue_items.line_dataset_id uuid` (nullable FK → `org_line_datasets`, `ON DELETE SET NULL`), `public.quote_items.line_location_label text` (nullable).

- [ ] **Step 1: Write the migration file** (lower-case hand-written style, matching `20260720054337_*.sql`):

```sql
-- Feature 1 (MTF location dropdown): org-scoped "line datasets" + per-line snapshot.
--
-- MTF need a required, org-level dropdown of ~60 branch "locations" attached to
-- chosen products. This adds:
--   * org_line_datasets        — the named list ("MTF Branches"), one per org.
--   * org_line_dataset_values  — the ~60 rows (label + display order).
--   * b2b_catalogue_items.line_dataset_id — nullable per-product assignment;
--     NULL = dropdown off (this single column is on/off + which-dataset in one).
--   * quote_items.line_location_label — frozen label snapshot on the order line
--     (label-only, like size_label; no value FK — orders must not rewrite when a
--     branch is later renamed). The submit path sets it via the existing
--     post-RPC follow-up UPDATE, so submit_b2b_order is unchanged.

-- 1. The dataset (named list), one or more per org.
create table if not exists public.org_line_datasets (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations(id) on delete cascade,
  name            text        not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint org_line_datasets_org_name_key unique (organization_id, name)
);

comment on table public.org_line_datasets is
  'Org-scoped named value list (e.g. "MTF Branches"). Assigned to products via '
  'b2b_catalogue_items.line_dataset_id to drive a required PDP dropdown.';

create index if not exists org_line_datasets_org_idx
  on public.org_line_datasets using btree (organization_id);

alter table public.org_line_datasets enable row level security;

create policy "org members can read line datasets" on public.org_line_datasets
  for select using (organization_id in (
    select uo.organization_id from public.user_organizations uo
    where uo.user_id = (select auth.uid())
  ));

grant all on table public.org_line_datasets to anon;
grant all on table public.org_line_datasets to authenticated;
grant all on table public.org_line_datasets to service_role;

-- 2. The values (~60 rows) under a dataset.
create table if not exists public.org_line_dataset_values (
  id         uuid        primary key default gen_random_uuid(),
  dataset_id uuid        not null references public.org_line_datasets(id) on delete cascade,
  label      text        not null,
  position   integer     not null default 0,
  created_at timestamptz not null default now(),
  constraint org_line_dataset_values_dataset_label_key unique (dataset_id, label)
);

comment on table public.org_line_dataset_values is
  'Values under an org_line_datasets row. label is unique per dataset (drives the '
  'PDP dropdown; the chosen label is snapshotted onto quote_items.line_location_label).';

create index if not exists org_line_dataset_values_dataset_idx
  on public.org_line_dataset_values using btree (dataset_id, position);

alter table public.org_line_dataset_values enable row level security;

create policy "org members can read line dataset values" on public.org_line_dataset_values
  for select using (exists (
    select 1
    from public.org_line_datasets d
    join public.user_organizations uo on uo.organization_id = d.organization_id
    where d.id = org_line_dataset_values.dataset_id
      and uo.user_id = (select auth.uid())
  ));

grant all on table public.org_line_dataset_values to anon;
grant all on table public.org_line_dataset_values to authenticated;
grant all on table public.org_line_dataset_values to service_role;

-- 3. Per-product assignment (nullable = dropdown off). Mirrors card_image_id's
--    nullable-FK ON DELETE SET NULL pattern.
alter table public.b2b_catalogue_items
  add column if not exists line_dataset_id uuid;

comment on column public.b2b_catalogue_items.line_dataset_id is
  'Per customer x product assignment of an org_line_datasets list. NULL = no '
  'location dropdown for this item. Drives a required PDP dropdown when set.';

alter table public.b2b_catalogue_items
  drop constraint if exists b2b_catalogue_items_line_dataset_id_fkey;
alter table public.b2b_catalogue_items
  add constraint b2b_catalogue_items_line_dataset_id_fkey
  foreign key (line_dataset_id) references public.org_line_datasets(id) on delete set null;

create index if not exists b2b_catalogue_items_line_dataset_idx
  on public.b2b_catalogue_items using btree (line_dataset_id)
  where line_dataset_id is not null;

-- 4. Frozen label snapshot on the order line (label-only, like size_label).
alter table public.quote_items
  add column if not exists line_location_label text;

comment on column public.quote_items.line_location_label is
  'Frozen snapshot of the PDP location dropdown label chosen for this line '
  '(e.g. "MTF Avalon"). NULL for products without a line dataset. Set by the '
  'portal checkout follow-up UPDATE; read by the Monday production-board push.';
```

- [ ] **Step 2: Apply the migration** (from the staff repo root):

```bash
cd /Users/jamierogangeorge/Documents/print-room-staff-portal
mv .env.local .env.local.bak && supabase db push ; mv .env.local.bak .env.local
```
Expected: the new migration applies with no error; `supabase migration list` shows it as applied.

- [ ] **Step 3: Verify the schema landed** (READ-only MCP is allowed; only `apply_migration` is banned). Confirm the two tables + two columns exist:

Use `mcp__supabase__list_tables` (schema `public`) and confirm `org_line_datasets` + `org_line_dataset_values` are present, or run a read query via `mcp__supabase__execute_sql`:
```sql
select table_name, column_name from information_schema.columns
where (table_name = 'org_line_datasets')
   or (table_name = 'org_line_dataset_values')
   or (table_name = 'b2b_catalogue_items' and column_name = 'line_dataset_id')
   or (table_name = 'quote_items' and column_name = 'line_location_label')
order by table_name, column_name;
```
Expected rows: the two new tables' columns, plus `b2b_catalogue_items.line_dataset_id` and `quote_items.line_location_label`.

- [ ] **Step 4: Commit**

```bash
git -C /Users/jamierogangeorge/Documents/print-room-staff-portal add supabase/migrations/
git -C /Users/jamierogangeorge/Documents/print-room-staff-portal commit -m "feat(schema): org line datasets + quote_items location snapshot (feature 1)"
```

---

## Task 3: CSV values parser (staff repo lib)

Pure function that parses a values CSV into classified rows. Models `parseMembersCsv` (`csv-parse/sync`, alias map, per-row `kind`), but the payload is a flat single-column list (a `label`, optional `position`).

**Files:**
- Create: `print-room-staff-portal/src/lib/line-datasets/parse-values-csv.ts`
- Test: `print-room-staff-portal/src/lib/line-datasets/parse-values-csv.test.ts`

**Interfaces:**
- Produces: `parseDatasetValuesCsv(csv: string): ParseValuesResult` where `ParseValuesResult = { rows: ParsedValueRow[]; headerError?: string }` and `ParsedValueRow = { rowNumber: number; label: string; position: number; kind: 'ok' | 'invalid' | 'duplicate'; reason?: string }`. Consumed by Task 5.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { parseDatasetValuesCsv } from './parse-values-csv'

describe('parseDatasetValuesCsv', () => {
  it('parses a single-column label list, positioned in file order', () => {
    const res = parseDatasetValuesCsv('Location\nMTF Avalon\nMTF Newmarket')
    expect(res.headerError).toBeUndefined()
    expect(res.rows).toEqual([
      { rowNumber: 1, label: 'MTF Avalon', position: 1, kind: 'ok' },
      { rowNumber: 2, label: 'MTF Newmarket', position: 2, kind: 'ok' },
    ])
  })

  it('accepts alias headers case-insensitively (Branch / Value / Name)', () => {
    expect(parseDatasetValuesCsv('Branch\nX').rows[0]).toMatchObject({ label: 'X', kind: 'ok' })
    expect(parseDatasetValuesCsv('value\nY').rows[0]).toMatchObject({ label: 'Y', kind: 'ok' })
  })

  it('flags blank labels invalid and the second duplicate as duplicate (first kept)', () => {
    const res = parseDatasetValuesCsv('Location\nMTF Avalon\n\nMTF Avalon')
    expect(res.rows.find((r) => r.label === '')).toBeUndefined() // fully blank rows skipped
    expect(res.rows.filter((r) => r.kind === 'duplicate')).toHaveLength(1)
  })

  it('returns a fatal headerError when no label-like column is present', () => {
    expect(parseDatasetValuesCsv('Colour,Size\nRed,M').headerError).toBeTruthy()
  })

  it('parses a UTF-8 BOM-prefixed export (Excel)', () => {
    const res = parseDatasetValuesCsv('﻿Location\nMTF Avalon')
    expect(res.rows[0]).toMatchObject({ label: 'MTF Avalon', kind: 'ok' })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/line-datasets/parse-values-csv.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the parser**

```ts
import { parse } from 'csv-parse/sync'

export type ValueRowKind = 'ok' | 'invalid' | 'duplicate'

export interface ParsedValueRow {
  /** 1-based emitted-row index (blank rows skipped, header excluded). */
  rowNumber: number
  label: string
  /** 1-based file order, used as org_line_dataset_values.position. */
  position: number
  kind: ValueRowKind
  reason?: string
}

export interface ParseValuesResult {
  rows: ParsedValueRow[]
  /** Fatal: no label column. When set, rows is empty. */
  headerError?: string
}

const LABEL_ALIASES = ['location', 'label', 'value', 'name', 'branch', 'store', 'club']

/** Optional explicit ordering column. */
const POSITION_ALIASES = ['position', 'order', 'sort', 'sort order']

function findCol(headers: string[], aliases: string[]): number {
  const norm = headers.map((h) => (h ?? '').trim().toLowerCase())
  return norm.findIndex((h) => aliases.includes(h))
}

export function parseDatasetValuesCsv(csv: string): ParseValuesResult {
  let records: string[][]
  try {
    records = parse(csv, { skip_empty_lines: true, relax_column_count: true, trim: true, bom: true }) as string[][]
  } catch (e) {
    return { rows: [], headerError: `Could not parse CSV: ${(e as Error).message}` }
  }
  if (records.length === 0) return { rows: [], headerError: 'The file is empty.' }

  const labelCol = findCol(records[0], LABEL_ALIASES)
  if (labelCol === -1) {
    return {
      rows: [],
      headerError:
        'Could not find a label column. Expected a header like Location, Label, Value, Name or Branch.',
    }
  }
  const posCol = findCol(records[0], POSITION_ALIASES)

  const seen = new Set<string>()
  const rows: ParsedValueRow[] = []
  for (let i = 1; i < records.length; i++) {
    const rec = records[i]
    const cell = (idx: number) => (idx >= 0 && idx < rec.length ? (rec[idx] ?? '').trim() : '')
    const label = cell(labelCol)
    if (!label && !cell(posCol)) continue // fully blank row

    const position = rows.length + 1
    const base = { rowNumber: rows.length + 1, label, position }

    if (!label) {
      rows.push({ ...base, kind: 'invalid', reason: 'Missing value' })
      continue
    }
    const key = label.toLowerCase()
    if (seen.has(key)) {
      rows.push({ ...base, kind: 'duplicate', reason: 'Duplicate value in file' })
      continue
    }
    seen.add(key)
    rows.push({ ...base, kind: 'ok' })
  }
  return { rows }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/line-datasets/parse-values-csv.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git -C /Users/jamierogangeorge/Documents/print-room-staff-portal add src/lib/line-datasets/
git -C /Users/jamierogangeorge/Documents/print-room-staff-portal commit -m "feat(line-datasets): CSV values parser"
```

---

## Task 4: Dataset CRUD API (staff repo)

List/create/update/delete datasets. Models `org_decorations` routes exactly: `requireB2BAccountsStaffAccess` gate, `23505` → 409 on duplicate name, `23503` → 409 on delete-while-referenced.

**Files:**
- Create: `print-room-staff-portal/src/app/api/orgs/[orgId]/line-datasets/route.ts` (GET + POST)
- Create: `print-room-staff-portal/src/app/api/orgs/[orgId]/line-datasets/[datasetId]/route.ts` (PATCH + DELETE)
- Test: `print-room-staff-portal/src/app/api/orgs/[orgId]/line-datasets/route.test.ts`

**Interfaces:**
- Produces (consumed by Task 6): `GET /api/orgs/[orgId]/line-datasets` → `{ datasets: Array<{ id, organization_id, name, created_at, value_count }> }`; `POST` body `{ name }` → `{ dataset }`; `PATCH .../[datasetId]` body `{ name }` → `{ dataset }`; `DELETE .../[datasetId]` → `{ ok: true }`.

- [ ] **Step 1: Write the failing route test** (mirror `members/bulk/route.test.ts`: `vi.hoisted` + `vi.mock` the auth gate, hand-rolled fake admin client):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({ requireB2BAccountsStaffAccess: vi.fn() }))
vi.mock('@/lib/b2b-accounts/server', () => ({
  requireB2BAccountsStaffAccess: mocks.requireB2BAccountsStaffAccess,
}))

import { POST as POSTRaw } from './route'
const POST = POSTRaw as unknown as (req: Request, ctx: { params: Promise<{ orgId: string }> }) => Promise<Response>

function req(body: unknown) {
  return new Request('http://t/api/orgs/o1/line-datasets', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}
const ctx = (orgId: string) => ({ params: Promise.resolve({ orgId }) })

beforeEach(() => vi.clearAllMocks())

describe('POST /api/orgs/[orgId]/line-datasets', () => {
  it('400s on a blank name', async () => {
    mocks.requireB2BAccountsStaffAccess.mockResolvedValue({ admin: {}, context: { userId: 's1' } })
    const res = await POST(req({ name: '  ' }), ctx('o1'))
    expect(res.status).toBe(400)
  })

  it('409s on a duplicate name (Postgres 23505)', async () => {
    const admin = {
      from: () => ({
        insert: () => ({
          select: () => ({ single: async () => ({ data: null, error: { code: '23505', message: 'dup' } }) }),
        }),
      }),
    }
    mocks.requireB2BAccountsStaffAccess.mockResolvedValue({ admin, context: { userId: 's1' } })
    const res = await POST(req({ name: 'MTF Branches' }), ctx('o1'))
    expect(res.status).toBe(409)
  })

  it('creates and returns the dataset', async () => {
    const admin = {
      from: () => ({
        insert: () => ({
          select: () => ({ single: async () => ({ data: { id: 'd1', organization_id: 'o1', name: 'MTF Branches' }, error: null }) }),
        }),
      }),
    }
    mocks.requireB2BAccountsStaffAccess.mockResolvedValue({ admin, context: { userId: 's1' } })
    const res = await POST(req({ name: 'MTF Branches' }), ctx('o1'))
    expect(res.status).toBe(200)
    expect((await res.json()).dataset).toMatchObject({ id: 'd1', name: 'MTF Branches' })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/app/api/orgs/[orgId]/line-datasets/route.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `route.ts` (GET + POST)**

```ts
import { NextResponse } from 'next/server'
import { requireB2BAccountsStaffAccess } from '@/lib/b2b-accounts/server'

export async function GET(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const auth = await requireB2BAccountsStaffAccess(request)
  if ('error' in auth) return auth.error
  const { orgId } = await params

  const { data, error } = await auth.admin
    .from('org_line_datasets')
    .select('id, organization_id, name, created_at, org_line_dataset_values(count)')
    .eq('organization_id', orgId)
    .order('name', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const datasets = (data ?? []).map((d: Record<string, unknown>) => ({
    id: d.id, organization_id: d.organization_id, name: d.name, created_at: d.created_at,
    value_count: Array.isArray(d.org_line_dataset_values)
      ? ((d.org_line_dataset_values[0] as { count?: number })?.count ?? 0) : 0,
  }))
  return NextResponse.json({ datasets })
}

interface PostBody { name?: string }

export async function POST(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const auth = await requireB2BAccountsStaffAccess(request)
  if ('error' in auth) return auth.error
  const { admin } = auth
  const { orgId } = await params

  let body: PostBody = {}
  try { body = (await request.json()) as PostBody } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const name = (body.name ?? '').trim()
  if (!name) return NextResponse.json({ error: 'Name is required.' }, { status: 400 })

  const { data, error } = await admin
    .from('org_line_datasets')
    .insert({ organization_id: orgId, name })
    .select('id, organization_id, name, created_at')
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'A dataset with that name already exists for this org.' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ dataset: data })
}
```

- [ ] **Step 4: Implement `[datasetId]/route.ts` (PATCH + DELETE)**

```ts
import { NextResponse } from 'next/server'
import { requireB2BAccountsStaffAccess } from '@/lib/b2b-accounts/server'

interface PatchBody { name?: string }

export async function PATCH(request: Request, { params }: { params: Promise<{ orgId: string; datasetId: string }> }) {
  const auth = await requireB2BAccountsStaffAccess(request)
  if ('error' in auth) return auth.error
  const { admin } = auth
  const { orgId, datasetId } = await params

  let body: PatchBody = {}
  try { body = (await request.json()) as PatchBody } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const name = (body.name ?? '').trim()
  if (!name) return NextResponse.json({ error: 'Name is required.' }, { status: 400 })

  const { data, error } = await admin
    .from('org_line_datasets')
    .update({ name, updated_at: new Date().toISOString() })
    .eq('id', datasetId).eq('organization_id', orgId)
    .select('id, organization_id, name, created_at').single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'A dataset with that name already exists for this org.' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ dataset: data })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ orgId: string; datasetId: string }> }) {
  const auth = await requireB2BAccountsStaffAccess(_request)
  if ('error' in auth) return auth.error
  const { orgId, datasetId } = await params

  const { error } = await auth.admin
    .from('org_line_datasets').delete().eq('id', datasetId).eq('organization_id', orgId)

  if (error) {
    if (error.code === '23503') {
      return NextResponse.json(
        { error: 'This dataset is assigned to one or more products. Unassign it first.' },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
```
> Note: `b2b_catalogue_items.line_dataset_id` is `ON DELETE SET NULL`, so a delete won't 23503 on catalogue assignment — the 23503 branch is defensive. Values cascade (`ON DELETE CASCADE`).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/app/api/orgs/[orgId]/line-datasets/route.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git -C /Users/jamierogangeorge/Documents/print-room-staff-portal add src/app/api/orgs/
git -C /Users/jamierogangeorge/Documents/print-room-staff-portal commit -m "feat(line-datasets): dataset CRUD API"
```

---

## Task 5: Dataset values bulk-replace API (staff repo)

`PUT` with a `dryRun` flag (default true) that parses the CSV via Task 3, classifies rows, and on apply does a **delete-then-bulk-insert replace** of the dataset's values (models `b2b_catalogue_item_colors` PUT). Same `{ summary, rows }` response for both dry-run and apply, so the dialog (Task 6) tells them apart only by the flag it sent.

**Files:**
- Create: `print-room-staff-portal/src/app/api/orgs/[orgId]/line-datasets/[datasetId]/values/route.ts`
- Test: `print-room-staff-portal/src/app/api/orgs/[orgId]/line-datasets/[datasetId]/values/route.test.ts`

**Interfaces:**
- Consumes: `parseDatasetValuesCsv` (Task 3).
- Produces (consumed by Task 6): `PUT` body `{ csv?: string; fileBase64?: string; dryRun?: boolean }` → `{ summary: { ok: number; invalid: number; duplicate: number }, rows: ParsedValueRow[] }`. On `dryRun:false` also replaces `org_line_dataset_values` for the dataset with the `ok` rows.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({ requireB2BAccountsStaffAccess: vi.fn() }))
vi.mock('@/lib/b2b-accounts/server', () => ({ requireB2BAccountsStaffAccess: mocks.requireB2BAccountsStaffAccess }))

import { PUT as PUTRaw } from './route'
const PUT = PUTRaw as unknown as (req: Request, ctx: { params: Promise<{ orgId: string; datasetId: string }> }) => Promise<Response>

const ctx = (orgId: string, datasetId: string) => ({ params: Promise.resolve({ orgId, datasetId }) })
function req(body: unknown) {
  return new Request('http://t', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

/** Fake admin: dataset belongs to org; capture inserts/deletes. */
function makeAdmin() {
  const deleted: string[] = []
  const inserted: unknown[][] = []
  const admin = {
    from(table: string) {
      if (table === 'org_line_datasets') {
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'd1' } }) }) }) }) }
      }
      // org_line_dataset_values
      return {
        delete: () => ({ eq: (_c: string, v: string) => { deleted.push(v); return Promise.resolve({ error: null }) } }),
        insert: (rows: unknown[]) => { inserted.push(rows); return Promise.resolve({ error: null }) },
      }
    },
  }
  return { admin, deleted, inserted }
}

beforeEach(() => vi.clearAllMocks())

describe('PUT .../line-datasets/[datasetId]/values', () => {
  it('dryRun classifies and writes nothing', async () => {
    const f = makeAdmin()
    mocks.requireB2BAccountsStaffAccess.mockResolvedValue({ admin: f.admin, context: { userId: 's1' } })
    const res = await PUT(req({ csv: 'Location\nA\nA\n', dryRun: true }), ctx('o1', 'd1'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.summary).toMatchObject({ ok: 1, duplicate: 1 })
    expect(f.inserted).toHaveLength(0)
    expect(f.deleted).toHaveLength(0)
  })

  it('apply replaces values with the ok rows', async () => {
    const f = makeAdmin()
    mocks.requireB2BAccountsStaffAccess.mockResolvedValue({ admin: f.admin, context: { userId: 's1' } })
    const res = await PUT(req({ csv: 'Location\nA\nB\n', dryRun: false }), ctx('o1', 'd1'))
    expect(res.status).toBe(200)
    expect(f.deleted).toEqual(['d1'])
    expect(f.inserted[0]).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run "src/app/api/orgs/[orgId]/line-datasets/[datasetId]/values/route.test.ts"`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `values/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { requireB2BAccountsStaffAccess } from '@/lib/b2b-accounts/server'
import { parseDatasetValuesCsv } from '@/lib/line-datasets/parse-values-csv'

interface PutBody { csv?: string; fileBase64?: string; dryRun?: boolean }

export async function PUT(request: Request, { params }: { params: Promise<{ orgId: string; datasetId: string }> }) {
  const auth = await requireB2BAccountsStaffAccess(request)
  if ('error' in auth) return auth.error
  const { admin } = auth
  const { orgId, datasetId } = await params

  let body: PutBody = {}
  try { body = (await request.json()) as PutBody } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const dryRun = body.dryRun !== false

  const csv =
    typeof body.fileBase64 === 'string' && body.fileBase64.length > 0
      ? Buffer.from(body.fileBase64, 'base64').toString('utf-8')
      : (body.csv ?? '')
  const parsed = parseDatasetValuesCsv(csv)
  if (parsed.headerError) return NextResponse.json({ error: parsed.headerError }, { status: 400 })

  // Dataset must belong to this org.
  const { data: ds } = await admin
    .from('org_line_datasets').select('id').eq('id', datasetId).eq('organization_id', orgId).maybeSingle()
  if (!ds) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })

  const summary = {
    ok: parsed.rows.filter((r) => r.kind === 'ok').length,
    invalid: parsed.rows.filter((r) => r.kind === 'invalid').length,
    duplicate: parsed.rows.filter((r) => r.kind === 'duplicate').length,
  }

  if (!dryRun && summary.ok > 0) {
    const { error: clearErr } = await admin
      .from('org_line_dataset_values').delete().eq('dataset_id', datasetId)
    if (clearErr) return NextResponse.json({ error: clearErr.message }, { status: 500 })

    const rows = parsed.rows
      .filter((r) => r.kind === 'ok')
      .map((r) => ({ dataset_id: datasetId, label: r.label, position: r.position }))
    const { error: insErr } = await admin.from('org_line_dataset_values').insert(rows)
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })
  }

  return NextResponse.json({ summary, rows: parsed.rows }, { status: 200 })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run "src/app/api/orgs/[orgId]/line-datasets/[datasetId]/values/route.test.ts"`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git -C /Users/jamierogangeorge/Documents/print-room-staff-portal add "src/app/api/orgs/[orgId]/line-datasets/[datasetId]/values/"
git -C /Users/jamierogangeorge/Documents/print-room-staff-portal commit -m "feat(line-datasets): values bulk-replace (dry-run + apply)"
```

---

## Task 6: Dataset management UI (staff repo)

A page under the org that lists datasets, lets staff create/rename/delete one, and upload the values CSV via a two-step (Preview → Import) dialog. Models `DecorationsTable` (list + optimistic delete) and `BulkUploadDialog` (`call(dryRun)`, file→base64, summary+rows preview). This is the least-testable task (UI); verification is manual against a real org.

**Files:**
- Create: `print-room-staff-portal/src/app/(portal)/b2b-accounts/[orgId]/line-datasets/page.tsx`
- Create: `print-room-staff-portal/src/components/b2b-accounts/LineDatasetsPanel.tsx`
- Create: `print-room-staff-portal/src/components/b2b-accounts/LineDatasetValuesDialog.tsx`

**Interfaces:**
- Consumes: Tasks 4 + 5 routes.
- Produces: a working staff surface to seed MTF's dataset (used by go-live ops in the Appendix).

- [ ] **Step 1: Server page — load org + datasets, render the panel.** Mirror `b2b-accounts/[orgId]/decorations/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { LineDatasetsPanel } from '@/components/b2b-accounts/LineDatasetsPanel'

export default async function LineDatasetsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params
  const admin = getSupabaseAdmin()

  const { data: org } = await admin
    .from('organizations').select('id, name').eq('id', orgId).is('deleted_at', null).maybeSingle()
  if (!org) notFound()

  const { data: datasets } = await admin
    .from('org_line_datasets')
    .select('id, organization_id, name, created_at, org_line_dataset_values(count)')
    .eq('organization_id', orgId).order('name', { ascending: true })

  const rows = (datasets ?? []).map((d: Record<string, unknown>) => ({
    id: String(d.id), name: String(d.name),
    value_count: Array.isArray(d.org_line_dataset_values)
      ? ((d.org_line_dataset_values[0] as { count?: number })?.count ?? 0) : 0,
  }))

  return <LineDatasetsPanel organizationId={orgId} organizationName={org.name} initialDatasets={rows} />
}
```

- [ ] **Step 2: `LineDatasetsPanel.tsx`** — list + create/rename/delete, opening `LineDatasetValuesDialog` per row. Copy the shape of `DecorationsTable.tsx` (`openCreate`/`openEdit`/`handleDelete` with optimistic `setRows`). Key handlers:

```tsx
'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { LineDatasetValuesDialog } from './LineDatasetValuesDialog'

interface DatasetRow { id: string; name: string; value_count: number }

export function LineDatasetsPanel({
  organizationId, organizationName, initialDatasets,
}: { organizationId: string; organizationName: string; initialDatasets: DatasetRow[] }) {
  const [rows, setRows] = useState<DatasetRow[]>(initialDatasets)
  const [error, setError] = useState<string | null>(null)
  const [valuesFor, setValuesFor] = useState<DatasetRow | null>(null)

  async function createDataset() {
    const name = window.prompt('New dataset name (e.g. "MTF Branches")')?.trim()
    if (!name) return
    const res = await fetch(`/api/orgs/${organizationId}/line-datasets`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    })
    const body = (await res.json().catch(() => ({}))) as { dataset?: DatasetRow; error?: string }
    if (!res.ok || !body.dataset) { setError(body.error ?? 'Create failed.'); return }
    setRows((p) => [...p, { ...body.dataset!, value_count: 0 }].sort((a, b) => a.name.localeCompare(b.name)))
  }

  async function rename(row: DatasetRow) {
    const name = window.prompt('Rename dataset', row.name)?.trim()
    if (!name || name === row.name) return
    const res = await fetch(`/api/orgs/${organizationId}/line-datasets/${row.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    })
    if (!res.ok) { setError('Rename failed.'); return }
    setRows((p) => p.map((r) => (r.id === row.id ? { ...r, name } : r)))
  }

  async function remove(row: DatasetRow) {
    if (!window.confirm(`Delete dataset "${row.name}"? Its values are removed too.`)) return
    const res = await fetch(`/api/orgs/${organizationId}/line-datasets/${row.id}`, { method: 'DELETE' })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      setError(body.error ?? 'Delete failed.'); return
    }
    setRows((p) => p.filter((r) => r.id !== row.id))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Location datasets — {organizationName}</h1>
        <Button size="sm" onClick={createDataset}>New dataset</Button>
      </div>
      {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-[13px] text-red-700">{error}</p>}
      <div className="rounded-2xl border border-black/10">
        {rows.length === 0 && <p className="px-4 py-6 text-sm text-black/50">No datasets yet.</p>}
        {rows.map((row) => (
          <div key={row.id} className="flex items-center gap-3 border-b border-black/5 px-4 py-3 last:border-0">
            <span className="flex-1 font-medium">{row.name}</span>
            <span className="text-sm text-black/50">{row.value_count} values</span>
            <Button size="sm" variant="secondary" onClick={() => setValuesFor(row)}>Values…</Button>
            <Button size="sm" variant="secondary" onClick={() => rename(row)}>Rename</Button>
            <Button size="sm" variant="secondary" onClick={() => remove(row)}>Delete</Button>
          </div>
        ))}
      </div>
      {valuesFor && (
        <LineDatasetValuesDialog
          organizationId={organizationId}
          dataset={valuesFor}
          open={!!valuesFor}
          onOpenChange={(next) => { if (!next) setValuesFor(null) }}
          onImported={(count) => setRows((p) => p.map((r) => (r.id === valuesFor.id ? { ...r, value_count: count } : r)))}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 3: `LineDatasetValuesDialog.tsx`** — copy `BulkUploadDialog.tsx` and retarget it at the values PUT. Keep `fileToBase64`, the single `call(dryRun)` fn, the summary badges, and the row preview list. The only substantive edits vs the template:

```tsx
// endpoint + method:
const r = await fetch(`/api/orgs/${organizationId}/line-datasets/${dataset.id}/values`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ fileBase64: fileB64, dryRun }),
})
// on successful apply, report the ok-count up:
if (!dryRun) { setDone(true); onImported(body.summary?.ok ?? 0) }
// preview rows use ParsedValueRow ({ rowNumber, label, kind, reason }); render label + kind badge instead of clubName/email.
```
Props: `{ organizationId: string; dataset: { id: string; name: string }; open: boolean; onOpenChange: (n: boolean) => void; onImported: (okCount: number) => void }`.

- [ ] **Step 4: Manual verification** (no automated test — UI). Start the staff dev server (`npm run dev`), open `/b2b-accounts/<an org id>/line-datasets`, create "MTF Branches", open Values…, upload a small CSV (`Location\nMTF Avalon\nMTF Newmarket`), Preview (shows 2 ok), Import (count becomes 2). Re-open Values… and re-import to confirm replace (still 2, not 4). Delete the dataset.

- [ ] **Step 5: Typecheck touched files + commit**

Run: `npx tsc --noEmit 2>&1 | grep -E 'line-datasets|LineDataset'` → expect no lines (clean).
```bash
git -C /Users/jamierogangeorge/Documents/print-room-staff-portal add "src/app/(portal)/b2b-accounts/[orgId]/line-datasets/" src/components/b2b-accounts/LineDatasetsPanel.tsx src/components/b2b-accounts/LineDatasetValuesDialog.tsx
git -C /Users/jamierogangeorge/Documents/print-room-staff-portal commit -m "feat(line-datasets): staff management UI (list/CRUD + values CSV import)"
```

---

## Task 7: Per-product assignment dropdown on the catalogue editor (staff repo)

Add a nullable `line_dataset_id` select to `CatalogueItemEditor`, mirroring the `fulfilment_type_override` dropdown and the `card_image_id` nullable-FK PATCH branch. The server page loads the org's datasets to feed the options; the PATCH route allowlists + FK-checks the field.

**Files:**
- Modify: `print-room-staff-portal/src/app/api/catalogues/[id]/items/[itemId]/route.ts` (allowlist + `buildItemPatch` branch + FK check)
- Modify: `print-room-staff-portal/src/app/(portal)/catalogues/[id]/items/[itemId]/page.tsx` (load datasets; add `line_dataset_id` to item select; pass `locationDatasets`)
- Modify: `print-room-staff-portal/src/components/catalogues/CatalogueItemEditor.tsx` (FormState + Dropdown + buildPatch + prop)
- Test: `print-room-staff-portal/src/app/api/catalogues/[id]/items/[itemId]/route.test.ts` (extend if present; else create a focused `buildItemPatch` unit test)

**Interfaces:**
- Consumes: `org_line_datasets` (Task 2), CRUD from Task 4.
- Produces: `b2b_catalogue_items.line_dataset_id` is settable/clearable from the editor; read by the customer PDP loader (Task 9).

- [ ] **Step 1: Write the failing route test** — `buildItemPatch` must pass through `line_dataset_id` as a nullable FK (accept `null`/`''`→`null`, string→string, else error). Add:

```ts
import { describe, it, expect } from 'vitest'
import { buildItemPatch } from './route'

describe('buildItemPatch — line_dataset_id', () => {
  it('passes a string through', () => {
    expect(buildItemPatch({ line_dataset_id: 'd1' }).patch).toMatchObject({ line_dataset_id: 'd1' })
  })
  it('coerces empty string / null to null (clear assignment)', () => {
    expect(buildItemPatch({ line_dataset_id: '' }).patch.line_dataset_id).toBeNull()
    expect(buildItemPatch({ line_dataset_id: null }).patch.line_dataset_id).toBeNull()
  })
  it('rejects a non-string, non-null value', () => {
    expect(buildItemPatch({ line_dataset_id: 42 }).error).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run "src/app/api/catalogues/[id]/items/[itemId]/route.test.ts" -t line_dataset_id`
Expected: FAIL — `line_dataset_id` not in `PATCHABLE`, so it's dropped.

- [ ] **Step 3: Extend the PATCH route.** In `route.ts`: add `'line_dataset_id'` to the `PATCHABLE` tuple; add a branch in `buildItemPatch` identical to `card_image_id`:

```ts
    else if (k === 'line_dataset_id') {
      const raw = body[k]
      if (raw === null || raw === '') patch[k] = null
      else if (typeof raw === 'string') patch[k] = raw
      else return { patch, error: 'invalid line_dataset_id' }
    }
```
And in the `PATCH` handler, before `.update(patch)`, add an org-ownership FK check mirroring the `card_image_id` block:

```ts
  if ('line_dataset_id' in patch && patch.line_dataset_id !== null) {
    const { data: ds } = await admin
      .from('org_line_datasets').select('id')
      .eq('id', patch.line_dataset_id as string)
      .eq('organization_id', catalogue.organization_id) // catalogue already loaded in this handler
      .maybeSingle()
    if (!ds) return NextResponse.json({ error: 'line_dataset_id does not belong to this org' }, { status: 400 })
  }
```
> If the handler doesn't already have `catalogue.organization_id` in scope, load it once: `const { data: catalogue } = await admin.from('b2b_catalogues').select('organization_id').eq('id', id).single()`.

- [ ] **Step 4: Run the route test to verify it passes**

Run: `npx vitest run "src/app/api/catalogues/[id]/items/[itemId]/route.test.ts" -t line_dataset_id`
Expected: PASS (3 assertions).

- [ ] **Step 5: Load datasets in the server page.** In `catalogues/[id]/items/[itemId]/page.tsx`: add `line_dataset_id` to the `b2b_catalogue_items` select; add a query for the org's datasets; pass both into `CatalogueItemEditorData`:

```tsx
// add to the item select list: ...card_image_id, line_dataset_id, created_at, updated_at
// new query (org id comes from `catalogue.organization_id`):
const { data: datasetRows } = await admin
  .from('org_line_datasets').select('id, name')
  .eq('organization_id', catalogue.organization_id).order('name', { ascending: true })
// in the `data` object:
locationDatasets: (datasetRows ?? []).map((d) => ({ id: String(d.id), name: String(d.name) })),
// and inside `item: { ... }`:
line_dataset_id: item.line_dataset_id ?? null,
```

- [ ] **Step 6: Wire the editor UI.** In `CatalogueItemEditor.tsx`:
  - Add to `CatalogueItemEditorData.item`: `line_dataset_id: string | null`; add top-level `locationDatasets: Array<{ id: string; name: string }>`.
  - Add to `FormState`: `line_dataset_id: string`; in `initial()`: `line_dataset_id: data.item.line_dataset_id ?? ''`.
  - Add a `<Field>` next to the fulfilment-mode dropdown:

```tsx
<Field id="cie-location-dataset" label="Location dropdown (PDP)">
  <Dropdown
    size="md" searchable
    ariaLabel="Location dataset"
    value={form.line_dataset_id || undefined}
    placeholder="None (no location dropdown)"
    onValueChange={(v) => set('line_dataset_id', v)}
    options={data.locationDatasets.map((d) => ({ value: d.id, label: d.name }))}
  />
</Field>
```
  - Add to `buildPatch()`: `line_dataset_id: form.line_dataset_id === '' ? null : form.line_dataset_id`.
> There's no "clear to None" option value in `options`; if the `Dropdown` can't emit `''`, add a leading `{ value: '', label: 'None (no location dropdown)' }` option so staff can unassign.

- [ ] **Step 7: Typecheck + manual check + commit**

Run: `npx tsc --noEmit 2>&1 | grep -E 'CatalogueItemEditor|items/\[itemId\]'` → expect clean.
Manual: open a catalogue item editor, set the Location dropdown to "MTF Branches", Save, reload → it persists; set back to None → clears.
```bash
git -C /Users/jamierogangeorge/Documents/print-room-staff-portal add "src/app/api/catalogues/[id]/items/[itemId]/route.ts" "src/app/(portal)/catalogues/[id]/items/[itemId]/page.tsx" src/components/catalogues/CatalogueItemEditor.tsx
git -C /Users/jamierogangeorge/Documents/print-room-staff-portal commit -m "feat(catalogue): per-product location-dataset assignment"
```

---

## Task 8: CartLine location field + signature + persistence (customer repo)

Add `locationLabel` to `CartLine`, thread it into `lineSignature` as a trailing param (so different-location lines stay distinct), and whitelist it in the localStorage normalizer (so it survives reload). Do **not** touch `tierAggregationKey`/`recomputeProductTierPrices` — pooling is intentionally location-agnostic.

**Files:**
- Modify: `print-room-portal/lib/cart/types.ts` (CartLine field + `lineSignature`)
- Modify: `print-room-portal/lib/cart/normalize.ts` (`normalizePersisted` whitelist)
- Modify: `print-room-portal/components/cart/CartProvider.tsx` (pass `locationLabel` into both `lineSignature` calls in `addLine`)
- Test: `print-room-portal/lib/cart/__tests__/types.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 9–11): `CartLine.locationLabel?: string | null`; `lineSignature(..., sizeId, locationLabel)` (trailing optional param). Two lines identical except `locationLabel` do NOT merge.

- [ ] **Step 1: Write the failing tests** — add to `types.test.ts`:

```ts
it('different location labels keep lines distinct in the signature', () => {
  const base = ['p1', 'v1', 'Black / L', [] as CartLineDecoration[], 'stocked' as const, null, 10 as number | null]
  const a = lineSignature(...(base as Parameters<typeof lineSignature>), 'MTF Avalon')
  const b = lineSignature(...(base as Parameters<typeof lineSignature>), 'MTF Newmarket')
  expect(a).not.toBe(b)
})

it('same location label merges (identical signature)', () => {
  const args = ['p1', 'v1', 'Black / L', [] as CartLineDecoration[], 'stocked' as const, null, 10 as number | null, 'MTF Avalon'] as const
  expect(lineSignature(...args)).toBe(lineSignature(...args))
})

it('omitting location reproduces the pre-location signature (legacy parity)', () => {
  const a = lineSignature('p1', 'v1', 'Black / L', [], 'stocked', null, 10)
  const b = lineSignature('p1', 'v1', 'Black / L', [], 'stocked', null, 10, null)
  expect(a).toBe(b)
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run lib/cart/__tests__/types.test.ts -t location`
Expected: FAIL — `lineSignature` has no 8th param; the "distinct" test fails.

- [ ] **Step 3: Extend `lineSignature`** in `lib/cart/types.ts` (add trailing param, splice next to `sizeId`):

```ts
export function lineSignature(
  productId: string,
  variantId: string,
  variantLabel: string,
  decorations: CartLineDecoration[],
  fulfilmentType: CartLineFulfilmentType = 'stocked',
  catalogueItemId: string | null = null,
  sizeId: number | null = null,
  locationLabel: string | null = null,
): string {
  return `${catalogueItemId ?? productId}::${variantId}::${sizeId ?? ''}::${locationLabel ?? ''}::${variantLabel}::${fulfilmentType}::${decorationSignature(decorations)}`
}
```

- [ ] **Step 4: Add the CartLine field.** In the `CartLine` interface, after `shipToStoreId` (line ~53), following the "Optional + nullable, absent on legacy" convention:

```ts
  /**
   * Feature 1 — the required PDP "location" dropdown label chosen for this line
   * (e.g. "MTF Avalon"). Splits the cart line (into lineSignature) but not the
   * pricing pool (kept out of tierAggregationKey, like sizeId). Absent on legacy
   * persisted lines and products without a location dataset.
   */
  locationLabel?: string | null
```

- [ ] **Step 5: Whitelist it in the normalizer.** In `lib/cart/normalize.ts` `normalizePersisted`, mirror the `shipToStoreId` field-by-field block:

```ts
      locationLabel:
        typeof l.locationLabel === 'string' || l.locationLabel === null
          ? (l.locationLabel ?? null)
          : null,
```

- [ ] **Step 6: Thread through `addLine`.** In `CartProvider.tsx`, add `line.locationLabel ?? null` as the 8th arg to BOTH `lineSignature(...)` calls (the `incomingSig` build and the `existing` lookup). The new-line branch already spreads `...line`, so `locationLabel` carries automatically.

- [ ] **Step 7: Run the tests + full cart suite to verify green**

Run: `npx vitest run lib/cart/__tests__/types.test.ts lib/checkout/__tests__/submit.tier-aggregation-key.test.ts`
Expected: PASS (existing tests unchanged since the param defaults to null; new location tests pass; tier-key test unaffected).

- [ ] **Step 8: Commit**

```bash
git -C /Users/jamierogangeorge/Documents/print-room-portal add lib/cart/types.ts lib/cart/normalize.ts components/cart/CartProvider.tsx lib/cart/__tests__/types.test.ts
git -C /Users/jamierogangeorge/Documents/print-room-portal commit -m "feat(cart): carry location label on the line (signature-splitting, pooling-neutral)"
```

---

## Task 9: PDP location dropdown + required gate (customer repo)

Load the assigned dataset's values server-side, render a required dropdown, hard-gate add-to-cart on a selection (no default), and thread the chosen label onto every `addLine` payload.

**Files:**
- Modify: `print-room-portal/app/(portal)/catalogue/[productId]/page.tsx` (`loadProductDetailPageData` — resolve `line_dataset_id` → values → `locationOptions`)
- Modify: `print-room-portal/components/shop/ProductDetailClient.tsx` (prop + state + dropdown + gate + banner + 3 `addLine` calls)

**Interfaces:**
- Consumes: `b2b_catalogue_items.line_dataset_id` + `org_line_dataset_values` (Task 2); `CartLine.locationLabel` (Task 8).
- Produces: no garment reaches the cart without a `locationLabel` when the product has a dataset.

- [ ] **Step 1: Load `locationOptions` server-side.** In `loadProductDetailPageData` (the `Promise.all` block), after the catalogue item is resolved, add a dependent query. The catalogue item row already carries `line_dataset_id` (add it to that select). Then:

```ts
// after catalogue item is known (catalogueItem.line_dataset_id may be null):
let locationOptions: Array<{ value: string; label: string }> = []
if (catalogueItem?.line_dataset_id) {
  const { data: values } = await supabase
    .from('org_line_dataset_values')
    .select('id, label')
    .eq('dataset_id', catalogueItem.line_dataset_id)
    .order('position', { ascending: true })
  locationOptions = (values ?? []).map((v) => ({ value: String(v.id), label: String(v.label) }))
}
// include in the returned `data` object:
locationOptions,
```
> Use the same server client the function already uses for the other reads. Empty `locationOptions` = feature off for this product.

- [ ] **Step 2: Accept the prop.** In `ProductDetailClient.tsx` `Props` (and the destructure), add:

```ts
  /** Feature 1 — org location dropdown options. Empty = no location dropdown. */
  locationOptions?: LocationOption[]
```
with `type LocationOption = { value: string; label: string }` near the other local types, and `locationOptions = []` in the destructure default.

- [ ] **Step 3: Add state + derived flags.** Near the `colorSwatchId`/`sizeId` state:

```ts
  const requiresLocation = locationOptions.length > 0
  const [locationValueId, setLocationValueId] = useState<string | null>(null)
  const selectedLocationLabel =
    locationOptions.find((o) => o.value === locationValueId)?.label ?? null
```

- [ ] **Step 4: Fold into the gate.** Extend `canSubmitSelection` (line ~1186) with a location clause:

```ts
  const meetsLocation = !requiresLocation || locationValueId != null
  const canSubmitSelection =
    !isUnavailableToOrder &&
    canAddToCart &&
    meetsLocation &&
    inventoryIntentShortfall == null &&
    !preOrderClosed &&
    pendingPricingDecorations.length === 0
```

- [ ] **Step 5: Render the dropdown + a required banner** above the Add-to-cart button (mirror the amber MOQ box for the "please select" hint). Use the existing select/`Dropdown` primitive used elsewhere in this component; a native select is acceptable if the component doesn't already import a dropdown:

```tsx
{requiresLocation && (
  <div className="mt-4">
    <label htmlFor="pdp-location" className="mb-1 block text-sm font-medium text-gray-900">
      Location <span className="text-red-600">*</span>
    </label>
    <select
      id="pdp-location"
      value={locationValueId ?? ''}
      onChange={(e) => setLocationValueId(e.target.value || null)}
      className="w-full rounded-2xl border border-black/15 px-4 py-2.5 text-sm"
    >
      <option value="">Select a location…</option>
      {locationOptions.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
    {locationValueId == null && (
      <p className="mt-2 rounded-2xl bg-amber-50 px-4 py-3 text-xs text-amber-900">
        Choose a location to add this item to your cart.
      </p>
    )}
  </div>
)}
```

- [ ] **Step 6: Thread the label into every `addLine`.** In `handleAddToCart`, add `location: selectedLocationLabel` to the object added in all three modes:
  - Mode 3 (`one_size`, ~1044): add `locationLabel: selectedLocationLabel,` to the `cart.addLine({...})` object.
  - Mode 1 (`multi_size_with_variants`): add `locationLabel: selectedLocationLabel` to the `baseLine` object (~948-964) so every per-cell spread carries it.
  - Mode 2 (`multi_size_variantless`): add `locationLabel: selectedLocationLabel` to the per-size object (~999-1015).

- [ ] **Step 7: Verify gating + a lightweight render test.** Add a component test (jsdom is configured) asserting the gate. Create `components/shop/__tests__/ProductDetailClient.location-gate.test.tsx` if the component is testable in isolation; otherwise verify manually:
  - With `locationOptions=[{value:'v1',label:'MTF Avalon'}]`, the Add-to-cart button is disabled until a location is picked; picking one enables it and a subsequent add produces a cart line whose `locationLabel === 'MTF Avalon'`.
  - With `locationOptions=[]`, behaviour is unchanged (button gated only by MOQ/pricing as before).

Run (if the test file was added): `npx vitest run components/shop/__tests__/ProductDetailClient.location-gate.test.tsx`
Expected: PASS. If the component is too coupled to isolate, record the manual steps in the commit body instead.

- [ ] **Step 8: Typecheck touched files + commit**

Run: `npx tsc --noEmit --incremental false 2>&1 | grep -E 'ProductDetailClient|catalogue/\[productId\]'` → expect clean (no NEW errors beyond the 14-error baseline, none in these files).
```bash
git -C /Users/jamierogangeorge/Documents/print-room-portal add "app/(portal)/catalogue/[productId]/page.tsx" components/shop/ProductDetailClient.tsx components/shop/__tests__/ 2>/dev/null
git -C /Users/jamierogangeorge/Documents/print-room-portal commit -m "feat(pdp): required org location dropdown, hard-gating add-to-cart"
```

---

## Task 10: Persist the location on checkout (customer repo)

Carry `location_label` from the cart into the checkout POST, validate it server-side, and snapshot it to `quote_items.line_location_label` via the existing post-RPC follow-up UPDATE (no RPC change).

**Files:**
- Modify: `print-room-portal/components/checkout/CheckoutReviewClient.tsx` (POST body map, ~156-191)
- Modify: `print-room-portal/lib/checkout/submit.ts` (`CheckoutLineInput` + the follow-up UPDATE block ~1361-1399)
- Modify: `print-room-portal/app/api/checkout/route.ts` (per-line validation, ~72-80)
- Test: `print-room-portal/lib/checkout/__tests__/submit.location.test.ts` (new, small)

**Interfaces:**
- Consumes: `CartLine.locationLabel` (Task 8); `quote_items.line_location_label` (Task 2).
- Produces: order lines carry the location; Task 11 reads `line_location_label` for Monday.

- [ ] **Step 1: Write a failing unit test** for a small extracted helper that decides what the per-line update object contains (keeps the follow-up UPDATE testable). New file:

```ts
import { describe, it, expect } from 'vitest'
import { buildLineSnapshotUpdate } from '../submit'

describe('buildLineSnapshotUpdate', () => {
  it('includes line_location_label when provided', () => {
    const u = buildLineSnapshotUpdate({ ship_to_store_id: null, location_label: 'MTF Avalon' }, [])
    expect(u).toMatchObject({ line_location_label: 'MTF Avalon' })
  })
  it('sets null when location_label is explicitly null', () => {
    const u = buildLineSnapshotUpdate({ location_label: null }, [])
    expect(u.line_location_label).toBeNull()
  })
  it('omits line_location_label when the field is absent (legacy line)', () => {
    const u = buildLineSnapshotUpdate({}, [])
    expect('line_location_label' in u).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/checkout/__tests__/submit.location.test.ts`
Expected: FAIL — `buildLineSnapshotUpdate` not exported.

- [ ] **Step 3: Extend `CheckoutLineInput`** in `submit.ts` (after `ship_to_store_id`):

```ts
  /** Feature 1 — chosen PDP location dropdown label; snapshotted to quote_items. */
  location_label?: string | null
```

- [ ] **Step 4: Extract + implement `buildLineSnapshotUpdate`** and use it in the follow-up UPDATE loop. Replace the inline `update` construction (~1384-1390) with a call to a new exported helper:

```ts
export function buildLineSnapshotUpdate(
  inLine: Pick<CheckoutLineInput, 'ship_to_store_id' | 'location_label'>,
  validatedDecorations: CheckoutLineDecorationInput[],
): Record<string, unknown> {
  const update: Record<string, unknown> = {}
  if (inLine.ship_to_store_id !== undefined) update.ship_to_store_id = inLine.ship_to_store_id ?? null
  if (inLine.location_label !== undefined) update.line_location_label = inLine.location_label ?? null
  update.decorations = validatedDecorations
  return update
}
```
Then at the call site:
```ts
      const validated =
        validatedByLineKey.get(makeLineKey(inLine.product_id, inLine.variant_id ?? null, inLine.size_id ?? null)) ?? []
      const update = buildLineSnapshotUpdate(inLine, validated)
      if (Object.keys(update).length > 0) {
        snapshotUpdates.push(admin.from('quote_items').update(update).eq('id', match.id))
      }
```

- [ ] **Step 5: Add the label to the checkout POST body.** In `CheckoutReviewClient.tsx`, in the `cart.lines.map((line) => ({ ... }))`:

```ts
            location_label: line.locationLabel ?? null,
```

- [ ] **Step 6: Validate server-side.** In `app/api/checkout/route.ts`, alongside the `ship_to_store_id` org-ownership validation, add a light integrity check: for lines carrying a `location_label`, confirm the label exists among the product's assigned dataset values. Minimal version (reject an obviously-invalid label; full dataset-membership check is optional given the PDP gate already constrains it):

```ts
// per-line, when location_label is a non-empty string, ensure it is a known
// value for that catalogue item's assigned dataset. Batch-load once:
//   const datasetIdByItem = ... select line_dataset_id for the lines' catalogueItemIds
//   const labelsByDataset = ... select label from org_line_dataset_values in those datasets
// then: if (label && !labelsByDataset.get(datasetId)?.has(label)) -> 400.
```
> If time-boxed for the 26th, the PDP hard-gate is the primary guarantee; this server check is defence-in-depth. Implement the batch-load version if the checkout route already batch-loads catalogue items (it validates `ship_to_store_id` org ownership similarly); otherwise land the label pass-through and file the membership check as a fast-follow.

- [ ] **Step 7: Run the test + submit suite**

Run: `npx vitest run lib/checkout/__tests__/submit.location.test.ts lib/checkout/__tests__/submit.tier-aggregation-key.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git -C /Users/jamierogangeorge/Documents/print-room-portal add components/checkout/CheckoutReviewClient.tsx lib/checkout/submit.ts app/api/checkout/route.ts lib/checkout/__tests__/submit.location.test.ts
git -C /Users/jamierogangeorge/Documents/print-room-portal commit -m "feat(checkout): snapshot chosen location label onto the order line"
```

---

## Task 11: Location + decoration Monday columns (customer repo + staff repo)

Create the Monday subitem columns, thread the location label through to the subitem builder, write both the location and the (now homeless) decoration name into their own columns, and mirror the change in the staff repo's retry route.

**Files:**
- Modify: `print-room-portal/lib/monday/column-ids.ts` (add `location` + `decoration` to `PRODUCTION_SUBITEM_COLUMNS`)
- Modify: `print-room-portal/lib/monday/deal-item.ts` (`OrderLineForMonday.location`, `buildOrderSubitemColumnValues`)
- Modify: `print-room-portal/lib/checkout/submit.ts` (dealLines query + map — add the label; ~1590-1621)
- Modify (staff repo): `src/app/api/orders/[id]/retry-monday-push/route.ts` (+ its `deal-item.ts` if separate) — mirror
- Test: `print-room-portal/lib/monday/__tests__/deal-item.order-mode.test.ts`

**Interfaces:**
- Consumes: `quote_items.line_location_label` (Task 2/10); the title fix (Task 1).
- Produces: subitems carry Location + Decoration columns; the parent dropdown is untouched (per-line decoration is written per-subitem to avoid flattening).

- [ ] **Step 1: Create the two Monday subitem columns (confirm with Chris first).** Board = Production `1992701981`, on the **subitems** board. Via the Monday MCP, create two text columns: "Location" and "Decoration". Capture their real column IDs. (If Jon prefers to create them by hand in the Monday UI, get the IDs from the column settings.) This is a hard prerequisite for Step 3 — the code references the real IDs.

- [ ] **Step 2: Add the IDs to `column-ids.ts`.** In `PRODUCTION_SUBITEM_COLUMNS`, add (replace the placeholders with the real IDs from Step 1):

```ts
  // "Location" — the org PDP location dropdown label chosen for this line
  // (feature 1). Text column on the subitems board.
  location: '<REAL_LOCATION_COLUMN_ID>',
  // "Decoration" — the line's decoration/design name, moved here off the
  // subitem title (2026-07-22 title fix). Text column on the subitems board.
  decoration: '<REAL_DECORATION_COLUMN_ID>',
```

- [ ] **Step 3: Write the failing Monday test.** In `deal-item.order-mode.test.ts`, extend the fixture's first line with `location: 'MTF Avalon'` (add `location: string | null` to those fixtures) and assert the subitem column payload:

```ts
it('writes the Location and Decoration columns on the subitem', async () => {
  mockedCall
    .mockResolvedValueOnce({ create_item: { id: '900', name: 'Acme Co' } })
    .mockResolvedValue({ create_subitem: { id: 'sub-1' } })
  await pushOrderDeal(fixture) // fixture line 1: designName 'Logo Front', location 'MTF Avalon'

  const cv = JSON.parse((mockedCall.mock.calls[1][1] as { columnValues: string }).columnValues)
  expect(cv[PRODUCTION_SUBITEM_COLUMNS.location]).toBe('MTF Avalon')
  expect(cv[PRODUCTION_SUBITEM_COLUMNS.decoration]).toBe('Logo Front')
})
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npx vitest run lib/monday/__tests__/deal-item.order-mode.test.ts -t "Location and Decoration"`
Expected: FAIL — `OrderLineForMonday` has no `location`; columns unwritten.

- [ ] **Step 5: Add `location` to `OrderLineForMonday`** (`deal-item.ts:391-404`):

```ts
  /** Feature 1 — chosen PDP location label for this line; null when none. */
  location: string | null
```

- [ ] **Step 6: Write both columns in `buildOrderSubitemColumnValues`** (`deal-item.ts:584-601`), after the existing garment/color writes:

```ts
  if (line.location?.trim()) {
    columnValues[PRODUCTION_SUBITEM_COLUMNS.location] = line.location.trim()
  }
  if (line.designName?.trim() && line.designName !== 'No decoration') {
    columnValues[PRODUCTION_SUBITEM_COLUMNS.decoration] = line.designName.trim()
  }
```

- [ ] **Step 7: Supply `location` from the query.** In `submit.ts` (~1590-1621): add `line_location_label` to the `quote_items` select; widen the inline row cast with `line_location_label: string | null`; and in the `.map(...)` add `location: row.line_location_label ?? null` to the returned `OrderLineForMonday`.

```ts
      const { data: dealLines } = await admin
        .from('quote_items')
        .select(`
          id, product_name, quantity, unit_price, decorations, size_label, line_location_label,
          product_variants ( product_color_swatches(label) )
        `)
        .eq('quote_id', quote_id)
      // ...in the row type: line_location_label: string | null
      // ...in the returned object: location: row.line_location_label ?? null,
```

- [ ] **Step 8: Run the Monday suite to verify green**

Run: `npx vitest run lib/monday/__tests__/deal-item.order-mode.test.ts`
Expected: PASS (title test from Task 1, the new columns test, and the existing size/status assertions).

- [ ] **Step 9: Mirror in the staff repo retry route.** In `print-room-staff-portal/src/app/api/orders/[id]/retry-monday-push/route.ts`, apply the same three changes to its duplicated `OrderLineForMonday[]` build: select `line_location_label`, map it to `location`, and (in that repo's `deal-item.ts`, if separate) the same `column-ids.ts` IDs + `buildOrderSubitemColumnValues` writes + the Task-1 title fix. Run that repo's `npx vitest run <deal-item test>`.
> Do NOT extract a shared formatter now — that's the post-26 "second caller" (feature 2) job. Mirror only.

- [ ] **Step 10: Typecheck + commit (both repos)**

Run (customer): `npx tsc --noEmit --incremental false 2>&1 | grep -E 'deal-item|column-ids|checkout/submit'` → expect clean.
```bash
git -C /Users/jamierogangeorge/Documents/print-room-portal add lib/monday/column-ids.ts lib/monday/deal-item.ts lib/checkout/submit.ts lib/monday/__tests__/deal-item.order-mode.test.ts
git -C /Users/jamierogangeorge/Documents/print-room-portal commit -m "feat(monday): write Location + Decoration columns on order subitems"
git -C /Users/jamierogangeorge/Documents/print-room-staff-portal add "src/app/api/orders/[id]/retry-monday-push/" src/lib/monday/ 2>/dev/null
git -C /Users/jamierogangeorge/Documents/print-room-staff-portal commit -m "feat(monday): mirror Location/Decoration columns + title fix in retry route"
```

---

## Appendix — Go-live / ops track (non-code, run in parallel)

These gate the 26 July launch but aren't code tasks:

1. **MTF branch list — SOURCED 2026-07-23 (no longer a blocker).** Extracted from the live wholesale site's product-options dropdown (an app-injected JS `mw_product_option` select — invisible to `products.json`): 59 values = 58 branches + `MTF Generic Logo`, cleaned (collapsed double-spacing, trimmed, macrons preserved) to `print-room-staff-portal/data/mtf-catalogue/mtf-branches.csv`. This IS the "MTF Branches" dataset seed for Task 6. Chris now only **confirms scope/naming** (is `MTF Generic Logo` a valid pick? any branches added/removed? exact garment-facing spelling), rather than being the source of truth.
2. **Confirm "location-as-column" with Chris** (vs literally in the Monday item name) — blocks Task 11 Step 1.
3. **Create the two Monday subitem columns** (Location, Decoration) via the Monday MCP once (2) is confirmed — feeds Task 11 Step 2.
4. **MTF onboarding** — org + ~60 stores + staff via the existing `bulk-members` importer (separate from this build).
5. **End-to-end smoke on a test org** (test emails → `jamie@theprint-room.co.nz`): assign "MTF Branches" to a product → PDP requires a location → two different locations create two cart lines that still pool for volume price → checkout → `quote_items.line_location_label` populated → Monday subitem shows product-name title + Location + Decoration columns.

**Suggested execution order:** Task 1 (ship now) → Task 2 (schema) → Tasks 3–7 (staff tooling) ∥ Tasks 8–10 (customer, after Task 2) → Task 11 (needs 2, 10, and Monday columns) → Appendix smoke.

---

## Self-Review

- **Spec coverage:** dataset (Task 2) ✓; not `stores` — new tables ✓; `org_line_datasets`/`org_line_dataset_values`/`b2b_catalogue_items.line_dataset_id`/`quote_items` column ✓ (Task 2); full tooling — CRUD (Task 4) + CSV importer (Tasks 3, 5) + per-product assignment (Task 7) ✓; PDP required dropdown, no default (Task 9) ✓; per-garment grain into `lineSignature`, `tierAggregationKey` untouched (Task 8) ✓; persist in checkout (Task 10) ✓; title bug fix (Task 1) ✓; location → new column not title (Task 11) ✓; decoration → column (Task 11) ✓; mirror staff retry route (Tasks 1, 11) ✓; go-live deps (Appendix) ✓.
- **Deviations from the strategy doc, flagged:** (a) **label-only** order snapshot (`line_location_label`), no per-line value FK — chosen for snapshot-correctness + halved threading surface (Task 2 note); the strategy doc's "column(s)" allows this. (b) **Decoration written per-subitem** (not the parent `decorationMethods` dropdown) — decoration is per-line and the parent dropdown flattens mixed orders; the doc's own build-time note recommended evaluating exactly this. (c) `fallbackSku` fill deferred (would require threading SKU through `OrderLineForMonday`; out of scope for the 26th). Both (a) and (b) are confirm-with-Jon items already listed "Still open" in the strategy doc.
- **Placeholder scan:** the only intentional placeholders are `<REAL_LOCATION_COLUMN_ID>` / `<REAL_DECORATION_COLUMN_ID>` (Task 11) and the `<ts>` migration timestamp (Task 2) — each is a value that can only be produced at execution time (Monday column creation / UTC clock) and is called out as such.
- **Type consistency:** `locationLabel` (CartLine) ↔ `location_label` (POST/`CheckoutLineInput`) ↔ `line_location_label` (DB) ↔ `location` (`OrderLineForMonday`/Monday column) — deliberate per-layer casing matching the repo's own `sizeLabel`/`size_label` convention; the single label value flows unbroken through all four. `line_dataset_id` (catalogue FK → dataset), `org_line_dataset_values.id` (PDP option `value`), `locationLabel` (snapshot) are kept distinct and never conflated.
