import { cookies, headers } from 'next/headers';
import type { SupportedCurrency } from './types';
import { CURRENCY_STORAGE_KEY } from './types';
import { resolveCurrency } from './detect';

/**
 * Resolve the currency to render on first paint, server-side, so there is no
 * post-hydration flash. Priority: saved preference cookie -> geo-detected
 * country (Vercel's `x-vercel-ip-country`) -> fallback (the org's base
 * currency; NZD when the org is unknown).
 *
 * The geo header is only present on Vercel; locally / on bots / for unknown
 * regions it's absent and we fall through.
 */
export async function resolveInitialCurrency(
  fallback: SupportedCurrency = 'NZD',
): Promise<SupportedCurrency> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const saved = cookieStore.get(CURRENCY_STORAGE_KEY)?.value ?? null;
  const country = headerStore.get('x-vercel-ip-country');
  return resolveCurrency({ saved, country, fallback });
}
