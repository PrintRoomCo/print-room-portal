# Split shipment — Phase 1 implementation plan

**Spec:** `docs/superpowers/specs/2026-08-27-split-shipment-design.md` (approved, fee schedule confirmed incl. extrapolation)
**Repos:** `print-room-portal` (most tasks) and `print-room-staff-portal` (Tasks 1, 9, 15 — it owns the schema)
**Goal:** a flag-on pilot org can place a split-shipment order at checkout: order-level ships-to with a Split shipment option, sizes × destinations allocation grid, per-destination split fees, pooled pricing/MOQ/minimum, one org-contact Xero draft, destinations persisted (`order_destinations` + exploded `quote_items`), a read-only per-destination breakdown on the staff order page, and a hard guard so the amendment RPC can't flatten a split order. Fulfilment automation (Starshipit per destination, packing slips, tracker) is **Phase 2**. The ad-hoc "save to address book" tick is **deliberately deferred to Phase 3** — `CheckoutDestinationInput.save_to_address_book` exists from Task 3 so the request shape is stable, but nothing acts on it in Phase 1 (spec §9 "save-to-address-book polish").

## Architecture (from the spec, values verbatim)

- One order per country × fulfilment partition (existing machinery untouched). Destinations nest **within** an order: new table `order_destinations`, one row per destination; a split cart line **explodes** into one `quote_items` row per destination, each carrying `destination_id` + denormalised `ship_to_store_id`.
- Split orders: `quotes.split_shipment = true`, `quotes.ship_to_store_id = NULL`, `quotes.shipping_address = NULL`, `orders.shipping_address = NULL`. Non-split orders: byte-identical to today.
- Feature gate: `organizations.split_shipping_enabled boolean not null default false`.
- **Split fee** (per destination, every destination including the first, replaces the picking fee on split orders), banded by **distinct SKUs at that destination** (SKU = `product_id` + `variant_id` + `size_id`; decorations and unit quantities never change the count):
  1–10 → $15 · 11–20 → $17.50 · 21–30 → $20 · 31–40 → $22.50 · 41–50 → $30 · each further block of 10 → +$2.50 (51–60 → $32.50, …, uncapped). NZD; non-NZ destinations converted via the existing NZD-base exchange rates.
- Pricing pools across the whole cart (already true via `pricing_pool_lines`). **MOQ and the $500 PO minimum move to pooled evaluation** — today both are partition-local, which would spuriously block cross-partition splits.
- Xero: split orders invoice the **org** contact. Single-destination orders keep today's store-contact behaviour.

## Global constraints

- Never change schema outside `print-room-staff-portal/supabase/migrations/` applied by `supabase db push` (staff `AGENTS.md` — the 2026-07-20 drift rule). No MCP `apply_migration`, no dashboard edits.
- Flag-off orgs must take a byte-identical code path. Every existing test stays green.
- Client-supplied fields the server derives (pooled minimum, split fees, exchange rates) must be re-derived server-side — never read from the request body.
- Portal is Next 16 — before touching cache/transition code read the bundled docs per `AGENTS.md` (none of these tasks should need to).
- Staff-portal UI work must satisfy the pre-flight checklist in `print-room-staff-portal/docs/ui/oem-rules.md` (Task 15).

## Concepts you'll practise

- **Explode at the chokepoint** — one cart line becomes N per-destination rows at a single seam (`explodeCheckoutLines`), so everything downstream stays a plain "rows" problem. Tasks 3, 8, 9, 10.
- **Pool vs partition** — pricing already pools across partitions via `pricing_pool_lines` while enforcement (MOQ, $500 minimum) stayed partition-local; you'll move the enforcement seeds to the pool. Tasks 4, 5.
- **Server-owned inputs** — fields that exist on the input type but must only ever be written by the routes, never copied from the client body. Tasks 5, 7, 8.
- **Dual-path behind an org flag** — the old UI and the new UI coexist, selected per org, until the pilot proves out. Tasks 11–14.

## Order of play

- [x] Task 1 — Schema foundation migration (staff) — `order_destinations` + columns + flag — ~1h
- [x] Task 2 — Split-fee module (portal) — band table + SKU counter — ~45m
- [x] Task 3 — Destinations module (portal) — validate + explode — ~1.5h
- [x] Task 4 — MOQ pools across partitions (portal) — ~1h
- [x] Task 5 — Pooled $500 minimum + picking-fee suppression seams (portal) — ~1.5h
- [x] Task 6 — Xero ship-to contact helper (portal) — ~45m
- [x] Task 7 — Prepare computes per-destination split fees (portal) — ~2h
- [x] Task 8 — Preview route accepts destinations (portal) — ~2h
- [x] Task 9 — Submit RPC gains `p_destinations` (staff migration) — ~3h
- [x] Task 10 — Submit wiring (portal) — ~2h
- [x] Task 11 — Order-level ships-to control (portal) — ~2h
- [x] Task 12 — Split shipment editor + allocation grid (portal) `[Stretch]` — ~3h
- [x] Task 13 — Google Places autocomplete proxy + input (portal) — ~1.5h
- [x] Task 14 — Review, summary + confirmation surfaces (portal) — ~2h
- [x] Task 15 — Staff read-only breakdown + amendment guard (staff) — ~1.5h
- [ ] Task 16 — Pilot enablement + end-to-end smoke — ~1h

Ships dark until Task 16 flips `split_shipping_enabled` for the pilot org. Safe to stop after any ticked task: 1–3 are pure additions, 4 is strictly more lenient, 5–10 are inert until a request carries destinations (which no UI sends until 11–12, which no org sees until 16), 15's guard can only fire on orders that can't exist yet.

## Baselines (measured 2026-08-28, before any code)

print-room-portal:

- [x] `npm test` -> **299 files / 1825 tests, all passing.** The
  `TeamClient.branch.test.tsx` failure this plan recorded was already fixed by
  commits 7d9408a + 4a59866.
- [x] `npx tsc --noEmit` -> **14 errors**, all pre-existing, all in two test
  files: `lib/__tests__/next-config-redirects.test.ts` and
  `lib/email/__tests__/tracker-notification.test.ts`. (The plan guessed ~5.)
- [x] `npm run lint` -> **199 warnings, 0 errors.**

print-room-staff-portal:

- [x] `npm test` -> **480 files / 3350 tests, 5 failing** (all in
  `src/components/catalogues/attach-designer/sections/swatch-edit-hint.test.ts`,
  unrelated to this epic).
- [x] `npx tsc --noEmit` -> **0 errors.**
- [x] `npm run lint` -> **32 problems (18 errors, 14 warnings).**

Verified after the work: the staff baseline is byte-identical with the changes
stashed and unstashed, so this epic introduced no staff regressions. The portal
finished at **310 files / 1903 tests passing, tsc 14, lint 199** — tests and
files up, errors and warnings exactly at baseline.

---

### Task 1: Schema foundation migration (staff repo)   `[Routine]`   ~1h

**Goal:** the shared DB has `order_destinations`, the four column adds, and RLS — all inert.

**Files:**
- Create: `print-room-staff-portal/supabase/migrations/<fresh-timestamp>_split_shipment_foundation.sql`

**Interfaces:**
- Produces: table `public.order_destinations`; columns `quote_items.destination_id`, `order_shipments.destination_id`, `quotes.split_shipment`, `organizations.split_shipping_enabled`.

**Read first:**
- [x] `print-room-staff-portal/supabase/migrations/20260804110000_order_fulfillment_foundation.sql:1-40` — the house style you're copying: header comment naming the spec, `create table` layout, partial unique indexes, the "applied via db push, never MCP" line.
- [x] `print-room-staff-portal/CONTRIBUTING.md` (migrations section) — fresh timestamp, file-first, `supabase db push`.

**Steps:**

- [x] **1. Write the migration.** DDL in full — boilerplate, copy it:

  ```sql
  -- Split shipment Phase 1 foundation (spec: print-room-portal
  -- docs/superpowers/specs/2026-08-27-split-shipment-design.md §4).
  --   order_destinations               — one row per destination per order (split shipment).
  --   quote_items.destination_id       — exploded per-destination lines point at their destination.
  --   order_shipments.destination_id   — parcels attach to a destination (used from Phase 2).
  --   quotes.split_shipment            — header flag; split orders carry NULL header addresses.
  --   organizations.split_shipping_enabled — org-level pilot gate, default off.
  -- Everything here is inert until the portal's split checkout ships and the flag is
  -- turned on for a pilot org. Applied via `supabase db push`. NEVER via MCP/dashboard.

  create table public.order_destinations (
    id                    uuid primary key default gen_random_uuid(),
    quote_id              uuid not null references public.quotes(id) on delete cascade,
    position              integer not null,                 -- 1..N, stable; drives -D refs in Phase 2
    ship_to_store_id      uuid references public.stores(id),
    custom_address        jsonb,                            -- one-time address (verified at checkout)
    address_snapshot      jsonb not null,                   -- resolved at submit; later store edits never rewrite history
    split_fee             numeric not null default 0,
    status                text not null default 'pending'
                            check (status in ('pending','dispatched','delivered','cancelled')),
    starshipit_order_id   text,                             -- Phase 2
    starshipit_pushed_at  timestamptz,                      -- Phase 2
    dispatched_notified_at timestamptz,                     -- Phase 3
    delivered_notified_at  timestamptz,                     -- Phase 3
    created_at            timestamptz not null default now(),
    -- Exactly one address source: a saved store OR a one-time address.
    constraint order_destinations_one_address
      check ((ship_to_store_id is null) <> (custom_address is null))
  );

  create index order_destinations_quote_id_idx on public.order_destinations (quote_id);
  create unique index order_destinations_quote_position_uidx
    on public.order_destinations (quote_id, position);

  -- Reads/writes go through the service-role admin client on both portals,
  -- matching order_shipments. A member-scoped read policy lands with the
  -- customer tracker work in Phase 3.
  alter table public.order_destinations enable row level security;

  alter table public.quote_items
    add column destination_id uuid references public.order_destinations(id);
  create index quote_items_destination_id_idx
    on public.quote_items (destination_id) where destination_id is not null;

  alter table public.order_shipments
    add column destination_id uuid references public.order_destinations(id);

  alter table public.quotes
    add column split_shipment boolean not null default false;

  alter table public.organizations
    add column split_shipping_enabled boolean not null default false;
  ```

- [x] **2. Apply.** From `print-room-staff-portal`: `supabase db push` → expect the single new migration listed and applied cleanly.

- [x] **3. Verify.** In the SQL editor (or `psql`):
  `select count(*) from public.order_destinations;` → `0`
  `select split_shipment from public.quotes limit 1;` → `false`

- [x] **4. Run the guards.** `npx tsc --noEmit && npm test` in the staff repo → no NEW failures vs baseline.

- [x] **5. Commit.** `git commit -m "feat(db): split shipment foundation — order_destinations, destination_id columns, org flag"`

- [x] **6. Checkpoint.** Ask Claude: *"review Task 1 against the plan"*.

**Why this shape:** the XOR check makes "store or custom, never both/neither" a database invariant instead of four scattered app checks; `address_snapshot` is always populated (even for store destinations) so Phase 2 fulfilment reads one column, never a conditional join.
**Rejected:** an `is_default` column on destinations — the default is a checkout-time UI concept; once submitted, every destination is equal and `position = 1` is enough ordering.
**Done when:** step 3's two selects return the shown values and `supabase db push` reports nothing pending.

---

### Task 2: Split-fee module (portal)   `[Routine]`   ~45m

**Goal:** a pure module answers "what does this destination's fee band say" and "how many distinct SKUs is that".

**Files:**
- Create: `lib/pricing/split-fee.ts`
- Test: `lib/pricing/split-fee.test.ts`

**Interfaces:**
- Produces: `splitFeeForSkuCount(count: number): number` and `distinctSkuCount(lines: Array<Pick<CheckoutLineInput, 'product_id' | 'variant_id' | 'size_id'>>): number` (import `CheckoutLineInput` from `@/lib/checkout/submit`). Consumed by Task 7.

