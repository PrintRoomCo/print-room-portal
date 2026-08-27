# Design — Location-manager (branch allow-list)

> **Date:** 2026-07-27 · **Author:** grounded code inspection (P + S) + design review with Jon.
> **Repos:** **P** = `print-room-portal` (customer, consumer — no migrations) · **S** =
> `print-room-staff-portal` (**schema owner** for shared Supabase `bthsxgmcnbvwwgvdveek`).
> **Status:** design approved (Option B locked; three judgment calls resolved; denormalize+backfill
> chosen 2026-07-27). Next: `superpowers:writing-plans`.
> **Relationship:** middle tier above the shipped multi-staff→location work (memory: feature #4,
> ALREADY IN PROD — `stores` + non-unique `user_organizations.default_store_id`, staff role-locked at
> checkout stamping `quote_items.ship_to_store_id`). This adds a **manager who spans >1 branch**
> without a new role. Sibling pattern: `b2b_member_catalogue_grants` (per-member allow-list). Mirror
> discipline follows `docs/superpowers/specs/2026-07-24-custom-name-personalisation-design.md`
> (mirror per-repo; no cross-repo runtime-share package — `vendor/print-room-onboarding` is
> onboarding-scoped only).

---

## Goal

Let a Print Room B2B **org_admin** designate a **staff-role member as a manager of one or more
branches** (an allow-list of `stores`), so that member can **order for** and **see the orders of**
every branch they manage — while ordinary single-branch staff and org_admins are **completely
unchanged**. The feature is **the grant table**: a staff member with ≥1 grant row is a manager; zero
rows = today's behaviour exactly. Ships **dark** — inert until the first grant is written.

## Approach — Option B: allow-list on staff, no new role (locked)

We reuse the existing `staff` role and layer a per-member branch allow-list on top, exactly mirroring
how `b2b_member_catalogue_grants` layers catalogue visibility onto a member. No new role, no
team-management surface, no multi-branch-per-order, no in-app group-by, no district tier.

**Manager = `role === 'staff'` AND ≥1 `b2b_member_store_grants` row.** org_admins already see/order
everything (`canSeeAllOrgOrders`, no BuyerScopeError) — grants are meaningless for them and never
consulted.

## Decisions locked

1. **No new role.** Allow-list on the existing `staff` role (Option B). — locked with Jon.
2. **Judgment call (a) — default_store_id vs the grant set → UNION AT READ, not write-mutation.**
   The check constraint `chk_buyer_has_default_store` (`user_organizations`) only requires a staff
   member to *have* a `default_store_id`; it does **not** require default ∈ grants. The real reason
   default must be allowed is checkout pre-selection + "staff can always order/see their home
   branch". `default_store_id` is written **independently** (`app/api/team/invite/route.ts:160`,
   `team/TeamClient.tsx:75`, and S's `.../members/[userId]/default-store/route.ts`), so mutating the
   grant set on write is fragile and pollutes replace-set semantics. **Resolution:**
   `allowedBranches = grants ∪ {default_store_id}`, computed at read via the pure
   `resolveBranchStoreIds()` (§C). Grant table stays semantically pure (= explicitly-managed
   branches); the invariant holds by construction regardless of later `default_store_id` edits.
