import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CartLine } from '@/lib/cart/types'

vi.mock('@/app/(portal)/cart/PeriodSavingsBar', () => ({
  PeriodSavingsBar: () => null,
}))
vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({ format: (n: number) => `$${n.toFixed(2)}` }),
}))
vi.mock('@/components/layout/PortalTopBarContext', () => ({
  useCartDrawer: () => ({ open: true, setOpen: vi.fn() }),
}))
vi.mock('next/navigation', () => ({
  usePathname: () => '/catalogue',
  useRouter: () => ({ push: vi.fn() }),
}))

const company = vi.hoisted(() => ({
  value: {
    access: {
      role: 'org_admin',
      isBuyer: false,
      // Widened: one case below flips this to 'franchise'.
      tenantType: null as 'franchise' | 'studio_plus_inventory' | 'studio' | null,
    },
    countryPartitionEnabled: false,
    defaultBillingCountry: {
      code: 'NZ',
      name: 'New Zealand',
      currency: 'NZD',
      taxRate: 0.15,
      taxLabel: 'GST 15%',
      isDefault: true,
    },
    minimumOrderExemptions: { orgExempt: false, isTest: false },
  },
}))
vi.mock('@/contexts/CompanyContext', () => ({
  useCompany: () => company.value,
}))

const cart = vi.hoisted(() => ({ lines: [] as CartLine[] }))
vi.mock('../useCart', () => ({
  useCart: () => ({
    lines: cart.lines,
    updateLine: vi.fn(),
    removeLine: vi.fn(),
    setFulfilmentType: vi.fn(),
  }),
}))

import { CartDrawer } from '../CartDrawer'

function line(overrides: Partial<CartLine> = {}): CartLine {
  return {
    lineId: 'line-1',
    productId: 'product-1',
    productName: 'Canvas Tote',
    variantId: 'variant-1',
    variantLabel: 'Natural',
    qty: 38,
    unitPrice: 10,
    imageUrl: null,
    decorations: [],
    fulfilmentType: 'made_to_order',
    catalogueItemId: 'item-1',
    ...overrides,
  } as CartLine
}

/** No open ordering period. */
function stubNoPeriod() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ period: null, items: [] }) })),
  )
}

beforeEach(() => {
  vi.unstubAllGlobals()
  stubNoPeriod()
  cart.lines = [line()]
  company.value.access = { role: 'org_admin', isBuyer: false, tenantType: null }
  company.value.minimumOrderExemptions = { orgExempt: false, isTest: false }
})

describe('CartDrawer $500 minimum', () => {
  it('shows the notice and disables checkout when no exemption is possible', async () => {
    render(<CartDrawer />)
    await waitFor(() =>
      expect(screen.getByTestId('minimum-order-notice')).toBeTruthy(),
    )
    expect(screen.getByTestId('minimum-order-notice').textContent).toContain(
      'add $120 to continue',
    )
    expect(
      screen.getByRole('button', { name: 'Proceed to Checkout' }),
    ).toBeDisabled()
  })

  it('warns but leaves checkout enabled when the org can route to inventory', async () => {
    company.value.access = { role: 'org_admin', isBuyer: false, tenantType: 'franchise' }
    render(<CartDrawer />)
    await waitFor(() =>
      expect(screen.getByTestId('minimum-order-notice')).toBeTruthy(),
    )
    expect(screen.getByTestId('minimum-order-notice').textContent).toContain(
      'may be below the minimum',
    )
    expect(
      screen.getByRole('button', { name: 'Proceed to Checkout' }),
    ).not.toBeDisabled()
  })

  it('shows nothing for an exempt org', async () => {
    company.value.minimumOrderExemptions = { orgExempt: true, isTest: false }
    render(<CartDrawer />)
    await waitFor(() =>
      expect(screen.queryByTestId('minimum-order-notice')).toBeNull(),
    )
    expect(
      screen.getByRole('button', { name: 'Proceed to Checkout' }),
    ).not.toBeDisabled()
  })

  it('shows nothing once the cart clears the minimum', async () => {
    cart.lines = [line({ qty: 50 })]
    render(<CartDrawer />)
    await waitFor(() =>
      expect(screen.queryByTestId('minimum-order-notice')).toBeNull(),
    )
  })

  it('shows nothing for a stocked cart', async () => {
    cart.lines = [line({ fulfilmentType: 'stocked' })]
    render(<CartDrawer />)
    await waitFor(() =>
      expect(screen.queryByTestId('minimum-order-notice')).toBeNull(),
    )
  })
})
