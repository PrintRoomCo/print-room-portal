# Spec B — Dispatch & Self-Service Integrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Source spec:** [`2026-07-15-spec-b-dispatch-integrations.md`](../../2026-07-15-spec-b-dispatch-integrations.md) · **Evidence:** [`2026-07-15-xero-stock-handling-integrations.md`](../../2026-07-15-xero-stock-handling-integrations.md) · **Build-now half:** [`2026-07-15-spec-a-xero-stock-portal-ux-plan.md`](./2026-07-15-spec-a-xero-stock-portal-ux-plan.md)

**Goal:** Ship the deferred integrations and gated work: the ⚠️ Thursday-critical staff-default invite FIRST, then prepaid + picking fees, Starshipit dispatch, mixed-cart split (F1), and org-admin self-serve invites (F2).

**Architecture:** Builds on Spec A foundations. Lead with the narrow Thursday-critical invite slice (staff portal), then the interlocked prepaid + picking-fee block, then Starshipit (behind an account-ownership decision gate), then F1 split orders, then F2 self-serve invites.

**Tech Stack:** Next.js (app router), TypeScript, Supabase, Vitest, Starshipit API, Xero, Monday.com; staff portal code under `src/`.

## Global Constraints

- Repos: **P** = print-room-portal, **S** = print-room-staff-portal, **studio** = legacy print-room-studio (reference only).
- Spec B DEPENDS ON Spec A foundations already shipping: `orders.order_type`, the push-with-note Monday flow, the Past-orders courier-tracking surface, and the order-placed notification abstraction (Slack + email). Plan tasks may consume those by name.
- **Thursday-critical slice** (staff-default invite) ships FIRST even though it lives in Spec B — Doc onboarding forces it. It is the NARROW slice (staff-initiated invite gains role choice + `default_store_id`); the full customer-facing self-serve UI (F2) stays deferred.
- Do NOT reuse the column name `prepaid` for the new billing tag — it collides with `variant_inventory.prepaid` (valuation-only). Use `invoice_on_dispatch` / `billing_mode`.
- Starshipit account ownership is a **BLOCKING external decision** (fresh portal-owned vs consolidate the live "Print Room Dispatch" account which is 100% unmatched). It is a Decision gate, not a fabricated choice.
- Picking-fee OPEN decisions (region behaviour beyond NZ; whether the fee applies to all orders / stock-on-hand only / prepaid only) remain Decision gates.
- Test emails → `jamie@theprint-room.co.nz`. Staff repo code under `src/`.
- DRY, YAGNI, TDD, frequent commits. Tests: P `cd print-room-portal && npx vitest run <path>`; S `cd print-room-staff-portal && npx vitest run <path>`.

Every task's requirements implicitly include this section.

---

## Tasks (in Spec B sequencing order)

<!-- ===== Spec B step 1 · Thursday-critical staff-default invite · cluster: thursday-critical-staff-default-invite ===== -->

## Cluster: THURSDAY-CRITICAL — staff-default invite (role choice + default_store_id)

Grounding summary (verified against the real repo, all paths in `S = /Users/jamierogangeorge/Documents/print-room-staff-portal`):
- `src/app/api/b2b-accounts/[id]/invite/route.ts:9` hardcodes `ALLOWED_ROLES = ['org_admin'] as const` and rejects any other role at lines 48-53. The membership insert (lines 144-150) never sets `default_store_id`.
- The DB already permits `role='staff'` **iff** `default_store_id IS NOT NULL` (`CHECK chk_buyer_has_default_store`, migration `20260612150000_...`, lines 31-35). `ordering_permission` defaults to `'stock_only'` (migration `20260618150000_...`), so a staff invite only needs to capture **role + default_store_id**.
- The role PATCH route (`src/app/api/b2b-accounts/[id]/members/[userId]/role/route.ts`) is the reference implementation of the staff guard (lines 131-138) and the store-belongs-to-org check (lines 140-156) — this slice mirrors both.
- `MembersPanel` already receives `stores: { id, name }[]` and `tenantType` from the org page (`src/app/(portal)/b2b-accounts/[orgId]/page.tsx:454-460`); the invite dialog just doesn't use them yet. Its `submitInvite` hardcodes `role: 'org_admin'` (line 120).

---

### Task: Widen the staff-initiated invite API to accept `staff` role + `default_store_id` (with guard)

**Files:**
- Modify `src/app/api/b2b-accounts/[id]/invite/route.ts` — lines 6-16 (comment + `ALLOWED_ROLES` + `InviteBody`), lines 37-53 (field parsing + validation), insert a store-ownership check after line 63, lines 144-150 (membership insert), line 186 (audit metadata).
- Modify `src/app/api/b2b-accounts/[id]/invite/route.test.ts` — `makeAdmin` opts (~lines 30-39) + `from()` (~lines 80-112) to add a `stores` branch; append a new `describe` block after line 226.

**Interfaces:**
- Consumes (existing repo primitives, no earlier task): `requireB2BAccountsStaffAccess(req?: Request): Promise<{ admin, context: { userId: string } } | { error: NextResponse }>`; `recordAuditEvent(...)`; `AUDIT_ACTIONS.MEMBER_INVITE`; DB `CHECK chk_buyer_has_default_store` (role='staff' ⇒ default_store_id not null).
- Produces: the widened `POST /api/b2b-accounts/[id]/invite` contract (see interfacesProduced) — request body gains `role?: 'org_admin' | 'staff'` and `default_store_id?: string | null`; staff without a valid org-owned store is rejected with `400 { error, code: 'buyer_requires_default_store' }`.

- [ ] **Step 1: Extend the test double and write the failing behaviour tests (RED).**
  In `src/app/api/b2b-accounts/[id]/invite/route.test.ts`, add two options to `makeAdmin`'s `opts` object (currently lines 30-39):
  ```ts
      profileUserId?: string | null
      listUsersResult?: { data: { users: Array<{ id: string; email: string }> }; error: null }
      // NEW — for staff-invite store validation:
      storeExists?: boolean
      storeOrgId?: string
    } = {},
  ```
  Then add a `stores` branch to the fake `from()` — insert it immediately after the `profiles` branch (after line 92, before the `// user_organizations` fallback):
  ```ts
      if (table === 'stores') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data:
                    opts.storeExists === false
                      ? null
                      : { id: 'store-1', organization_id: opts.storeOrgId ?? 'org-1' },
                  error: null,
                }),
            }),
          }),
        }
      }
  ```
  Append this new `describe` block at the end of the file (after line 226):
  ```ts
  describe('POST /api/b2b-accounts/[id]/invite — staff role + default_store_id', () => {
    it('staff WITH a store: 201, membership carries role=staff + default_store_id', async () => {
      const f = makeAdmin()
      mocks.requireB2BAccountsStaffAccess.mockResolvedValue({
        admin: f.admin,
        context: { userId: 'staff-1' },
      })

      const res = await POST(
        req({ ...validBody, role: 'staff', default_store_id: 'store-1' }),
        ctx('org-1'),
      )

      expect(res.status).toBe(201)
      expect(f.inserts[0]).toMatchObject({
        user_id: 'new-user-id',
        organization_id: 'org-1',
        role: 'staff',
        default_store_id: 'store-1',
      })
      expect(f.signInWithOtp).toHaveBeenCalledTimes(1)
    })

    it('staff WITHOUT a store: typed 400, no user created, no email, no membership', async () => {
      const f = makeAdmin()
      mocks.requireB2BAccountsStaffAccess.mockResolvedValue({
        admin: f.admin,
        context: { userId: 'staff-1' },
      })

      const res = await POST(req({ ...validBody, role: 'staff' }), ctx('org-1'))

      expect(res.status).toBe(400)
      const json = (await res.json()) as { error: string; code?: string }
      expect(json.code).toBe('buyer_requires_default_store')
      expect(f.createUser).not.toHaveBeenCalled()
      expect(f.signInWithOtp).not.toHaveBeenCalled()
      expect(f.inserts).toHaveLength(0)
    })

    it('staff with a store from ANOTHER org: 400, no membership written, no email', async () => {
      const f = makeAdmin({ storeOrgId: 'org-999' })
      mocks.requireB2BAccountsStaffAccess.mockResolvedValue({
        admin: f.admin,
        context: { userId: 'staff-1' },
      })

      const res = await POST(
        req({ ...validBody, role: 'staff', default_store_id: 'store-1' }),
        ctx('org-1'),
      )

      expect(res.status).toBe(400)
      const json = (await res.json()) as { error: string }
      expect(json.error).toMatch(/does not belong/i)
      expect(f.inserts).toHaveLength(0)
      expect(f.signInWithOtp).not.toHaveBeenCalled()
    })

    it('org_admin invite: membership carries default_store_id=null (no store required)', async () => {
      const f = makeAdmin()
      mocks.requireB2BAccountsStaffAccess.mockResolvedValue({
        admin: f.admin,
        context: { userId: 'staff-1' },
      })

      const res = await POST(req({ ...validBody, role: 'org_admin' }), ctx('org-1'))

      expect(res.status).toBe(201)
      expect(f.inserts[0]).toMatchObject({ role: 'org_admin', default_store_id: null })
    })
  })
  ```

- [ ] **Step 2: Run the new tests — confirm RED.**
  ```bash
  cd /Users/jamierogangeorge/Documents/print-room-staff-portal && npx vitest run invite/route.test.ts
  ```
  Expected FAIL. The `staff WITH a store` case fails first with `AssertionError: expected 400 to be 201` (current route rejects every non-`org_admin` role at lines 48-53); the `staff WITHOUT a store` case fails on `expected undefined to be 'buyer_requires_default_store'`; the wrong-org case fails on the `/does not belong/` match; the `org_admin` case fails because the current insert omits `default_store_id`.

- [ ] **Step 3: Widen `ALLOWED_ROLES` and the `InviteBody` type (minimal impl).**
  In `src/app/api/b2b-accounts/[id]/invite/route.ts`, replace lines 6-16:
  ```ts
  // Invites default to org_admin. The staff role requires default_store_id
  // (CHECK chk_buyer_has_default_store) which the invite flow doesn't capture;
  // staff are promoted to the staff role in the role editor afterwards.
  const ALLOWED_ROLES = ['org_admin'] as const

  interface InviteBody {
    email?: string
    first_name?: string
    last_name?: string
    role?: string
  }
  ```
  with:
  ```ts
  // Invites accept org_admin OR staff. Staff requires a default_store_id (CHECK
  // chk_buyer_has_default_store), which this flow now captures — so Doc's people
  // onboard directly as staff (stock-on-hand only) instead of being invited as
  // admins and demoted afterwards. ordering_permission is left to its DB default
  // of 'stock_only', which IS the staff (stock-on-hand) behaviour.
  const ALLOWED_ROLES = ['org_admin', 'staff'] as const
  type InviteRole = (typeof ALLOWED_ROLES)[number]

  interface InviteBody {
    email?: string
    first_name?: string
    last_name?: string
    role?: string
    default_store_id?: string | null
  }
  ```

- [ ] **Step 4: Capture `default_store_id`, validate role, and guard staff-without-store.**
  In the same file, replace the parse/validation block (lines 37-53):
  ```ts
    const email = body.email?.trim().toLowerCase() ?? ''
    const firstName = body.first_name?.trim() ?? ''
    const lastName = body.last_name?.trim() ?? ''
    const role = body.role ?? 'org_admin'

    if (!validEmail(email)) {
      return NextResponse.json({ error: 'A valid email is required' }, { status: 400 })
    }
    if (!firstName) {
      return NextResponse.json({ error: 'First name is required' }, { status: 400 })
    }
    if (!ALLOWED_ROLES.includes(role as 'org_admin')) {
      return NextResponse.json(
        { error: 'Invites currently only support org_admin role; promote to staff afterwards.' },
        { status: 400 },
      )
    }
  ```
  with:
  ```ts
    const email = body.email?.trim().toLowerCase() ?? ''
    const firstName = body.first_name?.trim() ?? ''
    const lastName = body.last_name?.trim() ?? ''
    const role = body.role ?? 'org_admin'
    const defaultStoreId = body.default_store_id ?? null

    if (!validEmail(email)) {
      return NextResponse.json({ error: 'A valid email is required' }, { status: 400 })
    }
    if (!firstName) {
      return NextResponse.json({ error: 'First name is required' }, { status: 400 })
    }
    if (!ALLOWED_ROLES.includes(role as InviteRole)) {
      return NextResponse.json(
        { error: `role must be one of: ${ALLOWED_ROLES.join(', ')}` },
        { status: 400 },
      )
    }
    // Guard: a staff member is meaningless without a ship-to store, and the DB
    // CHECK (chk_buyer_has_default_store) would reject the insert anyway. Surface
    // a clean, typed 400 up front — before creating any auth user or sending mail.
    if (role === 'staff' && !defaultStoreId) {
      return NextResponse.json(
        { error: 'Staff requires a default ship-to store', code: 'buyer_requires_default_store' },
        { status: 400 },
      )
    }
  ```

- [ ] **Step 5: Validate the store belongs to this org (mirror the role PATCH route).**
  In the same file, the org-existence check ends at line 63:
  ```ts
    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }
  ```
  Insert immediately after it:
  ```ts

    // When a store was supplied it must belong to THIS org (mirrors the role
    // PATCH route's store-ownership check). Runs before any user is provisioned.
    if (defaultStoreId) {
      const { data: store, error: storeErr } = await auth.admin
        .from('stores')
        .select('id, organization_id')
        .eq('id', defaultStoreId)
        .maybeSingle()
      if (storeErr) {
        return NextResponse.json({ error: storeErr.message }, { status: 500 })
      }
      if (!store || store.organization_id !== id) {
        return NextResponse.json(
          { error: 'store does not belong to this organization' },
          { status: 400 },
        )
      }
    }
  ```

- [ ] **Step 6: Persist `default_store_id` on the membership + audit it.**
  Replace the insert (lines 144-150):
  ```ts
    const { error: membershipError } = await auth.admin
      .from('user_organizations')
      .insert({
        user_id: userId,
        organization_id: id,
        role,
      })
  ```
  with:
  ```ts
    const { error: membershipError } = await auth.admin
      .from('user_organizations')
      .insert({
        user_id: userId,
        organization_id: id,
        role,
        default_store_id: defaultStoreId,
      })
  ```
  Then update the audit metadata (line 186) from:
  ```ts
      metadata: { email, first_name: firstName, last_name: lastName, role },
  ```
  to:
  ```ts
      metadata: { email, first_name: firstName, last_name: lastName, role, default_store_id: defaultStoreId },
  ```

- [ ] **Step 7: Run the tests — confirm GREEN.**
  ```bash
  cd /Users/jamierogangeorge/Documents/print-room-staff-portal && npx vitest run invite/route.test.ts
  ```
  Expected PASS (all pre-existing org_admin tests + the four new staff/store tests). If the bracketed path is preferred over the filter form, quote it: `npx vitest run 'src/app/api/b2b-accounts/[id]/invite/route.test.ts'`.

- [ ] **Step 8: Commit.**
  ```bash
  git commit -am "feat: staff-initiated invite accepts staff role + default_store_id"
  ```

---

### Task: MembersPanel invite dialog — role dropdown + store dropdown (first contact defaults to org_admin)

Depends on **the widened invite API** (previous task) — the dialog now POSTs `role` and `default_store_id`.

**Files:**
- Create `src/components/b2b-accounts/InviteMemberFields.tsx` — exported pure helper `defaultInviteRole` + `InviteRoleFields` control.
- Create `src/components/b2b-accounts/__tests__/InviteMemberFields.test.tsx` — unit + SSR-smoke tests.
- Modify `src/components/b2b-accounts/MembersPanel.tsx` — import (after line 16), invite state (after line 73), a reset-on-open handler + wire the `+ Invite member` button (line 154), `submitInvite` body (lines 116-121) and success reset (lines 128-130), the dialog body (after line 287), and the submit-button `disabled` guard (line 314).

**Interfaces:**
- Consumes: the widened invite API (`POST /api/b2b-accounts/[id]/invite` body `{ email, first_name, last_name?, role, default_store_id }`); `type MemberRole = 'org_admin' | 'staff'` (exported from `./EditRoleDialog:10`); `Dropdown` (`@/components/ui/dropdown` — trigger renders `aria-haspopup="listbox"` and the selected/placeholder label inline under SSR; its listbox portals and is invisible to `renderToStaticMarkup`).
- Produces: `defaultInviteRole(memberCount: number): MemberRole`; `InviteRoleFields(props)` (see interfacesProduced).

- [ ] **Step 1: Write the failing test (RED) for the new module.**
  Create `src/components/b2b-accounts/__tests__/InviteMemberFields.test.tsx`:
  ```tsx
  import { describe, it, expect } from 'vitest'
  import { renderToStaticMarkup } from 'react-dom/server'
  import { defaultInviteRole, InviteRoleFields } from '../InviteMemberFields'

  // node env, no jsdom/RTL — assert on the pure helper + the static markup from
  // renderToStaticMarkup. The Dropdown's listbox portals to document.body and does
  // NOT render under SSR, so we only assert on the trigger (aria-haspopup="listbox")
  // and the inline label/warning text — never on getByRole('option').

  describe('defaultInviteRole', () => {
    it('first/primary contact (no members yet) → org_admin', () => {
      expect(defaultInviteRole(0)).toBe('org_admin')
    })
    it('every subsequent invite → staff', () => {
      expect(defaultInviteRole(1)).toBe('staff')
      expect(defaultInviteRole(7)).toBe('staff')
    })
  })

  const STORES = [
    { id: 'store-1', name: 'Auckland CBD' },
    { id: 'store-2', name: 'Wellington' },
  ]

  describe('InviteRoleFields', () => {
    it('org_admin → role picker only, NO store field', () => {
      const html = renderToStaticMarkup(
        <InviteRoleFields
          role="org_admin"
          onRoleChange={() => {}}
          defaultStoreId={null}
          onDefaultStoreChange={() => {}}
          stores={STORES}
        />,
      )
      expect(html.match(/aria-haspopup="listbox"/g)?.length).toBe(1)
      expect(html).not.toMatch(/Default ship-to store/i)
    })

    it('staff with stores → store picker required (two dropdowns)', () => {
      const html = renderToStaticMarkup(
        <InviteRoleFields
          role="staff"
          onRoleChange={() => {}}
          defaultStoreId={null}
          onDefaultStoreChange={() => {}}
          stores={STORES}
        />,
      )
      expect(html).toMatch(/Default ship-to store/i)
      expect(html.match(/aria-haspopup="listbox"/g)?.length).toBe(2)
    })

    it('staff with NO stores → blocking warning, no store picker', () => {
      const html = renderToStaticMarkup(
        <InviteRoleFields
          role="staff"
          onRoleChange={() => {}}
          defaultStoreId={null}
          onDefaultStoreChange={() => {}}
          stores={[]}
        />,
      )
      expect(html).toMatch(/no stores yet/i)
      expect(html.match(/aria-haspopup="listbox"/g)?.length).toBe(1)
    })
  })
  ```

- [ ] **Step 2: Run it — confirm RED.**
  ```bash
  cd /Users/jamierogangeorge/Documents/print-room-staff-portal && npx vitest run InviteMemberFields
  ```
  Expected FAIL: `Failed to resolve import "../InviteMemberFields"` (the module does not exist yet).

- [ ] **Step 3: Create the module (GREEN).**
  Create `src/components/b2b-accounts/InviteMemberFields.tsx`:
  ```tsx
  // src/components/b2b-accounts/InviteMemberFields.tsx
  'use client'

  import { type ReactNode } from 'react'
  import { Dropdown } from '@/components/ui/dropdown'
  import type { MemberRole } from './EditRoleDialog'

  export interface InviteStore {
    id: string
    name: string | null
  }

  /**
   * Default role for a NEW invite. The first/primary contact on an account is the
   * org_admin; everyone invited afterwards defaults to staff (stock-on-hand only).
   * The inviter can still override in the dialog. Pure + exported so the rule is
   * unit-testable without rendering the Modal (which portals nothing under SSR).
   */
  export function defaultInviteRole(memberCount: number): MemberRole {
    return memberCount === 0 ? 'org_admin' : 'staff'
  }

  // Local Field — the repo already duplicates this trivial label wrapper in
  // MembersPanel and EditRoleDialog; kept local so this testable unit pulls in no
  // heavy client-only deps (BulkUploadDialog, PreviewLauncher, …).
  function Field({
    label,
    htmlFor,
    required,
    children,
  }: {
    label: string
    htmlFor?: string
    required?: boolean
    children: ReactNode
  }) {
    return (
      <div className="flex flex-col gap-2">
        <label className="text-[11px] uppercase tracking-[0.14em] text-black/50" htmlFor={htmlFor}>
          {label}
          {required && <span className="ml-1 text-red-500">*</span>}
        </label>
        {children}
      </div>
    )
  }

  /**
   * Role + (staff-only) default-ship-to-store controls for the invite dialog.
   * Exported so it can be SSR-smoke-tested in isolation — inside MembersPanel it
   * sits behind a Modal portal that paints nothing under renderToStaticMarkup.
   * Staff MUST pick a store; when the account has none we show a blocking hint
   * (MembersPanel disables the submit button in that state).
   */
  export function InviteRoleFields({
    role,
    onRoleChange,
    defaultStoreId,
    onDefaultStoreChange,
    stores,
  }: {
    role: MemberRole
    onRoleChange: (next: MemberRole) => void
    defaultStoreId: string | null
    onDefaultStoreChange: (next: string | null) => void
    stores: InviteStore[]
  }) {
    const noStoresAvailable = role === 'staff' && stores.length === 0
    return (
      <>
        <Field label="Role" htmlFor="invite-role">
          <Dropdown
            className="[&>button]:w-full"
            size="sm"
            value={role}
            onValueChange={(v) => onRoleChange(v === 'staff' ? 'staff' : 'org_admin')}
            ariaLabel="Invite role"
            options={[
              { value: 'org_admin', label: 'Org admin' },
              { value: 'staff', label: 'Staff' },
            ]}
          />
        </Field>

        {role === 'staff' &&
          (noStoresAvailable ? (
            <Field label="Default ship-to store" required>
              <p className="rounded-2xl bg-orange-50 px-4 py-3 text-[13px] text-orange-800">
                This account has no stores yet — add one in the Stores section before
                inviting a staff member.
              </p>
            </Field>
          ) : (
            <Field label="Default ship-to store" htmlFor="invite-store" required>
              <Dropdown
                className="[&>button]:w-full"
                size="sm"
                value={defaultStoreId ?? undefined}
                onValueChange={(v) => onDefaultStoreChange(v || null)}
                placeholder="Select store"
                ariaLabel="Default ship-to store"
                options={stores.map((s) => ({ value: s.id, label: s.name ?? 'Store' }))}
              />
            </Field>
          ))}
      </>
    )
  }
  ```

- [ ] **Step 4: Run the module test — confirm GREEN.**
  ```bash
  cd /Users/jamierogangeorge/Documents/print-room-staff-portal && npx vitest run InviteMemberFields
  ```
  Expected PASS (5 assertions across 2 describes).

- [ ] **Step 5: Commit the tested unit.**
  ```bash
  git commit -am "feat: add InviteRoleFields + defaultInviteRole for the invite dialog"
  ```

- [ ] **Step 6: Wire the new fields into MembersPanel — import + state.**
  In `src/components/b2b-accounts/MembersPanel.tsx`, add the import after line 16 (`import { BulkUploadDialog } from './BulkUploadDialog'`):
  ```tsx
  import { defaultInviteRole, InviteRoleFields } from './InviteMemberFields'
  ```
  Then add two state hooks immediately after line 73 (`const [lastName, setLastName] = useState('')`):
  ```tsx
    const [role, setRole] = useState<MemberRole>(defaultInviteRole(initialMembers.length))
    const [defaultStoreId, setDefaultStoreId] = useState<string | null>(null)
  ```
  (`MemberRole` is already imported at line 13 via `import { EditRoleDialog, type MemberRole } from './EditRoleDialog'`.)

- [ ] **Step 7: Reset the invite fields each time the dialog opens (default role per current member count).**
  Add this handler right after `submitInvite` closes (after line 137, before the `const GRID` declaration at line 139):
  ```tsx
    function openInvite() {
      setRole(defaultInviteRole(members.length))
      setDefaultStoreId(null)
      setError(null)
      setMessage(null)
      setOpen(true)
    }
  ```
  Change the `+ Invite member` button (line 154) from:
  ```tsx
          <Button type="button" variant="accent" onClick={() => setOpen(true)}>
            + Invite member
          </Button>
  ```
  to:
  ```tsx
          <Button type="button" variant="accent" onClick={openInvite}>
            + Invite member
          </Button>
  ```

- [ ] **Step 8: Send the selected role + store, and reset the store on success.**
  In `submitInvite`, replace the request body (lines 116-121):
  ```tsx
        body: JSON.stringify({
          email,
          first_name: firstName,
          last_name: lastName,
          role: 'org_admin',
        }),
  ```
  with:
  ```tsx
        body: JSON.stringify({
          email,
          first_name: firstName,
          last_name: lastName,
          role,
          default_store_id: role === 'staff' ? defaultStoreId : null,
        }),
  ```
  Then extend the success reset (lines 128-130) from:
  ```tsx
        setEmail('')
        setFirstName('')
        setLastName('')
  ```
  to:
  ```tsx
        setEmail('')
        setFirstName('')
        setLastName('')
        setDefaultStoreId(null)
  ```

