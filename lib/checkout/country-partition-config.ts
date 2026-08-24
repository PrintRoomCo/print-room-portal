const TRUTHY = new Set(['1', 'true', 'on', 'yes'])
type CheckoutCountryPartitionEnv = Pick<
  NodeJS.ProcessEnv,
  'CHECKOUT_COUNTRY_PARTITION_ENABLED'
>

export function isCheckoutCountryPartitionEnabled(
  env: CheckoutCountryPartitionEnv = process.env as unknown as CheckoutCountryPartitionEnv,
): boolean {
  return TRUTHY.has((env.CHECKOUT_COUNTRY_PARTITION_ENABLED ?? '').trim().toLowerCase())
}
