import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MerchPile from '../MerchPile'

// Stub matter-js so no test ever loads the real physics engine.
vi.mock('matter-js', () => ({ default: {} }))

// Report a fine pointer and no reduced-motion, so we're past those gates and are
// isolating the low-RAM gate specifically.
function stubPointerMatchMedia() {
  window.matchMedia = vi.fn((q: string) => ({
    matches: q.includes('pointer: fine'),
    media: q,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  })) as unknown as typeof window.matchMedia
}

function setDeviceMemory(value: number | undefined) {
  Object.defineProperty(navigator, 'deviceMemory', { value, configurable: true })
}

// The static fallback is the only element pinned to the bottom edge.
const fallbackOf = (root: HTMLElement) => root.querySelector('.inset-x-0.bottom-0')

afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(navigator, 'deviceMemory')
})

describe('MerchPile low-RAM gate', () => {
  it('keeps the static fallback (skips physics) on a low-RAM device', () => {
    stubPointerMatchMedia()
    setDeviceMemory(2)

    const { container } = render(<MerchPile />)

    // The physics path hides the fallback synchronously before importing matter-js;
    // the low-RAM early return never gets there, so the fallback stays visible.
    expect(fallbackOf(container)?.classList.contains('hidden')).toBe(false)
  })

  it('hides the fallback (runs physics) when RAM is above the threshold', () => {
    stubPointerMatchMedia()
    setDeviceMemory(8)

    const { container } = render(<MerchPile />)

    // Above the threshold the effect proceeds and hides the fallback up front.
    expect(fallbackOf(container)?.classList.contains('hidden')).toBe(true)
  })
})
