import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProductDetailClient } from '../ProductDetailClient'
import type { DecorationOption } from '@/lib/shop/decorations'

const { addLine } = vi.hoisted(() => ({ addLine: vi.fn() }))

vi.mock('@/components/cart/useCart', () => ({ useCart: () => ({ addLine }) }))
vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({ format: (n: number) => `$${n}` }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ back: vi.fn() }) }))
vi.mock('next/image', () => ({
  default: ({
    alt = '',
    fill,
    priority,
    sizes,
    ...props
  }: {
    alt?: string
    fill?: boolean
    priority?: boolean
    sizes?: string
  }) => {
    void fill
    void priority
    void sizes
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img alt={alt} {...props} />
    )
  },
}))

const product = {
  id: 'p-manual',
  name: 'Manual Tee',
  description: null,
  image_url: null,
  moq: 1,
  lead_time_days: 7,
  sizing_type: 'one_size',
  decoration_methods: null,
  decoration_price: null,
  sku: null,
  safety_standard: null,
  specs: null,
  supports_labels: null,
  garment_family: null,
  default_sizes: null,
  fulfilment_type: 'made_to_order' as const,
  brand_name: null,
  category_name: null,
  catalogueItemId: 'ci-manual',
  priceMode: 'manual_final' as const,
  manualDecorationSeed: { 1: 7.5 },
}

const detailsOnlyDecoration: DecorationOption = {
  linkId: 'link-details',
  decorationId: 'dec-details',
  name: 'Included logo',
  method: 'embroidery',
  positionLabel: 'Left chest',
  unitPrice: 0,
  artworkUrl: null,
  artworkName: null,
  snapshotUrl: null,
  snapshotColorSwatchId: null,
  isDefault: true,
  sortOrder: 0,
  recalcInputs: null,
  overlay: null,
  // Details-only: no artwork row, so it can never pool (spec §5).
  poolable: false,
  // No authored price ladder → today's engine/flat pricing.
  ladder: null,
}

function renderPDP(decorations: DecorationOption[] = []) {
  return render(
    <ProductDetailClient
      product={product}
      variants={[]}
      sizes={[]}
      brackets={[{ min_quantity: 1, max_quantity: null, unit_price: 12.5 }]}
      availability={{}}
      organizationId="o1"
      customerRole="org_admin"
      orderingPermission="both"
      images={[]}
      colourOptions={[]}
      decorations={decorations}
      effectiveMoq={1}
    />,
  )
}

beforeEach(() => {
  addLine.mockClear()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/shop/decoration-pricing')) {
        return {
          ok: true,
          json: async () => ({ pricesByQty: {}, manualByQty: { '1': 7.5 } }),
        }
      }
      return {
        ok: true,
        json: async () => ({ status: 'ok', unit_price: 12.5 }),
      }
    }),
  )
})

describe('ProductDetailClient manual_final pricing', () => {
  it('snapshots the combined manual decoration figure even with no selected decorations', async () => {
    renderPDP()

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /add to cart/i })).toBeEnabled(),
    )
    fireEvent.click(screen.getByRole('button', { name: /add to cart/i }))

    expect(addLine).toHaveBeenCalledTimes(1)
    expect(addLine).toHaveBeenCalledWith(
      expect.objectContaining({
        decorations: [],
        manualDecorationPerUnit: 7.5,
        manualDecorationBrackets: [{ minQty: 1, maxQty: null, unitPrice: 7.5 }],
      }),
    )
  })

  it('does not render the read-only included-decorations section (removed 2026-07-15)', () => {
    renderPDP([detailsOnlyDecoration])

    // The read-only "Includes" decoration card was removed 2026-07-15 at the
    // operator's request (it surfaced low-value / duplicate rows). Included
    // decorations no longer render on the PDP as product info, so neither the
    // method/position label nor the decoration name appears.
    expect(screen.queryByText(/Includes \d+ decoration/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Embroidery — Left chest')).not.toBeInTheDocument()
    expect(screen.queryByText('Included logo')).not.toBeInTheDocument()
  })
})
