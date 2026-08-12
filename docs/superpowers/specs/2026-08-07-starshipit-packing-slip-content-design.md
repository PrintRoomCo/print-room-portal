# Starshipit packing-slip content — design spec

**Date:** 2026-08-07
**Repos:** `print-room-portal` (all code). No schema change, no staff-portal change.
**Status:** Design — awaiting review
**Builds on:** `docs/superpowers/specs/2026-08-06-starshipit-order-push-design.md` (the push is live in prod behind `STARSHIPIT_ENABLED=true`). This spec closes the two **packing-slip content** gaps found when reconciling the live push against Jamie Horsefield's "when it's working" note — it does **not** touch eligibility, idempotency, triggers, or the (still-dark) return path.

---

## 1. Goal (one sentence)

Make the printed Starshipit packing slip complete for a store order — a **SKU** on each line and the **branch as the company** with the **orderer as the recipient name** — without changing when or whether an order pushes.

## 2. Decisions locked (from brainstorming 2026-08-07)

| # | Decision | Value |
|---|---|---|
| A1 | **SKU source** | `products.sku` **only**, resolved per line via `quote_items.source_product_id`. No rebuilt/variant SKU, no `sku_suffix`, no `code`/`supplier_code` fallback. Lines with no `products.sku` ship with the SKU column blank (accepted). |
| A2 | **Company + name** | For a **store** shipment: `destination.company` = the branch/store name, `destination.name` = the orderer (`quotes.customer_name`). For a **custom-address** shipment: unchanged (company blank, name = typed recipient). |
| A3 | **Store-address data gap** | **Flag separately, do not fix here.** The ~60% of stores missing `city` (and the push gate that silently skips them) is captured in Appendix A as the recommended follow-up, not built in this bucket. |

## 3. Non-goals (explicit / YAGNI)

- No new SKU: if `products.sku` is empty there is genuinely no code anywhere for that line (verified — see §4), so nothing to fall back to. Filling those is staff data-entry, not code.
- No `product_variants.sku_suffix` — post-SKUCOLLAPSE it bakes in a **stale size** (one colourway-variant now spans up to 8 sizes) and would misprint.
- No company field added to the custom-address checkout form. `quotes.customer_company` is 0% populated and there is no reliable per-order company for a customer-typed address; leave it blank.
- No `phone` wiring (store phone 0% populated; `quotes.customer_phone` ~17%). Optional later, out of scope now.
- No change to `client.ts` payload shape, eligibility, idempotency, triggers, audit, or the inbound webhook. **Both existing push paths inherit the fix for free** because both funnel through `pushOrderToStarshipit`.
- **Not** the Starshipit **return path** (scan → fulfilled → tracking both sides → reduce committed stock). That is a separate, larger bucket with an unresolved double-count decision (Monday "dispatched" vs Starshipit scan) — tracked in `[[starshipit-order-push-epic]]`, not this spec.

## 4. Current state (verified 2026-08-07)

What the live push sends today (`lib/starshipit/client.ts`):

- `destination.name` = the raw address `name`. For a **store** order that is the **store name** (e.g. "Reburger Takapuna") — so the branch currently lands in the *recipient* field, and `destination.company` is **always blank**.
- Line items (`lib/starshipit/items.ts`) carry `description` + `quantity` + `value`, but **never `sku`** — the `StarshipitOrderItem.sku` field exists and is already forwarded by `client.ts`, it is simply never set. The slip's SKU column prints blank on every line.

Ground-truth population data (queried against real placed orders, shaped every decision above):

| Signal | Coverage | Verdict |
|---|---|---|
| `products.sku` via `quote_items.source_product_id` | **~70%** of lines | **Chosen SKU source (A1).** `source_product_id` is a clean `uuid` — the old "embed unverified" comment referred to the *other*, untyped-`text` `product_id` column. |
| `products.code` / `supplier_code` for the ~30% null-`sku` lines | **0 / 26** | No fallback exists — those lines (drinkware, bags) have no code anywhere. Confirms A1's "blank is accepted". |
| `b2b_catalogue_items.sku_override` | **0 / 87** | Dead column — discard. |
| `quotes.customer_name` | **100%** on placed | **Chosen recipient name (A2).** |
| `stores.name` | **100%** | **Chosen company (A2)** — already present in the raw address as `name`. |
| `quotes.customer_company` | **0%** | Dead — custom-address company stays blank. |
| `stores.manager_name` / `email` / `phone` | **0%** | Contact person cannot come from the store row — hence use `quotes.customer_name`. |
| Persisted `shipping_address` carries store `id` | store orders only | **Store-vs-custom discriminator (A2).** Verified: `submit.ts:551` snapshots `id, name, …` into the jsonb persisted at `:1302`; custom addresses carry no `id`. Both push paths (placement + Monday bridge) see it. |

