import '@testing-library/jest-dom'
import { expect } from 'vitest'
import * as axeMatchers from 'vitest-axe/matchers'
import 'vitest-axe/extend-expect'

expect.extend(axeMatchers)

/* jsdom ships no IntersectionObserver, but framer-motion's whileInView
 * (auth-page MerchPile) constructs one on mount. No-op stub: observed
 * elements simply never report "in view", so enter animations stay at
 * their initial state in tests. */
class NoopIntersectionObserver {
  readonly root = null
  readonly rootMargin = '0px'
  readonly thresholds: readonly number[] = []
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
}

globalThis.IntersectionObserver ??=
  NoopIntersectionObserver as unknown as typeof IntersectionObserver
