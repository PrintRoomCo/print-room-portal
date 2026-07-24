import { describe, it, expect } from 'vitest'
import { sanitiseCustomName, MAX_CUSTOM_NAME_LENGTH } from '../custom-name'

describe('sanitiseCustomName', () => {
  it('trims and collapses internal whitespace', () => {
    expect(sanitiseCustomName('  Chris   Smith  ', 15)).toBe('Chris Smith')
  })
  it('allows letters, digits, space, and - \' . ,', () => {
    expect(sanitiseCustomName("Anne-Marie O'Neil Jr., 3", 30)).toBe("Anne-Marie O'Neil Jr., 3")
  })
  it('strips disallowed characters', () => {
    expect(sanitiseCustomName('C@hr!s#', 15)).toBe('Chrs')
  })
  it('preserves case (case-sensitive)', () => {
    expect(sanitiseCustomName('CHRIS', 15)).toBe('CHRIS')
    expect(sanitiseCustomName('chris', 15)).not.toBe(sanitiseCustomName('CHRIS', 15))
  })
  it('returns null for empty / whitespace / all-disallowed input', () => {
    expect(sanitiseCustomName('', 15)).toBeNull()
    expect(sanitiseCustomName('   ', 15)).toBeNull()
    expect(sanitiseCustomName('@@@', 15)).toBeNull()
    expect(sanitiseCustomName(null, 15)).toBeNull()
    expect(sanitiseCustomName(undefined, 15)).toBeNull()
  })
  it('clamps to the per-product cap', () => {
    expect(sanitiseCustomName('abcdefghij', 4)).toBe('abcd')
  })
  it('falls back to the 30-char ceiling when cap is null/invalid', () => {
    const long = 'a'.repeat(40)
    expect(sanitiseCustomName(long, null)).toHaveLength(MAX_CUSTOM_NAME_LENGTH)
    expect(sanitiseCustomName(long, 0)).toHaveLength(MAX_CUSTOM_NAME_LENGTH)
    expect(sanitiseCustomName(long, 999)).toHaveLength(MAX_CUSTOM_NAME_LENGTH)
  })
})