- [ ] **Step 9: Render the controls in the dialog + guard the submit button.**
  In the invite `Modal`, the first/last-name grid closes at line 287 (`</div>` after the Last name `Field`). Insert the control block immediately after that closing `</div>` and before the `{message && (` block (line 288):
  ```tsx
              <InviteRoleFields
                role={role}
                onRoleChange={setRole}
                defaultStoreId={defaultStoreId}
                onDefaultStoreChange={setDefaultStoreId}
                stores={stores}
              />
  ```
  Then replace the submit-button `disabled` prop (line 314):
  ```tsx
                disabled={busy || !email.trim() || !firstName.trim()}
  ```
  with:
  ```tsx
                disabled={
                  busy ||
                  !email.trim() ||
                  !firstName.trim() ||
                  (role === 'staff' && (stores.length === 0 || !defaultStoreId))
                }
  ```

- [ ] **Step 10: Verify the wiring type-checks and the whole slice is green.**
  ```bash
  cd /Users/jamierogangeorge/Documents/print-room-staff-portal && npx vitest run InviteMemberFields invite/route.test.ts && npx tsc --noEmit
  ```
  Expected: all vitest tests PASS and `tsc --noEmit` reports no errors (confirms `InviteRoleFields`/`stores`/`role` wiring in `MembersPanel` is type-correct — MembersPanel itself has no unit test, matching repo convention).
  Decision-free manual check (optional, recommended before Thursday): open a B2B org with ≥1 store, click **+ Invite member**, confirm the Role dropdown defaults to **Staff** on an account that already has a member (and **Org admin** on an empty account), that selecting **Staff** reveals the required store picker, and that **Send invite** stays disabled until a store is chosen.

- [ ] **Step 11: Commit.**
  ```bash
  git commit -am "feat: invite dialog gains role + default ship-to store (staff default)"
  ```

---

<!-- ===== Spec B step 2 · Prepaid tag + display + Xero $0/pick-fee + picking fees · cluster: prepaid-tag-customer-display-xero-pickfee ===== -->

Grounding notes that shape every task below:
- Do NOT reuse the column name `prepaid` (collides with `variant_inventory.prepaid`, valuation-only, added in staff migration `20260513060604`). The new tag is `b2b_catalogue_items.billing_mode` with values `'invoice_on_dispatch'` (default = not-paid) and `'prepaid'` (pre-paid).
- `orders.order_type`, the push-with-note Monday flow, the Past-orders courier surface and the order-placed notification abstraction are **Spec A foundations consumed by name** — none are built here.
- These tasks interlock (prepaid + pick fee build together). The Thursday-critical **staff-default invite** ships FIRST.

---

### Task: Staff-default invite — role choice + default_store_id (Thursday-critical, ships FIRST)

**Files:**
- Create `/Users/jamierogangeorge/Documents/print-room-staff-portal/src/app/api/b2b-accounts/[id]/invite/resolve-membership.ts`
- Create `/Users/jamierogangeorge/Documents/print-room-staff-portal/src/app/api/b2b-accounts/[id]/invite/resolve-membership.test.ts`
- Modify `/Users/jamierogangeorge/Documents/print-room-staff-portal/src/app/api/b2b-accounts/[id]/invite/route.ts` (const at line 9; `role` parse at line 40; role gate at lines 48-53; membership insert at lines 144-150)
- Modify `/Users/jamierogangeorge/Documents/print-room-staff-portal/src/app/api/b2b-accounts/[id]/invite/route.test.ts` (extend the fake admin `.from` switch, lines 64-112)

**Interfaces:**
- Produces: `resolveInviteMembership(input: { role: string | undefined; defaultStoreId: string | null | undefined; validStoreIds: Set<string> }): { role: 'org_admin' | 'staff'; defaultStoreId: string | null } | { error: string }`
- Consumes: existing `requireB2BAccountsStaffAccess(request)` and the org-scoped `stores` table (`stores.organization_id`, confirmed used in `members/bulk/route.ts:81`). Consumes the DB invariant `chk_buyer_has_default_store` (role<>'staff' OR default_store_id NOT NULL) — already in the shared DB.

- [ ] **Step 1: Write the failing pure-helper test.** Create `resolve-membership.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { resolveInviteMembership } from './resolve-membership'

  const stores = new Set(['store-1', 'store-2'])

  describe('resolveInviteMembership', () => {
    it('defaults to org_admin with no store when role omitted', () => {
      expect(resolveInviteMembership({ role: undefined, defaultStoreId: null, validStoreIds: stores }))
        .toEqual({ role: 'org_admin', defaultStoreId: null })
    })
    it('rejects an unknown role', () => {
      expect(resolveInviteMembership({ role: 'wizard', defaultStoreId: null, validStoreIds: stores }))
        .toEqual({ error: 'role must be org_admin or staff' })
    })
    it('staff requires a default store', () => {
      expect(resolveInviteMembership({ role: 'staff', defaultStoreId: null, validStoreIds: stores }))
        .toEqual({ error: 'Staff invites require a default ship-to store' })
    })
    it('staff store must belong to the org', () => {
      expect(resolveInviteMembership({ role: 'staff', defaultStoreId: 'store-x', validStoreIds: stores }))
        .toEqual({ error: 'default_store_id does not belong to this organization' })
    })
    it('accepts a staff invite with a valid org store', () => {
      expect(resolveInviteMembership({ role: 'staff', defaultStoreId: 'store-1', validStoreIds: stores }))
        .toEqual({ role: 'staff', defaultStoreId: 'store-1' })
    })
  })
  ```
- [ ] **Step 2: Run it — expect FAIL** (module missing):
  `cd /Users/jamierogangeorge/Documents/print-room-staff-portal && npx vitest run src/app/api/b2b-accounts/[id]/invite/resolve-membership.test.ts`
  Expected: `Failed to resolve import "./resolve-membership"`.
- [ ] **Step 3: Implement the pure helper.** Create `resolve-membership.ts`:
  ```ts
  export type InviteRole = 'org_admin' | 'staff'

  export interface ResolveInviteMembershipInput {
    role: string | undefined
    defaultStoreId: string | null | undefined
    validStoreIds: Set<string>
  }
  export interface ResolvedInviteMembership {
    role: InviteRole
    defaultStoreId: string | null
  }

  export function resolveInviteMembership(
    input: ResolveInviteMembershipInput,
  ): ResolvedInviteMembership | { error: string } {
    const role = input.role ?? 'org_admin'
    if (role !== 'org_admin' && role !== 'staff') {
      return { error: 'role must be org_admin or staff' }
    }
    if (role === 'org_admin') return { role, defaultStoreId: null }
    const storeId = input.defaultStoreId ?? null
    if (!storeId) return { error: 'Staff invites require a default ship-to store' }
    if (!input.validStoreIds.has(storeId)) {
      return { error: 'default_store_id does not belong to this organization' }
    }
    return { role: 'staff', defaultStoreId: storeId }
  }
  ```
- [ ] **Step 4: Run it — expect PASS** (same command as Step 2). All 5 pass.
- [ ] **Step 5: Wire the helper into the route — replace the role gate.** In `route.ts`, delete the current allow-list (line 9) and the role gate (lines 48-53):
  ```ts
  // DELETE line 9:
  const ALLOWED_ROLES = ['org_admin'] as const
  // DELETE lines 48-53:
  if (!ALLOWED_ROLES.includes(role as 'org_admin')) {
    return NextResponse.json(
      { error: 'Invites currently only support org_admin role; promote to staff afterwards.' },
      { status: 400 },
    )
  }
  ```
  Add the import at the top and update `InviteBody` (line 11-16) to carry `default_store_id`:
  ```ts
  import { resolveInviteMembership } from './resolve-membership'
  // InviteBody gains:
  interface InviteBody {
    email?: string
    first_name?: string
    last_name?: string
    role?: string
    default_store_id?: string | null
  }
  ```
- [ ] **Step 6: Resolve role+store AFTER the org existence check (after line 63).** The org lookup already runs at lines 55-63; insert immediately after it:
  ```ts
  const { data: storeRows } = await auth.admin
    .from('stores')
    .select('id')
    .eq('organization_id', id)
  const validStoreIds = new Set(
    ((storeRows ?? []) as Array<{ id: string }>).map((s) => s.id),
  )
  const membership = resolveInviteMembership({
    role: body.role,
    defaultStoreId: body.default_store_id ?? null,
    validStoreIds,
  })
  if ('error' in membership) {
    return NextResponse.json({ error: membership.error }, { status: 400 })
  }
  ```
  Then delete the now-dead `const role = body.role ?? 'org_admin'` (line 40) — `membership.role` replaces it.
- [ ] **Step 7: Persist default_store_id on the membership insert (lines 144-150).** Current:
  ```ts
  const { error: membershipError } = await auth.admin
    .from('user_organizations')
    .insert({
      user_id: userId,
      organization_id: id,
      role,
    })
  ```
  New:
  ```ts
  const { error: membershipError } = await auth.admin
    .from('user_organizations')
    .insert({
      user_id: userId,
      organization_id: id,
      role: membership.role,
      default_store_id: membership.defaultStoreId,
    })
  ```
  Also update the audit metadata (line 186) `role` -> `role: membership.role` and add `default_store_id: membership.defaultStoreId`.
- [ ] **Step 8: Extend the route test's fake admin with a `stores` branch, add a staff-happy-path case.** In `route.test.ts` `makeAdmin` (before the `user_organizations` fallthrough at line 93), add:
  ```ts
  if (table === 'stores') {
    return {
      select: () => ({
        eq: () => Promise.resolve({ data: [{ id: 'store-1' }], error: null }),
      }),
    }
  }
  ```
  Add a test:
  ```ts
  it('staff invite with a valid org store persists default_store_id', async () => {
    const f = makeAdmin()
    mocks.requireB2BAccountsStaffAccess.mockResolvedValue({ admin: f.admin, context: { userId: 'staff-1' } })
    const res = await POST(req({ ...validBody, role: 'staff', default_store_id: 'store-1' }), ctx('org-1'))
    expect(res.status).toBe(201)
    expect(f.inserts[0]).toMatchObject({ role: 'staff', default_store_id: 'store-1' })
  })
  ```
- [ ] **Step 9: Run the route test — expect PASS:**
  `cd /Users/jamierogangeorge/Documents/print-room-staff-portal && npx vitest run "src/app/api/b2b-accounts/[id]/invite/route.test.ts"`
  All prior cases still pass (default path still inserts `role: 'org_admin'`), plus the new staff case.
- [ ] **Step 10: Commit.** `git commit -am "feat: staff-default invite gains role choice + default_store_id"`

---

### Task: billing_mode column on b2b_catalogue_items (staff DB migration)

**Files:**
- Create `/Users/jamierogangeorge/Documents/print-room-staff-portal/supabase/migrations/20260715120000_b2b_catalogue_items_billing_mode.sql`

**Interfaces:**
- Produces: DB column `b2b_catalogue_items.billing_mode text NOT NULL DEFAULT 'invoice_on_dispatch' CHECK (billing_mode IN ('invoice_on_dispatch','prepaid'))`. `'invoice_on_dispatch'` = not-paid (draft quote + invoice before dispatch); `'prepaid'` = pre-paid (Xero zeroes goods, pick fee only).
- Consumes: nothing (additive column).

> Migrations aren't unit-tested (schema). This mirrors the additive style of `20260518120000_inventory_catalogue_derived.sql` (`add column if not exists`, `comment on column`). SHARED PROD DB, NO STAGING — verify + apply per repo convention.

- [ ] **Step 1: Write the migration.** Create the file:
  ```sql
  -- Per customer×product billing mode for catalogue items.
  --  'invoice_on_dispatch' (default = "not-paid"): goods draft-quoted in Xero,
  --      invoice must be settled before dispatch.
  --  'prepaid': goods already paid — Xero zeroes the product value (100% discount)
  --      and the picking fee is billed on its own line.
  -- DISTINCT from variant_inventory.prepaid (valuation-only, migration 20260513060604).
  -- Do NOT reuse the bare name "prepaid" for this per-item billing tag.
  alter table public.b2b_catalogue_items
    add column if not exists billing_mode text not null default 'invoice_on_dispatch'
      check (billing_mode in ('invoice_on_dispatch', 'prepaid'));

  comment on column public.b2b_catalogue_items.billing_mode is
    'Per customer×product billing: invoice_on_dispatch (default; draft quote + invoice before dispatch) '
    'or prepaid (goods already paid; Xero zeroes goods value, pick fee only). Distinct from '
    'variant_inventory.prepaid (valuation-only).';
  ```
- [ ] **Step 2 (Decision gate — apply to shared prod DB):** Before applying, re-run a read-only check and record the count, per the `20260612150000` convention:
  `SELECT count(*) FROM public.b2b_catalogue_items WHERE billing_mode IS NOT NULL;` (expect: errors — column absent — confirming a clean add). Apply via the repo's migration runner (`supabase db push` or MCP `apply_migration`), then verify:
  `SELECT DISTINCT billing_mode FROM public.b2b_catalogue_items;` → expect only `invoice_on_dispatch`.
- [ ] **Step 3: Commit.** `git commit -am "feat: add b2b_catalogue_items.billing_mode (not-paid default)"`

---

### Task: Staff CatalogueItemEditor billing-mode control + PATCH wiring

**Files:**
- Modify `/Users/jamierogangeorge/Documents/print-room-staff-portal/src/app/api/catalogues/[id]/items/[itemId]/route.ts` (PATCHABLE lines 11-25; add a `VALID_BILLING_MODES` guard in `buildItemPatch` near the `price_mode` branch, lines 73-77)
- Modify `/Users/jamierogangeorge/Documents/print-room-staff-portal/src/app/api/catalogues/[id]/items/[itemId]/route.patch.test.ts`
- Modify `/Users/jamierogangeorge/Documents/print-room-staff-portal/src/app/(portal)/catalogues/[id]/items/[itemId]/page.tsx` (select lines 84-103; mapping lines 378-395)
- Modify `/Users/jamierogangeorge/Documents/print-room-staff-portal/src/components/catalogues/CatalogueItemEditor.tsx` (interface `CatalogueItemEditorData.item` lines 51-68; `FormState` lines 97-107; `initial()` lines 109-123; `buildPatch()` lines 175-209; the Fulfilment-mode Field lines 541-563)

**Interfaces:**
- Consumes: `b2b_catalogue_items.billing_mode` (prior task); existing `buildItemPatch(body): { patch; error? }`.
- Produces: `type BillingMode = 'invoice_on_dispatch' | 'prepaid'` (add to `@/types/products` alongside `FulfilmentType`); PATCH now accepts+validates `billing_mode`; editor exposes a "Billing" dropdown next to "Fulfilment mode".

- [ ] **Step 1: Write the failing PATCH test.** Append to `route.patch.test.ts`:
  ```ts
  describe('buildItemPatch billing_mode', () => {
    it('accepts invoice_on_dispatch', () => {
      const { patch, error } = buildItemPatch({ billing_mode: 'invoice_on_dispatch' })
      expect(error).toBeUndefined()
      expect(patch.billing_mode).toBe('invoice_on_dispatch')
    })
    it('accepts prepaid', () => {
      expect(buildItemPatch({ billing_mode: 'prepaid' }).patch.billing_mode).toBe('prepaid')
    })
    it('rejects an unknown billing_mode', () => {
      expect(buildItemPatch({ billing_mode: 'free' }).error).toBe('invalid billing_mode')
    })
    it('ignores billing_mode when absent', () => {
      expect('billing_mode' in buildItemPatch({ name: 'x' }).patch).toBe(false)
    })
  })
  ```
- [ ] **Step 2: Run — expect FAIL:**
  `cd /Users/jamierogangeorge/Documents/print-room-staff-portal && npx vitest run "src/app/api/catalogues/[id]/items/[itemId]/route.patch.test.ts"`
  Expected: `expected undefined to be 'invoice_on_dispatch'` (billing_mode not yet allow-listed).
- [ ] **Step 3: Allow-list + validate billing_mode in the route.** In `route.ts`, add `'billing_mode'` to `PATCHABLE` (after `'price_mode'`, line 22) and add a constant next to `VALID_PRICE_MODES` (line 27):
  ```ts
  const VALID_BILLING_MODES = new Set(['invoice_on_dispatch', 'prepaid'])
  ```
  In `buildItemPatch`, add a branch mirroring the `price_mode` branch (lines 73-77):
  ```ts
  } else if (k === 'billing_mode') {
    if (!VALID_BILLING_MODES.has(body[k] as string)) {
      return { patch, error: 'invalid billing_mode' }
    }
    patch[k] = body[k]
  }
  ```
- [ ] **Step 4: Run — expect PASS** (same command as Step 2).
- [ ] **Step 5: Extend the editor loader.** In `page.tsx`, add `billing_mode,` to the `b2b_catalogue_items` select (after `price_mode,` line 99) and to the `item` mapping (after `price_mode:` line 392):
  ```ts
  billing_mode: (item.billing_mode as 'invoice_on_dispatch' | 'prepaid') ?? 'invoice_on_dispatch',
  ```
- [ ] **Step 6: Thread billing_mode through the editor component state.** In `CatalogueItemEditor.tsx`:
  - Add to `CatalogueItemEditorData.item` (after `price_mode` line 64): `billing_mode: 'invoice_on_dispatch' | 'prepaid'`.
  - Add to `FormState` (after `fulfilment_type_override`, line 106): `billing_mode: string`.
  - In `initial()` (line 121): `billing_mode: data.item.billing_mode ?? 'invoice_on_dispatch',`.
  - In `buildPatch()` (after the `fulfilment_type_override` entry, line 205-206): `billing_mode: form.billing_mode,`.
- [ ] **Step 7: Add the Billing dropdown to the editor UI**, directly beneath the Fulfilment-mode `Field` (after line 563, inside the same "Catalogue-scoped details" Card):
  ```tsx
  <Field id="cie-billing-mode" label="Billing">
    <Dropdown
      size="md"
      ariaLabel="Billing mode"
      value={form.billing_mode}
      onValueChange={(v) => set('billing_mode', v)}
      options={[
        { value: 'invoice_on_dispatch', label: 'Invoice on dispatch (not paid)' },
        { value: 'prepaid', label: 'Pre-paid (pick fee only)' },
      ]}
    />
  </Field>
  ```
  (`Dropdown` and `Field` are already imported/defined in this file — lines 24, 750.)
- [ ] **Step 8: Manual smoke** (no component test harness for this editor): `cd /Users/jamierogangeorge/Documents/print-room-staff-portal && npx tsc --noEmit` — expect no type errors from the new field wiring.
- [ ] **Step 9: Commit.** `git commit -am "feat: staff billing-mode control on catalogue items"`

---

### Task: Picking-fee NZ band table (pure module)

**Files:**
- Create `/Users/jamierogangeorge/Documents/print-room-portal/lib/pricing/picking-fee.ts`
- Create `/Users/jamierogangeorge/Documents/print-room-portal/lib/pricing/picking-fee.test.ts`

**Interfaces:**
- Produces: `pickingFeeForGoods(goodsSubtotalNzd: number): number`; `PICKING_FEE_BANDS: ReadonlyArray<{ maxExclusive: number; fee: number }>`.
- Consumes: nothing.

> **DECISION GATE (region):** bands are NZ-only ($0-99=$35, $100-199=$30, $200-299=$25, $300-399=$20, $400+=$15). Non-NZ behaviour is undecided — this function is NZD-only; a `region` param is a follow-up.
> **DECISION GATE (band input):** the band is keyed on goods ex-GST subtotal (`grossSubtotal`). Confirm this vs incl-GST/order-total before the totals wiring task consumes it.

- [ ] **Step 1: Write the failing test.** Create `picking-fee.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { pickingFeeForGoods } from './picking-fee'

  describe('pickingFeeForGoods (NZ band table)', () => {
    it.each([
      [0, 35], [50, 35], [99, 35], [99.99, 35],
      [100, 30], [199.99, 30],
      [200, 25], [299.99, 25],
      [300, 20], [399.99, 20],
      [400, 15], [10000, 15],
    ])('goods %d -> fee %d', (goods, fee) => {
      expect(pickingFeeForGoods(goods)).toBe(fee)
    })
    it('treats negative/NaN as the lowest band', () => {
      expect(pickingFeeForGoods(-5)).toBe(35)
      expect(pickingFeeForGoods(Number.NaN)).toBe(35)
    })
  })
  ```
- [ ] **Step 2: Run — expect FAIL:**
  `cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run lib/pricing/picking-fee.test.ts`
  Expected: `Failed to resolve import "./picking-fee"`.
- [ ] **Step 3: Implement.** Create `picking-fee.ts`:
  ```ts
  /**
   * NZ picking-fee band table. Keyed on goods subtotal (ex-GST, NZD).
   * $0-99 = $35, $100-199 = $30, $200-299 = $25, $300-399 = $20, $400+ = $15.
   * NZD-only in v1 (see Decision gate: region behaviour beyond NZ).
   */
  export const PICKING_FEE_BANDS: ReadonlyArray<{ maxExclusive: number; fee: number }> = [
    { maxExclusive: 100, fee: 35 },
    { maxExclusive: 200, fee: 30 },
    { maxExclusive: 300, fee: 25 },
    { maxExclusive: 400, fee: 20 },
    { maxExclusive: Infinity, fee: 15 },
  ]

  export function pickingFeeForGoods(goodsSubtotalNzd: number): number {
    const g = Number.isFinite(goodsSubtotalNzd) ? Math.max(0, goodsSubtotalNzd) : 0
    for (const band of PICKING_FEE_BANDS) {
      if (g < band.maxExclusive) return band.fee
    }
    return PICKING_FEE_BANDS[PICKING_FEE_BANDS.length - 1].fee
  }
  ```
- [ ] **Step 4: Run — expect PASS** (same command as Step 2).
- [ ] **Step 5: Commit.** `git commit -am "feat: NZ picking-fee band table"`

---

### Task: Thread picking fee into OrderBreakdown + PriceBreakdown line

**Files:**
- Modify `/Users/jamierogangeorge/Documents/print-room-portal/lib/pricing/types.ts` (`OrderBreakdown`, lines 24-33)
- Modify `/Users/jamierogangeorge/Documents/print-room-portal/lib/pricing/pricingMath.ts` (`OrderInput` lines 31-34; `computeOrderBreakdown` lines 36-62)
- Modify `/Users/jamierogangeorge/Documents/print-room-portal/lib/pricing/pricingMath.test.ts`
- Modify `/Users/jamierogangeorge/Documents/print-room-portal/components/pricing/PriceBreakdown.tsx` (Shipping row region, lines 36-47)
- Modify `/Users/jamierogangeorge/Documents/print-room-portal/components/pricing/PriceBreakdown.test.tsx`

**Interfaces:**
- Consumes: `pickingFeeForGoods` (prior task); `computeOrderBreakdown`.
- Produces: `OrderBreakdown.pickingFee: number`; `computeOrderBreakdown` gains optional `pickingFee?: number` (default 0). GST computed on goods + pick fee; `netSubtotal` stays goods-only (deposit base unchanged). All 4 existing callers keep working (param optional).

> Keeping `pickingFee` optional (default 0) is deliberate — `ProductDetailClient`, `CheckoutClient`, `CartDrawer` and `CheckoutReviewClient` all call `computeOrderBreakdown` and must not change behaviour until the checkout wiring passes a fee.

- [ ] **Step 1: Write the failing math test.** Append to `pricingMath.test.ts`:
  ```ts
  import { computeOrderBreakdown } from './pricingMath'
  describe('computeOrderBreakdown pickingFee', () => {
    const lines = [{ qty: 2, unitEffective: 50, decorationPerUnit: 0 }] // goods = 100
    it('defaults pickingFee to 0 (no behaviour change)', () => {
      const b = computeOrderBreakdown({ lines, gstRate: 0.15 })
      expect(b.pickingFee).toBe(0)
      expect(b.gst).toBe(15)      // 100 * 0.15
      expect(b.total).toBe(115)
    })
    it('adds the fee to GST + total but not to netSubtotal', () => {
      const b = computeOrderBreakdown({ lines, gstRate: 0.15, pickingFee: 30 })
      expect(b.pickingFee).toBe(30)
      expect(b.netSubtotal).toBe(100)          // goods only (deposit base)
      expect(b.gst).toBe(19.5)                 // (100 + 30) * 0.15
      expect(b.total).toBe(149.5)              // 100 + 30 + 19.5
    })
  })
  ```
- [ ] **Step 2: Run — expect FAIL:**
  `cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run lib/pricing/pricingMath.test.ts`
  Expected: `expected undefined to be 0` (`pickingFee` missing on the breakdown).
- [ ] **Step 3: Add the field to the type.** In `types.ts` `OrderBreakdown`, after `netSubtotal` (line 29) add:
  ```ts
  pickingFee: number       // separate NZ picking-fee line; 0 when no fee applies
  ```
- [ ] **Step 4: Compute it.** In `pricingMath.ts`, extend `OrderInput` (lines 31-34):
  ```ts
  interface OrderInput {
    lines: Array<Pick<LineInput, 'qty' | 'unitEffective' | 'decorationPerUnit'>>
    gstRate: number
    pickingFee?: number
  }
  ```
  Replace the tail of `computeOrderBreakdown` (lines 49-61) with:
  ```ts
  const netSubtotal = grossSubtotal
  const pickingFee = round2(Math.max(0, input.pickingFee ?? 0))
  const gst = round2((netSubtotal + pickingFee) * gstRate)
  const total = round2(netSubtotal + pickingFee + gst)
  return {
    lines,
    grossSubtotal,
    decorationTotal,
    discountAmount: 0,
    netSubtotal,
    pickingFee,
    gstRate,
    gst,
    total,
  }
  ```
