import { useState } from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DestinationChips, destinationLabel } from './DestinationChips'
import type { SplitShipmentState } from '@/lib/checkout/split-shipment-state'
import type { StoreOption } from './ShipToRow'

const stores: StoreOption[] = [
  { id: 'store-a', name: 'Albany', city: 'Auckland' },
  { id: 'store-b', name: 'Takapuna', city: 'Auckland' },
  { id: 'store-c', name: 'Wellington', city: 'Wellington' },
]

const twoStores: SplitShipmentState = {
  destinations: [
    { ref: 'd1', storeId: 'store-a', customAddress: null },
    { ref: 'd2', storeId: 'store-b', customAddress: null },
  ],
  defaultDestinationRef: 'd1',
  allocations: { 'l-s': { d1: 8, d2: 4 } },
}

/** The real caller owns the state; these tests drive the component the same way. */
function Controlled({
  initial = twoStores,
  allowCustom = true,
}: {
  initial?: SplitShipmentState
  allowCustom?: boolean
}) {
  const [value, setValue] = useState(initial)
  return (
    <DestinationChips
      stores={stores}
      allowCustom={allowCustom}
      value={value}
      onChange={setValue}
    />
  )
}

describe('destinationLabel', () => {
  it('names a store destination after its store', () => {
    expect(destinationLabel({ ref: 'd1', storeId: 'store-b', customAddress: null }, stores)).toBe(
      'Takapuna',
    )
  })

  it('falls back to a generic name for an unnamed one-time address', () => {
    expect(destinationLabel({ ref: 'd9', storeId: null, customAddress: null }, stores)).toBe(
      'One-time address',
    )
  })
})

describe('DestinationChips', () => {
  it('marks the default chip and moves the marker when the default changes', () => {
    render(<Controlled />)
    expect(screen.getByRole('button', { name: /Default: Albany/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Takapuna' }))
    fireEvent.click(screen.getByRole('button', { name: 'Make Takapuna the default' }))

    expect(screen.getByRole('button', { name: /Default: Takapuna/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Default: Albany/ })).not.toBeInTheDocument()
  })

  it('keeps one editor panel open at a time', () => {
    render(<Controlled />)
    fireEvent.click(screen.getByRole('button', { name: /Default: Albany/ }))
    expect(screen.getByLabelText('Store for Albany')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Takapuna' }))
    expect(screen.getByLabelText('Store for Takapuna')).toBeInTheDocument()
    expect(screen.queryByLabelText('Store for Albany')).not.toBeInTheDocument()
  })

  it('closes the panel again on Done', () => {
    render(<Controlled />)
    fireEvent.click(screen.getByRole('button', { name: 'Takapuna' }))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByLabelText('Store for Takapuna')).not.toBeInTheDocument()
  })

  it('says where the removed destination units went instead of dropping them silently', () => {
    render(<Controlled />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Takapuna' }))
    expect(screen.getByRole('status')).toHaveTextContent(
      'Removed Takapuna. 4 units now ship to Albany.',
    )
    expect(screen.queryByRole('button', { name: 'Takapuna' })).not.toBeInTheDocument()
  })

  it('offers only the stores not already used, plus a one-time address', () => {
    render(<Controlled />)
    fireEvent.click(screen.getByRole('button', { name: '+ Add' }))
    const menu = screen.getByRole('list')
    expect(within(menu).getByRole('button', { name: /Wellington/ })).toBeInTheDocument()
    expect(within(menu).queryByRole('button', { name: /Albany/ })).not.toBeInTheDocument()
    expect(within(menu).getByRole('button', { name: 'One-time address' })).toBeInTheDocument()
  })

  it('withholds the one-time address option from branch-scoped buyers', () => {
    render(<Controlled allowCustom={false} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Add' }))
    expect(
      within(screen.getByRole('list')).queryByRole('button', { name: 'One-time address' }),
    ).not.toBeInTheDocument()
  })

  it('makes the first destination the default and opens a new address for editing', () => {
    render(
      <Controlled
        initial={{ destinations: [], defaultDestinationRef: null, allocations: {} }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '+ Add' }))
    fireEvent.click(screen.getByRole('button', { name: 'One-time address' }))

    expect(screen.getByRole('button', { name: /Default: One-time address/ })).toBeInTheDocument()
    expect(screen.getByLabelText('Search for an address')).toBeInTheDocument()
  })

  it('reveals manual address fields when Places cannot find it', () => {
    render(
      <Controlled
        initial={{ destinations: [], defaultDestinationRef: null, allocations: {} }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '+ Add' }))
    fireEvent.click(screen.getByRole('button', { name: 'One-time address' }))
    fireEvent.click(screen.getByRole('button', { name: /Enter the address manually/ }))

    expect(screen.getByLabelText('Street address for one-time destination')).toBeInTheDocument()
    expect(screen.queryByLabelText('Search for an address')).not.toBeInTheDocument()
  })
})
