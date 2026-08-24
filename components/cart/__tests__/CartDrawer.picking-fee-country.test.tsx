import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CartDrawer } from '../CartDrawer'

const state = vi.hoisted(() => ({
  countryPartitionEnabled: true,
  defaultBillingCountryCode: 'NZ' as string | null,
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
    access: { role: 'org_admin', region: 'AU' },
    countryPartitionEnabled: state.countryPartitionEnabled,
    defaultBillingCountryCode: state.defaultBillingCountryCode,
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
    state.defaultBillingCountryCode = 'NZ'
  })

  it('uses the exact default country and labels the enabled fee as an estimate', () => {
    render(<CartDrawer />)

    expect(screen.getByText('Estimated picking fee')).toBeInTheDocument()
    expect(screen.getByText('$30.00')).toBeInTheDocument()
  })

  it('retains the AU-region no-fee drawer when the cutover is off', () => {
    state.countryPartitionEnabled = false
    render(<CartDrawer />)

    expect(screen.queryByText(/picking fee/i)).not.toBeInTheDocument()
  })
})
