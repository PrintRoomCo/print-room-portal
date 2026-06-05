# From-inventory production top-up — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an org_admin ordering from the **From inventory** pill exceed available stock for a size — drawing the in-stock units down and routing the shortfall into a production run, gated so the to-be-made total reaches the product's MOQ before it can reach the cart.

**Architecture:** Pure client-side change in one PDP component (`ProductDetailClient.tsx`) plus its tests. A new scope flag `isInventoryOverflowScope` (org_admin + From-inventory pill + non-stocked + stock + tiers) relaxes the existing `inventoryIntentShortfall` hard cap and replaces it with a `madeMoqShortfall` guard on the summed to-be-made units. On Add-to-cart, an overflowing variant is split into a `'stocked'` line (draws inventory, MOQ-exempt) and a `'make_to_stock'` line (production run, counts toward MOQ). The server (`lib/checkout/submit.ts`) already sums `make_to_stock` qty per product against MOQ and exempts `'stocked'` lines — **no server change**.

**Tech Stack:** Next.js (App Router) client component, React hooks, Vitest + @testing-library/react (jsdom).

**Spec:** `docs/superpowers/specs/2026-06-05-from-inventory-production-topup-design.md`

---

## File Structure

- **Modify:** `components/shop/ProductDetailClient.tsx`
  - add `isInventoryOverflowScope` derived flag (after `isInventoryMode`)
  - add `toBeMadeSum` derived value (after `orderLines`)
  - gate `inventoryIntentShortfall` to the non-overflow case; add `madeMoqShortfall`
  - split cart lines in `handleAddToCart` (Mode 1 multi-size, Mode 3 one_size)
  - add the overflow status block under Add-to-cart; relax the size-grid "to be made" caption
- **Create:** `components/shop/__tests__/ProductDetailClient.inventory-overflow.test.tsx`
- **Unchanged (verify green):** `lib/checkout/submit.ts`, existing `ProductDetailClient.*.test.tsx`

Out of scope: `multi_size_variantless` (untracked, no stock to split), restricted-staff role (hard cap preserved), `stocked`-only products (no production tiers).

---

## Task 1: Scope flag, MOQ guard, and overflow status UI

**Files:**
- Modify: `components/shop/ProductDetailClient.tsx`
- Test: `components/shop/__tests__/ProductDetailClient.inventory-overflow.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `components/shop/__tests__/ProductDetailClient.inventory-overflow.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProductDetailClient } from '../ProductDetailClient'

const { addLine } = vi.hoisted(() => ({ addLine: vi.fn() }))
vi.mock('@/components/cart/useCart', () => ({ useCart: () => ({ addLine }) }))
vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({ format: (n: number) => `$${n}` }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ back: vi.fn() }) }))

const baseProduct = {
  id: 'p1',
  name: 'Tee',
  description: null,
  image_url: null,
  moq: 24,
  lead_time_days: 7,
  sizing_type: 'multi_size_with_variants',
  decoration_methods: null,
  decoration_price: null,
  sku: null,
  safety_standard: null,
  specs: null,
  supports_labels: null,
  garment_family: null,
  default_sizes: null,
  brand_name: null,
  category_name: null,
  catalogueItemId: 'i1',
  catalogueVariantLabel: null,
}

// Red S has 4 in stock; Red M is out of stock (hidden in inventory mode).
const variants = [
  {
    variant_id: 'red-s',
    color_swatch_id: 'red',
    color_label: 'Red',
    color_hex: '#f00',
    color_position: 0,
    size_id: 1,
    size_label: 'S',
    size_order: 0,
  },
  {
    variant_id: 'red-m',
    color_swatch_id: 'red',
    color_label: 'Red',
    color_hex: '#f00',
    color_position: 0,
    size_id: 2,
    size_label: 'M',
    size_order: 1,
  },
]
const availability = {
  'red-s': { available_qty: 4, allow_order_without_stock: false },
  'red-m': { available_qty: 0, allow_order_without_stock: false },
} as never

