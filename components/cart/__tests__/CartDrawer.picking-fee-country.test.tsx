import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CartDrawer } from '../CartDrawer'

const state = vi.hoisted(() => ({
  countryPartitionEnabled: true,
  defaultBillingCountry: {
    code: 'NZ',
    name: 'New Zealand',
    currency: 'NZD',
    taxRate: 0.15,
    taxLabel: 'GST 15%',
    isDefault: true,
  },
  cart: {
    lines: [
      {
        lineId: 'stock-line',
        productId: 'product-1',
        productName: 'Test tee',
        variantId: 'variant-1',
        variantLabel: 'Black / M',
        qty: 5,
        unitPrice: 20,
        priceCurrency: 'NZD',
        imageUrl: null,
        decorations: [],
        fulfilmentType: 'stocked' as const,
      },
    ],
    updateLine: vi.fn(),
    removeLine: vi.fn(),
    setFulfilmentType: vi.fn(),
  },
}))

vi.mock('../useCart', () => ({ useCart: () => state.cart }))
vi.mock('@/components/layout/PortalTopBarContext', () => ({
  useCartDrawer: () => ({ open: true, setOpen: vi.fn() }),
}))
vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({ format: (amount: number) => `$${amount.toFixed(2)}` }),
}))
vi.mock('@/contexts/CompanyContext', () => ({
  useCompany: () => ({
    access: { role: 'org_admin' },
    countryPartitionEnabled: state.countryPartitionEnabled,
    defaultBillingCountry: state.defaultBillingCountry,
  }),
}))
vi.mock('next/navigation', () => ({
  usePathname: () => '/catalogue',
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('../CartTable', () => ({ CartTable: () => <div>Cart lines</div> }))
vi.mock('@/app/(portal)/cart/PeriodSavingsBar', () => ({
  PeriodSavingsBar: () => null,
}))

describe('CartDrawer picking-fee country estimate', () => {
  beforeEach(() => {
    state.countryPartitionEnabled = true
    state.defaultBillingCountry.code = 'NZ'
    state.defaultBillingCountry.currency = 'NZD'
    state.defaultBillingCountry.taxRate = 0.15
    state.defaultBillingCountry.taxLabel = 'GST 15%'
  })

  it('uses the exact default country and labels the enabled fee as an estimate', () => {
    render(<CartDrawer />)

    expect(screen.getByText('Estimated picking fee')).toBeInTheDocument()
    expect(screen.getByText('$30.00')).toBeInTheDocument()
  })

  it('retains the AU-country no-fee drawer when the cutover is off', () => {
    state.countryPartitionEnabled = false
    state.defaultBillingCountry.code = 'AU'
    state.defaultBillingCountry.currency = 'AUD'
    state.defaultBillingCountry.taxRate = 0.1
    state.defaultBillingCountry.taxLabel = 'GST 10%'
    render(<CartDrawer />)

    expect(screen.queryByText(/picking fee/i)).not.toBeInTheDocument()
  })
})
