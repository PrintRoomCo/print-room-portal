# Volume pricing on stock-on-hand PDPs (invoice-on-dispatch) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the existing volume-pricing ladder on stock-on-hand product pages for invoice-on-dispatch colours, while leaving prepaid colours on their current flat "original purchase price" panel.

**Architecture:** A single per-colour gating change in `components/shop/ProductDetailClient.tsx`. The ladder's render condition is relaxed from `!isInventoryMode` to "PO mode **or** the selected colour is not prepaid". No schema, checkout, pricing-data, or new-prop changes — the ladder data (`displayVolumeBrackets`) is already computed in every mode and already respects hidden bands.

**Tech Stack:** Next.js (customer portal), React, TypeScript, Vitest + @testing-library/react.

## Global Constraints

- Repo: `/Users/jamierogangeorge/Documents/print-room-portal`, branch `feat/stock-on-hand-volume-pricing` (already created; spec committed there as `4088dac`).
- Test runner: `npx vitest run <file>` (package script `test` = `vitest run`).
- Do NOT push. Local commits only.
- Only touch `components/shop/ProductDetailClient.tsx` (one line) and a new test file. No other files.
- `selectedColourPrepaid` is `true` iff any variant of the selected colour has `billingModeByVariant[variant_id] === 'prepaid'` (`ProductDetailClient.tsx:290`). `!selectedColourPrepaid` is therefore exactly "invoice-on-dispatch".
- The ladder section is identified in tests by its header text `Volume Pricing` (`ProductDetailClient.tsx:1349`); the prepaid panel by `Prepaid Stock` / `original purchase price` (`1372`, `1378`).

---

### Task 1: Show the volume ladder for invoice-on-dispatch stock

**Files:**
- Modify: `components/shop/ProductDetailClient.tsx:1346` (one condition)
- Test: `components/shop/__tests__/ProductDetailClient.stock-volume-pricing.test.tsx` (create)

**Interfaces:**
- Consumes (existing, unchanged): `ProductDetailClient` props — `product.fulfilment_type: 'stocked' | 'made_to_order' | 'mixed'`, `brackets: {min_quantity:number; max_quantity:number|null; unit_price:number}[]`, `billingModeByVariant?: Record<string,'invoice_on_dispatch'|'prepaid'>`, `stockPurchasePriceByVariant?: Record<string,number>`, `volumeDisplayHiddenBands?: number[]`.
- Produces: no new exports. Behavioural change only.

- [ ] **Step 1: Write the failing test file**

Create `components/shop/__tests__/ProductDetailClient.stock-volume-pricing.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ProductDetailClient } from '../ProductDetailClient'

vi.mock('@/components/cart/useCart', () => ({ useCart: () => ({ addLine: vi.fn() }) }))
vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({ format: (n: number) => `$${n}` }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ back: vi.fn() }) }))

const baseProduct = {
  id: 'p1', name: 'Tee', description: null, image_url: null, moq: 1,
  lead_time_days: 7, sizing_type: 'multi_size_with_variants',
  decoration_methods: null, decoration_price: null, sku: null,
  safety_standard: null, specs: null, supports_labels: null,
  default_sizes: null, garment_family: null, brand_name: null,
  category_name: null, catalogueItemId: 'i1',
}

// Three-band ladder; format mock renders unit_price as `$<n>`.
const brackets = [
  { min_quantity: 24, max_quantity: 49, unit_price: 12.5 },
  { min_quantity: 50, max_quantity: 99, unit_price: 11.2 },
  { min_quantity: 100, max_quantity: null, unit_price: 10.4 },
]

// One variant, selected by default. billingMode + stock price + hidden bands
// are the only knobs the tests vary.
function renderPDP(opts: {
  fulfilment_type: 'stocked' | 'made_to_order'
  billingMode?: 'invoice_on_dispatch' | 'prepaid'
  stockPrice?: number
  hiddenBands?: number[]
}) {
  return render(
    <ProductDetailClient
      product={{ ...baseProduct, fulfilment_type: opts.fulfilment_type }}
      variants={[{
        variant_id: 'v1', color_swatch_id: 'red', color_label: 'Red',
        color_hex: '#f00', color_position: 0, size_id: 1,
        size_label: 'S', size_order: 0,
      }]}
      sizes={[{ size_id: 1, size_label: 'S', size_order: 0 }]}
      brackets={brackets}
      availability={{ 'v1::1': { available_qty: 5, allow_order_without_stock: false } }}
      organizationId="o1"
      customerRole="org_admin"
      orderingPermission="both"
      images={[]}
      colourOptions={[]}
      decorations={[]}
      effectiveMoq={1}
      billingModeByVariant={opts.billingMode ? { v1: opts.billingMode } : {}}
      stockPurchasePriceByVariant={opts.stockPrice != null ? { v1: opts.stockPrice } : {}}
      volumeDisplayHiddenBands={opts.hiddenBands ?? []}
    />,
  )
}

describe('PDP volume pricing on stock-on-hand (invoice-on-dispatch)', () => {
  it('invoice-on-dispatch stock shows the volume ladder', () => {
    renderPDP({ fulfilment_type: 'stocked', billingMode: 'invoice_on_dispatch' })
    expect(screen.getByText('Volume Pricing')).toBeInTheDocument()
    expect(screen.getByText(/@ \$12.5$/)).toBeInTheDocument()
    expect(screen.getByText(/@ \$10.4$/)).toBeInTheDocument()
  })

  it('prepaid stock shows the flat panel, not the ladder', () => {
    renderPDP({ fulfilment_type: 'stocked', billingMode: 'prepaid', stockPrice: 9.8 })
    expect(screen.getByText('Prepaid Stock')).toBeInTheDocument()
    expect(screen.getByText(/original purchase price/i)).toBeInTheDocument()
    expect(screen.queryByText('Volume Pricing')).not.toBeInTheDocument()
  })

  it('respects hidden display bands in stock mode', () => {
    renderPDP({ fulfilment_type: 'stocked', billingMode: 'invoice_on_dispatch', hiddenBands: [50] })
    expect(screen.getByText('Volume Pricing')).toBeInTheDocument()
    expect(screen.queryByText(/@ \$11.2$/)).not.toBeInTheDocument() // 50-band hidden
    expect(screen.getByText(/@ \$12.5$/)).toBeInTheDocument()
  })

  it('purchase-order mode still shows the ladder (unchanged)', () => {
    renderPDP({ fulfilment_type: 'made_to_order' })
    expect(screen.getByText('Volume Pricing')).toBeInTheDocument()
  })
})
```

