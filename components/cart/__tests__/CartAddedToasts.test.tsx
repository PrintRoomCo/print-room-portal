import { render, screen, fireEvent, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CartAddedToasts } from '../CartAddedToasts'

const setOpen = vi.fn()
vi.mock('@/components/layout/PortalTopBarContext', () => ({
  useCartDrawer: () => ({ open: false, setOpen, toggle: vi.fn() }),
}))

type Detail = { imageUrl: string | null; title: string; detail: string | null }

function fireAdded(detail: Detail) {
  act(() => {
    window.dispatchEvent(new CustomEvent('pr:cart-added', { detail }))
  })
}

describe('CartAddedToasts', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setOpen.mockClear()
  })
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('renders a toast with the summary when pr:cart-added fires', () => {
    render(<CartAddedToasts />)
    fireAdded({ imageUrl: null, title: 'Soft Tee', detail: '24 × White / M' })
    expect(screen.getByText('Added!')).toBeInTheDocument()
    expect(screen.getByText('Soft Tee')).toBeInTheDocument()
    expect(screen.getByText('24 × White / M')).toBeInTheDocument()
  })

  it('opens the cart drawer when the card is clicked', () => {
    render(<CartAddedToasts />)
    fireAdded({ imageUrl: null, title: 'Soft Tee', detail: null })
    act(() => {
      fireEvent.click(screen.getByText('Soft Tee'))
    })
    expect(setOpen).toHaveBeenCalledWith(true)
  })

  it('auto-dismisses after the timeout elapses', () => {
    render(<CartAddedToasts />)
    fireAdded({ imageUrl: null, title: 'Soft Tee', detail: null })
    expect(screen.getByText('Soft Tee')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(3500 + 220)
    })
    expect(screen.queryByText('Soft Tee')).not.toBeInTheDocument()
  })

  it('caps the visible stack at three, dropping the oldest', () => {
    render(<CartAddedToasts />)
    fireAdded({ imageUrl: null, title: 'Tee A', detail: null })
    fireAdded({ imageUrl: null, title: 'Tee B', detail: null })
    fireAdded({ imageUrl: null, title: 'Tee C', detail: null })
    fireAdded({ imageUrl: null, title: 'Tee D', detail: null })
    expect(screen.queryByText('Tee A')).not.toBeInTheDocument()
    expect(screen.getByText('Tee D')).toBeInTheDocument()
    expect(screen.getAllByText('Added!')).toHaveLength(3)
  })
})
