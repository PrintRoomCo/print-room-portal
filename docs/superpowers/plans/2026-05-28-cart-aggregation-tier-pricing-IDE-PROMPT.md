# Cart aggregation tier pricing — IDE Prompt (Subagent-Driven)

> **Read first:** `docs/superpowers/specs/2026-05-28-cart-aggregation-tier-pricing-spec.md` is the source of truth for the aggregation rule + every edge case. If a question isn't answered there, **surface to Jamie before coding** — don't guess.

## What you're doing

Three fixes + one sweep, all in `print-room-portal` (customer repo), on a fresh branch `fix/cart-tier-aggregation` off latest `master`. No worktrees. Commits frequent, push branch, **no PR** — Jamie merges.

## Why this exists

Cart pricing is half-aggregated today. Decorations re-tier on aggregate cart qty (because `/api/shop/decoration-pricing` populates brackets at all canonical breakpoints) but garment doesn't (because the PDP reads brackets from the legacy `b2b_catalogue_item_pricing_tiers` table directly — empty for any product on the markup ladder). Symptom: 25-unit line + 1000-unit line of the same Staple Tee shows $15.46/unit on the 25-line ($12.74 garment qty-25 + $2.72 decoration qty-1000) when it should show $10.64/unit ($7.92 garment qty-1000 + $2.72 decoration qty-1000). PDP standalone qty 25 is $24.61 (correct for standalone). Cart aggregate qty 1025 should be $10.64 (correct for aggregated). $15.46 is neither.

Aggregation key also needs tightening — current `recomputeProductTierPrices` pools by `productId` alone. Per Jamie's commercial rule + the spec, it should pool by `(product_id, decoration_signature)` so different decoration methods on the same product don't share tier bands.

## Read order

1. `docs/superpowers/specs/2026-05-28-cart-aggregation-tier-pricing-spec.md` — **mandatory**. Don't start without it.
2. `lib/cart/types.ts` — existing helpers, especially `recomputeProductTierPrices` (lines 151-181), `decorationSignature` (lines 98-105), `pickBracket` (lines 128-138).
3. `lib/cart/__tests__/types.test.ts` — existing test shape; mirror it.
4. `app/(portal)/catalogue/[productId]/page.tsx` — current PDP brackets query (lines 103-108). This is where Bug 1 lives.
5. `lib/checkout/submit.ts` — drift guard (search for `UnitPriceDriftError`). Per-line recompute that needs to learn aggregation.
6. `app/api/shop/decoration-pricing/route.ts` — reference for the RPC + tier-multiplier pattern. Don't change this file.
7. Memory `feedback_no_worktrees_by_default`, `feedback_best_data_modelling`, `project_b2b_pricing_canonical` — durable rules.

## Locked decisions (from the spec — don't re-litigate)

1. **Aggregation key = `${product_id}::${decorationSignature(decorations)}`**. Variant + fulfilment type are NOT part of the key.
2. **Same product, different decoration methods/artworks/placements → don't aggregate.** Signatures must be byte-identical.
3. **Different products → never aggregate**, even with same artwork. Engine setup amortization across products is v2.
4. **Decoration with `brackets: undefined`** (heatpress, DTF, leavers, legacy) stays frozen at snapshot. No re-tier.
5. **No UI pill, no banner.** The number on the line speaks. Per `feedback_include_jon_via_questions` Jamie keeps cart UX quiet.
6. **Server drift guard mirrors the cart aggregation exactly.** No tolerance widening; truth-by-construction.
7. **Canonical breakpoints for garment brackets** = `[1, 24, 50, 100, 250, 500, 1000]`. Same set used by `/api/shop/decoration-pricing` for symmetry.
8. **Sweep target** = anywhere reading `b2b_catalogue_item_pricing_tiers.unit_price` for customer-facing pricing display. Staff editor pages that mutate that table directly are out of scope (different concern).

## Tasks

Plan executes in 4 sequential tasks. Each task: read, change, test, commit, push.

