# Starshipit Order-Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push portal orders into the existing "Print Room Dispatch" Starshipit account (stock-on-hand at placement, made-to-order when Monday production hits "All Production Complete") so staff can print courier tickets — push side only, customer tracking stays on Monday.

**Architecture:** All application code lives in `print-room-portal`; the one schema change (two columns on `orders`) lives in `print-room-staff-portal` (the schema owner). Two push paths share one client and one orchestrator (`pushOrderToStarshipit`): the existing dark checkout step 5d, and a new self-filtering bridge called from the Monday tracker-status webhook's `after()` block. Everything is inert while `STARSHIPIT_ENABLED` is unset.

**Tech Stack:** Next.js (App Router), Supabase (service-role client), Vitest, Starshipit REST API (`https://api.starshipit.com`, headers `StarShipIT-Api-Key` + `Ocp-Apim-Subscription-Key`).

**Spec:** `docs/superpowers/specs/2026-08-06-starshipit-order-push-design.md` (decisions D1–D8).

## Global Constraints

- **Push-only build (D8):** never touch `app/api/webhooks/starshipit/route.ts`, `lib/starshipit/apply-webhook.ts`, `lib/starshipit/verify-webhook.ts`, or `lib/starshipit/status.ts`. `STARSHIPIT_WEBHOOK_SECRET` stays unset.
- **Repo split:** all app code in `/Users/jamierogangeorge/Documents/print-room-portal`. Schema changes ONLY as a migration in `/Users/jamierogangeorge/Documents/print-room-staff-portal/supabase/migrations/` — the portal repo's `supabase/migrations/README.md` forbids migrations there. No other staff-repo code changes.
- **Dark switch:** `STARSHIPIT_ENABLED` gates every path. While unset there must be zero behaviour change AND zero reads of the new `orders.starshipit_*` columns — the code must be safe to deploy before the migration is applied. The migration must be applied to prod BEFORE the flag is ever set (Task 8).
- **Best-effort:** a Starshipit failure must never fail checkout or make the Monday webhook return non-200. Failures audit `ORDER_STARSHIPIT_PUSH_FAILED`; skips audit `ORDER_STARSHIPIT_SKIPPED`.
- **Test artifacts:** any live test order uses email `jamie@theprint-room.co.nz` (never `jon@`, never a real customer), is clearly named `PORTAL-TEST-*` / "DO NOT SHIP", and is deleted after verification.
- **Rate limit:** Starshipit allows 2 req/s. All paths here push one order per event — no batching, no parallel fan-out.
- **Tests:** Vitest. Run all: `npm test`. Run one file: `npx vitest run <path>`. Starshipit tests are colocated in `lib/starshipit/__tests__/`.
- **Typecheck:** `npx tsc --noEmit` has a small pre-existing error baseline in this repo. Capture the baseline count before Task 3; no task may add a new error.
- **Commits:** commit after every task, local only — do NOT push to origin (deploys are HITL). End every commit message with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Staff repo caution:** the staff repo working tree may hold unrelated uncommitted work. Commit the migration with an explicit pathspec only (Task 1 shows how); never `git add -A`.

## Decisions resolved at planning time

The spec left two items as planning tasks; they are resolved as follows (surfaced to Jon with this plan):

1. **Ready-to-dispatch trigger label = raw Monday label "All Production Complete"** (normalized key `all-production-complete`). Rationale: staff must print the ticket BEFORE shipping, so the `dispatched` bucket ("Shipped", "Closed Job", …) is too late, and "Assign to Production" is too early. This mirrors `lib/email/milestone-email.ts`, which also keys milestones on the raw label rather than the canonical bucket. The label set is a one-line constant (`READY_TO_DISPATCH_LABELS`, Task 9) so more labels can be added later.
2. **Weight is omitted entirely.** Verified 2026-08-06: no weight column exists on `products`, `product_variants`, `quote_items`, or any other table in either repo. Spec D5's "weight when derivable" therefore resolves to "not derivable" — staff enter weight in Starshipit at print time (their current workflow). No new weight column (YAGNI).
3. **`sku` is not populated** in the items payload. `quote_items` has no sku column; the `products(sku)` join is unverified as a PostgREST embed (`quote_items.product_id` is inserted untyped by the RPC). The `StarshipitOrderItem` type keeps an optional `sku` field for later. Item descriptions carry `product_name — size — colour`, which is what staff need on a ticket.
4. **A second column, `orders.starshipit_order_id`, rides along with `starshipit_pushed_at`** (extends spec D6). It stores Starshipit's own id at push time so P3 delete-on-cancel needs no lookup call.
5. **P3 scope:** delete-on-cancel wires into the portal's only cancel path (`app/api/orders/[id]/cancel-pre-order/route.ts`). Staff-initiated cancels (`cancel_order_atomically`, staff repo) are NOT covered — flagged as follow-up, out of this build per the spec's "all code in print-room-portal".

## File map

| Repo | Path | Action | Responsibility |
|---|---|---|---|
| staff | `supabase/migrations/20260806100000_orders_starshipit_push_columns.sql` | Create | Idempotency stamp + Starshipit id columns |
| portal | `.env.example` | Modify | Document the 3 env vars |
| portal | `scripts/starshipit-test-push.mjs` | Create | P0 live schema verification (create + delete a test order) |
| portal | `lib/starshipit/eligibility.ts` | Modify | Pure gate: trigger axis + `already_pushed` |
| portal | `lib/starshipit/items.ts` | Create | `quote_items` → Starshipit `items[]` mapper + loader |
| portal | `lib/starshipit/client.ts` | Modify | Verified payload: items + city; later `deleteStarshipitOrder` |
| portal | `lib/starshipit/push-order.ts` | Modify | Orchestrator: flag → idempotency read → eligibility → items → create → stamp → audit |
| portal | `lib/checkout/submit.ts` | Modify | Step 5d passes `trigger: 'placement'` + `quoteId` |
| portal | `lib/starshipit/ready-to-dispatch.ts` | Create | Raw-label detector for "All Production Complete" |
| portal | `lib/starshipit/push-on-production-complete.ts` | Create | Made-to-order bridge: resolve order/quote/org → push |
| portal | `app/api/webhooks/monday/tracker-status/route.ts` | Modify | Call the bridge inside the existing `after()` block |
| portal | `lib/audit/actions.ts` | Modify | Add `ORDER_STARSHIPIT_DELETED` / `_DELETE_FAILED` (P3) |
| portal | `lib/starshipit/delete-on-cancel.ts` | Create | P3: delete queue entry + clear stamp on cancel |
| portal | `app/api/orders/[id]/cancel-pre-order/route.ts` | Modify | P3: call delete-on-cancel after successful RPC |

Tests: colocated — `lib/starshipit/__tests__/{eligibility,items,client,push-order,ready-to-dispatch,push-on-production-complete,delete-on-cancel}.test.ts` plus additions to `app/api/webhooks/monday/tracker-status/__tests__/route.test.ts`.

---

# Phase P0 — Verify & prep (no customer impact)

### Task 1: Schema migration — `orders.starshipit_pushed_at` + `orders.starshipit_order_id`

**Files:**
- Create: `/Users/jamierogangeorge/Documents/print-room-staff-portal/supabase/migrations/20260806100000_orders_starshipit_push_columns.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: nullable columns `public.orders.starshipit_pushed_at timestamptz` and `public.orders.starshipit_order_id text`, read/written by Tasks 6 and 13. NOT applied to prod in this task — application is a gated step in Task 8.

- [x] **Step 1: Check the staff repo working tree**

Run: `git -C /Users/jamierogangeorge/Documents/print-room-staff-portal status --short && git -C /Users/jamierogangeorge/Documents/print-room-staff-portal branch --show-current`
Expected: note the current branch (mainline is `master`) and any unrelated dirty files. Do not touch them; this task commits only the new migration file via explicit pathspec.

- [x] **Step 2: Write the migration**

Create `/Users/jamierogangeorge/Documents/print-room-staff-portal/supabase/migrations/20260806100000_orders_starshipit_push_columns.sql`:

```sql
-- Starshipit order-push (portal design spec
-- print-room-portal/docs/superpowers/specs/2026-08-06-starshipit-order-push-design.md,
-- decisions D6/D7).
--
-- starshipit_pushed_at: idempotency stamp. Set once when the portal registers
-- the order in Starshipit (POST /api/orders); every push path checks it first,
-- which makes the repeatable Monday-webhook trigger at-least-once safe.
--
-- starshipit_order_id: Starshipit's own id for the created order, captured at
-- push time so delete-on-cancel (P3) can remove the queue entry without a
-- lookup call.
alter table public.orders
  add column if not exists starshipit_pushed_at timestamptz;

comment on column public.orders.starshipit_pushed_at is
  'When the portal registered this order in Starshipit (POST /api/orders). NULL = never pushed. Idempotency guard: all push paths skip when set.';

alter table public.orders
  add column if not exists starshipit_order_id text;

comment on column public.orders.starshipit_order_id is
  'Starshipit order_id returned at push time. Used by delete-on-cancel to remove the Starshipit queue entry. NULL when never pushed (or cleared after a delete).';
```

- [x] **Step 3: Verify ordering**

Run: `ls /Users/jamierogangeorge/Documents/print-room-staff-portal/supabase/migrations/ | tail -3`
Expected: `20260806100000_orders_starshipit_push_columns.sql` sorts last (after `20260805130000_drop_redundant_submit_b2b_order_overload.sql`).

- [x] **Step 4: Commit (pathspec only)**

```bash
cd /Users/jamierogangeorge/Documents/print-room-staff-portal
git add supabase/migrations/20260806100000_orders_starshipit_push_columns.sql
git commit -m "feat(schema): orders.starshipit_pushed_at + starshipit_order_id for Starshipit push

