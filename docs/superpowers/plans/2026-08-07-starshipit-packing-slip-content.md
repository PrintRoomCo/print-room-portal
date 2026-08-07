# Starshipit Packing-Slip Content Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the printed Starshipit packing slip complete for a store order — a **SKU** on each line and the **branch as the company** with the **orderer as the recipient name** — without changing when or whether an order pushes.

**Architecture:** Two isolated, best-effort enrichment changes plus wiring, all in `print-room-portal`. `lib/starshipit/items.ts` gains a per-line `products.sku` lookup; a new `lib/starshipit/destination.ts` applies the branch→company / orderer→name rule for store shipments; `lib/starshipit/push-order.ts` wires both in before `createStarshipitOrder`. `client.ts` is **untouched** — it already maps `address.company`/`address.name` and forwards each item's optional `sku`; both existing push paths (checkout placement + Monday bridge) inherit the fix for free.

**Tech Stack:** TypeScript, Next.js (server-side modules), Supabase JS client, Vitest.

## Global Constraints

- **No schema change, no migration, no staff-portal change.** All work is in `print-room-portal`.
- **No new config.** Same `STARSHIPIT_ENABLED` env flag already live in prod.
- **`client.ts` payload shape, eligibility, idempotency, triggers, audit, and the inbound webhook are OUT OF SCOPE** — do not modify them.
- **Best-effort enrichment invariant (never break):** a failed line-item or contact/name lookup must degrade to `[]` / blank / unchanged — it must **never throw** and must **never lose the push**.
- **SKU source is `products.sku` ONLY**, resolved via `quote_items.source_product_id`. No `sku_suffix` (stale post-SKUCOLLAPSE), no `code`/`supplier_code` fallback. Lines with no `products.sku` ship SKU-blank (accepted).
- **Store-vs-custom discriminator = the store `id` on the RAW persisted `shipping_address`.** `normalizeShippingAddress` drops unknown keys including `id`, so detection MUST read the raw address, never the normalized one.
- **Store address gap is NOT in scope** (Appendix A of the spec) — do not touch the `street && city` push gate or store locality data.
- **TDD + frequent commits.** Baseline to preserve: full suite **1263 pass; 4 pre-existing failures** (OrdersTable fulfilment badge ×2, TeamClient.branch ×2); **`tsc` 14 pre-existing errors** — all unrelated. Do not introduce new failures or new tsc errors.
- Git commit messages end with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Work happens on branch `feat/starshipit-packing-slip-content` (already created off `main`, holds the spec commit `7659603`). Do NOT commit to `main`.

**Reference commands**
- Targeted test: `npx vitest run <path-to-test-file>`
- Full suite: `npm test`
- Types: `npx tsc --noEmit`

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `lib/starshipit/items.ts` | Modify | Map `quote_items` → Starshipit `items[]`; now also resolves `products.sku` per line via `source_product_id`. |
| `lib/starshipit/__tests__/items.test.ts` | Modify | Unit tests for the mapper + loader, extended for the SKU lookup. |
| `lib/starshipit/destination.ts` | **Create** | Store-shipment detection (`isStoreShipment`), best-effort orderer-name loader (`loadOrdererName`), and the pure branch→company / orderer→name resolver (`resolveStarshipitDestination`). |
| `lib/starshipit/__tests__/destination.test.ts` | **Create** | Unit tests for the new module. |
| `lib/starshipit/push-order.ts` | Modify | Wire destination enrichment in before `createStarshipitOrder`; gate the name lookup on `isStoreShipment`. |
| `lib/starshipit/__tests__/push-order.test.ts` | Modify | Wiring tests for store vs custom orders + fallback. |
| `lib/starshipit/__tests__/client.test.ts` | Modify | Regression guard: `client.ts` forwards `sku` + `company` + `name` (no `client.ts` code change). |

---

## Task 1: SKU on line items (`items.ts`)

**Files:**
- Modify: `lib/starshipit/items.ts`
- Test: `lib/starshipit/__tests__/items.test.ts`

