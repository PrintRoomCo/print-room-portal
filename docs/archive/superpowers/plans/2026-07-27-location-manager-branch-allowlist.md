# Location-manager (branch allow-list) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an org_admin designate a staff-role member as manager of ≥1 branches (a `stores` allow-list) so they can order for, and see the orders of, every managed branch — with zero behaviour change for plain staff and org_admins.

**Architecture:** Mirror the shipped `b2b_member_catalogue_grants` pattern with a new `b2b_member_store_grants` table (S owns the schema; P consumes it). Manager = `role==='staff'` AND ≥1 grant row. Allowed branches = grants ∪ default_store_id, computed at read (pure `resolveBranchStoreIds`). Ordering stays one-destination-per-order (guard enforces single branch). Viewing filters the orders boundary on a newly-denormalised `quotes.ship_to_store_id`. Ships dark — inert until a grant is written.

**Tech Stack:** Next.js (App Router, both repos — read `node_modules/next/dist/docs/` before writing framework code in S), TypeScript, Supabase Postgres (service-role queries via PostgREST), Vitest (`vitest run`), @testing-library/react + vitest-axe (P UI).

**Spec:** `print-room-portal/docs/superpowers/specs/2026-07-27-location-manager-branch-allowlist-design.md`.

## Global Constraints

- **S owns the schema; P has NO migrations.** Every schema change is a file in S. NEVER apply schema via Supabase MCP/dashboard (`AGENTS.md`). This migration is HELD in `db/pending-migrations/` and applied to prod only on Jon's go.
- **Repos:** `print-room-staff-portal` = **S** (import alias `@/*` → `./src/*`). `print-room-portal` = **P** (import alias `@/*` → repo root).
- **Feature branch per repo:** `feat/location-manager-branch-allowlist`. Commit locally; do NOT push or merge (HITL — Jon merges).
- **Test runner:** `npx vitest run <path>` in each repo. Typecheck: `npx tsc --noEmit`.
- **Backward-compat is a hard requirement:** zero-grant staff and org_admins must produce byte-identical behaviour to today, pinned by tests (Tasks 6, 9).
- **UI (S):** read `docs/ui/oem-rules.md` before touching `.tsx`; the pre-flight checklist is mandatory.
- **Table columns mirror the sibling exactly:** `granted_by uuid`, `granted_at timestamptz default now()`.
- **Naming (used across tasks, keep identical):** `resolveBranchStoreIds(grantStoreIds, defaultStoreId)`, `buildStoreGrantDiff(existing, desired)`, `getMemberBranchStoreIds(admin, membershipId, defaultStoreId)`, `checkStaffBranchScope(args)`, context field `branchStoreIds`, scope field `branchStoreIds`, audit key `B2B_MEMBER_STORE_GRANTS_CHANGE`, table `b2b_member_store_grants`, column `quotes.ship_to_store_id`.

---

## File Structure

**Repo S (`print-room-staff-portal`):**
- Create: `db/pending-migrations/20260727140000_location_manager_branch_grants.sql` — table, `quotes.ship_to_store_id`, backfill, index, `submit_b2b_order` RPC stamp.
- Create: `src/lib/b2b-accounts/branch-grants.ts` — pure `resolveBranchStoreIds` + `buildStoreGrantDiff`.
- Create: `src/lib/b2b-accounts/__tests__/branch-grants.test.ts`.
- Modify: `src/lib/audit/actions.ts` — add `B2B_MEMBER_STORE_GRANTS_CHANGE`.
- Create: `src/app/api/b2b-accounts/[id]/members/[userId]/store-grants/route.ts` — GET+PUT replace-set.
- Create: `src/app/api/b2b-accounts/[id]/members/[userId]/store-grants/route.test.ts`.
- Modify: `src/components/b2b-accounts/MemberAccessEditor.tsx` — "Branches this member manages" multi-select.

**Repo P (`print-room-portal`):**
- Create: `lib/orders/branch-grants.ts` — pure `resolveBranchStoreIds` + `buildStoreGrantDiff` + `getMemberBranchStoreIds`.
- Create: `lib/orders/__tests__/branch-grants.test.ts`.
- Create: `lib/checkout/branch-scope.ts` — pure `checkStaffBranchScope`.
- Create: `lib/checkout/__tests__/branch-scope.test.ts`.
- Modify: `lib/checkout/server.ts` — add `branchStoreIds` to `B2BCustomerContext`, fetch grants in `requireB2BCustomer`.
- Modify: `lib/checkout/submit.ts` — replace inline guard (`:454-465`) with `checkStaffBranchScope`.
- Modify: `components/checkout/CheckoutReviewClient.tsx` — order-level branch picker for managers.
- Modify: `lib/orders/past-orders-query.ts` — `PastOrdersScope.branchStoreIds` + manager predicate.
- Modify: `lib/orders/__tests__/past-orders-query.test.ts` — add `branchStoreIds` to existing scopes; new manager cases.
- Modify: `lib/portal-data.ts` (`:349-351`) and `app/api/past-orders/export/route.ts` (`:43-45`) — pass `branchStoreIds`.
- Modify: order/quote-keyed routes — `app/api/collections/[collectionId]/route.ts`, `app/(portal)/orders/[id]/proof/page.tsx`, `.../proof/edit/page.tsx`, `app/(portal)/checkout/confirmation/[orderId]/page.tsx` (+ enumerate the rest).
- Create: `app/api/team/members/[membershipId]/store-grants/route.ts` — P mirror replace-set (org_admin, own-org).
- Modify: `app/(portal)/team/TeamClient.tsx` + `app/(portal)/team/page.tsx` — branch multi-select.

---

## Task 1 [S]: Schema migration + denormalization + backfill

**Files:**
- Create: `db/pending-migrations/20260727140000_location_manager_branch_grants.sql`

**Interfaces:**
- Produces: table `public.b2b_member_store_grants(id, membership_id, store_id, granted_by, granted_at)`; column `public.quotes.ship_to_store_id uuid`; updated `submit_b2b_order` RPC that stamps `quotes.ship_to_store_id` from the (uniform) lines.

- [ ] **Step 1: Write the migration file**

