export type SupportedCurrency = 'NZD' | 'AUD' | 'USD' | 'GBP' | 'EUR';
export type ExchangeRates = Record<SupportedCurrency, number>;

export const SUPPORTED_CURRENCIES: readonly SupportedCurrency[] = [
  'NZD',
  'AUD',
  'USD',
  'GBP',
  'EUR',
] as const;

export const CURRENCY_OPTIONS: { code: SupportedCurrency; label: string; shortLabel: string }[] = [
  { code: 'NZD', label: 'NZ$ NZD', shortLabel: 'NZ$' },
  { code: 'AUD', label: 'A$ AUD', shortLabel: 'A$' },
  { code: 'USD', label: 'US$ USD', shortLabel: 'US$' },
  { code: 'GBP', label: '£ GBP', shortLabel: '£' },
  { code: 'EUR', label: '€ EUR', shortLabel: '€' },
];
