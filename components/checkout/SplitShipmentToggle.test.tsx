import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SplitShipmentToggle } from './SplitShipmentToggle'

describe('SplitShipmentToggle', () => {
  it('is always offered, and reports its mode through aria-pressed', () => {
    const { rerender } = render(
      <SplitShipmentToggle pressed={false} onChange={vi.fn()} />,
    )
    const pill = screen.getByRole('button', { name: /split shipment across destinations/i })
    expect(pill).toHaveAttribute('aria-pressed', 'false')

    rerender(<SplitShipmentToggle pressed onChange={vi.fn()} />)
    expect(pill).toHaveAttribute('aria-pressed', 'true')
  })

  it('toggles both ways', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <SplitShipmentToggle pressed={false} onChange={onChange} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /split shipment/i }))
    rerender(<SplitShipmentToggle pressed onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /split shipment/i }))
    expect(onChange.mock.calls.map(([v]) => v)).toEqual([true, false])
  })

  it('is disabled while a submit is in flight', () => {
    render(<SplitShipmentToggle pressed={false} onChange={vi.fn()} disabled />)
    expect(screen.getByRole('button', { name: /split shipment/i })).toBeDisabled()
  })
})