- [ ] **Step 5: Run — expect PASS** (same command as Step 2). Confirm no other `pricingMath.test.ts` case regressed (`pickingFee` defaults to 0).
- [ ] **Step 6: Render the pick-fee row.** In `PriceBreakdown.tsx`, directly after the `showShipping` block (line 41) add:
  ```tsx
  {breakdown.pickingFee > 0 && (
    <div className="flex items-baseline justify-between">
      <span className="text-gray-700">Picking fee</span>
      <span className="font-medium text-gray-900">{fmt(breakdown.pickingFee)}</span>
    </div>
  )}
  ```
- [ ] **Step 7: Add a component test.** In `PriceBreakdown.test.tsx`, render with a breakdown carrying `pickingFee: 30` and assert the "Picking fee" label + formatted amount appear, and that a `pickingFee: 0` breakdown renders no such row. (Mirror the existing render assertions in that file.)
- [ ] **Step 8: Run — expect PASS:**
  `cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run components/pricing/PriceBreakdown.test.tsx`
- [ ] **Step 9: Commit.** `git commit -am "feat: picking-fee line in order breakdown + PriceBreakdown"`

> NOTE: This task only adds the *capability*. Which order value the fee is computed from and *where* `pickingFee` is passed into `computeOrderBreakdown` (checkout only? cart drawer too?) is decided in the checkout-summary wiring — see the Decision gate in the picking-fee band task (scope: all / stock-on-hand / prepaid).

---

### Task: Customer-facing pre-paid indicator (PDP + checkout summary)

**Files:**
- Create `/Users/jamierogangeorge/Documents/print-room-portal/lib/shop/prepaid-tag.ts`
- Create `/Users/jamierogangeorge/Documents/print-room-portal/lib/shop/prepaid-tag.test.ts`
- Modify `/Users/jamierogangeorge/Documents/print-room-portal/lib/shop/resolve-catalogue-item.ts` (`PdpCatalogueItem` lines 5-16; `CAT_ITEM_SELECT` line 18-19)
- Modify `/Users/jamierogangeorge/Documents/print-room-portal/lib/shop/resolve-catalogue-item.test.ts` (assert the new column is selected/returned)
- Modify `/Users/jamierogangeorge/Documents/print-room-portal/app/(portal)/catalogue/[productId]/page.tsx` (ProductData mapping, lines 430-462)
- Modify `/Users/jamierogangeorge/Documents/print-room-portal/components/shop/ProductDetailClient.tsx` (`ProductData` interface lines 46-79; a badge near the AvailabilityBadge)

**Interfaces:**
- Consumes: `b2b_catalogue_items.billing_mode`; `PdpCatalogueItem`; `ProductData.fulfilment_type`.
- Produces: `type BillingMode = 'invoice_on_dispatch' | 'prepaid'` (portal-side, `lib/shop/billing-mode.ts` — export the alias here so PDP + Xero + Monday tasks share one type); `showsPrepaidTag(fulfilment, billingMode): boolean`; `PdpCatalogueItem.billing_mode`; `ProductData.billingMode`.

> Spec (b): the "Pre-paid" indicator shows only for **stock-on-hand products carrying the tag** — i.e. `billing_mode === 'prepaid'` AND the product can draw stock (`fulfilment_type` is `'stocked'` or `'mixed'`). A `'made_to_order'` prepaid item shows nothing.

- [ ] **Step 1: Write the failing predicate test.** Create `prepaid-tag.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { showsPrepaidTag } from './prepaid-tag'

  describe('showsPrepaidTag', () => {
    it('true for prepaid stocked', () => expect(showsPrepaidTag('stocked', 'prepaid')).toBe(true))
    it('true for prepaid mixed', () => expect(showsPrepaidTag('mixed', 'prepaid')).toBe(true))
    it('false for prepaid made_to_order', () => expect(showsPrepaidTag('made_to_order', 'prepaid')).toBe(false))
    it('false for not-paid stocked', () => expect(showsPrepaidTag('stocked', 'invoice_on_dispatch')).toBe(false))
    it('false when billingMode null (legacy)', () => expect(showsPrepaidTag('stocked', null)).toBe(false))
  })
  ```
- [ ] **Step 2: Run — expect FAIL:**
  `cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run lib/shop/prepaid-tag.test.ts`
  Expected: `Failed to resolve import "./prepaid-tag"`.
- [ ] **Step 3: Implement the shared type + predicate.** Create `lib/shop/billing-mode.ts`:
  ```ts
  export type BillingMode = 'invoice_on_dispatch' | 'prepaid'
  ```
  Create `lib/shop/prepaid-tag.ts`:
  ```ts
  import type { BillingMode } from './billing-mode'
  type Fulfilment = 'stocked' | 'made_to_order' | 'mixed'

  /** Customer "Pre-paid" indicator: prepaid tag AND the product can draw stock. */
  export function showsPrepaidTag(fulfilment: Fulfilment, billingMode: BillingMode | null): boolean {
    if (billingMode !== 'prepaid') return false
    return fulfilment === 'stocked' || fulfilment === 'mixed'
  }
  ```
- [ ] **Step 4: Run — expect PASS** (same command as Step 2).
- [ ] **Step 5: Select + type the column in the resolver.** In `resolve-catalogue-item.ts`, add to `PdpCatalogueItem` (after `price_mode`, line 12): `billing_mode: 'invoice_on_dispatch' | 'prepaid' | null` and append `billing_mode` to `CAT_ITEM_SELECT` (line 19), e.g. `... price_mode, billing_mode, volume_display_hidden_bands, ...`.
- [ ] **Step 6: Extend the resolver test.** In `resolve-catalogue-item.test.ts`, add `billing_mode: 'prepaid'` to a fixture row and assert the resolved item exposes it. Run — expect PASS:
  `cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run lib/shop/resolve-catalogue-item.test.ts`
- [ ] **Step 7: Thread billing_mode into the PDP payload.** In `app/(portal)/catalogue/[productId]/page.tsx`, in the `product` object (after `priceMode:` line 458) add:
  ```ts
  billingMode: (catItem.billing_mode as 'invoice_on_dispatch' | 'prepaid' | null) ?? 'invoice_on_dispatch',
  ```
- [ ] **Step 8: Render the badge on the PDP.** In `ProductDetailClient.tsx`, add to the `ProductData` interface (after `fulfilment_type`, line 62): `billingMode?: 'invoice_on_dispatch' | 'prepaid'`. Import the predicate at the top (`import { showsPrepaidTag } from '@/lib/shop/prepaid-tag'`) and, next to the existing `AvailabilityBadge` render, add:
  ```tsx
  {showsPrepaidTag(product.fulfilment_type, product.billingMode ?? null) && (
    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
      Pre-paid
    </span>
  )}
  ```
  (Exact placement: alongside the `<AvailabilityBadge />` usage — grep `AvailabilityBadge` at line 5/its JSX site.)
- [ ] **Step 9: Checkout-summary badge.** The cart line already carries `catalogueItemId` and `fulfilmentType` (`lib/cart/types.ts` lines 65, 80) but NOT `billing_mode`. **Decision gate:** to show the badge in `CheckoutReviewClient` per line, either (a) add `billingMode` to `CartLine` and stamp it when adding to cart from the PDP (preferred — PDP already has `product.billingMode`), or (b) look it up at review time. Plan for (a): add `billingMode?: BillingMode` to `CartLine`, set it in the PDP add-to-cart path, and in `CheckoutReviewClient.tsx` (the per-line `<article>` block, lines 400-415) render the same "Pre-paid" pill when `showsPrepaidTag(line.fulfilmentType ?? 'stocked', line.billingMode ?? null)`.
- [ ] **Step 10: Run the PDP/checkout unit tests + typecheck.**
  `cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run lib/shop/prepaid-tag.test.ts lib/shop/resolve-catalogue-item.test.ts && npx tsc --noEmit`
- [ ] **Step 11: Commit.** `git commit -am "feat: customer pre-paid indicator on PDP + checkout summary"`

---

### Task: Order-level not-paid aggregation + conditional Monday billing note

**Files:**
- Create `/Users/jamierogangeorge/Documents/print-room-portal/lib/checkout/order-billing.ts`
- Create `/Users/jamierogangeorge/Documents/print-room-portal/lib/checkout/order-billing.test.ts`
- Create `/Users/jamierogangeorge/Documents/print-room-portal/lib/monday/billing-note.ts`
- Create `/Users/jamierogangeorge/Documents/print-room-portal/lib/monday/__tests__/billing-note.test.ts`
- Modify `/Users/jamierogangeorge/Documents/print-room-portal/lib/checkout/submit.ts` (catalogue-item fetch `catItemMoqRows`, lines 399-424; the Monday push block, ~lines 1291-1352; the Xero step 5c, lines 1521-1544)

**Interfaces:**
- Consumes: `BillingMode`; the Spec A **push-with-note Monday flow** (whatever posts the per-order note after `pushOrderDeal`); `input.lines[].fulfilment_type`, `input.lines[].catalogueItemId`; existing `catItemRows` (already selected from `b2b_catalogue_items` in submit).
- Produces: `orderNeedsInvoicing(lines: Array<{ stocked: boolean; billingMode: BillingMode }>): boolean`; `orderBillingNote(input: { needsInvoicing: boolean; pickFee: number }): string`.

> **Supersedes Spec A item 11 (flat Monday note).** Spec A introduces a single flat note; Spec B makes it conditional again. Since the flat note does not exist in `submit.ts` today (only the Xero manual-review note at line 1551), wire `orderBillingNote` into Spec A's note callsite when it lands; if Spec A hasn't shipped, post it as an additional `postItemUpdate` in the Monday push block.

- [ ] **Step 1: Write the failing aggregation test.** Create `order-billing.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { orderNeedsInvoicing } from './order-billing'

  describe('orderNeedsInvoicing (any stocked line not-paid)', () => {
    it('false when no stocked lines', () =>
      expect(orderNeedsInvoicing([{ stocked: false, billingMode: 'invoice_on_dispatch' }])).toBe(false))
    it('false when every stocked line is prepaid', () =>
      expect(orderNeedsInvoicing([
        { stocked: true, billingMode: 'prepaid' },
        { stocked: false, billingMode: 'invoice_on_dispatch' },
      ])).toBe(false))
    it('true when any stocked line is not-paid', () =>
      expect(orderNeedsInvoicing([
        { stocked: true, billingMode: 'prepaid' },
        { stocked: true, billingMode: 'invoice_on_dispatch' },
      ])).toBe(true))
  })
  ```
- [ ] **Step 2: Run — expect FAIL:**
  `cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run lib/checkout/order-billing.test.ts`
  Expected: `Failed to resolve import "./order-billing"`.
- [ ] **Step 3: Implement.** Create `order-billing.ts`:
  ```ts
  import type { BillingMode } from '@/lib/shop/billing-mode'

  /** Order needs invoicing iff ANY stocked (stock-on-hand) line is not-paid. */
  export function orderNeedsInvoicing(
    lines: Array<{ stocked: boolean; billingMode: BillingMode }>,
  ): boolean {
    return lines.some((l) => l.stocked && l.billingMode === 'invoice_on_dispatch')
  }
  ```
- [ ] **Step 4: Run — expect PASS** (same command as Step 2).
- [ ] **Step 5: Write the failing note test.** Create `lib/monday/__tests__/billing-note.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { orderBillingNote } from '../billing-note'

  describe('orderBillingNote', () => {
    it('prepaid order (no invoicing) — pick fee only', () => {
      expect(orderBillingNote({ needsInvoicing: false, pickFee: 30 }))
        .toBe('Prepaid — no Xero invoice required (pick fee $30.00 only).')
    })
    it('not-paid order — draft quote raised', () => {
      expect(orderBillingNote({ needsInvoicing: true, pickFee: 30 }))
        .toBe('Not paid — draft quote raised, invoice before dispatch. Pick fee $30.00.')
    })
  })
  ```
- [ ] **Step 6: Run — expect FAIL:**
  `cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run lib/monday/__tests__/billing-note.test.ts`
  Expected: `Failed to resolve import "../billing-note"`.
- [ ] **Step 7: Implement.** Create `lib/monday/billing-note.ts`:
  ```ts
  /** Conditional Monday billing note (supersedes Spec A's flat note). */
  export function orderBillingNote(input: { needsInvoicing: boolean; pickFee: number }): string {
    const fee = `$${input.pickFee.toFixed(2)}`
    return input.needsInvoicing
      ? `Not paid — draft quote raised, invoice before dispatch. Pick fee ${fee}.`
      : `Prepaid — no Xero invoice required (pick fee ${fee} only).`
  }
  ```
- [ ] **Step 8: Run — expect PASS** (same command as Step 6).
- [ ] **Step 9: Build the per-line billing signal in submit.ts.** The catalogue-item fetch already exists (lines 405-409). Add `billing_mode` to that select:
  ```ts
  admin
    .from('b2b_catalogue_items')
    .select('id, source_product_id, moq_override, fulfilment_type_override, billing_mode')
    .in('source_product_id', productIds)
    .in('id', Array.from(grantedItemIds)),
  ```
  Widen the `catItemRows` row type (lines 415-420) with `billing_mode: 'invoice_on_dispatch' | 'prepaid' | null` and add:
  ```ts
  const billingModeByCatItemId = new Map(
    catItemRows.map((r) => [r.id, (r.billing_mode ?? 'invoice_on_dispatch') as BillingMode]),
  )
  // (import BillingMode from '@/lib/shop/billing-mode')
  const orderBillingLines = input.lines.map((l) => ({
    stocked: l.fulfilment_type === 'stocked',
    billingMode: l.catalogueItemId
      ? billingModeByCatItemId.get(l.catalogueItemId) ?? 'invoice_on_dispatch'
      : ('invoice_on_dispatch' as BillingMode),
  }))
  const needsInvoicing = orderNeedsInvoicing(orderBillingLines)
  ```
  (import `orderNeedsInvoicing` from `./order-billing`.) This block goes just after `catItemRows` is built (~line 421) so both the Monday and Xero steps can read `needsInvoicing`.
- [ ] **Step 10: Post the conditional note in the Monday push block.** Inside the successful Monday push `try` (after `mondayItemId = itemId`, ~line 1354), add (best-effort, mirroring the existing Xero manual-review note at line 1551):
  ```ts
  try {
    await postItemUpdate(itemId, orderBillingNote({ needsInvoicing, pickFee }))
  } catch (noteErr) {
    console.error('[Checkout] billing note failed (swallowed)', {
      orderId: order_id,
      err: noteErr instanceof Error ? noteErr.message : String(noteErr),
    })
  }
  ```
  `pickFee` is the order picking fee computed in the Xero task (Decision gate: fee scope). Import `orderBillingNote` from `@/lib/monday/billing-note`. **If Spec A's push-with-note flow already posts a flat note, replace that note's body with `orderBillingNote(...)` instead of adding a second update.**
- [ ] **Step 11: Run the submit test suite — expect PASS (no regressions):**
  `cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run lib/checkout/__tests__/submit.monday-push-failure.test.ts lib/checkout/order-billing.test.ts lib/monday/__tests__/billing-note.test.ts`
  Add a case to `submit.monday-push-failure.test.ts` (or a new `submit.billing-note.test.ts`) asserting `postItemUpdate` receives the "Prepaid …" body when all stocked lines are prepaid, and the "Not paid …" body otherwise.
- [ ] **Step 12: Commit.** `git commit -am "feat: order-level not-paid aggregation + conditional Monday billing note"`

---

### Task: Xero — every stock-on-hand order drafts; prepaid goods zeroed + pick-fee line

**Files:**
- Modify `/Users/jamierogangeorge/Documents/print-room-portal/lib/xero/eligibility.ts` (`XeroIneligibleReason` line 3-8; `XeroEligibilityInput` lines 11-22; `evaluateXeroEligibility` lines 35-42)
- Modify `/Users/jamierogangeorge/Documents/print-room-portal/lib/xero/__tests__/eligibility.test.ts` (the `drawsStock` cases, lines 18-20, 43-46, 48-52)
- Modify `/Users/jamierogangeorge/Documents/print-room-portal/lib/xero/draft-invoice.ts` (`XeroQuoteLineInput` lines 9-13; `buildLineFromQuoteItem` lines 123-135; `CreateDraftInvoiceArgs` lines 202-216; orchestrator eligibility call lines 235-241, line-build lines 287-308)
- Create `/Users/jamierogangeorge/Documents/print-room-portal/lib/xero/__tests__/pick-fee-and-prepaid.test.ts`
- Modify `/Users/jamierogangeorge/Documents/print-room-portal/lib/checkout/submit.ts` (Xero step 5c, lines 1521-1544)

**Interfaces:**
- Consumes: `orderNeedsInvoicing` / `needsInvoicing` + per-line billing signal (prior task); `pickingFeeForGoods`; the order goods subtotal (`repriced` total already computed in submit as `totalAmount`, line 1327).
- Produces: `buildPickFeeLine(feeNzd: number): XeroQuoteLineInput`; `prepaidZeroLine(line: XeroQuoteLineInput): XeroQuoteLineInput`; `XeroIneligibleReason` no longer includes `'draws_stock'`; `CreateDraftInvoiceArgs` gains `pickingFee: number` and `prepaidStockedLineKeys: Set<string>` (Decision gate on the matching mechanism).

> **Supersedes Spec A item 15 (Xero applies to every order).** Spec B refines it: EVERY stock-on-hand order now drafts (the old `draws_stock -> manual_review` block is removed); prepaid goods get a $0 line (100% discount) + a separate pick-fee line, not-paid goods get a normal draft quote.

- [ ] **Step 1: Rewrite the eligibility test for the new rule.** In `eligibility.test.ts`:
  - Remove `drawsStock` from the `base` fixture (line 10) and from every spread.
  - Delete the "flags any stock-draw order" case (lines 43-46).
  - Change the precedence case (lines 48-52) to drop `drawsStock` and end at `prepay_org` (Decision gate keeps prepay_org for now):
  ```ts
  it('precedence: disabled > already_drafted > test_org > prepay_org', () => {
    expect(evaluateXeroEligibility({
      xeroEnabled: true, existingInvoiceId: 'inv', isTestOrg: true, paymentTerms: 'prepay',
    })).toEqual({ eligible: false, reason: 'already_drafted' })
  })
  ```
  - Add a case proving stock-on-hand orders now draft:
  ```ts
  it('drafts a stock-on-hand order (draws_stock gate removed in Spec B)', () => {
    expect(evaluateXeroEligibility(base)).toEqual({ eligible: true, reason: 'ok' })
  })
  ```
- [ ] **Step 2: Run — expect FAIL:**
  `cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run lib/xero/__tests__/eligibility.test.ts`
  Expected: type/compile error on the removed `drawsStock` field and the deleted `'draws_stock'` reason.
- [ ] **Step 3: Drop draws_stock from eligibility.** In `eligibility.ts`: remove `'draws_stock'` from `XeroIneligibleReason` (line 3-8), remove `drawsStock` from `XeroEligibilityInput` (lines 20-21), and delete the `drawsStock` gate (line 40) from `evaluateXeroEligibility`. Update the doc comment (lines 29-34) to say stock-draw orders now draft with per-line prepaid handling.
- [ ] **Step 4: Run — expect PASS** (same command as Step 2).
- [ ] **Step 5: Write the failing pick-fee/prepaid line test.** Create `lib/xero/__tests__/pick-fee-and-prepaid.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { buildPickFeeLine, prepaidZeroLine } from '../draft-invoice'

  describe('Xero prepaid + pick-fee lines', () => {
    it('builds a single-unit pick-fee line', () => {
      expect(buildPickFeeLine(30)).toEqual({ description: 'Picking fee', quantity: 1, unitAmount: 30 })
    })
    it('zeroes a prepaid goods line (100% discount)', () => {
      const line = { description: 'Tee — Black / M', quantity: 24, unitAmount: 12.5 }
      expect(prepaidZeroLine(line)).toEqual({
        description: 'Tee — Black / M (prepaid — no charge)', quantity: 24, unitAmount: 0,
      })
    })
  })
  ```
- [ ] **Step 6: Run — expect FAIL:**
  `cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run lib/xero/__tests__/pick-fee-and-prepaid.test.ts`
  Expected: `buildPickFeeLine is not a function`.
- [ ] **Step 7: Implement the two pure helpers** in `draft-invoice.ts` (after `buildLineFromQuoteItem`, ~line 135):
  ```ts
  /** A separate Xero line for the NZ picking fee (billed once per order). */
  export function buildPickFeeLine(feeNzd: number): XeroQuoteLineInput {
    return { description: 'Picking fee', quantity: 1, unitAmount: feeNzd }
  }

  /** Zero a prepaid goods line (100% discount) while keeping it visible on the quote. */
  export function prepaidZeroLine(line: XeroQuoteLineInput): XeroQuoteLineInput {
    return { ...line, description: `${line.description} (prepaid — no charge)`, unitAmount: 0 }
  }
  ```
- [ ] **Step 8: Run — expect PASS** (same command as Step 6).
- [ ] **Step 9: Thread the fee + prepaid keys into the orchestrator.** In `CreateDraftInvoiceArgs` (lines 202-216): remove `drawsStock`, add `pickingFee: number` and `prepaidStockedLineKeys: Set<string>`. In `createDraftInvoiceForOrder`:
  - Update the `evaluateXeroEligibility(...)` call (lines 235-241) to drop `drawsStock`.
  - After the `lines` map (line 294), apply prepaid zeroing + append the pick-fee line:
  ```ts
  const itemRows2 = ((itemRows ?? []) as unknown as (QuoteItemForXero & {
    product_id: string; variant_id: string | null; size_id: number | null; qty_from_stock: number
  })[])
  const lines = itemRows2.map((row) => {
    const base = buildLineFromQuoteItem(row)
    const key = `${row.product_id}::${row.variant_id ?? ''}::${row.size_id ?? ''}`
    const isPrepaidStocked = row.qty_from_stock > 0 && args.prepaidStockedLineKeys.has(key)
    return isPrepaidStocked ? prepaidZeroLine(base) : base
  })
  if (args.pickingFee > 0) lines.push(buildPickFeeLine(args.pickingFee))
  ```
  Extend the `quote_items` select (lines 288-293) to include `product_id, variant_id, size_id, qty_from_stock` so the key + stock signal are available. (`qty_from_stock` exists on `quote_items` — migration `20260518120000`.)
  > **DECISION GATE (matching mechanism):** `prepaidStockedLineKeys` is an in-memory set passed from submit, keyed `product_id::variant_id::size_id` (matches `makeLineKey` without the trailing separators). Alternative: persist a `quote_items.billing_mode` snapshot column (needs a portal migration + shared-DB apply coordination). Confirm before finalizing the key format.
- [ ] **Step 10: Build the fee + prepaid set in submit.ts step 5c (lines 1521-1544).** Replace the `drawsStock` derivation with:
  ```ts
  const goodsSubtotal = repriced.reduce((t, l) => t + l.unit_price * l.qty, 0)
  const pickFee = pickingFeeForGoods(goodsSubtotal)   // import from '@/lib/pricing/picking-fee'
  const prepaidStockedLineKeys = new Set(
    orderBillingLines.length === input.lines.length
      ? input.lines.flatMap((l, i) =>
          l.fulfilment_type === 'stocked' && orderBillingLines[i].billingMode === 'prepaid'
            ? [`${l.product_id}::${l.variant_id ?? ''}::${l.size_id ?? ''}`]
            : [],
        )
      : [],
  )
  ```
  Pass `pickingFee: pickFee` and `prepaidStockedLineKeys` into `createDraftInvoiceForOrder(...)` and delete the `drawsStock` arg (lines 1522, 1540). `pickFee` is also the value handed to `orderBillingNote(...)` in the Monday task (single source of truth).
- [ ] **Step 11: Update the orchestrator's manual-review branch.** Since `draws_stock` is gone, only `prepay_org` (Decision gate) still routes to manual_review. Confirm `createDraftInvoiceForOrder`'s `elig.reason === 'prepay_org'` branch (line 245) still compiles after removing `'draws_stock'`.
- [ ] **Step 12: Run the Xero suite + submit Xero test — expect PASS:**
  `cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run lib/xero/ lib/checkout/__tests__/submit.roundtrip-regression.test.ts && npx tsc --noEmit`
  Fix any submit test that fed `drawsStock`/asserted `draws_stock` manual_review — update those to assert a drafted stock-on-hand order.
- [ ] **Step 13: Commit.** `git commit -am "feat: Xero drafts stock-on-hand orders; prepaid goods zeroed + pick-fee line"`

---

Cross-task sequencing: the **staff-default invite** ships first (Thursday). The `billing_mode` migration must apply before the staff-control and portal tasks read the column. The picking-fee band + `OrderBreakdown.pickingFee` are prerequisites for both the Xero pick-fee line and the Monday note's `pickFee`. The order-billing aggregation is shared by the Monday-note and Xero tasks (build it before wiring either). All P tasks assume Spec A's `orders.order_type`, push-with-note Monday flow, and order-placed notification abstraction are present (consumed by name).

---

<!-- ===== Spec B step 3 · Starshipit dispatch (item 12) · cluster: item-12-starshipit-dispatch ===== -->

## Item 12 — Starshipit dispatch integration (push-at-placement + portal-owned webhook)

