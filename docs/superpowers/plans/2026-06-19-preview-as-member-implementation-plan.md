# Preview as Member — Implementation Plan (Phase 1: real members)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only "Preview only" button in the staff portal that opens the customer portal rendered exactly as a chosen org member sees it (their grants, role, ordering permission, tenant behaviour, pricing), including the still-draft item being edited — without ever placing a real order.

**Architecture:** Staff portal mints a short-lived HMAC-signed token naming (org, membership). The customer portal verifies it, sets a signed `pr_preview` session cookie, and — at its two existing service-role context resolvers (`requireB2BCustomer*` and `getCompanyAccess` callers) — builds the *target member's* context instead of the logged-in user's. The write gate rejects the preview cookie, so the walkthrough is read-only.

**Tech Stack:** Next.js (App Router, both repos — note staff portal's `AGENTS.md`: "this is NOT the Next.js you know"), TypeScript, Supabase (service-role server client), Node `crypto` HMAC, Vitest.

**Source spec:** `C:\Users\MSI\.claude\plans\2026-06-19-preview-as-member-design.md`

---

## Pre-flight (do once, before Task 1)

- [ ] **Branch safety (CRITICAL — both repos auto-push the checked-out branch to its upstream).** In each repo create the feature branch and detach its upstream so the harness can't push to prod:
  - `print-room-portal`: `git checkout -b feat/preview-as-member` then `git branch --unset-upstream`
  - `print-room-staff-portal`: `git checkout -b feat/preview-as-member` then `git branch --unset-upstream`
  - Verify with `git status -sb` — the branch line must show **no** `...origin/...` tracking. Never commit on a `master`/`main`-tracking branch. Subagents must not run git checkout.
- [ ] **Staff portal docs gate:** before writing any `.tsx` in `print-room-staff-portal`, read `docs/ui/oem-rules.md` (mandatory pre-flight checklist) and skim the relevant guide under `node_modules/next/dist/docs/`.
- [ ] **Env:** add `PREVIEW_TOKEN_SECRET` to BOTH apps (same value). Generate once: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. `CUSTOMER_PORTAL_URL` already exists in the staff portal. See Task 19.
- [ ] **Test runner:** `npx vitest run <path>` in each repo. Commit messages end with the trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Commit only (no push).

**Token contract (shared, identical in both repos):**

```ts
export interface PreviewTarget { kind: 'member'; membershipId: string }
export interface PreviewPayload {
  v: 1
  org: string                       // organization_id
  target: PreviewTarget
  itemId?: string                   // b2b_catalogue_items.id being edited (editor launch only)
  productId?: string                // source_product_id, for the PDP redirect (editor launch only)
  purpose: 'preview' | 'preview-session'
  iat: number                       // unix seconds
  exp: number                       // unix seconds
  nonce: string
}
```
- Launch token: `purpose:'preview'`, `exp = iat + 600` (10 min), minted by staff.
- Session cookie: `purpose:'preview-session'`, `exp = iat + 1800` (30 min), minted by `/preview` after verifying the launch token.

---

## Task 1: Customer portal — token sign/verify util

**Files:**
- Create: `print-room-portal/lib/preview/token.ts`
- Test: `print-room-portal/lib/preview/token.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// print-room-portal/lib/preview/token.test.ts
import { describe, it, expect } from 'vitest'
import { signPreviewToken, verifyPreviewToken, newNonce, type PreviewPayload } from './token'

const SECRET = 'test-secret-aaaaaaaaaaaaaaaaaaaaaaaa'
const NOW = 1_000_000

function launch(over: Partial<PreviewPayload> = {}): PreviewPayload {
  return {
    v: 1,
    org: 'org-1',
    target: { kind: 'member', membershipId: 'mem-1' },
    purpose: 'preview',
    iat: NOW,
    exp: NOW + 600,
    nonce: 'n1',
    ...over,
  }
}

describe('preview token', () => {
  it('round-trips a valid token', () => {
    const t = signPreviewToken(launch(), SECRET)
    expect(verifyPreviewToken(t, SECRET, NOW, 'preview')).toMatchObject({ org: 'org-1' })
  })
  it('rejects a tampered body', () => {
    const t = signPreviewToken(launch(), SECRET)
    const tampered = 'x' + t.slice(1)
    expect(verifyPreviewToken(tampered, SECRET, NOW, 'preview')).toBeNull()
  })
  it('rejects a wrong secret', () => {
    const t = signPreviewToken(launch(), SECRET)
    expect(verifyPreviewToken(t, 'other-secret', NOW, 'preview')).toBeNull()
  })
  it('rejects an expired token', () => {
    const t = signPreviewToken(launch({ exp: NOW - 1 }), SECRET)
    expect(verifyPreviewToken(t, SECRET, NOW, 'preview')).toBeNull()
  })
  it('rejects the wrong purpose', () => {
    const t = signPreviewToken(launch(), SECRET)
    expect(verifyPreviewToken(t, SECRET, NOW, 'preview-session')).toBeNull()
  })
  it('rejects malformed input', () => {
    expect(verifyPreviewToken('garbage', SECRET, NOW, 'preview')).toBeNull()
    expect(verifyPreviewToken('a.b.c', SECRET, NOW, 'preview')).toBeNull()
  })
  it('newNonce returns a non-empty string', () => {
    expect(newNonce().length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd print-room-portal && npx vitest run lib/preview/token.test.ts`
Expected: FAIL — "Cannot find module './token'".

- [ ] **Step 3: Write minimal implementation**

```ts
// print-room-portal/lib/preview/token.ts
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export interface PreviewTarget { kind: 'member'; membershipId: string }
export interface PreviewPayload {
  v: 1
  org: string
  target: PreviewTarget
  itemId?: string
  productId?: string
  purpose: 'preview' | 'preview-session'
  iat: number
  exp: number
  nonce: string
}

function b64urlEncode(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url')
}
function b64urlDecode(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8')
}

export function newNonce(): string {
  return randomBytes(12).toString('base64url')
}

export function signPreviewToken(payload: PreviewPayload, secret: string): string {
  const body = b64urlEncode(JSON.stringify(payload))
  const sig = createHmac('sha256', secret).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function verifyPreviewToken(
  token: string,
  secret: string,
  nowSec: number,
  expectedPurpose: PreviewPayload['purpose'],
): PreviewPayload | null {
  const dot = token.indexOf('.')
  if (dot <= 0 || token.indexOf('.', dot + 1) !== -1) return null
  const body = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expectedSig = createHmac('sha256', secret).update(body).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expectedSig)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  let payload: PreviewPayload
  try {
    payload = JSON.parse(b64urlDecode(body)) as PreviewPayload
  } catch {
    return null
  }
  if (payload.v !== 1) return null
  if (payload.purpose !== expectedPurpose) return null
  if (typeof payload.exp !== 'number' || payload.exp < nowSec) return null
  if (!payload.org || payload.target?.kind !== 'member' || !payload.target.membershipId) return null
  return payload
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd print-room-portal && npx vitest run lib/preview/token.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/preview/token.ts lib/preview/token.test.ts
git commit -m "feat(preview): HMAC token sign/verify util"
```

---

## Task 2: Staff portal — token sign util (mirror)

**Files:**
- Create: `print-room-staff-portal/src/lib/preview/token.ts`
- Test: `print-room-staff-portal/src/lib/preview/token.test.ts`

The staff portal only needs to **sign** launch tokens, but ship the identical module (sign+verify) so the two stay byte-compatible.

- [ ] **Step 1: Write the failing test**

```ts
// print-room-staff-portal/src/lib/preview/token.test.ts
import { describe, it, expect } from 'vitest'
import { signPreviewToken, verifyPreviewToken, newNonce, type PreviewPayload } from './token'

const SECRET = 'test-secret-aaaaaaaaaaaaaaaaaaaaaaaa'
const NOW = 1_000_000

it('signs a launch token a verifier accepts', () => {
  const payload: PreviewPayload = {
    v: 1, org: 'org-1', target: { kind: 'member', membershipId: 'mem-1' },
    itemId: 'item-1', productId: 'prod-1', purpose: 'preview',
    iat: NOW, exp: NOW + 600, nonce: newNonce(),
  }
  const t = signPreviewToken(payload, SECRET)
  expect(verifyPreviewToken(t, SECRET, NOW, 'preview')).toMatchObject({ itemId: 'item-1', productId: 'prod-1' })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd print-room-staff-portal && npx vitest run src/lib/preview/token.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Copy the EXACT contents of `print-room-portal/lib/preview/token.ts` (from Task 1, Step 3) into `print-room-staff-portal/src/lib/preview/token.ts`. Byte-identical — the HMAC must match across repos.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd print-room-staff-portal && npx vitest run src/lib/preview/token.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/preview/token.ts src/lib/preview/token.test.ts
git commit -m "feat(preview): token util (staff signer)"
```

---

## Task 3: Customer portal — preview cookie/session helper

**Files:**
- Create: `print-room-portal/lib/preview/cookie.ts`

Reads use `cookies()` (allowed in RSC + route handlers). Routes that set/clear the cookie do so on the `NextResponse` (Task 7).

- [ ] **Step 1: Write the implementation** (thin wrapper over Task 1; no unit test — exercised by the route + integration smoke)

```ts
// print-room-portal/lib/preview/cookie.ts
import { cookies } from 'next/headers'
import { signPreviewToken, verifyPreviewToken, type PreviewPayload } from '@/lib/preview/token'

export const PREVIEW_COOKIE = 'pr_preview'
export const SESSION_TTL_SEC = 30 * 60

export const sessionCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: SESSION_TTL_SEC,
}

function secret(): string {
  const s = process.env.PREVIEW_TOKEN_SECRET
  if (!s) throw new Error('PREVIEW_TOKEN_SECRET is not set')
  return s
}

/** Re-sign a verified launch payload as a 30-min session token (for the cookie). */
export function buildSessionToken(launch: PreviewPayload, nowSec: number): string {
  const session: PreviewPayload = {
    ...launch,
    purpose: 'preview-session',
    iat: nowSec,
    exp: nowSec + SESSION_TTL_SEC,
  }
  return signPreviewToken(session, secret())
}

/** Read + verify the preview-session cookie. Returns null when absent/invalid/expired. */
export async function readPreviewSession(nowSec: number): Promise<PreviewPayload | null> {
  const store = await cookies()
  const raw = store.get(PREVIEW_COOKIE)?.value
  if (!raw) return null
  return verifyPreviewToken(raw, secret(), nowSec, 'preview-session')
}
```

- [ ] **Step 2: Typecheck**

Run: `cd print-room-portal && npx tsc --noEmit`
Expected: no new errors from `lib/preview/cookie.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/preview/cookie.ts
git commit -m "feat(preview): session cookie helper"
```

---

## Task 4: Customer portal — preview context resolver

**Files:**
- Create: `print-room-portal/lib/preview/context.ts`

Builds the **target member's** `B2BCustomerContext` (server) and `B2BCustomerAccess` (client) via the service-role client. Mirrors `requireB2BCustomer`'s query block, keyed by `membershipId` instead of `user_id`. **Deliberately bug-for-bug faithful** to `requireB2BCustomer` (e.g. the `org` select omits `moq_exempt`, so `moqExempt` resolves false in normal operation — preview matches that) so a preview reflects what the member actually gets.

> Depends on `B2BCustomerContext` gaining `isPreview`/`previewItemId` and `B2BCustomerAccess` gaining `isPreview`/`previewAs` — those type edits are in Task 5 and Task 6. Implement this file now; the `tsc` check passes after Task 5/6 land. (Order 5 → 6 → re-typecheck 4 if you prefer green-at-every-step; functionally independent.)

- [ ] **Step 1: Write the implementation**

```ts
// print-room-portal/lib/preview/context.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseServer } from '@/lib/supabase'
import { getCompanyAccess } from '@/lib/company'
import type { B2BCustomerContext } from '@/lib/checkout/server'
import type { B2BCustomerAccess } from '@/types/company'
import type { PreviewPayload } from '@/lib/preview/token'

/** Server context (catalogue/PDP/checkout pages) for the previewed member. */
export async function buildPreviewContext(
  admin: SupabaseClient,
  payload: PreviewPayload,
): Promise<{ admin: SupabaseClient; context: B2BCustomerContext } | null> {
  const { data: membership } = await admin
    .from('user_organizations')
    .select('id, user_id, organization_id, default_store_id, role, ordering_permission')
    .eq('id', payload.target.membershipId)
    .maybeSingle()
  if (!membership || membership.organization_id !== payload.org) return null

  // Mirror requireB2BCustomer's selects exactly (note: org select omits moq_exempt).
  const [{ data: org }, { data: b2b }, { data: stores }, { data: profile }] = await Promise.all([
    admin.from('organizations').select('id, name, customer_code').eq('id', membership.organization_id).single(),
    admin.from('b2b_accounts')
      .select('id, tier_level, payment_terms, default_deposit_percent, contract_notes, tenant_type, pricing_mode')
      .eq('organization_id', membership.organization_id).maybeSingle(),
    admin.from('stores').select('id').eq('organization_id', membership.organization_id),
    admin.from('profiles').select('email, full_name').eq('id', membership.user_id).maybeSingle(),
  ])
  if (!org) return null

  const context: B2BCustomerContext = {
    userId: membership.user_id,
    membershipId: membership.id,
    role: ((membership as { role?: string }).role === 'staff' ? 'staff' : 'org_admin'),
    email: profile?.email ?? '',
    fullName: profile?.full_name ?? '',
    organizationId: org.id,
    organizationName: org.name,
    customerCode: org.customer_code,
    b2bAccountId: b2b?.id ?? null,
    tierLevel: b2b?.tier_level ?? null,
    paymentTerms: b2b?.payment_terms ?? null,
    contractNotes: (b2b as { contract_notes?: string | null } | null)?.contract_notes ?? null,
    pricingMode: (b2b as { pricing_mode?: string | null } | null)?.pricing_mode ?? null,
    defaultDepositPercent: b2b?.default_deposit_percent ?? null,
    storeIds: (stores ?? []).map((s) => s.id),
    defaultStoreId: membership.default_store_id ?? null,
    tenantType: (b2b as { tenant_type?: B2BCustomerContext['tenantType'] } | null)?.tenant_type ?? null,
    allowsMultiStoreOrdering:
      (b2b as { tenant_type?: B2BCustomerContext['tenantType'] } | null)?.tenant_type === 'studio_plus_inventory',
    moqExempt: false,
    orderingPermission:
      ((membership as { ordering_permission?: string }).ordering_permission as
        B2BCustomerContext['orderingPermission'] | undefined) ?? 'stock_only',
    isPreview: true,
    previewItemId: payload.itemId ?? null,
  }
  return { admin, context }
}

/** Client access (CompanyContext → cart key, banner, role-gated UI) for the previewed member. */
export async function buildPreviewAccess(payload: PreviewPayload): Promise<B2BCustomerAccess | null> {
  const admin = getSupabaseServer()
  const { data: membership } = await admin
    .from('user_organizations')
    .select('user_id, organization_id, role, ordering_permission')
    .eq('id', payload.target.membershipId)
    .maybeSingle()
  if (!membership || membership.organization_id !== payload.org) return null

  const { data: profile } = await admin
    .from('profiles').select('full_name').eq('id', membership.user_id).maybeSingle()

  const access = await getCompanyAccess(membership.user_id)
  // getCompanyAccess resolves the user's single membership; guard against a
  // multi-membership user resolving to a different org than the preview target.
  if (!access || access.companyId !== payload.org) return null

  return {
    ...access,
    isPreview: true,
    previewAs: {
      name: profile?.full_name || access.email || 'member',
      role: membership.role === 'staff' ? 'staff' : 'org_admin',
      orderingPermission:
        ((membership.ordering_permission as 'stock_only' | 'reorder_only' | 'both') ?? 'stock_only'),
    },
  }
}
```

- [ ] **Step 2: Commit** (typecheck after Task 5/6)

```bash
git add lib/preview/context.ts
git commit -m "feat(preview): target-member context + access builders"
```

---

## Task 5: Customer portal — wire the server read gate + write rejection

**Files:**
- Modify: `print-room-portal/lib/checkout/server.ts`

- [ ] **Step 1: Add preview fields to `B2BCustomerContext`**

In the `interface B2BCustomerContext` block, after the `orderingPermission` field (currently the last field, ~line 45), add:

```ts
  /** True when this context was built for a staff preview (read-only). */
  isPreview?: boolean
  /** Editor-launched preview: the in-edit catalogue item id to force-show on its PDP. */
  previewItemId?: string | null
```

- [ ] **Step 2: Honour the preview cookie in `requireB2BCustomer` (read path)**

At the top of `requireB2BCustomer` (immediately after the `{ requireCustomerCode = false } = {}` signature line, before `const authed = await getSupabaseServerComponent()`), insert:

```ts
  // Preview: a valid staff preview cookie renders the store as the target
  // member via service-role, with no member auth session. Reads only.
  const nowSec = Math.floor(Date.now() / 1000)
  const previewPayload = await readPreviewSession(nowSec)
  if (previewPayload) {
    const previewAdmin = getSupabaseServer()
    const preview = await buildPreviewContext(previewAdmin, previewPayload)
    if (preview) return preview
    // Stale/invalid target — fall through to normal auth.
  }
```

Add the imports at the top of the file:

```ts
import { readPreviewSession } from '@/lib/preview/cookie'
import { buildPreviewContext } from '@/lib/preview/context'
```

- [ ] **Step 3: Reject the preview cookie in `requireB2BCustomerApi` (write path)**

In `requireB2BCustomerApi`, after the `if ('kind' in result) {...}` block and before `return result`, insert:

```ts
  if (result.context.isPreview) {
    return {
      error: NextResponse.json(
        { error: 'Preview only — nothing was saved.' },
        { status: 403 },
      ),
    }
  }
```

- [ ] **Step 4: Typecheck**

Run: `cd print-room-portal && npx tsc --noEmit`
Expected: no new errors (this also greenlights Task 4's `B2BCustomerContext` usage).

- [ ] **Step 5: Commit**

```bash
git add lib/checkout/server.ts
git commit -m "feat(preview): read gate honours preview cookie, write gate rejects it"
```

---

## Task 6: Customer portal — wire the client access path

**Files:**
- Modify: `print-room-portal/types/company.ts`
- Modify: `print-room-portal/lib/portal-data.ts`
- Modify: `print-room-portal/app/api/company-access/route.ts`

- [ ] **Step 1: Add preview fields to `B2BCustomerAccess`**

In `types/company.ts`, inside the `B2BCustomerAccess` interface, after `allowsMultiStoreOrdering` (last field), add:

```ts
  /** True when this access was built for a staff preview (read-only). */
  isPreview?: boolean
  /** Banner copy source — who/what is being previewed. Set only in preview. */
  previewAs?: {
    name: string
    role: 'org_admin' | 'staff'
    orderingPermission: 'stock_only' | 'reorder_only' | 'both'
  }
```

- [ ] **Step 2: Honour preview in the layout's server resolver**

In `lib/portal-data.ts`, replace the body of `getPortalCompanyAccess` (currently lines ~79-83):

```ts
export const getPortalCompanyAccess = cache(async (): Promise<B2BCustomerAccess | null> => {
  const nowSec = Math.floor(Date.now() / 1000)
  const preview = await readPreviewSession(nowSec)
  if (preview) {
    const access = await buildPreviewAccess(preview)
    if (access) return access
  }
  const user = await getPortalUser()
  if (!user) return null
  return getCompanyAccess(user.id, user.email ?? undefined)
})
```

Add imports at the top of `lib/portal-data.ts`:

```ts
import { readPreviewSession } from '@/lib/preview/cookie'
import { buildPreviewAccess } from '@/lib/preview/context'
```

- [ ] **Step 3: Honour preview in the client-fetch API route**

Replace the body of `GET` in `app/api/company-access/route.ts`:

```ts
export async function GET() {
  const nowSec = Math.floor(Date.now() / 1000)
  const preview = await readPreviewSession(nowSec)
  if (preview) {
    const previewAccess = await buildPreviewAccess(preview)
    if (previewAccess) return NextResponse.json(previewAccess)
  }

  const supabase = await getSupabaseServerComponent()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json(null, { status: 401 })

  const access = await getCompanyAccess(user.id, user.email ?? undefined)
  if (!access) return NextResponse.json(null, { status: 404 })
  return NextResponse.json(access)
}
```

Add imports:

```ts
import { readPreviewSession } from '@/lib/preview/cookie'
import { buildPreviewAccess } from '@/lib/preview/context'
```

- [ ] **Step 4: Typecheck**

Run: `cd print-room-portal && npx tsc --noEmit`
Expected: no new errors (also greenlights Task 4's `B2BCustomerAccess` usage).

- [ ] **Step 5: Commit**

```bash
git add types/company.ts lib/portal-data.ts app/api/company-access/route.ts
git commit -m "feat(preview): client access path renders the target member"
```

---

## Task 7: Customer portal — /preview and /preview/exit routes

**Files:**
- Create: `print-room-portal/app/preview/route.ts`
- Create: `print-room-portal/app/preview/exit/route.ts`

These live OUTSIDE `(portal)` so they don't require the portal layout/auth.

- [ ] **Step 1: `/preview` (verify launch token → set session cookie → redirect)**

```ts
// print-room-portal/app/preview/route.ts
import { NextResponse, type NextRequest } from 'next/server'
import { verifyPreviewToken } from '@/lib/preview/token'
import { buildSessionToken, PREVIEW_COOKIE, sessionCookieOptions } from '@/lib/preview/cookie'

export async function GET(req: NextRequest) {
  const base = req.nextUrl.origin
  const token = req.nextUrl.searchParams.get('token')
  const secret = process.env.PREVIEW_TOKEN_SECRET

  if (!token || !secret) {
    return NextResponse.redirect(new URL('/preview/expired', base))
  }

  const nowSec = Math.floor(Date.now() / 1000)
  const payload = verifyPreviewToken(token, secret, nowSec, 'preview')
  if (!payload) {
    return NextResponse.redirect(new URL('/preview/expired', base))
  }

  const dest = payload.productId ? `/catalogue/${payload.productId}` : '/catalogue'
  const res = NextResponse.redirect(new URL(dest, base))
  res.cookies.set(PREVIEW_COOKIE, buildSessionToken(payload, nowSec), sessionCookieOptions)
  return res
}
```

- [ ] **Step 2: `/preview/exit` (clear cookie)**

```ts
// print-room-portal/app/preview/exit/route.ts
import { NextResponse, type NextRequest } from 'next/server'
import { PREVIEW_COOKIE, sessionCookieOptions } from '@/lib/preview/cookie'

export async function GET(req: NextRequest) {
  const res = NextResponse.redirect(new URL('/', req.nextUrl.origin))
  res.cookies.set(PREVIEW_COOKIE, '', { ...sessionCookieOptions, maxAge: 0 })
  return res
}
```

- [ ] **Step 3: Typecheck + commit**

Run: `cd print-room-portal && npx tsc --noEmit` → no new errors.

```bash
git add app/preview/route.ts app/preview/exit/route.ts
git commit -m "feat(preview): /preview entry + /preview/exit routes"
```

---

## Task 8: Customer portal — /preview/expired page

**Files:**
- Create: `print-room-portal/app/preview/expired/page.tsx`

- [ ] **Step 1: Implement** (plain page; read `oem-rules`-equivalent styling conventions in this repo if present, otherwise minimal)

```tsx
// print-room-portal/app/preview/expired/page.tsx
export default function PreviewExpiredPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-lg font-semibold">Preview link expired</h1>
      <p className="text-sm text-black/60">
        This preview link is no longer valid. Generate a new one from the staff portal.
      </p>
    </main>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/preview/expired/page.tsx
git commit -m "feat(preview): expired-link page"
```

---

## Task 9: Customer portal — force-show the in-edit draft on its PDP

**Files:**
- Modify: `print-room-portal/app/(portal)/catalogue/[productId]/page.tsx`

Force-show is **PDP-only by design** (the editor lands here). The catalogue *list* stays published/granted-only.

- [ ] **Step 1: Branch the catalogue-item lookup in `loadProductDetailPageData`**

Replace the grant gate + `catItem` fetch (currently lines ~84-103) with:

```ts
  // Per-member access filter — gate before we reach the product table.
  // Preview exception: when launched from the editor for a specific item,
  // force-show that exact skin (bypass grant + is_active), still org-scoped.
  let catItem: {
    id: string; name: string | null; description: string | null; sku_override: string | null
    moq_override: number | null; variant_label: string | null
    fulfilment_type_override: FulfilmentType | null; price_mode: 'computed' | 'manual_final' | null
  } | null

  const catItemSelect =
    'id, name, description, sku_override, moq_override, variant_label, fulfilment_type_override, price_mode, b2b_catalogues!inner(organization_id, is_active)'

  if (context.isPreview && context.previewItemId) {
    const { data } = await admin
      .from('b2b_catalogue_items')
      .select(catItemSelect)
      .eq('id', context.previewItemId)
      .eq('source_product_id', productId)
      .eq('b2b_catalogues.organization_id', context.organizationId)
      .maybeSingle()
    catItem = data as typeof catItem
  } else {
    const grantedItemIds = await getGrantedCatalogueItemIds(
      admin,
      context.membershipId,
      context.organizationId,
    )
    if (grantedItemIds.length === 0) return { status: 'not-found' }
    const { data } = await admin
      .from('b2b_catalogue_items')
      .select(catItemSelect)
      .eq('source_product_id', productId)
      .eq('is_active', true)
      .eq('b2b_catalogues.organization_id', context.organizationId)
      .eq('b2b_catalogues.is_active', true)
      .in('id', grantedItemIds)
      .limit(1)
      .maybeSingle()
    catItem = data as typeof catItem
  }

  if (!catItem) return { status: 'not-found' }
```

> Note: keep the existing `productSelect`/`products` query unchanged — it fetches by `productId` (the PDP route param), which equals the previewed item's `source_product_id`. If that product query filters on `is_active`, relax it to also pass when `context.isPreview` so a draft product still renders. (Verify when editing.)

- [ ] **Step 2: Typecheck**

Run: `cd print-room-portal && npx tsc --noEmit`
Expected: no new errors. If the inline `catItem` type drifts from the columns the rest of the function reads, align the type literal to the existing usage.

- [ ] **Step 3: Commit**

```bash
git add "app/(portal)/catalogue/[productId]/page.tsx"
git commit -m "feat(preview): force-show in-edit draft item on its PDP"
```

---

## Task 10: Customer portal — PreviewBanner + layout mount

**Files:**
- Create: `print-room-portal/components/preview/PreviewBanner.tsx`
- Modify: `print-room-portal/app/(portal)/layout.tsx`

- [ ] **Step 1: Banner component** (client; reads `useCompany().access`)

```tsx
// print-room-portal/components/preview/PreviewBanner.tsx
'use client'

import { useCompany } from '@/contexts/CompanyContext'

const PERMISSION_LABEL: Record<string, string> = {
  stock_only: 'stock only',
  reorder_only: 'reorder only',
  both: 'stock + reorder',
}

export function PreviewBanner() {
  const { access } = useCompany()
  if (!access?.isPreview) return null
  const who = access.previewAs
  const detail = who
    ? `${who.name} (${who.role === 'staff' ? 'staff' : 'admin'} · ${PERMISSION_LABEL[who.orderingPermission] ?? who.orderingPermission})`
    : 'member'

  return (
    <div className="sticky top-0 z-50 flex items-center justify-center gap-3 bg-amber-500 px-4 py-2 text-center text-sm font-medium text-black">
      <span>Preview only — viewing as {detail}. No changes are saved.</span>
      <a href="/preview/exit" className="underline underline-offset-2">Exit preview</a>
    </div>
  )
}
```

- [ ] **Step 2: Mount it in the portal layout**

In `app/(portal)/layout.tsx`, render `<PreviewBanner />` as the first child inside `<CompanyProvider>` (so it can read company access), wrapping the rest:

```tsx
      <CompanyProvider initialAccess={access} initialUserId={user?.id ?? null}>
        <PreviewBanner />
        <CurrencyProvider initialRates={exchangeRates.rates}>
          <CartProvider>
            <PortalShell>{children}</PortalShell>
          </CartProvider>
        </CurrencyProvider>
      </CompanyProvider>
```

Add the import:

```tsx
import { PreviewBanner } from '@/components/preview/PreviewBanner'
```

- [ ] **Step 3: Typecheck + commit**

Run: `cd print-room-portal && npx tsc --noEmit` → no new errors.

```bash
git add components/preview/PreviewBanner.tsx "app/(portal)/layout.tsx"
git commit -m "feat(preview): persistent Preview only banner"
```

---

## Task 11: Customer portal — preview-scoped cart key

**Files:**
- Modify: `print-room-portal/components/cart/CartProvider.tsx`

- [ ] **Step 1: Derive a preview-scoped storage key**

Replace the `storageKey` derivation (currently line ~32):

```ts
  const isPreview = access?.isPreview ?? false
  const storageKey = organizationId
    ? `${isPreview ? 'pr-cart-preview' : 'pr-cart'}:${organizationId}`
    : null
```

This keeps a previewing staffer's (possibly real) cart fully separate from the preview cart. The `roleKey` line below can stay as-is.

- [ ] **Step 2: Typecheck + commit**

Run: `cd print-room-portal && npx tsc --noEmit` → no new errors.

```bash
git add components/cart/CartProvider.tsx
git commit -m "feat(preview): isolate preview cart from real cart"
```

---

## Task 12: Customer portal — relabel write buttons to "Preview only"

**Files:**
- Modify: `print-room-portal/components/checkout/CheckoutReviewClient.tsx`
- Modify: `print-room-portal/components/shop/RequestReorderModal.tsx`

- [ ] **Step 1: Checkout submit button**

In `CheckoutReviewClient.tsx`, read preview state from company access and disable+relabel the order-submit button. Near the top of the component, add:

```ts
  const { access } = useCompany()
  const isPreview = access?.isPreview ?? false
```
(If `useCompany` isn't already imported: `import { useCompany } from '@/contexts/CompanyContext'`.)

On the primary submit `<button>`, add `disabled={isPreview || <existing disabled expr>}` and make the label render `isPreview ? 'Preview only' : <existing label>`. Also short-circuit the submit handler:

```ts
  if (isPreview) return // read-only preview — never POST
```
as the first line of the click/submit handler that calls `/api/checkout`.

- [ ] **Step 2: Reorder button**

In `RequestReorderModal.tsx`, do the same: `const { access } = useCompany()`, and on the confirm button add `disabled={access?.isPreview ?? false}` with label `access?.isPreview ? 'Preview only' : <existing>`, and `if (access?.isPreview) return` at the top of the submit handler that POSTs to `/api/checkout/reorder-request`.

- [ ] **Step 3: Typecheck + commit**

Run: `cd print-room-portal && npx tsc --noEmit` → no new errors.

```bash
git add components/checkout/CheckoutReviewClient.tsx components/shop/RequestReorderModal.tsx
git commit -m "feat(preview): disable order + reorder buttons in preview"
```

---

## Task 13: Customer portal — guard account actions + submit (defense in depth)

**Files:**
- Create: `print-room-portal/lib/preview/guard.ts`
- Modify: `print-room-portal/app/(portal)/account/actions.ts`
- Modify: `print-room-portal/lib/checkout/submit.ts`

- [ ] **Step 1: Shared guard**

```ts
// print-room-portal/lib/preview/guard.ts
import { readPreviewSession } from '@/lib/preview/cookie'

/** True when the current request carries a valid preview cookie. */
export async function isPreviewRequest(): Promise<boolean> {
  const nowSec = Math.floor(Date.now() / 1000)
  return (await readPreviewSession(nowSec)) !== null
}
```

- [ ] **Step 2: Guard each writing account action**

At the very top of `updateProfile`, `changePasswordAction`, and `createLocationAction` in `account/actions.ts` (before any work), add:

```ts
  if (await isPreviewRequest()) {
    return { success: false, errors: ['Preview only — nothing was saved.'] }
  }
```

Add the import:

```ts
import { isPreviewRequest } from '@/lib/preview/guard'
```

- [ ] **Step 3: Guard the order RPC entry**

In `lib/checkout/submit.ts`, at the start of the exported submit function (the one that calls `admin.rpc('submit_b2b_order', …)`), reject preview contexts. The function already receives the `B2BCustomerContext` (as `input.context` per the existing `p_member_permission: input.context.orderingPermission` call). Add as the first line of that function:

```ts
  if (input.context.isPreview) {
    return { ok: false as const, error: 'Preview only — nothing was saved.' }
  }
```
Match the function's existing return shape — if it returns a different result type, throw `new Error('Preview only — nothing was saved.')` instead. (Verify the signature when editing; `/api/checkout` already blocks via Task 5, so this is belt-and-braces.)

- [ ] **Step 4: Typecheck + commit**

Run: `cd print-room-portal && npx tsc --noEmit` → no new errors.

```bash
git add lib/preview/guard.ts "app/(portal)/account/actions.ts" lib/checkout/submit.ts
git commit -m "feat(preview): guard account actions + order submit"
```

---

## Task 14: Staff portal — add the audit action

**Files:**
- Modify: `print-room-staff-portal/src/lib/audit/actions.ts`

- [ ] **Step 1: Add the action**

In `AUDIT_ACTIONS`, in the `MEMBER_*` group (after `MEMBER_REMOVE`), add:

```ts
  MEMBER_PREVIEW_AS: 'member.preview_as',
```

- [ ] **Step 2: Typecheck + commit**

Run: `cd print-room-staff-portal && npx tsc --noEmit` → no new errors.

```bash
git add src/lib/audit/actions.ts
git commit -m "feat(preview): member.preview_as audit action"
```

---

## Task 15: Staff portal — mint route /api/preview-token

**Files:**
- Create: `print-room-staff-portal/src/app/api/preview-token/route.ts`
- Test: `print-room-staff-portal/src/app/api/preview-token/route.test.ts`

- [ ] **Step 1: Write the failing test** (validation + signing; mock the staff-auth + admin chain)

```ts
// print-room-staff-portal/src/app/api/preview-token/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const recordAuditEvent = vi.fn()
const membershipMaybeSingle = vi.fn()

vi.mock('@/lib/b2b-accounts/server', () => ({
  requireB2BAccountsStaffAccess: vi.fn(async () => ({
    admin: {
      from: () => ({
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: membershipMaybeSingle }) }) }),
      }),
    },
    context: { userId: 'staff-1' },
  })),
}))
vi.mock('@/lib/audit/recordEvent', () => ({ recordAuditEvent }))

beforeEach(() => {
  vi.clearAllMocks()
  process.env.PREVIEW_TOKEN_SECRET = 'test-secret-aaaaaaaaaaaaaaaaaaaaaaaa'
  process.env.CUSTOMER_PORTAL_URL = 'https://portal.example.com'
})

function post(body: unknown) {
  return new Request('http://staff/api/preview-token', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/preview-token', () => {
  it('400s when membershipId is missing', async () => {
    const { POST } = await import('./route')
    const res = await POST(post({ orgId: 'org-1' }))
    expect(res.status).toBe(400)
  })

  it('404s when the membership is not in the org', async () => {
    membershipMaybeSingle.mockResolvedValueOnce({ data: null })
    const { POST } = await import('./route')
    const res = await POST(post({ orgId: 'org-1', membershipId: 'mem-x' }))
    expect(res.status).toBe(404)
  })

  it('mints a url + writes an audit event', async () => {
    membershipMaybeSingle.mockResolvedValueOnce({
      data: { id: 'mem-1', role: 'staff', ordering_permission: 'stock_only' },
    })
    const { POST } = await import('./route')
    const res = await POST(post({ orgId: 'org-1', membershipId: 'mem-1', itemId: 'item-1', productId: 'prod-1' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.url).toContain('https://portal.example.com/preview?token=')
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'member.preview_as', orgId: 'org-1', targetId: 'mem-1' }),
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd print-room-staff-portal && npx vitest run src/app/api/preview-token/route.test.ts`
Expected: FAIL — `./route` not found.

- [ ] **Step 3: Implement the route**

```ts
// print-room-staff-portal/src/app/api/preview-token/route.ts
import { NextResponse } from 'next/server'
import { requireB2BAccountsStaffAccess } from '@/lib/b2b-accounts/server'
import { recordAuditEvent } from '@/lib/audit/recordEvent'
import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { signPreviewToken, newNonce, type PreviewPayload } from '@/lib/preview/token'

interface Body {
  orgId?: string
  membershipId?: string
  itemId?: string
  productId?: string
}

const LAUNCH_TTL_SEC = 10 * 60

export async function POST(request: Request) {
  const auth = await requireB2BAccountsStaffAccess(request)
  if ('error' in auth) return auth.error

  const secret = process.env.PREVIEW_TOKEN_SECRET
  const portalUrl = process.env.CUSTOMER_PORTAL_URL ?? process.env.NEXT_PUBLIC_CUSTOMER_PORTAL_URL
  if (!secret) {
    return NextResponse.json({ error: 'PREVIEW_TOKEN_SECRET is not configured.' }, { status: 500 })
  }
  if (!portalUrl) {
    return NextResponse.json({ error: 'CUSTOMER_PORTAL_URL is not configured.' }, { status: 500 })
  }

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const orgId = body.orgId?.trim()
  const membershipId = body.membershipId?.trim()
  if (!orgId || !membershipId) {
    return NextResponse.json({ error: 'orgId and membershipId are required' }, { status: 400 })
  }

  // Confirm the membership belongs to the org (prevents cross-org preview).
  const { data: membership } = await auth.admin
    .from('user_organizations')
    .select('id, role, ordering_permission')
    .eq('id', membershipId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!membership) {
    return NextResponse.json({ error: 'Member not found in this organization' }, { status: 404 })
  }

  const nowSec = Math.floor(Date.now() / 1000)
  const payload: PreviewPayload = {
    v: 1,
    org: orgId,
    target: { kind: 'member', membershipId },
    ...(body.itemId ? { itemId: body.itemId } : {}),
    ...(body.productId ? { productId: body.productId } : {}),
    purpose: 'preview',
    iat: nowSec,
    exp: nowSec + LAUNCH_TTL_SEC,
    nonce: newNonce(),
  }
  const token = signPreviewToken(payload, secret)

  await recordAuditEvent({
    orgId,
    actorUserId: auth.context.userId,
    action: AUDIT_ACTIONS.MEMBER_PREVIEW_AS,
    targetType: 'user_organizations',
    targetId: membershipId,
    metadata: {
      role: (membership as { role?: string }).role ?? null,
      ordering_permission: (membership as { ordering_permission?: string }).ordering_permission ?? null,
      launched_from: body.itemId ? 'catalogue_editor' : 'member_row',
      ...(body.itemId ? { catalogue_item_id: body.itemId } : {}),
    },
  })

  const url = `${portalUrl.replace(/\/$/, '')}/preview?token=${encodeURIComponent(token)}`
  return NextResponse.json({ url })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd print-room-staff-portal && npx vitest run src/app/api/preview-token/route.test.ts`
Expected: PASS (3 tests). If the mocked `from().select().eq().eq().maybeSingle()` chain depth doesn't match, align the mock to the exact call chain in the route.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/preview-token/route.ts src/app/api/preview-token/route.test.ts
git commit -m "feat(preview): mint route signs token + writes audit event"
```

---

## Task 16: Staff portal — PreviewLauncher component (member picker)

**Files:**
- Create: `print-room-staff-portal/src/components/preview/PreviewLauncher.tsx`

> Read `docs/ui/oem-rules.md` first; match its button/select exemplars instead of the rough markup below.

- [ ] **Step 1: Implement**

```tsx
// print-room-staff-portal/src/components/preview/PreviewLauncher.tsx
'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button' // adjust to the repo's Button path

interface MemberRow {
  id: string
  full_name: string | null
  email: string
  role: string
  status: 'pending' | 'active'
  ordering_permission: 'stock_only' | 'reorder_only' | 'both'
}

interface PreviewLauncherProps {
  orgId: string
  /** Editor launch: deep-link straight to this item's PDP. Omit for whole-store. */
  itemId?: string
  productId?: string
  label?: string
}

export function PreviewLauncher({ orgId, itemId, productId, label = 'Preview as…' }: PreviewLauncherProps) {
  const [open, setOpen] = useState(false)
  const [members, setMembers] = useState<MemberRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || members) return
    fetch(`/api/b2b-accounts/${orgId}/members`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Failed to load members'))))
      .then((rows: MemberRow[]) => setMembers(rows))
      .catch((e) => setError(e.message))
  }, [open, members, orgId])

  async function launch(membershipId: string) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/preview-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, membershipId, itemId, productId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not start preview')
      window.open(json.url, '_blank', 'noopener')
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start preview')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <Button type="button" variant="secondary" className="w-full" onClick={() => setOpen(true)}>
        {label}
      </Button>
    )
  }

  return (
    <div className="rounded-2xl border border-black/10 p-3">
      <p className="mb-2 text-xs font-medium text-black/60">Preview the store as…</p>
      {error && <p className="mb-2 text-xs text-red-700">{error}</p>}
      {!members && !error && <p className="text-xs text-black/50">Loading members…</p>}
      <ul className="flex flex-col gap-1">
        {(members ?? []).map((m) => (
          <li key={m.id}>
            <button
              type="button"
              disabled={busy}
              onClick={() => void launch(m.id)}
              className="w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-black/5 disabled:opacity-50"
            >
              {m.full_name || m.email}{' '}
              <span className="text-black/50">
                ({m.role === 'staff' ? 'staff' : 'admin'} · {m.ordering_permission}
                {m.status === 'pending' ? ' · pending' : ''})
              </span>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="mt-2 text-xs text-black/50 underline" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `cd print-room-staff-portal && npx tsc --noEmit` → no new errors. Fix the `Button` import path to the repo's actual UI button.

```bash
git add src/components/preview/PreviewLauncher.tsx
git commit -m "feat(preview): staff PreviewLauncher member picker"
```

---

## Task 17: Staff portal — mount launcher in the catalogue item editor

**Files:**
- Modify: `print-room-staff-portal/src/components/catalogues/CatalogueItemEditor.tsx`

- [ ] **Step 1: Render the launcher in the sidebar**

In the `<aside>` sidebar, immediately after the `</form>` (currently ~line 685) and before the "Remove from catalogue" danger button (~line 687), insert:

```tsx
          <PreviewLauncher
            orgId={data.catalogue.organization_id}
            itemId={item.id}
            productId={item.source_product_id}
            label="Preview only"
          />
```

Add the import near the other component imports:

```tsx
import { PreviewLauncher } from '@/components/preview/PreviewLauncher'
```

> Confirm the in-scope variable names at this location: the editor exposes `data.catalogue.organization_id` (org) and the catalogue item id + `source_product_id`. Per the editor's data interface these are `item.id` and `item.source_product_id`; if the local binding differs (e.g. `data.item.id`), use the actual name. `productId` must be the item's `source_product_id` so the PDP route resolves.

- [ ] **Step 2: Typecheck + commit**

Run: `cd print-room-staff-portal && npx tsc --noEmit` → no new errors.

```bash
git add src/components/catalogues/CatalogueItemEditor.tsx
git commit -m "feat(preview): Preview only button in catalogue item editor"
```

---

## Task 18: Staff portal — "Preview as" in the members panel

**Files:**
- Modify: `print-room-staff-portal/src/components/b2b-accounts/MembersPanel.tsx`

- [ ] **Step 1: Add a per-member whole-store preview**

In the member row actions area, add a `PreviewLauncher` scoped to the org with NO `itemId`/`productId` (whole-store launch → member's catalogue home). The panel already has the org id in scope (the prop it uses to fetch members). Render, e.g. in the Actions cell:

```tsx
              <PreviewLauncher orgId={organizationId} label="Preview as this member" />
```

(If a per-row "preview as exactly this one" is wanted later, extend `PreviewLauncher` to accept an optional pre-selected `membershipId` that skips the picker and launches directly — out of scope for phase 1; the picker already lists every member.)

Add the import:

```tsx
import { PreviewLauncher } from '@/components/preview/PreviewLauncher'
```

> Confirm the org-id prop name in `MembersPanel` (it fetches `/api/b2b-accounts/{id}/members`, so the id is in scope — use that exact variable).

- [ ] **Step 2: Typecheck + commit**

Run: `cd print-room-staff-portal && npx tsc --noEmit` → no new errors.

```bash
git add src/components/b2b-accounts/MembersPanel.tsx
git commit -m "feat(preview): Preview as entry on the members panel"
```

---

## Task 19: Env configuration (both repos)

**Files:**
- Modify: `print-room-portal/.env.example` (and `.env.local` locally)
- Modify: `print-room-staff-portal/.env.example` (and `.env.local` locally)

- [ ] **Step 1: Document the new env var in both `.env.example` files**

```
# Preview-as-member: shared HMAC secret. MUST be identical in both portals.
# Generate: node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
PREVIEW_TOKEN_SECRET=
```

Staff portal already documents `CUSTOMER_PORTAL_URL` (used by invites + the mint route). Confirm it's present.

- [ ] **Step 2: Set real values** in each repo's `.env.local` (same secret string in both) for local testing, and note for deploy: set `PREVIEW_TOKEN_SECRET` (same value) in both Vercel projects, and `CUSTOMER_PORTAL_URL` in the staff project.

- [ ] **Step 3: Commit**

```bash
# in each repo
git add .env.example
git commit -m "chore(preview): document PREVIEW_TOKEN_SECRET"
```

---

## Task 20: Manual integration smoke

No automated browser tests — verify end-to-end manually (the kit in `Desktop\PR Test Cases` provides catalogue material; the live "Test Account" franchise org is the target).

- [ ] **Step 1:** Set `PREVIEW_TOKEN_SECRET` (same value) + `CUSTOMER_PORTAL_URL` locally; run both apps.
- [ ] **Step 2:** In a franchise org with ≥1 stocked, ≥1 made_to_order, ≥1 mixed item, set three staff to `stock_only` / `reorder_only` / `both`.
- [ ] **Step 3:** From a catalogue item editor, click **Preview only** → pick the `stock_only` staffer → confirm: new tab lands on that item's PDP, the **Preview only** banner shows the name + permission, a `made_to_order` product shows the dead-zone, and the order button reads "Preview only" + does nothing.
- [ ] **Step 4:** Preview as `reorder_only` → a `stocked` product shows the dead-zone. Preview as `both`/`org_admin` → full ordering UI, multi-store where applicable.
- [ ] **Step 5:** Edit an item to **draft**, Preview only from its editor → the draft PDP still renders (force-show); confirm the same item does NOT appear for a normal member (no cookie) browsing the list.
- [ ] **Step 6:** Add to cart in preview → confirm a separate real login's cart is untouched. Click **Exit preview** → cookie cleared, normal store returns.
- [ ] **Step 7:** Open `/audit` in the staff portal → confirm a `member.preview_as` row with actor, target, role, ordering_permission, launched_from.
- [ ] **Step 8:** Tamper test: hand-edit the `?token=` value → `/preview/expired`. Wait >10 min then click a stale launch link → `/preview/expired`.

---

## Self-review (completed during authoring)

**Spec coverage:** target (real member) ✓ T4/T5/T6; depth incl. checkout, submit blocked ✓ T5/T12/T13; draft force-show ✓ T9; landing PDP vs catalogue ✓ T7; read-honours/write-rejects ✓ T5/T13; "Preview only" copy ✓ T10/T12; HMAC token ✓ T1/T2; dedicated secret ✓ T19; 10/30-min lifetimes ✓ T15/T3; entry points editor + member row ✓ T17/T18; any staff ✓ T15 (uses existing staff gate); cookie precedence (checked before getUser) ✓ T5/T6; audit row ✓ T14/T15. Phase-2 synthetic explicitly out.

**Type consistency:** `PreviewPayload` identical across T1/T2/T3/T4/T7/T15. `B2BCustomerContext.isPreview/previewItemId` defined T5, consumed T4/T9/T13. `B2BCustomerAccess.isPreview/previewAs` defined T6, consumed T4/T10/T11/T12. Cookie name `pr_preview` + `sessionCookieOptions` shared T3/T7.

**Known verify-at-build flags (called out inline):** the PDP product query's `is_active` filter (T9 note); `submit.ts` exact return shape (T13); exact in-scope variable names in `CatalogueItemEditor`/`MembersPanel` (T17/T18); the repo Button import path (T16); mocked Supabase chain depth in the mint-route test (T15).

**Phasing:** Phase 2 (synthetic/custom profile) is a separate spec+plan: parallel granted-items path, fabricated context, profile-builder form reusing the catalogue-grant tree API.