### Task 1 — PDP brackets via `effective_unit_price` RPC

**Files:**
- Modify: `app/(portal)/catalogue/[productId]/page.tsx`

**Steps:**

1. Locate the `bracketsQuery` block (around lines 103-108):

```ts
const bracketsQuery = admin
  .from('b2b_catalogue_item_pricing_tiers')
  .select('min_quantity, max_quantity, unit_price')
  .eq('catalogue_item_id', catItem.id)
  .order('min_quantity')
```

2. Replace it with N parallel RPC calls at the canonical breakpoints. Build the brackets array from the RPC results, collapsing adjacent buckets with identical prices into a single band, with the tail band running to `max_quantity: null`.

Reference pattern: see `buildDecorationBrackets` at `components/shop/ProductDetailClient.tsx:499-522` for the collapse logic — adapt the shape for garment.

Sketch:

```ts
const CANONICAL_BREAKPOINTS = [1, 24, 50, 100, 250, 500, 1000] as const

const bracketsQuery = (async () => {
  const probes = await Promise.all(
    CANONICAL_BREAKPOINTS.map(async (qty) => {
      const { data, error } = await admin.rpc('effective_unit_price', {
        p_product_id: product.id,
        p_org_id: context.organizationId,
        p_qty: qty,
      })
      return { qty, price: error || data == null ? null : Number(data) }
    })
  )
  const points = probes.filter((p): p is { qty: number; price: number } => p.price != null)
  if (points.length === 0) return { data: [] }
  const bands: Array<{ min_quantity: number; max_quantity: number | null; unit_price: number }> = []
  for (let i = 0; i < points.length; i++) {
    const cur = points[i]
    if (bands.length > 0 && bands[bands.length - 1].unit_price === cur.price) continue
    const next = points[i + 1]
    bands.push({
      min_quantity: cur.qty,
      max_quantity: next ? next.qty - 1 : null,
      unit_price: cur.price,
    })
  }
  return { data: bands }
})()
```

Verify `product.id` and `context.organizationId` are in scope at this point in the file. Adjust naming if local conventions differ.

3. Confirm downstream `brackets` consumers still see the same shape (`{ min_quantity, max_quantity, unit_price }`). The downstream destructure at the bottom of the page (`bracketRows`) should keep working unchanged.

4. **Verification SQL (run via Supabase MCP after change):** for TPRC's Staple Tee, the bracket bands should now show `[1=$6.89, 24=$12.74, 50=$11.36, 100=$10.34, 250=$9.64, 500=$8.27, 1000=$7.92]` (markup ladder × Tier 1 0.95). For PRT's Staple Tee, bracket bands should show the manual-ladder values × 0.95 (`$11.40` at qty 1000-2499, `$12.35` at 500-999, etc.). The manual ladder still wins inside `effective_unit_price`.

5. tsc + vitest + commit:

```bash
npx tsc --noEmit
npx vitest run
git add app/'(portal)'/catalogue/'[productId]'/page.tsx
git commit -m "fix(pdp): source garment brackets from effective_unit_price RPC, not manual-ladder table"
```

### Task 2 — Aggregation key change in `recomputeProductTierPrices`

**Files:**
- Modify: `lib/cart/types.ts`
- Modify: `lib/cart/__tests__/types.test.ts`

**Steps:**

1. Open `lib/cart/__tests__/types.test.ts`. Read existing structure. Add failing test cases for each scenario in the spec's edge-case table:
   - same product different decorations don't aggregate
   - same product same signature different variantLabel aggregate
   - same product same signature different fulfilmentType aggregate
   - multi-decoration combos byte-identical match aggregate
   - garment-only lines (empty signature) aggregate with each other
   - different products never aggregate even with same signature
   - decoration with `brackets: undefined` stays frozen
   - aggregate qty crosses tier boundary mid-mutation re-tiers correctly
   - removing a line drops the survivors back to the lower tier

Run vitest; verify new tests fail.

2. Open `lib/cart/types.ts`. In `recomputeProductTierPrices` (line 151), change the aggregation key:

```ts
// Current:
const totalByProduct = new Map<string, number>()
for (const l of lines) {
  totalByProduct.set(l.productId, (totalByProduct.get(l.productId) ?? 0) + l.qty)
}
return lines.map((l) => {
  const total = totalByProduct.get(l.productId) ?? l.qty
  ...
})

// New:
const aggKey = (l: CartLine) => `${l.productId}::${decorationSignature(l.decorations)}`
const totalByKey = new Map<string, number>()
for (const l of lines) {
  const k = aggKey(l)
  totalByKey.set(k, (totalByKey.get(k) ?? 0) + l.qty)
}
return lines.map((l) => {
  const total = totalByKey.get(aggKey(l)) ?? l.qty
  ...
})
```

3. Update the JSDoc on `recomputeProductTierPrices` to describe the new key:

```ts
/**
 * Recompute every line's unitPrice against the qty SUM across every line that
 * shares both productId AND decorationSignature. Same product with different
 * decoration sets do not pool; same product same signature with different
 * variant or fulfilmentType DO pool. Mirrors the server-side recompute in
 * lib/checkout/submit.ts so cart display matches what submit will recompute.
 *
 * Called after every cart mutation (add merge / update / remove) so editing
 * one line correctly re-tiers every same-signature line. No-op on lines that
 * have no brackets snapshot (legacy) or whose total qty falls outside every
 * bracket.
 */
```

4. Run vitest again. All new tests pass; existing tests still pass.

5. tsc + commit:

```bash
npx tsc --noEmit
git add lib/cart/types.ts lib/cart/__tests__/types.test.ts
git commit -m "fix(cart): aggregate tier qty by (productId, decorationSignature) not productId alone"
```

### Task 3 — Server drift guard mirrors aggregation

**Files:**
- Modify: `lib/checkout/submit.ts`

**Steps:**

1. Read the whole file (`lib/checkout/submit.ts`) before touching anything. The drift guard logic and the per-line recompute live there. Identify the loop that calls `effective_unit_price` / `effective_decoration_unit_price` per line.

2. Refactor: before the per-line loop, build the aggregation map:

```ts
function aggregateSubmittedLines(lines: SubmittedLine[]): Map<string, number> {
  const totals = new Map<string, number>()
  for (const l of lines) {
    const sigParts = l.decorations
      .map((d) => d.linkId)
      .slice()
      .sort()
      .join('|')
    const key = `${l.productId}::${sigParts}`
    totals.set(key, (totals.get(key) ?? 0) + l.qty)
  }
  return totals
}
```

Reuse `decorationSignature` from `lib/cart/types.ts` if it's already importable in the submit context (it should be — both ship in the customer bundle). Don't duplicate the helper.

3. In the per-line recompute, swap `l.qty` for `aggregateQty(l)` when looking up tier bands via `effective_unit_price` and `effective_decoration_unit_price`:

```ts
const aggMap = aggregateSubmittedLines(lines)
const aggKey = (l: SubmittedLine) => `${l.productId}::${decorationSignature(l.decorations)}`

for (const line of lines) {
  const tierQty = aggMap.get(aggKey(line)) ?? line.qty
  const expectedGarment = await admin.rpc('effective_unit_price', {
    p_product_id: line.productId,
    p_org_id: input.context.organizationId,
    p_qty: tierQty,
  })
  // ...and same for each decoration via effective_decoration_unit_price(deco_id, tierQty) × tierMult
}
```

The line's `qty` is still used for `line_total` and for inventory deduction. Only the BAND LOOKUP changes.

4. **Critical**: `UnitPriceDriftError` comparison must use the same rounding rule as the cart. Both call the SQL RPCs, which return rounded numerics, so this should be fine — but write a unit test that submits a multi-line same-signature payload and confirms no drift error.

5. tsc + vitest + commit:

```bash
npx tsc --noEmit
npx vitest run lib/checkout
git add lib/checkout/submit.ts
git commit -m "fix(checkout): drift guard aggregates by (product_id, decoration_signature) to match cart"
```

### Task 4 — Sweep for direct `b2b_catalogue_item_pricing_tiers` reads

**Steps:**

1. Grep for any remaining direct reads of the manual-ladder table in customer-facing code:

```bash
# from print-room-portal/
grep -rn "b2b_catalogue_item_pricing_tiers" app/ lib/ components/ 2>/dev/null
```

2. For each hit:
   - Customer-facing display path → replace with `effective_unit_price` RPC. Same canonical breakpoints as Task 1.
   - Internal-only (audit, debugging, staff console proxy) → leave with a `// audit-only` comment.
   - Test fixtures → leave.

3. The catalogue card (`app/(portal)/catalogue/page.tsx`) was already migrated in Task 3.5 (commit `978aed4`); spot-check that one still doesn't read the table.

4. If any non-trivial display surface is migrated in this sweep, add a brief test or smoke note.

5. tsc + vitest + commit per surface migrated:

```bash
git add ...
git commit -m "fix(<surface>): use effective_unit_price RPC instead of direct manual-ladder read"
```

6. Push branch:

```bash
git push -u origin fix/cart-tier-aggregation
```

## Verification (before claiming done)

1. **Live cart smoke** with Supabase MCP — Jamie may do this in browser, but agent should at least confirm via SQL:
   - `effective_unit_price` for Staple Tee + TPRC at qtys `[1, 24, 50, 100, 250, 500, 1000]` returns expected values
   - Cart aggregation logic test from Task 2 passes with realistic data

2. **`npx tsc --noEmit`** — clean.
3. **`npx vitest run`** — no NEW failures vs the customer-portal baseline (101 passing pre-sprint per sprint doc).
4. **`npx next build`** — clean.
5. **Branch pushed**, NO PR opened.

## Hand-off message to Jamie (under 200 words)

When done, surface to Jamie with:

1. Branch URL: `https://github.com/PrintRoomCo/print-room-portal/tree/fix/cart-tier-aggregation`
2. The four commits in order
3. SQL smoke output (PRT and TPRC Staple Tee bracket arrays)
4. New vitest count
5. Anything that diverged from the spec — with explanation
6. **Jamie's manual smoke** the agent can't do:
   - Add Staple Tee × 25 BONE/XS to cart on TPRC
   - Add Staple Tee × 1000 BONE/2XL to cart
   - Confirm both lines show $10.64/unit (not $15.46 / $10.64)
   - Edit qty 1000 → 50 in cart, confirm both lines drop to qty-50 band
   - Remove the larger line, confirm survivor drops to qty-25 band ($24.61)
   - Submit the order (sandbox if available) — confirm NO `UnitPriceDriftError`

## Workflow constraints (durable, non-negotiable)

- Branch: `fix/cart-tier-aggregation` off latest `master`. No worktrees.
- One commit per task per the plan. Frequent.
- Push branch, no PR. Jamie merges manually.
- OEM aesthetic — no UI changes in this sprint, but if any `.tsx` needs editing, pre-read `docs/ui/oem-rules.md` (if it exists in customer repo; otherwise read the staff repo version).
- No new dependencies either repo.
- No memory mutations — spec + plan + sprint doc are the durable record.
- Verification must be clean before claiming done.

## Acceptance criteria

All must hold:

1. Cart line 1 (Staple Tee × 25 + decoration) + line 2 (Staple Tee × 1000 + same decoration) on TPRC both show **$10.64/unit**.
2. Cart with same product but different decoration methods stays split — each at its own line's qty tier.
3. Cart with different products stays split — each at its own product's qty tier.
4. Removing a line re-tiers survivors immediately.
5. `submitCustomerOrder` doesn't false-positive on any spec scenario.
6. tsc + vitest + next build all clean.
7. Branch pushed; no PR opened.
8. Zero direct `b2b_catalogue_item_pricing_tiers.unit_price` reads in customer-facing display code.
