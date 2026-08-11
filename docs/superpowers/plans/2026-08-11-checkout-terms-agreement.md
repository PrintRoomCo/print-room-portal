# Checkout Terms & Conditions agreement + honeypot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require a customer to read and affirmatively agree to versioned Terms & Conditions before an order is placed, record that consent as a durable audit trail, and add a client-side honeypot bot deterrent.

**Architecture:** The single insertion point is the review step (`/checkout/review` → `confirmOrder()` in `CheckoutReviewClient.tsx`). A checkbox + modal collect consent client-side; the POST carries `terms_accepted` + `terms_version`. `app/api/checkout/route.ts` is the **legal gate**: it returns `400 terms_not_accepted` and never calls `submitCustomerOrder` unless `terms_accepted === true` AND `terms_version` is a non-empty string — so "an order exists" structurally implies "terms were accepted". Inside `submitCustomerOrder` (post-RPC-commit, best-effort) the version is folded into the existing `ORDER_SUBMIT` audit metadata and a dedicated `TERMS_ACCEPTED` event is written. The honeypot is client-only (the endpoint is already auth-gated).

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind, `@radix-ui/react-dialog` (^1.1.15, already a dependency), Vitest + @testing-library/react.

## Global Constraints

- **No schema change.** The `orders` table and `submit_b2b_order` RPC are owned by `print-room-staff-portal`. Do NOT run `apply_migration`, dashboard SQL, or add any `p_terms_*` RPC param. Consent artefacts are `audit_events` inserts only.
- **`TERMS_VERSION = 'v1-2026-08-11'`** — one constant, imported by the client only; the client sends it, the server records it verbatim.
- **New audit action is customer-only — NO staff mirror.** `order.*` actions are not part of the cross-repo MIRROR contract (only `member.*` / `b2b_member_store_grants.*` / `proof.*` are).
- **Best-effort post-commit writes.** Every consent audit write is logged-not-thrown; a failed write must never turn a committed order into a 500.
- **Terms content is provisional-but-real** plain-English B2B copy (Jon reviews wording before merge) — never lorem ipsum.
- Test runner: `pnpm test` runs `vitest run`. Run a single file with `pnpm exec vitest run <path>`.

---

## File Structure

**New files:**
- `lib/checkout/terms.ts` — exports `TERMS_VERSION`. One responsibility: the single source of the version string.
- `components/checkout/TermsContent.tsx` — pure presentational placeholder clauses + visible version line. One responsibility: the text the customer reads.
- `components/checkout/TermsModal.tsx` — Radix dialog wrapper rendering `TermsContent`. One responsibility: present the terms in a focus-trapped modal.

**Modified files:**
- `lib/audit/actions.ts` — add `TERMS_ACCEPTED: 'order.terms_accepted'`.
- `lib/checkout/submit.ts` — `CheckoutInput` gains `terms_accepted?` + `terms_version?`; `ORDER_SUBMIT` metadata gains `terms_version`; new best-effort `TERMS_ACCEPTED` write.
- `app/api/checkout/route.ts` — `CheckoutRequestBody` gains the two fields; the legal gate; thread both into each `submitCustomerOrder` call.
- `components/checkout/CheckoutReviewClient.tsx` — `termsAccepted` / `termsOpen` / `honeypot` ephemeral state; checkbox + label + modal-opening link; off-screen honeypot input; `confirmOrder()` guards; POST body fields.

**New test files:**
- `components/checkout/__tests__/TermsModal.test.tsx`
- `lib/checkout/__tests__/submit.terms.test.ts`
- `app/api/checkout/__tests__/route.terms.test.ts`
- `components/checkout/__tests__/CheckoutReviewClient.terms.test.tsx`

---

### Task 1: Terms content, version constant, and modal

**Files:**
- Create: `lib/checkout/terms.ts`
- Create: `components/checkout/TermsContent.tsx`
- Create: `components/checkout/TermsModal.tsx`
- Test: `components/checkout/__tests__/TermsModal.test.tsx`

**Interfaces:**
- Consumes: nothing (leaf presentational unit).
- Produces:
  - `export const TERMS_VERSION: string` (from `lib/checkout/terms.ts`, value `'v1-2026-08-11'`).
  - `export function TermsContent(): JSX.Element` (from `components/checkout/TermsContent.tsx`).
  - `export function TermsModal(props: { onClose: () => void }): JSX.Element` (from `components/checkout/TermsModal.tsx`) — renders open immediately; `onClose` fires on Escape, overlay click, or the Close button.

- [ ] **Step 1: Write the failing test**

Create `components/checkout/__tests__/TermsModal.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TermsModal } from '../TermsModal'
import { TERMS_VERSION } from '@/lib/checkout/terms'

describe('TERMS_VERSION', () => {
  it('is the locked v1 string in sequence-then-date format', () => {
    expect(TERMS_VERSION).toBe('v1-2026-08-11')
    expect(TERMS_VERSION).toMatch(/^v\d+-\d{4}-\d{2}-\d{2}$/)
  })
})

describe('TermsModal', () => {
  it('renders the terms in a dialog with the version and real clauses', () => {
    render(<TermsModal onClose={vi.fn()} />)
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText(/Terms & Conditions/i)).toBeTruthy()
    // Real, non-lorem clause content is present.
    expect(screen.getByText(/Payment/i)).toBeTruthy()
    // The exact version the customer sees is shown.
    expect(screen.getByText(new RegExp(TERMS_VERSION))).toBeTruthy()
  })

  it('calls onClose when the Close button is clicked', () => {
    const onClose = vi.fn()
    render(<TermsModal onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run components/checkout/__tests__/TermsModal.test.tsx`
