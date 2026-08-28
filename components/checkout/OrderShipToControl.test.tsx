import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OrderShipToControl } from './OrderShipToControl'

const stores = [
  { id: 'store-a', name: 'Albany', city: 'Auckland', country: 'NZ' },
  { id: 'store-b', name: 'Takapuna', city: 'Auckland', country: 'NZ' },
]

describe('OrderShipToControl', () => {
  it('offers every store and the one-time address', () => {
    render(
      <OrderShipToControl
        stores={stores}
        value={{ kind: 'store', storeId: 'store-a' }}
        onChange={vi.fn()}
        allowCustom
      />,
    )
    const select = screen.getByLabelText(/ships to/i)
    expect(select).toHaveValue('store-a')
    expect(screen.getByRole('option', { name: /takapuna/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /one-time address/i })).toBeInTheDocument()
  })

  it('never offers split as a ship-to value: it is a mode, owned by its own control', () => {
    render(
      <OrderShipToControl
        stores={stores}
        value={{ kind: 'store', storeId: 'store-a' }}
        onChange={vi.fn()}
        allowCustom
      />,
    )
    expect(screen.queryByRole('option', { name: /split shipment/i })).toBeNull()
  })

  it('emits the discriminated value for each choice', () => {
    const onChange = vi.fn()
    render(
      <OrderShipToControl
        stores={stores}
        value={{ kind: 'store', storeId: 'store-a' }}
        onChange={onChange}
        allowCustom
      />,
    )
    const select = screen.getByLabelText(/ships to/i)
    fireEvent.change(select, { target: { value: 'store-b' } })
    fireEvent.change(select, { target: { value: '__custom__' } })
    expect(onChange.mock.calls.map(([v]) => v)).toEqual([
      { kind: 'store', storeId: 'store-b' },
      { kind: 'custom' },
    ])
  })

  it('hides the one-time address when not allowed', () => {
    render(
      <OrderShipToControl
        stores={stores}
        value={{ kind: 'store', storeId: 'store-a' }}
        onChange={vi.fn()}
        allowCustom={false}
      />,
    )
    expect(screen.queryByRole('option', { name: /one-time address/i })).toBeNull()
  })

  it('goes inert when disabled, which is how split mode suspends it', () => {
    render(
      <OrderShipToControl
        stores={stores}
        value={{ kind: 'store', storeId: 'store-a' }}
        onChange={vi.fn()}
        allowCustom
        disabled
      />,
    )
    expect(screen.getByLabelText(/ships to/i)).toBeDisabled()
  })
})
