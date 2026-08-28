import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AllocationGrid } from './AllocationGrid'

const sizeLines = [
  { lineId: 'l-s', sizeLabel: 'S', qty: 12 },
  { lineId: 'l-m', sizeLabel: 'M', qty: 20 },
]
const destinations = [
  { ref: 'd1', label: 'Albany' },
  { ref: 'd2', label: 'Takapuna' },
]

describe('AllocationGrid', () => {
  it('shows a live remaining counter per size', () => {
    render(
      <AllocationGrid
        sizeLines={sizeLines}
        destinations={destinations}
        allocations={{ 'l-s': { d1: 8, d2: 4 }, 'l-m': { d1: 10 } }}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByTestId('remaining-l-s')).toHaveTextContent('0 left')
    expect(screen.getByTestId('remaining-l-m')).toHaveTextContent('10 left')
  })

  it('emits the updated allocation map when a cell changes', () => {
    const onChange = vi.fn()
    render(
      <AllocationGrid
        sizeLines={sizeLines}
        destinations={destinations}
        allocations={{ 'l-s': { d1: 8, d2: 4 }, 'l-m': { d1: 10 } }}
        onChange={onChange}
      />,
    )
    fireEvent.change(screen.getByLabelText('M to Takapuna'), { target: { value: '10' } })
    expect(onChange).toHaveBeenCalledWith({ 'l-s': { d1: 8, d2: 4 }, 'l-m': { d1: 10, d2: 10 } })
  })

  it('flags over-allocation instead of clamping silently', () => {
    render(
      <AllocationGrid
        sizeLines={sizeLines}
        destinations={destinations}
        allocations={{ 'l-s': { d1: 10, d2: 4 } }}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByTestId('remaining-l-s')).toHaveTextContent('2 over')
  })
})