**Interfaces:**
- Consumes: `admin: SupabaseClient`, `quoteId: string` (unchanged signature of `loadStarshipitOrderItems`).
- Produces:
  - `StarshipitOrderItem { description: string; sku?: string; quantity: number; value?: number }` — **unchanged shape** (the `sku?` field already exists; it is now actually populated).
  - `StarshipitQuoteItemRow` gains two optional fields: `source_product_id?: string | null` (selected) and `sku?: string | null` (attached by the loader, read by the mapper).
  - `loadStarshipitOrderItems(admin, quoteId): Promise<StarshipitOrderItem[]>` — same signature; each returned item now carries `sku` when its product has a non-empty `products.sku`.
  - `mapQuoteItemsToStarshipitItems(rows): StarshipitOrderItem[]` — same signature; now sets `item.sku` from `row.sku` when non-empty.

- [ ] **Step 1: Write the failing tests**

Add a table-aware admin helper and new cases to `lib/starshipit/__tests__/items.test.ts`. Keep the existing `makeAdmin`, `mapQuoteItemsToStarshipitItems`, and `loadStarshipitOrderItems` tests exactly as they are — they must stay green. Append the following inside the file (a new `makeTableAdmin` helper at the top of the `loadStarshipitOrderItems` describe block, plus the new `it` cases):

```ts
// Table-aware admin: quote_items via .select().eq(); products via .select().in().
function makeTableAdmin(opts: {
  quoteItems?: unknown
  quoteItemsError?: { message: string } | null
  products?: unknown
  productsError?: { message: string } | null
}) {
  const inSpy = vi
    .fn()
    .mockResolvedValue({ data: opts.products ?? [], error: opts.productsError ?? null })
  const eqSpy = vi
    .fn()
    .mockResolvedValue({ data: opts.quoteItems ?? null, error: opts.quoteItemsError ?? null })
  const from = vi.fn((table: string) => {
    if (table === 'products') return { select: vi.fn(() => ({ in: inSpy })) }
    return { select: vi.fn(() => ({ eq: eqSpy })) }
  })
  return { admin: { from } as unknown as SupabaseClient, from, inSpy, eqSpy }
}

describe('loadStarshipitOrderItems — products.sku enrichment', () => {
  it('attaches products.sku to lines by source_product_id, blank when absent', async () => {
    const { admin, inSpy } = makeTableAdmin({
      quoteItems: [
        { product_name: 'Tee', quantity: 2, unit_price: 20, size_label: 'L', source_product_id: 'p1', product_variants: null },
        { product_name: 'Bottle', quantity: 1, unit_price: 8, size_label: null, source_product_id: 'p2', product_variants: null },
      ],
      products: [{ id: 'p1', sku: 'TEE-001' }], // p2 has no products.sku row
    })
    const items = await loadStarshipitOrderItems(admin, 'q1')
    expect(items[0]).toEqual({ description: 'Tee — L', quantity: 2, value: 20, sku: 'TEE-001' })
    expect(items[1]).toEqual({ description: 'Bottle', quantity: 1, value: 8 }) // no sku key
    expect(inSpy).toHaveBeenCalledWith('id', ['p1', 'p2'])
  })

  it('sends each product id once even when lines repeat it', async () => {
    const { admin, inSpy } = makeTableAdmin({
      quoteItems: [
        { product_name: 'Tee', quantity: 1, unit_price: 20, size_label: 'S', source_product_id: 'p1', product_variants: null },
        { product_name: 'Tee', quantity: 1, unit_price: 20, size_label: 'M', source_product_id: 'p1', product_variants: null },
      ],
      products: [{ id: 'p1', sku: 'TEE-001' }],
    })
    await loadStarshipitOrderItems(admin, 'q1')
    expect(inSpy).toHaveBeenCalledWith('id', ['p1'])
  })

  it('does not query products when no line has a source_product_id', async () => {
    const { admin, from } = makeTableAdmin({
      quoteItems: [
        { product_name: 'Tee', quantity: 1, unit_price: 20, size_label: null, source_product_id: null, product_variants: null },
      ],
    })
    await loadStarshipitOrderItems(admin, 'q1')
    expect(from).not.toHaveBeenCalledWith('products')
  })

  it('leaves lines SKU-blank when the products read errors (best-effort, no throw)', async () => {
    const { admin } = makeTableAdmin({
      quoteItems: [
        { product_name: 'Tee', quantity: 1, unit_price: 20, size_label: 'L', source_product_id: 'p1', product_variants: null },
      ],
      products: null,
      productsError: { message: 'boom' },
    })
    await expect(loadStarshipitOrderItems(admin, 'q1')).resolves.toEqual([
      { description: 'Tee — L', quantity: 1, value: 20 },
    ])
  })
})

describe('mapQuoteItemsToStarshipitItems — sku', () => {
  it('sets sku when the row carries a non-empty one', () => {
    const items = mapQuoteItemsToStarshipitItems([
      { product_name: 'Tee', quantity: 1, unit_price: 20, size_label: 'L', sku: 'TEE-001', product_variants: null },
    ])
    expect(items[0].sku).toBe('TEE-001')
  })

  it('omits sku when the resolved value is empty/whitespace', () => {
    const items = mapQuoteItemsToStarshipitItems([
      { product_name: 'Tee', quantity: 1, unit_price: 20, size_label: null, sku: '   ', product_variants: null },
    ])
    expect(items).toEqual([{ description: 'Tee', quantity: 1, value: 20 }])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/starshipit/__tests__/items.test.ts`
