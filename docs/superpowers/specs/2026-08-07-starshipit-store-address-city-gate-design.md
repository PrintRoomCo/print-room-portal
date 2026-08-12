# Starshipit store-address / city gate — design spec

**Date:** 2026-08-07
**Repos:** `print-room-portal` (all code + the data backfill). No schema change, no new env var, no staff-portal change.
**Status:** Design — approved 2026-08-07, awaiting spec review
**Branch:** `feat/starshipit-store-address-gate` (off `feat/starshipit-packing-slip-content`)
**Builds on / depends on:** `docs/superpowers/specs/2026-08-07-starshipit-packing-slip-content-design.md`. The gate-relax below imports `isStoreShipment` from `lib/starshipit/destination.ts`, which ships on the packing-slip branch. **Merge-order dependency: this bucket must merge after — or together with — the packing-slip branch.**

This is **Appendix A** of the packing-slip spec, promoted to its own bucket. It is what actually unblocks store-order **volume** through Starshipit — the packing-slip bucket made the slip *complete*; this one makes the order *push at all*.

---

## 1. Goal (one sentence)

Stop silently dropping store orders at the Starshipit push gate — backfill the missing `city` on store rows, and relax the gate to require only a street for store shipments — without changing eligibility, idempotency, triggers, or the custom-address path.

## 2. The problem (verified live 2026-08-07)

The push gate is `hasDeliveryAddress = Boolean(address?.street && address?.city)` (`lib/starshipit/push-order.ts:66-67`); eligibility returns `no_address` and **silently skips** when it is false. `normalizeShippingAddress` fills `street` from the store's `address` blob as a fallback (`street ?? address ?? line1`) but fills `city` **only** from a real `city` column (`lib/checkout/shipping-address.ts:28,31`). The checkout store snapshot selects `id, name, address, city, state, country, postal_code` (`lib/checkout/submit.ts:549-554`). So a store whose locality was flattened into the single `address` blob by the old bulk CSV importer gets `street` but **no `city`** → the order never pushes, with no error surfaced.

**Impact (prod `stores`, 103 rows):**

| Signal | Count | |
|---|---|---|
| Total stores | 103 | |
| Have `address` blob | 102 | |
| Have `city` | **40** | rest fail the gate |
| **Blocked by the gate** | **64 (62%)** | 63 have address-but-no-city; 1 has city-but-no-address |
| Of the 10 stores real placed orders ship to | **only 3 clear** | 6 blocked on city, 1 on street |

**Recoverability:** the `address` blobs are comma-delimited with the **city as the last non-country segment**. Simulated parse over the 63 blocked-with-address stores: **62 yield a city (98%)**; 58 are fully clean, 5 are outliers handled explicitly (§4.2).

## 3. Decisions locked (from brainstorming 2026-08-07)

| # | Decision | Value |
|---|---|---|
| B1 | **Backfill mechanism** | **Reviewed explicit `UPDATE`.** Compute the full 63-row `city`/`postal_code` mapping, review the table, apply via Supabase MCP as one auditable `UPDATE … FROM (VALUES …)`. No runnable script, no throwaway parser code — the importer is already fixed going forward, so a one-shot reviewed statement is proportionate. |
| B2 | **Fields touched** | `city` (always — unblocks the gate) + `postal_code` where a clean trailing 4-digit code sits in the blob. **`country` untouched** (not in the gate; carries the NZ-vs-AUS default question owned by the picking-fee work). |
| B3 | **Backfill scope** | `WHERE city IS NULL AND address IS NOT NULL`. Idempotent, re-runnable, touches only the 63 blocked rows. `postal_code` set only where currently null. |
| B4 | **Gate relax** | Relax to **street-only for STORE shipments**; custom (customer-typed) addresses keep `street && city`. Reuse `isStoreShipment(rawAddress)` from `lib/starshipit/destination.ts`. `lib/starshipit/eligibility.ts` untouched. |
| B5 | **Sequencing** | Backfill **first**, then gate relax — so when the relax ships, the 6 active blocked stores already carry real cities rather than leaning on the fallback. |

## 4. Lever 1 — the `city` + `postal_code` backfill

### 4.1 Parse rule

For each store with `city IS NULL AND address IS NOT NULL`:
1. Strip a trailing country token from `address`: `,\s*(New Zealand|NZ|Aotearoa)\s*$` (case-insensitive).
2. `last_seg` = the final comma-separated segment (or the whole string if there is no comma).
3. Peel a trailing 4-digit NZ postcode off `last_seg`: if it matches `(\d{4})\s*$`, that is the `postal_code` candidate and it is removed from the city.
4. `city` = the cleaned `last_seg`.
5. `postal_code` is written **only where currently null**.

### 4.2 Outliers — hand-set / flagged in the reviewed table

58 of 63 parse cleanly. The 5 exceptions (the reason B1 chose an eyeballed explicit `UPDATE` over a blind regex):