Expected: FAIL — `Failed to resolve import "../TermsModal"` / `"@/lib/checkout/terms"`.

- [ ] **Step 3: Create the version constant**

Create `lib/checkout/terms.ts`:

```ts
/**
 * Single source of the Terms & Conditions version string. Imported by the
 * client only: the client rendered the exact text the customer saw, so it is
 * the authoritative source of the recorded version (design 2026-08-11).
 *
 * Format: `v<sequence>-<effective-date>`. Bump the sequence (v2, v3, …) on any
 * SUBSTANTIVE change to `TermsContent.tsx` (not typo fixes) and set the date to
 * the day the new copy goes live. The string is git-versioned alongside
 * `TermsContent.tsx`, so any recorded value resolves back to real text.
 */
export const TERMS_VERSION = 'v1-2026-08-11'
```

- [ ] **Step 4: Create the terms content**

Create `components/checkout/TermsContent.tsx`:

```tsx
import { TERMS_VERSION } from '@/lib/checkout/terms'

/**
 * Provisional-but-real plain-English B2B terms (design 2026-08-11, Decision 7).
 * NOT lorem ipsum — agreeing to filler on a live portal undermines the consent
 * record. Jon reviews this wording before merge; final legal copy is a later
 * edit here. Bump TERMS_VERSION in lib/checkout/terms.ts on substantive change.
 */
export function TermsContent() {
  return (
    <div className="space-y-4 text-sm leading-relaxed text-gray-700">
      <p className="text-xs text-gray-500">
        Version {TERMS_VERSION} · These terms may be updated from time to time.
      </p>

      <section>
        <h3 className="font-medium text-gray-900">1. Quotes &amp; pricing</h3>
        <p>
          Prices shown at checkout are valid for 30 days unless stated otherwise.
          All prices are in New Zealand dollars and exclude GST, which is added
          at the prevailing rate on your invoice.
        </p>
      </section>

      <section>
        <h3 className="font-medium text-gray-900">2. Payment</h3>
        <p>
          Payment is due on the terms agreed for your account. Where a deposit
          applies, production begins once the deposit is received. We may place
          orders on hold where an account is overdue.
        </p>
      </section>

      <section>
        <h3 className="font-medium text-gray-900">3. Artwork &amp; proof approval</h3>
        <p>
          You are responsible for the accuracy of artwork, names, sizes and
          quantities you supply. Where a proof is provided, production follows
          your approval; we are not liable for errors in approved artwork.
        </p>
      </section>

      <section>
        <h3 className="font-medium text-gray-900">4. Changes &amp; cancellations</h3>
        <p>
          Once production has started, orders cannot usually be changed or
          cancelled. Custom and decorated goods are made to order and are not
          returnable except where faulty.
        </p>
      </section>

      <section>
        <h3 className="font-medium text-gray-900">5. Delivery &amp; risk</h3>
        <p>
          Delivery dates are estimates and not guaranteed. Risk in the goods
          passes to you on delivery. Please inspect goods on arrival and tell us
          of any shortage or fault within 7 days.
        </p>
      </section>

      <section>
        <h3 className="font-medium text-gray-900">6. Updates to these terms</h3>
        <p>
          We may update these terms from time to time. The version shown above
          applies to the order you are placing now.
        </p>
      </section>
    </div>
  )
}
```

- [ ] **Step 5: Create the modal**

Create `components/checkout/TermsModal.tsx` (mirrors the Radix pattern in `components/shop/RequestReorderModal.tsx`, minus the form/submit):

```tsx
'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useRef } from 'react'
import { TermsContent } from './TermsContent'

interface TermsModalProps {
  onClose: () => void
}

export function TermsModal({ onClose }: TermsModalProps) {
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (previousFocusRef.current == null) {
      previousFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null
    }
  }, [])

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
          onCloseAutoFocus={(event) => {
            if (!previousFocusRef.current) return
            event.preventDefault()
            previousFocusRef.current.focus()
          }}
        >
          <Dialog.Title className="text-lg font-semibold text-gray-900">
            Terms &amp; Conditions
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-gray-600">
            Please read these terms. You agree to them when you place your order.
          </Dialog.Description>

          <div className="mt-4">
            <TermsContent />
          </div>

          <div className="mt-6 flex justify-end">
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-full bg-pr-blue px-4 py-2 text-sm font-medium text-white hover:bg-pr-blue/90"
              >
                Close
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm exec vitest run components/checkout/__tests__/TermsModal.test.tsx`
Expected: PASS (4 assertions across 3 tests).

- [ ] **Step 7: Commit**

```bash
git add lib/checkout/terms.ts components/checkout/TermsContent.tsx components/checkout/TermsModal.tsx components/checkout/__tests__/TermsModal.test.tsx
git commit -m "feat(checkout): versioned Terms & Conditions content + modal"
```

---

### Task 2: Audit action + submit-layer consent recording

**Files:**
- Modify: `lib/audit/actions.ts:11`
- Modify: `lib/checkout/submit.ts:129` (CheckoutInput), `:1490-1496` (ORDER_SUBMIT metadata), `:1499` (insert TERMS_ACCEPTED write)
- Test: `lib/checkout/__tests__/submit.terms.test.ts`

