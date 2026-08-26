import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TermsModal } from '../TermsModal'
import { TERMS_VERSION } from '@/lib/checkout/terms'

describe('TERMS_VERSION', () => {
  it('is the locked v1 string in sequence-then-date format', () => {
    expect(TERMS_VERSION).toBe('v1-2026-08-11')
    expect(TERMS_VERSION).toMatch(/^v\d+-\d{4}-\d{2}-\d{2}$/)
  })
})

describe('TermsModal', () => {
  it('renders the terms in a dialog with the version and real clauses', () => {
    render(<TermsModal onClose={vi.fn()} currency="NZD" taxLabel="GST 15%" />)
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText(/Terms & Conditions/i)).toBeTruthy()
    // Real, non-lorem clause content is present.
    expect(screen.getByRole('heading', { name: /Payment/i })).toBeTruthy()
    // The exact version the customer sees is shown.
    expect(screen.getByText(new RegExp(TERMS_VERSION))).toBeTruthy()
  })

  it('calls onClose when the Close button is clicked', () => {
    const onClose = vi.fn()
    render(<TermsModal onClose={onClose} currency="NZD" taxLabel="GST 15%" />)
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('preserves the exact AUD sentence and generalises future country rows', () => {
    const { rerender } = render(
      <TermsModal onClose={vi.fn()} currency="AUD" taxLabel="GST 10%" />,
    )
    expect(screen.getByText(/All prices are in Australian dollars and exclude GST/)).toBeTruthy()

    rerender(<TermsModal onClose={vi.fn()} currency="GBP" taxLabel="VAT 20%" />)
    expect(screen.getByText(/All prices are in GBP and exclude tax, which is added as VAT 20%/)).toBeTruthy()
  })
})
