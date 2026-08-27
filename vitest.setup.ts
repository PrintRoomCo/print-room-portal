import '@testing-library/jest-dom'
import { expect, vi, beforeEach } from 'vitest'
import * as axeMatchers from 'vitest-axe/matchers'
import 'vitest-axe/extend-expect'

expect.extend(axeMatchers)

/* Next's after() runs work after the response flushes and requires a request
 * scope that jsdom unit tests don't have. Mock it globally: run the callback
 * immediately, collect its promise (swallowing rejections — these side-effects
 * are best-effort in prod), and expose flushAfter() so tests can await the
 * deferred work deterministically. Reset between tests for isolation. */
const __afterTasks: Array<Promise<unknown>> = []
;(globalThis as unknown as { flushAfter: () => Promise<void> }).flushAfter = async () => {
  await Promise.all(__afterTasks.splice(0))
}
beforeEach(() => {
  __afterTasks.length = 0
})
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return {
    ...actual,
    after: (cb: unknown) => {
      const p = typeof cb === 'function' ? (cb as () => unknown)() : cb
      __afterTasks.push(Promise.resolve(p).catch(() => {}))
    },
  }
})

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
const localStorageValues = new Map<string, string>()
  const localStorageShim: Storage = {
    get length() {
      return localStorageValues.size
    },
    clear: () => localStorageValues.clear(),
    getItem: (key) => localStorageValues.get(key) ?? null,
    key: (index) => Array.from(localStorageValues.keys())[index] ?? null,
    removeItem: (key) => localStorageValues.delete(key),
    setItem: (key, value) => localStorageValues.set(key, String(value)),
  }

  if (!globalThis.localStorage) {
    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageShim,
      configurable: true,
      writable: true,
    })
  }

  beforeEach(() => {
    localStorageValues.clear()
  })