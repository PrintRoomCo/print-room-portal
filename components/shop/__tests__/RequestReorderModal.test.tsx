import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { RequestReorderModal } from '../RequestReorderModal'

function ReorderHarness() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open reorder
      </button>
      {open && (
        <RequestReorderModal
          variantId="variant-1"
          variantLabel="Black / L"
          productName="Test hoodie"
          defaultQty={12}
          onClose={() => setOpen(false)}
          onSuccess={vi.fn()}
        />
      )}
    </>
  )
}

describe('RequestReorderModal', () => {
  it('closes on Escape and returns focus to the opener', async () => {
    const user = userEvent.setup()
    render(<ReorderHarness />)

    const trigger = screen.getByRole('button', { name: /open reorder/i })
    await user.click(trigger)

    expect(screen.getByRole('dialog', { name: /request reorder/i })).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog', { name: /request reorder/i })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})
