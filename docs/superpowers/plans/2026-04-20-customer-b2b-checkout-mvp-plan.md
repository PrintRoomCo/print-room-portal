# Customer B2B Checkout MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the customer-facing catalogue → cart → checkout flow so B2B customers self-serve orders on the Supabase platform (no Shopify). Includes stocked-inventory out-of-stock UX with a Request-reorder escape hatch, split-ship per line, and a "Submit as Quote Request" path that lands in the staff quote builder.

**Architecture:** All code lives in `print-room-portal`. Catalogue + cart are client-side; cart persists in `localStorage` keyed by `organizationId`. Checkout POST reuses the staff-portal's `submit_b2b_order` RPC (same atomic pipeline, same inventory reservation, same `order_ref` allocator). Monday push helper is **duplicated** from the staff portal per spec §4.3 (no monorepo sharing in v1; extraction is a v1.1 follow-up). Quote-request path writes a `staff_quotes` row with `staff_user_id = null` + new `submitted_by_user_id = auth.uid()` column.

**Tech Stack:** Next.js 16 (App Router, async `params`), Supabase (Postgres + RLS + Auth), Tailwind v4, TypeScript, Monday GraphQL via the existing `lib/monday/client.ts`, MCP `mcp__supabase__apply_migration` / `mcp__supabase__execute_sql`.

**Repo:** `print-room-portal` only.