## 5. Architecture

Two isolated changes plus wiring. `client.ts` is **untouched** — it already maps `address.company` → `destination.company`, `address.name` → `destination.name`, and forwards each item's optional `sku`. Everything below just fills those fields before the call.

### 5.1 SKU on line items (`lib/starshipit/items.ts`)

`products.sku` is resolved with a **deterministic second lookup**, not a PostgREST embed (the `source_product_id → products` FK is not guaranteed to exist for embedding).

- Add `source_product_id` to the `quote_items` select and to `StarshipitQuoteItemRow` (plus a resolved `sku?: string | null` the loader attaches).
- In `loadStarshipitOrderItems`, after the rows load: gather distinct non-null `source_product_id`s → `admin.from('products').select('id, sku').in('id', ids)` → build an `id → sku` map (trimmed, non-empty only) → attach each row's `sku`.
- `mapQuoteItemsToStarshipitItems` sets `item.sku` **only when** `row.sku` is a non-empty string; otherwise omits it (unchanged for `description`/`quantity`/`value`).

```ts
// loader (sketch)
const rows = data as StarshipitQuoteItemRow[]
const ids = [...new Set(rows.map(r => r.source_product_id).filter((x): x is string => !!x))]
let skuById = new Map<string, string>()
if (ids.length > 0) {
  const { data: prods } = await admin.from('products').select('id, sku').in('id', ids)
  for (const p of prods ?? []) {
    const sku = typeof p.sku === 'string' ? p.sku.trim() : ''
    if (sku) skuById.set(p.id as string, sku)
  }
}
return mapQuoteItemsToStarshipitItems(
  rows.map(r => ({ ...r, sku: r.source_product_id ? skuById.get(r.source_product_id) ?? null : null })),
)
```

**Degrade rules (unchanged invariant — enrichment never loses the push):**
- `quote_items` read fails → return `[]` (as today).
- `products` read fails → `skuById` empty → every line SKU-blank, push still carries descriptions. **Never throws.**
- Update the stale file-header comment (lines 6–10) to reflect that SKU now comes from `products.sku` via `source_product_id`.

### 5.2 Company + recipient name — new `lib/starshipit/destination.ts`

A small, pure-plus-loader module mirroring `items.ts`, so `push-order.ts` stays thin and the branch/orderer rule is unit-testable in isolation.

**Why detection reads the *raw* address, not the normalized one:** `normalizeShippingAddress` drops unknown keys — including the store `id` — so store-detection must key off the raw persisted jsonb. That is why the resolver takes both the normalized `address` (for the fields it sends) and `rawAddress` (for the `id` discriminator).

```ts
// True when the persisted address is a store snapshot (carries a store id).
export function isStoreShipment(raw: Record<string, unknown> | null): boolean {
  return typeof raw?.id === 'string' && raw.id.trim().length > 0
}

// Best-effort orderer name; null on error/empty (never throws).
export async function loadOrdererName(admin, quoteId): Promise<string | null> { … }

// Pure: apply the branch=company / orderer=name rule for store shipments.
export function resolveStarshipitDestination(args: {
  address: NormalizedShippingAddress          // from normalizeShippingAddress
  rawAddress: Record<string, unknown> | null
  ordererName: string | null
}): NormalizedShippingAddress {
  if (!isStoreShipment(args.rawAddress)) return args.address        // custom → unchanged
  return {
    ...args.address,
    company: args.address.name ?? args.address.company,             // branch → company
    name: args.ordererName ?? args.address.name,                    // orderer → name (fallback = branch)
  }
}
```