Idempotency stamp + Starshipit id for the portal order-push build (spec
2026-08-06, D6/D7). Nullable, dark until STARSHIPIT_ENABLED; apply to prod
before the flag is first set.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -- supabase/migrations/20260806100000_orders_starshipit_push_columns.sql
```

**Do NOT apply this migration to prod in this task.** It is applied in Task 8, immediately before enablement.

---

### Task 2: Env documentation + P0 live-verification script

**Files:**
- Modify: `/Users/jamierogangeorge/Documents/print-room-portal/.env.example` (append at end)
- Create: `/Users/jamierogangeorge/Documents/print-room-portal/scripts/starshipit-test-push.mjs`

**Interfaces:**
- Consumes: env vars `STARSHIPIT_API_KEY`, `STARSHIPIT_SUBSCRIPTION_KEY` (from Starshipit web app → Settings → API — Jon supplies these; the runbook steps below are HITL).
- Produces: the verified live `/api/orders` request/response schema, recorded as a "P0 findings" section appended to the design spec. Tasks 5 and 12 consume those findings.

- [x] **Step 1: Document the env vars**

Append to `/Users/jamierogangeorge/Documents/print-room-portal/.env.example`:

```bash
# --- Starshipit (push-only; dark until STARSHIPIT_ENABLED is truthy) ---
# Registers portal orders in the "Print Room Dispatch" account so staff can
# print courier tickets. Keys: Starshipit web app -> Settings -> API.
# STARSHIPIT_WEBHOOK_SECRET stays UNSET — inbound tracking is out of scope.
# STARSHIPIT_ENABLED=
# STARSHIPIT_API_KEY=
# STARSHIPIT_SUBSCRIPTION_KEY=
```

- [x] **Step 2: Write the verification script**

Create `/Users/jamierogangeorge/Documents/print-room-portal/scripts/starshipit-test-push.mjs`:

```js
#!/usr/bin/env node
// P0 live-schema verification for the Starshipit order push (design spec §7.1).
// Creates ONE clearly-marked TEST order in the Print Room Dispatch account and
// prints the raw response so the real /api/orders schema can be captured.
//
// Usage:
//   STARSHIPIT_API_KEY=... STARSHIPIT_SUBSCRIPTION_KEY=... \
//     node scripts/starshipit-test-push.mjs                  # create test order
//   ... node scripts/starshipit-test-push.mjs --delete <order_id>   # clean up
//
// Never use a real customer address or email here.

const BASE_URL = 'https://api.starshipit.com'

const apiKey = process.env.STARSHIPIT_API_KEY
const subKey = process.env.STARSHIPIT_SUBSCRIPTION_KEY
if (!apiKey || !subKey) {
  console.error('Set STARSHIPIT_API_KEY and STARSHIPIT_SUBSCRIPTION_KEY')
  process.exit(1)
}

const headers = {
  'StarShipIT-Api-Key': apiKey,
  'Ocp-Apim-Subscription-Key': subKey,
  'Content-Type': 'application/json',
}

async function call(method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  console.log(`${method} ${path} -> HTTP ${res.status}`)
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2))
  } catch {
    console.log(text)
  }
  return res
}

const [, , flag, deleteId] = process.argv
if (flag === '--delete') {
  if (!deleteId) {
    console.error('Usage: node scripts/starshipit-test-push.mjs --delete <order_id>')
    process.exit(1)
  }
  await call('DELETE', `/api/orders/delete?order_id=${encodeURIComponent(deleteId)}`)
  process.exit(0)
}