**Next.js 16 note (per AGENTS.md):** re-read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` and `dynamic-routes.md` before writing any new route handler. `params` is `Promise<...>`; `cookies()`/`headers()` are async.

**Depends on (must be shipped first):**
- Inventory plan — `reserve_quote_line` RPC, `variant_availability` view, `product_variants` table, webhook extension.
- CSR plan — `submit_b2b_order` RPC, `allocate_order_ref` RPC, `get_unit_price` RPC, `organizations.customer_code`, `quotes.order_ref`, `order_number_seq`, `b2b_accounts.organization_id` FK.
- Staff-portal `src/lib/monday/production-job.ts` — duplicated into this repo at `lib/monday/production-job.ts` per spec §4.3.
- Quote Builder Completion plan — receives quote-request submissions as `staff_quotes` with `staff_user_id = null`. This plan does not block on that plan, but the rendering/handling of null-staff quotes there is the consumer side.

Reference plans:
- `print-room-staff-portal/docs/superpowers/plans/2026-04-20-staff-portal-inventory-subapp-plan.md`
- `print-room-staff-portal/docs/superpowers/plans/2026-04-20-staff-portal-b2b-order-entry-csr-plan.md`
- `print-room-staff-portal/docs/superpowers/plans/2026-04-20-staff-portal-quote-builder-completion-plan.md`

---

## Current state (from codebase inspection)

**Live schema missing:** `variant_reorder_requests` table, `quote_items.ship_to_store_id`, `staff_quotes.submitted_by_user_id`.

> **Amendment 2026-04-24 — table rename.** Task 1's table was originally named `reorder_requests` in this plan. That name is already taken by the **tracker-level** reorder feature (§15.1 amendment — `user_id, tracker_id, monday_item_id, payload, submitted_at`) created by the 2026-04-24 amendments plan. The variant-level OOS escape hatch introduced here is a genuinely different concern (different Monday path, different lifecycle), so it gets its own table `variant_reorder_requests`. All downstream references in Tasks 1, 2, 14, 20 have been updated accordingly.

**Customer-portal routes** under `app/(portal)/`: `account`, `projects`, `order-tracker`, `leavers-quotes`, `my-collections`. No `shop`, `cart`, `checkout`, or `quote-requests` yet — all greenfield in this plan.

**Existing helper** [lib/company.ts:75-77](print-room-portal/lib/company.ts#L75-L77): `getCompanyAccess` looks up `b2b_accounts` by `.eq('id', orgMembership.organization_id)` — this is **latent-buggy**: the correct FK (added by the CSR plan) is `b2b_accounts.organization_id = orgMembership.organization_id`. Task 3 patches this.

**Monday client** at `lib/monday/client.ts` and `lib/monday/column-ids.ts` already exist (these were the source the CSR plan copied into the staff portal). The production-job helper does NOT exist here yet — Task 4 creates it as a near-verbatim duplicate of the staff-portal version.

---

## Ambiguities resolved (override in review if wrong)

1. **Monday helper duplication.** Spec §4.3 explicitly chooses duplication for v1. This plan creates `lib/monday/production-job.ts` as a duplicate of the staff-portal file; a comment in the file references the canonical source. Monorepo extraction is a v1.1 follow-up.
2. **`getCompanyAccess` b2b_accounts bug.** Task 3 changes the FK lookup to `organization_id`. This is pre-existing and only surfaces now because the CSR plan added the FK. Fixing it is required — pricing depends on tier lookup.
3. **Custom ship-to addresses.** Spec §9.1 says mixed per-line custom addresses are NOT supported in v1. This plan enforces that server-side: if any line has a custom address, ALL lines must share the same address (null `ship_to_store_id` across all lines, order-level `shipping_address`). Otherwise reject 400.
4. **Accept-priced-quote is v1.1.** Quote-request detail page in v1 shows staff pricing once quote is approved but does NOT have an Accept button. Spec §10 covers this.
5. **`staff_quotes.submitted_by_user_id`** added this plan. Nullable for back-compat with existing quote-builder rows.
6. **Reorder-request notification:** v1 logs to server console + writes the row. Slack/email is a follow-up (noted in spec §7.4 but not hard-required in §14). A stub helper `notifyStaffReorder()` in this plan logs — real delivery is a v1.1 TODO.
7. **Cart persistence** stays client-side via `localStorage` keyed by `organizationId`. The existing empty `cart_items` table is left alone (spec §3 explicit).
8. **Pricing preview** on PDP calls `get_unit_price` live via the new `/api/shop/pricing` endpoint (debounced); no client-side pricing calculation. Simpler + consistent with staff checkout.
9. **`submit_b2b_order` RPC reuse.** Customer checkout calls the same RPC the CSR tool uses. The RPC's `p_customer_name`, `p_customer_email`, `p_customer_phone` come from the customer's `profiles` row. Idempotency key is client-generated per cart.
10. **B2B catalogue filter — channel, not tag.** Patched 2026-04-22. Original spec said filter by `products.tags @> '{b2b}'`. But the staff product editor's B2B toggle writes to `product_type_activations(product_type='b2b', is_active=true)`, not to the tag array — so the original filter would have ignored the staff toggle entirely. Plan now uses a PostgREST `!inner` join on `product_type_activations` with `product_type='b2b' AND is_active=true`. Tasks 6, 7, 11, 12 updated. Spec §3, §6.1, §12 row 1, §13 updated in lockstep. Net effect: Chris's mental model ("flip B2B on → product appears for B2B customers") now holds.

---

## File structure

### New files

**Server:**
- `lib/checkout/server.ts` — `requireB2BCustomer()` auth helper (returns context with organization_id + b2b account)
- `lib/checkout/submit.ts` — wraps `submit_b2b_order` RPC + post-commit Monday push (mirrors staff CSR's `submitB2BOrder`)
- `lib/checkout/quote-request.ts` — writes a `staff_quotes` row for the customer's cart
- `lib/checkout/reorder-request.ts` — writes a `variant_reorder_requests` row
- `lib/shop/catalog.ts` — PostgREST helpers for catalog queries
- `lib/shop/availability.ts` — reads `variant_availability` for an org
- `lib/monday/production-job.ts` — duplicate of staff-portal file (per spec §4.3)
- `lib/cart/types.ts` — `CartLine`, `CartState`
- `lib/cart/pricing.ts` — client-side subtotal calc (unit_price trusted from server, multiplied by qty)

**API routes:**
- `app/api/shop/products/route.ts` — GET catalog
- `app/api/shop/products/[id]/route.ts` — GET single product with variants + pricing brackets
- `app/api/shop/products/[id]/availability/route.ts` — GET per-variant available_qty
- `app/api/shop/pricing/route.ts` — POST `{product_id, qty}` → `{unit_price, total}`
- `app/api/checkout/route.ts` — POST place order
- `app/api/checkout/quote-request/route.ts` — POST submit as quote-request
- `app/api/checkout/reorder-request/route.ts` — POST request reorder

**Pages (under `app/(portal)/`):**
- `shop/page.tsx` — catalogue grid
- `shop/[productId]/page.tsx` — product detail
- `cart/page.tsx` — cart review
- `checkout/page.tsx` — checkout form
- `checkout/confirmation/[orderId]/page.tsx` — post-submit confirmation
- `quote-requests/page.tsx` — list
- `quote-requests/[id]/page.tsx` — detail

**Client components (under `components/`):**
- `components/cart/CartProvider.tsx` (client) — context + localStorage
- `components/cart/useCart.ts` — the hook
- `components/shop/ProductCard.tsx`
- `components/shop/VariantPicker.tsx`
- `components/shop/AvailabilityBadge.tsx`
- `components/shop/RequestReorderModal.tsx`
- `components/cart/CartTable.tsx`
- `components/checkout/ShipToRow.tsx`
- `components/checkout/CheckoutClient.tsx` — top-level form state

### Modified files

- `lib/company.ts` — fix `b2b_accounts` lookup to `.eq('organization_id', ...)`
- `app/(portal)/layout.tsx` — wrap with `<CartProvider>` + sidebar nav entry for Shop/Cart/Quote-requests

### Migrations (via `mcp__supabase__apply_migration`)

- `20260420_customer_checkout_schema` — `variant_reorder_requests` table, `quote_items.ship_to_store_id`, `staff_quotes.submitted_by_user_id`
- `20260420_customer_checkout_rls` — RLS policies on `variant_reorder_requests`, customer access to own `staff_quotes`

---

# Tasks

## Task 1: Schema — variant_reorder_requests, ship_to_store_id, submitted_by_user_id

**Acceptance criteria:**
- `variant_reorder_requests` table exists with the check constraint on `status`.
- `quote_items.ship_to_store_id uuid references stores(id)` exists, nullable.
- `staff_quotes.submitted_by_user_id uuid references auth.users(id)` exists, nullable.
- Indexes added for expected access paths.

- [x] **Step 1: Apply the migration**

`mcp__supabase__apply_migration` `name = "20260420_customer_checkout_schema"`:

```sql
create table if not exists variant_reorder_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  variant_id uuid not null references product_variants(id),
  requested_qty integer not null check (requested_qty > 0),
  requested_by uuid references auth.users(id),
  note text,
  status text not null default 'open' check (status in ('open','resolved','dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table quote_items
  add column if not exists ship_to_store_id uuid references stores(id);

alter table staff_quotes
  add column if not exists submitted_by_user_id uuid references auth.users(id);

create index if not exists variant_reorder_requests_org_idx on variant_reorder_requests (organization_id, status, created_at desc);
create index if not exists quote_items_ship_to_store_idx on quote_items (ship_to_store_id) where ship_to_store_id is not null;
create index if not exists staff_quotes_submitted_by_idx on staff_quotes (submitted_by_user_id) where submitted_by_user_id is not null;
```

- [x] **Step 2: Verify**

```sql
select table_name from information_schema.tables
 where table_schema='public' and table_name='variant_reorder_requests';
-- expect 1 row

select column_name from information_schema.columns
 where table_schema='public' and table_name='quote_items' and column_name='ship_to_store_id';
-- expect 1 row

select column_name from information_schema.columns
 where table_schema='public' and table_name='staff_quotes' and column_name='submitted_by_user_id';
-- expect 1 row
```

- [x] **Step 3: Commit** plan doc.

---

## Task 2: RLS — variant_reorder_requests + customer read on own staff_quotes

**Acceptance criteria:**
- Authenticated users can `insert` and `select` `variant_reorder_requests` only for their own org.
- Staff (with `inventory:write`, `orders:write`, or admin) can `select` all.
- Authenticated users can `select` their own `staff_quotes` rows (where `submitted_by_user_id = auth.uid()`). Staff see all.
- Authenticated users can `insert` `staff_quotes` with `submitted_by_user_id = auth.uid()` (the quote-request path). Other inserts require service role.

- [x] **Step 1: Apply**

`mcp__supabase__apply_migration` `name = "20260420_customer_checkout_rls"`:

```sql
alter table variant_reorder_requests enable row level security;

create policy variant_reorder_requests_insert_own_org
  on variant_reorder_requests for insert to authenticated
  with check (
    exists (
      select 1 from user_organizations uo
       where uo.user_id = auth.uid()
         and uo.organization_id = variant_reorder_requests.organization_id
    )
  );

create policy variant_reorder_requests_select_own_org
  on variant_reorder_requests for select to authenticated
  using (
    exists (
      select 1 from user_organizations uo
       where uo.user_id = auth.uid()
         and uo.organization_id = variant_reorder_requests.organization_id
    )
  );

create policy variant_reorder_requests_select_staff
  on variant_reorder_requests for select to authenticated
  using (
    exists (
      select 1 from staff_users s
       where s.user_id = auth.uid() and s.is_active
         and (s.role in ('admin','super_admin')
              or s.permissions ? 'inventory'
              or s.permissions ? 'inventory:write'
              or s.permissions ? 'orders'
              or s.permissions ? 'orders:write')
    )
  );

-- staff_quotes: customer can insert and read own rows.
alter table staff_quotes enable row level security;

create policy staff_quotes_insert_own
  on staff_quotes for insert to authenticated
  with check (submitted_by_user_id = auth.uid());

create policy staff_quotes_select_own
  on staff_quotes for select to authenticated
  using (submitted_by_user_id = auth.uid());

create policy staff_quotes_select_staff
  on staff_quotes for select to authenticated
  using (
    exists (
      select 1 from staff_users s
       where s.user_id = auth.uid() and s.is_active
         and (s.role in ('admin','super_admin')
              or s.permissions ? 'quotes:write'
              or s.permissions ? 'quotes:approve'
              or s.permissions ? 'quote-tool')
    )
  );
```

- [x] **Step 2: Verify policies exist**

```sql
select polname from pg_policy
 where polrelid in ('variant_reorder_requests'::regclass, 'staff_quotes'::regclass)
 order by polname;
-- expect 6 rows (3 per table)
```

Verified 2026-04-24: `variant_reorder_requests` has 3 new policies; `staff_quotes` has 3 new plus the 2 pre-existing (`staff_quotes_admin_access`, `staff_quotes_own_access`) — total 5, additive and non-conflicting.

- [x] **Step 3: Commit**

---

## Task 3: Fix `getCompanyAccess` b2b_accounts lookup

**Files:**
- Modify: `print-room-portal/lib/company.ts` lines 73-77

**Why:** current code uses `.eq('id', orgMembership.organization_id)` which matched only by accident when those IDs coincided in old seed data. The CSR plan added a proper FK `b2b_accounts.organization_id`. Switch to that.

- [ ] **Step 1: Edit**

Change lines 73-77 of [lib/company.ts](print-room-portal/lib/company.ts#L73-L77) from:

```ts
  const { data: b2bAccount } = await supabase
    .from('b2b_accounts')
    .select('*')
    .eq('id', orgMembership.organization_id)
    .single()
```

To:

```ts
  const { data: b2bAccount } = await supabase
    .from('b2b_accounts')
    .select('*')
    .eq('organization_id', orgMembership.organization_id)
    .maybeSingle()
```

(`maybeSingle()` because orgs without a b2b_accounts row should not error — `getCompanyAccess` already guards against null `b2bAccount` downstream.)

- [ ] **Step 2: Type-check**

```bash
cd c:/Users/MSI/Documents/Projects/print-room-portal
npx tsc --noEmit
```

- [ ] **Step 3: Manual check** — sign in as a customer user attached to an org with a `b2b_accounts` row and verify the tier surfaces correctly in the existing UI.

- [ ] **Step 4: Commit**

```bash
git add lib/company.ts
git commit -m "fix(company): look up b2b_accounts by organization_id FK"
```

---

## Task 4: Duplicate Monday production-job helper

**Files:**
- Create: `print-room-portal/lib/monday/production-job.ts`

**Acceptance:** file exists with the same exports and signature as the staff-portal version. Lead comment references the canonical source.

- [ ] **Step 1: Copy**

Create `print-room-portal/lib/monday/production-job.ts` with the exact code from the staff-portal CSR plan Task 7 (the `createMondayProductionItem`, `createMondayProductionSubitem`, `pushProductionJob` trio). The imports are already correct for this repo — `./client` and `./column-ids` exist here.

Prepend this comment to the top:

```ts
/**
 * DUPLICATE of print-room-staff-portal/src/lib/monday/production-job.ts.
 * Kept in sync manually for v1 (per customer-b2b-checkout-mvp spec §4.3).
 * Follow-up (v1.1): extract to a shared package.
 */
```

- [ ] **Step 2: Type-check + commit**

---

## Task 5: `lib/checkout/server.ts` — customer auth helper

**Files:**
- Create: `print-room-portal/lib/checkout/server.ts`

**Acceptance criteria:**
- `requireB2BCustomer()` returns `{ admin, context }` where context contains `userId, email, organizationId, organizationName, customerCode, b2bAccountId, tierLevel, paymentTerms, defaultDepositPercent, storeIds`.
- 401 if not authed.
- 403 if no `user_organizations` row.
- 400 if the org has no `customer_code` (and the caller is in a submit path — opt via `{ requireCustomerCode: true }`).

- [ ] **Step 1: Write**

```ts
import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase'

export interface B2BCustomerContext {
  userId: string
  email: string
  fullName: string
  organizationId: string
  organizationName: string
  customerCode: string | null
  b2bAccountId: string | null
  tierLevel: number | null
  paymentTerms: string | null
  defaultDepositPercent: number | null
  storeIds: string[]
}

export async function requireB2BCustomer(
  opts: { requireCustomerCode?: boolean } = {}
) {
  const supabase = getSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: membership } = await supabase
    .from('user_organizations')
    .select('organization_id')
    .eq('user_id', user.id).single()
  if (!membership) {
    return { error: NextResponse.json({ error: 'No organization on this account' }, { status: 403 }) }
  }

  const [{ data: org }, { data: b2b }, { data: stores }, { data: profile }] = await Promise.all([
    supabase.from('organizations').select('id, name, customer_code').eq('id', membership.organization_id).single(),
    supabase.from('b2b_accounts')
      .select('id, tier_level, payment_terms, default_deposit_percent')
      .eq('organization_id', membership.organization_id).maybeSingle(),
    supabase.from('stores').select('id').eq('organization_id', membership.organization_id),
    supabase.from('profiles').select('email, full_name').eq('id', user.id).maybeSingle(),
  ])
  if (!org) return { error: NextResponse.json({ error: 'Organization not found' }, { status: 404 }) }

  if (opts.requireCustomerCode && !org.customer_code) {
    return { error: NextResponse.json(
      { error: 'Your account has no customer_code set. Contact staff to set up your account.' },
      { status: 400 }
    ) }
  }

  return {
    admin: supabase,
    context: {
      userId: user.id,
      email: profile?.email ?? user.email ?? '',
      fullName: profile?.full_name ?? '',
      organizationId: org.id,
      organizationName: org.name,
      customerCode: org.customer_code,
      b2bAccountId: b2b?.id ?? null,
      tierLevel: b2b?.tier_level ?? null,
      paymentTerms: b2b?.payment_terms ?? null,
      defaultDepositPercent: b2b?.default_deposit_percent ?? null,
      storeIds: (stores ?? []).map((s) => s.id),
    } satisfies B2BCustomerContext,
  }
}
```

- [ ] **Step 2: Commit**

---

## Task 6: `GET /api/shop/products` — catalog

**Files:**
- Create: `print-room-portal/app/api/shop/products/route.ts`

**Acceptance criteria:**
- Query params: `q` (search), `brand_id`, `category_id`, `garment_family`, `limit` (default 24, max 100), `offset` (default 0).
- Returns `{ products: Array<{ id, name, sku, image_url, brand_id, category_id, from_unit_price: number, has_stock: boolean }>, total }`.
- `from_unit_price` is the unit price at the product's MOQ (or qty 1) through `get_unit_price`.
- `has_stock` is `true` only if the org is stocked-inventory for this product AND ≥1 variant has `available_qty > 0`.
- 403 if no org.

- [ ] **Step 1: Write**

```ts
import { NextResponse } from 'next/server'
import { requireB2BCustomer } from '@/lib/checkout/server'

export async function GET(request: Request) {
  const auth = await requireB2BCustomer()
  if ('error' in auth) return auth.error
  const { admin, context } = auth

  const p = new URL(request.url).searchParams
  const limit = Math.min(100, Math.max(1, Number(p.get('limit') ?? 24)))
  const offset = Math.max(0, Number(p.get('offset') ?? 0))

  let q = admin.from('products')
    .select(
      'id, name, sku, image_url, brand_id, category_id, moq, garment_family, ' +
      '_channel:product_type_activations!inner(product_type,is_active)',
      { count: 'exact' }
    )
    .eq('is_active', true)
    .eq('_channel.product_type', 'b2b')
    .eq('_channel.is_active', true)
    .order('name', { ascending: true })
    .range(offset, offset + limit - 1)

  const search = p.get('q')
  if (search) q = q.ilike('name', `%${search}%`)
  if (p.get('brand_id')) q = q.eq('brand_id', p.get('brand_id'))
  if (p.get('category_id')) q = q.eq('category_id', p.get('category_id'))
  if (p.get('garment_family')) q = q.eq('garment_family', p.get('garment_family'))

  const { data, count, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ products: [], total: 0 })

  // Batch unit-price + stock presence.
  const results = await Promise.all(data.map(async (prod) => {
    const moq = (prod.moq ?? 1) || 1
    const { data: price } = await admin.rpc('get_unit_price', {
      p_product_id: prod.id, p_org_id: context.organizationId, p_qty: moq,
    })
    const { data: stocked } = await admin
      .from('variant_availability')
      .select('variant_id')
      .eq('organization_id', context.organizationId)
      .gt('available_qty', 0)
      .in('variant_id', (await admin
        .from('product_variants').select('id').eq('product_id', prod.id)
      ).data?.map((v) => v.id) ?? [])
      .limit(1)
    return {
      id: prod.id, name: prod.name, sku: prod.sku, image_url: prod.image_url,
      brand_id: prod.brand_id, category_id: prod.category_id,
      from_unit_price: Number(price ?? 0),
      has_stock: (stocked?.length ?? 0) > 0,
    }
  }))

  return NextResponse.json({ products: results, total: count ?? 0, limit, offset })
}
```

- [ ] **Step 2: cURL smoke + commit**

---

## Task 7: `GET /api/shop/products/[id]` — product detail

**Files:**
- Create: `print-room-portal/app/api/shop/products/[id]/route.ts`

**Acceptance criteria:**
- Returns `{ product, variants, brackets }` where:
  - `product`: id, name, description, brand_id, category_id, moq, lead_time_days, sizing_type, decoration_eligible, decoration_price, image_url, specs.
  - `variants`: array of `{ variant_id, color_swatch_id, color_label, color_hex, size_id, size_label, size_order }` joined with `product_variants`, `product_color_swatches`, `sizes`.
  - `brackets`: `product_pricing_tiers` rows (for client to display volume-pricing table).

- [ ] **Step 1: Write**

```ts
import { NextResponse } from 'next/server'
import { requireB2BCustomer } from '@/lib/checkout/server'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireB2BCustomer()
  if ('error' in auth) return auth.error
  const { admin } = auth
  const { id } = await params

  const [{ data: product, error: pErr }, { data: variants }, { data: brackets }] = await Promise.all([
    admin.from('products')
      .select(
        'id, name, description, brand_id, category_id, moq, lead_time_days, sizing_type, ' +
        'decoration_eligible, decoration_price, image_url, specs, is_active, ' +
        '_channel:product_type_activations!inner(product_type,is_active)'
      )
      .eq('id', id)
      .eq('_channel.product_type', 'b2b')
      .eq('_channel.is_active', true)
      .single(),
    admin.from('product_variants')
      .select(`
        id, color_swatch_id, size_id,
        product_color_swatches (label, hex, position),
        sizes (label, order_index)
      `)
      .eq('product_id', id).eq('is_active', true),
    admin.from('product_pricing_tiers')
      .select('min_quantity, max_quantity, unit_price')
      .eq('product_id', id).eq('is_active', true)
      .order('min_quantity', { ascending: true }),
  ])

  // B2B channel filter enforced at query level via !inner on product_type_activations.
  // A product without `product_type='b2b' AND is_active=true` returns no row and 404s here.
  if (pErr || !product || !product.is_active) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 })
  }

  const mappedVariants = (variants ?? []).map((v: any) => ({
    variant_id: v.id,
    color_swatch_id: v.color_swatch_id,
    color_label: v.product_color_swatches?.label ?? null,
    color_hex: v.product_color_swatches?.hex ?? null,
    color_position: v.product_color_swatches?.position ?? 0,
    size_id: v.size_id,
    size_label: v.sizes?.label ?? null,
    size_order: v.sizes?.order_index ?? 0,
  }))

  return NextResponse.json({ product, variants: mappedVariants, brackets: brackets ?? [] })
}
```

- [ ] **Step 2: cURL smoke + commit**

---

## Task 8: `GET /api/shop/products/[id]/availability`

**Files:**
- Create: `print-room-portal/app/api/shop/products/[id]/availability/route.ts`

**Acceptance criteria:**
- Returns `{ availability: Record<variantId, available_qty> }` for the customer's org.
- Returns `{ availability: {} }` for orgs that don't stock this product.

- [ ] **Step 1: Write**

```ts
import { NextResponse } from 'next/server'
import { requireB2BCustomer } from '@/lib/checkout/server'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireB2BCustomer()
  if ('error' in auth) return auth.error
  const { admin, context } = auth
  const { id: productId } = await params

  const { data: variants } = await admin
    .from('product_variants').select('id').eq('product_id', productId)
  const variantIds = (variants ?? []).map((v) => v.id)
  if (!variantIds.length) return NextResponse.json({ availability: {} })

  const { data: rows } = await admin
    .from('variant_availability')
    .select('variant_id, available_qty')
    .eq('organization_id', context.organizationId)
    .in('variant_id', variantIds)

  const availability: Record<string, number> = {}
  for (const r of rows ?? []) availability[r.variant_id] = r.available_qty
  return NextResponse.json({ availability })
}
```

- [ ] **Step 2: Commit**

---

## Task 9: `POST /api/shop/pricing`

**Files:**
- Create: `print-room-portal/app/api/shop/pricing/route.ts`

**Acceptance criteria:**
- Body `{ product_id, qty }`.
- Returns `{ unit_price, total, bracket: { min_quantity, max_quantity } | null }`.
- Calls `get_unit_price` with the customer's `organizationId`.

- [ ] **Step 1: Write**

```ts
import { NextResponse } from 'next/server'
import { requireB2BCustomer } from '@/lib/checkout/server'

