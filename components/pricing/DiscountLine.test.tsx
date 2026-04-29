import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DiscountLine } from './DiscountLine'

describe('DiscountLine', () => {
  it('renders the locked spec copy with rounded percent and 2dp amount', () => {
    render(<DiscountLine label="Wholesale" amount={1.88} discountFraction={0.15} />)
    expect(screen.getByText(/Your/)).toBeDefined()
    expect(screen.getByText(/Wholesale/)).toBeDefined()
    expect(screen.getByText(/discount/)).toBeDefined()
    expect(screen.getByText(/−\$1\.88/)).toBeDefined()
    expect(screen.getByText(/−15%/)).toBeDefined()
  })

  it('renders nothing when amount is 0', () => {
    const { container } = render(
      <DiscountLine label="Standard" amount={0} discountFraction={0} />
    )
    expect(container.firstChild).toBeNull()
  })
})