| Store | `address` blob | Action |
|---|---|---|
| Anytime Fitness Wyndham Street | `66 Wyndham Street, Auckland CB2:B59BD` | hand-set `city='Auckland'` (drop junk token) |
| Anytime Fitness Richmond | `Tenancy 1 4 Champion Road Richmond 7020` (no comma) | hand-set `city='Richmond'`, `postal_code='7020'` |
| Anytime Fitness St Johns | `261 Morrin Road, St Johns Auckland` | hand-set `city='Auckland'` (space-joined suburb+city) |
| Anytime Fitness Newmarket | `7 Struthers Place, New Plymouth` | ⚠️ **flag only — address appears swapped** with the New Plymouth store; left for staff to correct address + city together, **not auto-filled** |
| Anytime Fitness New Plymouth | `2 Gillies Avenue, Newmarket, Auckland` | ⚠️ **flag only — same swap**, not auto-filled |

The two swapped rows are **excluded from the backfill** (their `city` stays null) and surfaced to Jon; auto-filling them would ship to the wrong city, which is worse than continuing to skip them.

### 4.3 Application & verification

- Applied via Supabase MCP `execute_sql` as one `UPDATE stores SET city = v.city, postal_code = COALESCE(stores.postal_code, v.postal_code) FROM (VALUES …) AS v(id, city, postal_code) WHERE stores.id = v.id` after Jon reviews the full mapping.
- The `VALUES` list is captured in the implementation plan (61 rows: 58 clean + 3 hand-set; the 2 swapped rows omitted), each keyed by store `id`.
- **Verification:** re-run the coverage query — `has_city` 40 → ~101 (103 − 2 swapped); confirm the 6 active blocked stores now clear `street && city`.
- **Rollback:** all 61 target rows had `city IS NULL` before, so a revert is a targeted `UPDATE stores SET city = NULL, postal_code = NULL WHERE id IN (…)` over the captured id list. (postal_code revert only for the ids where we set it.)

### 4.4 Degradation / safety

The backfill only ever fills previously-null fields, on a bounded, reviewed id list. It cannot change an address that already has a city, cannot touch country, and re-running is a no-op (the `WHERE city IS NULL` no longer matches). No order state is touched.

## 5. Lever 2 — relax the gate for store shipments

A single change in `push-order.ts` where `hasDeliveryAddress` is computed, reusing the existing store discriminator:

```ts
// Store snapshots carry the full locality in the street blob even when the
// city column is blank, so a street alone is a shippable store address.
// Custom (customer-typed) addresses still require city — an incomplete
// customer address is genuinely not deliverable.
const hasDeliveryAddress = isStoreShipment(args.shippingAddress)
  ? Boolean(address?.street)
  : Boolean(address?.street && address?.city)
```

- `isStoreShipment` is imported from `lib/starshipit/destination.ts` (already present on the branch this one forks from).
- `lib/starshipit/eligibility.ts` is **untouched** — it still receives a single `hasDeliveryAddress` boolean and returns `no_address` when false.
- Both push paths (placement in `submit.ts`, the Monday `production_complete` bridge) funnel through `pushOrderToStarshipit`, so both inherit the relax.
- **Interaction with Lever 1:** after the backfill, 62/63 blocked stores clear on `city` anyway; the relax is defence-in-depth for the residual (the 1 comma-less store, the 2 flagged swaps, and any future dirty import) so we never silently drop a store order again.

## 6. Test strategy (TDD — write tests first)

Lever 2 is the only code; the backfill is data (proven by the reviewed table + before/after counts, not a unit test).

**`push-order.test.ts` (add, do not rewrite existing):**
- Store order (raw address carries `id`) with `street` but **no `city`** → **pushes** (previously skipped). Assert `createStarshipitOrder` called.
- Custom order (no `id`) with `street` but no `city` → **still skipped**, reason `no_address`. Assert `createStarshipitOrder` not called.
- Store order with **neither** street nor city → still skipped (`no_address`).
- Existing cases (already-pushed, not_stock_on_hand, disabled, the store/custom company+name cases from the packing-slip bucket) stay green.

**Baseline:** full suite stays at its documented pass count with only the same 4 pre-existing failures (OrdersTable fulfilment badge ×2, TeamClient.branch/MemberBranchGrants ×2); `tsc` stays at 14 errors, none in `lib/starshipit/*`.

## 7. Rollout & safety

- No migration, no env var, no staff-portal change. Same `STARSHIPIT_ENABLED` flag.
- **Order:** apply the reviewed backfill via MCP (Lever 1) → then merge/deploy the gate-relax branch (Lever 2). Backfill is independent of the deploy and can land first.
- **Smoke:** after both, place one stock-on-hand store order to a previously-blocked branch (e.g. Anytime Fitness Ferrymead) and confirm it lands in the Starshipit Unshipped queue with `city` populated and the branch as company / orderer as recipient (the packing-slip fix).
- **Rollback:** gate-relax = revert the branch; backfill = the targeted null-restore in §4.3. Both independent.

## 8. Non-goals (YAGNI)

- **Country backfill** — separate NZ-vs-AUS default decision (owned by the picking-fee store-country work); not in the gate, so not needed here.
- **The Newmarket / New Plymouth address swap** — flagged for staff correction, not auto-fixed.
- **A reusable parser / backfill script** — one-shot reviewed `UPDATE` is proportionate; the importer that caused this is already fixed on `feat/bulk-upload-org-location-template`.
- **Relaxing the gate for custom addresses** — an incomplete customer-typed address stays non-shippable.
- **Splitting the `address` blob into structured street/suburb** — out of scope; only `city`/`postal_code` are extracted.
- **Any change to eligibility, idempotency, triggers, audit, the client payload shape, or the inbound webhook.**
