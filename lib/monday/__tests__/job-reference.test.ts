import { describe, it, expect } from 'vitest'
import { validateJobReference, normalizeJobReference, JOB_REFERENCE_PATTERN } from '../job-reference'

describe('validateJobReference', () => {
  it('accepts real job references', () => {
    expect(validateJobReference('ANFI-000092')).toEqual({ ok: true, value: 'ANFI-000092' })
    expect(validateJobReference('NEOC-3781').ok).toBe(true)
    expect(validateJobReference('ANFI-000092-2').ok).toBe(true) // optional trailing segment
    expect(validateJobReference('ABC_12').ok).toBe(true) // underscore separator
    expect(validateJobReference('  TPRC-000037  ')).toEqual({ ok: true, value: 'TPRC-000037' }) // trimmed
  })

  it('rejects missing values with missing-job-reference', () => {
    expect(validateJobReference('').ok).toBe(false)
    expect(validateJobReference('   ')).toMatchObject({ ok: false, code: 'missing-job-reference' })
    expect(validateJobReference(null)).toMatchObject({ ok: false, code: 'missing-job-reference' })
  })

  it('rejects malformed values with invalid-job-reference', () => {
    expect(validateJobReference('bad')).toMatchObject({ ok: false, code: 'invalid-job-reference' })
    expect(validateJobReference('A1')).toMatchObject({ ok: false, code: 'invalid-job-reference' }) // 1 letter, 1 digit
    expect(validateJobReference('ANFI000092')).toMatchObject({ ok: false, code: 'invalid-job-reference' }) // no separator
    expect(validateJobReference('X'.repeat(101) + '-99')).toMatchObject({ ok: false, code: 'invalid-job-reference' }) // too long
  })
})

describe('normalizeJobReference', () => {
  it('trims and nulls empties', () => {
    expect(normalizeJobReference('  ANFI-1 ')).toBe('ANFI-1')
    expect(normalizeJobReference('')).toBeNull()
    expect(normalizeJobReference(null)).toBeNull()
  })
})

describe('JOB_REFERENCE_PATTERN', () => {
  it('is the documented shape', () => {
    expect(JOB_REFERENCE_PATTERN.test('ANFI-000092')).toBe(true)
    expect(JOB_REFERENCE_PATTERN.test('a-1')).toBe(false)
  })
})
