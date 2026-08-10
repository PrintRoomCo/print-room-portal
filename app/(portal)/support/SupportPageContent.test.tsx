import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CustomerSupportPageContent } from './SupportPageContent'

describe('CustomerSupportPageContent', () => {
  it('offers the support inbox and three collapsed customer guides', () => {
    render(<CustomerSupportPageContent access={{ isCompanyUser: true, isOrgAdmin: false }} />)

    expect(screen.getByRole('link', { name: 'Contact portal support' })).toHaveAttribute(
      'href',
      'mailto:support@printroom.co?subject=Customer%20portal%20support',
    )
    expect(screen.getByRole('button', { name: 'Place an order' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: 'Cart & checkout' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: 'Track an order' })).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'Place an order' }))

    expect(screen.getByText('Choose a product and select the options you need.')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Open catalogue' })).toHaveAttribute('href', '/catalogue')
  })

  it('never sends a non-admin user to Current Orders', () => {
    render(<CustomerSupportPageContent access={{ isCompanyUser: true, isOrgAdmin: false }} />)

    fireEvent.click(screen.getByRole('button', { name: 'Track an order' }))

    expect(screen.queryByRole('link', { name: 'View current orders' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View past orders' })).toHaveAttribute('href', '/past-orders')
  })

  it('offers Current Orders to an org admin', () => {
    render(<CustomerSupportPageContent access={{ isCompanyUser: true, isOrgAdmin: true }} />)

    fireEvent.click(screen.getByRole('button', { name: 'Track an order' }))

    expect(screen.getByRole('link', { name: 'View current orders' })).toHaveAttribute('href', '/current-orders')
  })
})