Spec B, build-order 3. **Consumes from Spec A:** `orders.order_type` (delivery vs pickup/stock discriminator) and the `job_trackers` shell produced by `createJobTrackerShellForOrder` (which sets `job_reference = order_ref` and `quote_number = order_ref` — the reference the inbound webhook matches on). Everything below is **env-flagged (`STARSHIPIT_ENABLED`) and dark-by-default**, mirroring the Xero deploy-dark pattern (`lib/xero/config.ts`).

> ### Decision gate: Starshipit account ownership (BLOCKING — resolve before flipping `STARSHIPIT_ENABLED` on)
>
> Do **not** fabricate this choice. Two independent decisions must be made by a human:
>
> **1. Which Starshipit account does the portal push to?**
> - **Option A — Fresh portal-owned account.** Clean order-number namespace (portal `order_ref`), no collision with the 629 unmatched legacy rows. Cost: a second Starshipit subscription + separate carrier config.
> - **Option B — Consolidate onto the live "Print Room Dispatch" account.** Reuses existing carrier/label config. Risk: that account is **100% unmatched (629 rows keyed to old Shopify `#PR` numbers)**; the portal's `order_ref` namespace must not collide, and the studio's existing Monday-fed sync already writes to it.
>
> **2. Double-registration risk (must be resolved by the account choice).** The **studio** registers orders via `POST /api/orders/shipped` when a Monday tracking link appears (`print-room-studio/apps/job-tracker/lib/starshipit.js:61`). The **portal** will register at *placement* via `POST /api/orders`. If both target the same account, one order can be registered twice → duplicate manifest rows, duplicate webhooks, duplicate emails. Option A sidesteps this; Option B requires deciding which system owns registration.
>
> **3. Supersede vs supplement the Monday-fed pipe.** The portal webhook (final task) **always** writes `tracking_info` (additive = supplement — safe default shipped here). Whether it *also* flips `job_trackers.status → 'dispatched'` and sends `sendTrackerStatusEmail` is deferred behind this decision (a gated follow-up step, not built dark). Until decided, Monday remains the source of truth for `status`; Starshipit only enriches `tracking_info`.
>
> Record the outcome in the epic before enabling. All four build tasks below are safe to land dark regardless of the decision.

---

### Task: Starshipit config flag + eligibility (pure functions, mirror Xero)

**Files:**
- Create `/Users/jamierogangeorge/Documents/print-room-portal/lib/starshipit/config.ts`
- Create `/Users/jamierogangeorge/Documents/print-room-portal/lib/starshipit/eligibility.ts`
- Create `/Users/jamierogangeorge/Documents/print-room-portal/lib/starshipit/__tests__/eligibility.test.ts`

**Interfaces:**
- Consumes: nothing (leaf). Mirrors `isXeroEnabled()` / `evaluateXeroEligibility()` shape from `lib/xero/config.ts` + `lib/xero/eligibility.ts`.
- Produces:
  - `isStarshipitEnabled(): boolean`
  - `getStarshipitCredentials(): { apiKey: string; subscriptionKey: string }` (throws if either env var is absent)
  - `evaluateStarshipitEligibility(input: StarshipitEligibilityInput): { eligible: boolean; reason: StarshipitEligibilityReason }` where `StarshipitEligibilityInput = { enabled: boolean; intent: 'customer' | 'inventory'; isTestOrg: boolean; hasDeliveryAddress: boolean; orderType?: string | null }` and `StarshipitEligibilityReason = 'ok' | 'disabled' | 'test_org' | 'inventory_intent' | 'non_delivery_type' | 'no_address'`.

- [ ] **Step 1: Write the failing eligibility test.** Mirrors `lib/xero/__tests__/eligibility.test.ts`. Create `lib/starshipit/__tests__/eligibility.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { evaluateStarshipitEligibility, type StarshipitEligibilityInput } from '../eligibility'

  const base: StarshipitEligibilityInput = {
    enabled: true,
    intent: 'customer',
    isTestOrg: false,
    hasDeliveryAddress: true,
    orderType: null,
  }

  describe('evaluateStarshipitEligibility', () => {
    it('pushes a clean delivery order', () => {
      expect(evaluateStarshipitEligibility(base)).toEqual({ eligible: true, reason: 'ok' })
    })
    it('skips when the flag is off (checked first)', () => {
      expect(evaluateStarshipitEligibility({ ...base, enabled: false, isTestOrg: true }))
        .toEqual({ eligible: false, reason: 'disabled' })
    })
    it('skips test orgs (keep the real Starshipit account clean)', () => {
      expect(evaluateStarshipitEligibility({ ...base, isTestOrg: true }))
        .toEqual({ eligible: false, reason: 'test_org' })
    })
    it('skips inventory-intent orders (no customer delivery)', () => {
      expect(evaluateStarshipitEligibility({ ...base, intent: 'inventory' }))
        .toEqual({ eligible: false, reason: 'inventory_intent' })
    })
    it('skips non-delivery order types when Spec A order_type is present', () => {
      expect(evaluateStarshipitEligibility({ ...base, orderType: 'pickup' }))
        .toEqual({ eligible: false, reason: 'non_delivery_type' })
    })
    it('skips when there is no usable delivery address', () => {
      expect(evaluateStarshipitEligibility({ ...base, hasDeliveryAddress: false }))
        .toEqual({ eligible: false, reason: 'no_address' })
    })
    it('precedence: disabled > test_org > inventory_intent > non_delivery_type > no_address', () => {
      expect(evaluateStarshipitEligibility({
        enabled: true, isTestOrg: true, intent: 'inventory', hasDeliveryAddress: false, orderType: 'pickup',
      })).toEqual({ eligible: false, reason: 'test_org' })
    })
  })
  ```
- [ ] **Step 2: Run it — expect FAIL (module missing).**
  ```
  cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run lib/starshipit/__tests__/eligibility.test.ts
  ```
  Expected: `Failed to resolve import "../eligibility"` (no such file yet).
- [ ] **Step 3: Create `lib/starshipit/eligibility.ts` (minimal).**
  ```ts
  // lib/starshipit/eligibility.ts

  export type StarshipitIneligibleReason =
    | 'disabled'
    | 'test_org'
    | 'inventory_intent'
    | 'non_delivery_type'
    | 'no_address'
  export type StarshipitEligibilityReason = 'ok' | StarshipitIneligibleReason

  export interface StarshipitEligibilityInput {
    /** isStarshipitEnabled() result. */
    enabled: boolean
    /** CheckoutInput.intent — 'inventory' orders never ship to a customer. */
    intent: 'customer' | 'inventory'
    /** organizations.is_test. */
    isTestOrg: boolean
    /** True when the resolved shipping address has at least street + city. */
    hasDeliveryAddress: boolean
    /**
     * orders.order_type (Spec A). When provided, only 'delivery' pushes; other
     * types skip. Optional until Spec A threads it into submit — interim callers
     * pass null and rely on `intent`.
     */
    orderType?: string | null
  }

  export interface StarshipitEligibility {
    eligible: boolean
    reason: StarshipitEligibilityReason
  }

  /**
   * Push to Starshipit iff ALL hold: feature on, not a test org, not an
   * inventory-intent order, a delivery order_type (when known), and a usable
   * address. Order of checks defines precedence (see test).
   */
  export function evaluateStarshipitEligibility(
    input: StarshipitEligibilityInput,
  ): StarshipitEligibility {
    if (!input.enabled) return { eligible: false, reason: 'disabled' }
    if (input.isTestOrg) return { eligible: false, reason: 'test_org' }
    if (input.intent === 'inventory') return { eligible: false, reason: 'inventory_intent' }
    if (input.orderType != null && input.orderType !== 'delivery')
      return { eligible: false, reason: 'non_delivery_type' }
    if (!input.hasDeliveryAddress) return { eligible: false, reason: 'no_address' }
    return { eligible: true, reason: 'ok' }
  }
  ```
- [ ] **Step 4: Create `lib/starshipit/config.ts` (mirrors `isXeroEnabled` + studio `getHeaders` cred read).**
  ```ts
  // lib/starshipit/config.ts

  export interface StarshipitCredentials {
    apiKey: string
    subscriptionKey: string
  }

  /** Deploy-dark rollout flag. Truthy = attempt Starshipit push/inbound. */
  export function isStarshipitEnabled(): boolean {
    const v = (process.env.STARSHIPIT_ENABLED ?? '').trim().toLowerCase()
    return v === '1' || v === 'true' || v === 'on' || v === 'yes'
  }

  /**
   * Read + validate Starshipit credentials. Throws if absent. Mirrors the studio
   * getHeaders() env contract (STARSHIPIT_API_KEY + STARSHIPIT_SUBSCRIPTION_KEY).
   */
  export function getStarshipitCredentials(): StarshipitCredentials {
    const apiKey = process.env.STARSHIPIT_API_KEY ?? ''
    const subscriptionKey = process.env.STARSHIPIT_SUBSCRIPTION_KEY ?? ''
    if (!apiKey || !subscriptionKey) {
      throw new Error(
        'Missing Starshipit credentials. Set STARSHIPIT_API_KEY and STARSHIPIT_SUBSCRIPTION_KEY.',
      )
    }
    return { apiKey, subscriptionKey }
  }
  ```
- [ ] **Step 5: Run — expect PASS.**
  ```
  cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run lib/starshipit/__tests__/eligibility.test.ts
  ```
  Expected: `7 passed`.
- [ ] **Step 6: Commit.**
  ```
  git add lib/starshipit/config.ts lib/starshipit/eligibility.ts lib/starshipit/__tests__/eligibility.test.ts
  git commit -m "feat: Starshipit config flag + push eligibility (dark)"
  ```

---

### Task: Starshipit API client (create-order at placement)

**Files:**
- Create `/Users/jamierogangeorge/Documents/print-room-portal/lib/starshipit/client.ts`
- Create `/Users/jamierogangeorge/Documents/print-room-portal/lib/starshipit/__tests__/client.test.ts`

**Interfaces:**
- Consumes: `getStarshipitCredentials()` (from *Starshipit config flag + eligibility* task); `NormalizedShippingAddress` type from `lib/checkout/shipping-address.ts` (fields: `name?, email?, phone?, company?, street?, city?, state?, country?, postalCode?`).
- Produces: `createStarshipitOrder(args: { orderNumber: string; address: NormalizedShippingAddress; customerEmail: string | null }): Promise<string | null>` — returns the Starshipit order id string, or `null` on a handled non-2xx.
- **Grounding note:** auth headers + `BASE_URL` are copied verbatim from the verified studio client. The `POST /api/orders` create-order payload/response shape is **not** verifiable in-repo (studio only calls `/api/orders/shipped` + `/api/track`) — see Decision gate uncertainty. Kept dark-by-default so it never runs in prod until confirmed.

- [ ] **Step 1: Write the failing client test.** Create `lib/starshipit/__tests__/client.test.ts`:
  ```ts
  import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
  import { createStarshipitOrder } from '../client'
  import type { NormalizedShippingAddress } from '@/lib/checkout/shipping-address'

  const OK_ADDRESS: NormalizedShippingAddress = {
    name: 'Anytime Fitness Newmarket',
    street: '12 Example St',
    city: 'Auckland',
    state: '',
    postalCode: '1023',
    country: 'New Zealand',
    phone: '0211234567',
  }

  describe('createStarshipitOrder', () => {
    beforeEach(() => {
      process.env.STARSHIPIT_API_KEY = 'k'
      process.env.STARSHIPIT_SUBSCRIPTION_KEY = 's'
    })
    afterEach(() => vi.restoreAllMocks())

    it('POSTs order_number + destination and returns the order id', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, order: { order_id: 987 } }),
      })
      vi.stubGlobal('fetch', fetchMock)

      const id = await createStarshipitOrder({
        orderNumber: 'PR-1001',
        address: OK_ADDRESS,
        customerEmail: 'jamie@theprint-room.co.nz',
      })

      expect(id).toBe('987')
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }]
      expect(url).toBe('https://api.starshipit.com/api/orders')
      expect(init.headers['StarShipIT-Api-Key']).toBe('k')
      expect(init.headers['Ocp-Apim-Subscription-Key']).toBe('s')
      const sent = JSON.parse(init.body as string)
      expect(sent.order.order_number).toBe('PR-1001')
      expect(sent.order.destination.post_code).toBe('1023')
      expect(sent.order.destination.email).toBe('jamie@theprint-room.co.nz')
    })

    it('returns null on a non-ok Starshipit response', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false, json: async () => ({ success: false }),
      }))
      const id = await createStarshipitOrder({ orderNumber: 'PR-2', address: OK_ADDRESS, customerEmail: null })
      expect(id).toBeNull()
    })
  })
  ```
- [ ] **Step 2: Run — expect FAIL.**
  ```
  cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run lib/starshipit/__tests__/client.test.ts
  ```
  Expected: `Failed to resolve import "../client"`.
- [ ] **Step 3: Create `lib/starshipit/client.ts`.**
  ```ts
  // lib/starshipit/client.ts
  import { getStarshipitCredentials } from './config'
  import type { NormalizedShippingAddress } from '@/lib/checkout/shipping-address'

  const BASE_URL = 'https://api.starshipit.com'

  /** Auth headers — copied from print-room-studio/apps/job-tracker/lib/starshipit.js getHeaders(). */
  function getHeaders(): Record<string, string> {
    const { apiKey, subscriptionKey } = getStarshipitCredentials()
    return {
      'StarShipIT-Api-Key': apiKey,
      'Ocp-Apim-Subscription-Key': subscriptionKey,
      'Content-Type': 'application/json',
    }
  }

  export interface CreateStarshipitOrderArgs {
    /** order_ref — also the job_trackers.job_reference the webhook matches on. */
    orderNumber: string
    address: NormalizedShippingAddress
    customerEmail: string | null
  }

  /**
   * Register an UNSHIPPED order in Starshipit at placement, carrying delivery
   * details only (no tracking number yet). When staff later mark it Shipped in
   * Starshipit, the carrier tracking number flows back via the portal webhook.
   *
   * Endpoint: POST /api/orders. NB the studio only exercises POST
   * /api/orders/shipped (needs an existing tracking_number); the create-order
   * destination field names + response path below MUST be confirmed against
   * Starshipit's live API docs before STARSHIPIT_ENABLED is turned on
   * (see Decision gate). Dark-by-default guarantees this never runs in prod first.
   *
   * @returns Starshipit order id string, or null on a handled non-2xx.
   */
  export async function createStarshipitOrder(
    args: CreateStarshipitOrderArgs,
  ): Promise<string | null> {
    const a = args.address
    const payload = {
      order: {
        order_number: args.orderNumber,
        destination: {
          name: a.name ?? '',
          street: a.street ?? '',
          suburb: a.city ?? '',
          state: a.state ?? '',
          post_code: a.postalCode ?? '',
          country: a.country ?? 'New Zealand',
          phone: a.phone ?? '',
          email: args.customerEmail ?? a.email ?? '',
          company: a.company ?? '',
        },
      },
    }

    const response = await fetch(`${BASE_URL}/api/orders`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(payload),
    })
    const data = (await response.json().catch(() => ({}))) as {
      success?: boolean
      order?: { order_id?: number | string }
    }
    if (!response.ok || !data.success) {
      console.error('[starshipit] createStarshipitOrder failed:', response.status, JSON.stringify(data))
      return null
    }
    return data.order?.order_id != null ? String(data.order.order_id) : null
  }
  ```
- [ ] **Step 4: Run — expect PASS.**
  ```
  cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run lib/starshipit/__tests__/client.test.ts
  ```
  Expected: `2 passed`.
- [ ] **Step 5: Commit.**
  ```
  git add lib/starshipit/client.ts lib/starshipit/__tests__/client.test.ts
  git commit -m "feat: Starshipit create-order client (dark)"
  ```

---

### Task: Push-at-placement orchestrator + wire into checkout submit

