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

  /**
   * The $0 'custom' placeholder decoration is attached catalogue-wide and never
   * pools — `lib/pricing/decoration-pooling.ts` and the staff pooling-readiness
   * checklist both state its "pricing is unaffected". It has no ladder and no
   * engine branch, so the currency RPC returns NULL for it in EVERY currency,
   * including the org's own. Pre-flag that NULL fell through to the flat
   * unit_price (0.00); under country partition it became a hard
   * CountryPriceUnavailableError — surfacing to customers as "<product> is not
   * orderable to NZ yet" on a fully-configured NZ catalogue.
   *
   * Zero has no exchange rate, so a flat $0 decoration is $0 in any currency.
   * That is the ONLY fallback restored — a non-zero NZD flat price must still
   * fail rather than be billed as AUD, which is what the flag exists to prevent.
   */
  it('prices an unpriceable $0 decoration at 0 rather than blocking the order', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null })

    await expect(
      effectiveDecorationPrice(
        { rpc } as unknown as SupabaseClient,
        { ...input, unitPriceOverride: null, baseUnitPrice: 0 },
        100,
        1,
        { countryPartitionEnabled: true, targetCurrency: 'NZD' },
      ),
    ).resolves.toBe(0)
  })

  it('treats a $0 per-link override as $0 too', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null })

    await expect(
      effectiveDecorationPrice(
        { rpc } as unknown as SupabaseClient,
        { ...input, unitPriceOverride: 0, baseUnitPrice: 88 },
        100,
        1,
        { countryPartitionEnabled: true, targetCurrency: 'AUD' },
      ),
    ).resolves.toBe(0)
  })

  it('still returns null for a NON-zero flat price — that is the currency hole', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null })

    await expect(
      effectiveDecorationPrice(
        { rpc } as unknown as SupabaseClient,
        { ...input, unitPriceOverride: null, baseUnitPrice: 12.5 },
        100,
        1,
        { countryPartitionEnabled: true, targetCurrency: 'AUD' },
      ),
    ).resolves.toBeNull()
  })

  it('still returns null when the RPC itself errored, even at $0', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: 'boom' } })

    await expect(
      effectiveDecorationPrice(
        { rpc } as unknown as SupabaseClient,
        { ...input, unitPriceOverride: null, baseUnitPrice: 0 },
        100,
        1,
        { countryPartitionEnabled: true, targetCurrency: 'NZD' },
      ),
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