const orderNumber = `PORTAL-TEST-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}`
await call('POST', '/api/orders', {
  order: {
    order_number: orderNumber,
    reference: 'PORTAL P0 TEST - DO NOT SHIP - DELETE AFTER VERIFYING',
    destination: {
      name: 'TEST DO NOT SHIP',
      email: 'jamie@theprint-room.co.nz',
      phone: '021000000',
      company: 'The Print Room (portal test)',
      street: '1 Test Street',
      suburb: 'Newmarket',
      city: 'Auckland',
      state: '',
      post_code: '1023',
      country: 'New Zealand',
    },
    items: [
      { description: 'TEST ITEM - portal P0 schema check', quantity: 1, value: 1 },
    ],
  },
})
```

- [x] **Step 3: Syntax-check the script (no credentials → clean exit 1)**

Run: `node /Users/jamierogangeorge/Documents/print-room-portal/scripts/starshipit-test-push.mjs`
Expected: prints `Set STARSHIPIT_API_KEY and STARSHIPIT_SUBSCRIPTION_KEY`, exit code 1. Any SyntaxError = fix before committing.

- [x] **Step 4: Commit**

```bash
cd /Users/jamierogangeorge/Documents/print-room-portal
git add .env.example scripts/starshipit-test-push.mjs
git commit -m "chore(starshipit): document env vars + P0 live schema verification script

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [x] **Step 5 (HITL — requires Jon + Starshipit credentials): run the P0 runbook** — DONE 2026-08-06 (create + delete verified against the live account, payload confirmed as coded, weight resolved via account default packaging; findings in the spec's "P0 findings" section). One item moved to Task 8: the account-webhook settings check.

This step is a checkpoint: pause and ask Jon for the API keys (Starshipit web app → Settings → API), then:

1. `STARSHIPIT_API_KEY=... STARSHIPIT_SUBSCRIPTION_KEY=... node scripts/starshipit-test-push.mjs` — capture the full response. Record: HTTP status, `success` flag, where the order id lives (`order.order_id`?), and any field-name rejections.
2. In the Starshipit web app: confirm the `PORTAL-TEST-*` order appears in **Unshipped** with the destination and the test item visible.
3. Attempt to print a label/ticket for it (do NOT ship): record whether NZ Post requires a weight before printing, and whether staff can enter it at print time. This settles spec risk 2.
4. Settings → Tracking & notifications: confirm the account webhook URL is **not** pointed at the portal (`/api/webhooks/starshipit`). Leave whatever is there untouched. This settles spec risk 4.
5. Clean up: `... node scripts/starshipit-test-push.mjs --delete <order_id>` using the id from step 1 — this also verifies the P3 delete endpoint. Record its response shape.
6. Append a `## P0 findings (2026-08-XX)` section to `docs/superpowers/specs/2026-08-06-starshipit-order-push-design.md` recording all of the above, and commit it.

**If any field name or response path differs from the script's payload, Tasks 5 and 12 must be adjusted to the recorded findings before implementation.**

---

# Phase P1 — Enable stock-on-hand

### Task 3: Eligibility — trigger axis + `already_pushed`

**Files:**
- Modify: `/Users/jamierogangeorge/Documents/print-room-portal/lib/starshipit/eligibility.ts`
- Test: `/Users/jamierogangeorge/Documents/print-room-portal/lib/starshipit/__tests__/eligibility.test.ts`

**Interfaces:**
- Consumes: nothing (pure function).
- Produces: `export type StarshipitPushTrigger = 'placement' | 'production_complete'`; `StarshipitEligibilityInput` gains required `trigger: StarshipitPushTrigger` and `alreadyPushed: boolean`; reason union gains `'already_pushed'`. Precedence: `disabled > test_org > inventory_intent > already_pushed > not_stock_on_hand (placement only) > non_delivery_type > no_address`. Tasks 6 and 7 consume these.

- [x] **Step 1: Update the test file with the new base input and failing cases**

Replace the `base` constant in `lib/starshipit/__tests__/eligibility.test.ts`:

```ts
const base: StarshipitEligibilityInput = {
  enabled: true,
  trigger: 'placement',
  intent: 'customer',
  isTestOrg: false,
  alreadyPushed: false,
  isStockOnHand: true,
  hasDeliveryAddress: true,
  orderType: null,
}
```

Append these cases inside the existing `describe` block:

```ts
  it('skips an already-pushed order (idempotency, D6)', () => {
    expect(evaluateStarshipitEligibility({ ...base, alreadyPushed: true }))
      .toEqual({ eligible: false, reason: 'already_pushed' })
  })
  it('production_complete trigger: a made-to-order order IS eligible', () => {
    expect(evaluateStarshipitEligibility({ ...base, trigger: 'production_complete', isStockOnHand: false }))
      .toEqual({ eligible: true, reason: 'ok' })
  })
  it('production_complete trigger still requires a delivery address', () => {
    expect(evaluateStarshipitEligibility({
      ...base, trigger: 'production_complete', isStockOnHand: false, hasDeliveryAddress: false,
    })).toEqual({ eligible: false, reason: 'no_address' })
  })
  it('precedence: already_pushed beats not_stock_on_hand', () => {
    expect(evaluateStarshipitEligibility({ ...base, alreadyPushed: true, isStockOnHand: false }))
      .toEqual({ eligible: false, reason: 'already_pushed' })
  })
```

Also update the final "precedence" test's input object to include the two new required fields (`trigger: 'placement'`, `alreadyPushed: true`) — expected reason stays `'test_org'`.

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/starshipit/__tests__/eligibility.test.ts`
Expected: FAIL — TypeScript/compile errors on the new fields and missing `already_pushed` reason.

- [x] **Step 3: Implement**

Replace the type declarations and function in `lib/starshipit/eligibility.ts` (keep the file-top comment block, add a line noting the trigger axis):

```ts
/** Which event initiated the push — decides whether the stock gate applies. */
export type StarshipitPushTrigger = 'placement' | 'production_complete'

export type StarshipitIneligibleReason =
  | 'disabled'
  | 'test_org'
  | 'inventory_intent'
  | 'already_pushed'
  | 'not_stock_on_hand'
  | 'non_delivery_type'
  | 'no_address'
export type StarshipitEligibilityReason = 'ok' | StarshipitIneligibleReason

export interface StarshipitEligibilityInput {
  /** isStarshipitEnabled() result. */
  enabled: boolean
  /** placement = checkout step 5d (stock gate applies); production_complete =
   *  Monday "All Production Complete" bridge (stock gate does NOT apply). */
  trigger: StarshipitPushTrigger
  /** Order-level checkout intent — 'inventory' orders never ship to a customer. */
  intent: 'customer' | 'inventory'
  isTestOrg: boolean
  /** orders.starshipit_pushed_at already set — D6 idempotency guard. */
  alreadyPushed: boolean
  /** Spec A order_type gate — at PLACEMENT Starshipit takes stock orders only.
   *  A purchase-order ships later via the production_complete trigger. */
  isStockOnHand: boolean
  hasDeliveryAddress: boolean
  /** Optional delivery/pickup discriminator (NOT Spec A order_type). */
  orderType?: string | null
}

export interface StarshipitEligibility {
  eligible: boolean
  reason: StarshipitEligibilityReason
}

export function evaluateStarshipitEligibility(
  input: StarshipitEligibilityInput,
): StarshipitEligibility {
  if (!input.enabled) return { eligible: false, reason: 'disabled' }
  if (input.isTestOrg) return { eligible: false, reason: 'test_org' }
  if (input.intent === 'inventory') return { eligible: false, reason: 'inventory_intent' }
  if (input.alreadyPushed) return { eligible: false, reason: 'already_pushed' }
  if (input.trigger === 'placement' && !input.isStockOnHand)
    return { eligible: false, reason: 'not_stock_on_hand' }
  if (input.orderType != null && input.orderType !== 'delivery')
    return { eligible: false, reason: 'non_delivery_type' }
  if (!input.hasDeliveryAddress) return { eligible: false, reason: 'no_address' }
  return { eligible: true, reason: 'ok' }
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/starshipit/__tests__/eligibility.test.ts`
Expected: PASS (all cases). Note: `lib/starshipit/__tests__/push-order.test.ts` will now FAIL to compile (its args lack `trigger`/`quoteId`) — that is expected and fixed in Task 6; do not "fix" push-order here.

- [x] **Step 5: Commit**

```bash
cd /Users/jamierogangeorge/Documents/print-room-portal
git add lib/starshipit/eligibility.ts lib/starshipit/__tests__/eligibility.test.ts
git commit -m "feat(starshipit): eligibility gains push trigger axis + already_pushed guard

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Items module — `quote_items` → Starshipit `items[]`

**Files:**
- Create: `/Users/jamierogangeorge/Documents/print-room-portal/lib/starshipit/items.ts`
- Test: `/Users/jamierogangeorge/Documents/print-room-portal/lib/starshipit/__tests__/items.test.ts`

**Interfaces:**
- Consumes: Supabase admin client; `quote_items` rows via the proven embed `product_variants ( product_color_swatches ( label ) )` (same select shape as `lib/xero/draft-invoice.ts:316`).
- Produces: `export interface StarshipitOrderItem { description: string; sku?: string; quantity: number; value?: number }`; `mapQuoteItemsToStarshipitItems(rows): StarshipitOrderItem[]` (pure); `loadStarshipitOrderItems(admin, quoteId): Promise<StarshipitOrderItem[]>` (returns `[]` on any query error — best-effort). Tasks 5 and 6 consume these.

- [x] **Step 1: Write the failing tests**

Create `lib/starshipit/__tests__/items.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { mapQuoteItemsToStarshipitItems, loadStarshipitOrderItems } from '../items'

describe('mapQuoteItemsToStarshipitItems', () => {
  it('builds "name — size — colour" descriptions with quantity and value', () => {
    const items = mapQuoteItemsToStarshipitItems([
      {
        product_name: 'Classic Tee',
        quantity: 5,
        unit_price: 24.5,
        size_label: 'L',
        product_variants: { product_color_swatches: { label: 'Black' } },
      },
    ])
    expect(items).toEqual([
      { description: 'Classic Tee — L — Black', quantity: 5, value: 24.5 },
    ])
  })

  it('tolerates array-shaped PostgREST embeds', () => {
    const items = mapQuoteItemsToStarshipitItems([
      {
        product_name: 'Cap',
        quantity: 2,
        unit_price: 12,
        size_label: null,
        product_variants: [{ product_color_swatches: [{ label: 'Red' }] }],
      },
    ])
    expect(items[0].description).toBe('Cap — Red')
  })

  it('falls back to "Item", quantity 1, and no value on sparse rows', () => {
    const items = mapQuoteItemsToStarshipitItems([
      { product_name: null, quantity: null, unit_price: null, size_label: null, product_variants: null },
    ])
    expect(items).toEqual([{ description: 'Item', quantity: 1 }])
  })
})

describe('loadStarshipitOrderItems', () => {
  function makeAdmin(result: { data: unknown; error: { message: string } | null }) {
    const eq = vi.fn().mockResolvedValue(result)
    const select = vi.fn(() => ({ eq }))
    const from = vi.fn(() => ({ select }))
    return { admin: { from } as unknown as SupabaseClient, from, select, eq }
  }

  it('queries quote_items by quote_id and maps the rows', async () => {
    const { admin, from, eq } = makeAdmin({
      data: [{ product_name: 'Hoodie', quantity: 3, unit_price: 55, size_label: 'M', product_variants: null }],
      error: null,
    })
    const items = await loadStarshipitOrderItems(admin, 'q1')
    expect(from).toHaveBeenCalledWith('quote_items')
    expect(eq).toHaveBeenCalledWith('quote_id', 'q1')
    expect(items).toEqual([{ description: 'Hoodie — M', quantity: 3, value: 55 }])
  })

  it('returns [] on a query error (best-effort — an address-only ticket still prints)', async () => {
    const { admin } = makeAdmin({ data: null, error: { message: 'boom' } })
    await expect(loadStarshipitOrderItems(admin, 'q1')).resolves.toEqual([])
  })
})
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/starshipit/__tests__/items.test.ts`
Expected: FAIL — cannot resolve `../items`.

- [x] **Step 3: Implement**

Create `lib/starshipit/items.ts`:

```ts
// lib/starshipit/items.ts
//
// quote_items -> Starshipit items[] (design D5). Line items are enrichment:
// they make the printed ticket/packing slip complete, but a failed load must
// never lose the push — loadStarshipitOrderItems degrades to [] on error.
//
// No sku: quote_items carries none, and the products(sku) embed is unverified
// (product_id is inserted untyped by submit_b2b_order). No weight: verified
// 2026-08-06 that no weight column exists anywhere in the schema — staff enter
// weight in Starshipit at print time.
import type { SupabaseClient } from '@supabase/supabase-js'

export interface StarshipitOrderItem {
  description: string
  sku?: string
  quantity: number
  value?: number
}

type SwatchEmbed = { label?: string | null } | Array<{ label?: string | null }> | null | undefined
type VariantEmbed =
  | { product_color_swatches?: SwatchEmbed }
  | Array<{ product_color_swatches?: SwatchEmbed }>
  | null
  | undefined

export interface StarshipitQuoteItemRow {
  product_name: string | null
  quantity: number | null
  unit_price: number | null
  size_label: string | null
  product_variants?: VariantEmbed
}

function first<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function colourLabel(row: StarshipitQuoteItemRow): string | null {
  const variant = first(row.product_variants)
  const swatch = first(variant?.product_color_swatches)
  const label = swatch?.label
  return typeof label === 'string' && label.trim().length > 0 ? label.trim() : null
}

export function mapQuoteItemsToStarshipitItems(
  rows: StarshipitQuoteItemRow[],
): StarshipitOrderItem[] {
  return rows.map((row) => {
    const description =
      [row.product_name, row.size_label, colourLabel(row)]
        .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
        .map((part) => part.trim())
        .join(' — ') || 'Item'
    const quantity =
      typeof row.quantity === 'number' && Number.isFinite(row.quantity) && row.quantity > 0
        ? row.quantity
        : 1
    const item: StarshipitOrderItem = { description, quantity }
    if (typeof row.unit_price === 'number' && Number.isFinite(row.unit_price)) {
      item.value = row.unit_price
    }
    return item
  })
}

export async function loadStarshipitOrderItems(
  admin: SupabaseClient,
  quoteId: string,
): Promise<StarshipitOrderItem[]> {
  const { data, error } = await admin
    .from('quote_items')
    .select(
      'product_name, quantity, unit_price, size_label, product_variants ( product_color_swatches ( label ) )',
    )
    .eq('quote_id', quoteId)
  if (error || !data) return []
  return mapQuoteItemsToStarshipitItems(data as unknown as StarshipitQuoteItemRow[])
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/starshipit/__tests__/items.test.ts`
Expected: PASS (5 tests).

- [x] **Step 5: Commit**

```bash
cd /Users/jamierogangeorge/Documents/print-room-portal
git add lib/starshipit/items.ts lib/starshipit/__tests__/items.test.ts
git commit -m "feat(starshipit): quote_items -> Starshipit items mapper + best-effort loader

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Client — items in the payload + `city` field

**Prerequisite:** Task 2 Step 5 (P0 findings). If P0 recorded different field names or a different response path, use the recorded names instead of the ones below and note the substitution in the commit message.

**Files:**
- Modify: `/Users/jamierogangeorge/Documents/print-room-portal/lib/starshipit/client.ts`
- Test: `/Users/jamierogangeorge/Documents/print-room-portal/lib/starshipit/__tests__/client.test.ts`

**Interfaces:**
- Consumes: `StarshipitOrderItem` from Task 4.
- Produces: `CreateStarshipitOrderArgs` gains optional `items?: StarshipitOrderItem[]`; payload destination gains `city` (both `suburb` and `city` carry the normalized address's city until P0 says otherwise); payload includes `items` only when non-empty. Return contract unchanged (`Promise<string | null>`). Task 6 consumes this.

- [x] **Step 1: Add failing tests**

Append inside the existing `describe('createStarshipitOrder')` block in `lib/starshipit/__tests__/client.test.ts`:

```ts
  it('sends city in both suburb and city, and includes items when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, order: { order_id: 1 } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await createStarshipitOrder({
      orderNumber: 'PR-3',
      address: OK_ADDRESS,
      customerEmail: null,
      items: [{ description: 'Classic Tee — L — Black', quantity: 5, value: 24.5 }],
    })

    const sent = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(sent.order.destination.suburb).toBe('Auckland')
    expect(sent.order.destination.city).toBe('Auckland')
    expect(sent.order.items).toEqual([
      { description: 'Classic Tee — L — Black', quantity: 5, value: 24.5 },
    ])
  })

  it('omits the items key entirely when no items are passed', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, order: { order_id: 1 } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await createStarshipitOrder({ orderNumber: 'PR-4', address: OK_ADDRESS, customerEmail: null })

    const sent = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect('items' in sent.order).toBe(false)
  })