export async function POST(request: Request) {
  const auth = await requireB2BCustomer()
  if ('error' in auth) return auth.error
  const { admin, context } = auth
  let body: { product_id?: string; qty?: number }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body.product_id || !body.qty || !Number.isInteger(body.qty) || body.qty <= 0) {
    return NextResponse.json({ error: 'product_id and positive integer qty required' }, { status: 400 })
  }

  const [{ data: price }, { data: bracket }] = await Promise.all([
    admin.rpc('get_unit_price', {
      p_product_id: body.product_id, p_org_id: context.organizationId, p_qty: body.qty,
    }),
    admin.from('product_pricing_tiers')
      .select('min_quantity, max_quantity')
      .eq('product_id', body.product_id).eq('is_active', true)
      .lte('min_quantity', body.qty)
      .order('min_quantity', { ascending: false }).limit(1).maybeSingle(),
  ])
  const unit = Number(price ?? 0)
  return NextResponse.json({
    unit_price: unit,
    total: Number((unit * body.qty).toFixed(2)),
    bracket: bracket ?? null,
  })
}
```

- [ ] **Step 2: Commit**

---

## Task 10: `CartProvider` context + localStorage

**Files:**
- Create: `print-room-portal/lib/cart/types.ts`
- Create: `print-room-portal/components/cart/CartProvider.tsx` (`'use client'`)
- Create: `print-room-portal/components/cart/useCart.ts`

**Acceptance criteria:**
- `CartLine` shape: `{ lineId: string (uuid), productId: string, productName: string, variantId: string, variantLabel: string, qty: number, unitPrice: number, imageUrl: string | null, shipToStoreId?: string | null }`.
- Provider accepts `organizationId` prop; keys `localStorage` as `pr-cart:<organizationId>`.
- Exposes `{ lines, addLine, updateLine, removeLine, clear, setShipTo }`.
- Hydrates from localStorage on mount.
- No server calls — everything local.

- [ ] **Step 1: Write `lib/cart/types.ts`**

```ts
export interface CartLine {
  lineId: string
  productId: string
  productName: string
  variantId: string
  variantLabel: string
  qty: number
  unitPrice: number
  imageUrl: string | null
  shipToStoreId?: string | null
}

