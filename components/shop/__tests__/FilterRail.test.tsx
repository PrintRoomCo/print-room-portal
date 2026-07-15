import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { FilterRail } from '../FilterRail'
import { DEFAULT_SHOP_FILTERS } from '@/lib/shop/filter-params'

// Each Section renders a FilterAutoSubmitSelect, which reads the app-router hooks.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/catalogue',
  useSearchParams: () => new URLSearchParams(),
}))

const facets = { brands: [], categories: [], garmentFamilies: [] }

describe('FilterRail ordering-mode gate (Item 7)', () => {
  it('shows the Ordering mode filter by default (member can reorder)', () => {
    render(<FilterRail filters={DEFAULT_SHOP_FILTERS} facets={facets} basePath="/catalogue" />)
    expect(screen.getByText('Ordering mode')).toBeInTheDocument()
  })

  it('hides the Ordering mode filter when showModeFilter is false (stock_only member)', () => {
    render(
      <FilterRail
        filters={DEFAULT_SHOP_FILTERS}
        facets={facets}
        basePath="/catalogue"
        showModeFilter={false}
      />,
    )
    expect(screen.queryByText('Ordering mode')).not.toBeInTheDocument()
    // The rest of the rail is untouched.
    expect(screen.getByText('Brand')).toBeInTheDocument()
  })
})