**Interfaces:**
- Consumes: `AUDIT_ACTIONS` + `recordAuditEvent` (already imported in `submit.ts:7-8`).
- Produces:
  - `AUDIT_ACTIONS.TERMS_ACCEPTED === 'order.terms_accepted'`.
  - `CheckoutInput` gains optional `terms_accepted?: boolean` and `terms_version?: string`.
  - `ORDER_SUBMIT` audit metadata gains `terms_version: string | null`.
  - A `TERMS_ACCEPTED` audit row per order: `{ action: 'order.terms_accepted', targetType: 'order', targetId: order_id, metadata: { order_ref, terms_version, idempotency_key } }`.

- [ ] **Step 1: Write the failing test**

Create `lib/checkout/__tests__/submit.terms.test.ts` (self-contained Supabase stub mirroring `submit.job-tracker.test.ts`; the downstream module mocks keep the fan-out inert so the test focuses on the two consent writes):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/monday/deal-item', () => ({
  pushOrderDeal: vi.fn().mockResolvedValue({ itemId: '12345', subitemIds: {} }),
}))
vi.mock('@/lib/email/order-confirmation', () => ({
  sendOrderConfirmation: vi.fn().mockResolvedValue({ success: true }),
}))
vi.mock('@/lib/proofs/autofill-for-order', () => ({
  autofillProofForOrder: vi.fn().mockResolvedValue({ proofId: null, skipped: null }),
}))
vi.mock('@/lib/orders/job-tracker', () => ({
  createJobTrackerShellForOrder: vi
    .fn()
    .mockResolvedValue({ trackerId: 't-test', trackerToken: 'TOKEN-X' }),
}))

import { submitCustomerOrder, type CheckoutInput } from '../submit'

const flushAfter = () =>
  (globalThis as unknown as { flushAfter: () => Promise<void> }).flushAfter()

type AnyRow = Record<string, unknown>

interface RecordedWrite {
  table: string
  op: 'insert' | 'update'
  payload: AnyRow | AnyRow[]
  filters: Array<{ column: string; value: unknown }>
}
interface SelectResponse {
  data: AnyRow | AnyRow[] | null
  error: { message: string } | null
}
interface SelectMatcher {
  table: string
  response: SelectResponse
}

