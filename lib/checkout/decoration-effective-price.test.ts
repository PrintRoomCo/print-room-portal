import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { effectiveDecorationPrice } from './decoration-effective-price'

const input = {
  orgDecorationId: 'decoration-1',
  organizationId: 'org-1',
  unitPriceOverride: 99,
  baseUnitPrice: 88,
}

describe('effectiveDecorationPrice country pricing', () => {
  it('uses the exact target currency and preserves an authored zero when enabled', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 0, error: null })

    await expect(
      effectiveDecorationPrice({ rpc } as unknown as SupabaseClient, input, 100, 1, {
        countryPartitionEnabled: true,
        targetCurrency: 'AUD',
      }),
    ).resolves.toBe(0)
    expect(rpc).toHaveBeenCalledWith('effective_decoration_unit_price_for_currency', {
      p_org_decoration_id: 'decoration-1',
      p_qty: 100,
      p_currency: 'AUD',
    })
  })

  it('returns null instead of falling back to legacy unkeyed NZD values', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null })

    await expect(
      effectiveDecorationPrice({ rpc } as unknown as SupabaseClient, input, 100, 1, {
        countryPartitionEnabled: true,
        targetCurrency: 'AUD',
      }),
    ).resolves.toBeNull()
  })

  it('keeps the legacy RPC arguments and fallback when the flag is off', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null })

    await expect(
      effectiveDecorationPrice({ rpc } as unknown as SupabaseClient, input, 100, 1),
    ).resolves.toBe(99)
    expect(rpc).toHaveBeenCalledWith('effective_decoration_unit_price', {
      p_org_decoration_id: 'decoration-1',
      p_qty: 100,
    })
  })
})