export interface CartState {
  lines: CartLine[]
}
```

- [ ] **Step 2: Write `components/cart/CartProvider.tsx`**

```tsx
'use client'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { CartLine, CartState } from '@/lib/cart/types'

interface CartApi {
  lines: CartLine[]
  addLine: (line: Omit<CartLine, 'lineId'>) => void
  updateLine: (lineId: string, patch: Partial<CartLine>) => void
  removeLine: (lineId: string) => void
  setShipTo: (lineId: string, storeId: string | null) => void
  clear: () => void
}

const CartContext = createContext<CartApi | null>(null)

export function CartProvider({
  organizationId,
  children,
}: { organizationId: string | null; children: ReactNode }) {
  const [state, setState] = useState<CartState>({ lines: [] })

  const storageKey = organizationId ? `pr-cart:${organizationId}` : null

  // Hydrate
  useEffect(() => {
    if (!storageKey) return
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) setState(JSON.parse(raw))
    } catch {}
  }, [storageKey])

  // Persist
  useEffect(() => {
    if (!storageKey) return
    localStorage.setItem(storageKey, JSON.stringify(state))
  }, [state, storageKey])

  const api: CartApi = {
    lines: state.lines,
    addLine: (line) => setState((s) => {
      // Merge if same (productId, variantId) — increment qty.
      const existing = s.lines.find((l) => l.productId === line.productId && l.variantId === line.variantId)
      if (existing) {
        return { lines: s.lines.map((l) => l === existing ? { ...l, qty: l.qty + line.qty } : l) }
      }
      return { lines: [...s.lines, { ...line, lineId: crypto.randomUUID() }] }
    }),
    updateLine: (lineId, patch) => setState((s) => ({
      lines: s.lines.map((l) => l.lineId === lineId ? { ...l, ...patch } : l),
    })),
    removeLine: (lineId) => setState((s) => ({ lines: s.lines.filter((l) => l.lineId !== lineId) })),
    setShipTo: (lineId, storeId) => setState((s) => ({
      lines: s.lines.map((l) => l.lineId === lineId ? { ...l, shipToStoreId: storeId } : l),
    })),
    clear: () => setState({ lines: [] }),
  }

  return <CartContext.Provider value={api}>{children}</CartContext.Provider>
}

export function useCart() {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be within CartProvider')
  return ctx
}
```

- [ ] **Step 3: Wire into `(portal)/layout.tsx`**

Read the current layout; wrap `{children}` with `<CartProvider organizationId={orgId}>` after deriving `orgId` from `getCompanyAccess` (or a simpler direct query).

- [ ] **Step 4: Commit**

---

## Task 11: UI — `/shop` catalogue

**Files:**
- Create: `print-room-portal/app/(portal)/shop/page.tsx`
- Create: `print-room-portal/components/shop/ProductCard.tsx`

**Acceptance criteria:**
- Server component fetches `/api/shop/products` via the admin client directly (no self-HTTP).
- Renders a grid of `<ProductCard>`s — thumbnail, name, brand, from-price, in-stock badge when `has_stock`.
- Empty state when org has no access (customer_code null is NOT required here — only for submit).

- [ ] **Step 1: `page.tsx`**

```tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { requireB2BCustomer } from '@/lib/checkout/server'
import { ProductCard } from '@/components/shop/ProductCard'

export const dynamic = 'force-dynamic'

