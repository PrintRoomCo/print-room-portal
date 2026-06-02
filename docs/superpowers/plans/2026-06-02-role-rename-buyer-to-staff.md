# Role Rename `buyer` → `staff` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the customer-portal member role value `buyer` → `staff` end-to-end (prod data, RLS, and TypeScript string literals across both repos) so "Staff" is the franchise's restricted shop-staff role, with zero behaviour change for existing members.

**Architecture:** `user_organizations.role` is a plain `TEXT` column (no PG enum → no `ALTER TYPE`; a one-shot `UPDATE` is the data migration). The rename touches three layers: (1) prod data + the one RLS policy that hardcodes the literal; (2) TypeScript union types + `=== 'buyer'` comparisons + zod/allow-lists in **both** repos; (3) user-facing "Buyer" labels. Internal *identifiers* (`isBuyer`, `BuyerScopeError`, the error string `'buyer_ship_to_mismatch'`, the CHECK `chk_buyer_has_default_store`) are **out of scope** — they do not contain the string literal `'buyer'` and renaming them would balloon blast radius for no behavioural gain. The done-condition is a grep gate: zero `'buyer'`/`"buyer"` **string literals** in live code (tests, historical docs, the vendored onboarding package, and the Shopify port scripts excluded).

**Tech Stack:** Next.js 16 (App Router) · TypeScript · Supabase (Postgres + RLS, shared prod, no staging) · Vitest + @testing-library/react · zod (staff MCP server).

**Repos (both on branch `feat/role-rename-staff`):**
- `print-room-portal` — `c:\Users\MSI\Documents\Projects\print-room-portal`
- `print-room-staff-portal` — `c:\Users\MSI\Documents\Projects\print-room-staff-portal`

---

## ⚠️ Production / cross-repo flags (read before starting)