Expected: the new cases FAIL (e.g. `items[0]` has no `sku`; `inSpy` never called; `mapQuoteItemsToStarshipitItems` ignores `row.sku`). The pre-existing cases still PASS.

- [ ] **Step 3: Update the file-header comment in `items.ts`**

Replace the stale "No sku" paragraph (currently lines 6–10) so it reads:

```ts
// SKU: resolved from products.sku via quote_items.source_product_id (a clean
// uuid FK) with a deterministic second lookup — NOT a PostgREST embed, and NOT
// the stale product_variants.sku_suffix (post-SKUCOLLAPSE one colourway variant
// now spans many sizes, so its suffix would misprint). Lines whose product has
// no sku ship SKU-blank (accepted). No weight: verified 2026-08-06 that no
// weight column exists anywhere in the schema — staff enter weight in Starshipit
// at print time.
```

- [ ] **Step 4: Extend `StarshipitQuoteItemRow`**

Add the two optional fields (keep them optional so the existing inline mapper tests, which omit them, still typecheck):

```ts
export interface StarshipitQuoteItemRow {
  product_name: string | null
  quantity: number | null
  unit_price: number | null
  size_label: string | null
  /** products.id for this line — the key we resolve products.sku through. */
  source_product_id?: string | null
  /** Resolved from products.sku by loadStarshipitOrderItems; not selected directly. */
  sku?: string | null
  product_variants?: VariantEmbed
}
```

- [ ] **Step 5: Set `item.sku` in the mapper**

In `mapQuoteItemsToStarshipitItems`, after the `value` assignment block and before `return item`, add:

```ts
    if (typeof row.sku === 'string' && row.sku.trim().length > 0) {
      item.sku = row.sku.trim()
    }
```

- [ ] **Step 6: Add the `products.sku` lookup in the loader**

Replace the body of `loadStarshipitOrderItems` from `if (error || !data) return []` to the end with:

```ts
  if (error || !data) return []
  const rows = data as unknown as StarshipitQuoteItemRow[]

  // Resolve products.sku with a deterministic second lookup (the source_product_id
  // FK is not guaranteed embeddable). Best-effort: a failed or empty products read
  // leaves every line SKU-blank while the push still carries descriptions. No throw.
  const ids = [...new Set(rows.map((r) => r.source_product_id).filter((x): x is string => !!x))]
  const skuById = new Map<string, string>()
  if (ids.length > 0) {
    const { data: prods } = await admin.from('products').select('id, sku').in('id', ids)
    for (const p of (prods ?? []) as Array<{ id: string; sku: unknown }>) {
      const sku = typeof p.sku === 'string' ? p.sku.trim() : ''
      if (sku) skuById.set(p.id, sku)
    }
  }

  return mapQuoteItemsToStarshipitItems(
    rows.map((r) => ({
      ...r,
      sku: r.source_product_id ? skuById.get(r.source_product_id) ?? null : null,
    })),
  )
```

