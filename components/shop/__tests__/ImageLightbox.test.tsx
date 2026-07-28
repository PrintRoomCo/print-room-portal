import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { describe, expect, it, vi } from 'vitest'
import { ImageLightbox, type LightboxImage } from '../ImageLightbox'

const three: LightboxImage[] = [
  { url: '/front.png', alt: 'Tee front', label: 'front' },
  { url: '/back.png', alt: 'Tee back', label: 'back' },
  { url: '/side.png', alt: 'Tee side', label: 'side' },
]

describe('ImageLightbox', () => {
  it('renders an accessible modal dialog with the initial image', () => {
    render(<ImageLightbox images={three} initialIndex={1} onClose={() => {}} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('img')).toHaveAttribute('src', '/back.png')
  })

  it('cycles images with the next/prev controls', async () => {
    const user = userEvent.setup()
    render(<ImageLightbox images={three} initialIndex={0} onClose={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Next image' }))
    expect(screen.getByRole('img')).toHaveAttribute('src', '/back.png')
    await user.click(screen.getByRole('button', { name: 'Previous image' }))
    expect(screen.getByRole('img')).toHaveAttribute('src', '/front.png')
  })

  it('hides prev/next for a single image', () => {
    render(<ImageLightbox images={[three[0]]} onClose={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Next image' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Previous image' })).not.toBeInTheDocument()
  })

  it('closes on Escape, backdrop click, and the close button', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { rerender } = render(<ImageLightbox images={three} onClose={onClose} />)

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)

    rerender(<ImageLightbox images={three} onClose={onClose} />)
    await user.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalledTimes(2)

    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('moves focus into the dialog on open and traps Tab', async () => {
    const user = userEvent.setup()
    render(<ImageLightbox images={three} onClose={() => {}} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog.contains(document.activeElement) || document.activeElement === dialog).toBe(true)
    // Shift+Tab from the first control wraps to the last.
    const buttons = screen.getAllByRole('button')
    buttons[0].focus()
    await user.keyboard('{Shift>}{Tab}{/Shift}')
    expect(buttons[buttons.length - 1]).toHaveFocus()
  })

  it('has no axe violations', async () => {
    const { container } = render(<ImageLightbox images={three} onClose={() => {}} />)
    expect(await axe(container)).toHaveNoViolations()
  })
})