export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; brand_id?: string; page?: string }>
}) {
  const sp = await searchParams
  const auth = await requireB2BCustomer()
  if ('error' in auth) redirect('/account')
  const { admin, context } = auth

  const limit = 24
  const page = Math.max(1, Number(sp.page ?? 1))
  const offset = (page - 1) * limit

  let q = admin.from('products')
    .select(
      'id, name, sku, image_url, brand_id, category_id, moq, ' +
      '_channel:product_type_activations!inner(product_type,is_active)',
      { count: 'exact' }
    )
    .eq('is_active', true)
    .eq('_channel.product_type', 'b2b')
    .eq('_channel.is_active', true)
    .order('name').range(offset, offset + limit - 1)
  if (sp.q) q = q.ilike('name', `%${sp.q}%`)
  if (sp.brand_id) q = q.eq('brand_id', sp.brand_id)

  const { data, count } = await q
  const products = await Promise.all((data ?? []).map(async (p) => {
    const { data: price } = await admin.rpc('get_unit_price', {
      p_product_id: p.id, p_org_id: context.organizationId, p_qty: p.moq ?? 1,
    })
    return { ...p, from_unit_price: Number(price ?? 0), has_stock: false /* computed below */ }
  }))

  return (
    <div className="p-4 md:p-8">
      <h1 className="text-2xl font-semibold">Shop</h1>
      {/* Filter form (GET, updates searchParams) omitted for brevity */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mt-6">
        {products.length === 0 ? (
          <div className="col-span-full text-gray-500">
            No products available for your account yet — contact us at{' '}
            <a className="underline" href="mailto:sales@theprint-room.co.nz">sales@theprint-room.co.nz</a>.
          </div>
        ) : products.map((p) => (
          <Link key={p.id} href={`/shop/${p.id}`}>
            <ProductCard product={p} />
          </Link>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: `ProductCard.tsx`** — presentational, shows image/name/from-price.

- [ ] **Step 3: Manual check** — load as a B2B customer, see the grid.

- [ ] **Step 4: Commit**

---

## Task 12: UI — `/shop/[productId]` product detail + variant picker + add-to-cart

**Files:**
- Create: `print-room-portal/app/(portal)/shop/[productId]/page.tsx`
- Create: `print-room-portal/components/shop/ProductDetailClient.tsx` (`'use client'`)
- Create: `print-room-portal/components/shop/VariantPicker.tsx`
- Create: `print-room-portal/components/shop/AvailabilityBadge.tsx`
- Create: `print-room-portal/components/shop/RequestReorderModal.tsx`

**Acceptance criteria (spec §7):**
- Server fetches product + variants + brackets + availability in parallel and passes to the client.
- Variant picker: color swatches (distinct colors) × size pills. Defaults to first active combo.
- Availability badge per variant:
  - `> 0`: green "In stock (N available)".
  - `= 0` + org is stocked-inventory (availability record present even if 0): red "Out of stock", disables add-to-cart, shows "Request reorder".
  - Missing key: no badge.
- Qty input with `min = product.moq` (MTO) or `min = 1` (stocked). `step = 1`.
- Unit price: debounce 300ms on qty change → `POST /api/shop/pricing`. Show "Unit $X · Total $Y".
- Add to cart: calls `useCart().addLine(...)`, then toast "Added to cart". Button disabled when OOS or qty < min.

- [ ] **Step 1: `page.tsx`** (server)

Fetches product + availability server-side, renders `<ProductDetailClient>`.

```tsx
import { notFound } from 'next/navigation'
import { requireB2BCustomer } from '@/lib/checkout/server'
import { ProductDetailClient } from '@/components/shop/ProductDetailClient'

export const dynamic = 'force-dynamic'

export default async function ProductDetailPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params
  const auth = await requireB2BCustomer()
  if ('error' in auth) return notFound()
  const { admin, context } = auth

  const [{ data: product }, { data: variants }, { data: brackets }, { data: availRows }] = await Promise.all([
    admin.from('products')
      .select('*, _channel:product_type_activations!inner(product_type,is_active)')
      .eq('id', productId)
      .eq('_channel.product_type', 'b2b')
      .eq('_channel.is_active', true)
      .single(),
    admin.from('product_variants')
      .select(`id, color_swatch_id, size_id,
               product_color_swatches (label, hex, position),
               sizes (label, order_index)`)
      .eq('product_id', productId).eq('is_active', true),
    admin.from('product_pricing_tiers').select('min_quantity, max_quantity, unit_price')
      .eq('product_id', productId).eq('is_active', true).order('min_quantity'),
    admin.from('variant_availability').select('variant_id, available_qty')
      .eq('organization_id', context.organizationId),
  ])
  // B2B channel filter enforced at query level via !inner on product_type_activations.
  if (!product || !product.is_active) return notFound()

  const availability: Record<string, number> = {}
  for (const r of availRows ?? []) availability[r.variant_id] = r.available_qty

  return (
    <ProductDetailClient
      product={product}
      variants={(variants ?? []).map((v: any) => ({
        variant_id: v.id, color_swatch_id: v.color_swatch_id, size_id: v.size_id,
        color_label: v.product_color_swatches?.label,
        color_hex: v.product_color_swatches?.hex,
        size_label: v.sizes?.label, size_order: v.sizes?.order_index ?? 0,
      }))}
      brackets={brackets ?? []}
      availability={availability}
      organizationId={context.organizationId}
    />
  )
}
```

- [ ] **Step 2: `ProductDetailClient.tsx`** — manages selected variant, qty, live price fetch, add-to-cart dispatch.

- [ ] **Step 3: `VariantPicker.tsx`** — swatches × size pills, onChange emits `variantId`.

- [ ] **Step 4: `AvailabilityBadge.tsx`** — three-state badge (in stock / OOS / no badge).

- [ ] **Step 5: `RequestReorderModal.tsx`** — posts to `/api/checkout/reorder-request` with `{ variant_id, requested_qty, note }`.

- [ ] **Step 6: Manual check** — view a stocked product, see badges; try OOS variant → add-to-cart disabled, reorder button visible.

- [ ] **Step 7: Commit**

---

## Task 13: UI — `/cart`

**Files:**
- Create: `print-room-portal/app/(portal)/cart/page.tsx`
- Create: `print-room-portal/components/cart/CartTable.tsx`

**Acceptance criteria (spec §8):**
- Lists cart lines with editable qty.
- For stocked variants, fetches availability once on mount via `GET /api/shop/products/[id]/availability` per product (batched) and renders per-line badges.
- Rows with `qty > available_qty` highlight red; "Reduce to N" inline button sets qty.
- Summary panel: subtotal (sum of `qty * unitPrice`), expected deposit ($ + %), "Proceed to checkout" button (disabled if any oversell).

- [ ] **Step 1: `page.tsx`** (`'use client'` + useCart)

```tsx
'use client'
import { useRouter } from 'next/navigation'
import { useCart } from '@/components/cart/useCart'
import { CartTable } from '@/components/cart/CartTable'
import { Button } from '@/components/ui/button'

export default function CartPage() {
  const cart = useCart()
  const router = useRouter()
  const subtotal = cart.lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0)

  return (
    <div className="p-4 md:p-8">
      <h1 className="text-2xl font-semibold">Cart</h1>
      <CartTable lines={cart.lines} onUpdateQty={(id, qty) => cart.updateLine(id, { qty })} onRemove={cart.removeLine} />
      <div className="mt-6 flex items-center justify-between">
        <div className="text-lg">Subtotal: <span className="font-semibold">${subtotal.toFixed(2)}</span></div>
        <Button onClick={() => router.push('/checkout')} disabled={cart.lines.length === 0}>
          Proceed to checkout
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: `CartTable.tsx`** — presentational table with qty input + remove button. Availability check is a separate component overlay that fetches once.

- [ ] **Step 3: Commit**

---

## Task 14: `POST /api/checkout/reorder-request`

**Files:**
- Create: `print-room-portal/app/api/checkout/reorder-request/route.ts`
- Create: `print-room-portal/lib/checkout/reorder-request.ts`

**Acceptance criteria:**
- Body: `{ variant_id, requested_qty, note? }`.
- Inserts `variant_reorder_requests` row with `organization_id = context.organizationId`, `requested_by = context.userId`.
- Calls `notifyStaffReorder(row)` — v1 logs to console.
- Returns `{ ok: true, id }`.

- [ ] **Step 1: Write the helper**

```ts
// lib/checkout/reorder-request.ts
import type { B2BCustomerContext } from '@/lib/checkout/server'

export async function createReorderRequest(
  admin: any,
  context: B2BCustomerContext,
  payload: { variant_id: string; requested_qty: number; note?: string }
) {
  const { data, error } = await admin
    .from('variant_reorder_requests')
    .insert({
      organization_id: context.organizationId,
      variant_id: payload.variant_id,
      requested_qty: payload.requested_qty,
      requested_by: context.userId,
      note: payload.note ?? null,
    })
    .select('*').single()
  if (error) throw new Error(error.message)

  // v1: console log. v1.1: Slack/email.
  console.info('[reorder-request]', {
    org: context.organizationName,
    variant: payload.variant_id,
    qty: payload.requested_qty,
    note: payload.note,
  })
  return data
}
```

- [ ] **Step 2: Write the route**

```ts
import { NextResponse } from 'next/server'
import { requireB2BCustomer } from '@/lib/checkout/server'
import { createReorderRequest } from '@/lib/checkout/reorder-request'

export async function POST(request: Request) {
  const auth = await requireB2BCustomer()
  if ('error' in auth) return auth.error
  let body: { variant_id?: string; requested_qty?: number; note?: string }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body.variant_id || !body.requested_qty || !Number.isInteger(body.requested_qty) || body.requested_qty <= 0) {
    return NextResponse.json({ error: 'variant_id + positive int requested_qty required' }, { status: 400 })
  }

  try {
    const row = await createReorderRequest(auth.admin, auth.context, {
      variant_id: body.variant_id, requested_qty: body.requested_qty, note: body.note,
    })
    return NextResponse.json({ ok: true, id: row.id })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
```

- [ ] **Step 3: Commit**

---

## Task 15: `POST /api/checkout` — place order

**Files:**
- Create: `print-room-portal/app/api/checkout/route.ts`
- Create: `print-room-portal/lib/checkout/submit.ts`

**Acceptance criteria:**
- Body: `{ idempotency_key, required_by?, notes?, lines: Array<{ product_id, variant_id?, qty, ship_to_store_id?: string | null }>, custom_shipping_address?: {...} }`.
- Auth via `requireB2BCustomer({ requireCustomerCode: true })`.
- Validates: at least one line; all ship_to_store_id values belong to the customer's org (reject 400 if not); custom address rule — if any line has `ship_to_store_id = null`, ALL must, and `custom_shipping_address` must be present.
- Server re-prices each line via `get_unit_price` (defence in depth — ignores client-sent prices).
- Builds the RPC payload and calls `submit_b2b_order` (same RPC the CSR tool uses). Payment_terms derived from `context.paymentTerms ?? 'net_20'`.
- After RPC returns, updates each new `quote_items.ship_to_store_id` per line mapping.
- Runs the Monday push via the local `pushProductionJob` helper (Task 4). Writes back `quotes.monday_item_id` + per-line `monday_subitem_id`.
- Returns `{ order_id, order_ref, monday_item_id, monday_push_error }`.
- On `OUT_OF_STOCK` from the RPC: 409 `{ error: 'OUT_OF_STOCK' }`.

- [ ] **Step 1: Write `lib/checkout/submit.ts`**

```ts
import type { B2BCustomerContext } from '@/lib/checkout/server'
import { pushProductionJob } from '@/lib/monday/production-job'
import { PRODUCTION_BOARD_ID } from '@/lib/monday/column-ids'

interface CheckoutLineInput {
  product_id: string
  product_name: string
  variant_id?: string | null
  qty: number
  ship_to_store_id?: string | null
}

export interface CheckoutInput {
  context: B2BCustomerContext
  idempotency_key: string
  required_by?: string | null
  notes?: string | null
  internal_notes?: string | null
  lines: CheckoutLineInput[]
  custom_shipping_address?: Record<string, unknown> | null
}

export interface CheckoutResult {
  order_id: string
  order_ref: string
  monday_item_id: string | null
  monday_push_error: string | null
}

export async function submitCustomerOrder(admin: any, input: CheckoutInput): Promise<CheckoutResult> {
  // Resolve shipping_address: union of store or custom.
  let shippingAddress: Record<string, unknown> = input.custom_shipping_address ?? {}
  if (!input.custom_shipping_address && input.lines[0]?.ship_to_store_id) {
    const { data: firstStore } = await admin.from('stores').select('*').eq('id', input.lines[0].ship_to_store_id).single()
    if (firstStore) shippingAddress = firstStore
  }

  // Re-price on server.
  const repriced = await Promise.all(input.lines.map(async (l) => {
    const { data: unit } = await admin.rpc('get_unit_price', {
      p_product_id: l.product_id, p_org_id: input.context.organizationId, p_qty: l.qty,
    })
    return { ...l, unit_price: Number(unit ?? 0) }
  }))

  const { data, error } = await admin.rpc('submit_b2b_order', {
    p_idempotency_key: input.idempotency_key,
    p_organization_id: input.context.organizationId,
    p_customer_code: input.context.customerCode!,
    p_customer_name: input.context.organizationName,
    p_customer_email: input.context.email,
    p_customer_phone: null,
    p_shipping_address: shippingAddress,
    p_payment_terms: input.context.paymentTerms ?? 'net_20',
    p_required_by: input.required_by ?? null,
    p_notes: input.notes ?? null,
    p_internal_notes: input.internal_notes ?? null,
    p_lines: repriced.map((l) => ({
      product_id: l.product_id,
      product_name: l.product_name,
      quantity: l.qty,
      unit_price: l.unit_price,
      variant_id: l.variant_id ?? null,
    })),
  })
  if (error) throw new Error(error.message)

  const row = Array.isArray(data) ? data[0] : data
  const { quote_id, order_id, order_ref } = row

  // Apply per-line ship_to_store_id.
  const { data: newLines } = await admin
    .from('quote_items').select('id, product_id, variant_id').eq('quote_id', quote_id)
  if (newLines) {
    for (const inLine of input.lines) {
      const match = (newLines as any[]).find(
        (x) => x.product_id === inLine.product_id
          && (x.variant_id ?? null) === (inLine.variant_id ?? null)
      )
      if (match && inLine.ship_to_store_id !== undefined) {
        await admin.from('quote_items')
          .update({ ship_to_store_id: inLine.ship_to_store_id ?? null })
          .eq('id', match.id)
      }
    }
  }

  // Monday push.
  let monday_item_id: string | null = null
  let monday_push_error: string | null = null
  try {
    const { data: q } = await admin.from('quotes')
      .select('order_ref, customer_name, customer_email, total_amount, required_by, payment_terms, notes, monday_item_id')
      .eq('id', quote_id).single()
    const { data: lines } = await admin
      .from('quote_items')
      .select(`id, product_name, quantity, unit_price, monday_subitem_id,
               product_variants (
                 product_color_swatches (label),
                 sizes (label)
               )`)
      .eq('quote_id', quote_id)
    const order = {
      order_ref: q!.order_ref,
      customer_name: q!.customer_name,
      customer_email: q!.customer_email,
      total_price: Number(q!.total_amount),
      required_by: q!.required_by,
      payment_terms: q!.payment_terms,
      notes: q!.notes,
      monday_item_id: q!.monday_item_id,
    }
    const pLines = (lines ?? []).map((l: any) => ({
      quote_item_id: l.id,
      product_name: l.product_name,
      variant_label: [
        l.product_variants?.product_color_swatches?.label,
        l.product_variants?.sizes?.label,
      ].filter(Boolean).join(' / ') || '—',
      quantity: l.quantity,
      unit_price: Number(l.unit_price),
      decoration_summary: null,
      existing_subitem_id: l.monday_subitem_id,
    }))

    const result = await pushProductionJob(order, pLines)
    monday_item_id = result.itemId
    await admin.from('quotes').update({
      monday_item_id: result.itemId,
      monday_board_id: String(PRODUCTION_BOARD_ID),
    }).eq('id', quote_id)
    for (const [qItemId, subitemId] of Object.entries(result.subitemIds)) {
      await admin.from('quote_items').update({ monday_subitem_id: subitemId }).eq('id', qItemId)
    }
  } catch (e) {
    monday_push_error = (e as Error).message
  }

  return { order_id, order_ref, monday_item_id, monday_push_error }
}
```

- [ ] **Step 2: Write the route**

```ts
import { NextResponse } from 'next/server'
import { requireB2BCustomer } from '@/lib/checkout/server'
import { submitCustomerOrder } from '@/lib/checkout/submit'

export async function POST(request: Request) {
  const auth = await requireB2BCustomer({ requireCustomerCode: true })
  if ('error' in auth) return auth.error
  let body: any
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body.idempotency_key || !Array.isArray(body.lines) || body.lines.length === 0) {
    return NextResponse.json({ error: 'idempotency_key + non-empty lines required' }, { status: 400 })
  }

  // Validate ship-to constraint: mixed per-line custom addresses not allowed.
  const hasNullShipTo = body.lines.some((l: any) => !l.ship_to_store_id)
  const allNullShipTo = body.lines.every((l: any) => !l.ship_to_store_id)
  if (hasNullShipTo && !allNullShipTo) {
    return NextResponse.json(
      { error: 'Mixed per-line custom ship-to addresses not supported in v1. Save each address as a store first.' },
      { status: 400 }
    )
  }
  if (allNullShipTo && !body.custom_shipping_address) {
    return NextResponse.json({ error: 'custom_shipping_address required when no ship_to_store_id provided' }, { status: 400 })
  }

  // Validate each ship_to_store_id belongs to this org.
  const storeIds = body.lines.map((l: any) => l.ship_to_store_id).filter(Boolean) as string[]
  for (const sid of storeIds) {
    if (!auth.context.storeIds.includes(sid)) {
      return NextResponse.json({ error: `Store ${sid} not on your account` }, { status: 400 })
    }
  }

  try {
    const result = await submitCustomerOrder(auth.admin, {
      context: auth.context,
      idempotency_key: body.idempotency_key,
      required_by: body.required_by ?? null,
      notes: body.notes ?? null,
      internal_notes: null,
      lines: body.lines,
      custom_shipping_address: body.custom_shipping_address ?? null,
    })
    return NextResponse.json(result)
  } catch (e) {
    const msg = (e as Error).message ?? ''
    if (msg.includes('OUT_OF_STOCK')) return NextResponse.json({ error: 'OUT_OF_STOCK' }, { status: 409 })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
```

- [ ] **Step 3: Commit**

---

## Task 16: `POST /api/checkout/quote-request`

**Files:**
- Create: `print-room-portal/app/api/checkout/quote-request/route.ts`
- Create: `print-room-portal/lib/checkout/quote-request.ts`

**Acceptance criteria:**
- Inserts a `staff_quotes` row with `status='draft'`, `staff_user_id=null`, `submitted_by_user_id=auth.uid()`, `customer_name = org name`, `customer_email = user email`, `quote_data` carrying cart lines.
- Computes `subtotal` and `total` from `get_unit_price` per line (same as place-order re-pricing).
- Does NOT reserve stock, does NOT push Monday.
- Returns `{ staff_quote_id }`.

- [ ] **Step 1: Helper**

```ts
// lib/checkout/quote-request.ts
import type { B2BCustomerContext } from '@/lib/checkout/server'

export async function createQuoteRequest(
  admin: any, context: B2BCustomerContext,
  lines: Array<{ product_id: string; product_name: string; variant_id?: string | null; qty: number }>
) {
  const priced = await Promise.all(lines.map(async (l) => {
    const { data: unit } = await admin.rpc('get_unit_price', {
      p_product_id: l.product_id, p_org_id: context.organizationId, p_qty: l.qty,
    })
    return { ...l, unit_price: Number(unit ?? 0), total_price: Number(unit ?? 0) * l.qty }
  }))
  const subtotal = priced.reduce((sum, l) => sum + l.total_price, 0)

  const quote_data = {
    source: 'customer-portal',
    items: priced.map((l) => ({
      productId: l.product_id,
      name: l.product_name,
      quantity: l.qty,
      unitPrice: l.unit_price,
      variantId: l.variant_id ?? null,
    })),
    orderExtras: [],
    customerName: context.organizationName,
    customerEmail: context.email,
    customerCompany: context.organizationName,
    submittedAt: new Date().toISOString(),
  }

  const { data, error } = await admin.from('staff_quotes').insert({
    submitted_by_user_id: context.userId,
    staff_user_id: null,
    status: 'draft',
    quote_data,
    subtotal,
    discount_percent: 0,
    total: subtotal,
    customer_name: context.organizationName,
    customer_email: context.email,
    customer_company: context.organizationName,
  }).select('id').single()
  if (error) throw new Error(error.message)
  return data.id as string
}
```

- [ ] **Step 2: Route**

```ts
import { NextResponse } from 'next/server'
import { requireB2BCustomer } from '@/lib/checkout/server'
import { createQuoteRequest } from '@/lib/checkout/quote-request'

export async function POST(request: Request) {
  const auth = await requireB2BCustomer()
  if ('error' in auth) return auth.error
  let body: any
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return NextResponse.json({ error: 'lines required' }, { status: 400 })
  }
  try {
    const id = await createQuoteRequest(auth.admin, auth.context, body.lines)
    return NextResponse.json({ staff_quote_id: id })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
```

- [ ] **Step 3: Commit**

---

## Task 17: UI — `/checkout` + confirmation

**Files:**
- Create: `print-room-portal/app/(portal)/checkout/page.tsx`
- Create: `print-room-portal/app/(portal)/checkout/confirmation/[orderId]/page.tsx`
- Create: `print-room-portal/components/checkout/CheckoutClient.tsx` (`'use client'`)
- Create: `print-room-portal/components/checkout/ShipToRow.tsx`

**Acceptance criteria (spec §9):**
- Server `/checkout/page.tsx` loads org stores + customer code; passes to `<CheckoutClient>`.
- Client renders per-line `<ShipToRow>` (store dropdown + "Custom address" toggle). Enforces: if any line is custom, all must be custom with one shared address (validation message inline).
- Shows deposit banner when `defaultDepositPercent > 0`.
- Two submit buttons:
  - "Place order" → POST `/api/checkout`; on 200 `router.push('/checkout/confirmation/' + order_id)`; on 409 → banner "Stock changed — please adjust your cart" + `router.push('/cart')`.
  - "Submit as quote request" → POST `/api/checkout/quote-request`; on 200 → `router.push('/quote-requests/' + id)`.
- Customer-code gate: if `customerCode` null, disable Place Order and show "Your account is pending setup — contact staff".

- [ ] **Step 1: `page.tsx`**

```tsx
import { redirect } from 'next/navigation'
import { requireB2BCustomer } from '@/lib/checkout/server'
import { CheckoutClient } from '@/components/checkout/CheckoutClient'

export const dynamic = 'force-dynamic'

export default async function CheckoutPage() {
  const auth = await requireB2BCustomer()
  if ('error' in auth) redirect('/account')
  const { admin, context } = auth
  const { data: stores } = await admin.from('stores').select('*').eq('organization_id', context.organizationId)
  return (
    <CheckoutClient
      stores={stores ?? []}
      customerCode={context.customerCode}
      paymentTerms={context.paymentTerms}
      defaultDepositPercent={context.defaultDepositPercent}
    />
  )
}
```

- [ ] **Step 2: `CheckoutClient.tsx`** — reads `useCart()`, manages ship-to state, submits via fetch. Full handler code per spec §9.4.

- [ ] **Step 3: `/checkout/confirmation/[orderId]/page.tsx`** — server fetches order + quote; shows `order_ref`, line summary, Monday sync status, "Copy ref" button.

```tsx
import { requireB2BCustomer } from '@/lib/checkout/server'
import { notFound } from 'next/navigation'

export default async function ConfirmationPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params
  const auth = await requireB2BCustomer()
  if ('error' in auth) return notFound()
  const { admin, context } = auth
  const { data: order } = await admin
    .from('orders').select(`id, status, total_price, quotes!inner (order_ref, monday_item_id)`).eq('id', orderId).single()
  if (!order) return notFound()
  return (
    <div className="p-4 md:p-8 max-w-2xl">
      <h1 className="text-2xl font-semibold">Order received</h1>
      <p className="mt-2">Reference: <span className="font-mono">{(order.quotes as any).order_ref}</span></p>
      {!(order.quotes as any).monday_item_id && (
        <p className="mt-2 text-sm text-gray-600">Your order is received. We're syncing it to production now.</p>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Manual check** — full happy path with a seeded customer.

- [ ] **Step 5: Commit**

---

## Task 18: UI — `/quote-requests` list + detail

**Files:**
- Create: `print-room-portal/app/(portal)/quote-requests/page.tsx`
- Create: `print-room-portal/app/(portal)/quote-requests/[id]/page.tsx`

**Acceptance criteria (spec §10):**
- List: rows where `submitted_by_user_id = auth.uid()`, columns: submitted_at, line count, status, total (if priced).
- Detail: read-only summary of lines. If `status='approved'` and `total > 0`, show pricing block: "Staff priced this at $X. Accept?" — Accept/Decline buttons rendered but disabled with tooltip "In-app acceptance arrives in v1.1 — please confirm with your account manager."
- v1.1 TODO comment marks where the buttons will wire up.

- [ ] **Step 1: `quote-requests/page.tsx`**

```tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { requireB2BCustomer } from '@/lib/checkout/server'

export const dynamic = 'force-dynamic'

export default async function QuoteRequestsListPage() {
  const auth = await requireB2BCustomer()
  if ('error' in auth) redirect('/account')
  const { admin, context } = auth
  const { data } = await admin
    .from('staff_quotes')
    .select('id, status, total, created_at, quote_data')
    .eq('submitted_by_user_id', context.userId)
    .order('created_at', { ascending: false })

  return (
    <div className="p-4 md:p-8">
      <h1 className="text-2xl font-semibold">Your quote requests</h1>
      <ul className="mt-6 space-y-2">
        {(data ?? []).map((q: any) => (
          <li key={q.id}>
            <Link href={`/quote-requests/${q.id}`} className="block rounded border p-3 hover:bg-gray-50">
              <div className="flex justify-between">
                <span>{new Date(q.created_at).toLocaleDateString('en-NZ')}</span>
                <span className="text-sm">{q.status}</span>
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {q.quote_data?.items?.length ?? 0} line(s)
                {q.total ? ` · $${Number(q.total).toFixed(2)}` : ' · pending pricing'}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 2: `quote-requests/[id]/page.tsx`** — server fetches the row, renders line summary + pricing block when approved.

- [ ] **Step 3: Commit**

---

## Task 19: Sidebar nav entries for Shop / Cart / Quote Requests

**Files:**
- Modify: `print-room-portal/app/(portal)/layout.tsx` (or the sidebar component it uses)

**Acceptance:** nav links `Shop`, `Cart`, `Quote Requests` render inside the portal layout for any authenticated user with an `organization_id`.

- [ ] **Step 1: Read the current layout** to find the nav structure.

- [ ] **Step 2: Add the three entries** to wherever the existing `Account`, `Order Tracker`, `My Collections` links live.

- [ ] **Step 3: Commit**

---

## Task 20: End-to-end verification (spec §14)

- [ ] **Step 1: Seed a B2B customer (Bike Glendhu)**

Prerequisite: CSR plan has shipped. Via staff portal:
- Org `Bike Glendhu` with `customer_code = 'BIK'`.
- `b2b_accounts` row with `organization_id = <BIK>, tier_level = 2, payment_terms = 'net_20'`.
- One store (Wanaka).
- Inventory plan applied; via staff `/inventory`: track a product with the B2B channel active (editor Details tab → Channels → B2B = Active), receive 12 Black/M units.
- Create an `auth.users` row + `user_organizations` link + `profiles` row for the test customer user.

- [ ] **Step 2: Browse & add**

Sign in as the customer. Visit `/shop` → grid shows only products with the B2B channel active in `product_type_activations`. Open the stocked product.

```sql
-- Confirm availability endpoint:
select variant_id, available_qty from variant_availability
 where organization_id = '<BIK>' and available_qty > 0;
```

PDP shows "In stock (12 available)" on Black/M. Add 5 to cart.

- [ ] **Step 3: Checkout single-ship**

`/checkout`. Set all lines to Wanaka store. Place order.

```sql
select q.order_ref, o.id, q.monday_item_id
  from orders o join quotes q on q.id = o.quote_id
 where q.idempotency_key = '<IDK>';
-- expect order_ref = 'BIK-000123' (or current seq), monday_item_id non-null.

select stock_qty, committed_qty from variant_inventory where variant_id = '<BLACK_M>';
-- expect stock_qty=12, committed_qty=5.
```

- [ ] **Step 4: Checkout split-ship**

Add 3 lines to a fresh cart, set 2 different stores across them. Place order. Assert `quote_items.ship_to_store_id` set per line.

- [ ] **Step 5: Oversell block**

Cart has Black/M × 15 (only 7 available now after step 3 committed 5 = 12-5 = 7). Cart page highlights red; Proceed disabled. Click "Request reorder", submit.

```sql
select count(*) from variant_reorder_requests where organization_id = '<BIK>';
-- expect ≥1
```

Console shows `[reorder-request]` log.

- [ ] **Step 6: Quote request**

Cart with 2 lines. Click "Submit as Quote Request". Expect `/quote-requests/<id>` shows "Awaiting staff pricing".

```sql
select id, status, staff_user_id, submitted_by_user_id from staff_quotes
 where submitted_by_user_id = '<CUSTOMER_UUID>';
-- expect row with status='draft', staff_user_id=null.
```

- [ ] **Step 7: Race condition**

Using two browser sessions or two cURL calls in parallel, each request 3 Black/M when `available_qty = 5`. One succeeds, one returns 409 `OUT_OF_STOCK`. Net `committed_qty` should only have risen by 3.

- [ ] **Step 8: Non-B2B customer**

Sign in as a user without `user_organizations`. Visit `/shop` → redirects to `/account`. cURL `/api/shop/products` → 403.

- [ ] **Step 9: Monday push failure**

Set `MONDAY_API_TOKEN=invalid` in `.env.local` + restart dev. Place order. Order row persists with `monday_item_id = null`; confirmation page shows "syncing to production" message.

```sql
select quotes.monday_item_id from orders o join quotes on quotes.id=o.quote_id where o.id='<NEW_ORDER>';
-- expect null
```

Restore token. Staff portal reconcile button (from CSR plan Task 17) recovers.

- [ ] **Step 10: Customer code missing**

Clear `organizations.customer_code` for a test org. Visit `/checkout` → Place Order disabled with "Your account is pending setup" message. Force via cURL → 400.

---

# Phase 2 — My Products (ordered-before view)

> **Scope clarification:** this is NOT the full B2B catalogue (`/shop`, Tasks 11-12). `/shop` shows every product with the B2B channel active. `/products` shows only products that the signed-in customer's company has ordered before. Two different views with different data sources:
>
> - `/shop` — sourced from `products` table filtered by `product_type_activations` B2B-active (Phase 1).
> - `/products` — sourced from past orders (`job_trackers.quote_data.items[]` for legacy; `quote_items` with `product_id` FK for post-MVP orders). Phase 2.
>
> Chris's on-phone ask was a "products associated with the user/companies orders" view — this section delivers that. The reorder CTA from the product page reuses the **already-implemented** `/api/reorder` endpoint (tracker-scoped).

## Task 21: `GET /api/shop/my-products` — past-ordered products for this customer

**Files:**
- Create: `app/api/shop/my-products/route.ts`
- Create: `lib/shop/past-products.ts` — pure function that extracts de-duped product entries from an array of `JobTracker` rows.

**Data source (pragmatic, works today):**
- Query `job_trackers` where `customer_email = user.email` (and later, once `organizations.customer_code` is set, also match org).
- Extract `tracker.quote_data.items[]`. Each item has `displayName`, `color`, `printMethod`, `sizes`, `artworkUrl` — use `lib/job-tracker.ts` getters.
- De-duplicate by `(displayName, color)` — two trackers with the same polo in the same colour collapse to one entry.
- Retain per-entry: `last_tracker_id`, `last_ordered_at`, `total_qty_across_orders`, `last_artwork_url`, `print_method`, `sizes_last_ordered`.
- Sort by `last_ordered_at DESC`.

**Response shape:**
```ts
{
  products: Array<{
    key: string            // hash of displayName+color, stable for URL routing
    display_name: string
    color: string | null
    print_method: string | null
    last_ordered_at: string  // ISO
    last_tracker_id: number
    total_qty: number
    image_url: string | null  // from last artwork if garment image unavailable
  }>
  total: number
}
```

**Acceptance criteria:**
- 401 if not signed in.
- Empty array if the customer has no completed trackers.
- Results include only trackers where `isTrackerCompleted(status) === true`.
- Deduplication is deterministic — running the endpoint twice with same trackers returns the same `key` values.

- [ ] **Step 1: extract helper** — `lib/shop/past-products.ts`. Pure function `extractPastProducts(trackers: JobTracker[]): PastProduct[]`. Unit-testable.
- [ ] **Step 2: route handler** — reads user, queries `job_trackers`, calls helper, returns.
- [ ] **Step 3: cURL smoke** as a customer with ≥1 completed tracker; expect non-empty products array.
- [ ] **Step 4: Commit.**

---

## Task 22: UI — `/products` list page

**Files:**
- Create: `app/(portal)/products/page.tsx` (server component)
- Create: `components/products/MyProductCard.tsx`

**Acceptance criteria:**
- Sidebar nav entry "Products" (updated in Task 19's existing sidebar file).
- Server component fetches via the admin client directly (no self-HTTP).
- Grid of `<MyProductCard>` — thumbnail (image_url or placeholder), display_name, color, "Last ordered Xd ago · Y units total".
- Empty state: "You haven't ordered any products yet. Once your first order ships, products appear here."
- Card click → `/products/[key]?from=<last_tracker_id>`.

- [ ] **Step 1: `page.tsx`** server component with the same auth pattern as `/order-tracker`.
- [ ] **Step 2: `MyProductCard.tsx`** presentational.
- [ ] **Step 3: Manual check** as customer — see grid of past products.
- [ ] **Step 4: Commit.**

---

## Task 23: UI — `/products/[key]` detail + pre-filled reorder

**Files:**
- Create: `app/(portal)/products/[key]/page.tsx` (server component)
- Create: `components/products/ProductDetailFromOrders.tsx` (client, wraps the existing `ReorderForm` pre-filled with the source tracker).

**Acceptance criteria:**
- URL param `key` matches one of the keys from Task 21 output.
- Query param `from=<trackerId>` identifies which past tracker to use as the reorder source.
- Page shows: image, display_name, color, print method, size breakdown last ordered, list of trackers this product appeared in with "Order again from <tracker_ref>" buttons.
- Primary CTA: "Reorder this product" → mounts the existing `<ReorderForm>` component from [components/orders/ReorderForm.tsx](print-room-portal/components/orders/ReorderForm.tsx) pre-filled with `trackerId = <from>`.
- On successful submission, redirect back to `/products` with a success toast.

**Key reuse principle:** do NOT create a second reorder endpoint. The Phase 1 prompt fixes `/api/reorder`; Phase 2 reuses it. Different entry point, same backend.

- [ ] **Step 1: server page** — resolves `key` + `from` → loads the tracker → derives the past-product entry → passes to client.
- [ ] **Step 2: client detail component** — renders summary + reorder form.
- [ ] **Step 3: Manual check** — navigate from `/products` → detail → submit reorder → confirm CRM item created.
- [ ] **Step 4: Commit.**

---

## Task 24: Wire Orders page product cards → `/products/[key]`

**Files:**
- Modify: `components/orders/JobTrackerOrderCard.tsx` (and any item-level sub-component that renders individual line items)

**Acceptance criteria:**
- Each line item inside an order card becomes clickable/linked.
- Click routes to `/products/[key]?from=<tracker.id>` where `key` is the same hash the `/api/shop/my-products` endpoint produces (shared helper in `lib/shop/past-products.ts` — export the hash function).
- Visual affordance: cursor + subtle hover state on clickable items.
- Non-product order cards (e.g. legacy trackers with empty `quote_data.items`) remain non-clickable.

- [ ] **Step 1: export the key-hash function from `lib/shop/past-products.ts`.**
- [ ] **Step 2: wrap each item row in a `<Link>`.**
- [ ] **Step 3: Manual check** — click an item on the Orders page, land on its Products detail page.
- [ ] **Step 4: Commit.**

---

## Task 25: Phase 2 end-to-end verification

- [ ] **Step 1:** Sign in as a test B2B customer with ≥2 completed trackers sharing at least one common product.
- [ ] **Step 2:** Visit `/products`. Confirm deduplicated grid (same polo in same colour appears once, not twice).
- [ ] **Step 3:** Click a product card → detail page loads with the correct tracker reference.
- [ ] **Step 4:** Click "Reorder this product" → form pre-fills → submit → toast → redirect to `/products`.
- [ ] **Step 5:** Open the Monday CRM board → confirm the reorder item was created (depends on Phase 1 reorder fix being landed first).
- [ ] **Step 6:** From the Orders page, click an individual line item in an order card → lands on the same Products detail page.

---

# Appendix — Test plan summary

- **DB / migrations:** Tasks 1, 2 — via `mcp__supabase__execute_sql` assertions.
- **HTTP / API:** Tasks 6, 7, 8, 9, 14, 15, 16 — cURL smoke against `npm run dev`.
- **UI / manual:** Tasks 11, 12, 13, 17, 18, 19.
- **End-to-end:** Task 20 walks spec §14.

# Appendix — Deferred follow-ups (noted in spec §13)

- Per-company catalogues (follows staff sub-app #3).
- Qty-splitting a single line across multiple addresses.
- Stripe / instant payment.
- Customer in-app Accept-priced-quote → order conversion.
- DB-backed cart for multi-device sync.
- PDF receipts / branded order confirmations.
- Design-tool handoff for products requiring decoration artwork.
- Monorepo extraction of the duplicated `production-job.ts`.
- Slack/email notification on reorder-request (currently console-only).

# Appendix — Consumed contracts (all defined by earlier plans)

From Inventory plan:
- `reserve_quote_line`, `variant_availability`, `product_variants`.
- `quote_items.monday_subitem_id` (added by Inventory plan).

From CSR plan:
- `submit_b2b_order`, `allocate_order_ref`, `get_unit_price`.
- `quotes.order_ref`, `order_number_seq`, `organizations.customer_code`, `b2b_accounts.organization_id`.
- `src/lib/monday/production-job.ts` signature (duplicated here in Task 4).

From Quote Builder plan:
- `staff_quotes.submitted_by_user_id` consumer (staff quote builder surfaces these as unassigned drafts).

This plan does not export new shared contracts — it is the terminal consumer in the spec dependency chain.

---

## Constraints added by 2026-04-24 amendments plan

The amendments plan at [2026-04-24-customer-checkout-mvp-amendments-plan.md](./2026-04-24-customer-checkout-mvp-amendments-plan.md) adds two forward-looking constraints this plan must honour when implementing the catalogue and cart surfaces:

### Catalogue nav label

- The `/shop` sidebar entry must render with the label **"Catalog"** (not "Shop"). Matches the Shopify vocabulary customers know. Route path stays `/shop`.

### Cart-chip visibility

When the cart chip/indicator is added to the layout (part of this plan's cart tasks), its visibility must be scoped to the following routes only:

- `/shop`
- `/shop/[productId]`
- `/cart`
- `/checkout`
- `/order-tracker`
- `/inventory`

On all other portal routes (`/account`, `/my-collections`, `/projects`, `/leavers-quotes`, etc.), the cart chip must not render. Use `usePathname()` from `next/navigation` and a `startsWith` check against the scoped route list.

Rationale: Chris's 2026-04-24 call — customers on non-ordering pages shouldn't see a cart indicator, to avoid confusion between browsing contexts.
