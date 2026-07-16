// lib/starshipit/config.ts

export interface StarshipitCredentials {
  apiKey: string
  subscriptionKey: string
}

/** Deploy-dark rollout flag. Truthy = attempt Starshipit push/inbound. */
export function isStarshipitEnabled(): boolean {
  const v = (process.env.STARSHIPIT_ENABLED ?? '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'on' || v === 'yes'
}

/**
 * Read + validate Starshipit credentials. Throws if absent. Mirrors the studio
 * getHeaders() env contract (STARSHIPIT_API_KEY + STARSHIPIT_SUBSCRIPTION_KEY).
 * These point at the consolidated "Print Room Dispatch" account.
 */
export function getStarshipitCredentials(): StarshipitCredentials {
  const apiKey = process.env.STARSHIPIT_API_KEY ?? ''
  const subscriptionKey = process.env.STARSHIPIT_SUBSCRIPTION_KEY ?? ''
  if (!apiKey || !subscriptionKey) {
    throw new Error(
      'Missing Starshipit credentials. Set STARSHIPIT_API_KEY and STARSHIPIT_SUBSCRIPTION_KEY.',
    )
  }
  return { apiKey, subscriptionKey }
}
