import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { VariantlessSizeGrid } from '../VariantlessSizeGrid'

describe('VariantlessSizeGrid', () => {
  it('renders one row per size with a qty input', () => {
    render(<VariantlessSizeGrid sizes={['S', 'M', 'L', 'XL']} quantities={{}} onChange={() => {}} />)
    expect(screen.getByLabelText(/Quantity for size S/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Quantity for size M/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Quantity for size L/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Quantity for size XL/i)).toBeInTheDocument()
  })

  it('emits onChange with floored positive integer', () => {
    const onChange = vi.fn()
    render(<VariantlessSizeGrid sizes={['S', 'M']} quantities={{}} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText(/Quantity for size S/i), { target: { value: '6.7' } })
    expect(onChange).toHaveBeenCalledWith({ S: 6 })
  })

  it('deletes the size key when qty is cleared to zero', () => {
    const onChange = vi.fn()
    render(
      <VariantlessSizeGrid
        sizes={['S', 'M']}
        quantities={{ S: 6, M: 4 }}
        onChange={onChange}
      />
    )
    fireEvent.change(screen.getByLabelText(/Quantity for size S/i), { target: { value: '0' } })
    expect(onChange).toHaveBeenCalledWith({ M: 4 })
  })

  it('renders the total as the sum of all rows', () => {
    render(
      <VariantlessSizeGrid
        sizes={['S', 'M', 'L']}
        quantities={{ S: 6, M: 6, L: 12 }}
        onChange={() => {}}
      />
    )
    expect(screen.getByText('24')).toBeInTheDocument()
  })
})