```

- [x] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run lib/starshipit/__tests__/client.test.ts`
Expected: 2 existing tests PASS, 2 new tests FAIL (no `city`, no `items`).

- [x] **Step 3: Implement**

In `lib/starshipit/client.ts`: add the import, extend the args interface, and update the payload. The function becomes:

```ts
import type { StarshipitOrderItem } from './items'
```

```ts
export interface CreateStarshipitOrderArgs {
  /** order_ref — also the job_trackers.job_reference the webhook matches on. */
  orderNumber: string
  address: NormalizedShippingAddress
  customerEmail: string | null
  /** Line items for the printed ticket/packing slip (design D5). Optional. */
  items?: StarshipitOrderItem[]
}
```

```ts
  const a = args.address
  const payload = {
    order: {
      order_number: args.orderNumber,
      destination: {
        name: a.name ?? '',
        street: a.street ?? '',
        // The portal address model has one locality field; send it as both
        // suburb (NZ courier convention) and city until P0 findings say otherwise.
        suburb: a.city ?? '',
        city: a.city ?? '',
        state: a.state ?? '',
        post_code: a.postalCode ?? '',
        country: a.country ?? 'New Zealand',
        phone: a.phone ?? '',
        email: args.customerEmail ?? a.email ?? '',
        company: a.company ?? '',
      },
      ...(args.items && args.items.length > 0 ? { items: args.items } : {}),
    },
  }
```

Also replace the stale "MUST be confirmed against Starshipit's live API docs" paragraph in the function's doc comment with:

```ts
 * Endpoint: POST /api/orders. Payload field names + response path verified
 * against the live account in P0 — see "P0 findings" in
 * docs/superpowers/specs/2026-08-06-starshipit-order-push-design.md.
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/starshipit/__tests__/client.test.ts`
Expected: PASS (4 tests).

- [x] **Step 5: Commit**

```bash
cd /Users/jamierogangeorge/Documents/print-room-portal
git add lib/starshipit/client.ts lib/starshipit/__tests__/client.test.ts
git commit -m "feat(starshipit): send line items + city in create-order payload

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: push-order — idempotency read, stamp, items, trigger

**Files:**
- Modify: `/Users/jamierogangeorge/Documents/print-room-portal/lib/starshipit/push-order.ts`
- Test: `/Users/jamierogangeorge/Documents/print-room-portal/lib/starshipit/__tests__/push-order.test.ts`

**Interfaces:**
- Consumes: `StarshipitPushTrigger` + `evaluateStarshipitEligibility` (Task 3), `loadStarshipitOrderItems` (Task 4), `createStarshipitOrder` with items (Task 5), columns from Task 1.
- Produces: `PushOrderToStarshipitArgs` gains required `quoteId: string` and `trigger: StarshipitPushTrigger`. New behaviour: (1) flag checked FIRST, before any DB read — path stays inert and column-free while dark; (2) reads `orders.starshipit_pushed_at` → skip `already_pushed`; (3) loads items best-effort; (4) on success stamps `starshipit_pushed_at` + `starshipit_order_id` (throws if the stamp write fails); (5) audits `ORDER_STARSHIPIT_PUSHED` with `trigger` in metadata. Return type unchanged. Tasks 7 and 10 consume this.

- [x] **Step 1: Rewrite the test file (failing)**

Replace `lib/starshipit/__tests__/push-order.test.ts` entirely:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('../client', () => ({ createStarshipitOrder: vi.fn() }))
vi.mock('../items', () => ({ loadStarshipitOrderItems: vi.fn().mockResolvedValue([]) }))
vi.mock('@/lib/audit/recordEvent', () => ({ recordAuditEvent: vi.fn().mockResolvedValue(undefined) }))

import { pushOrderToStarshipit } from '../push-order'
import { createStarshipitOrder } from '../client'
import { loadStarshipitOrderItems } from '../items'

const createMock = createStarshipitOrder as unknown as ReturnType<typeof vi.fn>
const itemsMock = loadStarshipitOrderItems as unknown as ReturnType<typeof vi.fn>

/** Table-aware admin stub: orders select -> {starshipit_pushed_at}, update recorded. */
function makeAdmin({ pushedAt = null as string | null } = {}) {
  const updates: Array<{ table: string; set: Record<string, unknown>; id: unknown }> = []
  const fromSpy = vi.fn((table: string) => ({
    select: () => ({
      eq: () => ({
        maybeSingle: () =>
          Promise.resolve({ data: { starshipit_pushed_at: pushedAt }, error: null }),
      }),
    }),
    update: (set: Record<string, unknown>) => ({
      eq: (_col: string, id: unknown) => {
        updates.push({ table, set, id })
        return Promise.resolve({ error: null })
      },
    }),
  }))
  return { admin: { from: fromSpy } as unknown as SupabaseClient, fromSpy, updates }
}

const baseArgs = {
  orderId: 'o1',
  orderRef: 'PR-1001',
  quoteId: 'q1',
  organizationId: 'org1',
  actorUserId: 'u1',
  trigger: 'placement' as const,
  intent: 'customer' as const,
  isTestOrg: false,
  isStockOnHand: true,
  customerEmail: 'jamie@theprint-room.co.nz',
  shippingAddress: { name: 'AF', street: '12 Example St', city: 'Auckland', postcode: '1023', country: 'New Zealand' },
}

describe('pushOrderToStarshipit', () => {
  beforeEach(() => {
    process.env.STARSHIPIT_ENABLED = 'true'
    itemsMock.mockResolvedValue([])
  })
  afterEach(() => {
    vi.clearAllMocks()
    delete process.env.STARSHIPIT_ENABLED
  })

  it('skips before ANY db read when the flag is off (dark = column-free)', async () => {
    process.env.STARSHIPIT_ENABLED = ''
    const { admin, fromSpy } = makeAdmin()
    const r = await pushOrderToStarshipit(admin, baseArgs)
    expect(r).toEqual({ status: 'skipped', reason: 'disabled' })
    expect(fromSpy).not.toHaveBeenCalled()
    expect(createStarshipitOrder).not.toHaveBeenCalled()
  })

  it('skips an already-pushed order without calling the client', async () => {
    const { admin } = makeAdmin({ pushedAt: '2026-08-06T00:00:00Z' })
    const r = await pushOrderToStarshipit(admin, baseArgs)
    expect(r).toEqual({ status: 'skipped', reason: 'already_pushed' })
    expect(createStarshipitOrder).not.toHaveBeenCalled()
  })

  it('placement trigger skips a made-to-order order', async () => {
    const { admin } = makeAdmin()
    const r = await pushOrderToStarshipit(admin, { ...baseArgs, isStockOnHand: false })
    expect(r).toEqual({ status: 'skipped', reason: 'not_stock_on_hand' })
  })

  it('production_complete trigger pushes a made-to-order order', async () => {
    createMock.mockResolvedValue('987')
    const { admin } = makeAdmin()
    const r = await pushOrderToStarshipit(admin, {
      ...baseArgs, trigger: 'production_complete', isStockOnHand: false,
    })
    expect(r).toEqual({ status: 'pushed', reason: 'ok', starshipitOrderId: '987' })
  })

  it('loads items for the quote and passes them to the client', async () => {
    createMock.mockResolvedValue('987')
    itemsMock.mockResolvedValue([{ description: 'Tee — L', quantity: 2 }])
    const { admin } = makeAdmin()
    await pushOrderToStarshipit(admin, baseArgs)
    expect(loadStarshipitOrderItems).toHaveBeenCalledWith(admin, 'q1')
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ orderNumber: 'PR-1001', items: [{ description: 'Tee — L', quantity: 2 }] }),
    )
  })

  it('stamps starshipit_pushed_at + starshipit_order_id on success', async () => {
    createMock.mockResolvedValue('987')
    const { admin, updates } = makeAdmin()
    await pushOrderToStarshipit(admin, baseArgs)
    expect(updates).toHaveLength(1)
    expect(updates[0].table).toBe('orders')
    expect(updates[0].id).toBe('o1')
    expect(updates[0].set.starshipit_order_id).toBe('987')
    expect(typeof updates[0].set.starshipit_pushed_at).toBe('string')
  })

  it('throws when the client returns no id (caller audits the failure)', async () => {
    createMock.mockResolvedValue(null)
    const { admin, updates } = makeAdmin()
    await expect(pushOrderToStarshipit(admin, baseArgs)).rejects.toThrow(/no order id/)
    expect(updates).toHaveLength(0)
  })
})
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/starshipit/__tests__/push-order.test.ts`
Expected: FAIL — `quoteId`/`trigger` unknown, no idempotency behaviour.

- [x] **Step 3: Implement**

Replace `lib/starshipit/push-order.ts` entirely:

