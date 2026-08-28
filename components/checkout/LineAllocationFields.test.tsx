import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LineAllocationFields } from './LineAllocationFields'
import type { AllocationMap } from '@/lib/checkout/allocation'

const destinations = [
  { ref: 'd1', label: 'Albany' },
  { ref: 'd2', label: 'Takapuna' },
]

function fields(props: Partial<Parameters<typeof LineAllocationFields>[0]> = {}) {
  return (
    <LineAllocationFields
      lineId="l-s"
      lineLabel="Everyday Pullover Hoodie Navy / S"
      qty={12}
      destinations={destinations}
      defaultDestinationLabel="Albany"
      allocations={{}}
      onChange={vi.fn()}
      {...props}
    />
  )
}

/** The real caller is controlled: it owns the map and feeds it straight back. */
function Controlled({ initial }: { initial: AllocationMap }) {
  const [allocations, setAllocations] = useState<AllocationMap>(initial)
  return fields({ allocations, onChange: setAllocations })
}

describe('LineAllocationFields status', () => {
  it('names the default destination while the line is untouched', () => {
    render(fields())
    expect(screen.getByTestId('remaining-l-s')).toHaveTextContent('Albany')
  })

  it('counts down the units still to allocate', () => {
    render(fields({ allocations: { 'l-s': { d1: 8 } } }))
    expect(screen.getByTestId('remaining-l-s')).toHaveTextContent('4 left')
  })

  it('reads 0 left once the line is exactly allocated', () => {
    render(fields({ allocations: { 'l-s': { d1: 8, d2: 4 } } }))
    expect(screen.getByTestId('remaining-l-s')).toHaveTextContent('0 left')
  })

  it('flags over-allocation instead of clamping silently', () => {
    render(fields({ allocations: { 'l-s': { d1: 10, d2: 4 } } }))
    expect(screen.getByTestId('remaining-l-s')).toHaveTextContent('2 over')
  })

  it('says where to start when the order has no destinations yet', () => {
    render(fields({ destinations: [] }))
    expect(screen.getByText('Add a destination above to split this line.')).toBeInTheDocument()
    expect(screen.queryByTestId('remaining-l-s')).not.toBeInTheDocument()
  })
})

describe('LineAllocationFields editing', () => {
  it('emits an updated allocation map keyed by destination', () => {
    const onChange = vi.fn()
    render(fields({ allocations: { 'l-s': { d1: 8 } }, onChange }))
    fireEvent.change(screen.getByLabelText('Everyday Pullover Hoodie Navy / S to Takapuna'), {
      target: { value: '4' },
    })
    expect(onChange).toHaveBeenCalledWith({ 'l-s': { d1: 8, d2: 4 } })
  })

  it('drops the line entirely when its last entry is cleared', () => {
    const onChange = vi.fn()
    render(fields({ allocations: { 'l-s': { d1: 8 } }, onChange }))
    fireEvent.change(screen.getByLabelText('Everyday Pullover Hoodie Navy / S to Albany'), {
      target: { value: '' },
    })
    expect(onChange).toHaveBeenCalledWith({})
  })

  it('lets someone type 1 on the way to 12 without the display fighting back', () => {
    render(<Controlled initial={{}} />)
    const input = screen.getByLabelText(
      'Everyday Pullover Hoodie Navy / S to Albany',
    ) as HTMLInputElement
    fireEvent.change(input, { target: { value: '1' } })
    expect(input.value).toBe('1')
    fireEvent.change(input, { target: { value: '12' } })
    expect(input.value).toBe('12')
    expect(screen.getByTestId('remaining-l-s')).toHaveTextContent('0 left')
  })

  it('keeps a half-typed field on screen without letting it reach the map', () => {
    render(<Controlled initial={{}} />)
    const input = screen.getByLabelText(
      'Everyday Pullover Hoodie Navy / S to Albany',
    ) as HTMLInputElement
    fireEvent.change(input, { target: { value: '0' } })
    expect(input.value).toBe('0')
    // 0 is not an allocation, so the line still follows the default.
    expect(screen.getByTestId('remaining-l-s')).toHaveTextContent('Albany')
  })

  it('renders every other field straight from props while one is being edited', () => {
    render(<Controlled initial={{ 'l-s': { d2: 4 } }} />)
    fireEvent.change(screen.getByLabelText('Everyday Pullover Hoodie Navy / S to Albany'), {
      target: { value: '8' },
    })
    expect(
      (screen.getByLabelText('Everyday Pullover Hoodie Navy / S to Takapuna') as HTMLInputElement)
        .value,
    ).toBe('4')
    expect(screen.getByTestId('remaining-l-s')).toHaveTextContent('0 left')
  })
})
