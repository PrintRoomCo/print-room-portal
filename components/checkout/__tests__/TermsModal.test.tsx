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
    render(<TermsModal onClose={vi.fn()} />)
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText(/Terms & Conditions/i)).toBeTruthy()
    // Real, non-lorem clause content is present.
    expect(screen.getByRole('heading', { name: /Payment/i })).toBeTruthy()
    // The exact version the customer sees is shown.
    expect(screen.getByText(new RegExp(TERMS_VERSION))).toBeTruthy()
  })

  it('calls onClose when the Close button is clicked', () => {
    const onClose = vi.fn()
    render(<TermsModal onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
