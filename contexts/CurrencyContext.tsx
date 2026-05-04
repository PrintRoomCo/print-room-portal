'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import type { SupportedCurrency, ExchangeRates } from '@/lib/currency/types';
import { fetchExchangeRates } from '@/lib/currency/exchange-rates';
import { detectCurrencyFromBrowser } from '@/lib/currency/detect';
import { formatCurrency, convertNZD } from '@/lib/currency/format';

const STORAGE_KEY = 'prs-currency';

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

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const [currency, setCurrencyState] = useState<SupportedCurrency>('NZD');
  const [rates, setRates] = useState<ExchangeRates | null>(null);
  const [loading, setLoading] = useState(true);

  // Initialize: load saved preference or detect from browser, then fetch rates
  useEffect(() => {
    const saved = getStoredCurrency();
    const detected = saved ?? detectCurrencyFromBrowser();
    setCurrencyState(detected);

    fetchExchangeRates()
      .then(setRates)
      .finally(() => setLoading(false));
  }, []);

  const setCurrency = useCallback((c: SupportedCurrency) => {
    setCurrencyState(c);
    try {
      localStorage.setItem(STORAGE_KEY, c);
    } catch {
      // localStorage unavailable
    }
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