Also update the `quote_items` select string to add `source_product_id`:

```ts
    .select(
      'product_name, quantity, unit_price, size_label, source_product_id, product_variants ( product_color_swatches ( label ) )',
    )
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run lib/starshipit/__tests__/items.test.ts`
Expected: PASS (all cases, old and new).

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: still 14 pre-existing errors, none in `lib/starshipit/items.ts`.

- [ ] **Step 9: Commit**

```bash
git add lib/starshipit/items.ts lib/starshipit/__tests__/items.test.ts
git commit -m "$(cat <<'EOF'
feat(starshipit): resolve products.sku per line for the packing slip

Second lookup via quote_items.source_product_id → products.sku, best-effort
(products read failure leaves lines SKU-blank, never throws / never loses the
push). Mapper now sets item.sku only when non-empty.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Company + recipient name module (`destination.ts`)

**Files:**
- Create: `lib/starshipit/destination.ts`
- Test: `lib/starshipit/__tests__/destination.test.ts`

**Interfaces:**
- Consumes: `NormalizedShippingAddress` from `@/lib/checkout/shipping-address` (fields: optional `name, email, phone, company, street, city, state, country, postalCode`); `SupabaseClient`.
- Produces:
  - `isStoreShipment(raw: Record<string, unknown> | null): boolean` — true iff `raw.id` is a non-empty string.
  - `loadOrdererName(admin: SupabaseClient, quoteId: string): Promise<string | null>` — trimmed `quotes.customer_name`, or `null` on error/empty (never throws).
  - `resolveStarshipitDestination(args: { address: NormalizedShippingAddress; rawAddress: Record<string, unknown> | null; ordererName: string | null }): NormalizedShippingAddress` — for store shipments returns `{ ...address, company: address.name ?? address.company, name: ordererName ?? address.name }`; for custom shipments returns `address` unchanged (same reference).

- [ ] **Step 1: Write the failing tests**

Create `lib/starshipit/__tests__/destination.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isStoreShipment, loadOrdererName, resolveStarshipitDestination } from '../destination'

describe('isStoreShipment', () => {
  it('is true when the raw address carries a non-empty string id', () => {
    expect(isStoreShipment({ id: 'store-123', name: 'Reburger Takapuna' })).toBe(true)
  })
  it('is false for a missing, blank, or non-string id', () => {
    expect(isStoreShipment({ name: 'Jane Doe' })).toBe(false)
    expect(isStoreShipment({ id: '   ' })).toBe(false)
    expect(isStoreShipment({ id: 42 })).toBe(false)
    expect(isStoreShipment(null)).toBe(false)
  })
})

describe('resolveStarshipitDestination', () => {
  const storeAddress = {
    name: 'Reburger Takapuna',
    street: '1 Hurstmere Rd',
    city: 'Takapuna',
    country: 'New Zealand',
  }

  it('maps branch→company and orderer→name for a store shipment', () => {
    const out = resolveStarshipitDestination({
      address: storeAddress,
      rawAddress: { id: 'store-1', name: 'Reburger Takapuna' },
      ordererName: 'Jane Doe',
    })
    expect(out.company).toBe('Reburger Takapuna')
    expect(out.name).toBe('Jane Doe')
    expect(out.street).toBe('1 Hurstmere Rd') // other fields untouched
  })

  it('falls back to the branch name (company still set) when orderer is null', () => {
    const out = resolveStarshipitDestination({
      address: storeAddress,
      rawAddress: { id: 'store-1', name: 'Reburger Takapuna' },
      ordererName: null,
    })
    expect(out.company).toBe('Reburger Takapuna')
    expect(out.name).toBe('Reburger Takapuna')
  })

  it('returns a custom-address shipment unchanged (same reference)', () => {
    const custom = { name: 'Jane Doe', company: '', street: '9 Home St', city: 'Auckland' }
    const out = resolveStarshipitDestination({
      address: custom,
      rawAddress: { name: 'Jane Doe' }, // no id → custom
      ordererName: null,
    })
    expect(out).toBe(custom)
  })
})

