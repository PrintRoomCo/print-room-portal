import { describe, it, expect } from 'vitest'
import {
  resolveStatusStepIndex,
  resolveStatusStepLabel,
} from '../job-tracker-status-display'
import { STATUS_STEPS } from '../job-tracker'

const stepIndex = (key: string) => STATUS_STEPS.findIndex((s) => s.key === key)

describe('resolveStatusStepIndex', () => {
  it('maps every canonical status key onto its own step index', () => {
    STATUS_STEPS.forEach((step, idx) => {
      expect(resolveStatusStepIndex(step.key)).toBe(idx)
    })
  })

  it('recognises raw Monday synonyms the old 12-entry render table missed', () => {
    // "preparing-proof" used to fall through to -1 and render as raw title-cased
    // text — the root of the overview-vs-detail disagreement (Monday 2809669100).
    expect(resolveStatusStepIndex('preparing-proof')).toBe(stepIndex('need-proof'))
    expect(resolveStatusStepIndex('Preparing proof')).toBe(stepIndex('need-proof'))
    expect(resolveStatusStepIndex('ready-to-pickup')).toBe(stepIndex('dispatched'))
    expect(resolveStatusStepIndex('all-production-complete')).toBe(stepIndex('in-production'))
  })

  it('returns -1 for empty or genuinely unknown statuses', () => {
    expect(resolveStatusStepIndex(null)).toBe(-1)
    expect(resolveStatusStepIndex(undefined)).toBe(-1)
    expect(resolveStatusStepIndex('totally-made-up')).toBe(-1)
  })
})

describe('resolveStatusStepLabel', () => {
  it('returns the canonical step label for a mapped status', () => {
    expect(resolveStatusStepLabel('preparing-proof')).toBe('Proof Prep')
    expect(resolveStatusStepLabel('proof-approved')).toBe('Approved')
  })

  it('title-cases a genuinely unknown status (unchanged fallback)', () => {
    expect(resolveStatusStepLabel('some-weird-thing')).toBe('Some Weird Thing')
  })
})
