// lib/starshipit/verify-webhook.ts

/**
 * Validate the shared secret Starshipit sends via ?secret= or the
 * X-Starshipit-Secret / X-Starshipit-Hmac header. Fail-closed: when
 * STARSHIPIT_WEBHOOK_SECRET is unset the webhook is OFF (returns false) — the
 * dark-by-default switch for inbound. Mirrors the studio receiver's secret
 * check, but fail-closed instead of skip-when-unset.
 */
export function verifyStarshipitWebhookSecret(input: {
  configuredSecret: string | undefined
  querySecret: string | null
  headerSecret: string | null
}): boolean {
  if (!input.configuredSecret) return false
  const incoming = input.querySecret || input.headerSecret
  return incoming === input.configuredSecret
}