**Read first:**
- [ ] `lib/pricing/picking-fee.ts` — the band-table idiom you're mirroring (exported band constant + tiny lookup fn, doc comment carrying the business numbers).

**Steps:**

- [ ] **1. Write the failing test.** Copy verbatim into `lib/pricing/split-fee.test.ts`:

  ```ts
  import { describe, it, expect } from 'vitest'
  import { splitFeeForSkuCount, distinctSkuCount } from './split-fee'

  describe('splitFeeForSkuCount (per-destination band table, NZD)', () => {
    it.each([
      [1, 15], [10, 15],
      [11, 17.5], [20, 17.5],
      [21, 20], [30, 20],
      [31, 22.5], [40, 22.5],
      [41, 30], [47, 30], [50, 30],
      [51, 32.5], [60, 32.5],
      [61, 35],
      [100, 42.5], // extrapolation: 30 + 2.50 per block of 10 past 50
    ])('%d SKUs -> $%d', (skus, fee) => {
      expect(splitFeeForSkuCount(skus)).toBe(fee)
    })

    it('returns 0 for zero/negative/NaN — a destination with no SKUs has no fee', () => {
      expect(splitFeeForSkuCount(0)).toBe(0)
      expect(splitFeeForSkuCount(-3)).toBe(0)
      expect(splitFeeForSkuCount(Number.NaN)).toBe(0)
    })
  })

  describe('distinctSkuCount', () => {
    it('counts distinct product+colourway+size; qty and duplicate lines never matter', () => {
      expect(
        distinctSkuCount([
          { product_id: 'p1', variant_id: 'v1', size_id: 1 },
          { product_id: 'p1', variant_id: 'v1', size_id: 1 }, // same SKU on a second line
          { product_id: 'p1', variant_id: 'v1', size_id: 2 }, // new size
          { product_id: 'p1', variant_id: 'v2', size_id: 1 }, // new colourway
          { product_id: 'p2', variant_id: null, size_id: null }, // sizeless product
        ]),
      ).toBe(4)
    })

    it('treats absent and null identity parts as the same SKU', () => {
      expect(
        distinctSkuCount([
          { product_id: 'p1', variant_id: null, size_id: null },
          { product_id: 'p1' },
        ]),
      ).toBe(1)
    })

    it('returns 0 for an empty destination', () => {
      expect(distinctSkuCount([])).toBe(0)
    })
  })
  ```