describe('loadOrdererName', () => {
  function makeAdmin(result: { data: unknown; error: { message: string } | null }) {
    const maybeSingle = vi.fn().mockResolvedValue(result)
    const eq = vi.fn(() => ({ maybeSingle }))
    const select = vi.fn(() => ({ eq }))
    const from = vi.fn(() => ({ select }))
    return { admin: { from } as unknown as SupabaseClient, from, select, eq }
  }

  it('returns the trimmed customer_name', async () => {
    const { admin, from, eq } = makeAdmin({ data: { customer_name: '  Jane Doe  ' }, error: null })
    await expect(loadOrdererName(admin, 'q1')).resolves.toBe('Jane Doe')
    expect(from).toHaveBeenCalledWith('quotes')
    expect(eq).toHaveBeenCalledWith('id', 'q1')
  })

  it('returns null on a query error (no throw)', async () => {
    const { admin } = makeAdmin({ data: null, error: { message: 'boom' } })
    await expect(loadOrdererName(admin, 'q1')).resolves.toBeNull()
  })

  it('returns null when customer_name is empty/whitespace', async () => {
    const { admin } = makeAdmin({ data: { customer_name: '   ' }, error: null })
    await expect(loadOrdererName(admin, 'q1')).resolves.toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/starshipit/__tests__/destination.test.ts`
Expected: FAIL — `Cannot find module '../destination'` (module not created yet).

- [ ] **Step 3: Create the module**

Create `lib/starshipit/destination.ts`:

```ts
// lib/starshipit/destination.ts
//
// Fills the Starshipit destination company + recipient name for STORE orders so
// the printed packing slip reads "Company = branch, Name = orderer" (design A2).
// Custom-address orders are returned unchanged. Detection reads the RAW persisted
// shipping_address (which carries the store id); normalizeShippingAddress drops
// unknown keys, so the id discriminator is only visible before normalization.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { NormalizedShippingAddress } from '@/lib/checkout/shipping-address'

/** True when the persisted address is a store snapshot (carries a store id). */
export function isStoreShipment(raw: Record<string, unknown> | null): boolean {
  const id = (raw as { id?: unknown } | null)?.id
  return typeof id === 'string' && id.trim().length > 0
}

/**
 * Best-effort orderer name from quotes.customer_name. Returns null on error or
 * empty — the caller falls back to the branch name, never loses the push.
 */
export async function loadOrdererName(
  admin: SupabaseClient,
  quoteId: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from('quotes')
    .select('customer_name')
    .eq('id', quoteId)
    .maybeSingle()
  if (error || !data) return null
  const name = (data as { customer_name?: unknown }).customer_name
  return typeof name === 'string' && name.trim().length > 0 ? name.trim() : null
}

/**
 * Apply the branch=company / orderer=name rule for store shipments; return
 * custom-address shipments unchanged. Pure — takes the normalized address (the
 * fields sent) and the raw address (the store-id discriminator).
 */
export function resolveStarshipitDestination(args: {
  address: NormalizedShippingAddress
  rawAddress: Record<string, unknown> | null
  ordererName: string | null
}): NormalizedShippingAddress {
  if (!isStoreShipment(args.rawAddress)) return args.address
  return {
    ...args.address,
    company: args.address.name ?? args.address.company,
    name: args.ordererName ?? args.address.name,
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/starshipit/__tests__/destination.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: still 14 pre-existing errors, none in `lib/starshipit/destination.ts`.

- [ ] **Step 6: Commit**

```bash
git add lib/starshipit/destination.ts lib/starshipit/__tests__/destination.test.ts
git commit -m "$(cat <<'EOF'
feat(starshipit): destination module — branch=company, orderer=name

New pure resolver + best-effort orderer-name loader for store shipments.
Store detection keys off the raw persisted shipping_address id (normalize drops
it). Custom addresses returned unchanged. Not yet wired — Task 3.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Wire enrichment into `push-order.ts`

**Files:**
- Modify: `lib/starshipit/push-order.ts:80-89` (the enrichment + create-order block)
- Test: `lib/starshipit/__tests__/push-order.test.ts`

**Interfaces:**
- Consumes: `isStoreShipment`, `loadOrdererName`, `resolveStarshipitDestination` from `./destination` (Task 2); `loadStarshipitOrderItems` from `./items` (Task 1); `createStarshipitOrder` from `./client`.
- Produces: no signature change to `pushOrderToStarshipit`. Both callers (`submit.ts` step 5d, `push-on-production-complete.ts`) are untouched and inherit the enrichment. `createStarshipitOrder` now receives `address: destination` (the resolved destination) instead of the bare normalized `address`.

- [ ] **Step 1: Write the failing tests**

In `lib/starshipit/__tests__/push-order.test.ts`, add a partial mock of `../destination` at the top with the other `vi.mock` calls (keep the real pure functions, spy only on the DB-touching `loadOrdererName`):

```ts
vi.mock('../destination', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../destination')>()),
  loadOrdererName: vi.fn(),
}))
```

Add to the imports below the existing ones:

```ts
import { loadOrdererName } from '../destination'
const ordererNameMock = loadOrdererName as unknown as ReturnType<typeof vi.fn>
```

Add a store-order fixture after `baseArgs`:

```ts
const storeArgs = {
  ...baseArgs,
  shippingAddress: {
    id: 'store-1',
    name: 'Reburger Takapuna',
    street: '1 Hurstmere Rd',
    city: 'Takapuna',
    country: 'New Zealand',
  },
}
```

In the `beforeEach`, reset the new mock alongside `itemsMock`:

```ts
    ordererNameMock.mockResolvedValue(null)
```

Add these `it` cases inside the `describe('pushOrderToStarshipit', ...)` block:

```ts
  it('store order: sends company=branch, name=orderer, and items with sku', async () => {
    createMock.mockResolvedValue('987')
    ordererNameMock.mockResolvedValue('Jane Doe')
    itemsMock.mockResolvedValue([{ description: 'Tee — L', quantity: 2, sku: 'TEE-001' }])
    const { admin } = makeAdmin()
    await pushOrderToStarshipit(admin, storeArgs)
    expect(ordererNameMock).toHaveBeenCalledWith(admin, 'q1')
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        address: expect.objectContaining({ company: 'Reburger Takapuna', name: 'Jane Doe' }),
        items: [{ description: 'Tee — L', quantity: 2, sku: 'TEE-001' }],
      }),
    )
  })

  it('custom order: does not look up the orderer and keeps the typed recipient name', async () => {
    createMock.mockResolvedValue('987')
    const { admin } = makeAdmin()
    await pushOrderToStarshipit(admin, baseArgs) // baseArgs carries no store id
    expect(ordererNameMock).not.toHaveBeenCalled()
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ address: expect.objectContaining({ name: 'AF' }) }),
    )
  })

  it('store order: falls back to the branch name when the orderer lookup returns null', async () => {
    createMock.mockResolvedValue('987')
    ordererNameMock.mockResolvedValue(null)
    const { admin } = makeAdmin()
    const r = await pushOrderToStarshipit(admin, storeArgs)
    expect(r.status).toBe('pushed')
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        address: expect.objectContaining({ company: 'Reburger Takapuna', name: 'Reburger Takapuna' }),
      }),
    )
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/starshipit/__tests__/push-order.test.ts`
Expected: the three new cases FAIL (`createStarshipitOrder` still receives the bare normalized address — no `company`, `name` still the store name; `ordererNameMock` never called). Existing cases still PASS (they use the custom `baseArgs`, so `isStoreShipment` is false and behaviour is unchanged).

- [ ] **Step 3: Add the import to `push-order.ts`**

Below the existing `import { loadStarshipitOrderItems } from './items'` line, add:

```ts
import { isStoreShipment, loadOrdererName, resolveStarshipitDestination } from './destination'
```

- [ ] **Step 4: Replace the enrichment + create-order block**

Replace this current block (lines 80–89):

```ts
  // Best-effort enrichment — loadStarshipitOrderItems returns [] on error; a
  // failed items read must never lose the push.
  const items = await loadStarshipitOrderItems(admin, args.quoteId)

  const starshipitOrderId = await createStarshipitOrder({
    orderNumber: args.orderRef,
    address: address!,
    customerEmail: args.customerEmail,
    items,
  })
