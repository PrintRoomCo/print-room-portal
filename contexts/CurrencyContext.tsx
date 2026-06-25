'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import type { SupportedCurrency, ExchangeRates } from '@/lib/currency/types';
import { CURRENCY_STORAGE_KEY } from '@/lib/currency/types';
import { fetchExchangeRates } from '@/lib/currency/exchange-rates';
import { formatCurrency, convertNZD } from '@/lib/currency/format';

const STORAGE_KEY = CURRENCY_STORAGE_KEY;
// 1 year — keep the preference around long enough to feel permanent.
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function persistCurrency(c: SupportedCurrency) {
  try {
    localStorage.setItem(STORAGE_KEY, c);
  } catch {
    // localStorage unavailable
  }
  try {
    // Cookie lets the server render the right currency on first paint (no flash).
    document.cookie = `${STORAGE_KEY}=${c}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
  } catch {
    // document unavailable
  }
}

interface CurrencyContextValue {
  currency: SupportedCurrency;
  setCurrency: (c: SupportedCurrency) => void;
  rates: ExchangeRates | null;
  loading: boolean;
  convert: (nzdAmount: number) => number;
  format: (nzdAmount: number) => string;
  formatDirect: (amount: number) => string;
}

const CurrencyContext = createContext<CurrencyContextValue | undefined>(undefined);

function getStoredCurrency(): SupportedCurrency | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && ['NZD', 'AUD', 'USD', 'GBP', 'EUR'].includes(stored)) {
      return stored as SupportedCurrency;
    }
  } catch {
    // localStorage unavailable
  }
  return null;
}

export function CurrencyProvider({
  children,
  initialRates = null,
  initialCurrency = 'NZD',
}: {
  children: React.ReactNode
  initialRates?: ExchangeRates | null
  initialCurrency?: SupportedCurrency
}) {
  // `initialCurrency` is resolved server-side (saved cookie -> geo country -> NZD)
  // so the first paint already shows the right currency.
  const [currency, setCurrencyState] = useState<SupportedCurrency>(initialCurrency);
  const [rates, setRates] = useState<ExchangeRates | null>(initialRates);
  const [loading, setLoading] = useState(!initialRates);

  // Reconcile with a legacy localStorage preference: users who picked a currency
  // before the cookie existed have it in localStorage but not in the cookie the
  // server reads. Honour it and backfill the cookie so the next load is correct.
  useEffect(() => {
    const saved = getStoredCurrency();
    if (saved && saved !== initialCurrency) {
      // Intentional: localStorage isn't readable during SSR, so the first render
      // must use the server's `initialCurrency` (avoids a hydration mismatch) and
      // we correct to a legacy saved preference here, on mount.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCurrencyState(saved);
      persistCurrency(saved);
    }

    if (initialRates) {
      setLoading(false);
      return;
    }

    let stale = false;
    fetchExchangeRates()
      .then((nextRates) => {
        if (!stale) setRates(nextRates);
      })
      .finally(() => {
        if (!stale) setLoading(false);
      });

    return () => {
      stale = true;
    };
  }, [initialRates, initialCurrency]);

  const setCurrency = useCallback((c: SupportedCurrency) => {
    setCurrencyState(c);
    persistCurrency(c);
  }, []);

  const convert = useCallback(
    (nzdAmount: number): number => {
      if (!rates) return nzdAmount;
      return convertNZD(nzdAmount, currency, rates);
    },
    [currency, rates],
  );

  const format = useCallback(
    (nzdAmount: number): string => {
      if (!rates) return formatCurrency(nzdAmount, 'NZD');
      const converted = convertNZD(nzdAmount, currency, rates);
      return formatCurrency(converted, currency);
    },
    [currency, rates],
  );

  const formatDirect = useCallback(
    (amount: number): string => formatCurrency(amount, currency),
    [currency],
  );

  const contextValue = useMemo<CurrencyContextValue>(
    () => ({
      currency,
      setCurrency,
      rates,
      loading,
      convert,
      format,
      formatDirect,
    }),
    [currency, setCurrency, rates, loading, convert, format, formatDirect],
  );

  return (
    <CurrencyContext.Provider value={contextValue}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  const context = useContext(CurrencyContext);
  if (context === undefined) {
    throw new Error('useCurrency must be used within a CurrencyProvider');
  }
  return context;
}
