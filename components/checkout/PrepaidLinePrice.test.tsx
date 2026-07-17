import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PrepaidBadge, PrepaidLinePrice } from './PrepaidLinePrice'

const format = (n: number) => `$${n.toFixed(2)}`

describe('PrepaidLinePrice', () => {
  it('shows the goods value struck through, then $0.00, when not billed', () => {
    render(<PrepaidLinePrice goodsValue={1465.2} billed={false} format={format} />)
    const struck = screen.getByText('$1465.20')
    expect(struck).toBeInTheDocument()
    expect(struck.tagName).toBe('S')
    expect(screen.getByText('$0.00')).toBeInTheDocument()
  })

  it('shows only the goods value when billed', () => {
    render(<PrepaidLinePrice goodsValue={2000} billed format={format} />)
    expect(screen.getByText('$2000.00')).toBeInTheDocument()
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument()
  })

  it('explains the strike-through to screen readers', () => {
    render(<PrepaidLinePrice goodsValue={1465.2} billed={false} format={format} />)
    // A bare <s> conveys nothing without sight; the reason has to be in the DOM.
    expect(screen.getByText(/drawn from pre-paid stock/i)).toBeInTheDocument()
  })
})

describe('PrepaidBadge', () => {
  it('renders the Pre-paid label', () => {
    render(<PrepaidBadge />)
    expect(screen.getByText('Pre-paid')).toBeInTheDocument()
  })
})
