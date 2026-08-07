# Starshipit store-address / city gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Task 1 is a HITL prod-data mutation — it is applied inline by Claude with Jon's sign-off on the review table, NOT delegated to a subagent. Tasks 2–3 are ordinary TDD code tasks.**

**Goal:** Stop silently dropping store orders at the Starshipit push gate — backfill the missing `city` (+ `postal_code`) on store rows, then relax the gate to require only a street for store shipments.

**Architecture:** Two independent levers. **Lever 1 (Task 1)** is a one-shot, reviewed `UPDATE stores` that parses the flattened `address` blob into `city`/`postal_code` for the 61 recoverable rows — it immediately unblocks the 6 actively-ordered stores under today's `street && city` gate. **Lever 2 (Tasks 2–3)** relaxes the gate to street-only for store shipments (reusing `isStoreShipment`), as defence-in-depth so a comma-less/dirty/future store row never silently skips again. Custom (customer-typed) addresses are untouched and still require a city. No schema change, no new env var, no staff-portal change.

**Tech Stack:** TypeScript, Next.js, Vitest, Supabase (Postgres via the Supabase MCP `execute_sql`).

## Global Constraints

- **No schema change, no new env var, no staff-portal change.** Same `STARSHIPIT_ENABLED` flag.
- **Branch:** `feat/starshipit-store-address-gate`, off `feat/starshipit-packing-slip-content`. **Merge-order dependency:** this branch must merge **after — or together with — the packing-slip branch**, because the gate relax imports `isStoreShipment` from `lib/starshipit/destination.ts`, which ships on that branch.
- **Strict TDD:** one task at a time, red → green → commit. Never batch tasks or skip the run-to-fail step.
- **Best-effort push is sacred:** the gate change must never make `pushOrderToStarshipit` throw or lose a push; it only widens what is *eligible*. `lib/starshipit/eligibility.ts` stays untouched.
- **Store-vs-custom detection reads the RAW persisted `shipping_address`** (`isStoreShipment` checks `raw.id`); `normalizeShippingAddress` drops that `id`, so the discriminator must be read from `args.shippingAddress`, never from the normalized object.
- **Test / verification emails → `jamie@theprint-room.co.nz`.** Never `jon@`.
- **Every commit message ends with:** `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **Baseline (must hold after every code task):** `npx vitest run` is green except the 4 pre-existing failures (OrdersTable fulfilment badge ×2, TeamClient.branch / MemberBranchGrants ×2). `npx tsc --noEmit` stays at 14 errors, none in `lib/starshipit/*`.

---

### Task 1: City + postal_code backfill (data — HITL, applied inline via Supabase MCP)

Recover the missing `city` (and any clean trailing `postal_code`) for the 61 store rows whose locality was flattened into the single `address` blob by the old bulk CSV importer. **Do this first** (spec §B5): it unblocks the 6 actively-ordered stores under the *current* gate, before the relax even deploys.

**Files:** none (pure prod-data change — no repo edit, no migration, no commit).

**Scope:** `WHERE city IS NULL AND address IS NOT NULL` — the 63 blocked-with-address rows. Of those, **61 are backfilled** (58 clean parses + 3 hand-set); **2 are deliberately excluded** because their address blob is swapped with another branch's and auto-filling would ship to the wrong city:

| Excluded store | `address` blob (wrong branch) | Why |
|---|---|---|
| Anytime Fitness New Plymouth (`854417b3-…`) | `2 Gillies Avenue, Newmarket, Auckland` | address belongs to the Newmarket branch |
| Anytime Fitness Newmarket (`5e81d0e9-…`) | `7 Struthers Place, New Plymouth` | address belongs to the New Plymouth branch |

The 3 hand-set rows (the reason B1 chose a reviewed `UPDATE` over a blind regex): **Richmond** `Tenancy 1 4 Champion Road Richmond 7020` (no comma) → `Richmond` / `7020`; **St Johns** `261 Morrin Road, St Johns Auckland` (space-joined suburb+city) → `Auckland`; **Wyndham Street** `66 Wyndham Street, Auckland CB2:B59BD` (junk token) → `Auckland`. Two clean rows also recover a peeled postcode: **Kaikorai Valley** → `Dunedin` / `9011`, **Papakura** → `Auckland` / `2110`. Two clean rows resolve to a suburb used as the city because that is the last blob segment (**Papanui** → `Papanui`, **The Sands** → `Papamoa East`) — both real NZ localities, kept as-is.

- [ ] **Step 1: Present the mapping to Jon and get explicit sign-off (REVIEW GATE)**

Show Jon the full 61-row `UPDATE` below (its inline `-- <store>` comments *are* the review table) plus the excluded/hand-set summary above. Do not run anything until he approves. This is decision B1's whole point: a human eyeballs the table.

- [ ] **Step 2: Snapshot the target rows for an exact rollback**

Run via `mcp__supabase__execute_sql`:

```sql
create table if not exists _backfill_stores_city_20260807 as
  select id, city, postal_code
  from stores
  where city is null and address is not null;
```

Expected: `CREATE TABLE AS` affecting 63 rows (the full blocked-with-address set — a superset of the 61 we touch, so the snapshot also covers the 2 excluded rows harmlessly).

- [ ] **Step 3: Apply the reviewed backfill**

Run via `mcp__supabase__execute_sql`:

```sql
update stores s
set city = v.city,
    postal_code = coalesce(s.postal_code, v.postal_code)
from (values
  ('849d14dd-6579-44a3-96cf-8d4743f2df33', 'Hamilton',     null::text), -- Avalon
  ('e3c4983f-c378-4c01-a444-68b85246507d', 'Auckland',     null),       -- Botany Downs
  ('706612a7-022b-4944-8dc9-d48eced6afc9', 'Auckland',     null),       -- Browns Bay
  ('39fa4cb8-3335-4c1a-aee7-cd1d9cd15b4a', 'Christchurch', null),       -- Burnside          [active order]
  ('4a342581-3959-4f7f-aa06-ddfffa69678c', 'Cambridge',    null),       -- Cambridge
  ('1503ab44-ed2c-4ba6-aa49-db96097be59f', 'Christchurch', null),       -- Cashmere
  ('06703e72-bd47-4684-9805-64bcee62b651', 'Auckland',     null),       -- Constellation Drive
  ('ffdf31e0-e5ba-4474-b20e-dcf44986912d', 'Auckland',     null),       -- Ellerslie
  ('89546c8a-fa20-4821-8523-ede30686b803', 'Christchurch', null),       -- Ferrymead         [active order]
  ('ff722c46-96e7-411c-8d77-253102453e65', 'Hamilton',     null),       -- Five Cross Roads
  ('2c4346f2-f002-423d-a50a-a9d77f7c1bc8', 'Gisborne',     null),       -- Gisborne
  ('92d67e89-e6ac-4dfa-9712-bbfdcd98f881', 'Auckland',     null),       -- Glen Eden
  ('ee03bf56-9ad0-4a06-8f2e-92a1d001bbaa', 'Auckland',     null),       -- Glendene
  ('176cf0c8-0d0f-4427-b327-9b1155844f9f', 'Tauranga',     null),       -- Golden Sands
  ('0a4a75b8-2d04-457e-9dea-82bc89c75942', 'Christchurch', null),       -- Halswell
  ('ae33c59e-f16c-4c7a-8cd3-82bf863a7c89', 'Hamilton',     null),       -- Hamilton Central
  ('2d2ce647-1031-4eed-a315-3a3300747482', 'Hastings',     null),       -- Hastings
  ('ecbb1e29-bb9d-4e76-bd17-5b99feca0a35', 'Auckland',     null),       -- Henderson
  ('2d28a226-e025-44b8-950b-4aefaf81a795', 'Christchurch', null),       -- Hereford
  ('77f13cbc-8f12-49bf-8cfc-69b89d37c0c7', 'Auckland',     null),       -- Highland Park
  ('1d551eb4-8571-40d7-95ef-a871f2dd50e9', 'Auckland',     null),       -- Hobsonville
  ('57806145-2fa5-4366-b41e-9ae7e37a4511', 'Christchurch', null),       -- Hornby
  ('1f853dc8-6869-4b8f-876b-6b1930cf3559', 'Christchurch', null),       -- Ilam
  ('98a263fb-63b9-412b-a989-f8dc34f2c72e', 'Invercargill', null),       -- Invercargill      [active order]
  ('53b8a7c0-8b39-4747-a203-d164b507a51d', 'Wellington',   null),       -- Johnsonville
  ('5e8b1beb-3cdd-4ec5-9c86-4e7bba42b3fb', 'Dunedin',      '9011'),     -- Kaikorai Valley   [postcode peeled]
  ('155dbc93-c190-4eca-b605-6bde0ae91cd2', 'Wellington',   null),       -- Kent Terrace
  ('ba89a5fd-c0f6-4e47-9e95-2845f8abd5b4', 'Auckland',     null),       -- Kumeu
  ('ac6188cf-773a-4a34-a110-f8c43fd9728f', 'Auckland',     null),       -- Lorne Street
  ('858e399d-b2e1-479b-b969-4ea7a6438e1a', 'Auckland',     null),       -- Manukau
  ('bf3f1467-b8ba-4d6e-9243-87494c5c8a22', 'Auckland',     null),       -- Morningside
  ('81c55d81-f163-485b-8342-2887a5bdac04', 'Auckland',     null),       -- Mt Albert
  ('084fe0af-92e6-44e2-bcb7-cef61c98e5f8', 'Auckland',     null),       -- New Lynn
  ('cf0ac9be-9764-46ab-91e7-30ec72641f52', 'Auckland',     null),       -- Onehunga
  ('5db6b057-c986-4f33-b3b4-ebe566fc6135', 'Napier',       null),       -- Onekawa
  ('d429ed83-eee1-40c0-861f-bd64dd529673', 'Auckland',     null),       -- Ormiston
  ('271a3dc9-5cb2-48ad-a18a-c69975d79bf9', 'Auckland',     '2110'),     -- Papakura          [postcode peeled]
  ('26c7e2e7-b0bf-410d-9530-13fc28f0aa04', 'Papanui',      null),       -- Papanui           [suburb-as-city]
  ('29247315-cad8-4308-acc9-7ca4a04f06d0', 'Auckland',     null),       -- Ponsonby
  ('416971a8-80f1-4ec3-b65f-d27cd225d49a', 'Auckland',     null),       -- Pukekohe
  ('3bbab2a2-8220-4d11-8bd8-0c9210b695f6', 'Rangiora',     null),       -- Rangiora
  ('d14e76bd-025f-4875-b1c1-764579077d56', 'Christchurch', null),       -- Riccarton
  ('1ff0e98f-5831-4e37-902f-dbff7e7c01f2', 'Richmond',     '7020'),     -- Richmond          [HAND-SET: no comma]
  ('e3246bee-49af-4a58-a6bb-7d79e9bb0d15', 'Rotorua',      null),       -- Rotorua
  ('c2b0f760-ee8d-4cd9-a747-5bddf4edf033', 'Hamilton',     null),       -- Rototuna
  ('7bb15e44-eb46-407a-8b11-d5098c8097d7', 'Christchurch', null),       -- Shirley
  ('4ae8c357-1a13-40d3-aec2-c13249021b08', 'Auckland',     null),       -- Silverdale
  ('05a44e8e-b35c-4cdb-9f1b-2952764de294', 'Auckland',     null),       -- St Johns          [HAND-SET: suburb+city]
  ('d2a80c75-b2c0-4b97-9c79-8504b29fe29a', 'Auckland',     null),       -- Takanini
  ('83a8b16f-a1be-4d64-883f-7019460c5739', 'Auckland',     null),       -- Takapuna
  ('d08e37db-41be-4112-a8aa-34f05950cfbf', 'Napier',       null),       -- Taradale
  ('1623b4b3-68ae-41de-9a64-75e1c5a31eff', 'Taupo',        null),       -- Taupo
  ('4c8d0d44-5a12-474d-a494-4cfd1d975f72', 'Tauranga',     null),       -- Tauranga
  ('047880a5-3da6-431f-a0b6-eb31caf590a6', 'Auckland',     null),       -- Te Atatu
  ('65289f7a-2d6c-4493-aae3-7baa262074a3', 'Tauranga',     null),       -- The Lakes
  ('b8ce1700-8ec3-46b1-8033-c7336261db10', 'Papamoa East', null),       -- The Sands         [suburb-as-city]
  ('c9e2aa6c-5eff-490c-b900-54a5d71d454b', 'Auckland',     null),       -- Three Kings
  ('b3011c86-fd73-4803-a59a-445cb1710c31', 'Auckland',     null),       -- Westgate          [active order]
  ('849ffd3e-c725-4f36-895b-f08daabdcc3d', 'Auckland',     null),       -- Whangaparaoa
  ('8764c368-4175-4107-bcd3-c0f7aef446e9', 'Whangarei',    null),       -- Whangarei         [active order]
  ('c865b450-e905-42df-b301-85f0cfdbb961', 'Auckland',     null)        -- Wyndham Street     [HAND-SET: junk token; active order]
) as v(id, city, postal_code)
where s.id = v.id::uuid
  and s.city is null;   -- idempotency guard: re-running is a no-op
```

Expected: `UPDATE 61`.

- [ ] **Step 4: Verify the coverage counts**

Run via `mcp__supabase__execute_sql`:

```sql
select
  count(*) as total_stores,
  count(*) filter (where city is not null) as have_city,
  count(*) filter (where city is null and address is not null) as blocked_with_address,
  count(*) filter (where city is not null and address is null) as city_no_address
from stores;
```

Expected (before → after): `total_stores` 103 → 103; `have_city` 40 → **101**; `blocked_with_address` 63 → **2** (only the two swapped rows remain, by design); `city_no_address` 1 → 1.

- [ ] **Step 5: Spot-check the actively-ordered stores now clear the gate**

Run via `mcp__supabase__execute_sql`:

```sql
with order_stores as (
  select distinct q.ship_to_store_id as store_id
  from orders o
  join quotes q on q.id = o.quote_id
  where q.ship_to_store_id is not null
)
select s.name, s.city, (s.city is not null) as clears_gate
from order_stores os
join stores s on s.id = os.store_id
order by clears_gate, s.name;
```

Expected: **all 10** order-shipped stores now have `clears_gate = true` — including the six previously blocked on city (Burnside → Christchurch, Ferrymead → Christchurch, Invercargill → Invercargill, Westgate → Auckland, Whangarei → Whangarei, Wyndham Street → Auckland).

- [ ] **Step 6: Record the backfill in memory (no git commit — pure data)**

Update `[[starshipit-store-address-city-gate]]` and the epic `[[starshipit-order-push-epic]]` to note the 61-row backfill APPLIED to prod on 2026-08-07, counts verified (`have_city` 40→101), and that the `_backfill_stores_city_20260807` snapshot table exists for rollback until sign-off.

**Rollback (if needed):** restore every touched row from the snapshot, then drop it:

```sql
update stores s
set city = b.city, postal_code = b.postal_code
from _backfill_stores_city_20260807 b
where b.id = s.id;

drop table _backfill_stores_city_20260807;
```

(All 61 rows had `city IS NULL` and `postal_code IS NULL` beforehand, so the restore returns them exactly to their prior state.)

---

### Task 2: Relax the push gate to street-only for store shipments (code — TDD)

The one behavioural change: a store shipment carrying a street (blob) but no `city` becomes eligible; custom addresses are unchanged.

**Files:**
- Modify: `lib/starshipit/push-order.ts:66-67` (the `hasDeliveryAddress` computation)
- Test: `lib/starshipit/__tests__/push-order.test.ts` (add fixtures + one test)

**Interfaces:**
- Consumes: `isStoreShipment(raw: Record<string, unknown> | null): boolean` from `./destination` — **already imported** at `push-order.ts:10` (`import { isStoreShipment, loadOrdererName, resolveStarshipitDestination } from './destination'`). No new import.
- Produces: no new exported symbol. Runtime effect only: `pushOrderToStarshipit` now treats a store shipment with `street && !city` as eligible instead of skipping it with `reason: 'no_address'`.

- [ ] **Step 1: Add the store fixture and the failing test**

In `lib/starshipit/__tests__/push-order.test.ts`, add these fixtures right after the existing `storeArgs` (ends at line 64):

```ts
// A store snapshot whose locality was flattened into the address blob — street
// fills from the blob (normalize: street ?? address ?? line1), city stays null.
// This is the exact gate trap this bucket fixes.
const blockedStoreArgs = {
  ...baseArgs,
  shippingAddress: {
    id: 'store-ferrymead',
    name: 'Anytime Fitness Ferrymead',
    address: '1105 Ferry Road, Ferrymead, Christchurch',
    country: 'New Zealand',
  },
}
```

Then add this test inside the `describe('pushOrderToStarshipit', …)` block (e.g. after the existing `store order: falls back to the branch name …` test, before the closing `})` at line 174):

```ts
it('store order with a street blob but no city column now pushes (gate relaxed)', async () => {
  createMock.mockResolvedValue('987')
  const { admin } = makeAdmin()
  const r = await pushOrderToStarshipit(admin, blockedStoreArgs)
  expect(r).toEqual({ status: 'pushed', reason: 'ok', starshipitOrderId: '987' })
  expect(createStarshipitOrder).toHaveBeenCalled()
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/starshipit/__tests__/push-order.test.ts -t "gate relaxed"`
Expected: **FAIL** — under the current `Boolean(address?.street && address?.city)` gate, `city` is undefined, so the order is skipped with `{ status: 'skipped', reason: 'no_address' }` and `createStarshipitOrder` is never called.

- [ ] **Step 3: Implement the gate relax**

In `lib/starshipit/push-order.ts`, replace lines 66-67:

```ts
  const address = normalizeShippingAddress(args.shippingAddress)
  const hasDeliveryAddress = Boolean(address?.street && address?.city)
```

with:

```ts
  const address = normalizeShippingAddress(args.shippingAddress)
  // Store snapshots carry the full locality in the street blob even when the
  // city column is blank, so a street alone is a shippable store address.
  // Custom (customer-typed) addresses still require city — an incomplete
  // customer address is genuinely not deliverable.
  const hasDeliveryAddress = isStoreShipment(args.shippingAddress)
    ? Boolean(address?.street)
    : Boolean(address?.street && address?.city)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/starshipit/__tests__/push-order.test.ts -t "gate relaxed"`
Expected: **PASS**.

- [ ] **Step 5: Run the full Starshipit suite + typecheck (no regressions)**

Run: `npx vitest run lib/starshipit`
Expected: all Starshipit tests PASS (the existing `push-order.test.ts` cases — already-pushed, not_stock_on_hand, disabled, store company/name, custom name — stay green).

Run: `npx tsc --noEmit`
Expected: 14 errors, unchanged, none in `lib/starshipit/*`.

- [ ] **Step 6: Commit**

```bash
git add lib/starshipit/push-order.ts lib/starshipit/__tests__/push-order.test.ts
git commit -m "$(cat <<'EOF'
feat(starshipit): relax push gate to street-only for store shipments

Store snapshots carry the full locality in the street blob even when the
city column is blank (flattened by the old bulk importer), so a street
alone is a shippable store address. Custom addresses still require city.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Regression guards — custom + street-less store addresses still skip (test-only)

Lock in the two behaviours the relax must NOT change: a custom address missing its city stays non-shippable, and a store with neither street nor city stays non-shippable. These pass immediately against the Task 2 implementation — they are guards against future regressions (mirrors the packing-slip bucket's test-only client guard).

**Files:**
- Test: `lib/starshipit/__tests__/push-order.test.ts` (add 2 fixtures + 2 tests)

**Interfaces:** none new — pure characterization of `pushOrderToStarshipit` eligibility.

- [ ] **Step 1: Add the two guard fixtures**

In `lib/starshipit/__tests__/push-order.test.ts`, add after the `blockedStoreArgs` fixture from Task 2:

```ts
// A customer-typed address missing the city — genuinely not deliverable.
const customNoCityArgs = {
  ...baseArgs,
  shippingAddress: { name: 'Jane Doe', street: '12 Example St', country: 'New Zealand' },
}

// A store snapshot with neither a street/blob nor a city — nothing to ship to.
const storeNoStreetArgs = {
  ...baseArgs,
  shippingAddress: { id: 'store-empty', name: 'Anytime Fitness Nowhere', country: 'New Zealand' },
}
```

- [ ] **Step 2: Add the two guard tests**

Inside the `describe('pushOrderToStarshipit', …)` block, after the Task 2 test:

```ts
it('custom address with a street but no city is still skipped (no_address)', async () => {
  const { admin } = makeAdmin()
  const r = await pushOrderToStarshipit(admin, customNoCityArgs)
  expect(r).toEqual({ status: 'skipped', reason: 'no_address' })
  expect(createStarshipitOrder).not.toHaveBeenCalled()
})

it('store order with neither a street blob nor a city is still skipped (no_address)', async () => {
  const { admin } = makeAdmin()
  const r = await pushOrderToStarshipit(admin, storeNoStreetArgs)
  expect(r).toEqual({ status: 'skipped', reason: 'no_address' })
  expect(createStarshipitOrder).not.toHaveBeenCalled()
})
```

- [ ] **Step 3: Run the guards to verify they pass**

Run: `npx vitest run lib/starshipit/__tests__/push-order.test.ts -t "still skipped"`
Expected: **both PASS** — `customNoCityArgs` has no store `id` so `isStoreShipment` is false and the `street && city` branch skips it; `storeNoStreetArgs` is a store but `address?.street` is undefined so the store branch also skips it.

- [ ] **Step 4: Run the full suite to confirm the baseline**

Run: `npx vitest run`
Expected: green except the 4 documented pre-existing failures (OrdersTable fulfilment badge ×2, TeamClient.branch / MemberBranchGrants ×2). No new failures.

- [ ] **Step 5: Commit**

```bash
git add lib/starshipit/__tests__/push-order.test.ts
git commit -m "$(cat <<'EOF'
test(starshipit): guard custom + street-less store addresses still skip

Regression guards so the store-shipment gate relax never leaks to custom
addresses or to a store snapshot with no shippable street.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Rollout & smoke (post-plan, HITL — not a plan task)

Per spec §7. Order: **backfill already applied (Task 1) → merge/deploy the gate-relax branch.**

1. **Merge order:** merge `feat/starshipit-packing-slip-content` first (or together), then `feat/starshipit-store-address-gate` — the relax imports `isStoreShipment` from the packing-slip branch.
2. **Deploy:** same `STARSHIPIT_ENABLED` flag; no env/migration step.
3. **Smoke:** place one stock-on-hand store order to a previously-blocked branch (e.g. **Anytime Fitness Ferrymead**) and confirm it lands in the Starshipit **Unshipped** queue with `city` populated (Christchurch, from Task 1) and the branch as company / orderer as recipient (the packing-slip fix).
4. **Rollback:** gate relax = revert the branch/deploy; backfill = restore from the `_backfill_stores_city_20260807` snapshot (Task 1 rollback block). Both independent.

## Non-goals (carried from spec §8)

Country backfill; fixing the Newmarket/New Plymouth address swap (flagged for staff); a reusable parser/backfill script; relaxing the gate for custom addresses; splitting the blob into structured street/suburb; any change to eligibility, idempotency, triggers, audit, the client payload shape, or the inbound webhook.

## Spec-coverage self-check

- Spec §4 Lever 1 (backfill, parse rule, outliers, application, verification, rollback, degradation) → **Task 1** (61-row `UPDATE`, snapshot rollback, count + spot-check verification; the 5 special rows and 2 exclusions carried verbatim).
- Spec §5 Lever 2 (gate relax, `isStoreShipment`, both push paths, eligibility untouched) → **Task 2** (single edit at `push-order.ts:66-67`; both `submit.ts` placement and the `production_complete` bridge funnel through `pushOrderToStarshipit`, so both inherit it).
- Spec §6 test strategy (store-street-no-city pushes; custom-no-city skips; store-neither skips; existing cases green) → **Task 2 Step 1** + **Task 3**.
- Spec §7 rollout/smoke, §8 non-goals → the two sections above.
- Spec §B5 sequencing (backfill first) → Task 1 precedes Tasks 2–3 and the deploy.
