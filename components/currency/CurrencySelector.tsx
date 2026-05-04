'use client';

import { useCurrency } from '@/contexts/CurrencyContext';
import type { SupportedCurrency } from '@/lib/currency/types';

const OPTIONS: { code: SupportedCurrency; label: string; shortLabel: string }[] = [
  { code: 'NZD', label: 'NZ$ NZD', shortLabel: 'NZ$' },
  { code: 'AUD', label: 'A$ AUD', shortLabel: 'A$' },
  { code: 'USD', label: 'US$ USD', shortLabel: 'US$' },
  { code: 'GBP', label: '£ GBP', shortLabel: '£' },
  { code: 'EUR', label: '€ EUR', shortLabel: '€' },
];

const selectClass = "appearance-none rounded-full text-sm leading-tight bg-transparent text-black hover:bg-black/5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-black/40 border-none";

export function CurrencySelector() {
  const { currency, setCurrency, loading } = useCurrency();

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) =>
    setCurrency(e.target.value as SupportedCurrency);

  return (
    <>
      <select
        value={currency}
        onChange={handleChange}
        disabled={loading}
        aria-label="Select currency"
        className={`${selectClass} sm:hidden min-h-[44px] h-[44px] px-2`}
      >
        {OPTIONS.map(({ code, shortLabel }) => (
          <option key={code} value={code}>
            {shortLabel}
          </option>
        ))}
      </select>
      <select
        value={currency}
        onChange={handleChange}
        disabled={loading}
        aria-label="Select currency"
        className={`${selectClass} hidden sm:block h-[26px] px-3`}
      >
        {OPTIONS.map(({ code, label }) => (
          <option key={code} value={code}>
            {label}
          </option>
        ))}
      </select>
    </>
  );
}
