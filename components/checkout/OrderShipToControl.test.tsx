import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OrderShipToControl } from './OrderShipToControl'

const stores = [
  { id: 'store-a', name: 'Albany', city: 'Auckland', country: 'NZ' },
  { id: 'store-b', name: 'Takapuna', city: 'Auckland', country: 'NZ' },
]

describe('OrderShipToControl', () => {
  it('offers every store, the one-time address, and Split shipment', () => {
    render(
      <OrderShipToControl
        stores={stores}
        value={{ kind: 'store', storeId: 'store-a' }}
        onChange={vi.fn()}
        allowCustom
        allowSplit
      />,
    )
    const select = screen.getByLabelText(/ships to/i)
    expect(select).toHaveValue('store-a')
    expect(screen.getByRole('option', { name: /takapuna/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /one-time address/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /split shipment/i })).toBeInTheDocument()
  })

  it('emits the discriminated value for each choice', () => {
    const onChange = vi.fn()
    render(
      <OrderShipToControl
        stores={stores}
        value={{ kind: 'store', storeId: 'store-a' }}
        onChange={onChange}
        allowCustom
        allowSplit
      />,
    )
    const select = screen.getByLabelText(/ships to/i)
    fireEvent.change(select, { target: { value: 'store-b' } })
    fireEvent.change(select, { target: { value: '__custom__' } })
    fireEvent.change(select, { target: { value: '__split__' } })
    expect(onChange.mock.calls.map(([v]) => v)).toEqual([
      { kind: 'store', storeId: 'store-b' },
      { kind: 'custom' },
      { kind: 'split' },
    ])
  })

  it('hides split and custom when not allowed', () => {
    render(
      <OrderShipToControl
        stores={stores}
        value={{ kind: 'store', storeId: 'store-a' }}
        onChange={vi.fn()}
        allowCustom={false}
        allowSplit={false}
      />,
    )
    expect(screen.queryByRole('option', { name: /split shipment/i })).toBeNull()
    expect(screen.queryByRole('option', { name: /one-time address/i })).toBeNull()
  })
})