function makeSupabaseStub(opts: {
  selects: SelectMatcher[]
  rpc: (name: string, args: AnyRow | undefined, callIndex: number) => {
    data: unknown
    error: { message: string } | null
  }
}) {
  const writes: RecordedWrite[] = []

  function builderFor(table: string) {
    const filters: Array<{ column: string; value: unknown }> = []
    let pendingWrite: { op: 'insert' | 'update'; payload: AnyRow | AnyRow[] } | null = null

    const matchSelect = (): SelectResponse =>
      opts.selects.find((m) => m.table === table)?.response ?? { data: [], error: null }

    const settle = (): SelectResponse => {
      if (pendingWrite) {
        writes.push({ table, op: pendingWrite.op, payload: pendingWrite.payload, filters: [...filters] })
        return { data: null, error: null }
      }
      return matchSelect()
    }

    const builder = {
      select: () => builder,
      insert: (payload: AnyRow | AnyRow[]) => { pendingWrite = { op: 'insert', payload }; return builder },
      update: (payload: AnyRow) => { pendingWrite = { op: 'update', payload }; return builder },
      eq: (column: string, value: unknown) => { filters.push({ column, value }); return builder },
      in: (column: string, value: unknown) => { filters.push({ column, value }); return builder },
      is: (column: string, value: unknown) => { filters.push({ column, value }); return builder },
      gt: () => builder,
      order: () => builder,
      limit: () => builder,
      single: async () => settle(),
      maybeSingle: async () => {
        const r = settle()
        if (Array.isArray(r.data)) return { data: r.data[0] ?? null, error: r.error }
        return r
      },
      then<R1 = SelectResponse, R2 = never>(
        resolve: (v: SelectResponse) => R1 | PromiseLike<R1>,
        reject?: (reason: unknown) => R2 | PromiseLike<R2>,
      ): PromiseLike<R1 | R2> {
        return Promise.resolve(settle()).then(resolve, reject)
      },
    }
    return builder
  }

  const rpcCalls: Array<{ name: string; args: AnyRow | undefined }> = []
  const admin = {
    from: vi.fn((table: string) => builderFor(table)),
    rpc: vi.fn(async (name: string, args?: AnyRow) => {
      rpcCalls.push({ name, args })
      const callIndex = rpcCalls.filter((c) => c.name === name).length - 1
      return opts.rpc(name, args, callIndex)
    }),
    auth: {
      admin: { getUserById: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
    },
  } as unknown as Parameters<typeof submitCustomerOrder>[0]

  return { admin, writes }
}

const PRODUCT_ID = '00000000-0000-0000-0000-000000000001'
const CAT_ITEM_ID = '00000000-0000-0000-0000-000000000aaa'
const ORG_ID = '00000000-0000-0000-0000-0000000000ff'
const MEMBERSHIP_ID = '00000000-0000-0000-0000-000000000bbb'
const USER_ID = '00000000-0000-0000-0000-000000000ccc'
const ORDER_ID = '00000000-0000-0000-0000-000000000111'
const QUOTE_ID = '00000000-0000-0000-0000-000000000222'

function buildInput(): CheckoutInput {
  return {
    context: {
      userId: USER_ID, membershipId: MEMBERSHIP_ID, role: 'org_admin',
      email: 'buyer@acme.test', fullName: 'Sam Buyer', organizationId: ORG_ID,
      organizationName: 'Acme Co', customerCode: 'ACME', isTest: false,
      b2bAccountId: null, tierLevel: null, paymentTerms: 'net20', contractNotes: null,
      pricingMode: null, defaultDepositPercent: null, storeIds: [], defaultStoreId: null,
      branchStoreIds: [], tenantType: null, allowsMultiStoreOrdering: false,
      moqExempt: true, orderingPermission: 'both',
    },
    idempotency_key: 'idem-terms-1',
    required_by: '2026-06-01',
    notes: null,
    internal_notes: null,
    lines: [
      {
        product_id: PRODUCT_ID, product_name: 'Basic Tee', variant_id: null,
        qty: 10, decorations: [], cart_line_id: 'line-1', fulfilment_type: 'stocked',
      },
    ],
    terms_accepted: true,
    terms_version: 'v1-2026-08-11',
  }
}

function baseSelects(): SelectMatcher[] {
  return [
    { table: 'user_organizations', response: { data: { role: 'org_admin' }, error: null } },
    {
      table: 'b2b_catalogue_items',
      response: { data: [{ id: CAT_ITEM_ID, source_product_id: PRODUCT_ID, moq_override: null }], error: null },
    },
    { table: 'products', response: { data: [{ id: PRODUCT_ID, moq: 1 }], error: null } },
    {
      table: 'quote_items',
      response: {
        data: [{
          id: 'qi-1', product_id: PRODUCT_ID, variant_id: null, product_name: 'Basic Tee',
          quantity: 10, unit_price: 10, decorations: [], product_variants: null,
        }],
        error: null,
      },
    },
    {
      table: 'quotes',
      response: {
        data: {
          id: QUOTE_ID, organization_id: ORG_ID, customer_name: 'Acme Co',
          customer_email: 'buyer@acme.test', order_ref: 'ORD-TEST-1', total_amount: 100,
          required_by: '2026-06-01', payment_terms: 'net20',
        },
        error: null,
      },
    },
  ]
}

const rpc = (name: string) => {
  if (name === 'effective_unit_price') return { data: 10, error: null }
  if (name === 'submit_b2b_order') {
    return { data: [{ quote_id: QUOTE_ID, order_id: ORDER_ID, order_ref: 'ORD-TEST-1' }], error: null }
  }
  return { data: null, error: null }
}

beforeEach(() => { vi.clearAllMocks() })

describe('submitCustomerOrder — Terms & Conditions consent trail', () => {
  it('writes a TERMS_ACCEPTED audit row carrying the version, order_ref and idempotency_key', async () => {
    const { admin, writes } = makeSupabaseStub({ selects: baseSelects(), rpc })
    await submitCustomerOrder(admin, buildInput())
    await flushAfter()

    const termsAudits = writes.filter(
      (w) => w.table === 'audit_events' && w.op === 'insert' &&
        (w.payload as AnyRow).action === 'order.terms_accepted',
    )
    expect(termsAudits).toHaveLength(1)
    const meta = (termsAudits[0].payload as AnyRow).metadata as AnyRow
    expect(meta.terms_version).toBe('v1-2026-08-11')
    expect(meta.order_ref).toBe('ORD-TEST-1')
    expect(meta.idempotency_key).toBe('idem-terms-1')
    expect((termsAudits[0].payload as AnyRow).target_id).toBe(ORDER_ID)
  })

  it('folds terms_version into the ORDER_SUBMIT audit metadata (redundant reliable copy)', async () => {
    const { admin, writes } = makeSupabaseStub({ selects: baseSelects(), rpc })
    await submitCustomerOrder(admin, buildInput())
    await flushAfter()

    const submitAudits = writes.filter(
      (w) => w.table === 'audit_events' && w.op === 'insert' &&
        (w.payload as AnyRow).action === 'order.submit',
    )
    expect(submitAudits).toHaveLength(1)
    const meta = (submitAudits[0].payload as AnyRow).metadata as AnyRow
    expect(meta.terms_version).toBe('v1-2026-08-11')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/checkout/__tests__/submit.terms.test.ts`
Expected: FAIL — no `order.terms_accepted` row exists (first test `toHaveLength(1)` gets 0), and `ORDER_SUBMIT` metadata has no `terms_version` (second test gets `undefined`).

- [ ] **Step 3: Add the audit action**

In `lib/audit/actions.ts`, add the new action directly after `ORDER_SUBMIT` (line 11). Customer-only — no staff mirror:

```ts
  ORDER_SUBMIT: 'order.submit',
  // Customer-only (design 2026-08-11). NOT mirrored to staff — order.* actions
  // are not part of the cross-repo MIRROR contract.
  TERMS_ACCEPTED: 'order.terms_accepted',
```

- [ ] **Step 4: Add the CheckoutInput fields**

In `lib/checkout/submit.ts`, inside `interface CheckoutInput` add the two fields after `pricing_pool_lines?` (before the closing brace at line 130):

```ts
  pricing_pool_lines?: CheckoutLineInput[]
  /**
   * Design 2026-08-11: the buyer's affirmative T&C acceptance for THIS order.
   * Validated at the route (400 unless accepted === true AND a non-empty
   * version). Recorded post-commit as a TERMS_ACCEPTED audit event and folded
   * into ORDER_SUBMIT metadata — best-effort, like every post-commit side-effect
   * here. The route is the legal gate; these writes are the queryable trail.
   */
  terms_accepted?: boolean
  terms_version?: string
```

- [ ] **Step 5: Fold `terms_version` into ORDER_SUBMIT metadata**

In `lib/checkout/submit.ts`, extend the existing `ORDER_SUBMIT` metadata object (lines 1490-1496) — add `terms_version`:

```ts
      metadata: {
        order_ref,
        quote_id,
        line_count: input.lines.length,
        total_qty: input.lines.reduce((acc, l) => acc + l.qty, 0),
        idempotency_key: input.idempotency_key,
        terms_version: input.terms_version ?? null,
      },
```

- [ ] **Step 6: Write the TERMS_ACCEPTED event**

In `lib/checkout/submit.ts`, immediately after the `ORDER_SUBMIT` `recordAuditEvent(...)` call closes (the `)` at line 1499), insert the dedicated consent write. Same resilient try/catch shape as `ORDER_TYPE_STAMP_FAILED`:

```ts
  // Design 2026-08-11 — dedicated consent signal. The route already guarantees
  // no order exists without an accepted, non-empty terms_version (the legal
  // gate); this is the clean queryable row. Best-effort like the audit writes
  // above — a failed write must never turn a committed order into a 500. One row
  // per order (two for a split cart); retries may duplicate (accepted), collapsed
  // in queries via the shared base idempotency_key.
  try {
    await recordAuditEvent(
      {
        orgId: input.context.organizationId,
        actorUserId: input.context.userId,
        action: AUDIT_ACTIONS.TERMS_ACCEPTED,
        targetType: 'order',
        targetId: order_id,
        metadata: {
          order_ref,
          terms_version: input.terms_version ?? null,
          idempotency_key: input.idempotency_key,
        },
      },
      admin,
    )
  } catch (auditErr) {
    console.error('[Checkout] terms_accepted audit threw (swallowed, order committed)', {
      orderId: order_id,
      err: auditErr instanceof Error ? auditErr.message : String(auditErr),
    })
  }
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm exec vitest run lib/checkout/__tests__/submit.terms.test.ts`
Expected: PASS (both tests).

- [ ] **Step 8: Commit**

```bash
git add lib/audit/actions.ts lib/checkout/submit.ts lib/checkout/__tests__/submit.terms.test.ts
git commit -m "feat(checkout): record Terms & Conditions consent in audit trail"
```

---

### Task 3: Server gate + threading in the checkout route

**Files:**
- Modify: `app/api/checkout/route.ts:20-28` (body type), `:50` (insert gate), `:149-167` (thread into `submitCustomerOrder`)
- Test: `app/api/checkout/__tests__/route.terms.test.ts`

**Interfaces:**
- Consumes: `CheckoutInput.terms_accepted` + `CheckoutInput.terms_version` (from Task 2); `submitCustomerOrder` (existing).
- Produces: HTTP contract — `400 { error: 'terms_not_accepted' }` unless `body.terms_accepted === true` AND `body.terms_version` is a non-empty string; on the happy path both are passed to every `submitCustomerOrder` call.

- [ ] **Step 1: Write the failing test**

Create `app/api/checkout/__tests__/route.terms.test.ts` (mirrors `route.permission-denied.test.ts` mock setup):

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
  class BillingModeDriftError extends Error {}
  return {
    DecorationDriftError, UnitPriceDriftError, MemberAccessDriftError,
    MoqViolationError, StockShortfallError, BuyerScopeError, MixedShippingAddressError,
    BillingModeDriftError,
    submitCustomerOrder: vi.fn(),
  }
})

import { POST } from '../route'
import { requireB2BCustomerApi } from '@/lib/checkout/server'
import { submitCustomerOrder } from '@/lib/checkout/submit'

function req(body: unknown): Request {
  return new Request('http://t/api/checkout', { method: 'POST', body: JSON.stringify(body) })
}

// All-null ship-to + custom address so validation passes without a store list.
const baseBody = {
  idempotency_key: 'idem-terms',
  lines: [{ product_id: 'p1', product_name: 'Staple Tee', qty: 10, fulfilment_type: 'stocked' }],
  custom_shipping_address: { line1: '1 Test St' },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireB2BCustomerApi).mockResolvedValue({
    admin: {} as never,
    context: { storeIds: [], role: 'org_admin', tenantType: 'franchise', organizationId: 'o1' } as never,
  })
})

describe('POST /api/checkout — Terms & Conditions gate', () => {
  it('returns 400 terms_not_accepted when terms_accepted is missing', async () => {
    const res = await POST(req({ ...baseBody, terms_version: 'v1-2026-08-11' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('terms_not_accepted')
    expect(submitCustomerOrder).not.toHaveBeenCalled()
  })

  it('returns 400 terms_not_accepted when terms_accepted is false', async () => {
    const res = await POST(req({ ...baseBody, terms_accepted: false, terms_version: 'v1-2026-08-11' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('terms_not_accepted')
    expect(submitCustomerOrder).not.toHaveBeenCalled()
  })

  it('returns 400 terms_not_accepted when terms_version is missing or empty', async () => {
    const res = await POST(req({ ...baseBody, terms_accepted: true, terms_version: '   ' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('terms_not_accepted')
    expect(submitCustomerOrder).not.toHaveBeenCalled()
  })

  it('threads terms_accepted + terms_version into submitCustomerOrder on the happy path', async () => {
    vi.mocked(submitCustomerOrder).mockResolvedValueOnce({ order_id: 'o-1', order_ref: 'O-1' })
    const res = await POST(req({ ...baseBody, terms_accepted: true, terms_version: 'v1-2026-08-11' }))
    expect(res.status).toBe(200)
    expect(submitCustomerOrder).toHaveBeenCalledTimes(1)
    const arg = vi.mocked(submitCustomerOrder).mock.calls[0][1]
    expect(arg.terms_accepted).toBe(true)
    expect(arg.terms_version).toBe('v1-2026-08-11')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run app/api/checkout/__tests__/route.terms.test.ts`
Expected: FAIL — no gate yet, so the missing/false/empty cases reach `submitCustomerOrder` (or 200) instead of 400, and `arg.terms_accepted` is `undefined`.

- [ ] **Step 3: Extend the request body type**

In `app/api/checkout/route.ts`, add the two fields to `interface CheckoutRequestBody` (after `custom_shipping_address`, line 27):

```ts
  custom_shipping_address?: Record<string, unknown> | null
  /**
   * Design 2026-08-11: the buyer's affirmative T&C acceptance + the exact
   * version string they saw. The route rejects (400) unless terms_accepted ===
   * true AND terms_version is a non-empty string; both are threaded to
   * submitCustomerOrder. No honeypot field — the honeypot is client-only.
   */
  terms_accepted?: boolean
  terms_version?: string
```

- [ ] **Step 4: Add the legal gate**

In `app/api/checkout/route.ts`, insert the gate immediately after the `idempotency_key` + non-empty-lines validation block (after line 50, before the "Mixed per-line custom addresses" comment):

```ts
  // Terms & Conditions gate (design 2026-08-11, Decision 2 — THE legal proof).
  // No order is ever created unless the buyer affirmatively accepted a specific,
  // non-empty terms version. This structural guarantee — not the best-effort
  // audit write — is what makes "an order exists" imply "terms were accepted".
  if (
    body.terms_accepted !== true ||
    typeof body.terms_version !== 'string' ||
    body.terms_version.trim() === ''
  ) {
    return NextResponse.json({ error: 'terms_not_accepted' }, { status: 400 })
  }
```

- [ ] **Step 5: Thread the fields into submitCustomerOrder**

In `app/api/checkout/route.ts`, add the two fields to the `submitCustomerOrder(auth.admin, { … })` call (in the partition loop). Insert them right after `intent,` (line 162), keeping the existing `order_type` comment below them:

```ts
        intent,
        // Consent for THIS order (design 2026-08-11). Both partitions of a split
        // cart carry the same acceptance — the customer agreed once for the cart.
        terms_accepted: body.terms_accepted,
        terms_version: body.terms_version,
        // order_type intentionally NOT passed: submit self-classifies each
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm exec vitest run app/api/checkout/__tests__/route.terms.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Run the sibling route tests for no regression**

Run: `pnpm exec vitest run app/api/checkout/__tests__/route.split.test.ts app/api/checkout/__tests__/route.permission-denied.test.ts`
Expected: FAIL — these older bodies omit terms fields, so they now hit the 400 gate.
Fix: add `terms_accepted: true, terms_version: 'v1-2026-08-11'` to each request body in those two files (the `VALID_BODY` / inline `req({...})` payloads). Re-run; expected PASS.

- [ ] **Step 8: Commit**

```bash
git add app/api/checkout/route.ts app/api/checkout/__tests__/route.terms.test.ts app/api/checkout/__tests__/route.split.test.ts app/api/checkout/__tests__/route.permission-denied.test.ts
git commit -m "feat(checkout): server gate rejects orders without accepted T&C version"
```

---

### Task 4: Client wiring — checkbox, honeypot, guards, POST fields

**Files:**
- Modify: `components/checkout/CheckoutReviewClient.tsx` — imports (`:32`), state (`:77`), `confirmOrder` guards (`:165`), POST body (`:232`), JSX (`:653`)
- Test: `components/checkout/__tests__/CheckoutReviewClient.terms.test.tsx`

**Interfaces:**
- Consumes: `TERMS_VERSION` + `TermsModal` (from Task 1); the `/api/checkout` gate (from Task 3).
- Produces: no exported surface — behavior only. Unticked confirm → error banner, no POST. Honeypot filled → silent return, no POST. Ticked confirm → POST body includes `terms_accepted: true` + `terms_version: TERMS_VERSION`. The "Terms & Conditions" link opens `TermsModal` without toggling the checkbox.

- [ ] **Step 1: Write the failing test**

Create `components/checkout/__tests__/CheckoutReviewClient.terms.test.tsx` (mirrors the mock harness in `CheckoutReviewClient.branch.test.tsx`):

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CheckoutReviewClient } from '../CheckoutReviewClient'
import { CHECKOUT_REVIEW_STORAGE_KEY } from '../checkoutReviewState'

const mocks = vi.hoisted(() => ({ lines: [] as Array<Record<string, unknown>> }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/components/cart/useCart', () => ({
  useCart: () => ({ lines: mocks.lines, clear: vi.fn() }),
}))
vi.mock('@/lib/pricing/usePricingContext', () => ({
  usePricingContext: () => ({ pricingMode: 'catalogue', tierLabel: 'Catalogue', tierDiscount: 0 }),
}))
vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({ format: (n: number) => `$${n.toFixed(2)}` }),
}))
vi.mock('@/contexts/CompanyContext', () => ({
  useCompany: () => ({ access: null, loading: false }),
}))

function line(over: Record<string, unknown> = {}) {
  return {
    lineId: 'line-1', productId: 'product-1', productName: 'Test tee', variantId: 'variant-1',
    variantLabel: 'Black / M', qty: 12, unitPrice: 10, imageUrl: null, decorations: [],
    fulfilmentType: 'stocked', nature: 'stocked', catalogueItemId: 'catalogue-item-1', ...over,
  }
}

const STORES = [{ id: 'store-1', name: 'Avalon', city: 'Lower Hutt', country: 'NZ' }]

function renderReview() {
  return render(
    <CheckoutReviewClient
      stores={STORES}
      customerCode="CUST-1"
      paymentTerms="net20"
      defaultDepositPercent={null}
      isTest={false}
      role="org_admin"
      branchStoreIds={[]}
      defaultStoreId="store-1"
    />,
  )
}

// Records only the order-placing POST so tests can assert whether it fired.
let checkoutPosts: Array<{ url: string; body: Record<string, unknown> }> = []

beforeEach(() => {
  checkoutPosts = []
  mocks.lines = [line()]
  sessionStorage.clear()
  sessionStorage.setItem(
    CHECKOUT_REVIEW_STORAGE_KEY,
    JSON.stringify({
      idempotencyKey: 'idem-1', requiredBy: '', notes: '', intent: 'customer',
      perLineShipTo: { 'line-1': 'store-1' },
      customAddress: { name: '', address: '', city: '', postal_code: '', country: 'NZ' },
      createdAt: '2026-06-05T00:00:00.000Z',
    }),
  )
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).startsWith('/api/checkout/billing-modes')) {
        return { status: 200, ok: true, json: async () => ({ modeByVariantId: {} }) }
      }
      if (String(url) === '/api/checkout') {
        checkoutPosts.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) })
        return { status: 200, ok: true, json: async () => ({ order_id: 'o-1', order_ref: 'O-1' }) }
      }
      return { status: 200, ok: true, json: async () => ({ imagesByLineId: {} }) }
    }),
  )
})

const clickPlaceOrder = () =>
  fireEvent.click(screen.getByRole('button', { name: /confirm & place order/i }))

describe('CheckoutReviewClient — Terms & Conditions', () => {
  it('shows an error banner and does NOT POST when the box is unticked', async () => {
    renderReview()
    await screen.findAllByText('Test tee')
    clickPlaceOrder()
    expect(await screen.findByText(/read and agree to the terms/i)).toBeTruthy()
    expect(checkoutPosts).toHaveLength(0)
  })

  it('POSTs with terms_accepted + terms_version once the box is ticked', async () => {
    renderReview()
    await screen.findAllByText('Test tee')
    fireEvent.click(screen.getByLabelText(/i have read and agree/i))
    clickPlaceOrder()
    await waitFor(() => expect(checkoutPosts).toHaveLength(1))
    expect(checkoutPosts[0].body.terms_accepted).toBe(true)
    expect(checkoutPosts[0].body.terms_version).toBe('v1-2026-08-11')
  })

  it('opens the terms modal from the inline link without ticking the box', async () => {
    renderReview()
    await screen.findAllByText('Test tee')
    const checkbox = screen.getByLabelText(/i have read and agree/i) as HTMLInputElement
    fireEvent.click(screen.getByRole('button', { name: /terms & conditions/i }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(checkbox.checked).toBe(false)
  })

  it('aborts silently (no banner, no POST) when the honeypot is filled', async () => {
    const { container } = renderReview()
    await screen.findAllByText('Test tee')
    const honeypot = container.querySelector('input[name="company_url"]') as HTMLInputElement
    expect(honeypot).toBeTruthy()
    fireEvent.change(honeypot, { target: { value: 'bot-filled' } })
    fireEvent.click(screen.getByLabelText(/i have read and agree/i))
    clickPlaceOrder()
    await Promise.resolve()
    expect(checkoutPosts).toHaveLength(0)
    expect(screen.queryByText(/read and agree to the terms/i)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run components/checkout/__tests__/CheckoutReviewClient.terms.test.tsx`
Expected: FAIL — no checkbox (`getByLabelText(/i have read and agree/i)` throws) and the unticked POST currently fires.

- [ ] **Step 3: Add imports**

In `components/checkout/CheckoutReviewClient.tsx`, after the `resolveBranchStoreIds` import (line 32):

```ts
import { resolveBranchStoreIds } from '@/lib/orders/branch-grants'
import { TERMS_VERSION } from '@/lib/checkout/terms'
import { TermsModal } from './TermsModal'
```

- [ ] **Step 4: Add ephemeral state**

In `components/checkout/CheckoutReviewClient.tsx`, after the `banner` state (line 77):

```ts
  const [banner, setBanner] = useState<{ kind: 'error' | 'info'; msg: string } | null>(null)
  // T&C consent + honeypot: ephemeral, NOT persisted to reviewState — the box
  // resets to unticked on every reload so each checkout is a fresh affirmation
  // (design 2026-08-11, Decision 6).
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [termsOpen, setTermsOpen] = useState(false)
  const [honeypot, setHoneypot] = useState('')
```

- [ ] **Step 5: Add the confirmOrder guards**

In `components/checkout/CheckoutReviewClient.tsx`, inside `confirmOrder()`, insert the two guards immediately after the `if (!reviewState || cart.lines.length === 0) return` line (line 165) and before the `missingShipTo` check:

```ts
    if (!reviewState || cart.lines.length === 0) return

    // Client-only honeypot (design 2026-08-11, Decision 5): a real user can
    // never see or focus this off-screen field. If it is non-empty it was
    // autofilled/scripted — abort silently, no banner, no POST. NEVER sent to
    // the server; the auth gate is the real anti-bot control.
    if (honeypot !== '') return

    // Terms gate (Decision 8): a *validation* concern like missingShipTo below —
    // the button stays enabled and we guard here so the message is announced.
    if (!termsAccepted) {
      setBanner({
        kind: 'error',
        msg: 'Please read and agree to the Terms & Conditions before placing your order.',
      })
      return
    }

    const missingShipTo = cart.lines.some(
```

- [ ] **Step 6: Add the POST body fields**

In `components/checkout/CheckoutReviewClient.tsx`, in the `fetch('/api/checkout', …)` body object, add the two fields right before `custom_shipping_address` (line 232). We only reach here past the `!termsAccepted` guard, so `true` is correct:

```ts
          })),
          // Consent for this order (design 2026-08-11). The server re-validates
          // and 400s without these — the checkbox is not the only gate.
          terms_accepted: true,
          terms_version: TERMS_VERSION,
          custom_shipping_address: allCustom ? reviewState.customAddress : null,
```

- [ ] **Step 7: Add the checkbox + honeypot UI and the modal**

In `components/checkout/CheckoutReviewClient.tsx`, add a new `<section>` as the last child of the `<div className="space-y-6">` content block — immediately after the closing `</section>` of "Shipping and options" (line 653) and before the `</div>` that closes `space-y-6` (line 654):

```tsx
        </section>

        <section className="mt-6">
          {/*
            Client-only honeypot (design 2026-08-11, Decision 5). Deliberately
            NOT Tailwind `sr-only` — that EXPOSES the field to screen readers,
            the one false-positive path where a real assistive-tech user could
            fill it. Off-screen + aria-hidden + tabIndex=-1 keeps it out of both
            the visual and the accessibility tree. autoComplete="off" + an
            autofill-resistant name avoid browser autofill tripping it.
          */}
          <input
            type="text"
            name="company_url"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
            style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px', overflow: 'hidden' }}
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
          />
          <label htmlFor="terms-agree" className="flex items-start gap-2 text-sm text-gray-700">
            <input
              id="terms-agree"
              type="checkbox"
              checked={termsAccepted}
              onChange={(e) => setTermsAccepted(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-pr-blue focus:ring-pr-blue/40"
            />
            <span>
              I have read and agree to the{' '}
              <button
                type="button"
                onClick={(e) => {
                  // Stop the label from forwarding the click to the checkbox —
                  // opening the terms must not tick the box.
                  e.preventDefault()
                  e.stopPropagation()
                  setTermsOpen(true)
                }}
                className="font-medium text-pr-blue underline underline-offset-2 hover:text-pr-blue/80"
              >
                Terms &amp; Conditions
              </button>
            </span>
          </label>
        </section>
        </div>
      </div>

      {termsOpen && <TermsModal onClose={() => setTermsOpen(false)} />}
```

Note: the last three lines above (`</div>`, `</div>`, and the `{termsOpen && …}` before the `<CheckoutCTAStickyBar`) replace the existing `</div>\n      </div>` at lines 654-655 — insert the modal render between that closing block and the `<CheckoutCTAStickyBar` element (line 657). The checkbox `<section>` is inside `space-y-6`; the modal render is a sibling of `CheckoutCTAStickyBar` at the top level of the returned fragment.

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm exec vitest run components/checkout/__tests__/CheckoutReviewClient.terms.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 9: Run the sibling review-client tests for no regression**

Run: `pnpm exec vitest run components/checkout/__tests__/`
Expected: PASS. The added checkbox/honeypot are inert unless interacted with, so the existing branch/billing/conflict tests are unaffected. If any prior test drives a full happy-path POST and asserts the body shape, add `terms_accepted`/`terms_version` to its expectation.

- [ ] **Step 10: Commit**

```bash
git add components/checkout/CheckoutReviewClient.tsx components/checkout/__tests__/CheckoutReviewClient.terms.test.tsx
git commit -m "feat(checkout): T&C agreement checkbox, modal link + client honeypot"
```

---

## Final verification

- [ ] **Run the full suite:** `pnpm test` — expect green.
- [ ] **Type-check:** `pnpm exec tsc --noEmit` (or the repo's `pnpm build`) — expect no errors from the new `terms_accepted` / `terms_version` fields.
- [ ] **Manual smoke (optional):** on `/checkout/review`, confirm the checkbox starts unticked, the inline link opens the modal (showing version `v1-2026-08-11`), placing an order while unticked shows the banner, and a normal ticked order succeeds.

---

## Self-Review (completed against the spec)

- **Spec coverage:** T&C checkbox + modal (Task 1 + 4); versioned constant (Task 1); server gate incl. non-empty-version rejection (Task 3); ORDER_SUBMIT metadata + dedicated TERMS_ACCEPTED per order (Task 2); two events for a split cart (Task 2 records inside `submitCustomerOrder`, called once per partition — the route in Task 3 threads terms into every call); accept-duplicate retries (Task 2, best-effort, no dedup); client-only honeypot (Task 4); re-agree every order (Task 4 ephemeral state); genuine placeholder terms (Task 1 `TermsContent`); button-enabled-with-guard (Task 4 mirrors `missingShipTo`); version format `v1-2026-08-11` (Task 1). Out-of-scope items (no `/terms` route, no schema change, no server honeypot, no IP capture, no dedup) are respected — none appear as tasks.
- **Placeholder scan:** none — every code step carries complete code and every test has real assertions.
- **Type consistency:** `terms_accepted: boolean` / `terms_version: string` are named identically across `CheckoutRequestBody` (Task 3), `CheckoutInput` (Task 2), the POST body (Task 4) and all tests; `AUDIT_ACTIONS.TERMS_ACCEPTED === 'order.terms_accepted'`; `TERMS_VERSION === 'v1-2026-08-11'` used verbatim in every assertion.
- **One correction folded in vs. the spec's loose wording:** the honeypot is styled off-screen + `aria-hidden` + `tabIndex=-1`, explicitly NOT Tailwind `sr-only` — `sr-only` exposes the field to screen readers, which is the exact false-positive path Decision 5 warns against. Rationale is captured in the code comment.
```