Note on the spec's "switching colour" case: the gate is a pure function of the *selected colour's* `selectedColourPrepaid`. Tests 1 and 2 render the same stocked product differing only in the selected colour's billing mode and assert ladder vs flat panel — which is exactly the switch outcome at the props level. No click simulation needed.

- [ ] **Step 2: Run the test file to verify test 1 (and 3) fail**

Run: `npx vitest run components/shop/__tests__/ProductDetailClient.stock-volume-pricing.test.tsx`
Expected: FAIL — "invoice-on-dispatch stock shows the volume ladder" and "respects hidden display bands in stock mode" fail (ladder is currently suppressed by `!isInventoryMode`, so `Volume Pricing` is not found). Tests 2 and 4 pass already.

- [ ] **Step 3: Make the one-line change**

In `components/shop/ProductDetailClient.tsx:1346`, change the ladder's render condition:

```tsx
// before
{displayVolumeBrackets.length > 0 && !isInventoryMode && (

// after
{displayVolumeBrackets.length > 0 && (!isInventoryMode || !selectedColourPrepaid) && (
```

Leave the prepaid flat-panel block (`1369`) exactly as-is.

- [ ] **Step 4: Run the test file to verify all pass**

Run: `npx vitest run components/shop/__tests__/ProductDetailClient.stock-volume-pricing.test.tsx`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Run the existing ProductDetailClient suite for regressions**

Run: `npx vitest run components/shop`
Expected: PASS — the pre-existing `ProductDetailClient.fulfilment-fallback.test.tsx` may already be red on this branch (known pre-existing failure, unrelated to this change); every other `components/shop` test passes. Confirm no *new* failures beyond that known one.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors versus the branch baseline (the repo has a small known tsc baseline; this change adds none).

- [ ] **Step 7: Commit**

```bash
git add components/shop/ProductDetailClient.tsx components/shop/__tests__/ProductDetailClient.stock-volume-pricing.test.tsx
git commit -m "feat(pdp): show volume ladder on invoice-on-dispatch stock

Relax the volume-pricing gate so stock-on-hand product pages show the
existing ladder for non-prepaid (invoice-on-dispatch) colours, where the
draw is billed at the line price. Prepaid colours keep the flat
original-purchase-price panel. Per-colour display/gating change only.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Gap (invoice-on-dispatch shows no price) → closed by Step 3, proved by test 1. ✓
- Decision (ladder on invoice-on-dispatch only; prepaid unchanged) → Step 3 condition + test 2. ✓
- Per-colour gating → keyed on `selectedColourPrepaid`; tests 1+2. ✓
- Respect `volume_display_hidden_bands` → test 3. ✓
- PO mode unchanged → test 4. ✓
- No schema/checkout/data change → only two files touched (Global Constraints). ✓
- Correctness (invoice-on-dispatch billed at line price) → established in the spec; no code needed. ✓

**Placeholder scan:** none — full test file, exact one-line diff, exact commands and expected output.

**Type consistency:** props used in the test (`billingModeByVariant`, `stockPurchasePriceByVariant`, `volumeDisplayHiddenBands`, `brackets`, `fulfilment_type`) match the component's declared prop types (`ProductDetailClient.tsx:140,147,180/56,42,23`). The gate uses existing in-scope values `displayVolumeBrackets` (849), `isInventoryMode` (433), `selectedColourPrepaid` (290).
