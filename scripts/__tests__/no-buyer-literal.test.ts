import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'

// Greps tracked .ts/.tsx for the ROLE-VALUE string literal 'buyer' / "buyer".
// Excludes tests, the vendored onboarding package, and docs — none of which
// are "live code paths" per the spec gate. Longer literals that merely start
// with buyer (e.g. 'buyer_ship_to_mismatch') do NOT match this pattern.
// Uses execFileSync (not execSync) to avoid Windows cmd.exe single-quote quoting bugs.
function liveBuyerLiterals(): string[] {
  try {
    const out = execFileSync('git', [
      'grep', '-n', '-E', "'buyer'|\"buyer\"",
      '--', '*.ts', '*.tsx',
      ':(exclude)**/__tests__/**', ':(exclude)**/*.test.ts',
      ':(exclude)**/*.test.tsx', ':(exclude)vendor/**', ':(exclude)docs/**',
    ], { cwd: process.cwd(), encoding: 'utf8' })
    return out.split('\n').filter(Boolean)
  } catch (e) {
    const status = (e as { status?: number }).status
    if (status === 1) return []
    throw e
  }
}

describe('no live buyer role-value literal', () => {
  it('has zero matches in live .ts/.tsx', () => {
    const hits = liveBuyerLiterals()
    expect(hits, `\n${hits.join('\n')}`).toEqual([])
  })
})