```ts
// lib/starshipit/push-order.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { recordAuditEvent } from '@/lib/audit/recordEvent'
import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { normalizeShippingAddress } from '@/lib/checkout/shipping-address'
import { isStarshipitEnabled } from './config'
import { evaluateStarshipitEligibility, type StarshipitPushTrigger } from './eligibility'
import { createStarshipitOrder } from './client'
import { loadStarshipitOrderItems } from './items'

export interface PushOrderToStarshipitArgs {
  orderId: string
  orderRef: string
  /** quotes.id — line items live on quote_items, keyed by quote. */
  quoteId: string
  organizationId: string
  actorUserId: string | null
  /** Which event initiated this push — decides whether the stock gate applies. */
  trigger: StarshipitPushTrigger
  intent: 'customer' | 'inventory'
  isTestOrg: boolean
  /** Spec A stock/production axis — gates the PLACEMENT trigger only. */
  isStockOnHand: boolean
  customerEmail: string | null
  shippingAddress: Record<string, unknown> | null
  /**
   * Optional delivery/pickup discriminator — NOT Spec A orders.order_type
   * (which is 'stock_on_hand'|'purchase_order', a stock/production axis). The
   * portal has no pickup concept, so callers pass null; `intent` is the real
   * ship-to-customer signal.
   */
  orderType?: string | null
}

export interface PushOrderResult {
  status: 'pushed' | 'skipped'
  reason: string
  starshipitOrderId?: string
}

/**
 * Register the order in Starshipit, or skip. Idempotent via
 * orders.starshipit_pushed_at (D6): safe under Monday's at-least-once
 * redelivery. Best-effort: THROWS on a Starshipit/DB error so the caller
 * audits ORDER_STARSHIPIT_PUSH_FAILED. Never rolls back the order.
 */
export async function pushOrderToStarshipit(
  admin: SupabaseClient,
  args: PushOrderToStarshipitArgs,
): Promise<PushOrderResult> {
  // Flag first, before any DB read — keeps the path fully inert (and safe to
  // deploy before the starshipit_* columns exist) while dark.
  if (!isStarshipitEnabled()) return { status: 'skipped', reason: 'disabled' }

  const { data: orderRow, error: orderReadError } = await admin
    .from('orders')
    .select('starshipit_pushed_at')
    .eq('id', args.orderId)
    .maybeSingle()
  if (orderReadError) throw new Error(`orders read failed: ${orderReadError.message}`)
  const alreadyPushed = Boolean(
    (orderRow as { starshipit_pushed_at?: string | null } | null)?.starshipit_pushed_at,
  )

  const address = normalizeShippingAddress(args.shippingAddress)
  const hasDeliveryAddress = Boolean(address?.street && address?.city)

  const elig = evaluateStarshipitEligibility({
    enabled: true, // flag checked above
    trigger: args.trigger,
    intent: args.intent,
    isTestOrg: args.isTestOrg,
    alreadyPushed,
    isStockOnHand: args.isStockOnHand,
    hasDeliveryAddress,
    orderType: args.orderType ?? null,
  })
  if (!elig.eligible) return { status: 'skipped', reason: elig.reason }

  // Best-effort enrichment — loadStarshipitOrderItems returns [] on error; a
  // failed items read must never lose the push.
  const items = await loadStarshipitOrderItems(admin, args.quoteId)

  const starshipitOrderId = await createStarshipitOrder({
    orderNumber: args.orderRef,
    address: address!,
    customerEmail: args.customerEmail,
    items,
  })
  if (!starshipitOrderId) throw new Error('Starshipit create-order returned no order id')

  // Stamp BEFORE the audit write: if this fails we throw (caller audits the
  // failure) — the worst case is a rare duplicate queue entry staff can see,
  // never a silently-unguarded repeat path.
  const { error: stampError } = await admin
    .from('orders')
    .update({
      starshipit_pushed_at: new Date().toISOString(),
      starshipit_order_id: starshipitOrderId,
    })
    .eq('id', args.orderId)
  if (stampError) throw new Error(`starshipit stamp failed: ${stampError.message}`)

  await recordAuditEvent(
    {
      orgId: args.organizationId,
      actorUserId: args.actorUserId,
      action: AUDIT_ACTIONS.ORDER_STARSHIPIT_PUSHED,
      targetType: 'order',
      targetId: args.orderId,
      metadata: {
        order_ref: args.orderRef,
        starshipit_order_id: starshipitOrderId,
        trigger: args.trigger,
      },
    },
    admin,
  )

  return { status: 'pushed', reason: 'ok', starshipitOrderId }
}
```

- [x] **Step 4: Run the whole starshipit suite**

Run: `npx vitest run lib/starshipit`
Expected: PASS — eligibility, items, client, push-order, plus the untouched apply-webhook/verify-webhook suites.

- [x] **Step 5: Commit**