function renderPDP(role: 'org_admin' | 'staff' = 'org_admin') {
  return render(
    <ProductDetailClient
      product={{ ...baseProduct, fulfilment_type: 'mixed' }}
      variants={variants}
      brackets={[{ min_quantity: 1, max_quantity: null, unit_price: 10 }]}
      availability={availability}
      organizationId="o1"
      customerRole={role}
      images={[]}
      colourOptions={[]}
      decorations={[]}
      effectiveMoq={24}
    />,
  )
}

beforeEach(() => addLine.mockClear())

describe('PDP From-inventory production top-up — MOQ guard', () => {
  it('overflow below MOQ shows the production-minimum block message', () => {
    renderPDP('org_admin')
    // Request 5 of S (4 in stock) → 1 to be made, below MOQ 24.
    fireEvent.change(screen.getByLabelText('Quantity for size S'), {
      target: { value: '5' },
    })
    expect(
      screen.getByText(/Production run minimum is 24/i),
    ).toBeInTheDocument()
    expect(screen.getByText(/1 to be made/i)).toBeInTheDocument()
    expect(screen.getByText(/add 23 more/i)).toBeInTheDocument()
  })

  it('overflow at/above MOQ shows the neutral hint, not the block', () => {
    renderPDP('org_admin')
    // Request 28 of S (4 in stock) → 24 to be made, meets MOQ 24.
    fireEvent.change(screen.getByLabelText('Quantity for size S'), {
      target: { value: '28' },
    })
    expect(screen.queryByText(/Production run minimum is/i)).not.toBeInTheDocument()
    expect(screen.getByText(/24 to be made · production min 24/i)).toBeInTheDocument()
  })

  it('pure stock draw (within stock) shows no overflow messaging', () => {
    renderPDP('org_admin')
    fireEvent.change(screen.getByLabelText('Quantity for size S'), {
      target: { value: '3' },
    })
    expect(screen.queryByText(/Production run minimum is/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/to be made · production min/i)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd print-room-portal && pnpm vitest run components/shop/__tests__/ProductDetailClient.inventory-overflow.test.tsx`
Expected: FAIL — the production-minimum / hint text does not render yet (block does not exist).

- [ ] **Step 3: Add the scope flag and `toBeMadeSum`**

In `components/shop/ProductDetailClient.tsx`, immediately AFTER the `isInventoryMode` declaration (the block ending at the `(canChooseOrderIntent && orderIntent === 'inventory')` line, ~L244), add:

```tsx
  // Org_admin drawing From inventory may overflow a size's available stock:
  // the in-stock units are drawn down and the shortfall becomes a production
  // run. Restricted staff and stocked-only products are NOT in scope — they
  // keep the hard cap at available stock (inventoryIntentShortfall below).
  const isInventoryOverflowScope = canChooseOrderIntent && orderIntent === 'inventory'
```

Then, immediately AFTER the `orderLines` `useMemo` (ends ~L314), add:

```tsx
  // Total units that exceed available stock across every touched variant — the
  // production ("to be made") portion of a From-inventory order. Summed per
  // product to match the server-side MOQ rollup (lib/checkout/submit.ts). Only
  // meaningful inside isInventoryOverflowScope.
  const toBeMadeSum = useMemo(() => {
    if (!isInventoryOverflowScope) return 0
    if (sizingMode === 'multi_size_with_variants') {
      return orderLines.reduce((sum, line) => sum + line.toBeMade, 0)
    }
    // one_size: a single selected variant.
    if (selectedVariant) {
      const avail = availability[selectedVariant.variant_id]?.available_qty ?? 0
      return Math.max(0, qty - avail)
    }
    return 0
  }, [
    isInventoryOverflowScope,
    sizingMode,
    orderLines,
    selectedVariant,
    availability,
    qty,
  ])
```

Note: `qty` and `selectedVariant` are declared earlier in the component, so this `useMemo` can reference them.

- [ ] **Step 4: Gate the old shortfall and add the MOQ guard**

In `components/shop/ProductDetailClient.tsx`, change the guard block (~L737-778). Replace the opening `if (isInventoryMode) {` with the gated form and append the new `madeMoqShortfall` computation. The full replacement region:

```tsx
  let inventoryIntentShortfall: {
    label: string
    available: number
    backorderable: boolean
  } | null = null
  // Hard cap stays for everyone EXCEPT the org_admin From-inventory overflow
  // scope, where exceeding stock is allowed and routed into a production run.
  if (isInventoryMode && !isInventoryOverflowScope) {
    if (sizingMode === 'multi_size_with_variants') {
      for (const variant of variants) {
        const requested = variantQuantities[variant.variant_id] ?? 0
        if (requested <= 0) continue
        const a = availability[variant.variant_id]
        const backorderable = a?.allow_order_without_stock === true
        if (backorderable && !canChooseOrderIntent) continue
        const available = a?.available_qty ?? 0
        if (requested > available) {
          const label =
            [variant.color_label, variant.size_label].filter(Boolean).join(' / ') ||
            'selected variant'
          inventoryIntentShortfall = {
            label,
            available,
            backorderable,
          }
          break
        }
      }
    } else if (selectedVariant && qty > (availableQty ?? 0)) {
      if (!(selectedVariantBackorderable && !canChooseOrderIntent)) {
        inventoryIntentShortfall = {
          label: 'selected variant',
          available: availableQty ?? 0,
          backorderable: selectedVariantBackorderable,
        }
      }
    }
  }

  // Production top-up MOQ guard (org_admin From-inventory overflow only). The
  // to-be-made units trigger a production run, which must reach the product's
  // real MOQ. Pure stock draws (toBeMadeSum === 0) are exempt; the server check
  // in lib/checkout/submit.ts is the redundant safety net behind this.
  let madeMoqShortfall: { toBeMade: number; moq: number; needed: number } | null =
    null
  if (
    isInventoryOverflowScope &&
    toBeMadeSum > 0 &&
    effectiveMoq > 1 &&
    toBeMadeSum < effectiveMoq
  ) {
    madeMoqShortfall = {
      toBeMade: toBeMadeSum,
      moq: effectiveMoq,
      needed: effectiveMoq - toBeMadeSum,
    }
  }

  const canSubmitSelection =
    canAddToCart && inventoryIntentShortfall == null && madeMoqShortfall == null
```

(This preserves the original `inventoryIntentShortfall` logic verbatim, only wrapping it in `!isInventoryOverflowScope`, and adds `madeMoqShortfall` plus its term in `canSubmitSelection`.)

- [ ] **Step 5: Add the overflow status block under Add-to-cart**

In `components/shop/ProductDetailClient.tsx`, the Add-to-cart `<section>` already renders the `inventoryIntentShortfall` message after the button (~L1116-1126). Immediately AFTER that `{inventoryIntentShortfall && ( … )}` block, add:

```tsx
            {isInventoryOverflowScope && toBeMadeSum > 0 && (
              madeMoqShortfall ? (
                <p className="mt-3 text-xs text-amber-700">
                  Production run minimum is {madeMoqShortfall.moq}.{' '}
                  {madeMoqShortfall.toBeMade} to be made — add{' '}
                  {madeMoqShortfall.needed} more, or reduce to draw only from
                  stock.
                </p>
              ) : (
                <p className="mt-3 text-xs text-gray-500">
                  {toBeMadeSum} to be made · production min {effectiveMoq}
                </p>
              )
            )}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd print-room-portal && pnpm vitest run components/shop/__tests__/ProductDetailClient.inventory-overflow.test.tsx`
Expected: PASS (all three cases in the MOQ-guard describe block).

- [ ] **Step 7: Commit**

```bash
git add components/shop/ProductDetailClient.tsx components/shop/__tests__/ProductDetailClient.inventory-overflow.test.tsx
git commit -m "feat(pdp): from-inventory overflow MOQ guard + status UI"
```

---

## Task 2: Split the cart line on Add-to-cart (multi-size)

**Files:**
- Modify: `components/shop/ProductDetailClient.tsx` (`handleAddToCart`, Mode 1 loop ~L612-662)
- Test: `components/shop/__tests__/ProductDetailClient.inventory-overflow.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `ProductDetailClient.inventory-overflow.test.tsx`. Add `waitFor` to the import line first:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
```

Then add this describe block at the end of the file:

```tsx
describe('PDP From-inventory production top-up — cart split (multi-size)', () => {
  beforeEach(() => {
    // Pricing is fetched (debounced) before Add-to-cart enables. Stub it OK.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ status: 'ok', unit_price: 10 }),
      })),
    )
  })

  it('overflowing variant adds a stocked line + a make_to_stock line', async () => {
    renderPDP('org_admin')
    // 28 of S, 4 in stock → 4 stocked + 24 made (meets MOQ 24).
    fireEvent.change(screen.getByLabelText('Quantity for size S'), {
      target: { value: '28' },
    })
    const btn = screen.getByRole('button', { name: /add to cart/i })
    await waitFor(() => expect(btn).toBeEnabled())
    fireEvent.click(btn)

    expect(addLine).toHaveBeenCalledTimes(2)
    expect(addLine).toHaveBeenCalledWith(
      expect.objectContaining({
        variantId: 'red-s',
        qty: 4,
        fulfilmentType: 'stocked',
      }),
    )
    expect(addLine).toHaveBeenCalledWith(
      expect.objectContaining({
        variantId: 'red-s',
        qty: 24,
        fulfilmentType: 'make_to_stock',
      }),
    )
  })

  it('within-stock variant adds a single stocked line', async () => {
    renderPDP('org_admin')
    fireEvent.change(screen.getByLabelText('Quantity for size S'), {
      target: { value: '3' },
    })
    const btn = screen.getByRole('button', { name: /add to cart/i })
    await waitFor(() => expect(btn).toBeEnabled())
    fireEvent.click(btn)

    expect(addLine).toHaveBeenCalledTimes(1)
    expect(addLine).toHaveBeenCalledWith(
      expect.objectContaining({
        variantId: 'red-s',
        qty: 3,
        fulfilmentType: 'stocked',
      }),
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd print-room-portal && pnpm vitest run components/shop/__tests__/ProductDetailClient.inventory-overflow.test.tsx -t "cart split"`
Expected: FAIL — currently one line of qty 28 with `fulfilmentType: 'stocked'` is added (no split).

- [ ] **Step 3: Implement the split in the Mode 1 loop**

In `handleAddToCart`, Mode 1 (`if (sizingMode === 'multi_size_with_variants') {`), replace the body of the `for (const variant of variants) { … }` loop (the part from `const a = availability...` through the single `cart.addLine({ … })` call, ~L619-655) with:

```tsx
        const a = availability[variant.variant_id]
        const tracked = a !== undefined
        const available = tracked ? a.available_qty : 0
        const backorderable = tracked && a.allow_order_without_stock

        const baseLine = {
          productId: product.id,
          productName: product.name,
          variantId: variant.variant_id,
          variantLabel,
          unitPrice: pricing.unit_price,
          imageUrl: cartImageForSwatch(variant.color_swatch_id),
          decorations: cartDecorationsForSwatch(variant.color_swatch_id),
          brackets: cartLineBrackets,
          catalogueItemId: product.catalogueItemId,
          catalogueVariantLabel: product.catalogueVariantLabel,
        }

        // Org_admin From-inventory overflow: split a partial-stock variant into
        // a stocked draw + a make_to_stock production line. The server MOQ
        // engine then counts only the production portion and inventory draws
        // only the stocked portion. lineSignature keys on fulfilmentType, so
        // the two lines never merge in the cart.
        if (
          isInventoryOverflowScope &&
          tracked &&
          !backorderable &&
          lineQty > available
        ) {
          if (available > 0) {
            cart.addLine({ ...baseLine, qty: available, fulfilmentType: 'stocked' })
          }
          cart.addLine({
            ...baseLine,
            qty: lineQty - available,
            fulfilmentType: 'make_to_stock',
          })
          added += lineQty
          continue
        }

        // Fulfilment decision (unchanged): toggle choice wins for org_admin;
        // buyer/no-toggle auto-routes backorderable to make_to_stock, else
        // stock-vs-qty.
        const fulfilmentType: 'stocked' | 'make_to_stock' = canChooseOrderIntent
          ? orderIntent === 'bulk'
            ? 'make_to_stock'
            : 'stocked'
          : backorderable
            ? 'make_to_stock'
            : tracked && lineQty > available
              ? 'make_to_stock'
              : 'stocked'
        cart.addLine({ ...baseLine, qty: lineQty, fulfilmentType })
        added += lineQty
```

(The `const variantLabel = …` line just above this region stays as-is. This preserves the original non-overflow fulfilment logic — note the original always passed `fulfilmentType: 'stocked'` for an org_admin in inventory mode within stock, which `baseLine` + the unchanged decision tree still produces.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd print-room-portal && pnpm vitest run components/shop/__tests__/ProductDetailClient.inventory-overflow.test.tsx -t "cart split"`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add components/shop/ProductDetailClient.tsx components/shop/__tests__/ProductDetailClient.inventory-overflow.test.tsx
git commit -m "feat(pdp): split overflowing from-inventory variant into stocked + make_to_stock lines"
```

---

## Task 3: Split the cart line on Add-to-cart (one_size)

**Files:**
- Modify: `components/shop/ProductDetailClient.tsx` (`handleAddToCart`, Mode 3 ~L696-723)
- Test: `components/shop/__tests__/ProductDetailClient.inventory-overflow.onesize.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `components/shop/__tests__/ProductDetailClient.inventory-overflow.onesize.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProductDetailClient } from '../ProductDetailClient'

const { addLine } = vi.hoisted(() => ({ addLine: vi.fn() }))
vi.mock('@/components/cart/useCart', () => ({ useCart: () => ({ addLine }) }))
vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({ format: (n: number) => `$${n}` }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ back: vi.fn() }) }))

const product = {
  id: 'tote1',
  name: 'Tote',
  description: null,
  image_url: null,
  moq: 24,
  lead_time_days: 7,
  sizing_type: 'one_size',
  fulfilment_type: 'mixed' as const,
  decoration_methods: null,
  decoration_price: null,
  sku: null,
  safety_standard: null,
  specs: null,
  supports_labels: null,
  garment_family: null,
  default_sizes: null,
  brand_name: null,
  category_name: null,
  catalogueItemId: 'i1',
  catalogueVariantLabel: null,
}

// Single one-size variant with 4 in stock.
const variants = [
  {
    variant_id: 'os',
    color_swatch_id: 'natural',
    color_label: 'Natural',
    color_hex: '#eee',
    color_position: 0,
    size_id: 1,
    size_label: 'OS',
    size_order: 0,
  },
]
const availability = {
  os: { available_qty: 4, allow_order_without_stock: false },
} as never

function renderPDP() {
  return render(
    <ProductDetailClient
      product={product}
      variants={variants}
      brackets={[{ min_quantity: 1, max_quantity: null, unit_price: 10 }]}
      availability={availability}
      organizationId="o1"
      customerRole="org_admin"
      images={[]}
      colourOptions={[]}
      decorations={[]}
      effectiveMoq={24}
    />,
  )
}

beforeEach(() => {
  addLine.mockClear()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: 'ok', unit_price: 10 }),
    })),
  )
})

describe('PDP From-inventory production top-up — cart split (one_size)', () => {
  it('overflowing one_size order adds a stocked line + a make_to_stock line', async () => {
    renderPDP()
    // 28 ordered, 4 in stock → 4 stocked + 24 made (meets MOQ 24).
    fireEvent.change(screen.getByLabelText('Quantity'), {
      target: { value: '28' },
    })
    const btn = screen.getByRole('button', { name: /add to cart/i })
    await waitFor(() => expect(btn).toBeEnabled())
    fireEvent.click(btn)

    expect(addLine).toHaveBeenCalledTimes(2)
    expect(addLine).toHaveBeenCalledWith(
      expect.objectContaining({ qty: 4, fulfilmentType: 'stocked' }),
    )
    expect(addLine).toHaveBeenCalledWith(
      expect.objectContaining({ qty: 24, fulfilmentType: 'make_to_stock' }),
    )
  })
})
```

Note: the one_size qty input is labelled `Quantity` (the `<label htmlFor="qty">Quantity</label>` at ~L1050).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd print-room-portal && pnpm vitest run components/shop/__tests__/ProductDetailClient.inventory-overflow.onesize.test.tsx`
Expected: FAIL — currently one line of qty 28 is added (no split).

- [ ] **Step 3: Implement the split in Mode 3**

In `handleAddToCart`, just BEFORE the Mode 3 `oneSizeFulfilment` computation (~L700), insert the overflow split and early-return:

```tsx
    // Mode 3 org_admin From-inventory overflow: split into a stocked draw + a
    // make_to_stock production line, mirroring Mode 1.
    if (
      isInventoryOverflowScope &&
      tracksThisVariant &&
      !selectedVariantBackorderable &&
      qty > (availableQty ?? 0)
    ) {
      const avail = availableQty ?? 0
      const oneSizeBase = {
        productId: product.id,
        productName: product.name,
        variantId: '',
        variantLabel: '—',
        unitPrice: pricing.unit_price,
        imageUrl: cartImageForSwatch(colorSwatchId),
        decorations: cartDecorationsForSwatch(colorSwatchId),
        brackets: cartLineBrackets,
        catalogueItemId: product.catalogueItemId,
        catalogueVariantLabel: product.catalogueVariantLabel,
      }
      if (avail > 0) {
        cart.addLine({ ...oneSizeBase, qty: avail, fulfilmentType: 'stocked' })
      }
      cart.addLine({
        ...oneSizeBase,
        qty: qty - avail,
        fulfilmentType: 'make_to_stock',
      })
      showToast('Added to cart')
      return
    }

```

The existing `const oneSizeFulfilment …` block and its `cart.addLine({ … })` stay unchanged immediately after this insert.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd print-room-portal && pnpm vitest run components/shop/__tests__/ProductDetailClient.inventory-overflow.onesize.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/shop/ProductDetailClient.tsx components/shop/__tests__/ProductDetailClient.inventory-overflow.onesize.test.tsx
git commit -m "feat(pdp): split overflowing one_size from-inventory order into stocked + make_to_stock lines"
```

---

## Task 4: Show per-row "to be made" in the size grid during overflow

**Files:**
- Modify: `components/shop/ProductDetailClient.tsx` (size-grid caption ~L921)
- Test: `components/shop/__tests__/ProductDetailClient.inventory-overflow.test.tsx`

- [ ] **Step 1: Write the failing test**

Append this describe block to `ProductDetailClient.inventory-overflow.test.tsx`:

```tsx
describe('PDP From-inventory production top-up — size grid caption', () => {
  it('shows per-size "to be made" once a size overflows its stock', () => {
    renderPDP('org_admin')
    fireEvent.change(screen.getByLabelText('Quantity for size S'), {
      target: { value: '28' },
    })
    // S row Available cell now annotates the 24-unit production portion.
    expect(screen.getByText(/\(24 to be made\)/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd print-room-portal && pnpm vitest run components/shop/__tests__/ProductDetailClient.inventory-overflow.test.tsx -t "size grid caption"`
Expected: FAIL — the caption is currently gated behind `!isInventoryMode`, which is false in inventory mode.

- [ ] **Step 3: Relax the caption gate**

In `components/shop/ProductDetailClient.tsx`, change the size-grid caption condition (~L921) from:

```tsx
                          {!isInventoryMode && backorder > 0 && !showBackorderableChip && (
```

to:

```tsx
                          {(!isInventoryMode || isInventoryOverflowScope) && backorder > 0 && !showBackorderableChip && (
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd print-room-portal && pnpm vitest run components/shop/__tests__/ProductDetailClient.inventory-overflow.test.tsx -t "size grid caption"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/shop/ProductDetailClient.tsx components/shop/__tests__/ProductDetailClient.inventory-overflow.test.tsx
git commit -m "feat(pdp): show per-size to-be-made caption during from-inventory overflow"
```

---

## Task 5: Restricted-staff regression + full-suite verification

**Files:**
- Test: `components/shop/__tests__/ProductDetailClient.inventory-overflow.test.tsx`

- [ ] **Step 1: Write the failing test (regression guard)**

Append this describe block to `ProductDetailClient.inventory-overflow.test.tsx`:

```tsx
describe('PDP From-inventory production top-up — restricted staff unchanged', () => {
  it('staff cannot overflow: no production hint, Add-to-cart stays blocked', () => {
    renderPDP('staff')
    // Staff are inventory-only; the in-stock-only filter keeps S visible.
    fireEvent.change(screen.getByLabelText('Quantity for size S'), {
      target: { value: '28' },
    })
    // No production top-up surfaces for restricted staff…
    expect(screen.queryByText(/to be made · production min/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Production run minimum is/i)).not.toBeInTheDocument()
    // …and the existing hard-cap shortfall message still fires.
    expect(screen.getByText(/Only 4 available/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it passes (no code change expected)**

Run: `cd print-room-portal && pnpm vitest run components/shop/__tests__/ProductDetailClient.inventory-overflow.test.tsx -t "restricted staff"`
Expected: PASS — `isInventoryOverflowScope` is false for staff (no `canChooseOrderIntent`), so the original `inventoryIntentShortfall` path runs unchanged. If it FAILS, the gating in Task 1 Step 4 regressed the staff path — fix before continuing.

- [ ] **Step 3: Run the full shop + checkout suites**

Run: `cd print-room-portal && pnpm vitest run components/shop lib/checkout`
Expected: PASS, including the pre-existing `ProductDetailClient.pills.test.tsx`, `ProductDetailClient.inventory-sizes.test.tsx`, `ProductDetailClient.layout.test.tsx`, and `submit.*` tests. Investigate any new failure before committing.

- [ ] **Step 4: Type-check**

Run: `cd print-room-portal && pnpm tsc --noEmit`
Expected: No new errors in `components/shop/ProductDetailClient.tsx` or the new test files. (Compare against the repo's known baseline; do not introduce new errors.)

- [ ] **Step 5: Commit**

```bash
git add components/shop/__tests__/ProductDetailClient.inventory-overflow.test.tsx
git commit -m "test(pdp): restricted staff cannot overflow from-inventory orders"
```

---

## Manual verification (after all tasks)

On a `mixed` product with tracked stock + volume tiers, as an **org_admin**, From-inventory pill:

1. Request a size qty 1 above stock → see "Production run minimum is {MOQ}… add N more"; Add-to-cart disabled.
2. Raise the made portion to ≥ MOQ → message clears, hint shows "{N} to be made · production min {MOQ}", Add-to-cart enabled.
3. Add to cart → cart shows a **From-stock** line (drawn qty) and a separate **To-be-made** line (production qty); the made line equals the production portion.
4. Proceed to checkout → no MOQ violation; order submits. Confirm in `submit_b2b_order` the made line counts toward MOQ and the stocked line draws inventory.
5. As a **restricted staff** member on the same product → no overflow; the hard cap + "Only N available" message still blocks beyond stock.

---

## Self-review notes

- **Spec coverage:** relax cap (T1/T2/T3), per-product to-be-made sum (T1 `toBeMadeSum`), MOQ floor block (T1), cart split (T2 multi-size, T3 one_size), UI hint + block message (T1), size-grid caption (T4), server no-change (verified, T5 checkout suite), restricted-staff unchanged (T5). Variantless explicitly out of scope.
- **Pricing:** stocked + made lines both carry `brackets`; `recomputeProductTierPrices` pools by `productId + decorationSignature` so total volume drives the tier on the made line — matches spec's "verify" note. Manual step 3/4 confirms cart + checkout pricing.
- **Type consistency:** `isInventoryOverflowScope` (boolean), `toBeMadeSum` (number), `madeMoqShortfall` (`{ toBeMade; moq; needed } | null`), `fulfilmentType` values `'stocked' | 'make_to_stock'` — consistent across tasks and matching `CartLineFulfilmentType` in `lib/cart/types.ts`.
