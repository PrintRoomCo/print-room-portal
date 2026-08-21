import type { EnabledCountry } from '@/lib/account/org-countries'

/** ISO country for a location write: the submitted code if the org has it
 * enabled, else the org default, else null (org has no countries — reject). */
export function resolveLocationCountry(
  input: string | null | undefined,
  enabled: EnabledCountry[],
): string | null {
  const code = (input ?? '').trim().toUpperCase()
  if (code && enabled.some((c) => c.code === code)) return code
  return enabled.find((c) => c.isDefault)?.code ?? enabled[0]?.code ?? null
}