```bash
cd /Users/jamierogangeorge/Documents/print-room-portal
git add lib/starshipit/push-order.ts lib/starshipit/__tests__/push-order.test.ts
git commit -m "feat(starshipit): idempotent push — pushed_at guard, items, trigger axis, id stamp

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Checkout step 5d — pass `trigger` + `quoteId`

**Files:**
- Modify: `/Users/jamierogangeorge/Documents/print-room-portal/lib/checkout/submit.ts` (step 5d, around line 2097 — Read the file first; line numbers may have drifted)

**Interfaces:**
- Consumes: `pushOrderToStarshipit` from Task 6. Both `quote_id` and `order_id`/`order_ref` are already in scope at step 5d (destructured from the `submit_b2b_order` RPC row; the catch block already uses `quote_id`).
- Produces: the placement path compiles against the new args. No behaviour change while dark.

- [x] **Step 1: Edit the call**

In `lib/checkout/submit.ts` step 5d, change the `pushOrderToStarshipit` call. Old:

```ts
      const ssResult = await pushOrderToStarshipit(admin, {
        orderId: order_id,
        orderRef: order_ref,
        organizationId: input.context.organizationId,
        actorUserId: input.context.userId,
        intent: input.intent ?? 'customer',
```

New:

```ts
      const ssResult = await pushOrderToStarshipit(admin, {
        orderId: order_id,
        orderRef: order_ref,
        quoteId: quote_id,
        organizationId: input.context.organizationId,
        actorUserId: input.context.userId,
        trigger: 'placement',
        intent: input.intent ?? 'customer',
```

(The remaining args — `isTestOrg`, `isStockOnHand`, `customerEmail`, `shippingAddress` and the orderType comment — stay exactly as they are.)

- [x] **Step 2: Typecheck + run neighbouring tests**

Run: `npx tsc --noEmit` — expected: same error count as the pre-Task-3 baseline (no new errors).
Run: `npx vitest run lib/starshipit lib/checkout` — expected: PASS (any pre-existing checkout test failures noted in memory are pre-existing; nothing NEW may fail).

- [x] **Step 3: Commit**

```bash
cd /Users/jamierogangeorge/Documents/print-room-portal
git add lib/checkout/submit.ts
git commit -m "feat(checkout): step 5d passes trigger=placement + quoteId to Starshipit push

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: P1 enablement runbook (HITL — pause for Jon)

No code. This is the gated go-live for the stock-on-hand path. Every step needs Jon (or explicit authorization):

- [ ] **Step 1:** Apply the Task 1 migration to prod (house pattern: psql against the pooler — remember the password ends `!@`, URL-encode as `!%40`). Verify: `select column_name from information_schema.columns where table_name = 'orders' and column_name like 'starshipit%';` returns both columns.
- [ ] **Step 2:** Merge/deploy the portal mainline containing Tasks 2–7 (deploy is safe before enablement — everything is dark).
- [ ] **Step 2b (from P0):** In the Starshipit web app, Settings → Tracking & notifications — confirm the account webhook is NOT pointed at the portal's `/api/webhooks/starshipit` (it would 401 on every scan). Leave whatever is there untouched.
- [ ] **Step 3:** Set Vercel env vars on the portal project (production): `STARSHIPIT_API_KEY`, `STARSHIPIT_SUBSCRIPTION_KEY`, then `STARSHIPIT_ENABLED=true`. Redeploy to pick them up.
- [ ] **Step 4:** Smoke: place one stock-on-hand order from a TEST org first (expect: skip with reason `test_org` in `audit_events`, nothing in Starshipit). Then one real (or realistic) stock order → confirm it appears in Starshipit Unshipped with items, `audit_events` has `order.starshipit_pushed`, and `orders.starshipit_pushed_at`/`starshipit_order_id` are set. Delete the entry from Starshipit if it was a test.
- [ ] **Step 5:** Rollback lever (verify it's understood): unset `STARSHIPIT_ENABLED` → all pushes halt instantly; no customer-facing effect.

---

# Phase P2 — Made-to-order bridge

### Task 9: Ready-to-dispatch label detector

**Files:**
- Create: `/Users/jamierogangeorge/Documents/print-room-portal/lib/starshipit/ready-to-dispatch.ts`
- Test: `/Users/jamierogangeorge/Documents/print-room-portal/lib/starshipit/__tests__/ready-to-dispatch.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces: `isReadyToDispatchLabel(label: string | null | undefined): boolean` — true only for raw Monday label "All Production Complete" (any casing/punctuation). Task 10 consumes this.

- [x] **Step 1: Write the failing tests**

Create `lib/starshipit/__tests__/ready-to-dispatch.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { isReadyToDispatchLabel } from '../ready-to-dispatch'

describe('isReadyToDispatchLabel', () => {
  it('matches "All Production Complete" (the ready-to-dispatch trigger)', () => {
    expect(isReadyToDispatchLabel('All Production Complete')).toBe(true)
  })
  it('is case- and punctuation-insensitive', () => {
    expect(isReadyToDispatchLabel('ALL PRODUCTION COMPLETE')).toBe(true)
    expect(isReadyToDispatchLabel('all  production   complete')).toBe(true)
  })
  it('rejects too-late labels (ticket must print BEFORE shipping)', () => {
    expect(isReadyToDispatchLabel('Shipped')).toBe(false)
    expect(isReadyToDispatchLabel('Closed Job')).toBe(false)
  })
  it('rejects too-early labels', () => {
    expect(isReadyToDispatchLabel('Assign to Production')).toBe(false)
  })
  it('rejects null/empty', () => {
    expect(isReadyToDispatchLabel(null)).toBe(false)
    expect(isReadyToDispatchLabel(undefined)).toBe(false)
    expect(isReadyToDispatchLabel('')).toBe(false)
  })
})
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/starshipit/__tests__/ready-to-dispatch.test.ts`
Expected: FAIL — cannot resolve `../ready-to-dispatch`.

- [x] **Step 3: Implement**

Create `lib/starshipit/ready-to-dispatch.ts`:

```ts
// lib/starshipit/ready-to-dispatch.ts
//
// Which RAW Monday production labels mean "job complete — ready for a courier
// ticket" (design D4, trigger resolved in the 2026-08-06 plan). Mirrors
// lib/email/milestone-email.ts: keyed on the raw label, deliberately narrower
// than tracker-status-engine's canonical buckets — the 'dispatched' bucket
// ("Shipped", "Closed Job", ...) is too late (the ticket must print BEFORE
// shipping) and "Assign to Production" is too early.

const READY_TO_DISPATCH_LABELS: ReadonlySet<string> = new Set([
  'all-production-complete',
])

function normalizeKey(label: string | null | undefined): string | null {
  if (typeof label !== 'string') return null
  const key = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return key.length > 0 ? key : null
}

export function isReadyToDispatchLabel(label: string | null | undefined): boolean {
  const key = normalizeKey(label)
  return key != null && READY_TO_DISPATCH_LABELS.has(key)
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/starshipit/__tests__/ready-to-dispatch.test.ts`
Expected: PASS (5 tests).

- [x] **Step 5: Commit**

```bash
cd /Users/jamierogangeorge/Documents/print-room-portal
git add lib/starshipit/ready-to-dispatch.ts lib/starshipit/__tests__/ready-to-dispatch.test.ts
git commit -m "feat(starshipit): ready-to-dispatch Monday label detector (All Production Complete)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Production-complete push bridge

**Files:**
- Create: `/Users/jamierogangeorge/Documents/print-room-portal/lib/starshipit/push-on-production-complete.ts`
- Test: `/Users/jamierogangeorge/Documents/print-room-portal/lib/starshipit/__tests__/push-on-production-complete.test.ts`

**Interfaces:**
- Consumes: `isStarshipitEnabled` (config), `isReadyToDispatchLabel` (Task 9), `pushOrderToStarshipit` (Task 6). DB reads: latest `orders` row by `quote_id`; `quotes` (`order_ref`, `customer_email`, `organization_id`, `shipping_address`); `organizations.is_test`.
- Produces: `pushOrderOnProductionComplete(admin: SupabaseClient, args: { quoteId: string; displayLabel: string }): Promise<void>` — self-filtering (flag + label checked inside), NEVER throws. Task 11 calls it on every accepted status change.

- [x] **Step 1: Write the failing tests**

Create `lib/starshipit/__tests__/push-on-production-complete.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('../push-order', () => ({ pushOrderToStarshipit: vi.fn() }))
vi.mock('@/lib/audit/recordEvent', () => ({ recordAuditEvent: vi.fn().mockResolvedValue(undefined) }))

import { pushOrderOnProductionComplete } from '../push-on-production-complete'
import { pushOrderToStarshipit } from '../push-order'
import { recordAuditEvent } from '@/lib/audit/recordEvent'

const pushMock = pushOrderToStarshipit as unknown as ReturnType<typeof vi.fn>
const auditMock = recordAuditEvent as unknown as ReturnType<typeof vi.fn>

const ORDER = {
  id: 'o1',
  status: 'in-production',
  intent: 'customer',
  order_type: 'purchase_order',
  shipping_address: { name: 'AF', street: '12 Example St', city: 'Auckland' },
}
const QUOTE = {
  order_ref: 'PR-1001',
  customer_email: 'jamie@theprint-room.co.nz',
  organization_id: 'org1',
  shipping_address: { name: 'Quote Addr', street: '9 Quote St', city: 'Wellington' },
}
const ORG = { is_test: false }

/** Table-aware stub: maybeSingle resolves per-table fixtures. */
function makeAdmin(tables: Record<string, unknown>) {
  const fromSpy = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'order', 'limit']) {
      builder[m] = vi.fn(() => builder)
    }
    builder.maybeSingle = vi.fn(() =>
      Promise.resolve({ data: tables[table] ?? null, error: null }),
    )
    return builder
  })
  return { admin: { from: fromSpy } as unknown as SupabaseClient, fromSpy }
}

const LABEL = 'All Production Complete'

describe('pushOrderOnProductionComplete', () => {
  beforeEach(() => {
    process.env.STARSHIPIT_ENABLED = 'true'
    pushMock.mockResolvedValue({ status: 'pushed', reason: 'ok', starshipitOrderId: '1' })
  })
  afterEach(() => {
    vi.clearAllMocks()
    delete process.env.STARSHIPIT_ENABLED
  })

  it('no-ops (no DB reads) while the flag is off', async () => {
    process.env.STARSHIPIT_ENABLED = ''
    const { admin, fromSpy } = makeAdmin({})
    await pushOrderOnProductionComplete(admin, { quoteId: 'q1', displayLabel: LABEL })
    expect(fromSpy).not.toHaveBeenCalled()
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('no-ops for non-trigger labels', async () => {
    const { admin, fromSpy } = makeAdmin({})
    await pushOrderOnProductionComplete(admin, { quoteId: 'q1', displayLabel: 'Shipped' })
    expect(fromSpy).not.toHaveBeenCalled()
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('resolves order+quote+org and pushes with the production_complete trigger', async () => {
    const { admin } = makeAdmin({ orders: ORDER, quotes: QUOTE, organizations: ORG })
    await pushOrderOnProductionComplete(admin, { quoteId: 'q1', displayLabel: LABEL })
    expect(pushMock).toHaveBeenCalledWith(admin, {
      orderId: 'o1',
      orderRef: 'PR-1001',
      quoteId: 'q1',
      organizationId: 'org1',
      actorUserId: null,
      trigger: 'production_complete',
      intent: 'customer',
      isTestOrg: false,
      isStockOnHand: false,
      customerEmail: 'jamie@theprint-room.co.nz',
      shippingAddress: ORDER.shipping_address,
    })
  })

  it('falls back to the quote shipping address when the order has none', async () => {
    const { admin } = makeAdmin({
      orders: { ...ORDER, shipping_address: null }, quotes: QUOTE, organizations: ORG,
    })
    await pushOrderOnProductionComplete(admin, { quoteId: 'q1', displayLabel: LABEL })
    expect(pushMock.mock.calls[0][1].shippingAddress).toEqual(QUOTE.shipping_address)
  })

  it('no-ops when the quote has no orders row (quote-form job, not ours)', async () => {
    const { admin } = makeAdmin({ orders: null, quotes: QUOTE, organizations: ORG })
    await pushOrderOnProductionComplete(admin, { quoteId: 'q1', displayLabel: LABEL })
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('no-ops for a cancelled order', async () => {
    const { admin } = makeAdmin({
      orders: { ...ORDER, status: 'cancelled' }, quotes: QUOTE, organizations: ORG,
    })
    await pushOrderOnProductionComplete(admin, { quoteId: 'q1', displayLabel: LABEL })
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('audits ORDER_STARSHIPIT_SKIPPED when the push skips', async () => {
    pushMock.mockResolvedValue({ status: 'skipped', reason: 'already_pushed' })
    const { admin } = makeAdmin({ orders: ORDER, quotes: QUOTE, organizations: ORG })
    await pushOrderOnProductionComplete(admin, { quoteId: 'q1', displayLabel: LABEL })
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'order.starshipit_skipped',
        metadata: expect.objectContaining({ reason: 'already_pushed', trigger: 'production_complete' }),
      }),
      admin,
    )
  })

  it('audits ORDER_STARSHIPIT_PUSH_FAILED and does NOT throw when the push throws', async () => {
    pushMock.mockRejectedValue(new Error('starshipit 500'))
    const { admin } = makeAdmin({ orders: ORDER, quotes: QUOTE, organizations: ORG })
    await expect(
      pushOrderOnProductionComplete(admin, { quoteId: 'q1', displayLabel: LABEL }),
    ).resolves.toBeUndefined()
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'order.starshipit_push_failed',
        metadata: expect.objectContaining({ error: 'starshipit 500' }),
      }),
      admin,
    )
  })
})
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/starshipit/__tests__/push-on-production-complete.test.ts`
Expected: FAIL — cannot resolve `../push-on-production-complete`.

- [x] **Step 3: Implement**

Create `lib/starshipit/push-on-production-complete.ts`:

```ts
// lib/starshipit/push-on-production-complete.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { recordAuditEvent } from '@/lib/audit/recordEvent'
import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { isStarshipitEnabled } from './config'
import { isReadyToDispatchLabel } from './ready-to-dispatch'
import { pushOrderToStarshipit } from './push-order'

export interface ProductionCompletePushArgs {
  /** job_trackers.quote_id from the Monday tracker-status webhook. */
  quoteId: string
  /** Raw Monday status label (event.value.label.text). */
  displayLabel: string
}

/**
 * Made-to-order Starshipit bridge (design D4): when Monday production reaches
 * "All Production Complete", register the order so staff can print the courier
 * ticket. Self-filtering (flag + label checked here) and best-effort: safe to
 * call on EVERY accepted status change, and NEVER throws — the Monday webhook
 * must always return 200. Idempotency lives in pushOrderToStarshipit (D6), so
 * Monday's at-least-once redelivery and label flip-flops cannot double-push.
 */
export async function pushOrderOnProductionComplete(
  admin: SupabaseClient,
  args: ProductionCompletePushArgs,
): Promise<void> {
  try {
    if (!isStarshipitEnabled()) return
    if (!isReadyToDispatchLabel(args.displayLabel)) return

    // Latest order for the quote. Monday also tracks quote-form jobs that have
    // no orders row — those are silently not ours.
    const { data: orderData } = await admin
      .from('orders')
      .select('id, status, intent, order_type, shipping_address')
      .eq('quote_id', args.quoteId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const order = orderData as {
      id: string
      status: string
      intent: string | null
      order_type: string | null
      shipping_address: Record<string, unknown> | null
    } | null
    if (!order) return
    if (order.status === 'cancelled') return

    const { data: quoteData } = await admin
      .from('quotes')
      .select('order_ref, customer_email, organization_id, shipping_address')
      .eq('id', args.quoteId)
      .maybeSingle()
    const quote = quoteData as {
      order_ref: string | null
      customer_email: string | null
      organization_id: string | null
      shipping_address: Record<string, unknown> | null
    } | null
    if (!quote?.order_ref || !quote.organization_id) return

    const { data: orgData } = await admin
      .from('organizations')
      .select('is_test')
      .eq('id', quote.organization_id)
      .maybeSingle()

    try {
      const result = await pushOrderToStarshipit(admin, {
        orderId: order.id,
        orderRef: quote.order_ref,
        quoteId: args.quoteId,
        organizationId: quote.organization_id,
        actorUserId: null,
        trigger: 'production_complete',
        intent: order.intent === 'inventory' ? 'inventory' : 'customer',
        isTestOrg: Boolean((orgData as { is_test?: boolean } | null)?.is_test),
        isStockOnHand: order.order_type === 'stock_on_hand',
        customerEmail: quote.customer_email ?? null,
        shippingAddress: order.shipping_address ?? quote.shipping_address ?? null,
      })
      if (result.status === 'skipped') {
        await recordAuditEvent(
          {
            orgId: quote.organization_id,
            actorUserId: null,
            action: AUDIT_ACTIONS.ORDER_STARSHIPIT_SKIPPED,
            targetType: 'order',
            targetId: order.id,
            metadata: {
              order_ref: quote.order_ref,
              reason: result.reason,
              trigger: 'production_complete',
            },
          },
          admin,
        )
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      console.error('[starshipit] production-complete push failed', {
        quoteId: args.quoteId,
        err: message,
      })
      await recordAuditEvent(
        {
          orgId: quote.organization_id,
          actorUserId: null,
          action: AUDIT_ACTIONS.ORDER_STARSHIPIT_PUSH_FAILED,
          targetType: 'order',
          targetId: order.id,
          metadata: {
            order_ref: quote.order_ref,
            quote_id: args.quoteId,
            error: message,
            trigger: 'production_complete',
          },
        },
        admin,
      )
    }
  } catch (e) {
    // Outer belt-and-braces: never let the bridge disturb the webhook.
    console.error('[starshipit] production-complete bridge error', e)
  }
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/starshipit/__tests__/push-on-production-complete.test.ts`
Expected: PASS (8 tests).

- [x] **Step 5: Commit**

```bash
cd /Users/jamierogangeorge/Documents/print-room-portal
git add lib/starshipit/push-on-production-complete.ts lib/starshipit/__tests__/push-on-production-complete.test.ts
git commit -m "feat(starshipit): made-to-order push bridge on All Production Complete

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Wire the bridge into the Monday webhook

**Files:**
- Modify: `/Users/jamierogangeorge/Documents/print-room-portal/app/api/webhooks/monday/tracker-status/route.ts`
- Test: `/Users/jamierogangeorge/Documents/print-room-portal/app/api/webhooks/monday/tracker-status/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `pushOrderOnProductionComplete` (Task 10); the route's existing `after()` block in `handleTrackerStatusChange` (where `supabase`, `tracker`, and `displayLabel` are in scope); test helpers already in route.test.ts: `statusEvent()`, `post()`, `baseTracker()`, `trackerRow`, `flushAfter()`.
- Produces: on every ACCEPTED status change with a linked quote, the bridge runs after the response is sent. The route's duplicate-suppression (same-canonical guard + 60s window) means redeliveries never reach the bridge; `starshipit_pushed_at` covers the rest.

- [x] **Step 1: Add failing route tests**

In `app/api/webhooks/monday/tracker-status/__tests__/route.test.ts`, add with the other `vi.mock` calls at the top:

```ts
vi.mock('@/lib/starshipit/push-on-production-complete', () => ({
  pushOrderOnProductionComplete: vi.fn().mockResolvedValue(undefined),
}))
```

and with the other imports:

```ts
import { pushOrderOnProductionComplete } from '@/lib/starshipit/push-on-production-complete'
```

Append inside the main `describe` block:

```ts
  it('All Production Complete → invokes the Starshipit production-complete bridge', async () => {
    trackerRow.current = { ...baseTracker(), status: 'proof-approved' }
    const res = await post(
      statusEvent({ value: { label: { index: 9, text: 'All Production Complete' } } }),
    )
    expect(res.status).toBe(200)
    await flushAfter()
    expect(pushOrderOnProductionComplete).toHaveBeenCalledWith(expect.anything(), {
      quoteId: 'q1',
      displayLabel: 'All Production Complete',
    })
  })

  it('a duplicate same-status delivery does NOT re-invoke the bridge', async () => {
    trackerRow.current = { ...baseTracker(), status: 'in-production' }
    const res = await post(
      statusEvent({ value: { label: { index: 9, text: 'All Production Complete' } } }),
    )
    expect(res.status).toBe(200)
    await flushAfter()
    expect(pushOrderOnProductionComplete).not.toHaveBeenCalled()
  })
```

(`baseTracker()` in this file has `quote_id: 'q1'`. The second test works because "All Production Complete" derives to canonical `in-production`, so a tracker already at `in-production` hits the route's same-canonical no-write guard before the `after()` block.)

- [x] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run app/api/webhooks/monday/tracker-status/__tests__/route.test.ts`
Expected: existing tests PASS, the first new test FAILS (`pushOrderOnProductionComplete` never called).

- [x] **Step 3: Implement**

In `app/api/webhooks/monday/tracker-status/route.ts`:

1. Add to the imports at the top:

```ts
import { pushOrderOnProductionComplete } from '@/lib/starshipit/push-on-production-complete'
```

2. Inside `handleTrackerStatusChange`'s `after(async () => { ... })` callback, immediately AFTER the existing `if (tracker.quote_id) { await mirrorStatusToQuote(...) }` block (and inside the same callback), add:

```ts
    if (tracker.quote_id) {
      // Made-to-order Starshipit bridge — self-filtering on flag + label,
      // never throws. See lib/starshipit/push-on-production-complete.ts.
      await pushOrderOnProductionComplete(supabase, {
        quoteId: tracker.quote_id,
        displayLabel,
      })
    }
```

(`supabase` and `displayLabel` are already in scope in that function. Note the existing route tests that don't mock the bridge would still pass even unmocked — the real module returns immediately with `STARSHIPIT_ENABLED` unset — but the mock added in Step 1 keeps the suite hermetic.)

- [x] **Step 4: Run the route suite + full test run**

Run: `npx vitest run app/api/webhooks/monday/tracker-status/__tests__/route.test.ts`
Expected: PASS (all existing + 2 new).
Run: `npm test`
Expected: PASS overall (no new failures vs. the pre-plan baseline).

- [x] **Step 5: Commit**

```bash
cd /Users/jamierogangeorge/Documents/print-room-portal
git add app/api/webhooks/monday/tracker-status/route.ts app/api/webhooks/monday/tracker-status/__tests__/route.test.ts
git commit -m "feat(webhooks): wire Starshipit made-to-order bridge into Monday tracker-status

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

**P2 go-live** needs no new env or migration (Task 8 already covered both): deploy, then flip one real made-to-order job to "All Production Complete" on Monday and confirm the order lands in Starshipit Unshipped + `audit_events` shows `order.starshipit_pushed` with `trigger: production_complete`. HITL.

---

# Phase P3 — Delete-on-cancel (fast-follow)

**Prerequisite:** Task 2 Step 5 confirmed the delete endpoint (`DELETE /api/orders/delete?order_id=...`) against the live account. If the recorded findings differ, adjust the path/param below to match them.

### Task 12: Delete client function + audit actions

**Files:**
- Modify: `/Users/jamierogangeorge/Documents/print-room-portal/lib/starshipit/client.ts`
- Modify: `/Users/jamierogangeorge/Documents/print-room-portal/lib/audit/actions.ts`
- Test: `/Users/jamierogangeorge/Documents/print-room-portal/lib/starshipit/__tests__/client.test.ts`

**Interfaces:**
- Consumes: existing `getHeaders()` / `BASE_URL` in client.ts.
- Produces: `deleteStarshipitOrder(starshipitOrderId: string): Promise<boolean>` (false on handled non-2xx, never throws on HTTP errors); `AUDIT_ACTIONS.ORDER_STARSHIPIT_DELETED = 'order.starshipit_deleted'` and `AUDIT_ACTIONS.ORDER_STARSHIPIT_DELETE_FAILED = 'order.starshipit_delete_failed'`. Task 13 consumes all three. (Note: `lib/audit/actions.ts` mirrors the staff repo's file — mirroring these two entries into the staff repo is a follow-up nicety, NOT part of this build.)

- [x] **Step 1: Add failing tests**

Append a new `describe` block to `lib/starshipit/__tests__/client.test.ts`:

```ts
describe('deleteStarshipitOrder', () => {
  beforeEach(() => {
    process.env.STARSHIPIT_API_KEY = 'k'
    process.env.STARSHIPIT_SUBSCRIPTION_KEY = 's'
  })
  afterEach(() => vi.restoreAllMocks())

  it('DELETEs by starshipit order id and returns true on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) })
    vi.stubGlobal('fetch', fetchMock)
    await expect(deleteStarshipitOrder('987')).resolves.toBe(true)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.starshipit.com/api/orders/delete?order_id=987')
    expect(init.method).toBe('DELETE')
  })

  it('returns false on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ success: false }) }))
    await expect(deleteStarshipitOrder('987')).resolves.toBe(false)
  })
})
```

and add `deleteStarshipitOrder` to the import from `'../client'` at the top of the file.

- [x] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run lib/starshipit/__tests__/client.test.ts`
Expected: new tests FAIL (`deleteStarshipitOrder` not exported).

- [x] **Step 3: Implement**

Append to `lib/starshipit/client.ts`:

```ts
/**
 * Remove an order from the Starshipit queue (delete-on-cancel, design D7/P3).
 * Endpoint verified in P0: DELETE /api/orders/delete?order_id={id}.
 * @returns true when Starshipit confirms deletion; false on a handled non-2xx.
 */
export async function deleteStarshipitOrder(starshipitOrderId: string): Promise<boolean> {
  const response = await fetch(
    `${BASE_URL}/api/orders/delete?order_id=${encodeURIComponent(starshipitOrderId)}`,
    { method: 'DELETE', headers: getHeaders() },
  )
  const data = (await response.json().catch(() => ({}))) as { success?: boolean }
  if (!response.ok || !data.success) {
    console.error('[starshipit] deleteStarshipitOrder failed:', response.status, JSON.stringify(data))
    return false
  }
  return true
}
```

In `lib/audit/actions.ts`, add directly after the existing `ORDER_STARSHIPIT_PUSH_FAILED` line:

```ts
  ORDER_STARSHIPIT_DELETED: 'order.starshipit_deleted',
  ORDER_STARSHIPIT_DELETE_FAILED: 'order.starshipit_delete_failed',
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/starshipit/__tests__/client.test.ts`
Expected: PASS (6 tests).

- [x] **Step 5: Commit**

```bash
cd /Users/jamierogangeorge/Documents/print-room-portal
git add lib/starshipit/client.ts lib/audit/actions.ts lib/starshipit/__tests__/client.test.ts
git commit -m "feat(starshipit): delete-order client + delete audit actions

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 13: Delete-on-cancel helper + cancel-route wiring

**Files:**
- Create: `/Users/jamierogangeorge/Documents/print-room-portal/lib/starshipit/delete-on-cancel.ts`
- Modify: `/Users/jamierogangeorge/Documents/print-room-portal/app/api/orders/[id]/cancel-pre-order/route.ts`
- Test: `/Users/jamierogangeorge/Documents/print-room-portal/lib/starshipit/__tests__/delete-on-cancel.test.ts`

**Interfaces:**
- Consumes: `deleteStarshipitOrder` + audit actions (Task 12), columns from Task 1. In the cancel route, `admin`, `orderId`, and `orgId` are already in scope (see the route's existing code).
- Produces: `deleteStarshipitOrderOnCancel(admin: SupabaseClient, args: { orderId: string; organizationId: string }): Promise<void>` — no-op unless the order was pushed; on success clears both `starshipit_*` columns and audits `ORDER_STARSHIPIT_DELETED`; on API failure audits `ORDER_STARSHIPIT_DELETE_FAILED`; NEVER throws. Known scope limit (flagged in "Decisions resolved"): staff-side cancels (`cancel_order_atomically`) are not covered.

- [x] **Step 1: Write the failing tests**

Create `lib/starshipit/__tests__/delete-on-cancel.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('../client', () => ({ deleteStarshipitOrder: vi.fn() }))
vi.mock('@/lib/audit/recordEvent', () => ({ recordAuditEvent: vi.fn().mockResolvedValue(undefined) }))

import { deleteStarshipitOrderOnCancel } from '../delete-on-cancel'
import { deleteStarshipitOrder } from '../client'
import { recordAuditEvent } from '@/lib/audit/recordEvent'

const deleteMock = deleteStarshipitOrder as unknown as ReturnType<typeof vi.fn>
const auditMock = recordAuditEvent as unknown as ReturnType<typeof vi.fn>

function makeAdmin(orderRow: Record<string, unknown> | null) {
  const updates: Array<{ set: Record<string, unknown>; id: unknown }> = []
  const admin = {
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: orderRow, error: null }) }),
      }),
      update: (set: Record<string, unknown>) => ({
        eq: (_c: string, id: unknown) => {
          updates.push({ set, id })
          return Promise.resolve({ error: null })
        },
      }),
    })),
  }
  return { admin: admin as unknown as SupabaseClient, updates }
}

const ARGS = { orderId: 'o1', organizationId: 'org1' }
const PUSHED = { starshipit_pushed_at: '2026-08-06T00:00:00Z', starshipit_order_id: '987' }

describe('deleteStarshipitOrderOnCancel', () => {
  beforeEach(() => {
    process.env.STARSHIPIT_ENABLED = 'true'
    deleteMock.mockResolvedValue(true)
  })
  afterEach(() => {
    vi.clearAllMocks()
    delete process.env.STARSHIPIT_ENABLED
  })

  it('no-ops while the flag is off', async () => {
    process.env.STARSHIPIT_ENABLED = ''
    const { admin } = makeAdmin(PUSHED)
    await deleteStarshipitOrderOnCancel(admin, ARGS)
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('no-ops when the order was never pushed', async () => {
    const { admin } = makeAdmin({ starshipit_pushed_at: null, starshipit_order_id: null })
    await deleteStarshipitOrderOnCancel(admin, ARGS)
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('deletes, clears both columns, and audits ORDER_STARSHIPIT_DELETED', async () => {
    const { admin, updates } = makeAdmin(PUSHED)
    await deleteStarshipitOrderOnCancel(admin, ARGS)
    expect(deleteMock).toHaveBeenCalledWith('987')
    expect(updates).toEqual([
      { set: { starshipit_pushed_at: null, starshipit_order_id: null }, id: 'o1' },
    ])
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'order.starshipit_deleted', targetId: 'o1' }),
      admin,
    )
  })

  it('audits ORDER_STARSHIPIT_DELETE_FAILED and keeps the stamp when the API fails', async () => {
    deleteMock.mockResolvedValue(false)
    const { admin, updates } = makeAdmin(PUSHED)
    await deleteStarshipitOrderOnCancel(admin, ARGS)
    expect(updates).toHaveLength(0)
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'order.starshipit_delete_failed' }),
      admin,
    )
  })

  it('never throws (network error swallowed + logged)', async () => {
    deleteMock.mockRejectedValue(new Error('ECONNRESET'))
    const { admin } = makeAdmin(PUSHED)
    await expect(deleteStarshipitOrderOnCancel(admin, ARGS)).resolves.toBeUndefined()
  })
})
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/starshipit/__tests__/delete-on-cancel.test.ts`
Expected: FAIL — cannot resolve `../delete-on-cancel`.

- [x] **Step 3: Implement the helper**

Create `lib/starshipit/delete-on-cancel.ts`:

```ts
// lib/starshipit/delete-on-cancel.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { recordAuditEvent } from '@/lib/audit/recordEvent'
import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { isStarshipitEnabled } from './config'
import { deleteStarshipitOrder } from './client'

/**
 * Best-effort removal of a cancelled order from the Starshipit print queue
 * (design D7/P3). No-op unless the order was actually pushed. NEVER throws —
 * cancellation must always succeed regardless of Starshipit. On API failure
 * the stamp is kept so the stale queue entry stays visible/attributable and
 * staff can delete it manually.
 */
export async function deleteStarshipitOrderOnCancel(
  admin: SupabaseClient,
  args: { orderId: string; organizationId: string },
): Promise<void> {
  try {
    if (!isStarshipitEnabled()) return

    const { data } = await admin
      .from('orders')
      .select('starshipit_pushed_at, starshipit_order_id')
      .eq('id', args.orderId)
      .maybeSingle()
    const row = data as {
      starshipit_pushed_at?: string | null
      starshipit_order_id?: string | null
    } | null
    if (!row?.starshipit_pushed_at || !row.starshipit_order_id) return

    const deleted = await deleteStarshipitOrder(row.starshipit_order_id)
    if (!deleted) {
      await recordAuditEvent(
        {
          orgId: args.organizationId,
          actorUserId: null,
          action: AUDIT_ACTIONS.ORDER_STARSHIPIT_DELETE_FAILED,
          targetType: 'order',
          targetId: args.orderId,
          metadata: { starshipit_order_id: row.starshipit_order_id },
        },
        admin,
      )
      return
    }

    await admin
      .from('orders')
      .update({ starshipit_pushed_at: null, starshipit_order_id: null })
      .eq('id', args.orderId)
    await recordAuditEvent(
      {
        orgId: args.organizationId,
        actorUserId: null,
        action: AUDIT_ACTIONS.ORDER_STARSHIPIT_DELETED,
        targetType: 'order',
        targetId: args.orderId,
        metadata: { starshipit_order_id: row.starshipit_order_id },
      },
      admin,
    )
  } catch (e) {
    console.error('[starshipit] delete-on-cancel failed', {
      orderId: args.orderId,
      err: e instanceof Error ? e.message : String(e),
    })
  }
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/starshipit/__tests__/delete-on-cancel.test.ts`
Expected: PASS (5 tests).

- [x] **Step 5: Wire into the cancel route**

In `app/api/orders/[id]/cancel-pre-order/route.ts`, add the import:

```ts
import { deleteStarshipitOrderOnCancel } from '@/lib/starshipit/delete-on-cancel'
```

and insert between the RPC error check and the `revalidateTag` line — i.e. old:

```ts
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  revalidateTag(cacheTags.orderTracker, { expire: 0 })
```

new:

```ts
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Best-effort: pull the cancelled order back out of the Starshipit print
  // queue (design D7/P3). Never throws; no-op while STARSHIPIT_ENABLED unset
  // or when the order was never pushed.
  await deleteStarshipitOrderOnCancel(admin, { orderId, organizationId: orgId })

  revalidateTag(cacheTags.orderTracker, { expire: 0 })
```

- [x] **Step 6: Full test run + typecheck**

Run: `npm test` — expected: PASS (no new failures).
Run: `npx tsc --noEmit` — expected: baseline error count, no new errors.

- [x] **Step 7: Commit**

```bash
cd /Users/jamierogangeorge/Documents/print-room-portal
git add lib/starshipit/delete-on-cancel.ts lib/starshipit/__tests__/delete-on-cancel.test.ts "app/api/orders/[id]/cancel-pre-order/route.ts"
git commit -m "feat(starshipit): delete-on-cancel for pre-order cancellation

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Out of scope / follow-ups (do NOT build in this plan)

- Inbound tracking webhook, customer-facing tracking display, dispatch-email cutover (spec §3 — the next project).
- Staff-portal cancel paths (`cancel_order_atomically`) calling delete-on-cancel — needs a staff-repo change; flagged for a follow-up.
- Mirroring the two new audit actions into `print-room-staff-portal/src/lib/audit/actions.ts`.
- Weight column / weight derivation — revisit only if P0 shows NZ Post blocks label printing without weight AND staff entry at print time is too slow in practice.
