import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CurrencyPicker } from '../CurrencyPicker'

const setCurrency = vi.fn()
let pathname = '/catalogue'

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
}))

vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({
    currency: 'AUD',
    setCurrency,
  }),
}))

beforeEach(() => {
  setCurrency.mockClear()
  pathname = '/catalogue'
})

describe('CurrencyPicker', () => {
  it('opens the menu on click', () => {
    render(<CurrencyPicker />)
    fireEvent.click(screen.getByRole('button', { name: 'Currency' }))
    expect(screen.getByRole('menu')).toHaveAttribute('aria-hidden', 'false')
  })

  it('calls setCurrency with the selection and closes the menu', () => {
    render(<CurrencyPicker />)
    fireEvent.click(screen.getByRole('button', { name: 'Currency' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'US$ USD' }))
    expect(setCurrency).toHaveBeenCalledWith('USD')
    expect(screen.getByRole('menu', { hidden: true })).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders nothing on /checkout/review', () => {
    pathname = '/checkout/review'
    const { container } = render(<CurrencyPicker />)
    expect(container.firstChild).toBeNull()
  })
})
