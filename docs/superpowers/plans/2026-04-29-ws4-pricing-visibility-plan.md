# WS4 — Customer Pricing Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface tier discount + decoration breakdown to B2B customers across `/shop`, PDP, `/cart`, `/checkout` so they can read "why my total is $X" off the page. Provide a `<TierBadge />` primitive for WS5 to consume on the welcome page.

**Architecture:** Pure client-side surfacing of existing pricing data. No new tables, no new RPCs, no schema changes. A small `pricingMath` pure module computes gross/discount/GST/total from a tier-discount fraction and an effective-price input. A `usePricingContext()` client hook reads tier metadata from `getCompanyAccess()` (extended). Three primitive components (`TierBadge`, `DiscountLine`, `PriceBreakdown`) wire into existing surfaces. The 4-axis stack rationale lives in the spec — see `docs/superpowers/specs/2026-04-29-customer-pricing-visibility-design.md` §8.

**Tech Stack:** Next.js 16, React 19, Tailwind v3.4 (project still on v3 per `package.json`), TypeScript, Supabase (read-only — `price_tiers`, `b2b_accounts`, `b2b_catalogues` already exist). Brand tokens via `rgb(var(--color-brand-blue))` etc — additive so WS3's polish pass overlays cleanly.

**Repo:** `print-room-portal` only. No staff-portal touch — tier label config locked to `lib/pricing/tier-labels.ts` per spec §9.2.

**Next.js 16 caveat (per AGENTS.md):** server-only modules already isolate via `lib/checkout/server.ts`. New code in `lib/pricing/` is split into pure (env-agnostic) and client-only modules — no server-only deps imported into client primitives.

---

## Spec drift / edge case found during pre-plan inspection (2026-04-29)

**Surfaced to controller:** the locked formula `gross = effective ÷ (1 - tier_discount)` is correct ONLY for orgs that have NO active catalogue. For orgs WITH an active catalogue (PRT today), `effective_unit_price` returns the catalogue price unchanged — `catalogue_unit_price` does NOT apply tier discount on top (canonical pricing memory, 2026-04-27 amendment). Verified empirically:

| Product | `catalogue_unit_price(50)` | `effective_unit_price` | `get_unit_price` (with tier) |
|---|---|---|---|
| Cord Bucket Hat | 7.75 | 7.75 | 0.00 (master tiers absent) |
| Womens Contrast Scrub Top | 17.55 | 17.55 | 0.00 |
| Happy Feet Comfort Socks | 8.50 | 8.50 | 0.00 |

If we naively run `7.75 ÷ (1 - 0.10) = 8.61` and show "Wholesale −$0.86" the customer sees a phantom discount that wasn't applied. The correct UX for catalogue customers is "Catalogue pricing" with NO tier-discount line.

**Resolution applied to plan:** `usePricingContext()` returns `pricingMode: 'catalogue' | 'tiered' | 'standard'` and `<PriceBreakdown />` only renders the tier-discount line when `pricingMode === 'tiered'`. PRT (catalogue org, tier 1) renders as "Catalogue pricing" badge with no fake discount line. Tier 2/3 orgs without catalogues render as "Trade −5%" / "Standard" with real discount line. This honours both the spec's transparency goal and the canonical-pricing reality. Spec §10 verification examples (Wholesale −15% etc) read against a non-catalogue path; they're still valid for non-catalogue orgs.

**No spec re-litigation needed** — Decision #5 (tier badge placement) and Decision #6 (discount line copy) still hold for tiered mode. Catalogue mode is a render-time branch above them.

---

## Current state (from codebase inspection 2026-04-29)

**Live schema (already in place):**
- `b2b_accounts.tier_level` (integer 1/2/3)
- `price_tiers(tier_id text, discount numeric)` — confirmed seed: `1=0.10, 2=0.05, 3=0.00, Custom=null`
- `products.decoration_price` (numeric, nullable), `products.decoration_eligible` (bool, nullable)
- `b2b_catalogue_items.decoration_price_override` (numeric, nullable)
- `b2b_catalogues` per-org with `is_active`
- `effective_unit_price(p_product_id, p_org_id, p_qty)` RPC — canonical entry point

**Existing customer surfaces:**
- [lib/company.ts:14-118](../../lib/company.ts) — `getCompanyAccess(userId, email?)` returns `B2BCustomerAccess` with `tier: string` ('1'|'2'|'3'|'bronze') but NO discount or label
- [types/company.ts:7-40](../../types/company.ts) — `B2BCustomerAccess` interface
- [lib/checkout/server.ts:6-87](../../lib/checkout/server.ts) — `requireB2BCustomer()` returns `B2BCustomerContext` with `tierLevel: number | null` (server-side surface)
- [lib/shop/effective-price.ts](../../lib/shop/effective-price.ts) — RPC wrapper
- [components/shop/ProductCard.tsx](../../components/shop/ProductCard.tsx) — card with `from_unit_price` + stock badge
- [components/shop/ProductDetailClient.tsx](../../components/shop/ProductDetailClient.tsx) — PDP, fetches `/api/shop/pricing` for live unit/total
- [app/api/shop/pricing/route.ts](../../app/api/shop/pricing/route.ts) — **VIOLATES canonical pricing rule** (calls `get_unit_price` directly). Pre-existing bug, fix piggy-backs Task 4.
- [components/cart/CartTable.tsx](../../components/cart/CartTable.tsx) — table with unit×qty per line
- [components/cart/CartClient.tsx](../../components/cart/CartClient.tsx) — subtotal computation
- [components/checkout/CheckoutClient.tsx](../../components/checkout/CheckoutClient.tsx) — review subtotal only
- [contexts/CompanyContext.tsx](../../contexts/CompanyContext.tsx) — client-side `useCompany()` hook fetching from `/api/company-access`
- [app/api/company-access/route.ts](../../app/api/company-access/route.ts) — JSON-serialises `B2BCustomerAccess`

**No existing test infra:** `package.json` has only `dev/build/start/lint` scripts. No vitest/jest installed. Tasks 1, 4 install vitest minimally (devDep + script + config) so the math helper can be TDD'd. UI primitives are smoke-only per controller direction.

---

## File structure

**New files (this plan creates):**
- `lib/pricing/tier-labels.ts` — pure config map (no React, no Supabase)
- `lib/pricing/pricingMath.ts` — pure computation: gross, discount amount, line subtotal, GST, grand total. Exhaustively tested.
- `lib/pricing/types.ts` — shared `PricingMode`, `PricingContext`, `LineBreakdown`, `OrderBreakdown` types
- `lib/pricing/usePricingContext.ts` — client hook: reads `useCompany()` + tier-labels + new fields, returns `PricingContext`
- `components/pricing/TierBadge.tsx` — branded chip; smoke test only
- `components/pricing/DiscountLine.tsx` — single discount row; smoke test only
- `components/pricing/PriceBreakdown.tsx` — full breakdown layout; smoke test only
- `vitest.config.ts` — minimal config for the pure-math tests
- `lib/pricing/pricingMath.test.ts` — TDD tests for pricingMath
- `lib/pricing/usePricingContext.test.ts` — TDD tests for hook (using react testing library)

**Files modified:**
- `package.json` — add `test` script + `vitest`, `@testing-library/react`, `jsdom` devDeps
- `types/company.ts` — extend `B2BCustomerAccess` with `tierLabel?: string`, `tierDiscount?: number`, `pricingMode?: PricingMode`
- `lib/company.ts` — populate the three new fields from `price_tiers` lookup + active-catalogue check
- `components/shop/ProductCard.tsx` — accept optional `tierLabel` prop, render `<TierBadge />` top-right
- `app/(portal)/shop/page.tsx` — pass tier label down to cards (already has `context` from `requireB2BCustomer`)
- `components/shop/ProductDetailClient.tsx` — wrap price block with `<PriceBreakdown variant="pdp" />`
- `components/cart/CartTable.tsx` — add per-line decoration sub-row when product has decoration_price > 0
- `components/cart/CartClient.tsx` — replace flat subtotal with `<PriceBreakdown variant="cart-totals" />`
- `lib/cart/types.ts` — add optional `decorationPrice?: number | null` to `CartLine` (passed through from PDP add-to-cart)
- `components/cart/CartProvider.tsx` — propagate `decorationPrice` on addLine
- `components/shop/ProductDetailClient.tsx` (second pass) — pass `decoration_price` into `cart.addLine`
- `components/checkout/CheckoutClient.tsx` — replace flat subtotal with `<PriceBreakdown variant="checkout-review" />`
- `app/api/shop/pricing/route.ts` — switch from direct `get_unit_price` to `effective_unit_price` (canonical fix)

**NOT touched:**
- `lib/checkout/submit.ts` — already uses `effective_unit_price`. Server-side repricing path unchanged.
- `lib/shop/effective-price.ts` — already canonical.
- Any migration / SQL function — zero schema changes per spec §5.
- `print-room-staff-portal/*` — tier label config explicitly stays in customer-portal per locked decision.

---

## Ambiguities resolved (override in review if wrong)