```

with:

```ts
  // Best-effort enrichment — a failed enrichment read must never lose the push.
  // Store orders: company ← branch, name ← orderer (design A2). Gate the name
  // lookup on isStoreShipment so custom orders don't pay an extra round-trip.
  const ordererName = isStoreShipment(args.shippingAddress)
    ? await loadOrdererName(admin, args.quoteId)
    : null
  const destination = resolveStarshipitDestination({
    address: address!,
    rawAddress: args.shippingAddress,
    ordererName,
  })
  // loadStarshipitOrderItems returns [] on error (an address-only ticket still prints).
  const items = await loadStarshipitOrderItems(admin, args.quoteId)

  const starshipitOrderId = await createStarshipitOrder({
    orderNumber: args.orderRef,
    address: destination,
    customerEmail: args.customerEmail,
    items,
  })
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run lib/starshipit/__tests__/push-order.test.ts`
Expected: PASS (all cases, old and new).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: still 14 pre-existing errors, none in `lib/starshipit/push-order.ts`.

- [ ] **Step 7: Commit**

```bash
git add lib/starshipit/push-order.ts lib/starshipit/__tests__/push-order.test.ts
git commit -m "$(cat <<'EOF'
feat(starshipit): wire branch=company / orderer=name into the push

pushOrderToStarshipit now enriches the destination before createStarshipitOrder.
Name lookup gated on isStoreShipment so custom orders skip the extra round-trip.
Both push paths (placement + Monday bridge) inherit it; no signature change.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Regression guard (`client.ts`) + full baseline

