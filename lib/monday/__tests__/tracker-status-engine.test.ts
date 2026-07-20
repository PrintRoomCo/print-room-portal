import { describe, it, expect } from 'vitest'
import {
  deriveStatusValue,
  mapMondayStatus,
  isNonCustomerFacingStatus,
  resolveStatusKey,
  statusesMatch,
  CANONICAL_STATUS_KEYS,
} from '../tracker-status-engine'

// The single most important fixture: every one of the 40 live `color_mkpnas0e`
// ("Job Status") labels on board 1992701981, verified via the Monday API on
// 2026-07-20, mapped to its expected engine outcome. Building against reality
// (not the studio's stale table) is the point — see issue #77.
//   CF      = customer-facing; canonical must equal the given key
//   INT     = internal (isCustomerFacing false, isNonCustomerFacingStatus true)
//   HOLD    = preserve previous (Job on Hold)
//   UNKNOWN = unrecognised label -> null, not preserved
type Kind = 'CF' | 'INT' | 'HOLD' | 'UNKNOWN'
const LIVE_BOARD: Array<[number, string, string | null, Kind]> = [
  [0, 'Sent: Quote', null, 'INT'],
  [1, 'Need: Mockup (Quote Approved)', 'quote-accepted-mockup', 'CF'],
  [2, 'Proof Approved', 'proof-approved', 'CF'],
  [3, 'Sent: Proof+Invoice/Quote', 'proof-sent', 'CF'],
  [4, 'Sent: Mockup + Xero Quote', 'quote-accepted-mockup', 'CF'], // studio MISS — fixed here
  [5, 'Yet to quote', 'quote-stage', 'CF'],
  [6, 'Need: Proof', 'need-proof', 'CF'],
  [7, 'Stock Ordered', 'proof-approved', 'CF'],
  [8, 'Assign to Production', 'in-production', 'CF'],
  [9, 'All Production Complete', 'in-production', 'CF'], // studio MISS — fixed here
  [10, 'Shipped', 'dispatched', 'CF'],
  [11, 'Need: Internal Proof Approval', 'need-proof', 'CF'],
  [12, 'Need: Send proof + Invoice/Quote from Xero', 'need-proof', 'CF'],
  [13, 'Need: Quote Offshore', null, 'INT'],
  [14, 'Mockup Complete', 'quote-accepted-mockup', 'CF'], // studio MISS — fixed here
  [15, 'Proof Declined', 'need-proof', 'CF'],
  [16, 'Partially Shipped', 'in-production', 'CF'],
  [17, 'Lost Job - Cost', null, 'INT'],
  [18, 'Replied', null, 'INT'],
  [19, 'Artwork Proof Edits', 'need-proof', 'CF'],
  [101, 'Ready to Pickup', 'dispatched', 'CF'],
  [102, 'PR Warehouse', 'dispatched', 'CF'],
  [103, 'Follow up 1 sent', null, 'INT'],
  [104, 'Lost Job - Time', null, 'INT'],
  [105, 'Lost Job - no reply', null, 'INT'], // studio MISS — suppressed here
  [106, 'Ship Direct to Client', 'dispatched', 'CF'],
  [107, 'Closed Job', 'dispatched', 'CF'],
  [108, '3PL Fulfillment', 'dispatched', 'CF'],
  [109, 'Job on Hold', null, 'HOLD'],
  [110, 'Follow up 2 sent', null, 'INT'],
  [151, 'Open for preorders', 'quote-accepted-mockup', 'CF'],
  [152, 'Lost Job - Went with another supplier', null, 'INT'], // studio MISS
  [153, 'Need: Send Draft Quote', null, 'INT'],
  [154, 'Needs Follow Up?', null, 'INT'],
  [155, 'Lost Job - Will not proceed for no reason', null, 'INT'], // studio MISS
  [156, 'Lost Job - Under MOQ', null, 'INT'], // studio MISS
  [157, 'In comms', null, 'INT'],
  [158, 'Lost Job', null, 'INT'],
  [159, 'Trends - Ordered', 'in-production', 'CF'],
  [160, 'Lost - Incorrect Info', null, 'INT'],
]

describe('tracker-status-engine — live board coverage', () => {
  it.each(LIVE_BOARD)('idx %s "%s" resolves correctly', (_idx, label, expectedKey, kind) => {
    const d = deriveStatusValue(label, { previousStatus: 'need-proof' })
    if (kind === 'CF') {
      expect(d.canonical).toBe(expectedKey)
      expect(d.isCustomerFacing).toBe(true)
      expect(d.preserveExisting).toBe(false)
      expect(d.storageValue).toBe(expectedKey)
    } else if (kind === 'HOLD') {
      expect(d.isCustomerFacing).toBe(false)
      expect(d.preserveExisting).toBe(true)
      // hold preserves the previous customer-facing stage
      expect(d.storageValue).toBe('need-proof')
    } else if (kind === 'INT') {
      expect(d.isCustomerFacing).toBe(false)
      expect(isNonCustomerFacingStatus(label)).toBe(true)
    }
  })

  it('every canonical key passes straight through', () => {
    for (const k of CANONICAL_STATUS_KEYS) {
      const d = deriveStatusValue(k)
      expect(d.canonical).toBe(k)
      expect(d.isCustomerFacing).toBe(true)
    }
  })

  it('canonical set is exactly the 7 portal steps', () => {
    expect([...CANONICAL_STATUS_KEYS].sort()).toEqual(
      [
        'dispatched',
        'in-production',
        'need-proof',
        'proof-approved',
        'proof-sent',
        'quote-accepted-mockup',
        'quote-stage',
      ].sort()
    )
  })

  it('unknown label -> null, not customer-facing, not preserved', () => {
    const d = deriveStatusValue('Totally Unknown Label 123')
    expect(d.canonical).toBeNull()
    expect(d.isCustomerFacing).toBe(false)
    expect(d.preserveExisting).toBe(false)
  })

  it('empty / null -> not customer-facing', () => {
    expect(deriveStatusValue('').canonical).toBeNull()
    expect(deriveStatusValue(null).isCustomerFacing).toBe(false)
    expect(deriveStatusValue(undefined).isCustomerFacing).toBe(false)
  })

  it('defensive: any future "Lost Job - X" variant is suppressed', () => {
    expect(isNonCustomerFacingStatus('Lost Job - Some Brand New Reason')).toBe(true)
    expect(deriveStatusValue('Lost Job - Some Brand New Reason').isCustomerFacing).toBe(false)
  })

  it('mapMondayStatus flags internal-only vs preserve-previous distinctly', () => {
    expect(mapMondayStatus('Lost Job').isInternalOnly).toBe(true)
    expect(mapMondayStatus('Job on Hold').isInternalOnly).toBe(false)
    expect(mapMondayStatus('Job on Hold').preservePrevious).toBe(true)
  })

  it('resolveStatusKey + statusesMatch treat synonyms as equal', () => {
    expect(resolveStatusKey('Assign to Production')).toBe('in-production')
    expect(statusesMatch('Assign to Production', 'in-production')).toBe(true)
    expect(statusesMatch('Shipped', 'dispatched')).toBe(true)
    expect(statusesMatch('Shipped', 'need-proof')).toBe(false)
  })
})