```sql
-- 20260727140000_location_manager_branch_grants.sql
-- Location-manager (branch allow-list). Held: apply to prod only on Jon's go.

-- 1. Grant table — mirror of b2b_member_catalogue_grants.
create table if not exists public.b2b_member_store_grants (
  id            uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.user_organizations(id) on delete cascade,
  store_id      uuid not null references public.stores(id) on delete cascade,
  granted_by    uuid,
  granted_at    timestamptz not null default now(),
  unique (membership_id, store_id)
);
create index if not exists idx_b2b_member_store_grants_membership
  on public.b2b_member_store_grants(membership_id);

-- 2. Denormalize the order's single branch onto the quote header.
alter table public.quotes
  add column if not exists ship_to_store_id uuid references public.stores(id) on delete set null;

-- 3. Backfill legacy orders (safe: legacy orders are single-branch — staff were hard-locked).
update public.quotes q
set ship_to_store_id = (
  select qi.ship_to_store_id
  from public.quote_items qi
  where qi.quote_id = q.id and qi.ship_to_store_id is not null
  limit 1
)
where q.ship_to_store_id is null
  and exists (
    select 1 from public.quote_items qi
    where qi.quote_id = q.id and qi.ship_to_store_id is not null
  );

-- 4. Index the manager predicate.
create index if not exists idx_quotes_ship_to_store_id on public.quotes(ship_to_store_id);
```

- [ ] **Step 2: Extend the `submit_b2b_order` RPC to stamp the header**

Open the current `submit_b2b_order` definition (search `supabase/migrations/` for the latest `create or replace function ... submit_b2b_order`). Copy it verbatim into this migration as `create or replace function`, and after the block that inserts `quote_items`, add:

```sql
  update public.quotes
  set ship_to_store_id = (
    select qi.ship_to_store_id from public.quote_items qi
    where qi.quote_id = v_quote_id and qi.ship_to_store_id is not null
    limit 1
  )
  where id = v_quote_id;
```

(`v_quote_id` = whatever the function names the freshly-created quote id — match the existing variable.)

- [ ] **Step 3: Apply to the DEV database and verify (never prod, never MCP)**

Apply the pending file to the dev/branch database via the repo's dev workflow (`supabase db push` against the dev branch — do NOT touch prod). Then run verification SQL:

```sql
-- table exists with the unique key
select count(*) from public.b2b_member_store_grants;                    -- 0, no error
-- column exists
select ship_to_store_id from public.quotes limit 1;                     -- no error
-- backfill: every order whose lines have a store now has a header store
select count(*) from public.quotes q
  where q.ship_to_store_id is null
    and exists (select 1 from public.quote_items qi
                where qi.quote_id = q.id and qi.ship_to_store_id is not null);  -- MUST be 0
```

Expected: last query returns `0` (no single-branch order left unstamped). Custom-address orders (all-NULL lines) correctly stay NULL.

- [ ] **Step 4: Regenerate DB types (S) and note P sync**

Regenerate S's generated Supabase types from the dev DB per the repo's type-gen script. Note for later tasks: P's libs take an untyped `SupabaseClient`, so P does not block on type regen, but regen P types too if the repo script exists.

- [ ] **Step 5: Commit**

```bash
cd print-room-staff-portal && git checkout -b feat/location-manager-branch-allowlist
git add db/pending-migrations/20260727140000_location_manager_branch_grants.sql
git commit -m "feat(db): held migration — b2b_member_store_grants + denormalise quotes.ship_to_store_id"
```

---

## Task 2 [S]: Pure branch-grants module (S copy)

**Files:**
- Create: `src/lib/b2b-accounts/branch-grants.ts`
- Test: `src/lib/b2b-accounts/__tests__/branch-grants.test.ts`

**Interfaces:**
- Produces: `resolveBranchStoreIds(grantStoreIds: string[], defaultStoreId: string | null): string[]`; `buildStoreGrantDiff(existing: string[], desired: string[]): { toInsert: string[]; toDelete: string[] }`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/b2b-accounts/__tests__/branch-grants.test.ts
import { describe, expect, it } from 'vitest'
import { resolveBranchStoreIds, buildStoreGrantDiff } from '@/lib/b2b-accounts/branch-grants'

describe('resolveBranchStoreIds', () => {
  it('unions grants with the default and dedups', () => {
    expect(resolveBranchStoreIds(['a', 'b'], 'b').sort()).toEqual(['a', 'b'])
  })
  it('empty grants + a default => [default] (plain-staff lock)', () => {
    expect(resolveBranchStoreIds([], 'home')).toEqual(['home'])
  })
  it('drops null/empty entries and a null default', () => {
    expect(resolveBranchStoreIds(['a', ''], null)).toEqual(['a'])
    expect(resolveBranchStoreIds([], null)).toEqual([])
  })
})

