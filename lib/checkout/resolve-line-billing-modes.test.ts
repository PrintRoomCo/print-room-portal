import { describe, it, expect } from 'vitest'
import { buildBillingModeMap } from './resolve-line-billing-modes'

describe('buildBillingModeMap', () => {
  it('maps variant_id → billing_mode, defaulting null/unknown to invoice_on_dispatch', () => {
    const m = buildBillingModeMap([
      { variant_id: 'v1', billing_mode: 'prepaid' },
      { variant_id: 'v2', billing_mode: 'invoice_on_dispatch' },
      { variant_id: 'v3', billing_mode: null },
      { variant_id: 'v4', billing_mode: 'garbage' },
    ])
    expect(m.get('v1')).toBe('prepaid')
    expect(m.get('v2')).toBe('invoice_on_dispatch')
    expect(m.get('v3')).toBe('invoice_on_dispatch')
    expect(m.get('v4')).toBe('invoice_on_dispatch')
  })

  it('collapses multiple size-rows of one variant to prepaid if ANY is prepaid', () => {
    // variant_inventory is per (variant, size); a variant is "prepaid" for
    // billing purposes if any of its size rows is prepaid.
    const m = buildBillingModeMap([
      { variant_id: 'v1', billing_mode: 'invoice_on_dispatch' },
      { variant_id: 'v1', billing_mode: 'prepaid' },
    ])
    expect(m.get('v1')).toBe('prepaid')
  })
})