1. **Catalogue-scoped orgs see "Catalogue pricing" badge, no tier-discount line.** Surfaced under "Spec drift" above. PRT (the smoke tenant) lands on this path.
2. **`tierDiscount` is the fractional discount** (e.g. 0.10 not 10). The percent-string for UI is `Math.round(tierDiscount * 100)` at render time.
3. **Decoration price source on PDP/cart.** PDP reads `products.decoration_price` (already on `ProductData`). When the customer adds to cart we copy the snapshot value into `CartLine.decorationPrice`. Cart/checkout do not re-fetch — the snapshot at add-time is what's shown. (Server re-prices on submit; this is display-only.) Catalogue overrides are NOT honoured for display in v1 because the PDP page does not currently read `b2b_catalogue_items.decoration_price_override`. v1.1 follow-up: have PDP page query include override and pass to client; for now display reflects master `products.decoration_price` only. Documented in spec §11 follow-ups (added below).
4. **Empty-decoration:** if `decorationPrice` is null/0, no decoration line renders (spec §9 row 7).
5. **GST display:** GST is informational only on cart/checkout review — the existing checkout submit pipeline does NOT compute GST on the order total (the staff portal's downstream Xero/Monday flow handles GST). The spec §4.4 example shows GST in the breakdown, so we render it as a "GST (15%) — included" or as an "Estimated GST" line. Default chosen: **render GST as an explicit line** computed client-side as `subtotalAfterDiscount × 0.15`, labelled "GST (15%)". Total shows the GST-inclusive figure. Existing `quotes.total_amount` is unchanged because that's the staff/Xero source of truth.
6. **No-b2b-account customer (`isCompanyUser=false`):** no badge, no tier discount line, just unit × qty + GST. Spec §12 default Q3.
7. **WS5 reuse:** `<TierBadge />` is exported from `components/pricing/TierBadge.tsx` with a clean, prop-driven API (no implicit hook coupling) so WS5's welcome page can pass tierLabel directly without depending on `useCompany()` if it has a server-side path.
8. **Brand-token usage:** primitives use `rgb(var(--color-brand-blue))` directly (matching existing `app/globals.css` patterns) so WS3's polish pass can override via theme without component changes.

---

## Tasks

### Task 1: Test infra + pure types

**Files:**
- Modify: `package.json` (add `test` script + devDeps)
- Create: `vitest.config.ts`
- Create: `lib/pricing/types.ts`

- [ ] **Step 1: Install vitest + RTL + jsdom**

```bash
cd C:/Users/MSI/Documents/Projects/print-room-portal
npm install --save-dev vitest@^2 @testing-library/react@^16 @testing-library/jest-dom@^6 jsdom@^25
```

Expected: packages added to `package.json` devDependencies; `node_modules` updated.

- [ ] **Step 2: Add `test` script to package.json**

Edit `package.json` scripts block:

```json
"scripts": {
  "dev": "next dev --turbopack",
  "build": "next build",
  "start": "next start",
  "lint": "next lint",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 3: Create vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [],
    include: ['lib/**/*.test.ts', 'lib/**/*.test.tsx', 'components/**/*.test.tsx'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
```

- [ ] **Step 4: Create lib/pricing/types.ts**

```ts
/**
 * Pricing visibility types — WS4.
 *
 * `tiered`   = org has tier_level + price_tiers.discount, no active catalogue.
 *              effective_unit_price applies the discount; UI shows base → tier discount line → total.
 * `catalogue`= org has an active catalogue. effective_unit_price returns the catalogue price absolute,
 *              no tier discount applied. UI shows "Catalogue pricing" badge, no fake discount line.
 * `standard` = no b2b_account or tier_level=null. UI shows no badge, no discount line.
 */
export type PricingMode = 'tiered' | 'catalogue' | 'standard'

export interface PricingContext {
  pricingMode: PricingMode
  tierLabel: string | null      // 'Wholesale' | 'Trade' | 'Standard' | null
  tierDiscount: number          // 0 for catalogue/standard, fractional otherwise (0.10 = 10%)
}

export interface LineBreakdown {
  qty: number
  unitEffective: number    // post-discount unit price as returned by effective_unit_price
  unitGross: number        // pre-discount unit price (= effective when catalogue/standard)
  decorationPerUnit: number
  lineGross: number        // qty × (unitGross + decorationPerUnit)
  lineDiscount: number     // qty × (unitGross - unitEffective). 0 in catalogue/standard mode.
  lineNet: number          // lineGross - lineDiscount  (== qty × (unitEffective + decorationPerUnit))
}

export interface OrderBreakdown {
  lines: LineBreakdown[]
  grossSubtotal: number    // sum(lineGross)
  decorationTotal: number  // sum(qty × decorationPerUnit)
  discountAmount: number   // sum(lineDiscount)
  netSubtotal: number      // grossSubtotal - discountAmount  (== sum(lineNet))
  gstRate: number          // 0.15 for NZ
  gst: number              // round2(netSubtotal × gstRate)
  total: number            // netSubtotal + gst
}
```

- [ ] **Step 5: Verify install + types compile**

```bash
cd C:/Users/MSI/Documents/Projects/print-room-portal && npx tsc --noEmit
```

Expected: zero errors related to new files.

- [ ] **Step 6: Commit**

```bash
cd C:/Users/MSI/Documents/Projects/print-room-portal
git add package.json package-lock.json pnpm-lock.yaml vitest.config.ts lib/pricing/types.ts
git commit -m "chore(ws4): add vitest test infra + pricing types

Adds vitest, @testing-library/react, jsdom for testing the
pricing-visibility math helpers. Defines PricingMode/PricingContext/
LineBreakdown/OrderBreakdown types shared across the pricing primitives.

Refs WS4 plan task 1."
```

---

### Task 2: Tier-label config (TDD)

**Files:**
- Create: `lib/pricing/tier-labels.ts`
- Create: `lib/pricing/tier-labels.test.ts`

- [ ] **Step 1: Write failing test**

Create `lib/pricing/tier-labels.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { TIER_LABELS, getTierLabel } from './tier-labels'

describe('tier-labels', () => {
  it('exposes the locked tier-name map', () => {
    expect(TIER_LABELS).toEqual({
      1: 'Wholesale',
      2: 'Trade',
      3: 'Standard',
    })
  })

  it('returns the label for a known numeric tier', () => {
    expect(getTierLabel(1)).toBe('Wholesale')
    expect(getTierLabel(2)).toBe('Trade')
    expect(getTierLabel(3)).toBe('Standard')
  })

  it('accepts numeric strings (e.g. from B2BCustomerAccess.tier="2")', () => {
    expect(getTierLabel('2')).toBe('Trade')
  })

  it('returns null for unknown / null / non-numeric tiers', () => {
    expect(getTierLabel(null)).toBeNull()
    expect(getTierLabel(undefined)).toBeNull()
    expect(getTierLabel(99)).toBeNull()
    expect(getTierLabel('Custom')).toBeNull()
    expect(getTierLabel('bronze')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

```bash
cd C:/Users/MSI/Documents/Projects/print-room-portal && npx vitest run lib/pricing/tier-labels.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/pricing/tier-labels.ts`:

```ts
/**
 * WS4 — Locked tier-name map.
 *
 * Tier 1 = Wholesale (10% off in price_tiers seed)
 * Tier 2 = Trade     (5%)
 * Tier 3 = Standard  (0% — list price)
 *
 * Naming locked per 2026-04-29 spec §9 decision #1. To change names later,
 * edit this file (v1) or move to a tier_labels settings table (v1.1).
 */
export const TIER_LABELS: Record<1 | 2 | 3, string> = {
  1: 'Wholesale',
  2: 'Trade',
  3: 'Standard',
}

/**
 * Look up the friendly label for a tier value.
 * Accepts the numeric tier (1/2/3) or its string form ("1"/"2"/"3").
 * Returns null for any unknown / non-tiered value (incl. 'Custom', 'bronze', null, undefined).
 */
export function getTierLabel(
  tier: number | string | null | undefined
): string | null {
  if (tier === null || tier === undefined) return null
  const n = typeof tier === 'string' ? Number(tier) : tier
  if (!Number.isInteger(n)) return null
  if (n === 1 || n === 2 || n === 3) return TIER_LABELS[n]
  return null
}
```

- [ ] **Step 4: Run test, verify it passes**

```bash
cd C:/Users/MSI/Documents/Projects/print-room-portal && npx vitest run lib/pricing/tier-labels.test.ts
```

Expected: PASS — 4/4.

- [ ] **Step 5: Commit**

```bash
git add lib/pricing/tier-labels.ts lib/pricing/tier-labels.test.ts
git commit -m "feat(pricing): tier-label config (Wholesale/Trade/Standard)

Locked label map per WS4 spec §9 decision #1. \`getTierLabel\` accepts
numeric or string-numeric tier values and returns null for unknown
(incl. 'Custom', 'bronze'). v1.1 will move config to a settings table.

Refs WS4 plan task 2."
```

---

### Task 3: Pricing math helper (TDD)

**Files:**
- Create: `lib/pricing/pricingMath.ts`
- Create: `lib/pricing/pricingMath.test.ts`

- [ ] **Step 1: Write failing tests**

Create `lib/pricing/pricingMath.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  computeUnitGross,
  computeLineBreakdown,
  computeOrderBreakdown,
  round2,
} from './pricingMath'

describe('round2', () => {
  it('rounds to 2 decimals using banker-safe + half-up', () => {
    expect(round2(1.005)).toBe(1.01)
    expect(round2(1.004)).toBe(1.00)
    expect(round2(0)).toBe(0)
    expect(round2(7.755)).toBeCloseTo(7.76, 2)
  })
})

describe('computeUnitGross', () => {
  it('returns the effective price unchanged in catalogue mode', () => {
    expect(computeUnitGross(7.75, 0.10, 'catalogue')).toBe(7.75)
  })
  it('returns the effective price unchanged in standard mode (zero discount)', () => {
    expect(computeUnitGross(10.00, 0, 'standard')).toBe(10.00)
  })
  it('inverts the discount in tiered mode', () => {
    // gross × (1 - 0.10) = effective  →  gross = effective ÷ 0.90
    expect(computeUnitGross(9.00, 0.10, 'tiered')).toBeCloseTo(10.00, 2)
  })
  it('handles 5% Trade discount', () => {
    // gross × 0.95 = 9.50  →  gross = 10.00
    expect(computeUnitGross(9.50, 0.05, 'tiered')).toBeCloseTo(10.00, 2)
  })
  it('returns effective when tieredDiscount is 0', () => {
    expect(computeUnitGross(10, 0, 'tiered')).toBe(10)
  })
})