- **Shared prod DB, no staging.** This plan *authors* the data `UPDATE` and the RLS migration. A **human runs them deliberately** (not at 5pm). No agent executes SQL against prod.
- **Verified 2026-06-02 (read-only, MCP):** `SELECT role, count(*) FROM user_organizations GROUP BY role` → **`org_admin: 4`, zero `buyer` rows.** The data `UPDATE` is a **safe no-op today** but is authored anyway (defensive — covers any row created between authoring and run, and other environments). **Re-run the count immediately before executing** and paste the result into the maintenance log.
- Because there are 0 `buyer` rows, the RLS-policy flip and the data `UPDATE` carry **no live-access risk** in this DB and may run in one window. (In an environment that *did* have `buyer` rows, you would widen the policy to `('org_admin','buyer','staff')`, run the data `UPDATE`, then tighten to `('org_admin','staff')`. Noted for completeness; not needed here.)
- **Deploy ordering:** the code normaliser maps any role that is not `'staff'` to `'org_admin'`. So if a `buyer` row ever existed, deploying the renamed code *before* running the data `UPDATE` would briefly read it as `org_admin` (privilege escalation). With 0 `buyer` rows this is moot, but the safe order is **run the migration in the same window as / before the merge goes live.** Flagged in Task 9 Step 3.
- **Exclusions from the rename (do NOT touch — flag, don't fix):**
  - `print-room-staff-portal/vendor/print-room-onboarding/**` — a **vendored, one-directionally-synced** package (source of truth is the staff repo per `AGENTS.md`). Its `Audience = 'staff' | 'org_admin' | 'buyer'` already has a *separate* `'staff'` audience meaning Print-Room staff; renaming `'buyer'`→`'staff'` there would silently merge two distinct audiences. Leave it; raise with Jamie/Chris if onboarding tours need re-targeting.
  - `print-room-portal/vendor/print-room-onboarding/**` — the synced copy. Same reason.
  - `print-room-staff-portal/scripts/shopify-orders-port/*.ts` — `buyerExperienceConfiguration` is a Shopify payment-terms field, unrelated to the role (and does not contain the literal `'buyer'` anyway).

---

## File Structure

**print-room-portal**
- Modify: `types/company.ts` — `role` union (`:17`), `isBuyer` doc comments.
- Modify: `lib/company.ts` — role cast (`:137`), `AccessInput.role` (`:183`), derivation (`:209`); **export** `buildAccess` for unit test.
- Modify: `lib/checkout/server.ts` — `B2BCustomerContext.role` (`:12`), normaliser (`:100`).
- Modify: `lib/checkout/submit.ts` — buyer-scope guard comparison (`:268`).
- Modify: `app/(portal)/checkout/page.tsx` — `isBuyer={context.role === 'buyer'}` (`:31`).
- Create: `lib/proofs/amendment-roles.ts` — single shared allow-list for the three proof-amendment gates (removes the duplicated `new Set([...])` and dodges importing a route module into a unit test).
- Modify: `app/(portal)/orders/[id]/proof/edit/page.tsx` — use the shared allow-list (`:54-57`).
- Modify: `app/(portal)/orders/[id]/proof/page.tsx` — use the shared allow-list (`:9`).
- Modify: `app/api/proofs/[id]/amendment-requests/route.ts` — use the shared allow-list (`:70`).
- Create: `lib/__tests__/buildAccess.role.test.ts` — behavioural derivation test.
- Create: `lib/proofs/__tests__/amendment-roles.test.ts` — allow-list gate test.
- Create: `scripts/__tests__/no-buyer-literal.test.ts` — repo grep gate.

**print-room-staff-portal**
- Create: `supabase/migrations/20260602090000_rename_role_buyer_to_staff.sql` — RLS policy flip + the documented (idempotent) data `UPDATE`.
- Modify: `src/components/b2b-accounts/EditRoleDialog.tsx` — `MemberRole` union (`:10`), radio `value`/label (`:123-127`).
- Modify: `src/components/b2b-accounts/MembersPanel.tsx` — `isMemberRole` guard + `role === 'buyer'` badge.
- Modify: `src/app/api/b2b-accounts/[id]/members/[userId]/role/route.ts` — `ALLOWED_ROLES` (`:7`), `nextRole === 'buyer'` store guard (`:69`).
- Modify: `mcp-server/src/tools/members.ts` — `z.enum(['org_admin','buyer'])` (`:53`), type (`:60`), doc strings (`:44-49`).
- Create: `src/lib/__tests__/no-buyer-literal.test.ts` — repo grep gate.

---

## Task 1: Branches

**Files:** none (git only)

- [ ] **Step 1: Create the branch in both repos**

```bash
cd c:/Users/MSI/Documents/Projects/print-room-portal && git checkout -b feat/role-rename-staff
cd c:/Users/MSI/Documents/Projects/print-room-staff-portal && git checkout -b feat/role-rename-staff
```

- [ ] **Step 2: Confirm clean trees**

Run: `git -C c:/Users/MSI/Documents/Projects/print-room-portal status && git -C c:/Users/MSI/Documents/Projects/print-room-staff-portal status`
Expected: both `On branch feat/role-rename-staff` / `nothing to commit, working tree clean`.

---

## Task 2: Portal — `buildAccess` derivation (behavioural red→green)

This is the one place role semantics are derived. We export the pure builder, write a test that pins `staff` ⇒ restricted, then flip the comparison.

**Files:**
- Modify: `lib/company.ts:195` (add `export`), `:183` (`AccessInput.role`), `:209` (derivation)
- Modify: `types/company.ts:17`
- Test: `lib/__tests__/buildAccess.role.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/buildAccess.role.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildAccess } from '../company'

const base = {
  userId: 'u1',
  email: 'a@b.co',
  firstName: 'A',
  lastName: 'B',
  companyId: 'org1',
  companyName: 'Org',
  locationIds: [] as string[],
  tier: 'bronze',
  tierLabel: null,
  tierDiscount: 0,
  pricingMode: 'catalogue' as const,
  isCompanyUser: true,
  leaversEnabled: false,
  hasTrackedInventory: false,
  defaultStoreId: null,
  tenantType: 'franchise' as const,
}

describe('buildAccess role derivation', () => {
  it("treats 'staff' as the restricted role", () => {
    const a = buildAccess({ ...base, role: 'staff' })
    expect(a.role).toBe('staff')
    expect(a.isOrgAdmin).toBe(false)
    expect(a.isBuyer).toBe(true) // internal flag name unchanged; semantics = "restricted"
    expect(a.canApproveDesigns).toBe(false)
    expect(a.canSeeAllOrgOrders).toBe(false)
  })

  it("treats 'org_admin' as the privileged role", () => {
    const a = buildAccess({ ...base, role: 'org_admin' })
    expect(a.isOrgAdmin).toBe(true)
    expect(a.isBuyer).toBe(false)
    expect(a.canApproveDesigns).toBe(true)
  })
})
```

- [ ] **Step 2: Run it — verify it fails**

Run: `cd c:/Users/MSI/Documents/Projects/print-room-portal && npx vitest run lib/__tests__/buildAccess.role.test.ts`
Expected: FAIL — `buildAccess` is not exported (`The requested module '../company' does not provide an export named 'buildAccess'`), and/or TS rejects `role: 'staff'` against the `'org_admin' | 'buyer'` union.

- [ ] **Step 3: Export the builder and flip the union + derivation**

In `lib/company.ts`:
- Line 195 — add `export`:

```ts
export function buildAccess(input: AccessInput): B2BCustomerAccess {
```

- Line 183 — `AccessInput.role`:

```ts
  role: 'org_admin' | 'staff'
```

- Line 209 — derivation (leave `isOrgAdmin` at line 208 unchanged):

```ts
  const isBuyer = role === 'staff'
```

- Line 137 — the cast in `getCompanyAccess`:

```ts
  const role = (orgMembership.role as 'org_admin' | 'staff') || 'org_admin'
```

In `types/company.ts` line 17:

```ts
  role: 'org_admin' | 'staff'
```

(Leave the `isBuyer:`/`isCreative:` field names and their doc comments as-is — internal identifiers, out of scope. You may update the human-readable `/** Buyer is locked … */` comment text at `:35` and `:38` to say "Staff" for clarity, but it is not gated.)

- [ ] **Step 4: Run it — verify it passes**

Run: `npx vitest run lib/__tests__/buildAccess.role.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/company.ts types/company.ts lib/__tests__/buildAccess.role.test.ts
git commit -m "refactor(portal): rename role value buyer->staff in access derivation"
```

---

## Task 3: Portal — checkout context normaliser + buyer-scope guard

**Files:**
- Modify: `lib/checkout/server.ts:12` (`B2BCustomerContext.role`), `:100` (normaliser)
- Modify: `lib/checkout/submit.ts:268` (guard comparison)
- Modify: `app/(portal)/checkout/page.tsx:31`

- [ ] **Step 1: Write the failing test (guard fires for `staff`)**

Create `lib/checkout/__tests__/submit.staff-scope.test.ts`. The buyer-scope guard at the top of `submitCustomerOrder` throws **before** any Supabase call when a restricted member ships off their default store, so we can drive it with a minimal admin stub:

```ts
import { describe, it, expect } from 'vitest'
import { submitCustomerOrder, BuyerScopeError } from '../submit'
import type { B2BCustomerContext } from '../server'

// The guard short-circuits before any DB call, so a never-called stub is fine.
const adminStub = {} as unknown as Parameters<typeof submitCustomerOrder>[0]

function ctx(overrides: Partial<B2BCustomerContext> = {}): B2BCustomerContext {
  return {
    userId: 'u1', membershipId: 'm1', role: 'staff', email: 'a@b.co',
    fullName: 'A', organizationId: 'org1', organizationName: 'Org',
    customerCode: 'PRT', b2bAccountId: 'b1', tierLevel: 1, paymentTerms: 'net20',
    contractNotes: null, defaultDepositPercent: null, storeIds: ['s1'],
    defaultStoreId: 's1', tenantType: 'franchise', allowsMultiStoreOrdering: false,
    moqExempt: false, ...overrides,
  }
}

describe('submitCustomerOrder staff ship-to guard', () => {
  it('throws BuyerScopeError when a staff member ships off their default store', async () => {
    await expect(
      submitCustomerOrder(adminStub, {
        context: ctx(),
        idempotency_key: 'k1',
        lines: [{ product_id: 'p1', product_name: 'Tee', qty: 10, ship_to_store_id: 'OTHER' }],
      }),
    ).rejects.toBeInstanceOf(BuyerScopeError)
  })
})
```

- [ ] **Step 2: Run it — verify it fails**

Run: `npx vitest run lib/checkout/__tests__/submit.staff-scope.test.ts`
Expected: FAIL — TS error on `role: 'staff'` (context union still `'org_admin' | 'buyer'`) **and** the runtime guard checks `=== 'buyer'`, so it does not fire for `'staff'`.

- [ ] **Step 3: Flip the union, normaliser, and guard**

`lib/checkout/server.ts` line 12:

```ts
  role: 'org_admin' | 'staff'
```

`lib/checkout/server.ts` line 100:

```ts
      role: ((membership as { role?: string }).role === 'staff' ? 'staff' : 'org_admin'),
```

`lib/checkout/submit.ts` line 268 (the guard opener — leave `BuyerScopeError` class name as-is):

```ts
  if (input.context.role === 'staff') {
```

`app/(portal)/checkout/page.tsx` line 31:

```tsx
        isBuyer={context.role === 'staff'}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `npx vitest run lib/checkout/__tests__/submit.staff-scope.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add lib/checkout/server.ts lib/checkout/submit.ts "app/(portal)/checkout/page.tsx" lib/checkout/__tests__/submit.staff-scope.test.ts
git commit -m "refactor(portal): role value buyer->staff in checkout context + scope guard"
```

---

## Task 4: Portal — proof-amendment role gates (shared allow-list)

Three surfaces hardcode `new Set(['org_admin','buyer'])` and gate proof-amendment access (a miss silently breaks it for staff — spec Acceptance). We extract one shared, importable allow-list, unit-test it (no route module import needed), then point all three gates at it.

**Files:**
- Create: `lib/proofs/amendment-roles.ts`
- Test: `lib/proofs/__tests__/amendment-roles.test.ts`
- Modify: `app/(portal)/orders/[id]/proof/edit/page.tsx:54-57`
- Modify: `app/(portal)/orders/[id]/proof/page.tsx:9`
- Modify: `app/api/proofs/[id]/amendment-requests/route.ts:70`

- [ ] **Step 1: Write the failing test**

Create `lib/proofs/__tests__/amendment-roles.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { ALLOWED_AMENDMENT_ROLES } from '../amendment-roles'

describe('proof amendment role allow-list', () => {
  it('admits staff and org_admin, not the legacy buyer literal', () => {
    expect(ALLOWED_AMENDMENT_ROLES.has('staff')).toBe(true)
    expect(ALLOWED_AMENDMENT_ROLES.has('org_admin')).toBe(true)
    expect(ALLOWED_AMENDMENT_ROLES.has('buyer')).toBe(false)
  })
})
```

- [ ] **Step 2: Create the module with the OLD value — verify it fails (red)**

Create `lib/proofs/amendment-roles.ts` with the **legacy** value so the test fails first:

```ts
/**
 * Roles allowed to read/insert proof amendments. Single source for the three
 * gates: proof/page.tsx, proof/edit/page.tsx, api/proofs/[id]/amendment-requests.
 */
export const ALLOWED_AMENDMENT_ROLES = new Set<string>(['org_admin', 'buyer'])
```

Run: `npx vitest run lib/proofs/__tests__/amendment-roles.test.ts`
Expected: FAIL — `has('staff')` is `false`, `has('buyer')` is `true`.

- [ ] **Step 3: Flip the value + repoint all three gates**

`lib/proofs/amendment-roles.ts`:

```ts
export const ALLOWED_AMENDMENT_ROLES = new Set<string>(['org_admin', 'staff'])
```

`app/(portal)/orders/[id]/proof/edit/page.tsx` — replace the inline `const ALLOWED_ROLES = new Set(['org_admin','buyer'])` (`:54-57`) with the import + use it where it's referenced:

```ts
import { ALLOWED_AMENDMENT_ROLES } from '@/lib/proofs/amendment-roles'
// …then use ALLOWED_AMENDMENT_ROLES.has(role) where ALLOWED_ROLES.has(...) was called.
```

`app/(portal)/orders/[id]/proof/page.tsx` line 9 — replace the inline `ALLOWED_EDIT_ROLES` set with the same import + use `ALLOWED_AMENDMENT_ROLES.has(...)` at its call site.

`app/api/proofs/[id]/amendment-requests/route.ts` line 70 — replace the inline `ALLOWED_ROLES` set with the import + use `ALLOWED_AMENDMENT_ROLES.has(...)` at its call site.

- [ ] **Step 4: Run it — verify it passes**

Run: `npx vitest run lib/proofs/__tests__/amendment-roles.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add lib/proofs/amendment-roles.ts lib/proofs/__tests__/amendment-roles.test.ts "app/(portal)/orders/[id]/proof/edit/page.tsx" "app/(portal)/orders/[id]/proof/page.tsx" "app/api/proofs/[id]/amendment-requests/route.ts"
git commit -m "refactor(portal): shared proof-amendment role allow-list, buyer->staff"
```

---

## Task 5: Portal — sweep any remaining `'buyer'` literals + typecheck

The previous tasks hit the known behavioural hotspots. Now catch anything left (e.g. a comparison inside `CheckoutClient.tsx`, a comment that doubles as a literal, a test fixture you must keep). This is the grep-driven step the spec mandates — **do not hand-enumerate.**

**Files:** whatever the grep surfaces (non-test, non-vendor).

- [ ] **Step 1: Run the scoped grep (portal)**

```bash
cd c:/Users/MSI/Documents/Projects/print-room-portal
git grep -n -E "'buyer'|\"buyer\"" -- '*.ts' '*.tsx' \
  ':(exclude)**/__tests__/**' ':(exclude)**/*.test.ts' ':(exclude)**/*.test.tsx' \
  ':(exclude)vendor/**' ':(exclude)docs/**'
```

(Run via the Bash tool, which uses bash — the `:(exclude)` pathspecs are quoted for a POSIX shell.)

Expected after Tasks 2–4: a short list. For each hit, the literal is one of: a role comparison (`=== 'buyer'` → `=== 'staff'`), a union member (`'org_admin' | 'buyer'` → `… | 'staff'`), or a set/array member. **Replace the role-value literal `'buyer'` with `'staff'`.** Do NOT touch `'buyer_ship_to_mismatch'`, `'buyer_requires_default_store'`, or any longer literal that merely starts with `buyer` — those are distinct strings and are out of scope.

- [ ] **Step 2: Apply replacements, then re-run the grep**

Re-run the Step 1 command. Expected: **no output** (exit code 1 from `git grep` = no matches). Test files and vendor are intentionally excluded here and handled by the gate test (Task 8).

- [ ] **Step 3: Typecheck the whole portal**

Run: `npx tsc --noEmit`
Expected: no errors. (A residual `'buyer'` in a union somewhere would surface here as a type mismatch against the now-`'staff'` unions.)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(portal): sweep remaining buyer role-value literals -> staff"
```

---

## Task 6: Staff — RLS policy + data migration (authored, not run)

**Files:**
- Create: `supabase/migrations/20260602090000_rename_role_buyer_to_staff.sql`

- [ ] **Step 1: Write the migration file**

Create `print-room-staff-portal/supabase/migrations/20260602090000_rename_role_buyer_to_staff.sql`:

```sql
-- Rename user_organizations.role value 'buyer' -> 'staff'.
--
-- ⚠️ SHARED PRODUCTION DB, NO STAGING. A human runs this deliberately in a
--    maintenance window (NOT at 5pm). Verified read-only on 2026-06-02:
--    user_organizations has 0 rows with role='buyer' (only org_admin: 4), so
--    the UPDATE is a safe no-op today and the policy flip carries no live
--    proof-amendment access risk. Re-run the SELECT below immediately before
--    applying and record the count in the maintenance log.
--
--    SELECT role, count(*) FROM public.user_organizations GROUP BY role;

BEGIN;

-- 1. Data: flip every legacy buyer membership to staff. Idempotent.
UPDATE public.user_organizations SET role = 'staff' WHERE role = 'buyer';

-- 2. RLS: the proof-amendment insert policy hardcodes the role literal
--    (was 20260513000100_proof_amendment_requests.sql:88). Re-point it at
--    'staff' so renamed members keep insert access.
DROP POLICY IF EXISTS proof_amendment_requests_org_insert
  ON public.proof_amendment_requests;
CREATE POLICY proof_amendment_requests_org_insert
  ON public.proof_amendment_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    requested_by_user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.design_proofs dp
      JOIN public.user_organizations uo
        ON uo.organization_id = dp.organization_id
      WHERE dp.id = proof_amendment_requests.proof_id
        AND uo.user_id = auth.uid()
        AND uo.role IN ('org_admin', 'staff')
    )
  );

COMMIT;
```

- [ ] **Step 2: Write a guard test asserting the migration content**

Create `print-room-staff-portal/src/lib/__tests__/role-rename-migration.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(
  join(here, '../../../supabase/migrations/20260602090000_rename_role_buyer_to_staff.sql'),
  'utf8',
)

describe('role rename migration', () => {
  it("flips data buyer -> staff", () => {
    expect(sql).toContain("SET role = 'staff' WHERE role = 'buyer'")
  })
  it("re-points the proof-amendment RLS policy to staff", () => {
    expect(sql).toContain("uo.role IN ('org_admin', 'staff')")
  })
})
```

> Uses `import.meta.url` (not `__dirname`) so it works under Vitest's ESM. If this repo's Vitest runs in CJS and `import.meta` is unavailable, fall back to `join(process.cwd(), 'supabase/migrations/20260602090000_rename_role_buyer_to_staff.sql')`.

- [ ] **Step 3: Run it — verify it passes**

Run: `cd c:/Users/MSI/Documents/Projects/print-room-staff-portal && npx vitest run src/lib/__tests__/role-rename-migration.test.ts`
Expected: PASS (2 tests). (The migration file is committed but **not applied** — `mcp__supabase__apply_migration` is run by a human at execution time.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260602090000_rename_role_buyer_to_staff.sql src/lib/__tests__/role-rename-migration.test.ts
git commit -m "feat(staff): author buyer->staff data + RLS migration (manual-run)"
```

---

## Task 7: Staff — TS role literals (4 files)

**Files:**
- Modify: `src/app/api/b2b-accounts/[id]/members/[userId]/role/route.ts:7,69`
- Modify: `mcp-server/src/tools/members.ts:44-49,53,60`
- Modify: `src/components/b2b-accounts/EditRoleDialog.tsx:10,123,127`
- Modify: `src/components/b2b-accounts/MembersPanel.tsx` (`isMemberRole` + badge)

- [ ] **Step 1: Write the failing test (role route allow-list)**

The route validates with `ALLOWED_ROLES = ['org_admin', 'buyer'] as const` and exports nothing useful today. Export `isMemberRole` and test it.

In `role/route.ts` line 15, add `export` (do NOT yet change the allow-list value — that stays `['org_admin','buyer']` until Step 3, so the test goes red first):

```ts
export function isMemberRole(value: string): value is MemberRole {
```

Create `src/app/api/b2b-accounts/[id]/members/[userId]/__tests__/role-validation.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { isMemberRole } from '../role/route'

describe('members role validation', () => {
  it('accepts staff and org_admin, rejects the legacy buyer literal', () => {
    expect(isMemberRole('staff')).toBe(true)
    expect(isMemberRole('org_admin')).toBe(true)
    expect(isMemberRole('buyer')).toBe(false)
  })
})
```

> If Vitest errors importing the route module (server-only side-effects), extract `ALLOWED_ROLES`/`isMemberRole` to a sibling `role-validation.ts` and import from there — mirror the portal Task 4 shared-module pattern.

- [ ] **Step 2: Run it — verify it fails**

Run: `cd c:/Users/MSI/Documents/Projects/print-room-staff-portal && npx vitest run "src/app/api/b2b-accounts/[id]/members/[userId]/__tests__/role-validation.test.ts"`
Expected: FAIL — `isMemberRole('staff')` is `false` (allow-list still `['org_admin','buyer']`), and `isMemberRole('buyer')` is `true`.

- [ ] **Step 3: Flip the allow-list + store guard**

`role/route.ts` line 7:

```ts
const ALLOWED_ROLES = ['org_admin', 'staff'] as const
```

`role/route.ts` line 69 (the default-store requirement — keep the error string `'buyer_requires_default_store'` and the CHECK name `chk_buyer_has_default_store` unchanged; only the role comparison flips):

```ts
    if (nextRole === 'staff' && !nextDefaultStoreId) {
```

- [ ] **Step 4: Run it — verify it passes**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Flip the MCP members tool**

`mcp-server/src/tools/members.ts`:
- Line 53: `role: z.enum(['org_admin', 'staff']),`
- Line 60: `role: 'org_admin' | 'staff'`
- Lines 44–49 doc strings: replace `'org_admin'|'buyer'` / "org_admin | buyer" / "Buyer requires default_store_id" wording with `staff` equivalents (these are role-value literals inside strings and DO match the gate grep):

```ts
// Body: { role: 'org_admin'|'staff', defaultStoreId?: string|null }
// Staff requires defaultStoreId (DB CHECK chk_buyer_has_default_store).
```
```ts
  'Change a member\'s role. Roles: org_admin | staff. Staff requires default_store_id. Dry-run by default.',
```

- [ ] **Step 6: Flip EditRoleDialog + MembersPanel (UI labels)**

`src/components/b2b-accounts/EditRoleDialog.tsx`:
- Line 10: `export type MemberRole = 'org_admin' | 'staff'`
- Lines 123–127 — the second `RoleOption`:

```tsx
<RoleOption
  value="staff"
  checked={role === 'staff'}
  onSelect={() => setRole('staff')}
  title="Staff"
  description="Sees only their own orders. Locked to a single ship-to store."
/>
```

`src/components/b2b-accounts/MembersPanel.tsx` (read the file first — exact lines not pinned during planning):
- In `isMemberRole`, change the membership of the role set/array from `'buyer'` to `'staff'`.
- The badge branch `role === 'buyer'` → `role === 'staff'`, and its visible label text `Buyer` → `Staff`.

- [ ] **Step 7: Typecheck the whole staff repo**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/b2b-accounts mcp-server/src/tools/members.ts src/components/b2b-accounts/EditRoleDialog.tsx src/components/b2b-accounts/MembersPanel.tsx "src/app/api/b2b-accounts/[id]/members/[userId]/__tests__/role-validation.test.ts"
git commit -m "refactor(staff): rename role value buyer->staff across TS + UI labels"
```

---

## Task 8: The zero-`'buyer'`-literal gate (both repos)

A guard test that fails red while any role-value literal survives in live code and goes green only when the rename is complete. This is the spec's done-condition, automated. It walks `git ls-files` and tests each file with a JS regex — **no shell quoting** (robust on Windows/cmd, unlike an `execSync` `git grep` with `:(exclude)` pathspecs).

**Files:**
- Create: `print-room-portal/scripts/__tests__/no-buyer-literal.test.ts`
- Create: `print-room-staff-portal/src/lib/__tests__/no-buyer-literal.test.ts`

- [ ] **Step 1: Write the gate test (portal)**

Create `print-room-portal/scripts/__tests__/no-buyer-literal.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// Excluded path fragments — not "live code paths" per the spec gate.
const EXCLUDE = [
  '__tests__/', '.test.', '.spec.', 'vendor/', 'docs/',
  'scripts/shopify-orders-port/', // staff-only; harmless here
]

// Role-VALUE literal only: 'buyer' or "buyer". Longer literals like
// 'buyer_ship_to_mismatch' do NOT match (the closing quote differs).
const ROLE_LITERAL = /'buyer'|"buyer"/

function trackedSourceFiles(): string[] {
  const out = execSync("git ls-files -- '*.ts' '*.tsx'", { cwd: process.cwd(), encoding: 'utf8' })
  return out
    .split('\n')
    .filter(Boolean)
    .filter((f) => !EXCLUDE.some((frag) => f.includes(frag)))
}

describe('no live buyer role-value literal', () => {
  it('has zero matches in live .ts/.tsx', () => {
    const offenders = trackedSourceFiles().filter((f) =>
      ROLE_LITERAL.test(readFileSync(f, 'utf8')),
    )
    expect(offenders, `\n${offenders.join('\n')}`).toEqual([])
  })
})
```

- [ ] **Step 2: Run it (portal) — verify it passes**

Run: `cd c:/Users/MSI/Documents/Projects/print-room-portal && npx vitest run scripts/__tests__/no-buyer-literal.test.ts`
Expected: PASS. If it lists offenders, replace each role-value literal and re-run.

- [ ] **Step 3: Write + run the gate test (staff)**

Create `print-room-staff-portal/src/lib/__tests__/no-buyer-literal.test.ts` with the **same body** (the `EXCLUDE` list already contains `vendor/` and `scripts/shopify-orders-port/`, which are exactly the staff exclusions).

Run: `cd c:/Users/MSI/Documents/Projects/print-room-staff-portal && npx vitest run src/lib/__tests__/no-buyer-literal.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit (both repos)**

```bash
git -C c:/Users/MSI/Documents/Projects/print-room-portal add scripts/__tests__/no-buyer-literal.test.ts
git -C c:/Users/MSI/Documents/Projects/print-room-portal commit -m "test(portal): gate against live buyer role-value literals"
git -C c:/Users/MSI/Documents/Projects/print-room-staff-portal add src/lib/__tests__/no-buyer-literal.test.ts
git -C c:/Users/MSI/Documents/Projects/print-room-staff-portal commit -m "test(staff): gate against live buyer role-value literals"
```

---

## Task 9: Full verification (both repos)

**Files:** none

- [ ] **Step 1: Portal — full suite + build**

```bash
cd c:/Users/MSI/Documents/Projects/print-room-portal && npx vitest run && npm run build
```
Expected: all tests green (incl. the gate + buildAccess + scope tests), build succeeds. Fix any test that still references the `'buyer'` role value in a fixture by updating the fixture to `'staff'`.

- [ ] **Step 2: Staff — full suite + build**

```bash
cd c:/Users/MSI/Documents/Projects/print-room-staff-portal && npx vitest run && npm run build
```
Expected: all tests green, build succeeds.

- [ ] **Step 3: Record the manual-run checklist for Jamie/Chris**

Leave this in the branch description / PR body:
> **Before merge → before customers test:** in a maintenance window, (1) re-run `SELECT role, count(*) FROM user_organizations GROUP BY role;` and log it; (2) apply `supabase/migrations/20260602090000_rename_role_buyer_to_staff.sql` via the Supabase MCP `apply_migration` (or dashboard). Run the migration **in the same window as / before** the renamed code goes live, so no `buyer` row is ever read by the new normaliser as `org_admin`. Both are no-ops on current data (0 buyer rows) but must run so the policy literal and any future row are correct.

- [ ] **Step 4: Commit any fixture fixes**

```bash
git add -A && git commit -m "test: update role fixtures buyer->staff"
```

---

## Self-Review

**1. Spec coverage (Item 1):**
- Step 1 *Prod data migration* (`UPDATE … WHERE role='buyer'`) → Task 6, authored + manual-run note (Task 9 Step 3). ✅
- Step 2 *RLS sweep* (proof_amendment `:88` + grep all `*.sql`) → Task 6 policy flip; the staff `*.sql` grep surfaced only that one policy + comments (verified 2026-06-02), so the single policy edit covers it. ✅ (The data migration comment intentionally keeps `chk_buyer_has_default_store` — a CHECK *name*, not a role literal.)
- Step 3 *TS types + comparisons (both repos)* → Tasks 2,3,4,5 (portal) + 7 (staff), every cited hotspot (`types/company.ts:17`, `lib/company.ts:137,183,208-209`, checkout/proof reads, `EditRoleDialog`, `mcp-server/.../members.ts`, members role API route). ✅
- Step 4 *UI labels* → Task 7 Step 6 (EditRoleDialog title "Staff", MembersPanel badge "Staff"). ✅
- Step 5 *Gate: zero `'buyer'`/`"buyer"`* → Task 8 (automated, both repos). ✅
- Acceptance *existing members function identically; proof amendments still work* → Task 2 (derivation parity), Task 4 (proof gates), Task 9 (suite+build). ✅

**2. Placeholder scan:** No "TBD"/"similar to"/"add validation". Every step shows the exact literal change with surrounding code. The one spot that says "whatever the grep surfaces" (Task 5) is deliberate — the spec explicitly mandates a grep sweep rather than hand-enumeration — and it is bounded by Step 3's `tsc` + Task 8's gate, so completeness is machine-verified. Task 7 Step 6's MembersPanel edit is directional (exact lines were not pinned during planning) — the executor reads the file first; bounded by `tsc` (Step 7) + the gate (Task 8).

**3. Type consistency:** `role` union is `'org_admin' | 'staff'` in all three declaration sites (`types/company.ts`, `lib/company.ts` AccessInput, `lib/checkout/server.ts`). The internal flag `isBuyer` keeps its name everywhere (Task 2 fixes only its derivation); no call site renamed it. `BuyerScopeError` class name unchanged across `submit.ts` + its test (Task 3) + the API catch in `app/api/checkout/route.ts` (untouched — it catches the class, not a literal). `MemberRole` union (`'org_admin' | 'staff'`) is consistent between `EditRoleDialog.tsx` and the route's `ALLOWED_ROLES`/`isMemberRole`. The shared `ALLOWED_AMENDMENT_ROLES` (Task 4) is the single set behind all three proof gates.

**Anchor drift adapted:** (a) The data `UPDATE` affects **0 rows today** (verified) — authored regardless, with a re-count gate + deploy-ordering note. (b) `lib/company.ts` derivation spans `:208-209` *and* `:217` (the `isBuyer` field) — Step 3 touches `:209` only; `:217` assigns the already-correct `isBuyer`. (c) Excluded `vendor/print-room-onboarding/**` (synced package, separate `'staff'` audience) and `scripts/shopify-orders-port/**` from the gate — flagged, not renamed. (d) Proof-amendment allow-list extracted to a shared module (Task 4) so the gate test imports a plain module, not a Next route with server-only side-effects, and the three gates stop duplicating the set.