**Files:**
- Create `/Users/jamierogangeorge/Documents/print-room-portal/lib/starshipit/push-order.ts`
- Modify `/Users/jamierogangeorge/Documents/print-room-portal/lib/audit/actions.ts` (add three `ORDER_STARSHIPIT_*` entries at lines 12-14, after the Xero actions)
- Modify `/Users/jamierogangeorge/Documents/print-room-portal/lib/checkout/submit.ts` (add import near line 16; insert step 5d between the Xero block's close and the email-payload fetch, currently lines 1581-1583)
- Create `/Users/jamierogangeorge/Documents/print-room-portal/lib/starshipit/__tests__/push-order.test.ts`

**Interfaces:**
- Consumes: `isStarshipitEnabled()`, `evaluateStarshipitEligibility()` (from config/eligibility task); `createStarshipitOrder()` (from client task); `normalizeShippingAddress()` from `lib/checkout/shipping-address.ts`; `recordAuditEvent(args, admin)` from `lib/audit/recordEvent.ts` (`args = { orgId, actorUserId, action, targetType, targetId, metadata }`). In submit.ts, consumes the in-scope locals `order_id`, `order_ref`, `quote_id`, `shippingAddress`, `input.intent`, `input.context.{organizationId,userId,email}`.
- Produces: `pushOrderToStarshipit(admin: SupabaseClient, args: PushOrderToStarshipitArgs): Promise<{ status: 'pushed' | 'skipped'; reason: string; starshipitOrderId?: string }>`; `AUDIT_ACTIONS.ORDER_STARSHIPIT_PUSHED | ORDER_STARSHIPIT_SKIPPED | ORDER_STARSHIPIT_PUSH_FAILED`. Contract: **throws** on a Starshipit/DB error (caller wraps + audits); never rolls back the order — identical to `createDraftInvoiceForOrder`.

- [ ] **Step 1: Add the audit actions.** In `lib/audit/actions.ts`, current lines 12-14:
  ```ts
    ORDER_XERO_DRAFTED: 'order.xero_drafted',
    ORDER_XERO_MANUAL_REVIEW: 'order.xero_manual_review',
    ORDER_XERO_DRAFT_FAILED: 'order.xero_draft_failed',
  ```
  becomes:
  ```ts
    ORDER_XERO_DRAFTED: 'order.xero_drafted',
    ORDER_XERO_MANUAL_REVIEW: 'order.xero_manual_review',
    ORDER_XERO_DRAFT_FAILED: 'order.xero_draft_failed',
    ORDER_STARSHIPIT_PUSHED: 'order.starshipit_pushed',
    ORDER_STARSHIPIT_SKIPPED: 'order.starshipit_skipped',
    ORDER_STARSHIPIT_PUSH_FAILED: 'order.starshipit_push_failed',
  ```
- [ ] **Step 2: Write the failing orchestrator test.** Create `lib/starshipit/__tests__/push-order.test.ts` (stubs the client + a minimal admin whose `recordAuditEvent` insert is a no-op):
  ```ts
  import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

  vi.mock('../client', () => ({ createStarshipitOrder: vi.fn() }))
  vi.mock('@/lib/audit/recordEvent', () => ({ recordAuditEvent: vi.fn().mockResolvedValue(undefined) }))

  import { pushOrderToStarshipit } from '../push-order'
  import { createStarshipitOrder } from '../client'

  const admin = {} as never // recordEvent is mocked, so admin is never dereferenced

  const baseArgs = {
    orderId: 'o1',
    orderRef: 'PR-1001',
    organizationId: 'org1',
    actorUserId: 'u1',
    intent: 'customer' as const,
    isTestOrg: false,
    customerEmail: 'jamie@theprint-room.co.nz',
    shippingAddress: { name: 'AF', street: '12 Example St', city: 'Auckland', postcode: '1023', country: 'New Zealand' },
  }

  describe('pushOrderToStarshipit', () => {
    beforeEach(() => { process.env.STARSHIPIT_ENABLED = 'true' })
    afterEach(() => { vi.clearAllMocks(); delete process.env.STARSHIPIT_ENABLED })

    it('skips (does not call the client) when the flag is off', async () => {
      process.env.STARSHIPIT_ENABLED = ''
      const r = await pushOrderToStarshipit(admin, baseArgs)
      expect(r).toEqual({ status: 'skipped', reason: 'disabled' })
      expect(createStarshipitOrder).not.toHaveBeenCalled()
    })

    it('skips inventory-intent orders', async () => {
      const r = await pushOrderToStarshipit(admin, { ...baseArgs, intent: 'inventory' })
      expect(r.status).toBe('skipped')
      expect(r.reason).toBe('inventory_intent')
    })

    it('pushes and returns the starshipit order id', async () => {
      ;(createStarshipitOrder as unknown as ReturnType<typeof vi.fn>).mockResolvedValue('987')
      const r = await pushOrderToStarshipit(admin, baseArgs)
      expect(r).toEqual({ status: 'pushed', reason: 'ok', starshipitOrderId: '987' })
    })

    it('throws when the client returns null (caller audits the failure)', async () => {
      ;(createStarshipitOrder as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null)
      await expect(pushOrderToStarshipit(admin, baseArgs)).rejects.toThrow(/no order id/)
    })
  })
  ```
- [ ] **Step 3: Run — expect FAIL.**
  ```
  cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run lib/starshipit/__tests__/push-order.test.ts
  ```
  Expected: `Failed to resolve import "../push-order"`.
- [ ] **Step 4: Create `lib/starshipit/push-order.ts`.** Mirrors `createDraftInvoiceForOrder`'s throw-and-audit contract.
  ```ts
  // lib/starshipit/push-order.ts
  import type { SupabaseClient } from '@supabase/supabase-js'
  import { recordAuditEvent } from '@/lib/audit/recordEvent'
  import { AUDIT_ACTIONS } from '@/lib/audit/actions'
  import { normalizeShippingAddress } from '@/lib/checkout/shipping-address'
  import { isStarshipitEnabled } from './config'
  import { evaluateStarshipitEligibility } from './eligibility'
  import { createStarshipitOrder } from './client'

  export interface PushOrderToStarshipitArgs {
    orderId: string
    orderRef: string
    organizationId: string
    actorUserId: string | null
    intent: 'customer' | 'inventory'
    isTestOrg: boolean
    customerEmail: string | null
    shippingAddress: Record<string, unknown> | null
    /** orders.order_type (Spec A) once threaded into submit; null in the interim. */
    orderType?: string | null
  }

  export interface PushOrderResult {
    status: 'pushed' | 'skipped'
    reason: string
    starshipitOrderId?: string
  }

  /**
   * Register the order in Starshipit at placement, or skip. Best-effort: THROWS
   * on a Starshipit/DB error so the caller (submit.ts step 5d) audits
   * ORDER_STARSHIPIT_PUSH_FAILED. Never rolls back the order — mirrors
   * createDraftInvoiceForOrder.
   */
  export async function pushOrderToStarshipit(
    admin: SupabaseClient,
    args: PushOrderToStarshipitArgs,
  ): Promise<PushOrderResult> {
    const address = normalizeShippingAddress(args.shippingAddress)
    const hasDeliveryAddress = Boolean(address?.street && address?.city)

    const elig = evaluateStarshipitEligibility({
      enabled: isStarshipitEnabled(),
      intent: args.intent,
      isTestOrg: args.isTestOrg,
      hasDeliveryAddress,
      orderType: args.orderType ?? null,
    })
    if (!elig.eligible) return { status: 'skipped', reason: elig.reason }

    const starshipitOrderId = await createStarshipitOrder({
      orderNumber: args.orderRef,
      address: address!,
      customerEmail: args.customerEmail,
    })
    if (!starshipitOrderId) throw new Error('Starshipit create-order returned no order id')

    await recordAuditEvent(
      {
        orgId: args.organizationId,
        actorUserId: args.actorUserId,
        action: AUDIT_ACTIONS.ORDER_STARSHIPIT_PUSHED,
        targetType: 'order',
        targetId: args.orderId,
        metadata: { order_ref: args.orderRef, starshipit_order_id: starshipitOrderId },
      },
      admin,
    )

    return { status: 'pushed', reason: 'ok', starshipitOrderId }
  }
  ```
- [ ] **Step 5: Run — expect PASS.**
  ```
  cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run lib/starshipit/__tests__/push-order.test.ts
  ```
  Expected: `4 passed`.
- [ ] **Step 6: Add the submit.ts import.** In `lib/checkout/submit.ts` after line 16 (`import { createDraftInvoiceForOrder } from '@/lib/xero/draft-invoice'`), add:
  ```ts
  import { pushOrderToStarshipit } from '@/lib/starshipit/push-order'
  ```
- [ ] **Step 7: Insert step 5d into submit.ts.** The Xero block ends (current lines 1578-1583):
  ```ts
      } catch {
        // truly best-effort
      }
    }

    // Fetch the email payload from quotes/quote_items for the confirmation email below.
  ```
  Insert the new block between the closing `}` (line 1581) and the comment (line 1583):
  ```ts
      } catch {
        // truly best-effort
      }
    }

    // 5d. Best-effort Starshipit push-at-placement. Registers an UNSHIPPED order
    //     carrying delivery details so staff can generate the label + tracking in
    //     Starshipit; the portal webhook writes the tracking link back onto the
    //     job_trackers row. Dark by default (STARSHIPIT_ENABLED). Mirrors the
    //     Monday/Xero side-effects: never throws out of submit, audits on failure.
    try {
      const { data: ssOrgRow } = await admin
        .from('organizations')
        .select('is_test')
        .eq('id', input.context.organizationId)
        .maybeSingle()
      const ssIsTestOrg = Boolean((ssOrgRow as { is_test?: boolean } | null)?.is_test)

      const ssResult = await pushOrderToStarshipit(admin, {
        orderId: order_id,
        orderRef: order_ref,
        organizationId: input.context.organizationId,
        actorUserId: input.context.userId,
        intent: input.intent ?? 'customer',
        isTestOrg: ssIsTestOrg,
        customerEmail: input.context.email ?? null,
        shippingAddress,
        // orderType: threaded once Spec A exposes orders.order_type at submit.
      })
      if (ssResult.status === 'skipped') {
        await recordAuditEvent(
          {
            orgId: input.context.organizationId,
            actorUserId: input.context.userId,
            action: AUDIT_ACTIONS.ORDER_STARSHIPIT_SKIPPED,
            targetType: 'order',
            targetId: order_id,
            metadata: { order_ref, reason: ssResult.reason },
          },
          admin,
        )
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      console.error('[Checkout] Starshipit push failed (swallowed)', { orderId: order_id, err: message })
      try {
        await recordAuditEvent(
          {
            orgId: input.context.organizationId,
            actorUserId: input.context.userId,
            action: AUDIT_ACTIONS.ORDER_STARSHIPIT_PUSH_FAILED,
            targetType: 'order',
            targetId: order_id,
            metadata: { order_ref, quote_id, error: message },
          },
          admin,
        )
      } catch {
        // truly best-effort
      }
    }

    // Fetch the email payload from quotes/quote_items for the confirmation email below.
  ```
  (`recordAuditEvent` and `AUDIT_ACTIONS` are already imported at the top of submit.ts — lines 6-7 — so no new import beyond step 6.)
- [ ] **Step 8: Typecheck + full-suite the touched dirs — expect PASS.**
  ```
  cd /Users/jamierogangeorge/Documents/print-room-portal && npx tsc --noEmit && npx vitest run lib/starshipit lib/checkout
  ```
  Expected: tsc clean; all Starshipit + existing checkout tests pass (the submit.ts change is additive + dark, so existing checkout tests are unaffected).
- [ ] **Step 9: Commit.**
  ```
  git add lib/audit/actions.ts lib/checkout/submit.ts lib/starshipit/push-order.ts lib/starshipit/__tests__/push-order.test.ts
  git commit -m "feat: push order to Starshipit at placement (dark, best-effort)"
  ```

---

### Task: Portal-owned Starshipit webhook (write tracking back onto the tracker)

**Files:**
- Create `/Users/jamierogangeorge/Documents/print-room-portal/lib/starshipit/status.ts`
- Create `/Users/jamierogangeorge/Documents/print-room-portal/lib/starshipit/apply-webhook.ts`
- Create `/Users/jamierogangeorge/Documents/print-room-portal/lib/starshipit/verify-webhook.ts`
- Create `/Users/jamierogangeorge/Documents/print-room-portal/lib/starshipit/__tests__/apply-webhook.test.ts`
- Create `/Users/jamierogangeorge/Documents/print-room-portal/lib/starshipit/__tests__/verify-webhook.test.ts`
- Create `/Users/jamierogangeorge/Documents/print-room-portal/app/api/webhooks/starshipit/route.ts`
- Create `/Users/jamierogangeorge/Documents/print-room-portal/supabase/migrations/20260715000000_starshipit_webhook_logs.sql`

**Interfaces:**
- Consumes: `TrackingInfo` + `ProductionUpdate` types from `lib/job-tracker.ts` (`TrackingInfo = { number?, trackingNumber?, url?, carrier?, changed_at?, updated_at? }`; `ProductionUpdate = { id, type: 'status'|'note'|'tracking'|'milestone'|'media', title, body, changed_at, source: 'system'|'user', metadata? }`); `getSupabaseServer()` from `@/lib/supabase`; `cacheTags.orderTracker` from `@/lib/cache/tags`; the `job_trackers` shell's `job_reference`/`quote_number`/`tracker_token` (from `createJobTrackerShellForOrder`, set to `order_ref`).
- Produces:
  - `mapStarshipitStatus(status: string | undefined): { label: string; category: string }`
  - `applyStarshipitWebhook(existing: TrackingInfo | null, payload: StarshipitWebhookPayload): { trackingInfo: TrackingInfo; productionUpdate: ProductionUpdate }` where `StarshipitWebhookPayload = { order_number?, tracking_number?, tracking_status?, carrier_name?, carrier_service?, shipment_date?, tracking_url?, last_updated_date? }`
  - `verifyStarshipitWebhookSecret(input: { configuredSecret: string | undefined; querySecret: string | null; headerSecret: string | null }): boolean`
  - `POST /api/webhooks/starshipit`, `GET /api/webhooks/starshipit`
- **Scope (supplement, per Decision gate):** the route **only** writes `tracking_info` + appends a `'tracking'` production_update + logs. It deliberately does **not** flip `job_trackers.status` or send `sendTrackerStatusEmail` — that is the "supersede vs supplement" decision, left as a gated follow-up.

- [ ] **Step 1: Write the failing `verify-webhook` test.** Create `lib/starshipit/__tests__/verify-webhook.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { verifyStarshipitWebhookSecret } from '../verify-webhook'

  describe('verifyStarshipitWebhookSecret', () => {
    it('fails closed when no secret is configured (dark by default)', () => {
      expect(verifyStarshipitWebhookSecret({ configuredSecret: undefined, querySecret: 'x', headerSecret: null })).toBe(false)
    })
    it('accepts a matching query secret', () => {
      expect(verifyStarshipitWebhookSecret({ configuredSecret: 's3cret', querySecret: 's3cret', headerSecret: null })).toBe(true)
    })
    it('accepts a matching header secret', () => {
      expect(verifyStarshipitWebhookSecret({ configuredSecret: 's3cret', querySecret: null, headerSecret: 's3cret' })).toBe(true)
    })
    it('rejects a mismatch', () => {
      expect(verifyStarshipitWebhookSecret({ configuredSecret: 's3cret', querySecret: 'nope', headerSecret: null })).toBe(false)
    })
  })
  ```
- [ ] **Step 2: Write the failing `apply-webhook` test.** Create `lib/starshipit/__tests__/apply-webhook.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { applyStarshipitWebhook } from '../apply-webhook'

  describe('applyStarshipitWebhook', () => {
    it('folds tracking number/url/carrier into tracking_info and emits a tracking update', () => {
      const { trackingInfo, productionUpdate } = applyStarshipitWebhook(
        { carrier: 'NZ Post' },
        {
          order_number: 'PR-1001',
          tracking_number: '00794210392709818080',
          tracking_url: 'https://www.nzpost.co.nz/tools/tracking/item/00794210392709818080',
          carrier_name: 'CourierPost',
          tracking_status: 'Dispatched',
          last_updated_date: '2026-07-15T02:00:00.000Z',
        },
      )
      expect(trackingInfo.trackingNumber).toBe('00794210392709818080')
      expect(trackingInfo.number).toBe('00794210392709818080')
      expect(trackingInfo.url).toContain('nzpost.co.nz')
      expect(trackingInfo.carrier).toBe('CourierPost')
      expect(trackingInfo.updated_at).toBe('2026-07-15T02:00:00.000Z')
      expect(productionUpdate.type).toBe('tracking')
      expect(productionUpdate.title).toBe('Dispatched')
      expect(productionUpdate.metadata?.source).toBe('starshipit')
    })

    it('preserves existing fields when the payload omits them', () => {
      const { trackingInfo } = applyStarshipitWebhook(
        { number: 'X', trackingNumber: 'X', url: 'u', carrier: 'NZ Post' },
        { tracking_status: 'InTransit' },
      )
      expect(trackingInfo.carrier).toBe('NZ Post')
      expect(trackingInfo.trackingNumber).toBe('X')
      expect(trackingInfo.url).toBe('u')
    })
  })
  ```
- [ ] **Step 3: Run both — expect FAIL.**
  ```
  cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run lib/starshipit/__tests__/verify-webhook.test.ts lib/starshipit/__tests__/apply-webhook.test.ts
  ```
  Expected: `Failed to resolve import "../verify-webhook"` / `"../apply-webhook"`.
- [ ] **Step 4: Create `lib/starshipit/status.ts`** (mirrors the studio `STATUS_MAP`, portal-scoped):
  ```ts
  // lib/starshipit/status.ts
  // Mirrors print-room-studio/apps/job-tracker/lib/starshipit.js STATUS_MAP.
  const STATUS_MAP: Record<string, { label: string; category: string }> = {
    Printed: { label: 'Label Printed', category: 'pre-transit' },
    Dispatched: { label: 'Dispatched', category: 'in-transit' },
    InTransit: { label: 'In Transit', category: 'in-transit' },
    OutForDelivery: { label: 'Out for Delivery', category: 'out-for-delivery' },
    Delivered: { label: 'Delivered', category: 'delivered' },
    PickupInStore: { label: 'Ready for Pickup', category: 'delivered' },
    AttemptedDelivery: { label: 'Delivery Attempted', category: 'exception' },
    Exception: { label: 'Exception', category: 'exception' },
    AwaitingCollection: { label: 'Awaiting Collection', category: 'in-transit' },
    Cancelled: { label: 'Cancelled', category: 'cancelled' },
  }

  export function mapStarshipitStatus(status: string | undefined): { label: string; category: string } {
    return (status && STATUS_MAP[status]) || { label: status || 'Unknown', category: 'unknown' }
  }
  ```
- [ ] **Step 5: Create `lib/starshipit/verify-webhook.ts`.**
  ```ts
  // lib/starshipit/verify-webhook.ts

  /**
   * Validate the shared secret Starshipit sends via ?secret= or the
   * X-Starshipit-Secret / X-Starshipit-Hmac header. Fail-closed: when
   * STARSHIPIT_WEBHOOK_SECRET is unset the webhook is OFF (returns false) — the
   * dark-by-default switch for inbound. Mirrors the studio receiver's secret
   * check, but fail-closed instead of skip-when-unset.
   */
  export function verifyStarshipitWebhookSecret(input: {
    configuredSecret: string | undefined
    querySecret: string | null
    headerSecret: string | null
  }): boolean {
    if (!input.configuredSecret) return false
    const incoming = input.querySecret || input.headerSecret
    return incoming === input.configuredSecret
  }
  ```
- [ ] **Step 6: Create `lib/starshipit/apply-webhook.ts`** (pure merge; portal-typed; drops studio-only fields the portal `TrackingInfo` doesn't declare):
  ```ts
  // lib/starshipit/apply-webhook.ts
  import { randomUUID } from 'node:crypto'
  import type { TrackingInfo, ProductionUpdate } from '@/lib/job-tracker'
  import { mapStarshipitStatus } from './status'

  export interface StarshipitWebhookPayload {
    order_number?: string
    tracking_number?: string
    tracking_status?: string
    carrier_name?: string
    carrier_service?: string
    shipment_date?: string
    tracking_url?: string
    last_updated_date?: string
  }

  export interface AppliedStarshipitWebhook {
    trackingInfo: TrackingInfo
    productionUpdate: ProductionUpdate
  }

  /**
   * Pure merge: fold a Starshipit webhook payload into the tracker's existing
   * tracking_info and produce a 'tracking' production_updates entry to append.
   * Mirrors the studio receiver's updatedTracking + trackingUpdate objects, but
   * stays inside the portal TrackingInfo shape (number/trackingNumber/url/carrier).
   */
  export function applyStarshipitWebhook(
    existing: TrackingInfo | null,
    payload: StarshipitWebhookPayload,
  ): AppliedStarshipitWebhook {
    const prev = existing ?? {}
    const statusInfo = mapStarshipitStatus(payload.tracking_status)
    const nowIso = payload.last_updated_date || new Date().toISOString()

    const trackingInfo: TrackingInfo = {
      ...prev,
      number: payload.tracking_number || prev.number,
      trackingNumber: payload.tracking_number || prev.trackingNumber,
      url: payload.tracking_url || prev.url,
      carrier: payload.carrier_name || prev.carrier,
      updated_at: nowIso,
    }

    const productionUpdate: ProductionUpdate = {
      id: randomUUID(),
      type: 'tracking',
      title: statusInfo.label,
      body: `Shipment status: ${statusInfo.label}` +
        `${payload.carrier_name ? ` via ${payload.carrier_name}` : ''}` +
        `${payload.tracking_number ? ` (${payload.tracking_number})` : ''}`,
      changed_at: nowIso,
      source: 'system',
      metadata: {
        source: 'starshipit',
        tracking_status: payload.tracking_status,
        carrier_name: payload.carrier_name,
        tracking_number: payload.tracking_number,
      },
    }

    return { trackingInfo, productionUpdate }
  }
  ```
- [ ] **Step 7: Run the two pure-helper tests — expect PASS.**
  ```
  cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run lib/starshipit/__tests__/verify-webhook.test.ts lib/starshipit/__tests__/apply-webhook.test.ts
  ```
  Expected: `6 passed`.
- [ ] **Step 8: Create the migration.** `supabase/migrations/20260715000000_starshipit_webhook_logs.sql` (mirrors `print-room-studio/sql/010-create-starshipit-webhook-logs.sql`; `IF NOT EXISTS` because the shared Supabase project may already carry the table — **verify with `list_tables` before applying**, see Decision gate):
  ```sql
  -- Portal-owned Starshipit webhook log. Mirrors the studio schema
  -- (print-room-studio/sql/010-create-starshipit-webhook-logs.sql). IF NOT EXISTS
  -- because portal + studio share one Supabase project and the table may already
  -- exist from the studio integration — verify before applying.
  create table if not exists public.starshipit_webhook_logs (
    id uuid primary key default gen_random_uuid(),
    order_number text,
    tracking_number text,
    tracking_status text,
    carrier_name text,
    carrier_service text,
    payload jsonb,
    matched_job_tracker_id bigint,
    status text not null default 'received',
    error text,
    created_at timestamptz not null default now(),
    processed_at timestamptz
  );

  create index if not exists idx_starshipit_webhook_logs_order
    on public.starshipit_webhook_logs (order_number);
  create index if not exists idx_starshipit_webhook_logs_tracking
    on public.starshipit_webhook_logs (tracking_number);
  ```
  **Decision gate step (do not auto-apply):** confirm whether the shared DB already has `starshipit_webhook_logs` (studio-created). If yes, this migration is a no-op record-keeper; if no, apply it. Either way it is safe (idempotent).
- [ ] **Step 9: Create the webhook route.** `app/api/webhooks/starshipit/route.ts` — matches on the portal's own reference first (`order_number` == `job_reference`/`quote_number`/`tracker_token`), then a clean tracking-number match; writes via `applyStarshipitWebhook`; logs; revalidates the order-tracker cache tag. Uses the same `getSupabaseServer` + `cacheTags` + `revalidateTag` conventions as `app/api/webhooks/monday/tracker-status/route.ts`.
  ```ts
  // app/api/webhooks/starshipit/route.ts
  import { NextResponse } from 'next/server'
  import { revalidateTag } from 'next/cache'
  import { getSupabaseServer } from '@/lib/supabase'
  import { cacheTags } from '@/lib/cache/tags'
  import type { TrackingInfo, ProductionUpdate } from '@/lib/job-tracker'
  import { verifyStarshipitWebhookSecret } from '@/lib/starshipit/verify-webhook'
  import {
    applyStarshipitWebhook,
    type StarshipitWebhookPayload,
  } from '@/lib/starshipit/apply-webhook'

  const JOB_SELECT =
    'id, tracker_token, job_reference, quote_number, tracking_info, production_updates'

  type TrackerRow = {
    id: string | number
    tracker_token: string
    job_reference: string | null
    quote_number: string | null
    tracking_info: TrackingInfo | null
    production_updates: ProductionUpdate[] | null
  }

  export async function POST(request: Request) {
    // 1. Fail-closed secret check (dark-by-default via STARSHIPIT_WEBHOOK_SECRET).
    const url = new URL(request.url)
    const authorized = verifyStarshipitWebhookSecret({
      configuredSecret: process.env.STARSHIPIT_WEBHOOK_SECRET,
      querySecret: url.searchParams.get('secret'),
      headerSecret:
        request.headers.get('x-starshipit-secret') ||
        request.headers.get('x-starshipit-hmac'),
    })
    if (!authorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let payload: StarshipitWebhookPayload
    try {
      payload = (await request.json()) as StarshipitWebhookPayload
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    if (!payload.order_number && !payload.tracking_number) {
      return NextResponse.json(
        { error: 'Missing order_number and tracking_number' },
        { status: 400 },
      )
    }

    const supabase = getSupabaseServer()

    // 2. Match on the portal's OWN reference first, then a clean tracking number.
    let tracker: TrackerRow | null = null
    if (payload.order_number) {
      const { data } = await supabase
        .from('job_trackers')
        .select(JOB_SELECT)
        .or(
          `job_reference.eq.${payload.order_number},` +
            `quote_number.eq.${payload.order_number},` +
            `tracker_token.eq.${payload.order_number}`,
        )
        .limit(1)
        .maybeSingle()
      tracker = (data as TrackerRow | null) ?? null
    }
    if (!tracker && payload.tracking_number) {
      const { data } = await supabase
        .from('job_trackers')
        .select(JOB_SELECT)
        .eq('tracking_info->>trackingNumber', payload.tracking_number)
        .limit(1)
        .maybeSingle()
      tracker = (data as TrackerRow | null) ?? null
    }

    // 3. Log every hit (matched or not) — mirrors the studio receiver.
    await supabase.from('starshipit_webhook_logs').insert({
      order_number: payload.order_number ?? null,
      tracking_number: payload.tracking_number ?? null,
      tracking_status: payload.tracking_status ?? null,
      carrier_name: payload.carrier_name ?? null,
      carrier_service: payload.carrier_service ?? null,
      payload,
      matched_job_tracker_id: tracker ? Number(tracker.id) : null,
      status: tracker ? 'matched' : 'unmatched',
      processed_at: new Date().toISOString(),
    })

    if (!tracker) {
      return NextResponse.json({ success: true, matched: false })
    }

    // 4. Supplement: write tracking_info + append a 'tracking' production_update.
    //    NB deliberately does NOT flip job_trackers.status or send an email —
    //    that is the supersede-vs-supplement decision (see Decision gate).
    const { trackingInfo, productionUpdate } = applyStarshipitWebhook(
      tracker.tracking_info,
      payload,
    )
    const updates = Array.isArray(tracker.production_updates)
      ? tracker.production_updates
      : []

    const { error } = await supabase
      .from('job_trackers')
      .update({
        tracking_info: trackingInfo,
        production_updates: [...updates, productionUpdate],
      })
      .eq('id', tracker.id)
    if (error) {
      return NextResponse.json({ error: 'Update failed' }, { status: 500 })
    }

    revalidateTag(cacheTags.orderTracker, { expire: 0 })

    return NextResponse.json({ success: true, matched: true, trackerId: tracker.id })
  }

  export async function GET() {
    return NextResponse.json({ message: 'Starshipit webhook endpoint' })
  }
  ```
- [ ] **Step 10: Typecheck + full Starshipit suite — expect PASS.**
  ```
  cd /Users/jamierogangeorge/Documents/print-room-portal && npx tsc --noEmit && npx vitest run lib/starshipit
  ```
  Expected: tsc clean; all Starshipit tests pass. (No route-level test — the portal has no webhook-route tests today; all logic lives in the TDD'd pure helpers.)
- [ ] **Step 11: Commit.**
  ```
  git add lib/starshipit/status.ts lib/starshipit/apply-webhook.ts lib/starshipit/verify-webhook.ts lib/starshipit/__tests__/apply-webhook.test.ts lib/starshipit/__tests__/verify-webhook.test.ts app/api/webhooks/starshipit/route.ts supabase/migrations/20260715000000_starshipit_webhook_logs.sql
  git commit -m "feat: portal-owned Starshipit webhook writes tracking back onto the tracker (dark)"
  ```

---

**Follow-up (gated, NOT built here):** once the "supersede vs supplement" decision lands, add a step in the webhook route to (a) flip `job_trackers.status → 'dispatched'` when `payload.tracking_status` is `Dispatched`/`Delivered`, and (b) send `sendTrackerStatusEmail` (`lib/email/tracker-notification.ts` — already renders `trackingNumber`/`carrier`/`trackingUrl` at lines 65-77) with `TEST` recipients routed to `jamie@theprint-room.co.nz`. Deferred so Monday stays the single writer of `status` until the pipe ownership is decided.

---

<!-- ===== Spec B step 4 · F1 split mixed cart · cluster: F1 ===== -->

## Cluster F1 — Split a mixed cart into two orders

Today ordering mode is chosen on the PDP and frozen onto each cart line as an immutable `fulfilmentType` ('stocked' | 'made_to_order'); the cart only reads it for MOQ/oversell warnings, and `POST /api/checkout` makes ONE `submitCustomerOrder` call. This cluster (a) makes the per-line mode editable in the cart, (b) adds a purely-tested partition that splits lines by fulfilment, and (c) rewires the checkout route to create TWO backend orders for a mixed cart — the made_to_order partition as a `purchase_order` (Monday/tracker path) and the stocked partition as `order_type='stock_on_hand'` (Spec A push-with-note + notification). Homogeneous carts still make a single call. Supersedes Spec A's interim "mixed → purchase_order" rule.

Build order within the cluster: **partition (pure)** → **route orchestration** → **cart setter** → **cart selector + nature**.

---

### Task: Pure partition of checkout lines into purchase-order / stock-on-hand groups

**Files:**
- Create `/Users/jamierogangeorge/Documents/print-room-portal/lib/checkout/partition.ts`
- Create `/Users/jamierogangeorge/Documents/print-room-portal/lib/checkout/__tests__/partition.test.ts`

**Interfaces:**
- Consumes: the existing `CheckoutLineInput` type (type-only import from `@/lib/checkout/submit`, lines 31-75) — specifically its `fulfilment_type?: 'stocked' | 'made_to_order'` field (line 58).
- Produces: `type CheckoutOrderType = 'purchase_order' | 'stock_on_hand'`; `interface CheckoutPartition { orderType: CheckoutOrderType; lines: CheckoutLineInput[] }`; `partitionCheckoutLines(lines: CheckoutLineInput[]): CheckoutPartition[]` — returns 0, 1, or 2 partitions, purchase_order first when present, never an empty-lines partition.

Steps:

- [ ] **Step 1: Write the failing test.** Create `lib/checkout/__tests__/partition.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { partitionCheckoutLines } from '../partition'
  import type { CheckoutLineInput } from '../submit'

  function line(overrides: Partial<CheckoutLineInput> = {}): CheckoutLineInput {
    return { product_id: 'p1', product_name: 'Tee', qty: 10, ...overrides }
  }

  describe('partitionCheckoutLines', () => {
    it('returns a single purchase_order partition when every line is made_to_order', () => {
      const parts = partitionCheckoutLines([
        line({ fulfilment_type: 'made_to_order' }),
        line({ product_id: 'p2', fulfilment_type: 'made_to_order' }),
      ])
      expect(parts).toHaveLength(1)
      expect(parts[0].orderType).toBe('purchase_order')
      expect(parts[0].lines).toHaveLength(2)
    })

    it('returns a single stock_on_hand partition when every line is stocked', () => {
      const parts = partitionCheckoutLines([line({ fulfilment_type: 'stocked' })])
      expect(parts).toHaveLength(1)
      expect(parts[0].orderType).toBe('stock_on_hand')
    })

    it('splits a mixed cart into purchase_order (first) then stock_on_hand', () => {
      const mto = line({ product_id: 'mto', fulfilment_type: 'made_to_order' })
      const stk = line({ product_id: 'stk', fulfilment_type: 'stocked' })
      const parts = partitionCheckoutLines([stk, mto])
      expect(parts.map((p) => p.orderType)).toEqual(['purchase_order', 'stock_on_hand'])
      expect(parts[0].lines).toEqual([mto])
      expect(parts[1].lines).toEqual([stk])
    })

    it('treats an absent fulfilment_type as purchase_order (legacy-conservative)', () => {
      const parts = partitionCheckoutLines([line()])
      expect(parts).toHaveLength(1)
      expect(parts[0].orderType).toBe('purchase_order')
    })

    it('returns [] for empty input', () => {
      expect(partitionCheckoutLines([])).toEqual([])
    })

    it('preserves input order within a partition', () => {
      const a = line({ product_id: 'a', fulfilment_type: 'stocked' })
      const b = line({ product_id: 'b', fulfilment_type: 'stocked' })
      expect(partitionCheckoutLines([a, b])[0].lines).toEqual([a, b])
    })
  })
  ```

- [ ] **Step 2: Run it — expect FAIL.** `cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run lib/checkout/__tests__/partition.test.ts` → fails to resolve `../partition` (`Failed to load url ../partition` / "Cannot find module").

- [ ] **Step 3: Implement the partition.** Create `lib/checkout/partition.ts`:
  ```ts
  import type { CheckoutLineInput } from '@/lib/checkout/submit'

  export type CheckoutOrderType = 'purchase_order' | 'stock_on_hand'

  export interface CheckoutPartition {
    orderType: CheckoutOrderType
    lines: CheckoutLineInput[]
  }

  /**
   * Split checkout lines into at most two homogeneous orders by fulfilment.
   * A line joins the 'stock_on_hand' partition iff its fulfilment_type is
   * exactly 'stocked' (a stock DRAW). 'made_to_order' AND absent/legacy lines
   * join 'purchase_order' — matching submit_b2b_order's MOQ-conservative
   * treatment of an absent fulfilment_type. purchase_order is returned first
   * (the primary/tracked order), then stock_on_hand. Never returns an
   * empty-lines partition; returns [] for empty input.
   */
  export function partitionCheckoutLines(
    lines: CheckoutLineInput[],
  ): CheckoutPartition[] {
    const purchaseOrder: CheckoutLineInput[] = []
    const stockOnHand: CheckoutLineInput[] = []
    for (const line of lines) {
      if (line.fulfilment_type === 'stocked') stockOnHand.push(line)
      else purchaseOrder.push(line)
    }
    const out: CheckoutPartition[] = []
    if (purchaseOrder.length > 0) out.push({ orderType: 'purchase_order', lines: purchaseOrder })
    if (stockOnHand.length > 0) out.push({ orderType: 'stock_on_hand', lines: stockOnHand })
    return out
  }
  ```
  (The `import type` is erased at build time — no runtime dependency on the heavy `submit.ts` module.)

- [ ] **Step 4: Run it — expect PASS.** `cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run lib/checkout/__tests__/partition.test.ts` → `Tests 6 passed`.

- [ ] **Step 5: Commit.** `git add lib/checkout/partition.ts lib/checkout/__tests__/partition.test.ts && git commit -m "feat: partition checkout lines by fulfilment into purchase-order/stock-on-hand"`

---

### Task: Rewire the checkout route to create two orders for a mixed cart

**Files:**
- Modify `/Users/jamierogangeorge/Documents/print-room-portal/lib/checkout/submit.ts` (CheckoutInput interface lines 77-87; the `submit_b2b_order` RPC call args near line 1051) — thread `order_type` through.
- Modify `/Users/jamierogangeorge/Documents/print-room-portal/app/api/checkout/route.ts` (imports lines 1-15; the single `submitCustomerOrder` call + return, lines 97-111).
- Create `/Users/jamierogangeorge/Documents/print-room-portal/app/api/checkout/__tests__/route.split.test.ts`

**Interfaces:**
- Consumes: `partitionCheckoutLines(lines: CheckoutLineInput[]): CheckoutPartition[]` and `type CheckoutOrderType` (from the partition task); `submitCustomerOrder(admin, input: CheckoutInput): Promise<{ order_id: string; order_ref: string }>` (submit.ts line 291); the existing `intent` gating already computed in route.ts lines 82-95.
- Consumes (Spec A, by name — see Decision gate): the `orders.order_type` column, the Monday **push-with-note** flow, and the **order-placed notification** abstraction (Slack + email), all keyed on `order_type='stock_on_hand'`.
- Produces: `POST /api/checkout` response `{ order_id, order_ref, orders: Array<{ order_id, order_ref, order_type: CheckoutOrderType }> }`; `CheckoutInput.order_type?: 'purchase_order' | 'stock_on_hand'`.

Steps:

- [ ] **Step 1: Decision gate — confirm Spec A foundations.** Verify `orders.order_type` exists and `submit_b2b_order` accepts `p_order_type`, and that Spec A's push-with-note Monday branch + order-placed notification key on it. If NOT yet merged, STOP and coordinate with Spec A — do NOT fabricate the Monday/notification routing here. (`grep -rn "p_order_type\|order_type" supabase/migrations lib/monday lib/checkout` in the portal repo.) This task threads the order_type VALUE only.

- [ ] **Step 2: Add the failing route test.** Create `app/api/checkout/__tests__/route.split.test.ts` (mirrors the existing `route.permission-denied.test.ts` mock scaffold):
  ```ts
  import { describe, it, expect, vi, beforeEach } from 'vitest'

  vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))
  vi.mock('@/lib/checkout/server', () => ({ requireB2BCustomerApi: vi.fn() }))
  vi.mock('@/lib/checkout/submit', () => {
    class DecorationDriftError extends Error {}
    class UnitPriceDriftError extends Error {}
    class MemberAccessDriftError extends Error {}
    class MoqViolationError extends Error {}
    class StockShortfallError extends Error {}
    class BuyerScopeError extends Error {}
    class MixedShippingAddressError extends Error {}
    return {
      DecorationDriftError, UnitPriceDriftError, MemberAccessDriftError,
      MoqViolationError, StockShortfallError, BuyerScopeError, MixedShippingAddressError,
      submitCustomerOrder: vi.fn(),
    }
  })

  import { POST } from '../route'
  import { requireB2BCustomerApi } from '@/lib/checkout/server'
  import { submitCustomerOrder } from '@/lib/checkout/submit'

  function req(body: unknown): Request {
    return new Request('http://t/api/checkout', { method: 'POST', body: JSON.stringify(body) })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireB2BCustomerApi).mockResolvedValue({
      admin: {} as never,
      context: { storeIds: ['s1'], role: 'org_admin', tenantType: 'franchise', organizationId: 'o1' } as never,
    })
  })

  describe('POST /api/checkout — mixed-cart split', () => {
    it('creates two orders (purchase_order + stock_on_hand) with distinct idempotency keys', async () => {
      vi.mocked(submitCustomerOrder)
        .mockResolvedValueOnce({ order_id: 'po-1', order_ref: 'PO-1' })
        .mockResolvedValueOnce({ order_id: 'st-1', order_ref: 'ST-1' })

      const res = await POST(req({
        idempotency_key: 'idem-1',
        lines: [
          { product_id: 'mto', product_name: 'Tee', qty: 10, ship_to_store_id: 's1', fulfilment_type: 'made_to_order' },
          { product_id: 'stk', product_name: 'Cap', qty: 5, ship_to_store_id: 's1', fulfilment_type: 'stocked' },
        ],
      }))

      expect(res.status).toBe(200)
      expect(submitCustomerOrder).toHaveBeenCalledTimes(2)
      const calls = vi.mocked(submitCustomerOrder).mock.calls
      expect(calls[0][1].idempotency_key).toBe('idem-1:po')
      expect(calls[0][1].order_type).toBe('purchase_order')
      expect(calls[0][1].lines.map((l) => l.product_id)).toEqual(['mto'])
      expect(calls[1][1].idempotency_key).toBe('idem-1:stock')
      expect(calls[1][1].order_type).toBe('stock_on_hand')
      expect(calls[1][1].lines.map((l) => l.product_id)).toEqual(['stk'])

      const json = await res.json()
      expect(json.order_id).toBe('po-1')
      expect(json.orders).toHaveLength(2)
      expect(json.orders.map((o: { order_type: string }) => o.order_type)).toEqual(['purchase_order', 'stock_on_hand'])
    })

    it('makes a single submit call for an all-stock cart', async () => {
      vi.mocked(submitCustomerOrder).mockResolvedValueOnce({ order_id: 'st-1', order_ref: 'ST-1' })
      const res = await POST(req({
        idempotency_key: 'idem-2',
        lines: [{ product_id: 'stk', product_name: 'Cap', qty: 5, ship_to_store_id: 's1', fulfilment_type: 'stocked' }],
      }))
      expect(res.status).toBe(200)
      expect(submitCustomerOrder).toHaveBeenCalledTimes(1)
      expect(vi.mocked(submitCustomerOrder).mock.calls[0][1].order_type).toBe('stock_on_hand')
      expect(vi.mocked(submitCustomerOrder).mock.calls[0][1].idempotency_key).toBe('idem-2:stock')
    })
  })
  ```

- [ ] **Step 3: Run it — expect FAIL.** `cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run app/api/checkout/__tests__/route.split.test.ts` → fails: `submitCustomerOrder` called once (not twice), and `calls[0][1].order_type` is `undefined` (plus a TS error `order_type does not exist on CheckoutInput` if run through typecheck).

- [ ] **Step 4: Add `order_type` to CheckoutInput.** In `lib/checkout/submit.ts`, extend the interface (current lines 77-87 end with `intent?: 'customer' | 'inventory'`). Add after `intent`:
  ```ts
    /**
     * Spec B / F1 — which backend order_type this submit creates. The checkout
     * route partitions a mixed cart and calls submit once per partition:
     * 'purchase_order' (made_to_order lines → Monday/tracker) and 'stock_on_hand'
     * (stocked lines → Spec A push-with-note + notification). Defaults to
     * 'purchase_order' (today's single-order behaviour).
     */
    order_type?: 'purchase_order' | 'stock_on_hand'
  ```

- [ ] **Step 5: Thread it into the RPC.** In `lib/checkout/submit.ts`, the `submit_b2b_order` call currently ends (around line 1051):
  ```ts
      p_intent: input.intent ?? 'customer',
      p_member_permission: input.context.orderingPermission ?? 'both',
    })
  ```
  Add the order_type param:
  ```ts
      p_intent: input.intent ?? 'customer',
      p_order_type: input.order_type ?? 'purchase_order',
      p_member_permission: input.context.orderingPermission ?? 'both',
    })
  ```
  (If Step 1 found `submit_b2b_order` does NOT yet accept `p_order_type`, that RPC signature is a Spec A deliverable — do not add it here; block per the Decision gate.)

- [ ] **Step 6: Partition the route.** In `app/api/checkout/route.ts`, add the import (after line 15's `import { cacheTags }`):
  ```ts
  import { partitionCheckoutLines, type CheckoutOrderType } from '@/lib/checkout/partition'
  ```
  Replace the current single-call try body (lines 97-111):
  ```ts
    try {
      const result = await submitCustomerOrder(auth.admin, {
        context: auth.context,
        idempotency_key: body.idempotency_key,
        required_by: body.required_by ?? null,
        notes: body.notes ?? null,
        internal_notes: null,
        lines: body.lines,
        custom_shipping_address: body.custom_shipping_address ?? null,
        intent,
      })
      // New order → both portal-data caches (account quotes, order-tracker) stale.
      revalidateTag(cacheTags.accountData, { expire: 0 })
      revalidateTag(cacheTags.orderTracker, { expire: 0 })
      return NextResponse.json(result)
    } catch (e) {
  ```
  with the partition loop:
  ```ts
    try {
      // F1 (spec B): split a mixed admin cart into TWO backend orders — the
      // made_to_order lines become a purchase_order (Monday/tracker path); the
      // stocked lines become order_type='stock_on_hand' (Spec A push-with-note +
      // notification). A homogeneous cart still makes a single call. Each
      // partition gets a distinct idempotency suffix so a retry after a partial
      // failure dedupes the already-committed order.
      const partitions = partitionCheckoutLines(body.lines)
      const orders: Array<{ order_id: string; order_ref: string; order_type: CheckoutOrderType }> = []
      for (const part of partitions) {
        const suffix = part.orderType === 'stock_on_hand' ? 'stock' : 'po'
        const result = await submitCustomerOrder(auth.admin, {
          context: auth.context,
          idempotency_key: `${body.idempotency_key}:${suffix}`,
          required_by: body.required_by ?? null,
          notes: body.notes ?? null,
          internal_notes: null,
          lines: part.lines,
          custom_shipping_address: body.custom_shipping_address ?? null,
          intent,
          order_type: part.orderType,
        })
        orders.push({ ...result, order_type: part.orderType })
      }
      // New order(s) → both portal-data caches (account quotes, order-tracker) stale.
      revalidateTag(cacheTags.accountData, { expire: 0 })
      revalidateTag(cacheTags.orderTracker, { expire: 0 })
      // Primary (redirect target) is the purchase_order when present — it carries
      // the production tracker; otherwise the sole stock_on_hand order.
      const primary = orders[0]
      return NextResponse.json({ order_id: primary.order_id, order_ref: primary.order_ref, orders })
    } catch (e) {
  ```
  (The upstream ship-to / org / intent validation on `body.lines`, lines 49-95, is unchanged and still runs across the full cart; its all-or-nothing ship-to rule guarantees each partition stays homogeneous, so the two calls never trip `MixedShippingAddressError`.)

- [ ] **Step 7: Run it — expect PASS.** `cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run app/api/checkout/__tests__/route.split.test.ts` → `Tests 2 passed`.

- [ ] **Step 8: Regression-guard existing submit + route tests.** `cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run app/api/checkout/__tests__ lib/checkout/__tests__` → the pre-existing `route.permission-denied` and `submit.*` suites still pass (the single-line cart in `VALID_BODY` now yields one `:po`-suffixed submit call; those tests assert status codes only, so they remain green).

- [ ] **Step 9: Commit.** `git add app/api/checkout/route.ts lib/checkout/submit.ts app/api/checkout/__tests__/route.split.test.ts && git commit -m "feat: split mixed checkout into purchase-order + stock-on-hand orders"`

> Note: the checkout client (`components/checkout/CheckoutReviewClient.tsx` line 265-268) reads `result.order_id` and redirects to `/checkout/confirmation/${result.order_id}` — the new top-level `order_id`/`order_ref` (primary order) keeps it working with NO client change. The extra `orders[]` is available for a future two-order confirmation surface (deferred — see uncertainties).

---

### Task: Make cart-line fulfilment mode mutable (CartProvider setter)

**Files:**
- Modify `/Users/jamierogangeorge/Documents/print-room-portal/components/cart/CartProvider.tsx` (types import line 11-16; `CartApi` interface lines 20-27; api object near `setShipTo` lines 237-242).
- Create `/Users/jamierogangeorge/Documents/print-room-portal/components/cart/__tests__/CartProvider.test.tsx`

**Interfaces:**
- Consumes: `CartLineFulfilmentType` (`= 'stocked' | 'made_to_order'`, `lib/cart/types.ts` line 95); the existing `CartApi` shape.
- Produces: `CartApi.setFulfilmentType(lineId: string, fulfilmentType: CartLineFulfilmentType): void`.

Steps:

- [ ] **Step 1: Write the failing test.** Create `components/cart/__tests__/CartProvider.test.tsx`:
  ```tsx
  import { render, screen, fireEvent } from '@testing-library/react'
  import { beforeEach, describe, expect, it, vi } from 'vitest'
  import { CartProvider } from '../CartProvider'
  import { useCart } from '../useCart'

  vi.mock('@/contexts/CompanyContext', () => ({
    useCompany: () => ({ access: { companyId: 'org-1', isPreview: false, role: 'org_admin' } }),
  }))

  function Probe() {
    const cart = useCart()
    const line = cart.lines[0]
    return (
      <div>
        <button
          onClick={() =>
            cart.addLine({
              productId: 'p1', productName: 'Tee', variantId: 'v1', variantLabel: 'Black / M',
              qty: 10, unitPrice: 10, imageUrl: null, decorations: [], fulfilmentType: 'made_to_order',
            })
          }
        >
          add
        </button>
        {line && (
          <>
            <span data-testid="mode">{line.fulfilmentType}</span>
            <span data-testid="qty">{line.qty}</span>
            <button onClick={() => cart.setFulfilmentType(line.lineId, 'stocked')}>flip</button>
          </>
        )}
      </div>
    )
  }

  beforeEach(() => {
    window.localStorage.clear()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ imagesByLineId: {} }) })))
  })

  describe('CartProvider.setFulfilmentType', () => {
    it('flips a line between made_to_order and stocked without touching other fields', () => {
      render(
        <CartProvider>
          <Probe />
        </CartProvider>,
      )
      fireEvent.click(screen.getByText('add'))
      expect(screen.getByTestId('mode')).toHaveTextContent('made_to_order')
      expect(screen.getByTestId('qty')).toHaveTextContent('10')
      fireEvent.click(screen.getByText('flip'))
      expect(screen.getByTestId('mode')).toHaveTextContent('stocked')
      expect(screen.getByTestId('qty')).toHaveTextContent('10')
    })
  })
  ```

- [ ] **Step 2: Run it — expect FAIL.** `cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run components/cart/__tests__/CartProvider.test.tsx` → fails: `cart.setFulfilmentType is not a function` (property missing on `CartApi`).

- [ ] **Step 3: Add the setter to the type + import.** In `CartProvider.tsx`, extend the types import (lines 11-16) to include the fulfilment type:
  ```ts
  import {
    lineSignature,
    recomputeProductTierPrices,
    type CartLine,
    type CartLineFulfilmentType,
    type CartState,
  } from '@/lib/cart/types'
  ```
  Add to the `CartApi` interface (currently lines 20-27, after `setShipTo`):
  ```ts
    setShipTo: (lineId: string, storeId: string | null) => void
    setFulfilmentType: (lineId: string, fulfilmentType: CartLineFulfilmentType) => void
    clear: () => void
  ```

- [ ] **Step 4: Implement the setter.** In the `api` object, immediately after the existing `setShipTo` implementation (lines 237-242) and before `clear` (line 243), add — mirroring `setShipTo` exactly (no price recompute; fulfilmentType is not part of the tier aggregation key, so pooling is unaffected):
  ```ts
      setFulfilmentType: (lineId, fulfilmentType) =>
        setState((s) => ({
          lines: s.lines.map((l) =>
            l.lineId === lineId ? { ...l, fulfilmentType } : l,
          ),
        })),
  ```

- [ ] **Step 5: Run it — expect PASS.** `cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run components/cart/__tests__/CartProvider.test.tsx` → `Tests 1 passed`.

- [ ] **Step 6: Commit.** `git add components/cart/CartProvider.tsx components/cart/__tests__/CartProvider.test.tsx && git commit -m "feat: add setFulfilmentType cart mutation"`

---

### Task: Per-line order-type selector in the cart (nature-gated) + PDP nature wiring

**Files:**
- Modify `/Users/jamierogangeorge/Documents/print-room-portal/lib/cart/types.ts` (top-of-file imports; `CartLine` interface lines 35-93) — add `nature`.
- Modify `/Users/jamierogangeorge/Documents/print-room-portal/components/shop/ProductDetailClient.tsx` (add-to-cart sites: `baseLine` line 896-910, variantless `addLine` object line 966-980, `oneSizeBase` line 1002-1016, one-size `addLine` object line 1037-1053) — populate `nature`.
- Modify `/Users/jamierogangeorge/Documents/print-room-portal/components/cart/CartTable.tsx` (imports lines 3-14; `CartTableProps` lines 16-24; destructure lines 29-35; the per-line `<article>` render lines 143-243).
- Modify `/Users/jamierogangeorge/Documents/print-room-portal/components/cart/CartDrawer.tsx` (imports lines 1-12; `CartTable` render lines 81-87) — supply `isOrgAdmin` + `onFulfilmentChange`.
- Create `/Users/jamierogangeorge/Documents/print-room-portal/components/cart/__tests__/CartTable.fulfilment-selector.test.tsx`

**Interfaces:**
- Consumes: `CartApi.setFulfilmentType` (from the setter task); `pillsFor(effective: FulfilmentType, isOrgAdmin: boolean): Pill[]` and `PILL_LABELS` and `type FulfilmentType` (`lib/shop/fulfilment-mode.ts` lines 6, 14-17, 32-40); `useCompany().access.role` (`'org_admin' | 'staff'`, `lib/checkout/server.ts` line 15).
- Produces: `CartLine.nature?: FulfilmentType`; `CartTableProps.onFulfilmentChange?: (lineId: string, fulfilmentType: 'stocked' | 'made_to_order') => void`; `CartTableProps.isOrgAdmin?: boolean`.

Steps:

- [ ] **Step 1: Write the failing selector test.** Create `components/cart/__tests__/CartTable.fulfilment-selector.test.tsx` (separate from the pre-existing RED `CartTable.test.tsx`):
  ```tsx
  import { render, screen, waitFor } from '@testing-library/react'
  import { beforeEach, describe, expect, it, vi } from 'vitest'
  import { CartTable } from '../CartTable'
  import type { CartLine } from '@/lib/cart/types'

  vi.mock('@/contexts/CurrencyContext', () => ({
    useCurrency: () => ({ format: (n: number) => `$${n.toFixed(2)}` }),
  }))

  function makeLine(overrides: Partial<CartLine> = {}): CartLine {
    return {
      lineId: 'line-1', productId: 'p1', productName: 'Tee', variantId: 'v1',
      variantLabel: 'Black / M', qty: 30, unitPrice: 10, imageUrl: null,
      decorations: [], ...overrides,
    }
  }

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ availability: {}, effectiveMoq: undefined }) })),
    )
  })

  describe('CartTable order-type selector', () => {
    it('shows the selector for a mixed-nature line when the viewer is an org admin', async () => {
      render(
        <CartTable
          lines={[makeLine({ nature: 'mixed', fulfilmentType: 'stocked' })]}
          onUpdateQty={() => {}} onRemove={() => {}} isOrgAdmin onFulfilmentChange={() => {}}
        />,
      )
      await waitFor(() => expect(fetch).toHaveBeenCalled())
      expect(screen.getByRole('group', { name: /order type/i })).toBeInTheDocument()
      expect(screen.getByText('Purchase order')).toBeInTheDocument()
      expect(screen.getByText('Stock on hand')).toBeInTheDocument()
    })

    it('hides the selector for a single-nature (made_to_order) line', async () => {
      render(
        <CartTable
          lines={[makeLine({ nature: 'made_to_order', fulfilmentType: 'made_to_order' })]}
          onUpdateQty={() => {}} onRemove={() => {}} isOrgAdmin onFulfilmentChange={() => {}}
        />,
      )
      await waitFor(() => expect(fetch).toHaveBeenCalled())
      expect(screen.queryByRole('group', { name: /order type/i })).not.toBeInTheDocument()
    })

    it('hides the selector for a mixed-nature line when the viewer is not an org admin', async () => {
      render(
        <CartTable
          lines={[makeLine({ nature: 'mixed', fulfilmentType: 'stocked' })]}
          onUpdateQty={() => {}} onRemove={() => {}} isOrgAdmin={false} onFulfilmentChange={() => {}}
        />,
      )
      await waitFor(() => expect(fetch).toHaveBeenCalled())
      expect(screen.queryByRole('group', { name: /order type/i })).not.toBeInTheDocument()
    })

    it('fires onFulfilmentChange with the chosen mode when a pill is clicked', async () => {
      const onFulfilmentChange = vi.fn()
      render(
        <CartTable
          lines={[makeLine({ nature: 'mixed', fulfilmentType: 'stocked' })]}
          onUpdateQty={() => {}} onRemove={() => {}} isOrgAdmin onFulfilmentChange={onFulfilmentChange}
        />,
      )
      await waitFor(() => expect(fetch).toHaveBeenCalled())
      screen.getByText('Purchase order').click()
      expect(onFulfilmentChange).toHaveBeenCalledWith('line-1', 'made_to_order')
    })
  })
  ```

- [ ] **Step 2: Run it — expect FAIL.** `cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run components/cart/__tests__/CartTable.fulfilment-selector.test.tsx` → fails: `Unable to find role "group"` (no selector rendered) and a TS error on the unknown `nature` / `isOrgAdmin` / `onFulfilmentChange` props.

- [ ] **Step 3: Add `nature` to CartLine.** In `lib/cart/types.ts`, add at the very top (before the first `export interface`):
  ```ts
  import type { FulfilmentType } from '@/lib/shop/fulfilment-mode'
  ```
  In the `CartLine` interface (lines 35-93), add after the `fulfilmentType?: CartLineFulfilmentType` field (line 65):
  ```ts
    /**
     * Spec B / F1 — the product's EFFECTIVE fulfilment nature (catalogue
     * override ?? product base), snapshotted at add-time. Distinct from
     * `fulfilmentType` (the CHOSEN mode): a 'stocked' line from a 'mixed'
     * product can be flipped to a purchase order in the cart, but a line from a
     * pure 'made_to_order' product cannot. The cart's per-line order-type
     * selector shows only when nature === 'mixed' (pillsFor returns both pills).
     * Absent on legacy/reorder lines → treated as 'made_to_order' (no selector).
     */
    nature?: FulfilmentType
  ```
  (`fulfilment-mode.ts` imports nothing from `cart/types`, so this import is one-directional — no cycle.)

- [ ] **Step 4: Populate `nature` at the PDP add sites.** In `ProductDetailClient.tsx`, `product.fulfilment_type` (a `FulfilmentType`, prop declared line 62) is in scope at every add site. Add `nature: product.fulfilment_type,` to each of the four line objects:
  - `baseLine` (after `catalogueItemId: product.catalogueItemId,` line 907).
  - the variantless `cart.addLine({ ... })` object (near line 977).
  - `oneSizeBase` (after `catalogueItemId: product.catalogueItemId,` line 1013).
  - the final one-size `cart.addLine({ ... })` object (near line 1050).
  Example for `baseLine`:
  ```ts
          const baseLine = {
            productId: product.id,
            productName: product.name,
            variantId: variant.variant_id,
            variantLabel,
            sizeId: s.size_id,
            sizeLabel: s.size_label,
            unitPrice: pricing.unit_price,
            imageUrl: cartImageForSwatch(variant.color_swatch_id),
            decorations: cartDecorationsForSwatch(variant.color_swatch_id),
            brackets: cartLineBrackets,
            catalogueItemId: product.catalogueItemId,
            nature: product.fulfilment_type,
            manualDecorationPerUnit: manualDecorationPerUnitSnapshot,
            manualDecorationBrackets: manualDecorationBracketsSnapshot,
          }
  ```
  (Existing PDP tests assert `addLine` args with `expect.objectContaining(...)`, so an extra field does not break them.)

- [ ] **Step 5: Add the selector to CartTable.** In `CartTable.tsx`, extend the imports (after the `@/lib/cart/types` import block, lines 5-10):
  ```ts
  import { pillsFor, PILL_LABELS } from '@/lib/shop/fulfilment-mode'
  ```
  Extend `CartTableProps` (lines 16-24), adding after `onMoqViolationChange`:
  ```ts
    /** Reports a per-line order-type (fulfilment) change from the selector. */
    onFulfilmentChange?: (lineId: string, fulfilmentType: 'stocked' | 'made_to_order') => void
    /** Gates the per-line order-type selector to org admins (Spec B / F1). */
    isOrgAdmin?: boolean
  ```
  Destructure them in the component signature (lines 29-35):
  ```ts
  export function CartTable({
    lines,
    onUpdateQty,
    onRemove,
    onOversellChange,
    onMoqViolationChange,
    onFulfilmentChange,
    isOrgAdmin = false,
  }: CartTableProps) {
  ```
  Inside `lines.map((line) => { ... })`, alongside the existing per-line locals (after `const isMadeToOrder = line.fulfilmentType === 'made_to_order'`, line 133), add:
  ```ts
          const showFulfilmentSelector =
            pillsFor(line.nature ?? 'made_to_order', isOrgAdmin).length === 2
          const isStockMode = line.fulfilmentType === 'stocked'
  ```
  Render the control as a new row inside the `<article>`, immediately after the top flex row closes (after line 179's `</div>` that ends the image/detail/remove row, before the inline status messages block at line 181):
  ```tsx
              {showFulfilmentSelector && (
                <div className="mt-4 flex items-center justify-between gap-3 border-t border-gray-100 pt-3">
                  <span className="text-xs text-gray-500">Order type</span>
                  <div
                    className="inline-flex rounded-full bg-gray-100 p-0.5"
                    role="group"
                    aria-label="Order type"
                  >
                    <button
                      type="button"
                      onClick={() => onFulfilmentChange?.(line.lineId, 'made_to_order')}
                      aria-pressed={!isStockMode}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                        !isStockMode ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'
                      }`}
                    >
                      {PILL_LABELS.reorder}
                    </button>
                    <button
                      type="button"
                      onClick={() => onFulfilmentChange?.(line.lineId, 'stocked')}
                      aria-pressed={isStockMode}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                        isStockMode ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'
                      }`}
                    >
                      {PILL_LABELS.from_inventory}
                    </button>
                  </div>
                </div>
              )}
  ```
  (`PILL_LABELS.reorder` = "Purchase order"; `PILL_LABELS.from_inventory` = "Stock on hand".)

- [ ] **Step 6: Run the selector test — expect PASS.** `cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run components/cart/__tests__/CartTable.fulfilment-selector.test.tsx` → `Tests 4 passed`.

- [ ] **Step 7: Wire it through CartDrawer.** In `CartDrawer.tsx`, add the company hook import (after line 9's `useCurrency` import):
  ```ts
  import { useCompany } from '@/contexts/CompanyContext'
  ```
  Inside the component (after `const cart = useCart()`, line 15):
  ```ts
    const { access } = useCompany()
    const isOrgAdmin = access?.role === 'org_admin'
  ```
  Extend the `<CartTable>` render (lines 81-87) with the two new props:
  ```tsx
            <CartTable
              lines={cart.lines}
              onUpdateQty={(id, qty) => cart.updateLine(id, { qty })}
              onRemove={cart.removeLine}
              onOversellChange={handleOversellChange}
              onMoqViolationChange={handleMoqViolationChange}
              onFulfilmentChange={cart.setFulfilmentType}
              isOrgAdmin={isOrgAdmin}
            />
  ```

- [ ] **Step 8: Typecheck the cart surface + re-run the cart suite.** `cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run components/cart/__tests__ components/shop/__tests__` → the new selector + CartProvider suites pass and the existing PDP `addLine` tests stay green (extra `nature` field is objectContaining-safe). The pre-existing RED `CartTable.test.tsx` "produced before dispatch" case remains failing — it is unrelated to F1 and out of scope (see anchorCorrections); do not "fix" it as part of this cluster.

- [ ] **Step 9: Commit.** `git add lib/cart/types.ts components/shop/ProductDetailClient.tsx components/cart/CartTable.tsx components/cart/CartDrawer.tsx components/cart/__tests__/CartTable.fulfilment-selector.test.tsx && git commit -m "feat: per-line order-type selector in cart for mixed-nature lines"`

---

<!-- ===== Spec B step 5 · F2 org-admin self-serve invites · cluster: F2 ===== -->

This cluster builds the customer-portal-facing self-serve invite (F2), extending the Thursday slice (B1, staff-side, which added role choice + default_store_id capture to the staff invite path). F2 lets a portal **org_admin** invite **staff-only** members, with a hard server-side guard that an org_admin can NEVER mint another org_admin, and gives the dormant `canManageUsers` flag its first consumer.

All paths below are in **P (customer portal)** = `/Users/jamierogangeorge/Documents/print-room-portal`. Run tests with `cd /Users/jamierogangeorge/Documents/print-room-portal && npx vitest run <path>`.

**Consumes from B1 (Thursday slice) — already on the shared DB, no migration here:** `user_organizations` columns `role` ('org_admin'|'staff'), `default_store_id`, `ordering_permission` ('stock_only'|'reorder_only'|'both'), `invited_at`; CHECK `chk_buyer_has_default_store` (`role<>'staff' OR default_store_id IS NOT NULL`); trigger `trg_normalise_admin_ordering_permission`.

---

### Task: Portal invite-role guard (org_admin can NEVER mint org_admin)

Pure, unit-testable rule that the invite endpoint depends on. Kept out of the route file so it can be tested without booting the Next handler (mirrors the existing `app/api/proofs/[id]/amendment-requests/__tests__/role-allowlist.test.ts` pattern).

**Files:**
- Create `lib/team/invite-guard.ts` (new)
- Create `lib/team/__tests__/invite-guard.test.ts` (new)

**Interfaces:**
- Consumes: nothing.
- Produces: `INVITABLE_ROLES: ReadonlySet<'staff'>`; `isInvitableRole(role: string): role is 'staff'`.

- [ ] **Step 1: Write the failing guard test.** Create `lib/team/__tests__/invite-guard.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { INVITABLE_ROLES, isInvitableRole } from '../invite-guard'

  describe('customer-portal invite role guard', () => {
    it('admits staff', () => {
      expect(isInvitableRole('staff')).toBe(true)
      expect(INVITABLE_ROLES.has('staff')).toBe(true)
    })
    it('NEVER admits org_admin (a portal admin cannot mint another admin)', () => {
      expect(isInvitableRole('org_admin')).toBe(false)
    })
    it('rejects unknown / legacy roles', () => {
      expect(isInvitableRole('buyer')).toBe(false)
      expect(isInvitableRole('')).toBe(false)
    })
  })
  ```
- [ ] **Step 2: Run it — expect FAIL.** `npx vitest run lib/team/__tests__/invite-guard.test.ts` → fails with `Failed to resolve import "../invite-guard"` (module does not exist yet).
- [ ] **Step 3: Implement the guard.** Create `lib/team/invite-guard.ts`:
  ```ts
  /**
   * Roles a customer-portal org_admin may CREATE via self-serve invite.
   * Deliberately staff-only: an org_admin can NEVER mint another org_admin
   * (F2 hard guard). Pure module so the rule is unit-testable without the route.
   */
  export const INVITABLE_ROLES = new Set<'staff'>(['staff'])

  export function isInvitableRole(role: string): role is 'staff' {
    return INVITABLE_ROLES.has(role as 'staff')
  }
  ```
- [ ] **Step 4: Run it — expect PASS.** `npx vitest run lib/team/__tests__/invite-guard.test.ts` → 3 passing.
- [ ] **Step 5: Commit.** `git commit -am "feat: staff-only invite-role guard for portal self-serve invites"`

---

### Task: Add MEMBER_INVITE audit action to the customer portal

The portal's `AUDIT_ACTIONS` has no member.* actions; add `MEMBER_INVITE` mirroring the staff repo (`src/lib/audit/actions.ts` line 7, value `'member.invite'`) so invite events group across repos.

**Files:**
- Modify `lib/audit/actions.ts` (add one entry inside the `AUDIT_ACTIONS` object, lines 8-9)
- Create `lib/audit/__tests__/actions.test.ts` (new)

**Interfaces:**
- Consumes: nothing.
- Produces: `AUDIT_ACTIONS.MEMBER_INVITE === 'member.invite'`.

- [ ] **Step 1: Write the failing test.** Create `lib/audit/__tests__/actions.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { AUDIT_ACTIONS } from '../actions'

  describe('AUDIT_ACTIONS', () => {
    it('mirrors the staff member.invite action string', () => {
      expect(AUDIT_ACTIONS.MEMBER_INVITE).toBe('member.invite')
    })
  })
  ```
- [ ] **Step 2: Run it — expect FAIL.** `npx vitest run lib/audit/__tests__/actions.test.ts` → fails: `expected undefined to be 'member.invite'`.
- [ ] **Step 3: Add the action.** In `lib/audit/actions.ts`, the object currently opens:
  ```ts
  export const AUDIT_ACTIONS = {
    ORDER_SUBMIT: 'order.submit',
  ```
  Change to:
  ```ts
  export const AUDIT_ACTIONS = {
    // MIRROR staff src/lib/audit/actions.ts so member.* events group cross-repo.
    MEMBER_INVITE: 'member.invite',

    ORDER_SUBMIT: 'order.submit',
  ```
- [ ] **Step 4: Run it — expect PASS.** `npx vitest run lib/audit/__tests__/actions.test.ts` → 1 passing.
- [ ] **Step 5: Commit.** `git commit -am "feat: add MEMBER_INVITE audit action to portal"`

---

### Task: Customer-portal self-serve invite API (`POST /api/team/invite`)

The core endpoint. Mirrors the staff `src/app/api/b2b-accounts/[id]/invite/route.ts` OTP-provisioning flow, but: authed via `requireB2BCustomerApi` (org scoped to the caller's own org), gated on `role === 'org_admin'`, and — unlike the staff route which forces `org_admin` because it can't capture a store — this route creates **staff** directly (F2 captures `default_store_id`, satisfying `chk_buyer_has_default_store`). The staff-only guard is enforced twice: the request `role` is rejected unless `isInvitableRole`, and the insert always writes `'staff'`.

**Files:**
- Create `app/api/team/invite/route.ts` (new)
- Create `app/api/team/invite/__tests__/route.test.ts` (new)

**Interfaces:**
- Consumes:
  - `requireB2BCustomerApi(): Promise<{ error: NextResponse } | { admin: SupabaseClient; context: B2BCustomerContext }>` from `@/lib/checkout/server`; `context` supplies `role`, `organizationId`, `userId`. `admin` is the service-role client.
  - `isInvitableRole(role: string): role is 'staff'` from `@/lib/team/invite-guard`.
  - `recordAuditEvent(args)` from `@/lib/audit/recordEvent`; `AUDIT_ACTIONS.MEMBER_INVITE` from `@/lib/audit/actions`.
- Produces: `POST` handler; request `{ email, first_name, last_name?, default_store_id, ordering_permission? }` → 201 `{ user_id, email_sent: true }`.

- [ ] **Step 1: Write the failing guard tests.** These hit the early returns (before any Supabase call), so no DB stub is needed. Create `app/api/team/invite/__tests__/route.test.ts`:
  ```ts
  import { describe, it, expect, vi, beforeEach } from 'vitest'

  vi.mock('@/lib/checkout/server', () => ({ requireB2BCustomerApi: vi.fn() }))

  import { POST } from '../route'
  import { requireB2BCustomerApi } from '@/lib/checkout/server'

  function req(body: unknown): Request {
    return new Request('http://t/api/team/invite', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  const ADMIN_CTX = {
    admin: {} as never,
    context: { role: 'org_admin', organizationId: 'org-1', userId: 'u-admin' } as never,
  }

  beforeEach(() => vi.clearAllMocks())

  describe('POST /api/team/invite — guards', () => {
    it('403s a staff member trying to invite', async () => {
      vi.mocked(requireB2BCustomerApi).mockResolvedValue({
        admin: {} as never,
        context: { role: 'staff', organizationId: 'org-1', userId: 'u-staff' } as never,
      })
      const res = await POST(req({ email: 'x@y.co', first_name: 'X', default_store_id: 's1' }))
      expect(res.status).toBe(403)
    })

    it('403s an org_admin trying to mint another org_admin (hard guard)', async () => {
      vi.mocked(requireB2BCustomerApi).mockResolvedValue(ADMIN_CTX)
      const res = await POST(
        req({ email: 'x@y.co', first_name: 'X', default_store_id: 's1', role: 'org_admin' }),
      )
      expect(res.status).toBe(403)
      expect((await res.json()).error).toMatch(/only invite staff/i)
    })

    it('400s when no default ship-to store is supplied', async () => {
      vi.mocked(requireB2BCustomerApi).mockResolvedValue(ADMIN_CTX)
      const res = await POST(req({ email: 'x@y.co', first_name: 'X' }))
      expect(res.status).toBe(400)
    })
  })
  ```
- [ ] **Step 2: Run it — expect FAIL.** `npx vitest run app/api/team/invite/__tests__/route.test.ts` → fails with `Failed to resolve import "../route"`.
- [ ] **Step 3: Implement the route.** Create `app/api/team/invite/route.ts`:
  ```ts
  import { NextResponse } from 'next/server'
  import { requireB2BCustomerApi } from '@/lib/checkout/server'
  import { isInvitableRole } from '@/lib/team/invite-guard'
  import { recordAuditEvent } from '@/lib/audit/recordEvent'
  import { AUDIT_ACTIONS } from '@/lib/audit/actions'

  const ORDERING_PERMISSIONS = new Set(['stock_only', 'reorder_only', 'both'])

  interface InviteBody {
    email?: string
    first_name?: string
    last_name?: string
    default_store_id?: string
    ordering_permission?: string
    role?: string
  }

  function validEmail(email: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  }

  export async function POST(request: Request) {
    const auth = await requireB2BCustomerApi()
    if ('error' in auth) return auth.error

    // canManageUsers gate: only org_admins may invite members.
    if (auth.context.role !== 'org_admin') {
      return NextResponse.json(
        { error: 'Only organisation admins can invite members' },
        { status: 403 },
      )
    }

    let body: InviteBody
    try {
      body = (await request.json()) as InviteBody
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const email = body.email?.trim().toLowerCase() ?? ''
    const firstName = body.first_name?.trim() ?? ''
    const lastName = body.last_name?.trim() ?? ''
    const defaultStoreId = body.default_store_id?.trim() ?? ''
    const orderingPermission = body.ordering_permission ?? 'stock_only'
    // Hard guard: an org_admin can NEVER mint another org_admin. Any body role
    // other than 'staff' is rejected outright; the insert below always writes 'staff'.
    const requestedRole = body.role ?? 'staff'

    if (!validEmail(email)) {
      return NextResponse.json({ error: 'A valid email is required' }, { status: 400 })
    }
    if (!firstName) {
      return NextResponse.json({ error: 'First name is required' }, { status: 400 })
    }
    if (!isInvitableRole(requestedRole)) {
      return NextResponse.json(
        { error: 'Org admins can only invite staff members' },
        { status: 403 },
      )
    }
    if (!defaultStoreId) {
      return NextResponse.json(
        { error: 'A default ship-to store is required for staff members' },
        { status: 400 },
      )
    }
    if (!ORDERING_PERMISSIONS.has(orderingPermission)) {
      return NextResponse.json({ error: 'Invalid ordering permission' }, { status: 400 })
    }

    const admin = auth.admin // service-role client (see requireB2BCustomer)
    const orgId = auth.context.organizationId

    // The chosen store must belong to THIS org — block cross-org tampering.
    const { data: store } = await admin
      .from('stores')
      .select('id')
      .eq('id', defaultStoreId)
      .eq('organization_id', orgId)
      .maybeSingle()
    if (!store) {
      return NextResponse.json(
        { error: 'Store not found for this organisation' },
        { status: 400 },
      )
    }

    const inviteMetadata = { first_name: firstName, last_name: lastName, invited_org_id: orgId }

    // Provision a PRE-CONFIRMED auth user (no email fires), then send the single
    // branded sign-in code via signInWithOtp — identical to the staff invite flow.
    let userId: string | null = null
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: inviteMetadata,
    })

    if (createError) {
      const alreadyExists = createError.message.toLowerCase().includes('already')
      if (!alreadyExists) {
        return NextResponse.json({ error: createError.message }, { status: 500 })
      }
      const { data: profileLookup } = await admin
        .from('profiles')
        .select('id')
        .eq('email', email)
        .maybeSingle()
      userId = profileLookup?.id ?? null
      if (!userId) {
        const { data: allUsers } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
        userId = allUsers?.users.find((u) => u.email === email)?.id ?? null
      }
    } else {
      userId = created.user?.id ?? null
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'Could not resolve a user id for the invite' },
        { status: 500 },
      )
    }

    // Don't re-add someone already in this org.
    const { data: existing } = await admin
      .from('user_organizations')
      .select('user_id')
      .eq('user_id', userId)
      .eq('organization_id', orgId)
      .maybeSingle()
    if (existing) {
      return NextResponse.json(
        { error: 'This user is already a member of your organisation' },
        { status: 409 },
      )
    }

    const { error: membershipError } = await admin.from('user_organizations').insert({
      user_id: userId,
      organization_id: orgId,
      role: 'staff',
      default_store_id: defaultStoreId,
      ordering_permission: orderingPermission,
    })
    if (membershipError) {
      const duplicate = membershipError.code === '23505'
      return NextResponse.json(
        {
          error: duplicate
            ? 'This user is already a member of your organisation'
            : membershipError.message,
        },
        { status: duplicate ? 409 : 500 },
      )
    }

    const redirectBase = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://portal.theprintroom.nz'
    const { error: otpError } = await admin.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${redirectBase}/callback?next=/welcome`,
        data: inviteMetadata,
      },
    })
    if (otpError) {
      return NextResponse.json({ error: otpError.message }, { status: 500 })
    }

    // Stamp invited_at so any future "Send invites (N)" surface excludes this member.
    await admin
      .from('user_organizations')
      .update({ invited_at: new Date().toISOString() })
      .eq('organization_id', orgId)
      .eq('user_id', userId)

    await recordAuditEvent({
      orgId,
      actorUserId: auth.context.userId,
      action: AUDIT_ACTIONS.MEMBER_INVITE,
      targetType: 'user',
      targetId: userId,
      metadata: {
        email,
        first_name: firstName,
        last_name: lastName,
        role: 'staff',
        default_store_id: defaultStoreId,
        ordering_permission: orderingPermission,
      },
    })

    return NextResponse.json({ user_id: userId, email_sent: true }, { status: 201 })
  }
  ```
- [ ] **Step 4: Run it — expect PASS.** `npx vitest run app/api/team/invite/__tests__/route.test.ts` → 3 passing (all three assert early-return status codes; none reaches Supabase).
- [ ] **Step 5: Commit.** `git commit -am "feat: /api/team/invite — org_admin self-serve staff invite (staff-only guard)"`

> **Decision gate — ordering_permission for studio tenants.** The route accepts any of stock_only/reorder_only/both and defaults 'stock_only'. Studios keep no stock, so a stock_only studio staff can order nothing (the staff EditRoleDialog scopes this via `orderingPermissionOptions(tenantType)`). Before wiring the UI control, decide whether to tenant-scope the option set / default studios to reorder_only, or leave it open. Do NOT silently pick one.

---

### Task: Portal team member-row builder (`lib/team/members.ts`)

Pure builder for the SSR member list on the `/team` page. A portal-local analogue of the staff `src/lib/b2b-accounts/members.ts` `buildMemberRow` (not importable — that lives in the staff repo and pulls staff-only types). Kept pure so `/team/page.tsx` stays a thin SSR shell.

**Files:**
- Create `lib/team/members.ts` (new)
- Create `lib/team/__tests__/members.test.ts` (new)

**Interfaces:**
- Consumes: nothing.
- Produces: `TeamMemberRow`, `TeamMembership`, `TeamProfile`, `buildTeamMemberRow(membership: TeamMembership, profile: TeamProfile | undefined): TeamMemberRow`. `status` = `'active'` when `profile.last_sign_in_at` is set, else `'pending'`.

- [ ] **Step 1: Write the failing test.** Create `lib/team/__tests__/members.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { buildTeamMemberRow } from '../members'

  describe('buildTeamMemberRow', () => {
    it('marks a member who has signed in as active', () => {
      const row = buildTeamMemberRow(
        { user_id: 'u1', role: 'staff', default_store_id: 's1', invited_at: null },
        { id: 'u1', email: 'a@b.co', full_name: 'Ann B', last_sign_in_at: '2026-07-01T00:00:00Z' },
      )
      expect(row.status).toBe('active')
      expect(row.full_name).toBe('Ann B')
    })

    it('marks a provisioned-but-never-signed-in member as pending, blank name → null', () => {
      const row = buildTeamMemberRow(
        { user_id: 'u2', role: 'staff', default_store_id: 's1', invited_at: '2026-07-02T00:00:00Z' },
        { id: 'u2', email: 'c@d.co', full_name: '  ', last_sign_in_at: null },
      )
      expect(row.status).toBe('pending')
      expect(row.full_name).toBeNull()
    })

    it('falls back to (unknown) email when the profile is missing', () => {
      const row = buildTeamMemberRow(
        { user_id: 'u3', role: 'staff', default_store_id: null, invited_at: null },
        undefined,
      )
      expect(row.email).toBe('(unknown)')
    })
  })
  ```
- [ ] **Step 2: Run it — expect FAIL.** `npx vitest run lib/team/__tests__/members.test.ts` → fails: `Failed to resolve import "../members"`.
- [ ] **Step 3: Implement the builder.** Create `lib/team/members.ts`:
  ```ts
  // Portal-local member-row builder for the /team page (org_admin self-serve).
  // Pure + DB-free so it is unit-testable. profiles.last_sign_in_at is mirrored
  // from auth.users by the shared-DB trigger, so no Auth-admin call is needed.

  export interface TeamMemberRow {
    user_id: string
    email: string
    full_name: string | null
    role: string
    status: 'pending' | 'active'
    default_store_id: string | null
    invited_at: string | null
  }

  export interface TeamMembership {
    user_id: string
    role: string
    default_store_id: string | null
    invited_at: string | null
  }

  export interface TeamProfile {
    id: string
    email: string | null
    full_name: string | null
    last_sign_in_at: string | null
  }

  function blankToNull(value: string | null | undefined): string | null {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    return trimmed === '' ? null : trimmed
  }

  export function buildTeamMemberRow(
    membership: TeamMembership,
    profile: TeamProfile | undefined,
  ): TeamMemberRow {
    const lastSignIn = profile?.last_sign_in_at ?? null
    return {
      user_id: membership.user_id,
      email: blankToNull(profile?.email) ?? '(unknown)',
      full_name: blankToNull(profile?.full_name),
      role: membership.role,
      status: lastSignIn ? 'active' : 'pending',
      default_store_id: membership.default_store_id,
      invited_at: membership.invited_at,
    }
  }
  ```
- [ ] **Step 4: Run it — expect PASS.** `npx vitest run lib/team/__tests__/members.test.ts` → 3 passing.
- [ ] **Step 5: Commit.** `git commit -am "feat: portal team member-row builder"`

---

### Task: Wire `canManageUsers` into the portal nav + add Team link

Gives `canManageUsers` its first consumer. Adds a `requiresManageUsers` gate to the nav model and a **Team** item (href `/team`) that renders as a classic Link row (its `iconKey` is not in the hand-drawn SVG set). Uses `canManageUsers` — NOT `requiresOrgAdmin` — so the previously-dormant flag is actually read.

**Files:**
- Modify `lib/nav/portal-nav.ts` (`NavIconKey` lines 3-9; `PortalNavItem` lines 11-19; `NavAccess` lines 22-27; `PORTAL_NAV_ITEMS` append after line 90; `getNavigationItems` lines 93-104)
- Modify `components/layout/Sidebar.tsx` (`getNavigationItems({...})` call lines 33-38; `EXTRA_ICONS` map lines 349-357; add a `TeamIcon` component)
- Modify `lib/nav/__tests__/portal-nav.test.ts` (helper lines 4-11; add a describe block)

**Interfaces:**
- Consumes: `B2BCustomerAccess.canManageUsers` (already set = `isOrgAdmin` in lib/company.ts buildAccess line 229).
- Produces: `NavAccess` gains required `canManageUsers: boolean`; `PortalNavItem` gains optional `requiresManageUsers?: boolean`; `NavIconKey` gains `'team'`; a nav item at `/team`.

- [ ] **Step 1: Write the failing nav tests.** In `lib/nav/__tests__/portal-nav.test.ts`, update the helper (lines 4-11) to include the new field:
  ```ts
  function access(over: Partial<NavAccess> = {}): NavAccess {
    return {
      isCompanyUser: over.isCompanyUser ?? true,
      canUseLeavers: over.canUseLeavers ?? false,
      isOrgAdmin: over.isOrgAdmin ?? false,
      canManageUsers: over.canManageUsers ?? false,
      tenantType: 'tenantType' in over ? over.tenantType! : 'franchise',
    }
  }
  ```
  Then append a new describe block at the end of the file:
  ```ts
  describe('getNavigationItems — Team gating (canManageUsers)', () => {
    it('shows Team to a company org_admin who can manage users', () => {
      expect(hrefs(access({ canManageUsers: true }))).toContain('/team')
    })
    it('hides Team from a member who cannot manage users', () => {
      expect(hrefs(access({ canManageUsers: false }))).not.toContain('/team')
    })
    it('hides Team from an individual with no company', () => {
      expect(hrefs(access({ isCompanyUser: false, canManageUsers: true }))).not.toContain('/team')
    })
  })
  ```
- [ ] **Step 2: Run it — expect FAIL.** `npx vitest run lib/nav/__tests__/portal-nav.test.ts` → the helper now references `canManageUsers` on `NavAccess` (compile error / type failure) and the Team assertions fail (no `/team` item yet).
- [ ] **Step 3: Extend the nav model.** In `lib/nav/portal-nav.ts`:
  - Add `'team'` to `NavIconKey` (lines 3-9):
    ```ts
    export type NavIconKey =
      | 'tracking'
      | 'catalogue'
      | 'orders'
      | 'proofs'
      | 'leavers'
      | 'inventory'
      | 'team'
    ```
  - Add `requiresManageUsers?: boolean` to `PortalNavItem`. Current (lines 11-19):
    ```ts
    export interface PortalNavItem {
      name: string
      href: string
      iconKey: NavIconKey
      requiresCompany: boolean
      requiresLeavers: boolean
      requiresOrgAdmin: boolean
      requiredTenantTypes: ReadonlyArray<TenantType> | null
    }
    ```
    New — insert one line after `requiresOrgAdmin`:
    ```ts
      requiresOrgAdmin: boolean
      /** F2 — gates the Team link on B2BCustomerAccess.canManageUsers. Optional so existing items need no edit. */
      requiresManageUsers?: boolean
      requiredTenantTypes: ReadonlyArray<TenantType> | null
    ```
  - Add `canManageUsers` to `NavAccess` (lines 22-27):
    ```ts
    export interface NavAccess {
      isCompanyUser: boolean
      canUseLeavers: boolean
      isOrgAdmin: boolean
      canManageUsers: boolean
      tenantType: TenantType | null
    }
    ```
  - Append the Team item to `PORTAL_NAV_ITEMS` (after the Leavers Quotes item, before the closing `]`):
    ```ts
      {
        name: 'Team',
        href: '/team',
        iconKey: 'team',
        requiresCompany: true,
        requiresLeavers: false,
        requiresOrgAdmin: false,
        requiresManageUsers: true,
        requiredTenantTypes: null,
      },
    ```
  - Add the filter line in `getNavigationItems` (after the `requiresOrgAdmin` check, line 97):
    ```ts
        if (item.requiresOrgAdmin && !access.isOrgAdmin) return false
        if (item.requiresManageUsers && !access.canManageUsers) return false
    ```
- [ ] **Step 4: Run the nav test — expect PASS.** `npx vitest run lib/nav/__tests__/portal-nav.test.ts` → all passing (existing Inventory tests still green; the helper's `canManageUsers` defaults false so Team never leaks into them).
- [ ] **Step 5: Wire Sidebar to pass the flag + register the icon.** In `components/layout/Sidebar.tsx`:
  - Update the `getNavigationItems` call (lines 33-38):
    ```ts
    const navigation = getNavigationItems({
      isCompanyUser: customer.isCompanyUser,
      canUseLeavers: customer.canUseLeavers,
      isOrgAdmin: customer.isOrgAdmin,
      canManageUsers: customer.canManageUsers,
      tenantType: customer.tenantType,
    })
    ```
  - Add `team` to `EXTRA_ICONS` (the map is typed `Record<NavIconKey, ...>`, so this is required for the build). Current (lines 349-357):
    ```ts
    const EXTRA_ICONS: Record<NavIconKey, (p: { className?: string }) => React.ReactElement> = {
      tracking: TrackerIcon,
      catalogue: CatalogueIcon,
      orders: OrdersIcon,
      proofs: ProofsIcon,
      leavers: LeaversIcon,
      inventory: InventoryIcon,
    }
    ```
    Add the entry:
    ```ts
      inventory: InventoryIcon,
      team: TeamIcon,
    }
    ```
  - Add a `TeamIcon` component next to the other icon components (e.g. after `InventoryIcon`):
    ```tsx
    function TeamIcon({ className }: { className?: string }) {
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.75}
            d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6 0a3 3 0 10-2.5-1.35"
          />
        </svg>
      )
    }
    ```
- [ ] **Step 6: Verify the Sidebar test still passes.** `npx vitest run components/layout/__tests__/Sidebar.test.tsx` → still green (the fixture already sets `canManageUsers`; Team is a classic Link, not an `a[data-row]` SVG row, so the primary-row assertions are unaffected).
- [ ] **Step 7: Commit.** `git commit -am "feat: consume canManageUsers to gate a Team nav link"`

---

### Task: `/team` page + client invite UI (gated on canManageUsers)

The customer-facing surface. Server component guards on `canManageUsers` (its second consumer, at the page layer) and SSR-loads members + stores; the client renders the member list and an invite form that POSTs to `/api/team/invite`, then `router.refresh()`. Built from native elements + the portal's Tailwind conventions (`card-elevated`, `btn-primary`) since the portal has no shared UI kit.

**Files:**
- Create `app/(portal)/team/page.tsx` (new)
- Create `app/(portal)/team/TeamClient.tsx` (new)
- Create `app/(portal)/team/__tests__/TeamClient.test.tsx` (new)

**Interfaces:**
- Consumes: `getCompanyAccess(userId, email?)` from `@/lib/company` (`access.canManageUsers`, `access.companyId`, `access.companyName`); `getSupabaseServerComponent()` / `getSupabaseServer()`; `buildTeamMemberRow` + `TeamProfile` from `@/lib/team/members`; the `POST /api/team/invite` contract.
- Produces: `TeamClient(props: { organizationName: string; initialMembers: TeamMemberRow[]; stores: { id: string; name: string | null }[] })`.

- [ ] **Step 1: Write the failing client test.** The portal already uses `@testing-library/react` (see `components/layout/__tests__/Sidebar.test.tsx`). Create `app/(portal)/team/__tests__/TeamClient.test.tsx`:
  ```tsx
  import { render, screen } from '@testing-library/react'
  import { describe, it, expect, vi } from 'vitest'
  import { TeamClient } from '../TeamClient'

  vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

  describe('TeamClient', () => {
    it('blocks inviting until the org has a store', () => {
      render(<TeamClient organizationName="Acme" initialMembers={[]} stores={[]} />)
      expect(screen.getByText(/add a store/i)).toBeTruthy()
    })

    it('disables Send invite until email, first name and store are chosen', () => {
      render(
        <TeamClient
          organizationName="Acme"
          initialMembers={[]}
          stores={[{ id: 's1', name: 'HQ' }]}
        />,
      )
      const btn = screen.getByRole('button', { name: /send invite/i }) as HTMLButtonElement
      expect(btn.disabled).toBe(true)
    })
  })
  ```
- [ ] **Step 2: Run it — expect FAIL.** `npx vitest run app/(portal)/team/__tests__/TeamClient.test.tsx` → fails: `Failed to resolve import "../TeamClient"`.
- [ ] **Step 3: Implement the client.** Create `app/(portal)/team/TeamClient.tsx`:
  ```tsx
  'use client'

  import { useState } from 'react'
  import { useRouter } from 'next/navigation'
  import type { TeamMemberRow } from '@/lib/team/members'

  interface StoreOption {
    id: string
    name: string | null
  }

  interface TeamClientProps {
    organizationName: string
    initialMembers: TeamMemberRow[]
    stores: StoreOption[]
  }

  type OrderingPermission = 'stock_only' | 'reorder_only' | 'both'

  export function TeamClient({ organizationName, initialMembers, stores }: TeamClientProps) {
    const router = useRouter()
    const [email, setEmail] = useState('')
    const [firstName, setFirstName] = useState('')
    const [lastName, setLastName] = useState('')
    const [defaultStoreId, setDefaultStoreId] = useState('')
    const [permission, setPermission] = useState<OrderingPermission>('stock_only')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [message, setMessage] = useState<string | null>(null)

    const noStores = stores.length === 0
    const canSubmit =
      !busy && email.trim() !== '' && firstName.trim() !== '' && defaultStoreId !== ''

    async function submitInvite() {
      setBusy(true)
      setError(null)
      setMessage(null)
      try {
        const r = await fetch('/api/team/invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email,
            first_name: firstName,
            last_name: lastName,
            default_store_id: defaultStoreId,
            ordering_permission: permission,
          }),
        })
        const body = (await r.json().catch(() => ({}))) as { error?: string }
        if (!r.ok) throw new Error(body.error ?? `Invite failed (${r.status})`)
        setMessage(`Invite sent to ${email.trim().toLowerCase()}`)
        setEmail('')
        setFirstName('')
        setLastName('')
        setDefaultStoreId('')
        setPermission('stock_only')
        router.refresh()
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setBusy(false)
      }
    }

    return (
      <div className="space-y-8">
        <header>
          <h1 className="text-2xl font-semibold text-gray-900">Team</h1>
          <p className="mt-1 text-sm text-gray-500">
            Invite staff members to {organizationName}. Staff see only their own orders and
            ship to their default store.
          </p>
        </header>

        <section className="card-elevated p-6">
          <h2 className="text-lg font-medium text-gray-900">Invite a staff member</h2>
          {noStores ? (
            <p className="mt-4 rounded-2xl bg-orange-50 px-4 py-3 text-sm text-orange-800">
              Add a store on your Account page before inviting staff — every staff member needs a
              default ship-to store.
            </p>
          ) : (
            <div className="mt-4 space-y-4">
              <label className="block">
                <span className="text-xs uppercase tracking-wide text-gray-500">Email *</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                  placeholder="name@company.co.nz"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs uppercase tracking-wide text-gray-500">First name *</span>
                  <input
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="text-xs uppercase tracking-wide text-gray-500">Last name</span>
                  <input
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                  />
                </label>
              </div>
              <label className="block">
                <span className="text-xs uppercase tracking-wide text-gray-500">
                  Default ship-to store *
                </span>
                <select
                  value={defaultStoreId}
                  onChange={(e) => setDefaultStoreId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                >
                  <option value="">Select store…</option>
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name ?? 'Store'}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs uppercase tracking-wide text-gray-500">
                  Ordering permission
                </span>
                <select
                  value={permission}
                  onChange={(e) => setPermission(e.target.value as OrderingPermission)}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                >
                  <option value="stock_only">Stock only</option>
                  <option value="reorder_only">Reorder only</option>
                  <option value="both">Both</option>
                </select>
              </label>
              {message && (
                <p className="rounded-2xl bg-green-50 px-4 py-3 text-sm text-green-700">{message}</p>
              )}
              {error && (
                <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
              )}
              <button
                type="button"
                onClick={submitInvite}
                disabled={!canSubmit}
                className="btn-primary disabled:opacity-50"
              >
                {busy ? 'Sending…' : 'Send invite'}
              </button>
            </div>
          )}
        </section>

        <section className="card-elevated p-6">
          <h2 className="text-lg font-medium text-gray-900">Members</h2>
          {initialMembers.length === 0 ? (
            <p className="mt-4 text-sm text-gray-500">No members yet.</p>
          ) : (
            <ul className="mt-4 divide-y divide-gray-100">
              {initialMembers.map((m) => (
                <li key={m.user_id} className="flex items-center justify-between py-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-gray-900">{m.email}</p>
                    <p className="truncate text-gray-500">{m.full_name ?? '—'}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700">
                      {m.role === 'org_admin' ? 'Org admin' : 'Staff'}
                    </span>
                    <span
                      className={
                        m.status === 'active'
                          ? 'rounded-full bg-green-100 px-2.5 py-1 text-xs text-green-700'
                          : 'rounded-full bg-amber-100 px-2.5 py-1 text-xs text-amber-800'
                      }
                    >
                      {m.status === 'active' ? 'Active' : 'Pending'}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    )
  }
  ```
- [ ] **Step 4: Run the client test — expect PASS.** `npx vitest run app/(portal)/team/__tests__/TeamClient.test.tsx` → 2 passing.
- [ ] **Step 5: Implement the server page.** Create `app/(portal)/team/page.tsx` (mirrors the org_admin server-guard pattern in `app/(portal)/inventory/page.tsx`):
  ```tsx
  import type { Metadata } from 'next'
  import { redirect } from 'next/navigation'
  import { getSupabaseServerComponent } from '@/lib/supabase-server-component'
  import { getSupabaseServer } from '@/lib/supabase'
  import { getCompanyAccess } from '@/lib/company'
  import { buildTeamMemberRow, type TeamProfile } from '@/lib/team/members'
  import { TeamClient } from './TeamClient'

  export const metadata: Metadata = { title: 'Team' }

  export default async function TeamPage() {
    const authed = await getSupabaseServerComponent()
    const {
      data: { user },
    } = await authed.auth.getUser()
    if (!user) redirect('/sign-in')

    const access = await getCompanyAccess(user.id, user.email ?? undefined)
    // canManageUsers is the F2 gate: only a company org_admin reaches this page.
    if (!access || !access.canManageUsers || !access.companyId) redirect('/account')

    const admin = getSupabaseServer()
    const orgId = access.companyId

    const [{ data: memberships }, { data: stores }] = await Promise.all([
      admin
        .from('user_organizations')
        .select('user_id, role, default_store_id, invited_at')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: true }),
      admin.from('stores').select('id, name').eq('organization_id', orgId).order('name'),
    ])

    const userIds = (memberships ?? []).map((m) => m.user_id)
    const { data: profiles } = userIds.length
      ? await admin
          .from('profiles')
          .select('id, email, full_name, last_sign_in_at')
          .in('id', userIds)
      : { data: [] as TeamProfile[] }

    const profileById = new Map(
      (profiles ?? []).map((p) => [(p as TeamProfile).id, p as TeamProfile]),
    )
    const members = (memberships ?? []).map((m) => buildTeamMemberRow(m, profileById.get(m.user_id)))

    return (
      <div className="min-h-screen bg-[#FAFAFA]">
        <div className="mx-auto max-w-[1320px] px-6 pt-[120px] pb-16">
          <TeamClient
            organizationName={access.companyName ?? 'your organisation'}
            initialMembers={members}
            stores={(stores ?? []) as { id: string; name: string | null }[]}
          />
        </div>
      </div>
    )
  }
  ```
- [ ] **Step 6: Type-check the new surface.** `npx tsc --noEmit` (from the portal root) → no new errors. Confirms the page's Supabase row shapes line up with `TeamMembership` / `TeamProfile`.
- [ ] **Step 7: Manual smoke (real invite).** Sign in as a franchise org_admin with at least one store. Visit `/team` → invite **jamie@theprint-room.co.nz** (never jon@) with a default store selected. Confirm: 201 + "Invite sent"; a `user_organizations` row with `role='staff'`, the chosen `default_store_id`, `invited_at` stamped; an `audit_events` row `action='member.invite'`; and one branded sign-in email lands at jamie@. Then confirm a **staff** user gets 403 from `/team` (redirect to /account) and cannot POST `/api/team/invite`.
- [ ] **Step 8: Commit.** `git commit -am "feat: /team self-serve staff invites for org admins"`

> **Decision gate — ship posture.** Per the cluster brief the full self-serve UI (F2) stays deferred behind the Thursday slice. If shipping dark, keep the Team nav item removable by leaving `requiresManageUsers` off the item (the route + page stay reachable by URL for QA but no nav entry appears). Confirm whether F2 ships with the nav link visible or dark before merge.

---

## Open threads / decision gates

- **[thursday-critical-staff-default-invite]** 'First/primary contact = org_admin, everyone else = staff' is implemented as the heuristic memberCount===0 (no members on the account yet). There is no explicit primary-contact flag on organizations, so this is a best-effort default that the inviter can override in the dialog. If the business wants a firmer 'designated primary contact' concept, this needs revisiting — assumption, NOT a blocker for Thursday.
- **[thursday-critical-staff-default-invite]** ordering_permission is deliberately left to its DB default 'stock_only' for staff invites (yields the required stock-on-hand-only behaviour with no extra UI). If staff should sometimes onboard as 'reorder_only'/'both', the invite would need an extra control — deferred, out of this narrow slice.
- **[thursday-critical-staff-default-invite]** Downstream staff UX ('no pill, no tracker') is driven by role='staff' in the CUSTOMER portal (P) and is already in place; it is out of scope for this staff-portal invite slice. This slice only ensures Doc's people are created with role='staff' + a default_store_id.
- **[thursday-critical-staff-default-invite]** The full customer-facing self-serve invite UI (F2) stays deferred per the spec; this is the NARROW staff-initiated slice only.
- **[prepaid-tag-customer-display-xero-pickfee]** DECISION GATE (pick-fee scope): does the picking fee apply to ALL orders, stock-on-hand-only, or prepaid-only? Plan defaults to stock-on-hand orders (any line with qty_from_stock>0 / fulfilment_type='stocked'), matching spec (c) 'push EVERY stock-on-hand order to Xero ... add the picking fee on a separate line'. Confirm before wiring which orders get the fee.
- **[prepaid-tag-customer-display-xero-pickfee]** DECISION GATE (pick-fee region): the band table ($0-99=$35 ... $400+=$15) is NZ-only. Behaviour for non-NZ orders (different currency/GST) is undecided. pickingFeeForGoods is written NZD-only; a region param is a follow-up.
- **[prepaid-tag-customer-display-xero-pickfee]** DECISION GATE (pick-fee band input): which figure drives the band lookup — goods ex-GST (grossSubtotal, plan's assumption) vs goods incl-GST vs order total. Plan uses grossSubtotal (goods, ex-GST).
- **[prepaid-tag-customer-display-xero-pickfee]** DECISION GATE (Xero eligibility reversal): Spec B supersedes Spec A item 15. Plan REMOVES the blanket draws_stock->manual_review gate so stock-on-hand orders now draft. Undecided: does org-level payment_terms='prepay' (prepay_org gate) ALSO get dropped now that per-product billing_mode is authoritative, or does it still force manual_review? Plan keeps prepay_org for now and flags it.
- **[prepaid-tag-customer-display-xero-pickfee]** DECISION GATE (Xero prepaid-line matching): how a persisted quote_items row is matched to its prepaid/stocked billing at draft time — in-memory line-billing map passed from submit.ts keyed by makeLineKey (plan's primary, no extra migration) vs a new quote_items.billing_mode snapshot column (needs a portal migration + apply coordination on the shared prod DB). Confirm before implementing the Xero wiring step.
- **[prepaid-tag-customer-display-xero-pickfee]** DECISION GATE (Monday note supersession): Spec B item (d) supersedes Spec A item 11's flat note. The exact insertion point depends on where Spec A's push-with-note flow posts its note — plan wires orderBillingNote into that flow by name; confirm Spec A's note callsite when it lands.
- **[prepaid-tag-customer-display-xero-pickfee]** Thursday staff-default invite is API-level only (role choice + default_store_id on POST /api/b2b-accounts/[id]/invite). The staff-portal invite UI still needs a role selector + store picker to send default_store_id — that UI is out of this narrow slice's scope (full self-serve F2 stays deferred).
- **[prepaid-tag-customer-display-xero-pickfee]** OUT OF SCOPE / EXTERNAL BLOCKER: Starshipit account ownership (fresh portal-owned vs consolidate the live 'Print Room Dispatch' account) is a blocking external decision noted in the brief but not touched by this cluster's code.
- **[item-12-starshipit-dispatch]** DECISION GATE (blocking, external): Starshipit account ownership — fresh portal-owned account vs consolidate the live 'Print Room Dispatch' account (629 unmatched rows keyed to old Shopify #PR numbers). Must be decided before STARSHIPIT_ENABLED is flipped on.
- **[item-12-starshipit-dispatch]** Double-registration risk: if the studio Monday-fed sync (POST /api/orders/shipped when a Monday tracking link appears) AND the portal push-at-placement (POST /api/orders) both target the SAME Starshipit account, an order can be registered twice → duplicate manifests, duplicate webhooks, duplicate emails. Account choice must resolve this.
- **[item-12-starshipit-dispatch]** DECISION GATE: supersede vs supplement the Monday-fed pipe — governs whether the portal webhook additionally flips job_trackers.status to 'dispatched' and sends sendTrackerStatusEmail, or ONLY writes tracking_info (additive/supplement). Plan ships the supplement (tracking_info write) as the safe default and leaves the status-flip + email as a gated follow-up step.
- **[item-12-starshipit-dispatch]** Starshipit POST /api/orders create-order request/response shape is NOT verifiable in-repo (studio only exercises /api/orders/shipped and /api/track). The destination.{name,street,suburb,state,post_code,country,phone,email} field names and the `data.order.order_id` response path in createStarshipitOrder MUST be confirmed against Starshipit's live API docs before enabling; the function is dark-by-default so an imperfect payload never touches production.
- **[item-12-starshipit-dispatch]** Confirm the shared Supabase project does not already contain starshipit_webhook_logs (from the studio integration) before applying the portal migration — it is CREATE IF NOT EXISTS so it is safe either way, but list_tables should be checked.
- **[item-12-starshipit-dispatch]** order_type threading: Spec A adds orders.order_type but does not (yet) thread it into CheckoutInput/B2BCustomerContext at submit time; interim eligibility uses input.intent ('inventory' skips). Pass the real order_type into pushOrderToStarshipit once Spec A exposes it.
- **[item-12-starshipit-dispatch]** Picking-fee / billing_mode decisions are out of scope for this cluster (Item 12) — no changes here.
- **[F1]** DECISION GATE — Spec A dependency: F1's route calls submitCustomerOrder with `order_type: 'stock_on_hand'` and relies on Spec A to (a) add the `orders.order_type` column, (b) branch the Monday push into the lighter push-with-note flow for stock_on_hand, and (c) fire the order-placed notification (Slack + email) abstraction. These do NOT exist in the portal repo yet. F1 threads the order_type VALUE only; it must NOT fabricate the push-with-note/notification branching. Confirm Spec A has landed before merging F1's route task, or coordinate the field addition to avoid a duplicate.
- **[F1]** DECISION — legacy/absent fulfilment_type routing: partitionCheckoutLines routes a line with an ABSENT `fulfilment_type` (legacy persisted carts, reorder rebuilds) into the `purchase_order` partition, matching submit_b2b_order's MOQ-conservative treatment (absent counts toward production). Note the CartLine JSDoc says absent → 'treat as stocked' for UI oversell purposes — the two defaults intentionally differ. Confirm purchase_order is the desired order_type default for absent lines.
- **[F1]** DECISION GATE (deferred UX) — two-order confirmation surface: the route returns BOTH orders (`orders[]`) but redirects the customer to the PRIMARY (purchase_order when present) confirmation page only. A confirmation view that shows both split orders is out of scope for this slice; decide whether it is needed before GA.
- **[F1]** LABEL WORDING: the selector reuses PILL_LABELS ('Stock on hand' / 'Purchase order') for DRY consistency with the PDP/catalogue. The spec text said 'Stock order' — trivial product-copy decision; flag if 'Stock order' wording is required instead.
- **[F1]** interaction intent='inventory' × order_type='stock_on_hand': an admin choosing add-to-my-inventory (intent='inventory') AND a stock-draw line is a contradictory combination. v1 passes intent through to both partitions unchanged and does not special-case this; confirm whether inventory-intent carts should suppress the stock partition.
- **[F1]** PARTIAL-COMMIT: with a mixed cart the two submitCustomerOrder calls run sequentially (purchase_order first). If the first commits and the second throws (drift/MOQ/stock), one order exists and the client shows an error. Retry is safe because each partition uses a distinct idempotency key suffix (`:po` / `:stock`) that submit_b2b_order dedupes. Accepted for v1; noted for reviewer awareness.
- **[F1]** This cluster does NOT include the Thursday-critical staff-default invite slice (that narrow invite slice lives elsewhere in Spec B) nor the billing-tag / picking-fee / Starshipit decisions — those are separate Spec B items and out of F1 scope.
- **[F2]** DECISION GATE — ordering_permission default for studio tenants. Studios keep no stock, so a staff member invited with the plan's default `ordering_permission: 'stock_only'` could order nothing. The staff EditRoleDialog handles this via `orderingPermissionOptions(tenantType)` (studio → reorder_only only). F2 needs a product decision: (a) mirror that tenant-scoping in the portal invite UI/API, (b) default studio invites to 'reorder_only', or (c) leave the control fully open and let staff correct it later. Plan currently exposes all three and defaults 'stock_only' — flagged, not resolved.
- **[F2]** DECISION — immediate vs deferred send. The plan sends the branded sign-in OTP immediately on invite (mirrors the staff single-invite route). If self-serve should instead adopt the staff 'Send invites (N)' batching model (provision now, email later via invited_at), that is a separate build. Confirm immediate-send is acceptable for org-admin self-serve.
- **[F2]** SCOPE — F2 covers invite/ADD of new staff only. Editing an existing member's role or promoting staff↔org_admin from the customer portal is intentionally out of scope (stays staff-side in the staff portal). The hard guard forbids minting org_admins; confirm no portal-side role-editing is wanted in this slice.
- **[F2]** ENV — the invite route's emailRedirectTo uses process.env.NEXT_PUBLIC_SITE_URL (falls back to https://portal.theprintroom.nz). Verify NEXT_PUBLIC_SITE_URL is set on the customer portal before shipping, otherwise invite links resolve to the hardcoded prod origin.
- **[F2]** Manual smoke-test invites must be sent to jamie@theprint-room.co.nz (never jon@), per the test-email rule.

**Standing Decision gates (from the spec, must be resolved before the relevant task):**
- **Starshipit account ownership** — fresh portal-owned setup vs redirect/consolidate the existing "Print Room Dispatch" account (629 unmatched rows). Blocks item 12; double-registration risk if both studio + portal receivers run against one account.
- **Starshipit vs Monday tracking** — decide whether Starshipit tracking supersedes or supplements the Spec A Monday-fed pipe.
- **Picking-fee region** — NZ band table only; decide behaviour for other regions (per-region tables vs NZ-only for now).
- **Picking-fee scope** — applies to all orders, stock-on-hand only, or prepaid only?
- **Prepaid supersessions** — this block reverses Spec A item 15 (Xero fires for every order) and Spec A item 11 (flat Monday note); confirm both Spec A pieces are shipped before layering prepaid on top.