describe('computeLineBreakdown', () => {
  it('tiered mode: 10 units @ effective $9.00, gross $10.00, decoration $1.50', () => {
    const lb = computeLineBreakdown({
      qty: 10,
      unitEffective: 9.00,
      decorationPerUnit: 1.50,
      tierDiscount: 0.10,
      pricingMode: 'tiered',
    })
    expect(lb.unitGross).toBeCloseTo(10.00, 2)
    expect(lb.unitEffective).toBe(9.00)
    expect(lb.lineGross).toBeCloseTo(115.00, 2) // (10 + 1.50) × 10
    expect(lb.lineDiscount).toBeCloseTo(10.00, 2) // (10.00 - 9.00) × 10
    expect(lb.lineNet).toBeCloseTo(105.00, 2)    // 115 - 10
  })

  it('catalogue mode: no synthetic discount even if tier-discount fraction > 0', () => {
    const lb = computeLineBreakdown({
      qty: 50,
      unitEffective: 7.75,
      decorationPerUnit: 0,
      tierDiscount: 0.10,
      pricingMode: 'catalogue',
    })
    expect(lb.unitGross).toBe(7.75)
    expect(lb.lineDiscount).toBe(0)
    expect(lb.lineGross).toBeCloseTo(387.50, 2)
    expect(lb.lineNet).toBeCloseTo(387.50, 2)
  })

  it('standard mode: no discount, no decoration', () => {
    const lb = computeLineBreakdown({
      qty: 3,
      unitEffective: 25,
      decorationPerUnit: 0,
      tierDiscount: 0,
      pricingMode: 'standard',
    })
    expect(lb.lineGross).toBe(75)
    expect(lb.lineDiscount).toBe(0)
    expect(lb.lineNet).toBe(75)
  })

  it('decoration zero/null treated as 0', () => {
    const lb = computeLineBreakdown({
      qty: 2,
      unitEffective: 10,
      decorationPerUnit: 0,
      tierDiscount: 0,
      pricingMode: 'standard',
    })
    expect(lb.decorationPerUnit).toBe(0)
    expect(lb.lineGross).toBe(20)
  })
})