- **Store shipment:** company ← branch (the raw `name`, already cleaned into `address.name`); name ← `quotes.customer_name`. If the name lookup fails/empty, `name` falls back to the branch name — i.e. no worse than today, and company is still filled.
- **Custom shipment:** returned unchanged — company blank, name = typed recipient.
- **Safe degradation:** if a store order's snapshot somehow lacks `id`, it's treated as custom (today's exact behaviour) — the change can never *remove* information that's sent now.

### 5.3 Wiring (`lib/starshipit/push-order.ts`)

After eligibility passes and before `createStarshipitOrder`, enrich the destination. Gate the name lookup on `isStoreShipment` so custom orders (~20%) don't pay an extra round-trip.

```ts
const ordererName = isStoreShipment(args.shippingAddress)
  ? await loadOrdererName(admin, args.quoteId)
  : null
const destination = resolveStarshipitDestination({
  address: address!, rawAddress: args.shippingAddress, ordererName,
})
const items = await loadStarshipitOrderItems(admin, args.quoteId)
const starshipitOrderId = await createStarshipitOrder({
  orderNumber: args.orderRef, address: destination, customerEmail: args.customerEmail, items,
})
```

No signature changes to `pushOrderToStarshipit`; both callers (`submit.ts` placement step 5d, `push-on-production-complete.ts` bridge) are untouched and inherit the enrichment.

## 6. Data flow

```
placement (submit.ts)          Monday "All Production Complete" (bridge)
        \                                   /
         → pushOrderToStarshipit(admin, args)
             normalizeShippingAddress(raw)
             ├─ isStoreShipment(raw)?  ── yes ─→ loadOrdererName(quoteId)   [best-effort]
             ├─ resolveStarshipitDestination(address, raw, ordererName)     [branch=company, orderer=name]
             ├─ loadStarshipitOrderItems(quoteId)                           [+ products.sku via source_product_id]
             └─ createStarshipitOrder({ address: destination, items })      [client.ts UNCHANGED]
```

## 7. Test strategy (TDD — write tests first)

- **`items.ts`**
  - SKU attached when `products.sku` present; omitted when null/empty; `description`/`quantity`/`value` unchanged.
  - loader: distinct-id dedupe; `products` read error → all lines SKU-blank, no throw; `quote_items` error → `[]`.
- **`destination.ts`**
  - `isStoreShipment`: id present → true; missing/blank/non-string → false.
  - `resolveStarshipitDestination`: store → company=branch, name=orderer; store + null orderer → name falls back to branch, company still set; custom → returned unchanged.
  - `loadOrdererName`: returns trimmed name; error/empty → null (no throw).
- **`push-order.ts`**
  - store order → `createStarshipitOrder` receives company=branch, name=orderer, items carry sku (mock the two reads).
  - custom order → `loadOrdererName` **not** called; destination unchanged.
  - name-lookup failure → push still fires with fallback name.
- **`client.ts` (regression guard, no code change)**
  - payload includes `sku` when an item carries it, and `company`/`name` as given — extends the existing payload-shape test so a future refactor can't silently drop them.

Full suite + `tsc` must stay at the documented baseline (1263 pass; 4 pre-existing failures; 14 tsc errors — all unrelated).

## 8. Rollout & safety

- Same env flag (`STARSHIPIT_ENABLED`) — no new config, no migration, no staff-portal change.
- Purely additive to the payload; a store order that pushes today keeps pushing, just with company + SKU filled. Rollback = revert the branch (or unset the flag), nothing to unwind.
- Smoke after deploy: place one stock-on-hand store order, confirm the Starshipit ticket shows company = branch, recipient = orderer, and SKUs on the ~70% of lines that carry one.

## Appendix A — Flagged separately: store-address / city gate (NOT built here)

The push gate requires `address.street && address.city` (`push-order.ts:66`). Store rows are largely missing locality fields, so **most store orders are silently skipped today**:

- ~**60%** of `stores` have empty `city` (and `state`/`postal_code`) — a bulk CSV importer flattened those parts into the single `address` blob.
- Of the **10** stores real orders have shipped to, only **3** clear the `street && city` gate.
- `stores.location` cannot backfill `city` (0 overlap with real city values).
- `quotes.ship_to_store_id` is set on only 22/29 placed quotes, so it is not a reliable universal "store order" signal either — which is why §5.2 keys off the persisted address `id`, not this column.

This is a **data-cleanup ± gate-relaxation** decision of its own (split the `address` blob into `city`/`state`/`postal_code`, and/or relax the gate to require only `street` for store shipments). It is what actually unblocks store-order **volume** through Starshipit, and is the recommended next follow-up after this bucket. Numbers captured here so the follow-up starts from ground truth.