- [ ] **2. Run it and confirm it fails for the RIGHT reason.**
  `npx vitest run lib/pricing/split-fee.test.ts` → expect `Cannot find module './split-fee'` (module doesn't exist yet). Any other failure means the test itself is broken.

- [ ] **3. Implement it.** Contract:
  - Export a `SPLIT_FEE_BANDS` constant (mirroring `PICKING_FEE_BANDS`' shape) with a doc comment carrying the spreadsheet numbers and the words "extrapolated above 47, confirmed by Jon 2026-08-28".
  - `splitFeeForSkuCount` — bands of 10; the 41+ region is `30 + 2.5 * (whole blocks of 10 past 50)`; non-finite/≤0 input → 0.
  - `distinctSkuCount` — distinct by the string identity `product_id | variant_id ?? '' | size_id ?? ''`.
  - Fees are NZD figures; this module knows nothing about currency conversion (Task 7's job).

  **Trap:** `size_id` is a number — don't build the identity key with plain string concatenation without separators or `p1|v1|12` and `p1|v11|2` collide. Use an explicit delimiter that can't appear in a uuid.

  **Stuck for 15 minutes?** `pickingFeeForGoods` in the file you just read is the exact shape; yours differs only in having an open-ended arithmetic tail instead of an `Infinity` band.

- [ ] **4. Run the test.** `npx vitest run lib/pricing/split-fee.test.ts` → PASS

- [ ] **5. Run the guards.** `npx tsc --noEmit && npm run lint` → no NEW failures vs baseline.

- [ ] **6. Commit.** `git commit -m "feat(pricing): split-shipment per-destination fee bands + SKU counter"`

- [ ] **7. Checkpoint.** Ask Claude: *"review Task 2 against the plan"*.

**Why this shape:** the fee table is business policy that will change; isolating it as data + a dumb lookup (like the picking fee) means the next fee change is a one-constant diff.
**Rejected:** a DB table for the bands — the picking fee precedent is code, nothing staff-side edits fees, and a table adds a fetch to every checkout preview.
**Done when:** step 4 passes including the `100 → 42.5` extrapolation row.

---

### Task 3: Destinations module — validate + explode (portal)   `[Routine]`   ~1.5h

**Goal:** one pure chokepoint turns (lines + destinations + allocations) into per-destination exploded lines, or a precise refusal.

**Files:**
- Create: `lib/checkout/destinations.ts`
- Test: `lib/checkout/destinations.test.ts`
- Modify: `lib/checkout/submit.ts` (type only — see Interfaces)

**Interfaces:**
- `CheckoutLineInput` (in `lib/checkout/submit.ts`) gains two optional fields:
  `allocations?: Array<{ destination_ref: string; qty: number }>` (pre-explosion, client-sent) and `destination_ref?: string | null` (post-explosion, server-stamped).
- Produces (consumed by Tasks 7, 8, 10, 12):

  ```ts
  export interface CheckoutDestinationInput {
    ref: string                          // client-generated, unique per order
    ship_to_store_id?: string | null
    custom_address?: CustomAddress | null // exactly one of the two; CustomAddress from components/checkout/checkoutReviewState
    save_to_address_book?: boolean
  }

  export type DestinationFailure = {
    ok: false
    code:
      | 'no_destinations' | 'duplicate_ref' | 'destination_shape'
      | 'unknown_destination' | 'allocation_sum_mismatch'
      | 'invalid_allocation_qty' | 'empty_destination'
    detail: string
    cartLineId?: string | null
    destinationRef?: string
  }

  export function explodeCheckoutLines(input: {
    lines: CheckoutLineInput[]
    destinations: CheckoutDestinationInput[]
    defaultDestinationRef: string
  }): { ok: true; lines: CheckoutLineInput[] } | DestinationFailure
  ```

**Read first:**
- [ ] `lib/checkout/partition.ts:35-94` — the house style for pure cart-shaping functions and how exploded output will flow into `partitionByCountryAndFulfilment`.
- [ ] `components/checkout/checkoutReviewState.ts:3-9` — `CustomAddress`, reused not duplicated.

**Steps:**

- [ ] **1. Write the failing test.** Copy verbatim into `lib/checkout/destinations.test.ts`:

  ```ts
  import { describe, it, expect } from 'vitest'
  import { explodeCheckoutLines, type CheckoutDestinationInput } from './destinations'
  import type { CheckoutLineInput } from './submit'

  const albany: CheckoutDestinationInput = { ref: 'd1', ship_to_store_id: 'store-albany' }
  const takapuna: CheckoutDestinationInput = { ref: 'd2', ship_to_store_id: 'store-takapuna' }
  const adHoc: CheckoutDestinationInput = {
    ref: 'd3',
    custom_address: {
      name: 'Site office', address: '1 Wharf Rd', city: 'Nelson',
      postal_code: '7010', country: 'NZ',
    },
  }

  function line(overrides: Partial<CheckoutLineInput> = {}): CheckoutLineInput {
    return {
      product_id: 'p1', product_name: 'Test tee', variant_id: 'v1',
      size_id: 1, size_label: 'S', qty: 12, cart_line_id: 'line-1',
      decorations: [], ...overrides,
    }
  }

  describe('explodeCheckoutLines', () => {
    it('sends an unallocated line whole to the default destination', () => {
      const r = explodeCheckoutLines({
        lines: [line()], destinations: [albany], defaultDestinationRef: 'd1',
      })
      if (!r.ok) throw new Error(r.code)
      expect(r.lines).toEqual([
        expect.objectContaining({
          cart_line_id: 'line-1', qty: 12,
          destination_ref: 'd1', ship_to_store_id: 'store-albany',
        }),
      ])
    })

    it('explodes an allocated line into one row per destination, denormalising ship_to_store_id', () => {
      const r = explodeCheckoutLines({
        lines: [line({ allocations: [
          { destination_ref: 'd1', qty: 8 },
          { destination_ref: 'd3', qty: 4 },
        ] })],
        destinations: [albany, adHoc], defaultDestinationRef: 'd1',
      })
      if (!r.ok) throw new Error(r.code)
      expect(r.lines).toEqual([
        expect.objectContaining({ qty: 8, destination_ref: 'd1', ship_to_store_id: 'store-albany' }),
        expect.objectContaining({ qty: 4, destination_ref: 'd3', ship_to_store_id: null }),
      ])
      // every non-destination field survives the explosion
      expect(r.lines[1]).toMatchObject({
        product_id: 'p1', variant_id: 'v1', size_id: 1, size_label: 'S',
        cart_line_id: 'line-1', decorations: [],
      })
    })

    it.each([
      [[{ destination_ref: 'd1', qty: 8 }], 'allocation_sum_mismatch'],           // 8 ≠ 12
      [[{ destination_ref: 'd1', qty: 8 }, { destination_ref: 'd2', qty: 5 }], 'allocation_sum_mismatch'], // 13 ≠ 12
      [[{ destination_ref: 'd1', qty: 12 }, { destination_ref: 'd2', qty: 0 }], 'invalid_allocation_qty'],
      [[{ destination_ref: 'd1', qty: 11.5 }, { destination_ref: 'd2', qty: 0.5 }], 'invalid_allocation_qty'],
      [[{ destination_ref: 'nope', qty: 12 }], 'unknown_destination'],
    ] as const)('rejects bad allocations (%j -> %s)', (allocations, code) => {
      const r = explodeCheckoutLines({
        lines: [line({ allocations: [...allocations] })],
        destinations: [albany, takapuna], defaultDestinationRef: 'd1',
      })
      expect(r).toMatchObject({ ok: false, code, cartLineId: 'line-1' })
    })

    it('rejects duplicate refs, malformed destinations, and a missing default', () => {
      expect(explodeCheckoutLines({
        lines: [line()], destinations: [albany, { ...takapuna, ref: 'd1' }],
        defaultDestinationRef: 'd1',
      })).toMatchObject({ ok: false, code: 'duplicate_ref' })

      expect(explodeCheckoutLines({
        lines: [line()],
        destinations: [{ ref: 'd9', ship_to_store_id: 'store-x', custom_address: adHoc.custom_address }],
        defaultDestinationRef: 'd9',
      })).toMatchObject({ ok: false, code: 'destination_shape', destinationRef: 'd9' })

      expect(explodeCheckoutLines({
        lines: [line()], destinations: [{ ref: 'd9' }], defaultDestinationRef: 'd9',
      })).toMatchObject({ ok: false, code: 'destination_shape' })

      expect(explodeCheckoutLines({
        lines: [line()], destinations: [albany], defaultDestinationRef: 'd2',
      })).toMatchObject({ ok: false, code: 'unknown_destination' })

      expect(explodeCheckoutLines({
        lines: [line()], destinations: [], defaultDestinationRef: 'd1',
      })).toMatchObject({ ok: false, code: 'no_destinations' })
    })

    it('rejects a destination that ends up with nothing allocated to it', () => {
      const r = explodeCheckoutLines({
        lines: [line({ allocations: [{ destination_ref: 'd1', qty: 12 }] })],
        destinations: [albany, takapuna], defaultDestinationRef: 'd1',
      })
      expect(r).toMatchObject({ ok: false, code: 'empty_destination', destinationRef: 'd2' })
    })
  })
  ```

- [ ] **2. Run it and confirm it fails for the RIGHT reason.**
  `npx vitest run lib/checkout/destinations.test.ts` → expect `Cannot find module './destinations'`.

- [ ] **3. Implement it.** Contract:
  - Validation order matters for stable error reporting: destinations first (`no_destinations` → `duplicate_ref` → `destination_shape` → default-ref exists), then per line in order (`unknown_destination` → `invalid_allocation_qty` → `allocation_sum_mismatch`), then `empty_destination` last.
  - Explosion spreads the original line (`{ ...line }`), overwrites `qty`, sets `destination_ref`, sets `ship_to_store_id` from the destination (null for ad-hoc), and **deletes `allocations`** from the output rows.
  - `invalid_allocation_qty` = not a positive integer.
  - Pure function: no fetches, no org/store checks — the route (Task 8) owns "does this store belong to the org".

  **Trap:** don't mutate the caller's line objects — the routes reuse the same array for `pricing_pool_lines`, and an in-place `qty` overwrite would corrupt the pool that pricing/MOQ seed from. Spread, never assign.

  **Stuck for 15 minutes?** `partitionByFulfilment` in `partition.ts` is the same pattern — walk lines, emit new arrays, decide nothing about the DB.

- [ ] **4. Run the test.** `npx vitest run lib/checkout/destinations.test.ts` → PASS

- [ ] **5. Run the guards.** `npx tsc --noEmit && npm run lint` → no NEW failures.

- [ ] **6. Commit.** `git commit -m "feat(checkout): destinations module — validate and explode split-shipment allocations"`

- [ ] **7. Checkpoint.** Ask Claude: *"review Task 3 against the plan"*.

**Why this shape:** a discriminated result (not thrown errors) lets the route map each code to a 400 body the checkout UI can point at a specific line/destination — the same reason `MoqViolationError` carries per-line detail.
**Rejected:** exploding client-side in the cart (each allocation becomes a real `CartLine`) — it would reuse existing plumbing but makes the cart UI show phantom duplicate lines, and the server must re-validate sums anyway; the server chokepoint is unavoidable, so it's the only one.
**Done when:** step 4 passes; `npx tsc --noEmit` accepts the two new optional fields on `CheckoutLineInput` with zero call-site changes.

---

### Task 4: MOQ pools across partitions (portal)   `[Routine]`   ~1h

**Goal:** MOQ judges a product's pooled production quantity (whole cart), not the slice that landed in this partition.

**Files:**
- Modify: `lib/checkout/prepare.ts:493-531` (the `productionQtyByProductId` block)
- Test: `lib/checkout/prepare.test.ts` (append)

**Read first:**
- [ ] `lib/checkout/prepare.ts:542-553` — how tier pricing already seeds from `poolLines`; you are giving MOQ the same treatment.
- [ ] `lib/checkout/prepare.ts:493-506` — the comment explaining why stocked lines are excluded; that rule survives unchanged.

**Steps:**

- [ ] **1. Write the failing test.** Append inside the existing `describe('prepareCustomerOrderPartition', …)` block in `lib/checkout/prepare.test.ts` (the file's local `config()`, `input()`, `NZ` helpers are in scope; `MoqViolationError` needs adding to the `./errors` import at the top):

  ```ts
  it('pools MOQ across partitions via pricing_pool_lines (split shipment)', async () => {
    const stub = makeFanoutStub(config()) // product-1 has moq: 24
    const base = input()
    const partitionSlice = { ...base.lines[0], qty: 12 }
    const otherPartitionSlice = { ...base.lines[0], cart_line_id: 'line-2', qty: 12 }

    const prepared = await prepareCustomerOrderPartition(
      stub.admin,
      {
        ...base,
        lines: [partitionSlice],
        pricing_pool_lines: [partitionSlice, otherPartitionSlice],
      },
      { countryPartitionEnabled: false, partitionKey: 'purchase_order', country: NZ },
    )

    expect(prepared.lines).toEqual([expect.objectContaining({ cartLineId: 'line-1', unitPrice: 12.5 })])
  })

  it('still throws MoqViolationError when even the pooled quantity misses MOQ', async () => {
    const stub = makeFanoutStub(config())
    const base = input()

    await expect(
      prepareCustomerOrderPartition(
        stub.admin,
        { ...base, lines: [{ ...base.lines[0], qty: 12 }] },
        { countryPartitionEnabled: false, partitionKey: 'purchase_order', country: NZ },
      ),
    ).rejects.toBeInstanceOf(MoqViolationError)
  })
  ```

- [ ] **2. Run it and confirm it fails for the RIGHT reason.**
  `npx vitest run lib/checkout/prepare.test.ts` → the first new test fails with `MoqViolationError` (12 < 24 partition-locally); the second already passes. If the first fails any other way, the fixture is wrong — fix it before touching `prepare.ts`.

- [ ] **3. Implement it.** Contract:
  - `productionQtyByProductId` seeds from `poolLines` (already defined at `prepare.ts:545`) instead of `input.lines`, still excluding `fulfilment_type === 'stocked'`. **You will need to hoist the `const poolLines = …` line above the MOQ block** — keep it a single definition, don't duplicate it.
  - The violation-reporting loop at `prepare.ts:511-530` still iterates `input.lines` only — errors keep pointing at this partition's cart rows.
  - `totalQtyByProductId` (line 421) and everything else in the MOQ block stays untouched.

  **Trap:** the fulfilment-truth coercion at `prepare.ts:479-491` runs on `input.lines` only — pool lines belonging to *other* partitions keep their client-claimed `fulfilment_type` here. That's acceptable (their own partition's prepare coerces them, and a bogus 'stocked' claim there fails the whole submit), but do not "fix" it by coercing pool lines in this call — you'd double-coerce shared object references.

  **Stuck for 15 minutes?** Diff your change against how `totalQtyByDecorationTierKey` (lines 546-553) consumes `poolLines`. Same seed, same exclusion logic as the old block, different map.

- [ ] **4. Run the test.** `npx vitest run lib/checkout/prepare.test.ts` → PASS (all, including the file's existing cases)

- [ ] **5. Run the guards.** `npx tsc --noEmit && npm run lint && npm test` → no NEW failures. The full run matters here: `submit.pricing-pool.test.ts` and `submit.minimum-order.test.ts` exercise adjacent behaviour.

- [ ] **6. Commit.** `git commit -m "fix(checkout): MOQ pools across partitions via pricing_pool_lines"`

- [ ] **7. Checkpoint.** Ask Claude: *"review Task 4 against the plan"*.

**Why this shape:** MOQ exists because a production run has a minimum economic size; the run *is* the pooled quantity (that's why pricing pools) — the partition-local check was an accident of where the code lived, and it goes live now because it is strictly more lenient.
**Rejected:** pooling only when destinations are present — it forks the rule ("MOQ means different things on different orders") to protect behaviour that was already wrong for cross-country carts.
**Done when:** step 4 and step 5 both green; the two new tests demonstrate pool-passes / pool-fails respectively.

---

### Task 5: Pooled $500 minimum + picking-fee suppression seams (portal)   `[Routine]`   ~1.5h

**Goal:** two dark seams exist: prepare can be told the pooled notional for the $500 gate, and the picking fee can be told to stand down.

**Files:**
- Modify: `lib/checkout/minimum-order.ts` (new export), `lib/checkout/prepare.ts:1554-1567`, `lib/pricing/order-picking-fee.ts`, `lib/checkout/submit.ts` (`CheckoutInput` type)
- Test: `lib/checkout/minimum-order.test.ts` (append), `lib/pricing/order-picking-fee.test.ts` (append)

**Interfaces:**
- `CheckoutInput` gains `pooled_minimum_notional?: number` — **server-owned**: only the routes may set it (Task 8); it must never be copied from a request body.
- Produces:

  ```ts
  export function pooledMinimumNotional(input: {
    partitions: Array<{ currency: string; orderType: 'purchase_order' | 'stock_on_hand'; notionalValue: number }>
    targetCurrency: string
    ratesFromNzd: Record<string, number>   // NZD-base target rates, e.g. { NZD: 1, AUD: 0.92 }
  }): number
  ```
- `checkoutPickingFee` gains `splitShipment?: boolean` → returns 0 when true.

**Read first:**
- [ ] `lib/checkout/minimum-order.ts` — `evaluateMinimumOrder`'s exact status fields; your helper feeds its `notionalValue`.
- [ ] `lib/pricing/order-picking-fee.ts` — `checkoutPickingFee`'s current gates; yours is one more early-out.
- [ ] `lib/currency/exchange-rates.ts:4-10` — the NZD-base rate shape (`AUD: 0.92` means 1 NZD = 0.92 AUD).

**Steps:**

- [ ] **1. Write the failing tests.** Append to `lib/checkout/minimum-order.test.ts`:

  ```ts
  import { pooledMinimumNotional } from './minimum-order'

  describe('pooledMinimumNotional', () => {
    const rates = { NZD: 1, AUD: 0.9, USD: 0.6, GBP: 0.5, EUR: 0.55 }
    const partitions = [
      { currency: 'NZD', orderType: 'purchase_order' as const, notionalValue: 300 },
      { currency: 'AUD', orderType: 'purchase_order' as const, notionalValue: 270 }, // = 300 NZD at 0.9
    ]

    it('sums purchase_order partitions into the target currency', () => {
      expect(pooledMinimumNotional({ partitions, targetCurrency: 'NZD', ratesFromNzd: rates })).toBe(600)
      expect(pooledMinimumNotional({ partitions, targetCurrency: 'AUD', ratesFromNzd: rates })).toBe(540)
    })

    it('ignores stock_on_hand partitions — the minimum never applied to them', () => {
      expect(
        pooledMinimumNotional({
          partitions: [...partitions, { currency: 'NZD', orderType: 'stock_on_hand', notionalValue: 5000 }],
          targetCurrency: 'NZD',
          ratesFromNzd: rates,
        }),
      ).toBe(600)
    })

    it('falls back to face value for a currency with no rate', () => {
      expect(
        pooledMinimumNotional({
          partitions: [{ currency: 'XXX', orderType: 'purchase_order', notionalValue: 200 }],
          targetCurrency: 'NZD',
          ratesFromNzd: rates,
        }),
      ).toBe(200)
    })
  })
  ```

  Append to `lib/pricing/order-picking-fee.test.ts` (match the file's existing call-shape for `checkoutPickingFee` — copy an existing case and add `splitShipment: true`):

  ```ts
  it('returns 0 on split-shipment orders regardless of band', () => {
    expect(
      checkoutPickingFee({
        countryPartitionEnabled: true,
        orderType: 'stock_on_hand',
        billCountry: 'NZ',
        goodsSubtotal: 50, // would be the $35 band
        legacyShipCountry: null,
        legacyDefaultBillCountry: 'NZ',
        splitShipment: true,
      }),
    ).toBe(0)
  })
  ```

- [ ] **2. Run and confirm the RIGHT failures.**
  `npx vitest run lib/checkout/minimum-order.test.ts lib/pricing/order-picking-fee.test.ts` → `pooledMinimumNotional` is not exported (import error) and the picking-fee case gets `35`.

- [ ] **3. Implement it.** Contract:
  - `pooledMinimumNotional`: filter to `purchase_order`; convert each notional to NZD (`value / rate`), sum, convert to target (`× rate`), `round2` the result. Missing rate for a currency → treat that value at face (rate 1) and `console.warn` once.
  - `checkoutPickingFee`: `splitShipment === true` → 0, before every other gate.
  - `prepare.ts:1558`: `notionalValue` becomes `input.pooled_minimum_notional ?? goodsValueForBand`. Nothing else in the `evaluateMinimumOrder` call changes.
  - `prepare.ts:1523-1533`: pass `splitShipment: (input.destinations?.length ?? 0) > 0` into `checkoutPickingFee` (the `destinations` field itself arrives in Task 7 — if you're doing tasks in order, add `destinations?: CheckoutDestinationInput[]` to `CheckoutInput` now and leave it unread elsewhere).

  **Trap:** `CheckoutInput` is parsed from the request body in both routes. `pooled_minimum_notional` and `destinations` must be **explicitly overwritten** by the route from server-derived values (Task 8 does this); until then nothing reads them — but write the type's doc comment now saying "server-owned, routes must overwrite", or a future reader will trust the body.

  **Stuck for 15 minutes?** The status object you're influencing is built at `minimum-order.ts:54-61`; trace one existing call from `prepare.minimum-order.test.ts` to see the full input shape.

- [ ] **4. Run the tests.** Same command → PASS.

- [ ] **5. Run the guards.** `npx tsc --noEmit && npm run lint && npm test` → no NEW failures (`submit.minimum-order.test.ts` and `prepare.minimum-order.test.ts` must stay green — nothing sets the new fields yet).

- [ ] **6. Commit.** `git commit -m "feat(checkout): pooled minimum-order seam + split-shipment picking-fee suppression (dark)"`

- [ ] **7. Checkpoint.** Ask Claude: *"review Task 5 against the plan"*.

**Why this shape:** the $500 verdict must stay **inside** the partition (`PreparedCheckoutPartition.minimumOrder` is documented as the single authoritative verdict submit reads) — so the pool value travels in as an input rather than the verdict being patched from outside, which would create the display/enforcement divergence that comment explicitly exists to prevent.
**Rejected:** computing the pool inside prepare from `pricing_pool_lines`' claimed prices — foreign partitions' claimed prices are client data; a partition would be trusting numbers it never repriced.
**Done when:** both test files pass and the full suite is at baseline — proving the seams are genuinely dark.

---

### Task 6: Xero ship-to contact helper (portal)   `[Routine]`   ~45m

**Goal:** the invoice contact store id comes from an explicit rule, not `lines[0]` — split orders always resolve to the org.

**Files:**
- Create: `lib/xero/xero-ship-to.ts`
- Test: `lib/xero/xero-ship-to.test.ts`
- Modify: `lib/checkout/submit.ts:1156-1159` (the `createDraftInvoiceForOrder` call)

**Interfaces:**
- Produces: `xeroShipToStoreId(input: { splitShipment: boolean; lines: Array<Pick<CheckoutLineInput, 'ship_to_store_id'>> }): string | null`

**Read first:**
- [ ] `lib/checkout/submit.ts:1156-1159` — the comment claiming "one destination per order … first line's store speaks for all"; that comment is the bug once splits exist.
- [ ] `lib/xero/draft-invoice.ts:334-336` and `:437-475` — what a null vs non-null `shipToStoreId` does downstream (null already falls back to the org contact; you are not touching this file).

**Steps:**

- [ ] **1. Write the failing test.** Copy verbatim into `lib/xero/xero-ship-to.test.ts`:

  ```ts
  import { describe, it, expect } from 'vitest'
  import { xeroShipToStoreId } from './xero-ship-to'

  describe('xeroShipToStoreId', () => {
    it('split orders always invoice the org — never a destination store', () => {
      expect(
        xeroShipToStoreId({
          splitShipment: true,
          lines: [{ ship_to_store_id: 'store-a' }, { ship_to_store_id: 'store-a' }],
        }),
      ).toBeNull()
    })

    it('single-destination orders keep the store contact when every line agrees', () => {
      expect(
        xeroShipToStoreId({
          splitShipment: false,
          lines: [{ ship_to_store_id: 'store-a' }, { ship_to_store_id: 'store-a' }],
        }),
      ).toBe('store-a')
    })

    it('mixed or custom-address lines resolve to the org, never silently to lines[0]', () => {
      expect(
        xeroShipToStoreId({
          splitShipment: false,
          lines: [{ ship_to_store_id: 'store-a' }, { ship_to_store_id: 'store-b' }],
        }),
      ).toBeNull()
      expect(
        xeroShipToStoreId({ splitShipment: false, lines: [{ ship_to_store_id: null }] }),
      ).toBeNull()
      expect(xeroShipToStoreId({ splitShipment: false, lines: [] })).toBeNull()
    })
  })
  ```

- [ ] **2. Run it and confirm it fails for the RIGHT reason.**
  `npx vitest run lib/xero/xero-ship-to.test.ts` → module not found.

- [ ] **3. Implement it.** Contract:
  - Pure, three lines of logic: split → null; else the single distinct non-null store id shared by **every** line, else null.
  - At the call site (`submit.ts:1156-1159`) replace `input.lines[0]?.ship_to_store_id ?? null` with the helper (pass `splitShipment: (input.destinations?.length ?? 0) > 0`), and rewrite the stale comment to describe the new rule.

  **Trap:** today's live behaviour for genuinely uniform store orders (location-manager buyers, DOC) must not change — that's the "every line agrees → store id" branch. The behaviour that changes is the impossible-today mixed case, which previously would have silently picked `lines[0]`.

  **Stuck for 15 minutes?** `new Set(lines.map(...))` — the answer is about set size.

- [ ] **4. Run the test.** `npx vitest run lib/xero/xero-ship-to.test.ts` → PASS

- [ ] **5. Run the guards.** `npx tsc --noEmit && npm run lint && npm test` → no NEW failures (the Xero-adjacent submit tests pin the uniform behaviour).

- [ ] **6. Commit.** `git commit -m "fix(xero): invoice contact from explicit ship-to rule, org on split orders"`

- [ ] **7. Checkpoint.** Ask Claude: *"review Task 6 against the plan"*.

**Why this shape:** the landmine was an implicit rule ("first line speaks for all") living in a call-site expression; naming it as a function makes the split-order case impossible to forget and the uniform case testable.
**Rejected:** resolving per-destination Xero contacts on split orders — the spec decision is one org invoice; per-store contacts would force one invoice per destination.
**Done when:** step 4 and 5 green; the call site no longer contains `lines[0]`.

---

### Task 7: Prepare computes per-destination split fees (portal)   `[Routine]`   ~2h

**Goal:** a partition prepared with destinations carries per-destination split fees in its totals, with the picking fee at 0.

**Files:**
- Modify: `lib/checkout/prepare.ts` (types at 65-86, fee block at 1523-1533, totals assembly at 1599-1605), `lib/checkout/submit.ts` (`CheckoutInput.destinations` doc if not done in Task 5)
- Test: `lib/checkout/prepare.test.ts` (append)

**Interfaces:**
- `PreparedCheckoutPartition` gains:
  `splitFees: Array<{ destinationRef: string; skuCount: number; fee: number }>` (empty array when not split) and `totals.splitFeeTotal: number` (0 when not split).
- Consumes: `distinctSkuCount` / `splitFeeForSkuCount` (Task 2), `CheckoutDestinationInput` (Task 3), lines carrying `destination_ref` (Task 3's explosion — prepare receives already-exploded lines).

**Read first:**
- [ ] `lib/checkout/prepare.ts:1523-1553` — where `pickFee` is computed and folded into `billedTotal`; your split fees ride the identical seam.
- [ ] `lib/currency/server-exchange-rates.ts` — the server-side rates fetch; note its actual export name and shape before writing the conversion call.

**Steps:**

- [ ] **1. Write the failing test.** Append inside the existing describe in `lib/checkout/prepare.test.ts`:

  ```ts
  it('computes per-destination split fees and suppresses the picking fee on split orders', async () => {
    const stub = makeFanoutStub(config())
    const base = input()
    const d1Line = { ...base.lines[0], qty: 16, destination_ref: 'd1', ship_to_store_id: null }
    const d2Line = { ...base.lines[0], cart_line_id: 'line-1b', qty: 8, destination_ref: 'd2', ship_to_store_id: null }

    const prepared = await prepareCustomerOrderPartition(
      stub.admin,
      {
        ...base,
        lines: [d1Line, d2Line],
        destinations: [
          { ref: 'd1', custom_address: { name: 'A', address: '1 A St', city: 'Auckland', postal_code: '1010', country: 'NZ' } },
          { ref: 'd2', custom_address: { name: 'B', address: '2 B St', city: 'Nelson', postal_code: '7010', country: 'NZ' } },
        ],
      },
      { countryPartitionEnabled: false, partitionKey: 'purchase_order', country: NZ },
    )

    // one SKU (product-1, no variant/size) at each destination -> $15 + $15
    expect(prepared.splitFees).toEqual([
      { destinationRef: 'd1', skuCount: 1, fee: 15 },
      { destinationRef: 'd2', skuCount: 1, fee: 15 },
    ])
    expect(prepared.totals.pickingFee).toBe(0)
    expect(prepared.totals.splitFeeTotal).toBe(30)
    // goods 24 × 12.5 = 300; + 30 fees = 330; GST 15% = 49.5
    expect(prepared.totals.tax).toBe(49.5)
    expect(prepared.totals.total).toBe(379.5)
  })

  it('keeps splitFees empty and totals identical on non-split orders', async () => {
    const stub = makeFanoutStub(config())
    const prepared = await prepareCustomerOrderPartition(stub.admin, input(), {
      countryPartitionEnabled: false, partitionKey: 'purchase_order', country: NZ,
    })
    expect(prepared.splitFees).toEqual([])
    expect(prepared.totals.splitFeeTotal).toBe(0)
    expect(prepared.totals.total).toBe(345) // unchanged from the file's first test
  })
  ```

- [ ] **2. Run and confirm the RIGHT failure.**
  `npx vitest run lib/checkout/prepare.test.ts` → the first new test fails on `splitFees` being `undefined` (type error at compile is also acceptable as the "right reason" — fields don't exist yet).

- [ ] **3. Implement it.** Contract:
  - `splitActive = (input.destinations?.length ?? 0) > 0`.
  - Group `repriced` lines by `destination_ref`; per group: `skuCount = distinctSkuCount(group)`, `feeNzd = splitFeeForSkuCount(skuCount)`; fee in partition currency = `round2(feeNzd × ratesFromNzd[currency])` when `options.country.currency !== 'NZD'` (fetch rates via the server exchange-rates module **only when splitActive and non-NZD** — never on the hot non-split path), else the NZD figure.
  - Ordering of `splitFees` follows first appearance of each `destination_ref` in `input.destinations`.
  - `billedTotal` folds in `splitFeeTotal` exactly where `pickFee` is folded today (`billedOrderTotal(lines, splitActive ? splitFeeTotal : pickFee)`); tax stays "billedTotal × taxRate" untouched.
  - A destination with no lines in THIS partition (its allocations all landed in the other country) contributes no fee here — its fee is computed by its own partition.
  - Lines missing `destination_ref` while `splitActive` → throw a plain `Error('split checkout line missing destination_ref')`; the routes guarantee explosion happened, so this is a programmer error, not a customer error.

  **Trap:** `prepare.ts:325-360` resolves the single `shippingAddress` from `input.lines[0].ship_to_store_id` and the mixed-address guard at `:278-283` throws when lines mix store/custom. When `splitActive`, skip both: `shippingAddress = null`, `formattedShippingAddress = 'Split shipment — N destinations'` (Monday/dispatch email consume that string until Phase 2 makes them destination-aware). Do NOT delete the guard — it still protects the legacy path.

  **Stuck for 15 minutes?** The picking fee's journey from `checkoutPickingFee` (1523) through `billedTotal` (1545-1553) into `totals` (1602) is the exact template; your fee differs only in being a per-destination array that also gets summed.

- [ ] **4. Run the test.** `npx vitest run lib/checkout/prepare.test.ts` → PASS.

- [ ] **5. Run the guards.** `npx tsc --noEmit && npm run lint && npm test` → no NEW failures. `tsc` will force you through every constructor of `PreparedCheckoutPartition` — the preview/submit routes and tests that build totals literals need the two new fields.

- [ ] **6. Commit.** `git commit -m "feat(checkout): per-destination split fees in prepared partitions, picking fee suppressed on split"`

- [ ] **7. Checkpoint.** Ask Claude: *"review Task 7 against the plan"*.

**Why this shape:** fees computed inside prepare (not the route) keep the invariant that a partition's `totals` are complete and authoritative — preview renders them and submit persists them with no second computation to drift.
**Rejected:** computing fees at explosion time in the route — the route doesn't know repriced/coerced line truth, and two fee computations (preview vs submit) is exactly the class of bug the picking-fee country column comment in `ShipToRow.tsx:16-19` memorialises.
**Done when:** both new tests pass and the non-split totals test still reads `345`.

---

### Task 8: Preview route accepts destinations (portal)   `[Routine]`   ~2h

**Goal:** `/api/checkout/preview` understands `{ destinations, default_destination_ref, lines[].allocations }`: validates, explodes, partitions by each destination's country, prices with pooled minimum, returns per-destination fees.

**Files:**
- Create: `lib/checkout/destination-country.ts` + `lib/checkout/destination-country.test.ts`
- Modify: `app/api/checkout/preview/route.ts` (request parsing ~top, country resolution 278-324, the mixed-custom rejection at 262-270, partition loop 336-359)

**Interfaces:**
- Request body (extends the existing preview body): `destinations?: CheckoutDestinationInput[]`, `default_destination_ref?: string`; each line may carry `allocations`.
- Produces: `countryCodeForDestination(dest: CheckoutDestinationInput, storeCountryById: Map<string, string | null>): string | null` — used by both routes.
- Response partitions gain `splitFees` and `totals.splitFeeTotal` (already on the prepared partition from Task 7 — surface them).

**Read first:**
- [ ] `app/api/checkout/preview/route.ts:262-324` — the mixed-custom rejection you're conditionalising and the store→country resolution you're generalising.
- [ ] `app/api/checkout/route.ts:193-222` — the submit route's org-ownership check for `ship_to_store_id`s; destinations get the same treatment here.

**Steps:**

- [ ] **1. Write the failing test.** Copy verbatim into `lib/checkout/destination-country.test.ts`:

  ```ts
  import { describe, it, expect } from 'vitest'
  import { countryCodeForDestination } from './destination-country'

  describe('countryCodeForDestination', () => {
    const stores = new Map<string, string | null>([
      ['store-nz', 'NZ'],
      ['store-au', 'AU'],
      ['store-blank', null],
    ])

    it('resolves a saved store through the org store map', () => {
      expect(countryCodeForDestination({ ref: 'd1', ship_to_store_id: 'store-au' }, stores)).toBe('AU')
    })

    it('resolves an ad-hoc destination from its own address', () => {
      expect(
        countryCodeForDestination(
          { ref: 'd2', custom_address: { name: 'X', address: '1 X St', city: 'Sydney', postal_code: '2000', country: 'AU' } },
          stores,
        ),
      ).toBe('AU')
    })

    it('returns null for unknown stores and blank countries — callers must reject, not default', () => {
      expect(countryCodeForDestination({ ref: 'd3', ship_to_store_id: 'store-missing' }, stores)).toBeNull()
      expect(countryCodeForDestination({ ref: 'd4', ship_to_store_id: 'store-blank' }, stores)).toBeNull()
    })
  })
  ```

- [ ] **2. Run and confirm the RIGHT failure.** `npx vitest run lib/checkout/destination-country.test.ts` → module not found.

- [ ] **3. Implement it.** Contract for the helper: trivial (store → map lookup; custom → `isoCountryOrNull(custom_address.country)` — reuse `lib/checkout/shipping-address.ts`'s normaliser). Contract for the route wiring, in order:
  1. Parse `destinations` / `default_destination_ref` from the body. If absent → the existing code path, character-identical.
  2. If present: fetch `organizations.split_shipping_enabled`; off → 400 `{ code: 'split_shipping_disabled' }`.
  3. Org-ownership: every destination's `ship_to_store_id` must be in the org's stores (same query the route already runs); ad-hoc addresses require non-empty `address`, `city`, `postal_code`, `country`. Staff-scoped buyers (the existing `checkStaffBranchScope` inputs): every store destination must be within granted branches AND no ad-hoc destinations → else 403 reusing `BuyerScopeError` semantics.
  4. `explodeCheckoutLines(...)` → failure maps to 400 `{ code, detail, cartLineId, destinationRef }`.
  5. Country per exploded line = its destination's country (the helper); `null` → 400 `{ code: 'destination_country_unresolved', destinationRef }`. Feed the existing partition machinery with these countries; drop the mixed-custom rejection (262-270) **only** on the destinations path.
  6. Pass `destinations` (filtered to refs present in that partition's lines) and `pricing_pool_lines` (the full **exploded** set) into each partition's prepare input; **overwrite** `pooled_minimum_notional` — first prepare pass without it, and if any purchase_order partition is unmet, recompute via `pooledMinimumNotional` (rates from the server exchange-rates module) and re-prepare only the unmet partitions with it.
  7. Response includes each partition's `splitFees` and `splitFeeTotal`.

  **Trap:** `pricing_pool_lines` must be the exploded lines, and the SAME object references given to each partition — Task 3's no-mutation rule is what makes this safe. And per Task 5's trap: `pooled_minimum_notional` and `destinations` on the parsed body are attacker-controlled — build the prepare input explicitly, never spread the body into it.

  **Stuck for 15 minutes?** Follow one existing line's journey from body → country lookup (route:278-324) → partition input (336-359); your destinations path replaces only the "where does the country come from" step.

- [ ] **4. Run the test.** `npx vitest run lib/checkout/destination-country.test.ts` → PASS.

- [ ] **5. Run the guards.** `npx tsc --noEmit && npm run lint && npm test` → no NEW failures; then a manual sanity: `npm run dev`, load `/checkout` as any org, confirm preview still works for a normal cart (no destinations sent).

- [ ] **6. Commit.** `git commit -m "feat(checkout): preview route accepts split-shipment destinations (flag-gated)"`

- [ ] **7. Checkpoint.** Ask Claude: *"review Task 8 against the plan"*.

**Why this shape:** validation lives in the route (it owns org context and the store list), explosion in Task 3's pure module, pricing in prepare — each seam testable alone, and the submit route (Task 10) reuses all three with no drift.
**Rejected:** a shared "validate everything" mega-helper for both routes — the two routes' auth/context differ enough (preview's staff-preview sessions, submit's idempotency) that the mega-helper grows flags; the three small seams compose instead.
**Done when:** helper tests pass, the suite is at baseline, and a flag-off org's preview behaves byte-identically (manual check in step 5).

---

### Task 9: Submit RPC gains `p_destinations` (staff repo)   `[Routine]`   ~3h

**Goal:** `submit_b2b_order_for_country` accepts destinations, writes `order_destinations`, stamps exploded lines' `destination_id` + `ship_to_store_id` at insert time, sets `quotes.split_shipment`, and nulls the header addresses on split orders.

**Files:**
- Create: `print-room-staff-portal/supabase/migrations/<fresh-timestamp>_split_shipment_submit_destinations.sql`

**Interfaces:**
- Consumes: Task 1's table.
- Produces: `submit_b2b_order_for_country(..., p_destinations jsonb default null)` where `p_destinations` is `[{ref, position, ship_to_store_id, custom_address, address_snapshot, split_fee}]` and each `p_lines` element may carry `destination_ref`. Portal wiring in Task 10 depends on exactly these names.

**Read first:**
- [ ] Find the LATEST definition of both functions — they've been re-created since baseline:
  `grep -l "create or replace function public.submit_b2b_order" supabase/migrations/*.sql | sort | tail -2`
  Copy from the newest hit, not from `20260720000001_baseline_schema.sql`.
- [ ] `supabase/migrations/20260824140000_sp3_checkout_country_partition.sql:24-140` — the wrapper you're extending.
- [ ] `supabase/migrations/20260727140000_location_manager_branch_grants.sql:45-52` — the comment declaring the header-stamp division of labour you're now amending.

**Steps:**

- [ ] **1. Write the migration.** Contract (no SQL body given — this task IS the SQL):
  - **Signature change = DROP then CREATE** for `submit_b2b_order_for_country` (and `submit_b2b_order` if you thread the param through it — see next point). `create or replace` cannot change a parameter list, and leaving the old arity alive as an overload breaks PostgREST with an ambiguous-function 300. A dropped-and-recreated single function with `p_destinations jsonb default null` keeps every existing caller working (named args + default).
  - Destination writes must happen where `quote_id` exists and lines are being inserted — thread `p_destinations` into `submit_b2b_order` itself: after its `quotes` INSERT, insert `order_destinations` rows (validate: positions dense from 1, refs unique, store destinations' `ship_to_store_id` belongs to the org — raise using the codebase's existing error style); build a `ref → id` map; in the existing per-line loop, stamp `destination_id` (from `line->>'destination_ref'`) and `ship_to_store_id` into the `quote_items` INSERT column list.
  - In the wrapper, when `p_destinations` is non-null and non-empty: after the inner call, `update quotes set split_shipment = true, shipping_address = null, ship_to_store_id = null where id = v_quote_id;` and `update orders set shipping_address = null where quote_id = v_quote_id;`.
  - Legacy path (`p_destinations` null): zero behavioural change — every new statement guarded.
  - A line whose `destination_ref` doesn't match any destination → raise; destinations present but ANY line missing `destination_ref` → raise. All-or-nothing.

  **Trap:** `submit_b2b_order`'s `quote_items` INSERT does not currently include `ship_to_store_id` (the portal stamps it post-RPC — that's the migration-comment division of labour you read). You are moving that stamp into the RPC **for the destinations path only**; the legacy path keeps the post-RPC portal stamp. Don't unify them in this migration — Task 10 handles the portal side.

  **Stuck for 15 minutes?** The DOC region-quota work already threads a per-line field (`ship_to_store_id`) through `p_lines` into RPC-side logic — grep `region` in the newest `submit_b2b_order` definition and mirror how it reads per-line jsonb fields.

- [ ] **2. Apply.** `supabase db push` → clean.

- [ ] **3. Verify with a rollback-safe smoke.** In the SQL editor, `begin;` … call `submit_b2b_order_for_country` directly with a minimal 2-destination payload against the demo/test org (copy a real call's params from a recent `quotes` row's shape), then:
  `select position, ship_to_store_id is not null as has_store, split_fee from order_destinations where quote_id = '<returned quote_id>' order by position;` → 2 rows
  `select destination_id is not null from quote_items where quote_id = '<id>';` → all `true`
  `select split_shipment, shipping_address is null, ship_to_store_id is null from quotes where id = '<id>';` → `true, true, true`
  then `rollback;` — the RPC touches only tables, external pushes are portal-side, so rollback is safe.

- [ ] **4. Legacy regression.** Repeat step 3's `begin…rollback` with `p_destinations` omitted → `split_shipment=false`, `shipping_address` non-null, no `order_destinations` rows.

- [ ] **5. Run the guards.** Staff repo `npx tsc --noEmit && npm test` → baseline.

- [ ] **6. Commit.** `git commit -m "feat(db): submit RPC accepts p_destinations — order_destinations + per-line stamps"`

- [ ] **7. Checkpoint.** Ask Claude: *"review Task 9 against the plan"* — bring the step 3/4 SQL output.

**Why this shape:** stamping `destination_id` at INSERT time is the only non-fragile option — the portal's post-RPC line matching can't distinguish exploded twins (same product/size, different destinations), and a wrapper-side ordinal fix-up would depend on insertion order forever.
**Rejected:** wrapper-only implementation (leave `submit_b2b_order` untouched, match lines afterwards by ordinal) — precisely the twin-ambiguity above, plus it puts an UPDATE-after-INSERT inside what should be one atomic write.
**Done when:** steps 3 AND 4's selects show exactly the stated values.

---

### Task 10: Submit wiring (portal)   `[Routine]`   ~2h

**Goal:** `/api/checkout` (submit) runs the same destinations pipeline as preview and hands `p_destinations` to the RPC; split orders skip the legacy header/line stamps.

**Files:**
- Modify: `app/api/checkout/route.ts` (mirror Task 8's steps 1-6), `lib/checkout/submit.ts` (RPC call ~376-445, step 4 line matching ~601-631, step 4a header stamp ~638-656, `buildLineSnapshotUpdate`)
- Test: `lib/checkout/__tests__/submit.split-destinations.test.ts` (new), plus `submit.location.test.ts`-style unit additions

**Interfaces:**
- Consumes: Task 9's `p_destinations` shape exactly; Task 3's exploded lines; Task 7's `splitFees`.

**Read first:**
- [ ] `lib/checkout/__tests__/submit.country-persistence.test.ts` — the full-path submit test pattern on `makeFanoutStub` (how the stub answers the RPC, how `stub.rpcCalls` / `stub.writeCalls` are asserted). Your new test file grafts onto this setup.
- [ ] `lib/checkout/submit.ts:601-631` — the twin-matching problem in step 4; and `:638-656` — the 4a header stamp that split orders must skip.

**Steps:**

- [ ] **1. Write the failing tests.** Two parts.

  (a) Verbatim additions to `lib/checkout/__tests__/submit.location.test.ts`:

  ```ts
  it('omits ship_to_store_id from the snapshot update on split orders — the RPC owns it', () => {
    const u = buildLineSnapshotUpdate({ ship_to_store_id: 'store-a', location_label: 'Albany' }, { splitOrder: true })
    expect('ship_to_store_id' in u).toBe(false)
    expect(u).toMatchObject({ line_location_label: 'Albany' })
  })

  it('keeps stamping ship_to_store_id on legacy orders', () => {
    const u = buildLineSnapshotUpdate({ ship_to_store_id: 'store-a' }, { splitOrder: false })
    expect(u).toMatchObject({ ship_to_store_id: 'store-a' })
  })
  ```

  (b) New file `lib/checkout/__tests__/submit.split-destinations.test.ts` — graft the setup (stub config, context, RPC success response) from `submit.country-persistence.test.ts`, then a submit whose input carries two destinations and exploded lines, with these assertions verbatim:

  ```ts
  const rpcCall = stub.rpcCalls.find(({ name }) => name === 'submit_b2b_order_for_country')
  if (!rpcCall) throw new Error('RPC not called')
  const args = rpcCall.args as {
    p_destinations: Array<Record<string, unknown>>
    p_lines: Array<Record<string, unknown>>
    p_shipping_address: unknown
  }
  expect(args.p_destinations).toEqual([
    expect.objectContaining({ ref: 'd1', position: 1, ship_to_store_id: 'store-albany', split_fee: 15 }),
    expect.objectContaining({ ref: 'd2', position: 2, ship_to_store_id: null, split_fee: 15 }),
  ])
  expect(args.p_destinations[0]).toHaveProperty('address_snapshot')
  expect(args.p_lines.every((l) => typeof l.destination_ref === 'string')).toBe(true)
  expect(args.p_shipping_address).toBeNull()
  // 4a header stamp must NOT run on split orders
  expect(
    stub.writeCalls.some(
      (w) => w.table === 'quotes' && 'ship_to_store_id' in ((w.values ?? {}) as object),
    ),
  ).toBe(false)
  ```

  (Adjust only the `WriteCallRecord` field names to match `fanout-test-stub.ts:22` — read it; the assertions' meaning must not change.)

- [ ] **2. Run and confirm the RIGHT failures.** `npx vitest run lib/checkout/__tests__/submit.location.test.ts lib/checkout/__tests__/submit.split-destinations.test.ts` → (a) fails on the new second parameter not existing; (b) fails on `p_destinations` being absent from the RPC args.

- [ ] **3. Implement it.** Contract:
  - Route: mirror Task 8's parse → flag check → ownership/branch-scope → explode → per-destination countries → prepare with `destinations` + pooled minimum. One addition over preview: build `address_snapshot` per destination — store destinations get the store row shaped exactly like `prepare.ts:326-362` shapes `shippingAddress` from a store; ad-hoc get their `custom_address` verbatim.
  - `submitCustomerOrder`: `p_destinations` from `input.destinations` + snapshots + Task 7's `splitFees` (fee per ref; a ref with no fee entry in this partition → its allocations are in another partition → it isn't in THIS order's `p_destinations` at all); `destination_ref` on each `p_lines` element; `p_shipping_address: null` when split (prepare already produced null from Task 7).
  - Step 4 matching: add `qty` to the match key (harmless for legacy — cart merging means no duplicate signatures) and pass `{ splitOrder }` to `buildLineSnapshotUpdate` per the (a) tests.
  - Step 4a header stamp: skip entirely when split (the RPC nulls + flags the header).
  - `quotes.picking_fee` / billed-total persistence (`submit.ts:515-550` region): the billed total already includes `splitFeeTotal` via Task 7; verify no second picking-fee write resurrects a fee on split orders.

  **Trap:** the Monday push and dispatch email consume `formattedShippingAddress` (`submit.ts:928-942`, `:1462`) — Task 7 set it to `'Split shipment — N destinations'`. Confirm both render that string rather than crashing on a null address object; that placeholder is Phase 2's replacement target, not yours.

  **Stuck for 15 minutes?** For the fee-per-ref lookup shape, `prepared.splitFees` is keyed by `destinationRef` — build `new Map(splitFees.map(f => [f.destinationRef, f.fee]))` next to where `pickFee` is read from internals.

- [ ] **4. Run the tests.** Same command → PASS.

- [ ] **5. Run the guards.** `npx tsc --noEmit && npm run lint && npm test` → no NEW failures — the ~35 `submit.*.test.ts` files are the legacy-path safety net; any of them failing means the split branch leaked.

- [ ] **6. Commit.** `git commit -m "feat(checkout): submit route + RPC wiring for split-shipment destinations"`

- [ ] **7. Checkpoint.** Ask Claude: *"review Task 10 against the plan"*.

**Why this shape:** submit reuses preview's exact pipeline so a previewed price can never differ from a submitted one — the same single-computation rule that made Task 7 put fees inside prepare.
**Rejected:** computing `address_snapshot` inside the RPC from `stores` — the RPC would then need the store fetch the portal already did, and snapshot-at-submit belongs with the actor who validated the address.
**Done when:** step 4 green and the full suite at baseline.

---

### Task 11: Order-level ships-to control (portal)   `[Routine]`   ~2h

**Goal:** flag-on orgs see ONE order-level "Ships to" control (stores + one-time address + Split shipment); per-line dropdowns are gone for them. Flag-off orgs see today's UI, untouched.

**Files:**
- Create: `components/checkout/OrderShipToControl.tsx` + `components/checkout/OrderShipToControl.test.tsx`
- Modify: `components/checkout/CheckoutClient.tsx` (state at 100-175, `renderShipLine` at 317-341), `app/(portal)/checkout/page.tsx` (fetch + pass the org flag)

**Interfaces:**
- Produces:

  ```ts
  export type OrderShipToValue =
    | { kind: 'store'; storeId: string }
    | { kind: 'custom' }
    | { kind: 'split' }

  interface OrderShipToControlProps {
    stores: StoreOption[]            // from ShipToRow.tsx
    value: OrderShipToValue
    onChange: (next: OrderShipToValue) => void
    allowCustom: boolean
    allowSplit: boolean              // false for staff-scoped buyers with no split rights? No — branch-scoped buyers CAN split (granted branches only); false only while submitting
    disabled?: boolean
  }
  ```
- Consumed by Task 12 (split mode mounts the editor) and Task 14.

**Read first:**
- [ ] `components/checkout/CheckoutClient.tsx:100-175` — `perLineShipTo` initialisation, the buyer-default store logic, and `mixedCustom`; your order-level state replaces these three for flag-on orgs.
- [ ] `app/(portal)/checkout/page.tsx:18-25` — the store fetch; the flag fetch rides the same server component.
- [ ] `components/checkout/ShipToRow.test.tsx` — the component-test idiom (RTL + vitest globals, no wrapper providers needed).

**Steps:**

- [ ] **1. Write the failing test.** Copy verbatim into `components/checkout/OrderShipToControl.test.tsx`:

  ```ts
  import { render, screen, fireEvent } from '@testing-library/react'
  import { describe, expect, it, vi } from 'vitest'
  import { OrderShipToControl } from './OrderShipToControl'

  const stores = [
    { id: 'store-a', name: 'Albany', city: 'Auckland', country: 'NZ' },
    { id: 'store-b', name: 'Takapuna', city: 'Auckland', country: 'NZ' },
  ]

  describe('OrderShipToControl', () => {
    it('offers every store, the one-time address, and Split shipment', () => {
      render(
        <OrderShipToControl
          stores={stores}
          value={{ kind: 'store', storeId: 'store-a' }}
          onChange={vi.fn()}
          allowCustom
          allowSplit
        />,
      )
      const select = screen.getByLabelText(/ships to/i)
      expect(select).toHaveValue('store-a')
      expect(screen.getByRole('option', { name: /takapuna/i })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: /one-time address/i })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: /split shipment/i })).toBeInTheDocument()
    })

    it('emits the discriminated value for each choice', () => {
      const onChange = vi.fn()
      render(
        <OrderShipToControl
          stores={stores}
          value={{ kind: 'store', storeId: 'store-a' }}
          onChange={onChange}
          allowCustom
          allowSplit
        />,
      )
      const select = screen.getByLabelText(/ships to/i)
      fireEvent.change(select, { target: { value: 'store-b' } })
      fireEvent.change(select, { target: { value: '__custom__' } })
      fireEvent.change(select, { target: { value: '__split__' } })
      expect(onChange.mock.calls.map(([v]) => v)).toEqual([
        { kind: 'store', storeId: 'store-b' },
        { kind: 'custom' },
        { kind: 'split' },
      ])
    })

    it('hides split and custom when not allowed', () => {
      render(
        <OrderShipToControl
          stores={stores}
          value={{ kind: 'store', storeId: 'store-a' }}
          onChange={vi.fn()}
          allowCustom={false}
          allowSplit={false}
        />,
      )
      expect(screen.queryByRole('option', { name: /split shipment/i })).toBeNull()
      expect(screen.queryByRole('option', { name: /one-time address/i })).toBeNull()
    })
  })
  ```

- [ ] **2. Run and confirm the RIGHT failure.** `npx vitest run components/checkout/OrderShipToControl.test.tsx` → module not found.

- [ ] **3. Implement it.** Contract:
  - Component: a labelled `<select>` styled like `ShipToRow`'s (copy its className); sentinel values `'__custom__'`/`'__split__'` stay inside the component — the emitted value is the discriminated union.
  - `CheckoutClient` receives `splitShippingEnabled: boolean` from the page. When false: not a single behavioural change (`perLineShipTo` etc. all as today). When true: order-level `shipTo: OrderShipToValue` state (default = the buyer-default/first store, mirroring `initialStoreId` at 104-107); `renderShipLine` passes `hideShipTo` so item cards drop their dropdowns; `perLineShipTo` is derived (`kind:'store'` → every line that store; `kind:'custom'` → every line null) so `buildCheckoutRequestLines` keeps working unmodified. `kind:'split'` renders a placeholder panel ("Split shipment — configure destinations", disabled submit) until Task 12 replaces it.
  - Staff-scoped buyers: `allowSplit` is true (they split within granted branches — Task 12 filters their destination choices), `allowCustom` stays governed by the existing `buyerMisconfigured` logic.

  **Trap:** `checkoutReviewState` (`perLineShipTo` in sessionStorage) feeds `/checkout/review`. Deriving `perLineShipTo` from the order-level value keeps the review page working without modification in this task — do not write a new state shape yet; Task 14 owns the review page.

  **Stuck for 15 minutes?** The derivation is one expression over `cart.lines` keyed by `lineId`; the important part is that it lives where `perLineShipTo` is *consumed*, not in state — derived data in `useState` is the bug you'd be introducing.

- [ ] **4. Run the test.** `npx vitest run components/checkout/OrderShipToControl.test.tsx` → PASS.

- [ ] **5. Run the guards + eyeball both paths.** `npx tsc --noEmit && npm run lint && npm test`; then `npm run dev`: a flag-off org's `/checkout` is pixel-identical; flip your own org's flag on directly in the DB **via SQL on the test org only** (`update organizations set split_shipping_enabled = true where id = '<demo org>'`) and confirm the single control renders and a normal store order still previews and submits.

- [ ] **6. Commit.** `git commit -m "feat(checkout): order-level ships-to control behind split_shipping_enabled"`

- [ ] **7. Checkpoint.** Ask Claude: *"review Task 11 against the plan"*.

**Why this shape:** deriving `perLineShipTo` instead of replacing it means every downstream consumer (preview body, review state, submit) is untouched until the split path actually needs destinations — the flag-on non-split order is a plain single-store order end to end.
**Rejected:** deleting the per-line mechanism outright — flag-off orgs still run it, and the derivation gives a one-commit rollback story.
**Done when:** step 5's three checks (tests, flag-off pixel parity, flag-on store order submits) all hold.

---

### Task 12: Split shipment editor + allocation grid (portal)   `[Stretch]`   ~3h

**Goal:** choosing "Split shipment" mounts an editor: build the order's destination list, toggle "Split this item" per item, allocate size quantities in a sizes × destinations grid with live remaining counters; checkout stays blocked until every split item fully allocates; the editor's output feeds the preview/submit request.

The state design is the interesting part — no contract. You decide the component tree, the state shape, and where allocation state lives (component state vs `checkoutReviewState`). Constraints that are fixed: unsplit items implicitly follow the order default destination; the request needs `destinations` + `default_destination_ref` + per-line `allocations` in exactly Task 3's shapes; staff-scoped buyers only see granted branches and no ad-hoc option; removing a destination with allocations must not silently discard quantities.

**Files:**
- Create: `components/checkout/SplitShipmentEditor.tsx`, `components/checkout/AllocationGrid.tsx` (or one file — your call), tests alongside
- Modify: `components/checkout/CheckoutClient.tsx` (replace Task 11's placeholder; gate submit on allocation completeness; include destinations in the preview body), `components/checkout/useCheckoutPreview.ts` (`buildCheckoutRequestLines` carries `allocations`)

**Read first:**
- [ ] The grid mock in the spec (§ "UI" and decisions table) — columns are destinations, rows are the item's size lines, per-size "N left" counter, checkout blocked until every split item shows 0 left everywhere.
- [ ] `components/cart/CartProvider.tsx` `CartLine` — one line per size already; "the item" in the grid is the group of lines sharing `productId + variantId`.
- [ ] `components/checkout/checkoutReviewState.ts` — where the editor state must survive the `/checkout → /checkout/review` hop.

**Steps:**

- [ ] **1. Write the failing test.** Copy verbatim into `components/checkout/AllocationGrid.test.tsx` (rename the imported component if you structure differently — assertions stay):

  ```ts
  import { render, screen, fireEvent } from '@testing-library/react'
  import { describe, expect, it, vi } from 'vitest'
  import { AllocationGrid } from './AllocationGrid'

  const sizeLines = [
    { lineId: 'l-s', sizeLabel: 'S', qty: 12 },
    { lineId: 'l-m', sizeLabel: 'M', qty: 20 },
  ]
  const destinations = [
    { ref: 'd1', label: 'Albany' },
    { ref: 'd2', label: 'Takapuna' },
  ]

  describe('AllocationGrid', () => {
    it('shows a live remaining counter per size', () => {
      render(
        <AllocationGrid
          sizeLines={sizeLines}
          destinations={destinations}
          allocations={{ 'l-s': { d1: 8, d2: 4 }, 'l-m': { d1: 10 } }}
          onChange={vi.fn()}
        />,
      )
      expect(screen.getByTestId('remaining-l-s')).toHaveTextContent('0 left')
      expect(screen.getByTestId('remaining-l-m')).toHaveTextContent('10 left')
    })

    it('emits the updated allocation map when a cell changes', () => {
      const onChange = vi.fn()
      render(
        <AllocationGrid
          sizeLines={sizeLines}
          destinations={destinations}
          allocations={{ 'l-s': { d1: 8, d2: 4 }, 'l-m': { d1: 10 } }}
          onChange={onChange}
        />,
      )
      fireEvent.change(screen.getByLabelText('M to Takapuna'), { target: { value: '10' } })
      expect(onChange).toHaveBeenCalledWith({ 'l-s': { d1: 8, d2: 4 }, 'l-m': { d1: 10, d2: 10 } })
    })

    it('flags over-allocation instead of clamping silently', () => {
      render(
        <AllocationGrid
          sizeLines={sizeLines}
          destinations={destinations}
          allocations={{ 'l-s': { d1: 10, d2: 4 } }}
          onChange={vi.fn()}
        />,
      )
      expect(screen.getByTestId('remaining-l-s')).toHaveTextContent('2 over')
    })
  })
  ```

- [ ] **2. Run and confirm the RIGHT failure.** `npx vitest run components/checkout/AllocationGrid.test.tsx` → module not found.

- [ ] **3. Build it.** (No contract — see the constraints in the Goal.)

  **Trap 1:** number inputs — an empty cell must mean "no allocation", not `NaN` propagating into sums; parse with a guard and keep the raw string as the input's value so typing "1" on the way to "12" doesn't fight the user.
  **Trap 2:** cart edits between grid setup and submit — if a line's qty changes or a line vanishes (the cart pill is live on the page), allocations must re-validate against the live cart; stale allocation keys must invalidate that item's "complete" status, not crash. Task 3's server validation is the backstop, but the UI must not let a user submit a payload the server will bounce.
  **Trap 3:** destination refs must be stable across re-renders (generate once, e.g. `crypto.randomUUID()` at add-time) — array indexes as refs break when a destination is removed.

  **Stuck for 15 minutes?** Model state as `Record<lineId, Record<destinationRef, number>>` at the editor level with the grid purely controlled — the three tests above are written against exactly that grain.

- [ ] **4. Run the tests.** `npx vitest run components/checkout/AllocationGrid.test.tsx` (plus whatever editor-level tests you added) → PASS.

- [ ] **5. Run the guards + drive it.** `npx tsc --noEmit && npm run lint && npm test`; then in the browser (flag-on test org): split an item across two stores, watch the preview totals show two split fees, confirm submit is blocked while "4 left" shows anywhere and unblocked at 0.

- [ ] **6. Commit.** `git commit -m "feat(checkout): split shipment editor with sizes-by-destinations allocation grid"`

- [ ] **7. Checkpoint.** Ask Claude: *"review Task 12 against the plan"* — this one gets a design review, not just a diff review.

**Done when:** step 5's browser drive works end-to-end against the real preview route, and an over-allocated or under-allocated grid cannot reach submit.

---

### Task 13: Google Places autocomplete proxy + input (portal)   `[Routine]`   ~1.5h

**Goal:** ad-hoc destination entry is a server-proxied Places autocomplete that resolves to a structured `CustomAddress`; the API key never reaches the browser.

**Files:**
- Create: `app/api/address-autocomplete/route.ts`, `lib/address/places.ts` + `lib/address/places.test.ts`, `components/checkout/AddressAutocompleteInput.tsx`
- Modify: Task 12's editor (ad-hoc destination path uses the input), `.env.local` + Vercel env: `GOOGLE_PLACES_API_KEY`

**Interfaces:**
- Produces: `POST /api/address-autocomplete` `{ query: string, sessionToken: string, countryBias?: string }` → `{ suggestions: Array<{ placeId: string, label: string }> }`; `POST` with `{ placeId, sessionToken }` → `{ address: CustomAddress }`.
- `mapPlaceToCustomAddress(components: PlaceAddressComponents, fallbackName: string): CustomAddress | null` — pure, tested.

**Read first:**
- [ ] Google's Places API (New) "Autocomplete (New)" + "Place Details (New)" docs — field masks (`suggestions.placePrediction`, `addressComponents`), session-token billing (autocomplete + details under one token bills as one session).
- [ ] `components/checkout/checkoutReviewState.ts:3-9` — the `CustomAddress` you're mapping into.

**Steps:**

- [ ] **1. Write the failing test.** Copy verbatim into `lib/address/places.test.ts`:

  ```ts
  import { describe, it, expect } from 'vitest'
  import { mapPlaceToCustomAddress } from './places'

  const wellington = [
    { types: ['street_number'], longText: '12' },
    { types: ['route'], longText: 'Cuba Street' },
    { types: ['sublocality_level_1', 'sublocality'], longText: 'Te Aro' },
    { types: ['locality'], longText: 'Wellington' },
    { types: ['postal_code'], longText: '6011' },
    { types: ['country'], longText: 'New Zealand', shortText: 'NZ' },
  ]

  describe('mapPlaceToCustomAddress', () => {
    it('maps Google address components to CustomAddress', () => {
      expect(mapPlaceToCustomAddress(wellington, 'Site office')).toEqual({
        name: 'Site office',
        address: '12 Cuba Street',
        city: 'Wellington',
        postal_code: '6011',
        country: 'NZ',
      })
    })

    it('returns null when street or locality is missing — a suburb-level pick is not shippable', () => {
      expect(
        mapPlaceToCustomAddress(wellington.filter((c) => !c.types.includes('route')), 'X'),
      ).toBeNull()
      expect(
        mapPlaceToCustomAddress(wellington.filter((c) => !c.types.includes('locality')), 'X'),
      ).toBeNull()
    })

    it('uses the ISO short code for country, never the display name', () => {
      const r = mapPlaceToCustomAddress(wellington, 'X')
      expect(r?.country).toBe('NZ')
    })
  })
  ```

- [ ] **2. Run and confirm the RIGHT failure.** `npx vitest run lib/address/places.test.ts` → module not found.

- [ ] **3. Implement it.** Contract:
  - `lib/address/places.ts`: the pure mapper (test above defines it) + typed fetch wrappers for the two Google endpoints reading `process.env.GOOGLE_PLACES_API_KEY` (throw a clear error at request time if unset — never at import time, it would break builds).
  - Route: auth-gated like every portal API route (copy the auth preamble from `app/api/checkout/preview/route.ts`); rate-limit by the cheap expedient of rejecting queries under 4 characters; pass `countryBias` as Google's `includedRegionCodes` when present.
  - `AddressAutocompleteInput`: debounced (300ms) suggestion list; picking a suggestion fetches details and emits `CustomAddress`; a "can't find it?" escape hatch reveals the existing manual `CustomAddress` fields (verification is best-effort, not a wall).
  - The manual escape hatch + Task 8's required-field validation means Google being down never blocks checkout.

  **Trap:** session tokens — generate per input-focus on the client, send with both calls; without them every keystroke bills as a standalone request.

  **Stuck for 15 minutes?** The `hcaptcha`-style "external service via env key, server-side only" pattern already exists in this repo's auth routes — grep `process.env.` under `app/api/` for the idiom.

- [ ] **4. Run the test.** `npx vitest run lib/address/places.test.ts` → PASS.

- [ ] **5. Run the guards.** `npx tsc --noEmit && npm run lint && npm test`; browser check: type a real address in the ad-hoc destination flow, pick it, see the structured fields land.

- [ ] **6. Commit.** `git commit -m "feat(checkout): Google Places autocomplete for ad-hoc split destinations"`

- [ ] **7. Checkpoint.** Ask Claude: *"review Task 13 against the plan"*.

**Why this shape:** a server proxy (vs the Maps JS SDK) keeps the key out of the bundle, needs no script-loading lifecycle, and makes the mapper a pure function we can pin with tests.
**Rejected:** Maps JavaScript SDK widget — key restriction by referrer is weaker than server-held, the widget fights Tailwind styling, and its output still needs the same component mapping.
**Done when:** step 5's browser check produces a `CustomAddress` with an ISO country code, and an empty `GOOGLE_PLACES_API_KEY` yields a clean 503 from the route (manual fields still usable).

---

### Task 14: Review, summary + confirmation surfaces (portal)   `[Routine]`   ~2h

**Goal:** the review page shows the per-destination breakdown and fees before submit; the confirmation page's dead "Split across N delivery locations" copy comes alive with real per-destination detail.

**Files:**
- Create: `lib/checkout/destination-summary.ts` + `lib/checkout/destination-summary.test.ts`
- Modify: `components/checkout/checkoutReviewState.ts` (state carries destinations + allocations), `components/checkout/CheckoutReviewClient.tsx` (the "Shipping and options" section at 865-929), `components/checkout/BilledOrderSummary.tsx` (fee rows), `app/(portal)/checkout/confirmation/[orderId]/page.tsx:319-331`

**Interfaces:**
- Produces:

  ```ts
  export interface DestinationSummary {
    ref: string
    label: string                    // store name or custom_address.name
    skuCount: number
    unitTotal: number                // total units to this destination
    fee: number | null               // null when the fee isn't known yet (pre-preview)
    lines: Array<{ productName: string; variantLabel?: string | null; sizeLabel: string | null; qty: number }>
  }
  export function summariseDestinations(input: {
    destinations: Array<{ ref: string; label: string }>
    lines: Array<{ destination_ref?: string | null; product_name: string; size_label?: string | null; qty: number }>
    feesByRef?: Record<string, number>
  }): DestinationSummary[]
  ```
  Used by review, confirmation, and (Phase 2) the staff view.

**Read first:**
- [ ] `app/(portal)/checkout/confirmation/[orderId]/page.tsx:319-331` — the dead `distinctShipTo` copy and its data source (`lineRows` with `ship_to_store_id`); you'll refetch with `destination_id` + join `order_destinations`.
- [ ] `components/checkout/BilledOrderSummary.tsx:27+` and `lib/pricing/order-billing-shape.ts:76-100` — where the picking-fee row renders; split-fee rows take its place on split orders.

**Steps:**

- [ ] **1. Write the failing test.** Copy verbatim into `lib/checkout/destination-summary.test.ts`:

  ```ts
  import { describe, it, expect } from 'vitest'
  import { summariseDestinations } from './destination-summary'

  describe('summariseDestinations', () => {
    it('groups exploded lines under their destination with unit and SKU counts', () => {
      const result = summariseDestinations({
        destinations: [
          { ref: 'd1', label: 'Albany' },
          { ref: 'd2', label: 'Site office' },
        ],
        lines: [
          { destination_ref: 'd1', product_name: 'Hoodie', size_label: 'S', qty: 8 },
          { destination_ref: 'd1', product_name: 'Hoodie', size_label: 'M', qty: 10 },
          { destination_ref: 'd2', product_name: 'Hoodie', size_label: 'S', qty: 4 },
        ],
        feesByRef: { d1: 15, d2: 15 },
      })
      expect(result).toEqual([
        expect.objectContaining({ ref: 'd1', label: 'Albany', unitTotal: 18, fee: 15 }),
        expect.objectContaining({ ref: 'd2', label: 'Site office', unitTotal: 4, fee: 15 }),
      ])
      expect(result[0].lines).toHaveLength(2)
    })

    it('omits destinations with no lines and nulls unknown fees', () => {
      const result = summariseDestinations({
        destinations: [
          { ref: 'd1', label: 'Albany' },
          { ref: 'd9', label: 'Elsewhere' },
        ],
        lines: [{ destination_ref: 'd1', product_name: 'Tee', size_label: null, qty: 2 }],
      })
      expect(result).toEqual([expect.objectContaining({ ref: 'd1', fee: null })])
    })
  })
  ```

- [ ] **2. Run and confirm the RIGHT failure.** `npx vitest run lib/checkout/destination-summary.test.ts` → module not found.

- [ ] **3. Implement it.** Contract:
  - `checkoutReviewState`: add `destinations?: CheckoutDestinationInput[]`, `defaultDestinationRef?: string`, `allocationsByLineId?: Record<string, Record<string, number>>` — all optional so `readCheckoutReviewState`'s legacy-shape tolerance is preserved; bump nothing else.
  - Review page: when the state carries destinations, render a "Deliveries" card from `summariseDestinations` (labels resolved: store name via the page's stores fetch, custom via `custom_address.name`), one row per destination with its fee, replacing the per-line store list at `CheckoutReviewClient.tsx:917-928` **for split orders only**.
  - `BilledOrderSummary`: on split partitions, the picking-fee row is replaced by one "Split delivery — {label}" row per destination (fee from the preview response's `splitFees`); the invoiceCount copy is untouched.
  - Confirmation page: fetch `quote_items.destination_id` + the order's `order_destinations`; when `quotes.split_shipment`, render one address block per destination (from `address_snapshot`) with its lines via `summariseDestinations` — the `distinctShipTo` heuristic dies, replaced by the flag.

  **Trap:** `summariseDestinations` is shared by client components and a server component — keep it dependency-free (no supabase imports, no `use client`).

  **Stuck for 15 minutes?** The review page already conditionally renders order-routing rows at 865-929 — your Deliveries card is a sibling branch of that conditional, not a new page section.

- [ ] **4. Run the test.** `npx vitest run lib/checkout/destination-summary.test.ts` → PASS.

- [ ] **5. Run the guards + drive it.** `npx tsc --noEmit && npm run lint && npm test`; browser: place a split order on the test org end-to-end and read all three surfaces (review, summary totals, confirmation).

- [ ] **6. Commit.** `git commit -m "feat(checkout): split-shipment review, billed summary and confirmation surfaces"`

- [ ] **7. Checkpoint.** Ask Claude: *"review Task 14 against the plan"*.

**Why this shape:** one summariser feeds every surface, so the review page, the confirmation, and Phase 2's staff view can never disagree about what's going where.
**Rejected:** per-surface grouping logic — three implementations of "group lines by destination" is how the picking-fee country divergence happened.
**Done when:** step 5's end-to-end browser pass shows consistent destinations and fees on all three surfaces.

---

### Task 15: Staff read-only breakdown + amendment guard (staff repo)   `[Routine]`   ~1.5h

**Goal:** staff opening a split order see the per-destination breakdown; the amendment planner refuses split orders outright instead of flattening them.

**Files:**
- Create: `print-room-staff-portal/supabase/migrations/<fresh-timestamp>_split_order_amendment_guard.sql`
- Modify: `print-room-staff-portal/src/app/(portal)/orders/[id]/page.tsx` (~293-337 region), `src/lib/orders/read.ts` (fetch destinations + per-line destination_id)
- Test: staff repo — colocate a small grouping test if you extract a helper; the summariser already exists portal-side, and this page is server-rendered, so the meaningful verification is SQL + browser.

**Read first:**
- [ ] `print-room-staff-portal/src/lib/orders/read.ts:586` — `shipToStoreIdFor(quote.ship_to_store_id, order.shipping_address)`; split orders have both null, so the read model needs the destinations fetch and a `splitShipment` flag.
- [ ] `print-room-staff-portal/docs/ui/oem-rules.md` — mandatory pre-flight for the `.tsx` change.
- [ ] `supabase/migrations/20260805120000_atomic_order_amendments.sql:158-238` — where `v_quote` is loaded in `plan_order_amendment`; the guard goes immediately after.

**Steps:**

- [ ] **1. Write the guard migration.** The guard block in full (boilerplate, copy it) — the migration re-creates `plan_order_amendment` from its LATEST definition (`grep -l "create or replace function public.plan_order_amendment" supabase/migrations/*.sql | sort | tail -1`) with this inserted directly after `select * into strict v_quote …`:

  ```sql
  if v_quote.split_shipment then
    perform public.order_amendment_error(
      'split_order_not_amendable',
      'This is a split-shipment order. Amendments would flatten its destinations; '
      'use the destination address-swap tool (Phase 4) or cancel and re-order.',
      null
    );
  end if;
  ```

  (Match `order_amendment_error`'s real signature from the same file — if it takes two args in the latest definition, drop the `null`.)

- [ ] **2. Apply + verify.** `supabase db push`; then in SQL: create nothing — instead call `plan_order_amendment` against any EXISTING (non-split) order id with a trivial intended state → it must behave exactly as before (the guard is a no-op on `split_shipment = false`). A true-flag test order arrives with Task 16's smoke.

- [ ] **3. Staff read model + page.** Contract:
  - `read.ts`: when `quotes.split_shipment`, also select `order_destinations` (ordered by `position`) and `quote_items.destination_id`; expose `splitShipment: boolean` and `destinations: Array<{ id, position, addressSnapshot, splitFee, lines }>` on the order read model.
  - Order page: when `splitShipment`, the single ship-to block (page.tsx:293-337) is replaced by a "Split shipment — N destinations" card list: each destination's snapshot address, its lines (name/size/qty), its split fee. Read-only; no actions. Amend buttons on split orders are disabled with a tooltip naming the guard.

  **Trap:** `resolveShipTo` fallbacks assume a non-null header address somewhere; make the split branch bypass that resolver entirely rather than teaching it about null-with-flag — Phase 2 restructures it properly.

  **Stuck for 15 minutes?** The order page already renders repeated sub-cards for shipments (`order_shipments`); the destinations list is the same visual grammar per oem-rules' exemplars.

- [ ] **4. Run the guards.** Staff repo: `npx tsc --noEmit && npm run lint && npm test` → baseline. Browser: an existing normal order's page is unchanged.

- [ ] **5. Commit.** `git commit -m "feat(orders): split-order read-only destination breakdown + amendment guard"`

- [ ] **6. Checkpoint.** Ask Claude: *"review Task 15 against the plan"*.

**Why this shape:** the guard is a hard error, not a warning, because `plan_order_amendment` resolves ONE canonical shipping address and would persist it across the whole order — a staff member amending a qty would silently destroy the split.
**Rejected:** teaching the amendment RPC about destinations now — that's Phase 4's address-swap scope; a guard is 10 lines and makes the dangerous path impossible in the meantime.
**Done when:** step 2's non-split amendment behaves identically, and the staff page renders an existing order unchanged.

---

### Task 16: Pilot enablement + end-to-end smoke   `[Routine]`   ~1h

**Goal:** the flag is on for the pilot org and one real split order has been proven across every Phase-1 surface.

**Files:**
- Create: `print-room-staff-portal/supabase/migrations/<fresh-timestamp>_split_shipping_pilot_demo_org.sql` — a one-line `update organizations set split_shipping_enabled = true where id = '<demo org id>';` (flag flips are migrations too — same repo-rebuilds-the-DB rule).

**Steps:**

- [ ] **1. Apply the pilot migration.** `supabase db push`.
- [ ] **2. Smoke, on the demo org** (⚠️ the demo org is `is_test=true` — Xero/Monday side-effects are suppressed by the existing test-org gates; note in the checkpoint what was therefore NOT exercised):
  - [ ] Cart: 1 product, 2 sizes (S×12, M×20) + a second product (1 size ×10).
  - [ ] Checkout: Ships to → Split shipment; destinations = 2 saved stores + 1 ad-hoc via autocomplete; split item 1 across all three; leave item 2 unsplit.
  - [ ] Grid blocks submit at "4 left"; unblocks at 0.
  - [ ] Preview totals: three fee rows at $15 each (each destination ≤10 SKUs), picking fee absent.
  - [ ] Submit succeeds. Confirmation shows 3 destination blocks with correct lines.
  - [ ] SQL: `select position, split_fee, ship_to_store_id is null as adhoc from order_destinations where quote_id = '<id>' order by position;` → 3 rows, fees 15/15/15, one `adhoc=true`. `select split_shipment from quotes where id='<id>';` → true. `select count(*) from quote_items where quote_id='<id>' and destination_id is null;` → 0.
  - [ ] Staff order page shows the 3-destination breakdown; Amend is blocked with the guard message.
  - [ ] Regression: place a NORMAL single-store order on the same org → identical to pre-epic behaviour (header address populated, no destinations rows, picking fee where applicable).
- [ ] **3. Record the results** in the plan file (tick boxes, paste the SQL outputs under this task).
- [ ] **4. Commit** both repos' final state; ask Claude: *"review Phase 1 completion against the plan"*.

**Why this shape:** the smoke is the only place the whole pipeline (UI → routes → RPC → staff view) runs unmocked; its SQL asserts are the same invariants Task 9 proved in isolation.
**Rejected:** enabling a real customer org first — the fee schedule and grid UX deserve one friendly-fire pass; WHITEFOX/AF onboarding is a Phase-2+ decision with Jon's sign-off.
**Done when:** every box in step 2 is ticked with outputs recorded, including the normal-order regression.