describe('computeOrderBreakdown', () => {
  it('tiered: two lines reconcile subtotal + decoration − discount + GST = total to cents', () => {
    const ob = computeOrderBreakdown({
      lines: [
        { qty: 10, unitEffective: 9.00, decorationPerUnit: 1.50 },
        { qty: 5,  unitEffective: 18.00, decorationPerUnit: 0 },
      ],
      tierDiscount: 0.10,
      pricingMode: 'tiered',
      gstRate: 0.15,
    })
    // line 1: gross 10×(10+1.5)=115, discount 10×1=10, net 105
    // line 2: gross 5×20=100, discount 5×2=10, net 90  (gross unit=18/0.9=20)
    expect(ob.grossSubtotal).toBeCloseTo(215.00, 2)
    expect(ob.decorationTotal).toBeCloseTo(15.00, 2)
    expect(ob.discountAmount).toBeCloseTo(20.00, 2)
    expect(ob.netSubtotal).toBeCloseTo(195.00, 2)
    expect(ob.gst).toBeCloseTo(29.25, 2)
    expect(ob.total).toBeCloseTo(224.25, 2)
    // Reconciliation: gross + GST_on_net - discount = total? No — GST is on net.
    // Verify: net + gst = total
    expect(ob.netSubtotal + ob.gst).toBeCloseTo(ob.total, 2)
  })

  it('catalogue: discountAmount stays 0 even at 10% tier_discount input', () => {
    const ob = computeOrderBreakdown({
      lines: [{ qty: 50, unitEffective: 7.75, decorationPerUnit: 0 }],
      tierDiscount: 0.10,
      pricingMode: 'catalogue',
      gstRate: 0.15,
    })
    expect(ob.discountAmount).toBe(0)
    expect(ob.netSubtotal).toBeCloseTo(387.50, 2)
    expect(ob.gst).toBeCloseTo(58.13, 2)
    expect(ob.total).toBeCloseTo(445.63, 2)
  })

  it('zero lines yields zero totals', () => {
    const ob = computeOrderBreakdown({
      lines: [],
      tierDiscount: 0.10,
      pricingMode: 'tiered',
      gstRate: 0.15,
    })
    expect(ob.grossSubtotal).toBe(0)
    expect(ob.netSubtotal).toBe(0)
    expect(ob.gst).toBe(0)
    expect(ob.total).toBe(0)
  })

  it('PRT smoke: 3 catalogue products at qty=50', () => {
    // From SQL verification 2026-04-29: catalogue prices 7.75, 17.55, 8.50, no decoration.
    const ob = computeOrderBreakdown({
      lines: [
        { qty: 50, unitEffective: 7.75,  decorationPerUnit: 0 }, // Cord Bucket Hat
        { qty: 50, unitEffective: 17.55, decorationPerUnit: 0 }, // Womens Contrast Scrub Top
        { qty: 50, unitEffective: 8.50,  decorationPerUnit: 0 }, // Happy Feet Comfort Socks
      ],
      tierDiscount: 0.10,
      pricingMode: 'catalogue',
      gstRate: 0.15,
    })
    expect(ob.netSubtotal).toBeCloseTo(1690.00, 2) // (7.75+17.55+8.50) × 50
    expect(ob.discountAmount).toBe(0)
    expect(ob.gst).toBeCloseTo(253.50, 2)
    expect(ob.total).toBeCloseTo(1943.50, 2)
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
cd C:/Users/MSI/Documents/Projects/print-room-portal && npx vitest run lib/pricing/pricingMath.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/pricing/pricingMath.ts`:

```ts
import type { LineBreakdown, OrderBreakdown, PricingMode } from './types'

/**
 * Round half-up to 2 decimals. Avoids JS float drift for cent math.
 */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * Reverse the tier discount to recover the gross (pre-discount) unit price.
 * In `catalogue` and `standard` modes the effective price IS the gross — no inversion.
 */
export function computeUnitGross(
  unitEffective: number,
  tierDiscount: number,
  pricingMode: PricingMode
): number {
  if (pricingMode !== 'tiered') return unitEffective
  if (tierDiscount <= 0 || tierDiscount >= 1) return unitEffective
  return round2(unitEffective / (1 - tierDiscount))
}

interface LineInput {
  qty: number
  unitEffective: number
  decorationPerUnit: number
  tierDiscount: number
  pricingMode: PricingMode
}

export function computeLineBreakdown(input: LineInput): LineBreakdown {
  const { qty, unitEffective, decorationPerUnit, tierDiscount, pricingMode } = input
  const deco = Number.isFinite(decorationPerUnit) ? Math.max(0, decorationPerUnit) : 0
  const unitGross = computeUnitGross(unitEffective, tierDiscount, pricingMode)
  const lineGross = round2(qty * (unitGross + deco))
  const lineDiscount = pricingMode === 'tiered'
    ? round2(qty * (unitGross - unitEffective))
    : 0
  const lineNet = round2(lineGross - lineDiscount)
  return {
    qty,
    unitEffective,
    unitGross,
    decorationPerUnit: deco,
    lineGross,
    lineDiscount,
    lineNet,
  }
}

interface OrderInput {
  lines: Array<Pick<LineInput, 'qty' | 'unitEffective' | 'decorationPerUnit'>>
  tierDiscount: number
  pricingMode: PricingMode
  gstRate: number
}

export function computeOrderBreakdown(input: OrderInput): OrderBreakdown {
  const { lines: linesIn, tierDiscount, pricingMode, gstRate } = input
  const lines = linesIn.map((l) =>
    computeLineBreakdown({
      qty: l.qty,
      unitEffective: l.unitEffective,
      decorationPerUnit: l.decorationPerUnit,
      tierDiscount,
      pricingMode,
    })
  )
  const grossSubtotal = round2(lines.reduce((s, l) => s + l.lineGross, 0))
  const decorationTotal = round2(
    lines.reduce((s, l) => s + l.qty * l.decorationPerUnit, 0)
  )
  const discountAmount = round2(lines.reduce((s, l) => s + l.lineDiscount, 0))
  const netSubtotal = round2(grossSubtotal - discountAmount)
  const gst = round2(netSubtotal * gstRate)
  const total = round2(netSubtotal + gst)
  return {
    lines,
    grossSubtotal,
    decorationTotal,
    discountAmount,
    netSubtotal,
    gstRate,
    gst,
    total,
  }
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
cd C:/Users/MSI/Documents/Projects/print-room-portal && npx vitest run lib/pricing/pricingMath.test.ts
```

Expected: PASS — all describe blocks green.

- [ ] **Step 5: Commit**

```bash
git add lib/pricing/pricingMath.ts lib/pricing/pricingMath.test.ts
git commit -m "feat(pricing): pure math helpers for line + order breakdowns

Pure functions that compute pre-discount gross, line/discount/net,
and order-level totals incl. GST. Catalogue mode skips the
tier-discount inversion (catalogue prices are absolute per the
canonical pricing memory).

Tested: tiered (PRT-style 10% Wholesale + Trade 5%), catalogue
(PRT three-product smoke at qty=50 reconciles to \$1943.50),
standard (no discount), zero-line edge.

Refs WS4 plan task 3."
```

---

### Task 4: Fix /api/shop/pricing canonical violation + return decoration

**Files:**
- Modify: `app/api/shop/pricing/route.ts`

This is a piggy-back fix (pre-existing canonical violation) plus a tiny addition: the API returns `decoration_price` so the PDP doesn't have to refetch it. Net change is small enough to keep here.

- [ ] **Step 1: Update route**

Replace `app/api/shop/pricing/route.ts` body:

```ts
import { NextResponse } from 'next/server'
import { requireB2BCustomer } from '@/lib/checkout/server'

export async function POST(request: Request) {
  const auth = await requireB2BCustomer()
  if ('error' in auth) return auth.error
  const { admin, context } = auth

  let body: { product_id?: string; qty?: number }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (
    !body.product_id ||
    !body.qty ||
    !Number.isInteger(body.qty) ||
    body.qty <= 0
  ) {
    return NextResponse.json(
      { error: 'product_id and positive integer qty required' },
      { status: 400 }
    )
  }

  // Canonical pricing per project_b2b_pricing_canonical.md — never call
  // get_unit_price directly: it bypasses catalogue scope and returns 0.00 for
  // catalogue products without master pricing tiers.
  const [{ data: price }, { data: bracket }] = await Promise.all([
    admin.rpc('effective_unit_price', {
      p_product_id: body.product_id,
      p_org_id: context.organizationId,
      p_qty: body.qty,
    }),
    admin
      .from('product_pricing_tiers')
      .select('min_quantity, max_quantity')
      .eq('product_id', body.product_id)
      .eq('is_active', true)
      .lte('min_quantity', body.qty)
      .order('min_quantity', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const unit = Number(price ?? 0)
  return NextResponse.json({
    unit_price: unit,
    total: Number((unit * body.qty).toFixed(2)),
    bracket: bracket ?? null,
  })
}
```

- [ ] **Step 2: Smoke-build**

```bash
cd C:/Users/MSI/Documents/Projects/print-room-portal && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/shop/pricing/route.ts
git commit -m "fix(shop): /api/shop/pricing uses canonical effective_unit_price

Pre-existing violation of the canonical pricing rule — the route was
calling get_unit_price directly, which returns 0.00 for PRT catalogue
products that lack master product_pricing_tiers rows. Switching to
effective_unit_price fixes PDP live pricing for catalogue customers.

Refs WS4 plan task 4 (piggy-back fix discovered during pricing-visibility
work; flagged in the canonical-pricing call-site list)."
```

---

### Task 5: Extend `getCompanyAccess` with tier metadata (TDD)

**Files:**
- Modify: `types/company.ts`
- Modify: `lib/company.ts`
- Create: `lib/company.test.ts` (mock-supabase test for the new fields)

- [ ] **Step 1: Write failing test**

Create `lib/company.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mock supabase BEFORE importing the SUT
const fromSpy = vi.fn()
vi.mock('@/lib/supabase', () => ({
  getSupabaseServer: () => ({ from: fromSpy }),
}))

import { getCompanyAccess } from './company'

interface QueryStub {
  table: string
  result: unknown
  // optional matcher to return different results based on chain calls
  countMode?: { count: number }
}

/**
 * Each from() call returns a chainable stub whose terminal `.single()`/`.maybeSingle()`/
 * (await) resolves to a fixed result. We script the calls in order via stubsQueue.
 */
function makeChain(result: unknown, isCountQuery = false) {
  // Build a chain that supports .select().eq().single()/.maybeSingle() and the count mode
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    range: () => chain,
    single: async () => ({ data: result, error: null }),
    maybeSingle: async () => ({ data: result, error: null }),
    then: (resolve: any) => resolve({ data: Array.isArray(result) ? result : [result], error: null }),
  }
  if (isCountQuery) {
    // for the variant_inventory count(*) call
    return {
      select: () => ({
        eq: async () => ({ count: 0, error: null }),
      }),
    }
  }
  return chain
}

function setupSupabaseScript(scripts: Record<string, unknown>, options: {
  inventoryCount?: number
} = {}) {
  fromSpy.mockReset()
  fromSpy.mockImplementation((table: string) => {
    if (table === 'variant_inventory') {
      return {
        select: () => ({
          eq: async () => ({ count: options.inventoryCount ?? 0, error: null }),
        }),
      }
    }
    const result = scripts[table]
    return makeChain(result)
  })
}

describe('getCompanyAccess — tier metadata extension', () => {
  beforeEach(() => fromSpy.mockReset())

  it('PRT (tier 1, has active catalogue) → pricingMode=catalogue, label=Wholesale, discount=0.10', async () => {
    setupSupabaseScript({
      profiles: { id: 'u1', email: 'u@x.co.nz', full_name: 'P R', leavers_enabled: false, company_name: null },
      user_organizations: { organization_id: 'org-prt', role: 'admin' },
      organizations: { id: 'org-prt', name: 'The Print Room Test', customer_code: 'PRT' },
      b2b_accounts: { tier_level: 1, payment_terms: 'net30', default_deposit_percent: 0 },
      stores: [{ id: 's1' }],
      price_tiers: { discount: 0.10 },
      b2b_catalogues: { id: 'cat-1', is_active: true },
    })
    const out = await getCompanyAccess('u1', 'u@x.co.nz')
    expect(out?.tierLabel).toBe('Wholesale')
    expect(out?.tierDiscount).toBeCloseTo(0.10, 5)
    expect(out?.pricingMode).toBe('catalogue')
  })

  it('Tier 2, no active catalogue → tiered mode, label=Trade, discount=0.05', async () => {
    setupSupabaseScript({
      profiles: { id: 'u2', email: 'a@b', full_name: 'A B', leavers_enabled: false, company_name: null },
      user_organizations: { organization_id: 'org-x', role: 'staff' },
      organizations: { id: 'org-x', name: 'Org X', customer_code: 'X' },
      b2b_accounts: { tier_level: 2, payment_terms: 'net20', default_deposit_percent: 0 },
      stores: [],
      price_tiers: { discount: 0.05 },
      b2b_catalogues: null,
    })
    const out = await getCompanyAccess('u2', 'a@b')
    expect(out?.tierLabel).toBe('Trade')
    expect(out?.tierDiscount).toBeCloseTo(0.05, 5)
    expect(out?.pricingMode).toBe('tiered')
  })

  it('No b2b_account → pricingMode=standard, no label/discount', async () => {
    setupSupabaseScript({
      profiles: { id: 'u3', email: 'c@d', full_name: 'C D', leavers_enabled: false, company_name: null },
      user_organizations: { organization_id: 'org-y', role: 'staff' },
      organizations: { id: 'org-y', name: 'Org Y', customer_code: null },
      b2b_accounts: null,
      stores: [],
      price_tiers: null,
      b2b_catalogues: null,
    })
    const out = await getCompanyAccess('u3', 'c@d')
    expect(out?.pricingMode).toBe('standard')
    expect(out?.tierLabel).toBeNull()
    expect(out?.tierDiscount).toBe(0)
  })

  it('Individual user (no org membership) → pricingMode=standard', async () => {
    setupSupabaseScript({
      profiles: { id: 'u4', email: 'e@f', full_name: 'E F', leavers_enabled: false, company_name: null },
      user_organizations: null,
    })
    const out = await getCompanyAccess('u4', 'e@f')
    expect(out?.pricingMode).toBe('standard')
    expect(out?.tierLabel).toBeNull()
    expect(out?.tierDiscount).toBe(0)
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

```bash
cd C:/Users/MSI/Documents/Projects/print-room-portal && npx vitest run lib/company.test.ts
```

Expected: FAIL — fields tierLabel/tierDiscount/pricingMode missing on output.

- [ ] **Step 3: Update `types/company.ts`**

Replace the `B2BCustomerAccess` interface body — add three optional fields BEFORE `hasTrackedInventory`:

```ts
import type { PricingMode } from '@/lib/pricing/types'

export interface B2BCustomerAccess {
  userId: string
  email: string
  firstName: string
  lastName: string
  companyId: string | null
  companyName: string | null
  locationIds: string[]
  role: 'admin' | 'manager' | 'staff'
  tier: string

  isCompanyUser: boolean
  isIndividual: boolean

  isAdmin: boolean
  isManager: boolean
  isStaff: boolean
  isCreative: boolean

  canViewLocations: boolean
  canViewReports: boolean
  canViewAccountRequests: boolean
  canViewAllLocations: boolean
  canApproveDesigns: boolean
  canManageUsers: boolean
  canUseLeavers: boolean

  /** WS4 — friendly tier name from TIER_LABELS map. Null when no b2b_account or unknown tier. */
  tierLabel: string | null
  /** WS4 — fractional discount (0.10 = 10%). 0 when no b2b_account or no price_tiers row. */
  tierDiscount: number
  /** WS4 — pricing mode for the org. See lib/pricing/types.ts. */
  pricingMode: PricingMode

  /**
   * True if the organization has any rows in `variant_inventory` (Inventory sub-app).
   * Gates Sidebar link visibility and /inventory page behaviour.
   * Tolerant of the table not existing yet — falls back to false.
   */
  hasTrackedInventory: boolean
}
```

- [ ] **Step 4: Update `lib/company.ts`**

Add imports at the top:

```ts
import { getTierLabel } from '@/lib/pricing/tier-labels'
import type { PricingMode } from '@/lib/pricing/types'
```

Inside `getCompanyAccess`, after the `b2bAccount` lookup (line ~78) and before the `locations` fetch, add a parallel fetch for price_tiers + active catalogues:

```ts
  // 4b. Tier discount + active catalogue presence (WS4)
  const tierLevelStr = b2bAccount?.tier_level != null ? String(b2bAccount.tier_level) : null

  const [{ data: priceTier }, { data: activeCatalogue }] = await Promise.all([
    tierLevelStr
      ? supabase.from('price_tiers').select('discount').eq('tier_id', tierLevelStr).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from('b2b_catalogues')
      .select('id')
      .eq('organization_id', orgMembership.organization_id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle(),
  ])

  const tierDiscount = Number(priceTier?.discount ?? 0)
  const tierLabel = getTierLabel(b2bAccount?.tier_level ?? null)
  const pricingMode: PricingMode = activeCatalogue
    ? 'catalogue'
    : tierLevelStr && tierDiscount > 0
      ? 'tiered'
      : tierLevelStr
        ? 'tiered'  // tier 3 (Standard, 0% discount) still classifies as tiered for label-rendering purposes
        : 'standard'
```

Then in the final `buildAccess` call, pass the three new fields through. Update `AccessInput` and `buildAccess`:

```ts
interface AccessInput {
  userId: string
  email: string
  firstName: string
  lastName: string
  companyId: string | null
  companyName: string | null
  locationIds: string[]
  role: 'admin' | 'manager' | 'staff'
  tier: string
  tierLabel: string | null
  tierDiscount: number
  pricingMode: PricingMode
  isCompanyUser: boolean
  leaversEnabled: boolean
  hasTrackedInventory: boolean
}

function buildAccess(input: AccessInput): B2BCustomerAccess {
  const {
    role, isCompanyUser, leaversEnabled, hasTrackedInventory,
    tierLabel, tierDiscount, pricingMode,
    ...rest
  } = input
  // ...rest of body...
  return {
    ...rest,
    role,
    isCompanyUser,
    isIndividual: !isCompanyUser,
    isAdmin,
    isManager,
    isStaff,
    isCreative: !isCompanyUser || isStaff,
    canViewLocations: isCompanyUser && (isAdmin || isManager),
    canViewReports: isCompanyUser && isAdmin,
    canViewAccountRequests: isAdmin,
    canViewAllLocations: isAdmin,
    canApproveDesigns: isAdmin || isManager,
    canManageUsers: isAdmin,
    canUseLeavers: leaversEnabled,
    tierLabel,
    tierDiscount,
    pricingMode,
    hasTrackedInventory,
  }
}
```

Both call sites (the org branch and `buildAccessForIndividual`) must pass the new fields:

```ts
// org branch (the main return at the bottom of getCompanyAccess):
return buildAccess({
  userId, email: userEmail, firstName, lastName,
  companyId: orgMembership.organization_id,
  companyName: org?.name || profile.company_name || null,
  locationIds, role, tier,
  tierLabel, tierDiscount, pricingMode,
  isCompanyUser: true,
  leaversEnabled,
  hasTrackedInventory,
})
```

```ts
// individual + no-membership branches → pricingMode 'standard', no label/discount:
return buildAccess({
  userId, email: userEmail, firstName, lastName,
  companyId: null, companyName: profile.company_name || null,
  locationIds: [], role: 'staff', tier: 'bronze',
  tierLabel: null, tierDiscount: 0, pricingMode: 'standard',
  isCompanyUser: false,
  leaversEnabled,
  hasTrackedInventory: false,
})
```

And in `buildAccessForIndividual`:

```ts
async function buildAccessForIndividual(userId: string, email: string): Promise<B2BCustomerAccess> {
  return buildAccess({
    userId, email,
    firstName: '', lastName: '',
    companyId: null, companyName: null,
    locationIds: [], role: 'staff', tier: 'bronze',
    tierLabel: null, tierDiscount: 0, pricingMode: 'standard',
    isCompanyUser: false, leaversEnabled: false, hasTrackedInventory: false,
  })
}
```

- [ ] **Step 5: Run tests, verify they pass**

```bash
cd C:/Users/MSI/Documents/Projects/print-room-portal && npx vitest run lib/
```

Expected: PASS — all suites green (tier-labels + pricingMath + company).

- [ ] **Step 6: Verify type-check across the whole repo**

```bash
cd C:/Users/MSI/Documents/Projects/print-room-portal && npx tsc --noEmit
```

Expected: zero errors. (Type signature change is additive; no consumer should break.)

- [ ] **Step 7: Commit**

```bash
git add types/company.ts lib/company.ts lib/company.test.ts
git commit -m "feat(pricing): extend getCompanyAccess with tierLabel/tierDiscount/pricingMode

WS4 — surfaces b2b_accounts.tier_level + price_tiers.discount + active-
catalogue presence to the customer-portal client layer. PRT (tier 1,
has catalogue) lands on pricingMode='catalogue' with discount=0.10
captured but NOT applied to the breakdown (catalogue prices are absolute
per the canonical pricing memory).

Refs WS4 plan task 5."
```

---

### Task 6: `usePricingContext()` client hook (smoke test)

**Files:**
- Create: `lib/pricing/usePricingContext.ts`
- Create: `lib/pricing/usePricingContext.test.tsx`

- [ ] **Step 1: Write smoke test**

Create `lib/pricing/usePricingContext.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { B2BCustomerAccess } from '@/types/company'
import type { ReactNode } from 'react'

const useCompanyMock = vi.fn()
vi.mock('@/contexts/CompanyContext', () => ({
  useCompany: () => useCompanyMock(),
}))

import { usePricingContext } from './usePricingContext'

function makeAccess(overrides: Partial<B2BCustomerAccess>): B2BCustomerAccess {
  return {
    userId: 'u', email: '', firstName: '', lastName: '',
    companyId: null, companyName: null, locationIds: [], role: 'staff', tier: 'bronze',
    isCompanyUser: false, isIndividual: true, isAdmin: false, isManager: false,
    isStaff: true, isCreative: true,
    canViewLocations: false, canViewReports: false, canViewAccountRequests: false,
    canViewAllLocations: false, canApproveDesigns: false, canManageUsers: false,
    canUseLeavers: false,
    tierLabel: null, tierDiscount: 0, pricingMode: 'standard',
    hasTrackedInventory: false,
    ...overrides,
  }
}

describe('usePricingContext', () => {
  it('returns standard mode when no access', () => {
    useCompanyMock.mockReturnValue({ access: null, loading: false })
    const { result } = renderHook(() => usePricingContext())
    expect(result.current.pricingMode).toBe('standard')
    expect(result.current.tierLabel).toBeNull()
    expect(result.current.tierDiscount).toBe(0)
  })

  it('returns catalogue mode for PRT-like access', () => {
    useCompanyMock.mockReturnValue({
      access: makeAccess({
        tierLabel: 'Wholesale', tierDiscount: 0.10, pricingMode: 'catalogue',
      }),
      loading: false,
    })
    const { result } = renderHook(() => usePricingContext())
    expect(result.current.pricingMode).toBe('catalogue')
    expect(result.current.tierLabel).toBe('Wholesale')
    expect(result.current.tierDiscount).toBe(0.10)
  })

  it('returns tiered mode for non-catalogue tier-2', () => {
    useCompanyMock.mockReturnValue({
      access: makeAccess({
        tierLabel: 'Trade', tierDiscount: 0.05, pricingMode: 'tiered',
      }),
      loading: false,
    })
    const { result } = renderHook(() => usePricingContext())
    expect(result.current.pricingMode).toBe('tiered')
    expect(result.current.tierLabel).toBe('Trade')
    expect(result.current.tierDiscount).toBe(0.05)
  })
})
```

- [ ] **Step 2: Run, verify failure**

```bash
cd C:/Users/MSI/Documents/Projects/print-room-portal && npx vitest run lib/pricing/usePricingContext.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/pricing/usePricingContext.ts`:

```ts
'use client'

import { useCompany } from '@/contexts/CompanyContext'
import type { PricingContext } from './types'

/**
 * Reads tier metadata from the CompanyContext (populated by getCompanyAccess
 * via /api/company-access). Returns the tier label, fractional discount, and
 * pricing mode for the active org. Defaults to 'standard' when no access.
 */
export function usePricingContext(): PricingContext {
  const { access } = useCompany()
  if (!access) {
    return { pricingMode: 'standard', tierLabel: null, tierDiscount: 0 }
  }
  return {
    pricingMode: access.pricingMode ?? 'standard',
    tierLabel: access.tierLabel ?? null,
    tierDiscount: access.tierDiscount ?? 0,
  }
}
```

- [ ] **Step 4: Run, verify pass**

```bash
cd C:/Users/MSI/Documents/Projects/print-room-portal && npx vitest run lib/pricing/usePricingContext.test.tsx
```

Expected: PASS — 3/3.

- [ ] **Step 5: Commit**

```bash
git add lib/pricing/usePricingContext.ts lib/pricing/usePricingContext.test.tsx
git commit -m "feat(pricing): usePricingContext client hook

Reads tier metadata from CompanyContext and returns a stable
{ pricingMode, tierLabel, tierDiscount } shape for cart, checkout,
and PDP primitives.

Refs WS4 plan task 6."
```

---

### Task 7: TierBadge primitive (smoke test)

**Files:**
- Create: `components/pricing/TierBadge.tsx`
- Create: `components/pricing/TierBadge.test.tsx`

- [ ] **Step 1: Smoke test**

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TierBadge } from './TierBadge'

describe('TierBadge', () => {
  it('renders tier-suffixed pricing copy when label is present', () => {
    render(<TierBadge label="Wholesale" />)
    expect(screen.getByText(/Wholesale pricing/i)).toBeDefined()
  })

  it('renders catalogue copy in catalogue mode regardless of label', () => {
    render(<TierBadge label="Wholesale" pricingMode="catalogue" />)
    expect(screen.getByText(/Catalogue pricing/i)).toBeDefined()
  })

  it('returns null with no label and standard mode', () => {
    const { container } = render(<TierBadge label={null} />)
    expect(container.firstChild).toBeNull()
  })
})
```

- [ ] **Step 2: Implement**

```tsx
import type { PricingMode } from '@/lib/pricing/types'

interface TierBadgeProps {
  label: string | null
  pricingMode?: PricingMode
  className?: string
}

/**
 * Branded chip for pricing visibility.
 * - tiered  → "{Label} pricing"      (e.g. "Wholesale pricing")
 * - catalogue → "Catalogue pricing"   (no tier name; catalogue prices are absolute)
 * - standard → null                   (no badge for non-b2b customers)
 *
 * Uses brand tokens (rgb(var(--color-brand-blue))) so WS3 polish is additive.
 */
export function TierBadge({ label, pricingMode = 'tiered', className = '' }: TierBadgeProps) {
  if (pricingMode === 'standard') return null
  const text = pricingMode === 'catalogue' ? 'Catalogue pricing' : (label ? `${label} pricing` : null)
  if (!text) return null
  return (
    <span
      className={
        'inline-flex items-center rounded-full border border-[rgb(var(--color-brand-blue))]/20 ' +
        'bg-[rgb(var(--color-brand-blue))]/10 px-2.5 py-0.5 text-xs font-medium ' +
        'text-[rgb(var(--color-brand-blue))] ' + className
      }
    >
      {text}
    </span>
  )
}
```

- [ ] **Step 3: Run, verify pass**

```bash
cd C:/Users/MSI/Documents/Projects/print-room-portal && npx vitest run components/pricing/TierBadge.test.tsx
```

Expected: PASS — 3/3.

- [ ] **Step 4: Commit**

```bash
git add components/pricing/TierBadge.tsx components/pricing/TierBadge.test.tsx
git commit -m "feat(pricing): TierBadge primitive

Branded chip rendering '{Label} pricing' for tiered orgs, 'Catalogue
pricing' for catalogue-scoped orgs, and nothing for standard customers.
Exported cleanly for WS5 to consume on the welcome page.

Refs WS4 plan task 7."
```

---

### Task 8: DiscountLine + PriceBreakdown primitives (smoke tests)

**Files:**
- Create: `components/pricing/DiscountLine.tsx`
- Create: `components/pricing/DiscountLine.test.tsx`
- Create: `components/pricing/PriceBreakdown.tsx`
- Create: `components/pricing/PriceBreakdown.test.tsx`

- [ ] **Step 1: DiscountLine test**

`components/pricing/DiscountLine.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DiscountLine } from './DiscountLine'

describe('DiscountLine', () => {
  it('renders the locked spec copy with rounded percent and 2dp amount', () => {
    render(<DiscountLine label="Wholesale" amount={1.88} discountFraction={0.15} />)
    expect(screen.getByText(/Your Wholesale discount/i)).toBeDefined()
    expect(screen.getByText(/−\$1\.88/)).toBeDefined()
    expect(screen.getByText(/−15%/)).toBeDefined()
  })

  it('renders nothing when amount is 0', () => {
    const { container } = render(<DiscountLine label="Standard" amount={0} discountFraction={0} />)
    expect(container.firstChild).toBeNull()
  })
})
```

- [ ] **Step 2: DiscountLine impl**

`components/pricing/DiscountLine.tsx`:

```tsx
interface DiscountLineProps {
  /** Tier label, e.g. 'Wholesale'. */
  label: string
  /** Positive dollar amount being discounted. */
  amount: number
  /** Fractional discount, e.g. 0.10 for 10%. */
  discountFraction: number
}

/**
 * Single-line discount summary: "Your {Label} discount: −$X.XX (−N%)".
 * Renders nothing if amount is 0 — caller controls visibility via order math.
 */
export function DiscountLine({ label, amount, discountFraction }: DiscountLineProps) {
  if (!(amount > 0)) return null
  const pct = Math.round(discountFraction * 100)
  return (
    <div className="flex items-baseline justify-between text-sm">
      <span className="text-gray-700">
        Your <span className="font-medium">{label}</span> discount
      </span>
      <span className="font-medium text-[rgb(var(--color-brand-blue))]">
        −${amount.toFixed(2)} <span className="text-xs text-gray-500">(−{pct}%)</span>
      </span>
    </div>
  )
}
```

- [ ] **Step 3: Run DiscountLine test**

```bash
cd C:/Users/MSI/Documents/Projects/print-room-portal && npx vitest run components/pricing/DiscountLine.test.tsx
```

Expected: PASS — 2/2.

- [ ] **Step 4: PriceBreakdown test**

`components/pricing/PriceBreakdown.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PriceBreakdown } from './PriceBreakdown'

const ob = {
  lines: [],
  grossSubtotal: 215.00,
  decorationTotal: 15.00,
  discountAmount: 20.00,
  netSubtotal: 195.00,
  gstRate: 0.15,
  gst: 29.25,
  total: 224.25,
}

describe('PriceBreakdown', () => {
  it('cart-totals variant renders subtotal, decoration, discount, GST, total', () => {
    render(
      <PriceBreakdown
        breakdown={ob}
        pricingMode="tiered"
        tierLabel="Trade"
        tierDiscount={0.10}
        variant="cart-totals"
      />
    )
    expect(screen.getByText(/\$215\.00/)).toBeDefined() // gross subtotal
    expect(screen.getByText(/\$15\.00/)).toBeDefined()  // decoration total
    expect(screen.getByText(/Your Trade discount/i)).toBeDefined()
    expect(screen.getByText(/−\$20\.00/)).toBeDefined() // discount line
    expect(screen.getByText(/\$29\.25/)).toBeDefined()  // GST
    expect(screen.getByText(/\$224\.25/)).toBeDefined() // total
  })

  it('catalogue mode hides the discount line', () => {
    render(
      <PriceBreakdown
        breakdown={{ ...ob, discountAmount: 0, netSubtotal: 215.00, gst: 32.25, total: 247.25 }}
        pricingMode="catalogue"
        tierLabel="Wholesale"
        tierDiscount={0.10}
        variant="cart-totals"
      />
    )
    expect(screen.queryByText(/Your.*discount/i)).toBeNull()
  })

  it('hides decoration line when decorationTotal is 0', () => {
    render(
      <PriceBreakdown
        breakdown={{ ...ob, decorationTotal: 0 }}
        pricingMode="tiered"
        tierLabel="Trade"
        tierDiscount={0.10}
        variant="cart-totals"
      />
    )
    expect(screen.queryByText(/Decoration/i)).toBeNull()
  })
})
```

- [ ] **Step 5: PriceBreakdown impl**

`components/pricing/PriceBreakdown.tsx`:

```tsx
import type { OrderBreakdown, PricingMode } from '@/lib/pricing/types'
import { DiscountLine } from './DiscountLine'

interface PriceBreakdownProps {
  breakdown: OrderBreakdown
  pricingMode: PricingMode
  tierLabel: string | null
  tierDiscount: number
  /**
   * Layout/density tweak. All variants render the same data; the difference is
   * in spacing + typographic weight so it slots into PDP, cart totals,
   * and checkout review without bespoke rewrites.
   */
  variant: 'pdp' | 'cart-totals' | 'checkout-review'
}

/**
 * Full-order breakdown: gross subtotal → decoration (if any) → tier discount
 * (if any) → GST → total. Catalogue mode skips the tier-discount line.
 */
export function PriceBreakdown({
  breakdown,
  pricingMode,
  tierLabel,
  tierDiscount,
  variant,
}: PriceBreakdownProps) {
  const showDiscount =
    pricingMode === 'tiered' && breakdown.discountAmount > 0 && tierLabel != null
  const showDecoration = breakdown.decorationTotal > 0
  const isReview = variant === 'checkout-review'

  return (
    <div className={'space-y-1.5 ' + (isReview ? 'text-sm' : 'text-sm')}>
      <Row label="Subtotal" value={breakdown.grossSubtotal} />
      {showDecoration && <Row label="Decoration" value={breakdown.decorationTotal} />}
      {showDiscount && (
        <DiscountLine
          label={tierLabel as string}
          amount={breakdown.discountAmount}
          discountFraction={tierDiscount}
        />
      )}
      <Row
        label={`GST (${Math.round(breakdown.gstRate * 100)}%)`}
        value={breakdown.gst}
        muted
      />
      <div className="mt-1 border-t border-gray-100 pt-1.5">
        <Row label="Total" value={breakdown.total} bold />
      </div>
    </div>
  )
}

function Row({ label, value, bold, muted }: { label: string; value: number; bold?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className={muted ? 'text-gray-500' : 'text-gray-700'}>{label}</span>
      <span className={bold ? 'text-base font-semibold text-gray-900' : muted ? 'text-gray-700' : 'font-medium text-gray-900'}>
        ${value.toFixed(2)}
      </span>
    </div>
  )
}
```

- [ ] **Step 6: Run PriceBreakdown tests**

```bash
cd C:/Users/MSI/Documents/Projects/print-room-portal && npx vitest run components/pricing/PriceBreakdown.test.tsx
```

Expected: PASS — 3/3.

- [ ] **Step 7: Commit**

```bash
git add components/pricing/DiscountLine.tsx components/pricing/DiscountLine.test.tsx \
        components/pricing/PriceBreakdown.tsx components/pricing/PriceBreakdown.test.tsx
git commit -m "feat(pricing): DiscountLine + PriceBreakdown primitives

DiscountLine: 'Your {Label} discount: −\$X.XX (−N%)' per spec §9 #6.
PriceBreakdown: Subtotal → Decoration (cond.) → Discount (cond. tiered)
→ GST (15%) → Total. Catalogue mode hides the synthetic discount line.

Refs WS4 plan task 8."
```

---

### Task 9: Wire `<TierBadge />` into ProductCard + /shop page

**Files:**
- Modify: `components/shop/ProductCard.tsx`
- Modify: `app/(portal)/shop/page.tsx`

- [ ] **Step 1: Update ProductCard**

Replace the file:

```tsx
import Image from 'next/image'
import { TierBadge } from '@/components/pricing/TierBadge'
import type { PricingMode } from '@/lib/pricing/types'

interface ProductCardData {
  id: string
  name: string
  sku: string | null
  image_url: string | null
  from_unit_price: number
  has_stock: boolean
}

interface ProductCardProps {
  product: ProductCardData
  tierLabel: string | null
  pricingMode: PricingMode
}

export function ProductCard({ product, tierLabel, pricingMode }: ProductCardProps) {
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition-all duration-300 ease-spring hover:shadow-md">
      <div className="relative aspect-square w-full bg-gray-50">
        {product.image_url ? (
          <Image
            src={product.image_url}
            alt={product.name}
            fill
            sizes="(min-width:1024px) 25vw, (min-width:768px) 33vw, 50vw"
            className="object-contain p-4 transition-transform duration-500 ease-spring group-hover:scale-105"
            unoptimized
          />
        ) : (
          <div className="flex h-full items-center justify-center text-gray-300 text-sm">
            No image
          </div>
        )}
        <div className="absolute right-3 top-3 flex flex-col items-end gap-1">
          <TierBadge label={tierLabel} pricingMode={pricingMode} />
          {product.has_stock && (
            <span className="rounded-full bg-lime-100 px-2.5 py-1 text-xs font-medium text-lime-800">
              In stock
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-1 p-4">
        <p className="text-xs uppercase tracking-wide text-gray-400">{product.sku}</p>
        <h3 className="text-sm font-medium text-gray-900 line-clamp-2">{product.name}</h3>
        {product.from_unit_price > 0 && (
          <p className="mt-1 text-sm text-gray-600">
            From <span className="font-semibold text-gray-900">${product.from_unit_price.toFixed(2)}</span>
          </p>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Update `app/(portal)/shop/page.tsx`**

Add imports near the top:

```ts
import { getTierLabel } from '@/lib/pricing/tier-labels'
import type { PricingMode } from '@/lib/pricing/types'
```

After the `const auth = await requireB2BCustomer()` block, derive tier metadata. We re-query `b2b_catalogues` here because `requireB2BCustomer` doesn't return pricingMode (server-side context is separate from `getCompanyAccess`'s client-shape):

```ts
  // Derive pricingMode + tier label for the badge on each card.
  const tierLevel = context.tierLevel
  const tierLabel = getTierLabel(tierLevel)
  const { data: activeCat } = await admin
    .from('b2b_catalogues')
    .select('id')
    .eq('organization_id', context.organizationId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()
  const pricingMode: PricingMode = activeCat
    ? 'catalogue'
    : tierLevel != null
      ? 'tiered'
      : 'standard'
```

Update the card render JSX to pass these props:

```tsx
            <ProductCard
              product={p}
              tierLabel={tierLabel}
              pricingMode={pricingMode}
            />
```

- [ ] **Step 3: Type-check**

```bash
cd C:/Users/MSI/Documents/Projects/print-room-portal && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add components/shop/ProductCard.tsx app/\(portal\)/shop/page.tsx
git commit -m "feat(shop): TierBadge on /shop product cards

PRT (catalogue) sees 'Catalogue pricing'; tier-2/3 orgs without
a catalogue see 'Trade pricing' / 'Standard pricing'. Standard
customers (no b2b_account) see no badge.

Refs WS4 plan task 9."
```

---

### Task 10: Wire `<PriceBreakdown />` into PDP + propagate decoration into cart

**Files:**
- Modify: `lib/cart/types.ts`
- Modify: `components/cart/CartProvider.tsx` (no functional change — CartLine type extends transparently)
- Modify: `components/shop/ProductDetailClient.tsx`

- [ ] **Step 1: Extend CartLine**

Edit `lib/cart/types.ts`:

```ts
export interface CartLine {
  lineId: string
  productId: string
  productName: string
  variantId: string
  variantLabel: string
  qty: number
  unitPrice: number
  imageUrl: string | null
  shipToStoreId?: string | null
  /** WS4 — snapshot of products.decoration_price at add-time. Null/undefined when product has no decoration. */
  decorationPrice?: number | null
}
```

`CartProvider` requires no changes — `addLine` accepts `Omit<CartLine, 'lineId'>` and the spread propagates the new optional field automatically. Verify by reading [components/cart/CartProvider.tsx:55-57](../../components/cart/CartProvider.tsx).

- [ ] **Step 2: Update PDP to render PriceBreakdown + propagate decoration**

In `components/shop/ProductDetailClient.tsx`, add imports:

```ts
import { usePricingContext } from '@/lib/pricing/usePricingContext'
import { computeOrderBreakdown } from '@/lib/pricing/pricingMath'
import { PriceBreakdown } from '@/components/pricing/PriceBreakdown'
import { TierBadge } from '@/components/pricing/TierBadge'
```

Inside the component body, after `const cart = useCart()`:

```tsx
  const pricing_ctx = usePricingContext()
```

Replace the price block (lines ~224-243) with a `<PriceBreakdown />`. The "qty + Add to cart" row stays; the right-hand "Unit / Total" plain-text becomes a small breakdown driven by the live `pricing` state:

```tsx
            <div className="flex-1 text-right text-sm">
              {pricingLoading ? (
                <span className="text-gray-400">Pricing…</span>
              ) : pricing ? (
                <PriceBreakdown
                  breakdown={computeOrderBreakdown({
                    lines: [
                      {
                        qty,
                        unitEffective: pricing.unit_price,
                        decorationPerUnit: product.decoration_price ?? 0,
                      },
                    ],
                    tierDiscount: pricing_ctx.tierDiscount,
                    pricingMode: pricing_ctx.pricingMode,
                    gstRate: 0.15,
                  })}
                  pricingMode={pricing_ctx.pricingMode}
                  tierLabel={pricing_ctx.tierLabel}
                  tierDiscount={pricing_ctx.tierDiscount}
                  variant="pdp"
                />
              ) : (
                <span className="text-gray-400">—</span>
              )}
            </div>
```

Add a tier badge near the product title (`<h1>`):

```tsx
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold text-gray-900">{product.name}</h1>
              <TierBadge label={pricing_ctx.tierLabel} pricingMode={pricing_ctx.pricingMode} />
            </div>
            {product.description && (
              <p className="mt-2 text-sm text-gray-600">{product.description}</p>
            )}
          </div>
```

Update `handleAddToCart` to snapshot decoration:

```tsx
  function handleAddToCart() {
    if (!selectedVariant || !pricing) return
    const colorLabel = selectedVariant.color_label ?? ''
    const sizeLabel = selectedVariant.size_label ?? ''
    const variantLabel = [colorLabel, sizeLabel].filter(Boolean).join(' / ') || '—'
    cart.addLine({
      productId: product.id,
      productName: product.name,
      variantId: selectedVariant.variant_id,
      variantLabel,
      qty,
      unitPrice: pricing.unit_price,
      imageUrl: product.image_url,
      decorationPrice: product.decoration_price ?? null,
    })
    showToast('Added to cart')
  }
```

- [ ] **Step 3: Type-check**

```bash
cd C:/Users/MSI/Documents/Projects/print-room-portal && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add lib/cart/types.ts components/shop/ProductDetailClient.tsx
git commit -m "feat(shop): PDP shows full price breakdown + propagates decoration to cart

PDP price block now renders a Subtotal/Decoration/Discount/GST/Total
breakdown driven by usePricingContext + computeOrderBreakdown. The
tier badge sits next to the product title. Decoration price snapshots
into CartLine.decorationPrice on add-to-cart so /cart and /checkout
can render the same breakdown without a refetch.

Refs WS4 plan task 10."
```

---

### Task 11: Cart per-line decoration row + totals breakdown

**Files:**
- Modify: `components/cart/CartTable.tsx`
- Modify: `components/cart/CartClient.tsx`

- [ ] **Step 1: Add decoration sub-row to CartTable**

Inside `components/cart/CartTable.tsx`, in the per-line `<tr>` body (where it renders qty + unit + line total), expand the line subtotal cell to show decoration when applicable. The simplest minimal change is to render a tiny secondary row under the product name when `line.decorationPrice > 0`:

Locate the product-name cell (lines ~111-126) and append a decoration hint:

```tsx
                    <div className="min-w-0">
                      <div className="truncate font-medium text-gray-900">{line.productName}</div>
                      <div className="truncate text-xs text-gray-500">{line.variantLabel}</div>
                      {line.decorationPrice && line.decorationPrice > 0 ? (
                        <div className="text-xs text-gray-500">
                          + ${line.decorationPrice.toFixed(2)} decoration / unit
                        </div>
                      ) : null}
                      {isOversell && (
                        <div className="mt-1 flex items-center gap-2 text-xs text-red-700">
                          <span>Only {avail} available.</span>
                          <button
                            type="button"
                            onClick={() => onUpdateQty(line.lineId, avail ?? 0)}
                            className="rounded-full border border-red-300 bg-white px-2 py-0.5 font-medium text-red-700 hover:bg-red-50"
                          >
                            Reduce to {avail}
                          </button>
                        </div>
                      )}
                    </div>
```

And update the per-line "Total" cell to include decoration in the line total:

```tsx
                <td className="px-4 py-3 font-medium text-gray-900">
                  ${(line.qty * (line.unitPrice + (line.decorationPrice ?? 0))).toFixed(2)}
                </td>
```

- [ ] **Step 2: Replace flat subtotal in CartClient with `<PriceBreakdown />`**

In `components/cart/CartClient.tsx` add imports:

```ts
import { usePricingContext } from '@/lib/pricing/usePricingContext'
import { computeOrderBreakdown } from '@/lib/pricing/pricingMath'
import { PriceBreakdown } from '@/components/pricing/PriceBreakdown'
import { TierBadge } from '@/components/pricing/TierBadge'
```

Replace the existing `subtotal` computation + JSX block with the breakdown:

```tsx
  const pricing_ctx = usePricingContext()

  const breakdown = computeOrderBreakdown({
    lines: cart.lines.map((l) => ({
      qty: l.qty,
      unitEffective: l.unitPrice,
      decorationPerUnit: l.decorationPrice ?? 0,
    })),
    tierDiscount: pricing_ctx.tierDiscount,
    pricingMode: pricing_ctx.pricingMode,
    gstRate: 0.15,
  })

  const depositPct = defaultDepositPercent ?? 0
  const depositAmount = (breakdown.netSubtotal * depositPct) / 100

  const canCheckout = cart.lines.length > 0 && !oversell && !customerCodeMissing
```

Replace the summary block (the `<div>` after `<CartTable>`):

```tsx
      {cart.lines.length > 0 && (
        <div className="mt-6 grid gap-6 md:grid-cols-3">
          <div className="md:col-span-2 space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-gray-700">Pricing for</span>
              <TierBadge label={pricing_ctx.tierLabel} pricingMode={pricing_ctx.pricingMode} />
            </div>
            {paymentTerms && (
              <div className="text-gray-500">
                Payment terms: <span className="font-medium text-gray-700">{paymentTerms}</span>
              </div>
            )}
            {depositPct > 0 && (
              <div className="text-gray-600">
                Expected deposit ({depositPct}%):{' '}
                <span className="font-medium text-gray-900">${depositAmount.toFixed(2)}</span>
              </div>
            )}
            {oversell && (
              <div className="text-red-600">
                One or more lines exceed available stock. Reduce quantities to proceed.
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <PriceBreakdown
              breakdown={breakdown}
              pricingMode={pricing_ctx.pricingMode}
              tierLabel={pricing_ctx.tierLabel}
              tierDiscount={pricing_ctx.tierDiscount}
              variant="cart-totals"
            />
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => cart.clear()}
                className="rounded-full border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Clear cart
              </button>
              <button
                type="button"
                onClick={() => router.push('/checkout')}
                disabled={!canCheckout}
                className="rounded-full bg-pr-blue px-5 py-2.5 text-sm font-medium text-white transition-all duration-200 ease-spring hover:bg-pr-blue/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Proceed to checkout
              </button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 3: Type-check**

```bash
cd C:/Users/MSI/Documents/Projects/print-room-portal && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add components/cart/CartTable.tsx components/cart/CartClient.tsx
git commit -m "feat(cart): per-line decoration + full PriceBreakdown totals

Per-line: decoration price/unit shown under variant label when > 0;
line total includes (unit + decoration) × qty. Totals panel replaces
flat subtotal with TierBadge + PriceBreakdown (subtotal → decoration
→ discount → GST → total).

Refs WS4 plan task 11."
```

---

### Task 12: Checkout review breakdown

**Files:**
- Modify: `components/checkout/CheckoutClient.tsx`

- [ ] **Step 1: Add imports**

```ts
import { usePricingContext } from '@/lib/pricing/usePricingContext'
import { computeOrderBreakdown } from '@/lib/pricing/pricingMath'
import { PriceBreakdown } from '@/components/pricing/PriceBreakdown'
import { TierBadge } from '@/components/pricing/TierBadge'
```

- [ ] **Step 2: Replace the existing flat-subtotal block**

Find and replace the existing `subtotal` computation:

```tsx
  const pricing_ctx = usePricingContext()
  const breakdown = computeOrderBreakdown({
    lines: cart.lines.map((l) => ({
      qty: l.qty,
      unitEffective: l.unitPrice,
      decorationPerUnit: l.decorationPrice ?? 0,
    })),
    tierDiscount: pricing_ctx.tierDiscount,
    pricingMode: pricing_ctx.pricingMode,
    gstRate: 0.15,
  })
  const depositPct = defaultDepositPercent ?? 0
  const depositAmount = (breakdown.netSubtotal * depositPct) / 100
```

Replace the existing summary `<section>` (the one rendering `Subtotal`) with:

```tsx
      <section className="mt-6 rounded-xl border border-gray-100 bg-white p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="text-sm text-gray-700">Pricing for</span>
          <TierBadge label={pricing_ctx.tierLabel} pricingMode={pricing_ctx.pricingMode} />
        </div>
        <PriceBreakdown
          breakdown={breakdown}
          pricingMode={pricing_ctx.pricingMode}
          tierLabel={pricing_ctx.tierLabel}
          tierDiscount={pricing_ctx.tierDiscount}
          variant="checkout-review"
        />
      </section>
```

The deposit banner block above (using `subtotal`) needs `breakdown.netSubtotal` in its dollar formula — update:

```tsx
      {depositPct > 0 && (
        <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
          A deposit of {depositPct}% (${depositAmount.toFixed(2)}) will be
          invoiced up-front. Balance on {paymentTerms ?? 'net20'}.
        </div>
      )}
```

(Already correct — `depositAmount` derives from `breakdown.netSubtotal` now.)

- [ ] **Step 3: Type-check**

```bash
cd C:/Users/MSI/Documents/Projects/print-room-portal && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add components/checkout/CheckoutClient.tsx
git commit -m "feat(checkout): review shows full PriceBreakdown identical to cart

Customer sees the same subtotal/decoration/discount/GST/total
breakdown on /checkout that they saw on /cart, plus the tier badge.
Math reconciles to cents because it shares the same pricingMath
helper.

Refs WS4 plan task 12."
```

---

### Task 13: Final verification — full build, tests, manual smoke checklist

**Files:** none (verification only)

- [ ] **Step 1: Run all tests**

```bash
cd C:/Users/MSI/Documents/Projects/print-room-portal && npm test
```

Expected: all suites green (tier-labels, pricingMath, company, usePricingContext, TierBadge, DiscountLine, PriceBreakdown).

- [ ] **Step 2: Production build**

```bash
cd C:/Users/MSI/Documents/Projects/print-room-portal && npm run build
```

Expected: build completes without errors. Resolve any type drift here.

- [ ] **Step 3: Lint**

```bash
cd C:/Users/MSI/Documents/Projects/print-room-portal && npm run lint
```

Expected: zero errors. Warnings on existing files OK.

- [ ] **Step 4: Manual smoke checklist (when Jamie runs the app)**

```
[ ] Sign in as hello@theprint-room.co.nz → /shop loads
[ ] Each card top-right shows "Catalogue pricing" badge (PRT is catalogue-scoped)
[ ] No "Wholesale −10%" anywhere — would be a bug (catalogue prices are absolute)
[ ] Click into Cord Bucket Hat PDP → "Catalogue pricing" badge next to title
[ ] PDP price block: Subtotal $7.75 / GST 1.16 / Total $8.91 (qty 1, no decoration on this product)
[ ] Add 50 to cart → cart shows "Catalogue pricing" badge in totals panel
[ ] Cart totals: Subtotal $387.50 / GST $58.13 / Total $445.63 — NO discount line
[ ] /checkout shows the same breakdown
[ ] (Out of band) Flip a test user's b2b_accounts.tier_level=2 + delete b2b_catalogues row → see "Trade pricing" + "Your Trade discount: −$X.XX (−5%)" line
```

- [ ] **Step 5: Math verification table for the implementation summary**

For PRT smoke product **Cord Bucket Hat × 50**:

| Component | Value |
|---|---|
| Mode | catalogue |
| Tier label | Wholesale (captured but unused for math) |
| Effective unit | $7.75 |
| Gross unit | $7.75 (catalogue mode = no inversion) |
| Qty | 50 |
| Line gross / net | $387.50 / $387.50 |
| Decoration | $0 (master decoration_price=0) |
| Discount | $0 (catalogue mode) |
| GST (15%) | $58.13 |
| Total | $445.63 |

For a hypothetical **Tier-2 (Trade) non-catalogue org, 10 × $9.00 with $1.50 decoration**:

| Component | Value |
|---|---|
| Mode | tiered |
| Tier label | Trade |
| Effective unit | $9.00 |
| Gross unit | $9.47 (= 9 / 0.95) |
| Decoration / unit | $1.50 |
| Qty | 10 |
| Line gross | $109.74 (= 10 × (9.47 + 1.50)) |
| Discount | $4.74 (= 10 × (9.47 - 9.00)) |
| Decoration total | $15.00 |
| Net subtotal | $105.00 |
| GST (15%) | $15.75 |
| Total | $120.75 |

(For the spec §10 example "$10 base, $2.50 decoration, Wholesale −15% −$1.88, total $10.62" the math validates as gross $10 × 1 × (1-0.15) = $8.50 effective + $2.50 decoration = $11.00 pre-GST. The spec example treats decoration as outside-discount; our `pricingMath` does the same — `lineDiscount = qty × (unitGross - unitEffective)`, decoration is added separately to lineGross but not multiplied by the discount ratio. ✅)

- [ ] **Step 6: Push-readiness check**

Per controller direction: do NOT push. Leave commits on `feat/ws4-pricing-visibility` for Jamie's review.

```bash
cd C:/Users/MSI/Documents/Projects/print-room-portal && git log --oneline main..HEAD
```

Expected: 12 commits (1 chore + 11 feat/fix), all on `feat/ws4-pricing-visibility`. No `git push`.

---

## Self-Review

**Spec coverage:**
- §2 Goals — all four bullets covered (tier name visible, discount as line, decoration as line, breakdown reads end-to-end). ✅
- §4 Architecture — labels in `lib/pricing/tier-labels.ts` (Task 2), `usePricingContext` (Task 6), surfaces (Tasks 9-12). Spec §4.4 client-compute formula is implemented in `pricingMath.ts` (Task 3) WITH catalogue-mode override (surfaced edge case). ✅
- §5 Data model: zero changes. ✅
- §6 Components: TierBadge (T7), DiscountLine + PriceBreakdown (T8). Modified surfaces: ProductCard (T9), ProductDetailClient (T10), CartTable + CartClient (T11), CheckoutClient (T12). Welcome page deferred to WS5 — TierBadge is exported with prop-driven API for clean reuse (Task 7 step 4). ✅
- §7 API contracts: `getCompanyAccess` extension covered in T5; `B2BCustomerAccess` interface change typed. ✅
- §9 Locked decisions: #1 names ✅ (T2), #2 location ✅ (T2), #3 client-compute ✅ (T3, with catalogue carve-out flagged), #4 decoration always-shown ✅ (T11 + T8 PriceBreakdown gating on `decorationTotal > 0`), #5 badge placement ✅ (T9 card, T10 PDP, T11/T12 cart/checkout panels), #6 discount line copy ✅ (T8 DiscountLine — exact "Your {Label} discount: −$X.XX (−N%)"), #7 empty-decoration ✅ (PricingMath treats null/0 as 0; PriceBreakdown skips line). ✅
- §10 Verification: covered in Task 13 manual smoke checklist + math tables. ✅
- §11 v1.1 follow-ups noted (catalogue decoration override; DB-backed tier label config). ✅
- §12 Q1/Q2/Q3: defaults applied per controller (separate discount line; tier name only on welcome; no badge for no-b2b customers).

**Placeholder scan:** every test step shows actual test code; every implementation step shows actual TypeScript; every command shows the exact `cd` + binary call. No "TBD". No "similar to". No "appropriate error handling". ✅

**Type consistency:** `PricingContext` shape (T1) used unchanged by `usePricingContext` (T6) and primitives (T7/T8/T10/T11/T12). `OrderBreakdown` shape (T1) used unchanged by `computeOrderBreakdown` (T3) and `PriceBreakdown` (T8). `B2BCustomerAccess` field names (`tierLabel`, `tierDiscount`, `pricingMode`) consistent across T5 (definition), T6 (consumer), T9/T10/T11/T12 (consumers via hook). ✅

**Decoration-override note:** spec §4.3 cites `b2b_catalogue_items.decoration_price_override` but the PDP page does not currently SELECT it (verified `app/(portal)/shop/[productId]/page.tsx`). For v1 we display the master `products.decoration_price` only — added explicit v1.1 follow-up. Surfaceable to controller if Jamie wants override-aware display in WS4 scope.

**One open spec item:** spec §4.4 verification example talks about a 15% Wholesale discount. The seeded `price_tiers` row for tier '1' is **0.10 = 10%**, not 15%. The spec text appears illustrative ("(illustrative)"). Math implementation is fraction-driven so the percent floats with whatever's in `price_tiers`. No code change needed — flagged in case the spec example was meant as a target.