3. **Judgment call (b) — order-level branch picker, not per-line.** REQUIRED, not merely preferred:
   `lib/checkout/submit.ts:469` resolves the whole order's shipping address from
   `input.lines[0].ship_to_store_id`; there is one `ship_to_store` CSV column, one Monday
   destination, one dispatch. Mixed branches would silently ship to line 1's store. The picker sets
   ONE branch applied to all lines; the guard **actively enforces** single-branch (the column is
   per-line and the UI already carries `perLineShipTo` — `CheckoutReviewClient.tsx:171` — so schema
   won't enforce it). — locked.
4. **Judgment call (c) — cross-repo split.** Correct AND mandatory: `AGENTS.md` — S owns the schema,
   P is "a consumer with no migrations", NEVER apply schema via MCP/dashboard. Caveat: the
   "shared replace-set API" is **mirrored per-repo**, not one endpoint (S and P are separately-
   deployed Next apps; P cannot call S's route). Each repo gets its own route writing
   `b2b_member_store_grants`; only the tiny pure `resolveBranchStoreIds()` + the diff helper are
   duplicated (identical unit tests), matching the custom-name "mirror" precedent. — locked.
5. **Section 3 branch predicate → DENORMALIZE + BACKFILL (chosen 2026-07-27).** `ship_to_store_id`
   lives only on `quote_items` (per-line); the orders view boundary `queryPastOrders`
   (`lib/orders/past-orders-query.ts:88`) joins `orders → quotes!inner` and never touches
   `quote_items`, so "orders shipped to branch ∈ set" is a grandchild predicate PostgREST can't `OR`
   against the quote-level `customer_email` filter. **Resolution:** denormalize
   `ship_to_store_id` onto the order header (`quotes.ship_to_store_id`), stamp it inside the
   `submit_b2b_order` RPC, backfill legacy orders (safe — every legacy order is single-branch
   because plain staff were hard-locked), index it. This is the feature-#7 precedent
   (denormalised `job_trackers.order_type`).

---

## Mirror map (sibling `catalogue` symbol → new `store` symbol)

| Catalogue-grants (shipped) | Store-grants (new) |
|---|---|
| table `b2b_member_catalogue_grants(membership_id, catalogue_id, granted_by, granted_at)` | table `b2b_member_store_grants(membership_id, store_id, granted_by, granted_at)` |
| S route `.../members/[userId]/access/route.ts` (GET+PUT replace-set) | S route `.../members/[userId]/store-grants/route.ts` (GET+PUT replace-set) |
| `AUDIT_ACTIONS.B2B_MEMBER_ACCESS_CHANGE` (`actions.ts:44`) | `AUDIT_ACTIONS.B2B_MEMBER_STORE_GRANTS_CHANGE` |
| S UI `components/b2b-accounts/MemberAccessEditor.tsx` (catalogue multi-select) | same file — add "Branches this member manages" multi-select alongside |
| P mid-flight re-verify `getGrantedCatalogueItemIds` (`lib/shop/member-access.ts`, used `submit.ts:479+`) | P mid-flight re-read of branch grants in `submit.ts` guard (§D) |

---

## Component design

Legend: **[S]** staff-portal, **[P]** portal. Symbol references are exact (file:line at time of
writing).

### A. Schema + denormalization — [S] one held migration

**File — Create:** `print-room-staff-portal/db/pending-migrations/20260727140000_location_manager_branch_grants.sql`
(held; applied only on Jon's go, then moved to `supabase/migrations/`). One migration bundles all
four schema concerns so the read-side and stamp land atomically.

```sql
-- 1. Grant table — mirror of b2b_member_catalogue_grants exactly.
create table if not exists public.b2b_member_store_grants (
  id           uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.user_organizations(id) on delete cascade,
  store_id     uuid not null references public.stores(id) on delete cascade,
  granted_by   uuid,
  granted_at   timestamptz not null default now(),
  unique (membership_id, store_id)
);
create index if not exists idx_b2b_member_store_grants_membership
  on public.b2b_member_store_grants(membership_id);

-- 2. Denormalize the order's single branch onto the quote header.
alter table public.quotes
  add column if not exists ship_to_store_id uuid references public.stores(id) on delete set null;

-- 3. Backfill legacy orders (safe: every legacy order is single-branch — staff were hard-locked).
--    Custom-address orders keep NULL (all their quote_items.ship_to_store_id are NULL).
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

**Also in this migration — update the `submit_b2b_order` RPC** (S-owned; the RPC already writes
`quote_items.ship_to_store_id`) to set the header value from the uniform lines, e.g. inside the
function after items are written:

```sql
update public.quotes
set ship_to_store_id = (
  select qi.ship_to_store_id from public.quote_items qi
  where qi.quote_id = <new_quote_id> and qi.ship_to_store_id is not null
  limit 1
)
where id = <new_quote_id>;
```

> Because the RPC stamps the header, **P needs no checkout-write change for the denormalization** —
> only the read side (§E). The P guard (§D) guarantees the lines are single-branch before the RPC
> runs, so the `limit 1` is deterministic.

### B. TypeScript types regen — [S] then sync to [P]

After the migration is applied, regenerate DB types in S and propagate. `quotes.ship_to_store_id`
and the new table appear in the generated types both repos consume.

### C. Pure resolver `resolveBranchStoreIds` — [P] + [S] mirrored

**Files — Create (mirrored, identical):**
`print-room-portal/lib/orders/branch-grants.ts` and
`print-room-staff-portal/src/lib/b2b-accounts/branch-grants.ts`.

```ts
/**
 * A staff manager's orderable/viewable branch set = explicitly-granted stores
 * UNIONED with their home (default) store. Judgment-call (a): union at READ, so
 * the grant table stays "explicitly managed" and survives independent
 * default_store_id edits. Dedups; drops nulls.
 */
export function resolveBranchStoreIds(
  grantStoreIds: string[],
  defaultStoreId: string | null,
): string[] {
  const set = new Set(grantStoreIds.filter((s): s is string => Boolean(s)))
  if (defaultStoreId) set.add(defaultStoreId)
  return [...set]
}
```

> **Critical seam — checkout vs view differ on empty grants:**
> - **Checkout** calls `resolveBranchStoreIds(grants, default)` **unconditionally** → plain staff
>   (grants `[]`) get `[default]`, identical to today's single-store lock.
> - **View** must add a branch predicate **only when grants exist**:
>   `grants.length ? resolveBranchStoreIds(grants, default) : []`. If we unioned `default` for
>   plain staff on the view side, every plain staff member would suddenly see *all* orders shipped
>   to their home branch — a behaviour change. This asymmetry is the backward-compat contract and
>   gets a pinned test (§Testing).

### D. Checkout guard + context — [P]

**Modify `lib/checkout/server.ts`** — `B2BCustomerContext` (interface at :10, built in
`requireB2BCustomer` at :77, cached `requireB2BCustomerCached` :165, `requireB2BCustomerApi` :184).
Add `branchStoreIds: string[]` and populate it where the membership is loaded (:99–:160):

```ts
// interface B2BCustomerContext { ...; defaultStoreId: string | null; branchStoreIds: string[] }
const { data: grantRows } = await admin
  .from('b2b_member_store_grants')
  .select('store_id')
  .eq('membership_id', membership.id)
const branchStoreIds = (grantRows ?? []).map((g) => g.store_id as string)
// ...include `branchStoreIds` in the returned context object (org_admins: leave [] — never used)
```

**Modify `lib/checkout/submit.ts`** — the buyer-scope guard (currently :454–465). Generalise the
scalar `expected` to the allowed set and add same-branch uniformity. `getGrantedCatalogueItemIds`
(:479+) already re-reads catalogue grants mid-flight; `context.branchStoreIds` is read fresh in
`requireB2BCustomer` at submit time, so a revoked branch cannot be used mid-session — no extra
re-read needed.

```ts
import { resolveBranchStoreIds } from '@/lib/orders/branch-grants'
// ...
if (input.context.role === 'staff') {
  const allowed = new Set(
    resolveBranchStoreIds(input.context.branchStoreIds, input.context.defaultStoreId),
  ) // plain staff => {defaultStoreId}, i.e. today's lock
  const mismatched = shipToStoreIds.filter((sid) => {
    if (sid === null && allOneTimeLines && input.custom_shipping_address) return false
    return sid === null || !allowed.has(sid)
  })
  if (mismatched.length > 0) {
    throw new BuyerScopeError(mismatched, input.context.defaultStoreId)
  }
  // One-destination-per-order: all non-null lines must share ONE branch.
  const distinctBranches = new Set(shipToStoreIds.filter((s): s is string => s !== null))
  if (distinctBranches.size > 1) throw new MixedShippingAddressError()
}
```

`BuyerScopeError` (:304) and `MixedShippingAddressError` (:315) are reused as-is; the API mapping at
`app/api/checkout/route.ts:208` is unchanged.

### E. Checkout branch picker UI — [P]

**Modify `components/checkout/CheckoutReviewClient.tsx`** (per-line ship-to state at :171). For a
manager (`context.branchStoreIds.length > 0`), render a single order-level control:
**"Ordering for branch: [dropdown]"**, options = `resolveBranchStoreIds(branchStoreIds, defaultStoreId)`
resolved to store names, **default pre-selected**. Selecting a branch sets `perLineShipTo` to that
one branch for **every** line (so the existing per-line submit payload at :171 stays uniform). Plain
staff / org_admins: control is not rendered — behaviour unchanged. Follow `docs/ui/oem-rules.md`.

### F. Viewing scope (the security boundary) — [P]

**Modify `lib/orders/past-orders-query.ts`** — `PastOrdersScope` gains `branchStoreIds: string[]`
(empty ⇒ no branch predicate). `queryPastOrders` (:82) becomes:

```ts
export interface PastOrdersScope {
  organizationId: string
  canSeeAllOrgOrders: boolean
  userEmail: string | null
  branchStoreIds: string[] // manager's granted∪default branches; [] for plain staff & org_admin
}

export async function queryPastOrders(adminClient, scope): Promise<PastOrderRow[]> {
  // fail-closed, but a manager with branches needs rows even without an email
  if (!scope.canSeeAllOrgOrders && !scope.userEmail && scope.branchStoreIds.length === 0) return []

  let query = adminClient.from('orders').select(PAST_ORDERS_SELECT)
    .eq('quotes.organization_id', scope.organizationId)

  if (!scope.canSeeAllOrgOrders) {
    if (scope.branchStoreIds.length > 0) {
      // manager: own orders (by email) OR any order shipped to a granted branch
      const parts: string[] = []
      if (scope.userEmail) parts.push(`customer_email.eq.${scope.userEmail}`)
      parts.push(`ship_to_store_id.in.(${scope.branchStoreIds.join(',')})`)
      query = query.or(parts.join(','), { referencedTable: 'quotes' })
    } else {
      query = query.eq('quotes.customer_email', scope.userEmail) // today's plain-staff path
    }
  }
  const { data, error } = await query.order('created_at', { ascending: false })
  if (error) { console.error('[PastOrders] query failed:', error); return [] }
  return (data ?? []) as unknown as PastOrderRow[]
}
```

Add `ship_to_store_id` to `PAST_ORDERS_SELECT`'s embedded `quotes(...)` if any surface needs to
display it (not required for the predicate). `PAST_ORDERS_SELECT` already uses `quotes!inner`.

**Scope call sites — both must pass `branchStoreIds`** (compute once per request via a mirrored
helper `getMemberBranchStoreIds(admin, membershipId, defaultStoreId)` in `lib/orders/branch-grants.ts`
that fetches grants and returns `grants.length ? resolveBranchStoreIds(grants, default) : []`):

- **List:** `lib/portal-data.ts:349–351` (`queryPastOrders(adminClient, { organizationId,
  canSeeAllOrgOrders: membership.role === 'org_admin', userEmail, branchStoreIds })`).
- **Export:** `app/api/past-orders/export/route.ts:43–45` (same shape).

No new group-by / no new column in the list or CSV — a manager simply gets more rows
(`ship_to_store` already in the export select at `export/route.ts:83`).

### G. Detail / collection route auth — [P] (the deep-link-404 bug class)

Every per-order / per-collection route that today authorises on "own order OR org_admin" must apply
the **same** branch predicate, using the **same** denormalised `quotes.ship_to_store_id ∈
branchStoreIds` check — do NOT reimplement the rule per route or list⇔detail will drift (that is the
recurring 404/leak class). Concrete surfaces to update and an explicit task to enumerate the rest:

- `app/api/collections/[collectionId]/route.ts` (uses the same scope pattern today).
- `app/(portal)/orders/[id]/proof/page.tsx` and `.../proof/edit/page.tsx`.
- `app/(portal)/checkout/confirmation/[orderId]/page.tsx` (order-detail surface).
- **Plan task:** grep every route/page keyed by an order/quote id and confirm each shares the
  predicate; a manager must be able to open any order that appears in their list, and must NOT open
  one that doesn't.

### H. Replace-set API — [S] (new route) + [P] (mirror route)

**[S] Create `src/app/api/b2b-accounts/[id]/members/[userId]/store-grants/route.ts`** — mirror the
catalogue-access route (`.../access/route.ts`) shape exactly: guarded by
`requireB2BAccountsStaffAccess` (`src/lib/b2b-accounts/server.ts:22` → `{ admin, context: { staffId,
userId } }`); GET returns `{ stores: { id, name, granted }[] }` for the org; PUT accepts
`{ storeIds: string[] }` and does a **diff-based replace-set**:

1. Confirm membership ∈ org (`user_organizations` `.eq(id).eq(organization_id)`), else 404 — mirror
   `access/route.ts:122-133`.
2. Validate **every** `storeId` ∈ this org's `stores` (fetch `src/app/api/stores/route.ts`'s query
   or inline `from('stores').eq('organization_id', orgId)`), else 422 — mirror `access/route.ts:164-179`.
3. Snapshot before → diff (`toInsert`/`toDelete`) → delete removed, insert added with
   `granted_by: context.staffId` → snapshot after — mirror `access/route.ts:200-292`.
4. `recordAuditEvent({ action: AUDIT_ACTIONS.B2B_MEMBER_STORE_GRANTS_CHANGE, targetType:
   'user_organizations', targetId: membershipId, metadata: { diff: { added, removed }, before,
   after } })`.

Factor the pure diff into `branch-grants.ts` (§C):
`buildStoreGrantDiff(existing: string[], desired: string[]): { toInsert: string[]; toDelete: string[] }`.

**[P] Create the customer-portal mirror route** (org_admin-only, own-org), following P's existing
team-API shape (`app/api/team/invite/route.ts`) — e.g.
`app/api/team/members/[membershipId]/store-grants/route.ts`. Same two org-scoping checks as [S]:
target membership ∈ **the admin's own org**, and every `storeId` ∈ the admin's own org's stores.
This is a privilege-granting surface; both checks are mandatory. Audit if the portal has an audit
sink; otherwise note as a gap.

### I. Admin UIs — both sides

- **[S] `src/components/b2b-accounts/MemberAccessEditor.tsx`** — add a **"Branches this member
  manages"** multi-select next to the existing catalogue control, populated from the org's `stores`,
  reading/writing via the new `store-grants` route. Empty selection = plain staff (feature off for
  that member).
- **[P] `app/(portal)/team/page.tsx` + `team/TeamClient.tsx`** — same multi-select on the team
  member screen, **org_admin-only**, limited to the org's own stores (the page already fetches
  stores for the `default_store_id` picker — reuse). Writes via the P mirror route.

### J. Audit action — [S]

**Modify `src/lib/audit/actions.ts`** (:44 has `B2B_MEMBER_ACCESS_CHANGE`): add
`B2B_MEMBER_STORE_GRANTS_CHANGE: 'b2b_member_store_grants.change'`.

---

## Out of scope (YAGNI guardrails)

- No new role / no role tier. No district-rollup tier (declined, memory feature #4).
- No multi-branch-in-one-order (order stays one-destination).
- No in-app group-by / no new orders-view column (declined).
- No team-management surface beyond the two multi-selects.
- No change to org_admin behaviour (always `canSeeAllOrgOrders`, no BuyerScopeError).
- No RLS work — `queryPastOrders` runs service-role and **is** the boundary (unchanged model).

---

## Testing strategy

**Pure units (mirrored both repos):**
- `resolveBranchStoreIds`: grants∪default dedup; empty grants → `[default]`; null default dropped;
  null default + empty grants → `[]`.
- `buildStoreGrantDiff`: add/remove/no-op/replace-all.

**Checkout guard (`submit.ts`) — P:**
- Manager can submit an order for a **granted** branch (all lines).
- Manager **cannot** submit for an **ungranted** branch → `BuyerScopeError`.
- Manager **cannot** mix two branches in one order → `MixedShippingAddressError`.
- **Backward-compat (pinned):** plain staff (grants `[]`) locked to `default` exactly as today;
  org_admin unaffected.

**Viewing (`queryPastOrders`) — P:**
- **Backward-compat (pinned):** `branchStoreIds: []` produces byte-identical query to today
  (`.eq(org).eq(customer_email)`); plain staff with no email → `[]`.
- Manager sees own orders (by email) **OR** orders shipped to a granted branch; never another org's
  (org filter always ANDed); never an ungranted branch.
- Manager with branches but no email still gets branch rows (fail-closed relaxation correct).

**Detail-route parity — P:** list-shows ⟺ detail-allows for a manager (kills the 404/leak class);
ungranted order 404s.

**Replace-set routes — S + P:** reject `storeId` from another org (422); reject membership from
another org (404); diff insert/delete correct; audit diff recorded (S).

**Migration/backfill — S:** on a seeded DB, every legacy single-branch order gets its
`quotes.ship_to_store_id` set from its lines; custom-address orders stay NULL.

---

## Rollout / deploy ordering

Additive + dark. Nothing changes until a grant row exists.

1. **Apply the S migration** (`db/pending-migrations/…` → `supabase/migrations/`, `supabase db push`)
   on Jon's go. This adds the table, the `quotes.ship_to_store_id` column + backfill + index, and
   the `submit_b2b_order` stamp. `quotes.ship_to_store_id` and `b2b_member_store_grants` **must
   stay** thereafter.
2. **Regen types (S) → sync/rebuild (P).**
3. **Deploy both portals** (order between P and S is not critical — additive/dark — but querying
   code must not ship before step 1 exists in prod).
4. **Grant branches** to a pilot manager via either admin UI; smoke ordering + viewing + a
   deep-linked order detail.

---

## Cross-cutting notes

- **Sharing is mirror, not package.** `vendor/print-room-onboarding` is onboarding-scoped
  (`src/index.ts`, `src/types.ts`, playwright) — not a runtime-helper host. `branch-grants.ts` is
  duplicated in P and S with identical tests, per the custom-name precedent.
- **`stores` deletion vs constraint:** grant FK is `ON DELETE CASCADE` (grant vanishes with the
  store) — consistent with the sibling. Note a **pre-existing** latent issue, not introduced here:
  `user_organizations.default_store_id` is `ON DELETE SET NULL`, which for a staff member could
  violate `chk_buyer_has_default_store` if their home store is deleted. Out of scope; flag only.
- **`quotes` is a hot table** — the backfill is a one-shot `UPDATE`; run it in the migration window.
  The added index keeps the manager `IN (...)` predicate off a table-scan.

## Open items / handoffs

- **HITL:** apply migration on Jon's go; grant a pilot manager; live smoke.
- **Plan task (G):** enumerate ALL order/quote-keyed routes/pages and route them through the one
  branch predicate — missing one is the 404/leak bug.
- **Confirm:** exact P team-API route naming (`app/api/team/members/[id]/store-grants` vs P
  conventions) during `writing-plans`.
- **Confirm:** whether the P customer portal has an audit sink for the grant write (S definitely
  does via `recordAuditEvent`).