describe('buildStoreGrantDiff', () => {
  it('computes inserts and deletes', () => {
    expect(buildStoreGrantDiff(['a', 'b'], ['b', 'c'])).toEqual({ toInsert: ['c'], toDelete: ['a'] })
  })
  it('no-op when equal', () => {
    expect(buildStoreGrantDiff(['a'], ['a'])).toEqual({ toInsert: [], toDelete: [] })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd print-room-staff-portal && npx vitest run src/lib/b2b-accounts/__tests__/branch-grants.test.ts`
Expected: FAIL — cannot resolve `@/lib/b2b-accounts/branch-grants`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/b2b-accounts/branch-grants.ts
/**
 * A staff manager's orderable/viewable branch set = explicitly-granted stores
 * UNIONED with their home (default) store. Union at READ so the grant table
 * stays "explicitly managed" and survives independent default_store_id edits.
 */
export function resolveBranchStoreIds(
  grantStoreIds: string[],
  defaultStoreId: string | null,
): string[] {
  const set = new Set(grantStoreIds.filter((s): s is string => Boolean(s)))
  if (defaultStoreId) set.add(defaultStoreId)
  return [...set]
}

export function buildStoreGrantDiff(
  existing: string[],
  desired: string[],
): { toInsert: string[]; toDelete: string[] } {
  const have = new Set(existing)
  const want = new Set(desired)
  return {
    toInsert: [...want].filter((id) => !have.has(id)),
    toDelete: [...have].filter((id) => !want.has(id)),
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd print-room-staff-portal && npx vitest run src/lib/b2b-accounts/__tests__/branch-grants.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
cd print-room-staff-portal
git add src/lib/b2b-accounts/branch-grants.ts src/lib/b2b-accounts/__tests__/branch-grants.test.ts
git commit -m "feat(b2b): pure resolveBranchStoreIds + buildStoreGrantDiff"
```

---

## Task 3 [S]: `store-grants` replace-set route + audit action

**Files:**
- Modify: `src/lib/audit/actions.ts` (add key after `:44`)
- Create: `src/app/api/b2b-accounts/[id]/members/[userId]/store-grants/route.ts`
- Test: `src/app/api/b2b-accounts/[id]/members/[userId]/store-grants/route.test.ts`

**Interfaces:**
- Consumes: `requireB2BAccountsStaffAccess` → `{ admin, context: { staffId, userId } }` (`src/lib/b2b-accounts/server.ts:22`); `recordAuditEvent` (`src/lib/audit/recordEvent`); `buildStoreGrantDiff` (Task 2).
- Produces: `GET` → `{ stores: { id: string; name: string; granted: boolean }[] }`; `PUT` body `{ storeIds: string[] }` → replace-set, returns the same GET shape.

- [ ] **Step 1: Add the audit action constant**

In `src/lib/audit/actions.ts`, immediately after the `B2B_MEMBER_ACCESS_CHANGE` line (`:44`):

```ts
  B2B_MEMBER_STORE_GRANTS_CHANGE: 'b2b_member_store_grants.change',
```

- [ ] **Step 2: Write the failing test**

```ts
// route.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

const audit = vi.fn()
vi.mock('@/lib/audit/recordEvent', () => ({ recordAuditEvent: (...a: unknown[]) => audit(...a) }))

let authResult: unknown
vi.mock('@/lib/b2b-accounts/server', () => ({
  requireB2BAccountsStaffAccess: () => authResult,
}))

import { PUT } from './route'

// Chainable stub: records the last table + captured filters; returns queued data.
function makeAdmin(tables: Record<string, { rows?: unknown[]; error?: unknown }>) {
  const state: { table?: string; deletes: unknown[]; inserts: unknown[] } = { deletes: [], inserts: [] }
  const api: Record<string, unknown> = {}
  const chain = () => api
  Object.assign(api, {
    from: vi.fn((t: string) => { state.table = t; return api }),
    select: vi.fn(() => api),
    eq: vi.fn(() => api),
    maybeSingle: vi.fn(async () => ({ data: (tables[state.table!]?.rows ?? [])[0] ?? null, error: null })),
    delete: vi.fn(() => ({ eq: () => ({ in: async (_c: string, ids: string[]) => { state.deletes.push([state.table, ids]); return { error: null } } }) })),
    insert: vi.fn(async (rows: unknown[]) => { state.inserts.push([state.table, rows]); return { error: null } }),
    order: vi.fn(async () => ({ data: tables[state.table!]?.rows ?? [], error: null })),
    then: undefined,
  })
  // list select() resolves via await on the builder
  ;(api.select as { mockImplementation?: unknown }) // keep chain
  return { api, state }
}

function req(body: unknown) {
  return new Request('http://x', { method: 'PUT', body: JSON.stringify(body) })
}
const params = { params: Promise.resolve({ id: 'org-1', userId: 'm-1' }) }

beforeEach(() => { audit.mockReset() })

describe('PUT store-grants', () => {
  it('rejects a store from another org (422)', async () => {
    const { api } = makeAdmin({
      user_organizations: { rows: [{ id: 'm-1' }] },       // membership ∈ org
      stores: { rows: [{ id: 's-1', name: 'A' }] },        // org owns only s-1
      b2b_member_store_grants: { rows: [] },
    })
    authResult = { admin: api, context: { staffId: 'staff-1', userId: 'u-1' } }
    const res = await PUT(req({ storeIds: ['s-1', 's-OTHER'] }), params)
    expect(res.status).toBe(422)
  })

  it('404s when the membership is not in the org', async () => {
    const { api } = makeAdmin({
      user_organizations: { rows: [] },                    // not found
      stores: { rows: [{ id: 's-1', name: 'A' }] },
      b2b_member_store_grants: { rows: [] },
    })
    authResult = { admin: api, context: { staffId: 'staff-1', userId: 'u-1' } }
    const res = await PUT(req({ storeIds: ['s-1'] }), params)
    expect(res.status).toBe(404)
  })
})
```

> The stub above is a starting point — mirror the real chain shape from `.../access/route.ts` (that route awaits `from().select().eq()` and `from().delete().eq().in()`), adjusting the stub until the two assertions drive the code. The behavioural gates that MUST hold: cross-org store → 422; membership not in org → 404; happy path inserts/deletes the diff and calls `recordAuditEvent` once.

- [ ] **Step 3: Run to verify it fails**

Run: `cd print-room-staff-portal && npx vitest run "src/app/api/b2b-accounts/[id]/members/[userId]/store-grants/route.test.ts"`
Expected: FAIL — `./route` has no export `PUT`.

- [ ] **Step 4: Write the route (mirror `.../access/route.ts` structure)**

```ts
// route.ts
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireB2BAccountsStaffAccess } from '@/lib/b2b-accounts/server'
import { recordAuditEvent } from '@/lib/audit/recordEvent'
import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { buildStoreGrantDiff } from '@/lib/b2b-accounts/branch-grants'

interface RouteParams { params: Promise<{ id: string; userId: string }> }

async function loadStoreGrants(admin: SupabaseClient, orgId: string, membershipId: string) {
  const { data: membership } = await admin
    .from('user_organizations').select('id')
    .eq('id', membershipId).eq('organization_id', orgId).maybeSingle()
  if (!membership) return null
  const [{ data: stores }, { data: grants }] = await Promise.all([
    admin.from('stores').select('id, name').eq('organization_id', orgId).order('name', { ascending: true }),
    admin.from('b2b_member_store_grants').select('store_id').eq('membership_id', membershipId),
  ])
  const granted = new Set((grants ?? []).map((g) => g.store_id as string))
  return { stores: (stores ?? []).map((s) => ({ id: s.id as string, name: s.name as string, granted: granted.has(s.id as string) })) }
}

export async function GET(request: Request, { params }: RouteParams) {
  const auth = await requireB2BAccountsStaffAccess(request)
  if ('error' in auth) return auth.error
  const { id: orgId, userId: membershipId } = await params
  const out = await loadStoreGrants(auth.admin, orgId, membershipId)
  if (!out) return NextResponse.json({ error: 'Membership not found for this organization' }, { status: 404 })
  return NextResponse.json(out)
}

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireB2BAccountsStaffAccess(request)
  if ('error' in auth) return auth.error
  const { admin, context } = auth
  const { id: orgId, userId: membershipId } = await params

  const { data: membership } = await admin
    .from('user_organizations').select('id')
    .eq('id', membershipId).eq('organization_id', orgId).maybeSingle()
  if (!membership) return NextResponse.json({ error: 'Membership not found for this organization' }, { status: 404 })

  let body: { storeIds: string[] }
  try { body = (await request.json()) as { storeIds: string[] } } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }
  if (!Array.isArray(body.storeIds)) return NextResponse.json({ error: 'storeIds must be an array' }, { status: 400 })

  // Every store must belong to this org.
  const { data: orgStores } = await admin.from('stores').select('id').eq('organization_id', orgId)
  const orgStoreIds = new Set((orgStores ?? []).map((s) => s.id as string))
  const desired = [...new Set(body.storeIds)]
  for (const sid of desired) {
    if (!orgStoreIds.has(sid)) return NextResponse.json({ error: `Store ${sid} does not belong to this organization` }, { status: 422 })
  }

  const before = await loadStoreGrants(admin, orgId, membershipId)
  const { data: existing } = await admin.from('b2b_member_store_grants').select('store_id').eq('membership_id', membershipId)
  const existingIds = (existing ?? []).map((r) => r.store_id as string)
  const { toInsert, toDelete } = buildStoreGrantDiff(existingIds, desired)

  if (toDelete.length > 0) {
    const { error } = await admin.from('b2b_member_store_grants').delete().eq('membership_id', membershipId).in('store_id', toDelete)
    if (error) return NextResponse.json({ error: error.message, step: 'delete' }, { status: 500 })
  }
  if (toInsert.length > 0) {
    const { error } = await admin.from('b2b_member_store_grants')
      .insert(toInsert.map((store_id) => ({ membership_id: membershipId, store_id, granted_by: context.staffId })))
    if (error) return NextResponse.json({ error: error.message, step: 'insert' }, { status: 500 })
  }

  const after = await loadStoreGrants(admin, orgId, membershipId)
  await recordAuditEvent({
    orgId, actorUserId: context.userId,
    action: AUDIT_ACTIONS.B2B_MEMBER_STORE_GRANTS_CHANGE,
    targetType: 'user_organizations', targetId: membershipId,
    metadata: { diff: { added: toInsert, removed: toDelete }, before, after },
  })
  return NextResponse.json(after)
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd print-room-staff-portal && npx vitest run "src/app/api/b2b-accounts/[id]/members/[userId]/store-grants/route.test.ts"`
Expected: PASS. Also `npx tsc --noEmit`.

- [ ] **Step 6: Commit**

```bash
cd print-room-staff-portal
git add src/lib/audit/actions.ts "src/app/api/b2b-accounts/[id]/members/[userId]/store-grants/"
git commit -m "feat(b2b): store-grants replace-set route + audit action"
```

---

## Task 4 [S]: Member screen "Branches this member manages" multi-select

**Files:**
- Modify: `src/components/b2b-accounts/MemberAccessEditor.tsx`
- Test: `src/components/b2b-accounts/__tests__/MemberAccessEditor.storegrants.test.tsx` (create)

**Interfaces:**
- Consumes: `GET/PUT .../store-grants` (Task 3).

- [ ] **Step 1: Read the UI rules and the existing editor**

Read `docs/ui/oem-rules.md` (mandatory pre-flight). Read `MemberAccessEditor.tsx` to match how the catalogue multi-select fetches (`GET .../access`) and saves (`PUT .../access`).

- [ ] **Step 2: Write the failing component test**

```tsx
// MemberAccessEditor.storegrants.test.tsx
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemberAccessEditor } from '@/components/b2b-accounts/MemberAccessEditor'

beforeEach(() => {
  global.fetch = vi.fn(async (url: string) =>
    ({ ok: true, json: async () =>
      String(url).includes('/store-grants')
        ? { stores: [{ id: 's-1', name: 'Avalon', granted: true }, { id: 's-2', name: 'CBD', granted: false }] }
        : { catalogues: [] },
    }) as Response) as unknown as typeof fetch
})

describe('MemberAccessEditor — branches', () => {
  it('renders the org stores with granted state', async () => {
    render(<MemberAccessEditor orgId="org-1" membershipId="m-1" />)
    await waitFor(() => expect(screen.getByText('Branches this member manages')).toBeInTheDocument())
    expect(screen.getByLabelText('Avalon')).toBeChecked()
    expect(screen.getByLabelText('CBD')).not.toBeChecked()
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd print-room-staff-portal && npx vitest run src/components/b2b-accounts/__tests__/MemberAccessEditor.storegrants.test.tsx`
Expected: FAIL — no "Branches this member manages" text.

- [ ] **Step 4: Add the multi-select block**

In `MemberAccessEditor.tsx`, alongside the catalogue control, add a section that on mount `GET`s `/api/b2b-accounts/${orgId}/members/${membershipId}/store-grants`, renders each store as a labelled checkbox (checked = `granted`), and on save `PUT`s `{ storeIds: <checked ids> }` to the same URL. Follow the exact fetch/loading/save conventions the catalogue block already uses. Heading text: `Branches this member manages`. Empty selection is valid (member is plain staff).

- [ ] **Step 5: Run to verify it passes**

Run: `cd print-room-staff-portal && npx vitest run src/components/b2b-accounts/__tests__/MemberAccessEditor.storegrants.test.tsx`
Expected: PASS. Confirm the oem-rules pre-flight checklist items.

- [ ] **Step 6: Commit**

```bash
cd print-room-staff-portal
git add src/components/b2b-accounts/MemberAccessEditor.tsx src/components/b2b-accounts/__tests__/MemberAccessEditor.storegrants.test.tsx
git commit -m "feat(b2b): branch-manager multi-select on member screen"
```

---

## Task 5 [P]: Pure branch-grants module (P mirror)

**Files:**
- Create: `lib/orders/branch-grants.ts`
- Test: `lib/orders/__tests__/branch-grants.test.ts`

**Interfaces:**
- Produces: `resolveBranchStoreIds`, `buildStoreGrantDiff` (identical to Task 2); plus `getMemberBranchStoreIds(admin: SupabaseClient, membershipId: string, defaultStoreId: string | null): Promise<string[]>` — returns `[]` when the member has no grants (view-side gate), else `resolveBranchStoreIds(grants, default)`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/orders/__tests__/branch-grants.test.ts
import { describe, expect, it, vi } from 'vitest'
import { resolveBranchStoreIds, buildStoreGrantDiff, getMemberBranchStoreIds } from '@/lib/orders/branch-grants'

describe('resolveBranchStoreIds', () => {
  it('unions grants with default and dedups', () => {
    expect(resolveBranchStoreIds(['a', 'b'], 'b').sort()).toEqual(['a', 'b'])
  })
  it('empty grants + default => [default]', () => {
    expect(resolveBranchStoreIds([], 'home')).toEqual(['home'])
  })
  it('empty grants + null default => []', () => {
    expect(resolveBranchStoreIds([], null)).toEqual([])
  })
})

describe('buildStoreGrantDiff', () => {
  it('computes inserts and deletes', () => {
    expect(buildStoreGrantDiff(['a', 'b'], ['b', 'c'])).toEqual({ toInsert: ['c'], toDelete: ['a'] })
  })
})

function admin(grants: string[]) {
  const b = { select: vi.fn(() => b), eq: vi.fn(async () => ({ data: grants.map((store_id) => ({ store_id })), error: null })) }
  return { from: vi.fn(() => b) } as never
}

describe('getMemberBranchStoreIds — view-side gate', () => {
  it('no grants => [] (plain staff keep own-orders-only)', async () => {
    expect(await getMemberBranchStoreIds(admin([]), 'm-1', 'home')).toEqual([])
  })
  it('has grants => grants ∪ default', async () => {
    expect((await getMemberBranchStoreIds(admin(['a']), 'm-1', 'home')).sort()).toEqual(['a', 'home'])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd print-room-portal && npx vitest run lib/orders/__tests__/branch-grants.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// lib/orders/branch-grants.ts
import type { SupabaseClient } from '@supabase/supabase-js'

export function resolveBranchStoreIds(grantStoreIds: string[], defaultStoreId: string | null): string[] {
  const set = new Set(grantStoreIds.filter((s): s is string => Boolean(s)))
  if (defaultStoreId) set.add(defaultStoreId)
  return [...set]
}

export function buildStoreGrantDiff(existing: string[], desired: string[]): { toInsert: string[]; toDelete: string[] } {
  const have = new Set(existing)
  const want = new Set(desired)
  return { toInsert: [...want].filter((id) => !have.has(id)), toDelete: [...have].filter((id) => !want.has(id)) }
}

/**
 * VIEW-side branch set. Returns [] when the member has NO grants, so plain staff
 * keep today's own-orders-only view (we do NOT union the default for non-managers).
 * A member with ≥1 grant is a manager: grants ∪ default.
 */
export async function getMemberBranchStoreIds(
  admin: SupabaseClient,
  membershipId: string,
  defaultStoreId: string | null,
): Promise<string[]> {
  const { data } = await admin.from('b2b_member_store_grants').select('store_id').eq('membership_id', membershipId)
  const grants = (data ?? []).map((g) => (g as { store_id: string }).store_id)
  return grants.length ? resolveBranchStoreIds(grants, defaultStoreId) : []
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd print-room-portal && npx vitest run lib/orders/__tests__/branch-grants.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
cd print-room-portal && git checkout -b feat/location-manager-branch-allowlist
git add lib/orders/branch-grants.ts lib/orders/__tests__/branch-grants.test.ts
git commit -m "feat(orders): pure branch-grants resolver + getMemberBranchStoreIds"
```

---

## Task 6 [P]: Pure checkout branch-scope validator

**Files:**
- Create: `lib/checkout/branch-scope.ts`
- Test: `lib/checkout/__tests__/branch-scope.test.ts`

**Interfaces:**
- Produces: `checkStaffBranchScope(args: { shipToStoreIds: Array<string|null>; allowedBranches: string[]; allOneTimeLines: boolean; hasCustomShippingAddress: boolean }): BranchScopeResult` where `BranchScopeResult = { ok: true } | { ok: false; kind: 'out_of_scope'; mismatched: Array<string|null> } | { ok: false; kind: 'mixed_branch' }`.
- Note: returns a result (no throw), so this module has zero dependency on the error classes in `submit.ts` — avoids a circular import. `submit.ts` (Task 7) maps the result onto the existing `BuyerScopeError` / `MixedShippingAddressError`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/checkout/__tests__/branch-scope.test.ts
import { describe, expect, it } from 'vitest'
import { checkStaffBranchScope } from '@/lib/checkout/branch-scope'

const base = { allOneTimeLines: false, hasCustomShippingAddress: false }

describe('checkStaffBranchScope', () => {
  it('plain staff (allowed=[default]) — all lines = default => ok', () => {
    expect(checkStaffBranchScope({ ...base, shipToStoreIds: ['home', 'home'], allowedBranches: ['home'] }))
      .toEqual({ ok: true })
  })
  it('plain staff — a line off the default => out_of_scope (today BuyerScopeError)', () => {
    expect(checkStaffBranchScope({ ...base, shipToStoreIds: ['home', 'other'], allowedBranches: ['home'] }))
      .toEqual({ ok: false, kind: 'out_of_scope', mismatched: ['other'] })
  })
  it('manager — all lines on one granted branch => ok', () => {
    expect(checkStaffBranchScope({ ...base, shipToStoreIds: ['b', 'b'], allowedBranches: ['home', 'b', 'c'] }))
      .toEqual({ ok: true })
  })
  it('manager — an ungranted branch => out_of_scope', () => {
    expect(checkStaffBranchScope({ ...base, shipToStoreIds: ['x'], allowedBranches: ['home', 'b'] }))
      .toEqual({ ok: false, kind: 'out_of_scope', mismatched: ['x'] })
  })
  it('manager — two granted branches in one order => mixed_branch', () => {
    expect(checkStaffBranchScope({ ...base, shipToStoreIds: ['b', 'c'], allowedBranches: ['home', 'b', 'c'] }))
      .toEqual({ ok: false, kind: 'mixed_branch' })
  })
  it('all one-time lines + custom address => ok (null lines exempt)', () => {
    expect(checkStaffBranchScope({ shipToStoreIds: [null, null], allowedBranches: ['home'], allOneTimeLines: true, hasCustomShippingAddress: true }))
      .toEqual({ ok: true })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd print-room-portal && npx vitest run lib/checkout/__tests__/branch-scope.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// lib/checkout/branch-scope.ts
export type BranchScopeResult =
  | { ok: true }
  | { ok: false; kind: 'out_of_scope'; mismatched: Array<string | null> }
  | { ok: false; kind: 'mixed_branch' }

export function checkStaffBranchScope(args: {
  shipToStoreIds: Array<string | null>
  allowedBranches: string[]        // resolveBranchStoreIds(grants, default); plain staff => [default]
  allOneTimeLines: boolean
  hasCustomShippingAddress: boolean
}): BranchScopeResult {
  const allowed = new Set(args.allowedBranches)
  const mismatched = args.shipToStoreIds.filter((sid) => {
    if (sid === null && args.allOneTimeLines && args.hasCustomShippingAddress) return false
    return sid === null || !allowed.has(sid)
  })
  if (mismatched.length > 0) return { ok: false, kind: 'out_of_scope', mismatched }
  const distinct = new Set(args.shipToStoreIds.filter((s): s is string => s !== null))
  if (distinct.size > 1) return { ok: false, kind: 'mixed_branch' }
  return { ok: true }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd print-room-portal && npx vitest run lib/checkout/__tests__/branch-scope.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
cd print-room-portal
git add lib/checkout/branch-scope.ts lib/checkout/__tests__/branch-scope.test.ts
git commit -m "feat(checkout): pure staff branch-scope validator"
```

---

## Task 7 [P]: Wire context grants + guard into checkout

**Files:**
- Modify: `lib/checkout/server.ts` (`B2BCustomerContext` at `:10`; `requireB2BCustomer` fetch at `:104-117`; context object at `:131-162`)
- Modify: `lib/checkout/submit.ts` (guard at `:454-465`)
- Test: `lib/checkout/__tests__/submit.branch-scope.test.ts` (create) — asserts submit maps the validator result to the existing errors.

**Interfaces:**
- Consumes: `resolveBranchStoreIds` (Task 5), `checkStaffBranchScope` (Task 6).
- Produces: `B2BCustomerContext.branchStoreIds: string[]` (empty for org_admin / plain staff).

- [ ] **Step 1: Add `branchStoreIds` to the context type + fetch (server.ts)**

In `B2BCustomerContext` (interface at `:10`), add `branchStoreIds: string[]`. In `requireB2BCustomer`, add a 5th query to the `Promise.all` at `:104`:

```ts
    admin.from('b2b_member_store_grants').select('store_id').eq('membership_id', membership.id),
```

Destructure it (`{ data: storeGrants }`) and add to the returned context (near `:149-150`):

```ts
      branchStoreIds: (storeGrants ?? []).map((g) => g.store_id as string),
```

- [ ] **Step 2: Write the failing test (submit maps result → errors)**

```ts
// lib/checkout/__tests__/submit.branch-scope.test.ts
import { describe, expect, it } from 'vitest'
import { BuyerScopeError, MixedShippingAddressError } from '@/lib/checkout/submit'
import { checkStaffBranchScope } from '@/lib/checkout/branch-scope'
import { resolveBranchStoreIds } from '@/lib/orders/branch-grants'

// Contract test: submit.ts translates checkStaffBranchScope results into the existing
// error classes. This pins the mapping the guard must implement.
function mapToError(res: ReturnType<typeof checkStaffBranchScope>, defaultStoreId: string | null) {
  if (res.ok) return null
  if (res.kind === 'out_of_scope') return new BuyerScopeError(res.mismatched, defaultStoreId)
  return new MixedShippingAddressError()
}

describe('submit guard mapping', () => {
  it('ungranted branch => BuyerScopeError', () => {
    const allowed = resolveBranchStoreIds([], 'home') // plain staff
    const res = checkStaffBranchScope({ shipToStoreIds: ['other'], allowedBranches: allowed, allOneTimeLines: false, hasCustomShippingAddress: false })
    expect(mapToError(res, 'home')).toBeInstanceOf(BuyerScopeError)
  })
  it('two branches => MixedShippingAddressError', () => {
    const allowed = resolveBranchStoreIds(['b', 'c'], 'home')
    const res = checkStaffBranchScope({ shipToStoreIds: ['b', 'c'], allowedBranches: allowed, allOneTimeLines: false, hasCustomShippingAddress: false })
    expect(mapToError(res, 'home')).toBeInstanceOf(MixedShippingAddressError)
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd print-room-portal && npx vitest run lib/checkout/__tests__/submit.branch-scope.test.ts`
Expected: FAIL initially only if imports are missing; it will pass once imports resolve — its real purpose is to lock the mapping. Proceed to wire the guard so the runtime path matches.

- [ ] **Step 4: Replace the inline guard in submit.ts (`:454-465`)**

```ts
import { checkStaffBranchScope } from '@/lib/checkout/branch-scope'
import { resolveBranchStoreIds } from '@/lib/orders/branch-grants'
// ...
  // 0. Buyer-scope guard: plain staff => locked to defaultStoreId; a manager
  //    (≥1 grant) may pick any granted branch, but one branch per order.
  if (input.context.role === 'staff') {
    const allowedBranches = resolveBranchStoreIds(input.context.branchStoreIds, input.context.defaultStoreId)
    const res = checkStaffBranchScope({
      shipToStoreIds,
      allowedBranches,
      allOneTimeLines,
      hasCustomShippingAddress: Boolean(input.custom_shipping_address),
    })
    if (!res.ok && res.kind === 'out_of_scope') throw new BuyerScopeError(res.mismatched, input.context.defaultStoreId)
    if (!res.ok && res.kind === 'mixed_branch') throw new MixedShippingAddressError()
  }
```

- [ ] **Step 5: Run to verify it passes + regression**

Run: `cd print-room-portal && npx vitest run lib/checkout/ && npx tsc --noEmit`
Expected: PASS, including the existing `route.permission-denied.test.ts` and `route.split.test.ts` (plain-staff behaviour unchanged). Fix any context test fixtures that now need `branchStoreIds: []`.

- [ ] **Step 6: Commit**

```bash
cd print-room-portal
git add lib/checkout/server.ts lib/checkout/submit.ts lib/checkout/__tests__/submit.branch-scope.test.ts
git commit -m "feat(checkout): manager branch-scope guard + context.branchStoreIds"
```

---

## Task 8 [P]: Checkout order-level branch picker (manager UI)

**Files:**
- Modify: `components/checkout/CheckoutReviewClient.tsx` (`perLineShipTo` at `:171`)
- Test: `components/checkout/__tests__/CheckoutReviewClient.branch.test.tsx` (create)

**Interfaces:**
- Consumes: `context.branchStoreIds` (Task 7), `resolveBranchStoreIds` (Task 5).

- [ ] **Step 1: Write the failing component test**

```tsx
// CheckoutReviewClient.branch.test.tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CheckoutReviewClient } from '@/components/checkout/CheckoutReviewClient'

// Provide the minimal props CheckoutReviewClient needs (mirror an existing test's fixture).
const managerCtx = { role: 'staff', defaultStoreId: 'home', branchStoreIds: ['home', 'b'],
  storeIds: ['home', 'b'], /* ...other required context fields... */ } as never

describe('CheckoutReviewClient branch picker', () => {
  it('a manager sees an order-level "Ordering for branch" control', () => {
    render(<CheckoutReviewClient context={managerCtx} /* ...other required props... */ />)
    expect(screen.getByLabelText(/ordering for branch/i)).toBeInTheDocument()
  })
})
```

> Copy the full required prop fixture from an existing `CheckoutReviewClient` test if one exists, or from the component's props type. The behavioural gate: control present for a manager (`branchStoreIds.length > 0`), absent for plain staff / org_admin.

- [ ] **Step 2: Run to verify it fails**

Run: `cd print-room-portal && npx vitest run components/checkout/__tests__/CheckoutReviewClient.branch.test.tsx`
Expected: FAIL — no "Ordering for branch" control.

- [ ] **Step 3: Implement the picker**

When `context.role === 'staff' && context.branchStoreIds.length > 0`, render one order-level labelled `<select>` "Ordering for branch:" whose options are `resolveBranchStoreIds(context.branchStoreIds, context.defaultStoreId)` mapped to store names (names available via the existing store lookup the component already uses), default-selected to `context.defaultStoreId`. On change, set `perLineShipTo` for **every** line to the chosen branch id (keeps the submit payload uniform). Do not render for plain staff / org_admin. Follow accessibility patterns already in the file (label association; keep `vitest-axe` clean).

- [ ] **Step 4: Run to verify it passes**

Run: `cd print-room-portal && npx vitest run components/checkout/__tests__/CheckoutReviewClient.branch.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd print-room-portal
git add components/checkout/CheckoutReviewClient.tsx components/checkout/__tests__/CheckoutReviewClient.branch.test.tsx
git commit -m "feat(checkout): order-level branch picker for managers"
```

---

## Task 9 [P]: Viewing scope — manager branch predicate

**Files:**
- Modify: `lib/orders/past-orders-query.ts` (`PastOrdersScope` at `:62`; `queryPastOrders` at `:82`)
- Modify: `lib/orders/__tests__/past-orders-query.test.ts` (add `branchStoreIds` to the 4 existing scopes; add manager cases)

**Interfaces:**
- Produces: `PastOrdersScope.branchStoreIds: string[]` (required; `[]` ⇒ no branch predicate).

- [ ] **Step 1: Update existing tests (backward-compat pins) + add manager cases**

Add `branchStoreIds: []` to each of the 4 existing scope literals (lines ~75, ~88, ~99, ~115). Extend the mock client with an `or` recorder, and add:

```ts
function mockClientOr(recordOr: (arg: string) => void) {
  const b: Record<string, unknown> = {
    select: vi.fn(() => b),
    eq: vi.fn(() => b),
    or: vi.fn((arg: string) => { recordOr(arg); return b }),
    order: vi.fn(async () => ({ data: [row()], error: null })),
  }
  return { from: vi.fn(() => b) }
}

describe('queryPastOrders — manager branch scope', () => {
  it('manager: own-email OR ship_to_store_id IN granted branches, on quotes', async () => {
    const ors: string[] = []
    const client = mockClientOr((a) => ors.push(a))
    await queryPastOrders(client as never, {
      organizationId: 'org-1', canSeeAllOrgOrders: false,
      userEmail: 'mgr@x.co', branchStoreIds: ['s-1', 's-2'],
    })
    expect(ors[0]).toContain('customer_email.eq.mgr@x.co')
    expect(ors[0]).toContain('ship_to_store_id.in.(s-1,s-2)')
  })

  it('manager with no email still gets branch rows (does NOT fail closed)', async () => {
    const ors: string[] = []
    const client = mockClientOr((a) => ors.push(a))
    const rows = await queryPastOrders(client as never, {
      organizationId: 'org-1', canSeeAllOrgOrders: false,
      userEmail: null, branchStoreIds: ['s-1'],
    })
    expect(ors[0]).toBe('ship_to_store_id.in.(s-1)')
    expect(rows).toHaveLength(1)
  })

  it('plain staff (branchStoreIds: []) — byte-identical to today (eq only, no or)', async () => {
    const ors: string[] = []
    const client = mockClientOr((a) => ors.push(a))
    await queryPastOrders(client as never, {
      organizationId: 'org-1', canSeeAllOrgOrders: false, userEmail: 'staff@x.co', branchStoreIds: [],
    })
    expect(ors).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd print-room-portal && npx vitest run lib/orders/__tests__/past-orders-query.test.ts`
Expected: FAIL — `branchStoreIds` missing on type / new cases fail.

- [ ] **Step 3: Implement the predicate**

```ts
export interface PastOrdersScope {
  organizationId: string
  canSeeAllOrgOrders: boolean
  userEmail: string | null
  /** Manager's granted∪default branches; [] for plain staff & org_admin. */
  branchStoreIds: string[]
}

export async function queryPastOrders(adminClient: SupabaseClient, scope: PastOrdersScope): Promise<PastOrderRow[]> {
  if (!scope.canSeeAllOrgOrders && !scope.userEmail && scope.branchStoreIds.length === 0) return []

  let query = adminClient.from('orders').select(PAST_ORDERS_SELECT).eq('quotes.organization_id', scope.organizationId)

  if (!scope.canSeeAllOrgOrders) {
    if (scope.branchStoreIds.length > 0) {
      const parts: string[] = []
      if (scope.userEmail) parts.push(`customer_email.eq.${scope.userEmail}`)
      parts.push(`ship_to_store_id.in.(${scope.branchStoreIds.join(',')})`)
      query = query.or(parts.join(','), { referencedTable: 'quotes' })
    } else {
      query = query.eq('quotes.customer_email', scope.userEmail)
    }
  }

  const { data, error } = await query.order('created_at', { ascending: false })
  if (error) { console.error('[PastOrders] query failed:', error); return [] }
  return (data ?? []) as unknown as PastOrderRow[]
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd print-room-portal && npx vitest run lib/orders/__tests__/past-orders-query.test.ts && npx tsc --noEmit`
Expected: PASS (all old + new cases). `tsc` will surface the two call sites missing `branchStoreIds` — fixed in Task 10.

- [ ] **Step 5: Commit**

```bash
cd print-room-portal
git add lib/orders/past-orders-query.ts lib/orders/__tests__/past-orders-query.test.ts
git commit -m "feat(orders): manager branch predicate in past-orders boundary"
```

---

## Task 10 [P]: Wire scope call sites (list + export)

**Files:**
- Modify: `lib/portal-data.ts` (`:349-351`)
- Modify: `app/api/past-orders/export/route.ts` (`:43-45`)

**Interfaces:**
- Consumes: `getMemberBranchStoreIds` (Task 5); passes `branchStoreIds` into `queryPastOrders` (Task 9).

- [ ] **Step 1: Update the list fetcher (`portal-data.ts:349-351`)**

Before the `queryPastOrders` call, compute the branch set and pass it:

```ts
import { getMemberBranchStoreIds } from '@/lib/orders/branch-grants'
// ...
const branchStoreIds = membership.role === 'org_admin'
  ? []
  : await getMemberBranchStoreIds(adminClient, membership.id, membership.default_store_id ?? null)
const rows = await queryPastOrders(adminClient, {
  organizationId: membership.organization_id,
  canSeeAllOrgOrders: membership.role === 'org_admin',
  userEmail /* existing */,
  branchStoreIds,
})
```

Ensure `membership` selects `id` and `default_store_id` here (add to the select if absent).

- [ ] **Step 2: Update the export route (`export/route.ts:43-45`)** — identical shape.

- [ ] **Step 3: Run typecheck + related tests**

Run: `cd print-room-portal && npx tsc --noEmit && npx vitest run app/api/past-orders/`
Expected: PASS; no remaining `branchStoreIds`-missing errors.

- [ ] **Step 4: Commit**

```bash
cd print-room-portal
git add lib/portal-data.ts app/api/past-orders/export/route.ts
git commit -m "feat(orders): pass manager branch set into list + export scope"
```

---

## Task 11 [P]: Detail / collection route auth parity

**Files:**
- Modify: `app/api/collections/[collectionId]/route.ts`
- Modify: `app/(portal)/orders/[id]/proof/page.tsx`, `app/(portal)/orders/[id]/proof/edit/page.tsx`
- Modify: `app/(portal)/checkout/confirmation/[orderId]/page.tsx`
- Test: add a parity test per route (create alongside each).

**Interfaces:**
- Consumes: `getMemberBranchStoreIds` (Task 5); the denormalised `quotes.ship_to_store_id`.

- [ ] **Step 1: Enumerate every order/quote-keyed route/page**

Run: `cd print-room-portal && grep -rn "orderId\|\\[id\\]\|collectionId\|quote_id" app/\(portal\)/orders app/\(portal\)/checkout app/api/collections app/api/orders --include="*.tsx" --include="*.ts" | grep -iv test`
List every route that authorises "own order OR org_admin". Each must also allow a manager whose `quotes.ship_to_store_id ∈ getMemberBranchStoreIds(...)`.

- [ ] **Step 2: Write a failing parity test (per route)**

For each surface, a test: a manager granted branch `B` can load an order whose `quotes.ship_to_store_id === 'B'` (200/renders), and gets 404/notFound for an order shipped to an ungranted branch they didn't place. Mirror the existing auth-fixture style of that route's neighbours.

- [ ] **Step 3: Apply the shared check**

In each route's existing authorisation, extend the "own order / admin" gate with: if `role==='staff'`, also permit when the order's `quotes.ship_to_store_id` is in `await getMemberBranchStoreIds(admin, membershipId, defaultStoreId)`. Reuse the exact predicate — do not reimplement branch membership inline.

- [ ] **Step 4: Run to verify**

Run: `cd print-room-portal && npx vitest run app/api/collections app/\(portal\)/orders && npx tsc --noEmit`
Expected: PASS (list-shows ⟺ detail-allows; ungranted 404s).

- [ ] **Step 5: Commit**

```bash
cd print-room-portal
git add app/api/collections app/\(portal\)/orders app/\(portal\)/checkout/confirmation
git commit -m "feat(orders): manager branch parity on order/collection detail routes"
```

---

## Task 12 [P]: Customer team UI + mirror replace-set route

**Files:**
- Create: `app/api/team/members/[membershipId]/store-grants/route.ts`
- Test: `app/api/team/members/[membershipId]/store-grants/route.test.ts`
- Modify: `app/(portal)/team/TeamClient.tsx`, `app/(portal)/team/page.tsx`

**Interfaces:**
- Consumes: P's org_admin auth guard (mirror `app/api/team/invite/route.ts`), `buildStoreGrantDiff` (Task 5).

- [ ] **Step 1: Write the failing route test**

Mirror Task 3's test, but the caller is an **org_admin acting on their own org**. Gates: (a) target `membershipId` must belong to the admin's org → else 404; (b) every `storeId` ∈ the admin's org stores → else 422; (c) diff insert/delete correct.

```ts
// route.test.ts (shape mirrors Task 3; auth mock returns the org_admin's own orgId)
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd print-room-portal && npx vitest run "app/api/team/members/[membershipId]/store-grants/route.test.ts"`
Expected: FAIL — no `PUT` export.

- [ ] **Step 3: Implement the mirror route**

Copy Task 3's route logic; swap the auth guard for P's org_admin team guard (follow `app/api/team/invite/route.ts`); derive `orgId` from the authenticated admin's membership (NOT from the URL) and constrain both the membership lookup and the store validation to that org. Audit via the portal's sink if present; otherwise leave a `// TODO(audit): portal has no audit sink` note (open item).

- [ ] **Step 4: Write + pass the team UI multi-select**

In `TeamClient.tsx` (+ `page.tsx` already fetches org stores for `default_store_id`), add an org_admin-only "Branches this member manages" multi-select per staff member, reading/writing the mirror route. Component test: renders org stores with granted state; hidden for non-admins. Follow the portal's existing team-row control conventions + `vitest-axe`.

- [ ] **Step 5: Run to verify it passes**

Run: `cd print-room-portal && npx vitest run app/api/team app/\(portal\)/team && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd print-room-portal
git add "app/api/team/members" app/\(portal\)/team
git commit -m "feat(team): org_admin branch-manager multi-select + mirror store-grants route"
```

---

## Rollout (HITL — after all tasks merged)

1. Apply the S migration to **prod** on Jon's go (`db/pending-migrations/` → `supabase/migrations/`, `supabase db push`). `quotes.ship_to_store_id` + `b2b_member_store_grants` must stay thereafter.
2. Confirm both portals deployed (querying code must not precede the schema).
3. Grant a pilot manager via either admin UI; smoke: order for a granted branch, block an ungranted branch, block a two-branch order, see branch orders in the list + export, open a deep-linked branch order detail, confirm ungranted 404s.

---

## Self-Review

- **Spec coverage:** §A→T1; §B(types)→T1.4; §C→T2/T5; §D→T6/T7; §E→T8; §F→T9/T10; §G→T11; §H→T3/T12; §I→T4/T12; §J→T3.1; Testing→per-task; Rollout→final section. No gaps.
- **Placeholder scan:** UI tasks (T4/T8/T12) intentionally reference "copy the existing fixture/conventions" because the concrete component props/JSX are house-specific; the behavioural gate and heading/label text are concrete and testable. No `TBD`/`add appropriate error handling`.
- **Type consistency:** `resolveBranchStoreIds`, `buildStoreGrantDiff`, `getMemberBranchStoreIds`, `checkStaffBranchScope`, `BranchScopeResult`, `branchStoreIds`, `B2B_MEMBER_STORE_GRANTS_CHANGE`, `b2b_member_store_grants`, `quotes.ship_to_store_id` — spelled identically across all tasks. Backward-compat asymmetry (checkout unions default; view gates on grants>0) is enforced by `resolveBranchStoreIds` (checkout) vs `getMemberBranchStoreIds` (view).
