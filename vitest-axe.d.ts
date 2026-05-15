import 'vitest'

declare module 'vitest' {
  interface Assertion<T = unknown> {
    toHaveNoViolations(this: Assertion<T>): void
  }

  interface AsymmetricMatchersContaining {
    toHaveNoViolations(): void
  }
}