**Files:**
- Test: `lib/starshipit/__tests__/client.test.ts` (test-only — **no `client.ts` code change**)

**Interfaces:**
- Consumes: `createStarshipitOrder` from `../client` (unchanged); `NormalizedShippingAddress`.
- Produces: nothing new — this task locks the existing `client.ts` behaviour so a future refactor can't silently drop `sku` / `company` / `name` from the payload.

- [ ] **Step 1: Write the failing test**

Add this `it` case inside the `describe('createStarshipitOrder', ...)` block in `lib/starshipit/__tests__/client.test.ts`:

```ts
  it('forwards item sku and destination company + name (regression guard)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, order: { order_id: 1 } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await createStarshipitOrder({
      orderNumber: 'PR-5',
      address: { ...OK_ADDRESS, name: 'Jane Doe', company: 'Reburger Takapuna' },
      customerEmail: null,
      items: [{ description: 'Tee — L', quantity: 2, sku: 'TEE-001' }],
    })

    const sent = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(sent.order.destination.company).toBe('Reburger Takapuna')
    expect(sent.order.destination.name).toBe('Jane Doe')
    expect(sent.order.items).toEqual([{ description: 'Tee — L', quantity: 2, sku: 'TEE-001' }])
  })
```

- [ ] **Step 2: Run the test to verify it passes immediately**

Run: `npx vitest run lib/starshipit/__tests__/client.test.ts`
Expected: PASS. This is a **characterization/guard** test — `client.ts` already maps `company`/`name` and forwards `sku`, so it passes with no production change. (If it FAILS, `client.ts` is not doing what the wiring assumes — stop and reconcile before continuing.)

