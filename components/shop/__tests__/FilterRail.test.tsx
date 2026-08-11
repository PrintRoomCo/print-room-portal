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

describe('FilterRail garment-type filter', () => {
  const withFamilies = {
    brands: [],
    categories: [],
    garmentFamilies: ['headwear', 'tee'],
  }

  it('renders a "Garment type" section when the catalogue has garment families', () => {
    render(
      <FilterRail filters={DEFAULT_SHOP_FILTERS} facets={withFamilies} basePath="/catalogue" />,
    )
    expect(screen.getByText('Garment type')).toBeInTheDocument()
  })

  it('nice-cases the garment-type options for display', () => {
    render(
      <FilterRail filters={DEFAULT_SHOP_FILTERS} facets={withFamilies} basePath="/catalogue" />,
    )
    // Options are rendered from the raw lowercase DB values, labelled for display.
    expect(screen.getByText('Tee')).toBeInTheDocument()
    expect(screen.getByText('Headwear')).toBeInTheDocument()
  })

  it('keeps the query field named garment_family (stable URL param, not garment_type)', () => {
    const { container } = render(
      <FilterRail filters={DEFAULT_SHOP_FILTERS} facets={withFamilies} basePath="/catalogue" />,
    )
    expect(container.querySelector('input[name="garment_family"]')).not.toBeNull()
    expect(container.querySelector('input[name="garment_type"]')).toBeNull()
  })

  it('hides the Garment type section when the catalogue has no garment families', () => {
    render(<FilterRail filters={DEFAULT_SHOP_FILTERS} facets={facets} basePath="/catalogue" />)
    expect(screen.queryByText('Garment type')).not.toBeInTheDocument()
  })
})