- [ ] **Step 3: Run the full Starshipit suite**

Run: `npx vitest run lib/starshipit`
Expected: PASS across all `lib/starshipit/__tests__/*` files.

- [ ] **Step 4: Run the full test suite + typecheck to confirm the baseline holds**

Run: `npm test`
Expected: **1263 pass; 4 pre-existing failures** (OrdersTable fulfilment badge ×2, TeamClient.branch ×2) — no new failures. The item/contact enrichment adds passing tests, so total pass count rises; the 4 known failures are unchanged.

Run: `npx tsc --noEmit`
Expected: **14 pre-existing errors**, none in `lib/starshipit/*`.

- [ ] **Step 5: Commit**

```bash
git add lib/starshipit/__tests__/client.test.ts
git commit -m "$(cat <<'EOF'
test(starshipit): guard that the client forwards sku + company + name

Locks the existing client.ts payload mapping so a future refactor can't
silently drop the packing-slip fields. No production change.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Post-implementation (HITL — not code tasks)

These are handled with Jon after the code is merged; they are not part of the TDD loop above.

1. **Merge & deploy.** Open a PR for `feat/starshipit-packing-slip-content` → `main`; merge; Vercel auto-deploys. No env var, no migration, no staff-portal change.
2. **Smoke (per spec §8).** Place one **stock-on-hand store order** to an org whose store address clears the `street && city` gate (see Appendix A — most stores are still blocked; pick one of the 3 known-good). Confirm the Starshipit ticket shows **Company = branch**, **Recipient = orderer**, and a **SKU** on the ~70% of lines that carry one. Also spot-check one **custom-address** order still shows the typed recipient in Name and a blank Company.
3. **Rollback if needed.** Revert the branch, or unset `STARSHIPIT_ENABLED` and redeploy. Nothing to unwind (purely additive payload fields).
4. **Update memory.** Append a short "packing-slip content bucket SHIPPED" note to `starshipit-order-push-epic.md` and reiterate that **Appendix A (store-address / city gate)** is the recommended next follow-up — it is what actually unblocks store-order volume through Starshipit.

---

## Self-Review

**1. Spec coverage** (each spec section → task):
- §5.1 SKU on line items → **Task 1** (type + mapper + loader + header comment + degrade rules).
- §5.2 company + name module → **Task 2** (`isStoreShipment`, `loadOrdererName`, `resolveStarshipitDestination`, raw-vs-normalized rationale in the module header).
- §5.3 wiring → **Task 3** (import + enrichment block, name lookup gated on `isStoreShipment`, both callers untouched).
- §7 test strategy: items ✓ (Task 1), destination ✓ (Task 2), push-order ✓ (Task 3), client regression guard ✓ (Task 4).
- §8 rollout/safety + Appendix A follow-up → **Post-implementation** section.
- §2 A1/A2/A3 decisions → Global Constraints + the relevant tasks. §3 non-goals (`sku_suffix`, `code` fallback, `phone`, custom company, return path, `client.ts` shape) → Global Constraints. No spec requirement is left without a task.

**2. Placeholder scan:** No "TBD/TODO/handle edge cases/similar to Task N". Every code step shows complete code; every run step shows the exact command and expected result.

**3. Type consistency:** `StarshipitOrderItem`/`StarshipitQuoteItemRow`/`loadStarshipitOrderItems`/`mapQuoteItemsToStarshipitItems` (Task 1) match their usage in Tasks 3–4. `isStoreShipment(raw: Record<string, unknown> | null)`, `loadOrdererName(admin, quoteId): Promise<string | null>`, and `resolveStarshipitDestination({ address, rawAddress, ordererName })` (Task 2) match the import + call sites in Task 3 exactly. `NormalizedShippingAddress` fields (`name`, `company`, `street`, `city`, …) match `lib/checkout/shipping-address.ts`. `push-order.ts` passes `args.shippingAddress` (typed `Record<string, unknown> | null`) to both `isStoreShipment` and `resolveStarshipitDestination`'s `rawAddress` — same type, consistent.
