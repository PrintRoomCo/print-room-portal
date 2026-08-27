# Display vs Billing Currency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the currency picker work for every org (including AU orgs) on all shopping surfaces, keep `/checkout/review` in true invoice currency, and add a "you will be invoiced in X" tooltip on `/checkout`.

**Architecture:** The FX core gains `convertBetween(amount, from, to, rates)` (cross-rated through the NZD-base rate table). `CurrencyContext` loses its AU billing pin and instead takes a `baseCurrency` prop naming the denomination of stored numbers; every consumer already routing through `format()` becomes correct without edits. Billing surfaces (`/checkout/review`, confirmation, past orders) never convert; `/checkout` opts into display conversion via new props on `CountryBilledOrderSummary`. Spec: `docs/superpowers/specs/2026-08-27-display-vs-billing-currency-design.md`.

**Tech Stack:** Next.js App Router (React server + client components), TypeScript, Vitest + @testing-library/react + jest-dom (jsdom, globals on).

## Global Constraints

- **No em dashes anywhere**: not in code, comments, copy, commit messages, or test names. Use commas, colons, or parentheses instead.
- **One rule from the spec (D8), stated once:** convert wherever the number is not the number you will be billed. Shopping surfaces convert; billing surfaces render authored figures verbatim.
- **Display FX must never reach an invoice.** `lib/checkout/submit.ts` derives billing currency server-side; nothing in this plan may feed a client-converted number into any submit path.
- **`convertNZD` is removed, not aliased.** No deprecated wrapper.
- **D7 surfaces are out of scope:** `ConfirmationView.tsx`, `OrdersTable.tsx`, and anything reading a stored order's immutable currency must not be touched.
- Work on the current branch `design/display-vs-billing-currency` (it already carries the spec and this plan; the whole change merges as one PR).
- Commands: tests `npx vitest run <file>` (or `npm test` for the full suite), typecheck `npx tsc --noEmit`, lint `npm run lint`.
- Commit messages end with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- Vitest is configured with `globals: true` and jest-dom loaded via `vitest.setup.ts`; test files still import `describe/it/expect/vi` from `'vitest'` explicitly, matching the existing test files.

---

### Task 1: `convertBetween` in the FX core

**Files:**
- Modify: `lib/currency/format.ts`
- Test: `lib/currency/__tests__/format.test.ts` (create)

**Interfaces:**
- Consumes: `SupportedCurrency`, `ExchangeRates` from `lib/currency/types.ts` (existing).
- Produces: `convertBetween(amount: number, from: SupportedCurrency, to: SupportedCurrency, rates: ExchangeRates): number`. Tasks 3 and 7 call it. `convertNZD` stays in place for now; Task 3 deletes it when its last caller goes.

The rate table is NZD-base: `rates[NZD] = 1`, `rates[AUD] = 0.83392`, `rates[USD] = 0.597219` (values refreshed 2026-08-26). Cross-rate is `amount * rates[to] / rates[from]`. The guard (spec D2): a missing or zero rate on either side returns the amount unconverted, matching `fetchExchangeRates`'s fail-safe posture, so a malformed table can never paint `$NaN` on a price.

- [x] **Step 1: Write the failing test**

Create `lib/currency/__tests__/format.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { convertBetween, formatCurrency } from '../format'
import type { ExchangeRates } from '../types'

const rates: ExchangeRates = {
  NZD: 1,
  AUD: 0.83392,
  USD: 0.597219,
  GBP: 0.4423,
  EUR: 0.5121,
}

describe('convertBetween', () => {
  it('returns the amount untouched when from equals to', () => {
    expect(convertBetween(123.45, 'AUD', 'AUD', rates)).toBe(123.45)
  })

  it('converts from the NZD base exactly like the old convertNZD path', () => {
    expect(convertBetween(100, 'NZD', 'AUD', rates)).toBeCloseTo(83.392, 10)
  })

  it('cross-rates AUD to USD through the NZD-base table', () => {
    expect(convertBetween(100, 'AUD', 'USD', rates)).toBeCloseTo(
      (100 * 0.597219) / 0.83392,
      10,
    )
  })

  it('converts back toward the base by dividing out the from rate', () => {
    expect(convertBetween(83.392, 'AUD', 'NZD', rates)).toBeCloseTo(100, 10)
  })

  it('returns the amount unconverted when the from rate is missing', () => {
    const partial = { NZD: 1, USD: 0.597219 } as ExchangeRates
    expect(convertBetween(100, 'AUD', 'USD', partial)).toBe(100)
  })

  it('returns the amount unconverted when the from rate is zero', () => {
    expect(convertBetween(100, 'AUD', 'USD', { ...rates, AUD: 0 })).toBe(100)
  })

  it('returns the amount unconverted when the to rate is missing or zero', () => {
    const partial = { NZD: 1, AUD: 0.83392 } as ExchangeRates
    expect(convertBetween(100, 'AUD', 'USD', partial)).toBe(100)
    expect(convertBetween(100, 'AUD', 'USD', { ...rates, USD: 0 })).toBe(100)
  })
})

describe('formatCurrency', () => {
  it('formats with the currency-appropriate locale', () => {
    expect(formatCurrency(1234.5, 'NZD')).toBe('$1,234.50')
    expect(formatCurrency(1234.5, 'GBP')).toBe('£1,234.50')
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/currency/__tests__/format.test.ts`
Expected: FAIL, `convertBetween` is not exported from `../format`.

- [x] **Step 3: Implement `convertBetween`**

In `lib/currency/format.ts`, add below `formatCurrency` (keep `convertNZD` untouched for now; Task 3 removes it):

```ts
export function convertBetween(
  amount: number,
  from: SupportedCurrency,
  to: SupportedCurrency,
  rates: ExchangeRates,
): number {
  if (from === to) return amount;
  const fromRate = rates[from];
  const toRate = rates[to];
  // Fail-safe, matching fetchExchangeRates's posture: a missing or zero rate
  // renders the figure unconverted rather than as Infinity or NaN.
  if (!fromRate || !toRate) return amount;
  return amount * (toRate / fromRate);
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/currency/__tests__/format.test.ts`
Expected: PASS (9 tests).

- [x] **Step 5: Commit**

```bash
git add lib/currency/format.ts lib/currency/__tests__/format.test.ts
git commit -m "feat(currency): add cross-rating convertBetween with fail-safe rate guards

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Thread the base-currency fallback through detection

**Files:**
- Modify: `lib/currency/detect.ts:28-48`
- Modify: `lib/currency/server-currency.ts`
- Test: `lib/currency/__tests__/detect.test.ts` (extend)

**Interfaces:**
- Produces: `currencyForCountry(country, fallback?: SupportedCurrency)` (fallback defaults to `'NZD'`), `resolveCurrency({ saved, country, fallback? })`, `resolveInitialCurrency(fallback?: SupportedCurrency)`. Task 3's layout change calls `resolveInitialCurrency(defaultBillingCountry.currency)`.

Why threading, not `??` at the call site: `resolveCurrency` hard-defaults to NZD and never returns null, so `resolveInitialCurrency() ?? base` could never fire. The priority chain becomes: saved cookie, then geo country, then the caller's fallback (the org base currency). Geo deliberately outranks base, so every NZ org's chain is byte-identical to today and the geo feature from `6380fa0` is preserved.

The only callers of these three functions are `lib/currency/server-currency.ts` and `app/(portal)/layout.tsx` (verified by grep), so the signature change is contained.

- [x] **Step 1: Write the failing tests**

Append to `lib/currency/__tests__/detect.test.ts`:

```ts
describe('currencyForCountry with an explicit fallback', () => {
  it('uses the fallback for unknown countries', () => {
    expect(currencyForCountry('JP', 'AUD')).toBe('AUD')
  })

  it('uses the fallback when the country is missing', () => {
    expect(currencyForCountry(null, 'AUD')).toBe('AUD')
    expect(currencyForCountry(undefined, 'AUD')).toBe('AUD')
  })

  it('still resolves a known country over the fallback', () => {
    expect(currencyForCountry('US', 'AUD')).toBe('USD')
  })
})

describe('resolveCurrency fallback chain (saved, then geo, then base)', () => {
  it('prefers a valid saved preference over geo and the fallback', () => {
    expect(resolveCurrency({ saved: 'USD', country: 'NZ', fallback: 'AUD' })).toBe('USD')
  })

  it('prefers the geo country over the fallback', () => {
    expect(resolveCurrency({ saved: null, country: 'US', fallback: 'AUD' })).toBe('USD')
  })

  it('lands on the fallback only when saved and geo are both absent', () => {
    expect(resolveCurrency({ saved: null, country: null, fallback: 'AUD' })).toBe('AUD')
  })

  it('keeps NZD as the default fallback so the NZ-org chain is unchanged', () => {
    expect(resolveCurrency({ saved: null, country: null })).toBe('NZD')
  })
})
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/currency/__tests__/detect.test.ts`
Expected: FAIL. `currencyForCountry('JP', 'AUD')` returns `'NZD'` (second argument ignored), and the `fallback` property is not part of `resolveCurrency`'s parameter type.

- [x] **Step 3: Implement the fallback threading**

In `lib/currency/detect.ts`, replace `currencyForCountry` and `resolveCurrency` (lines 23-48) with:

```ts
/**
 * Map a visitor's country code to a display currency. The fallback covers
 * unknown countries and an unavailable country (local dev, bots, regions we
 * don't price); callers pass the org's base currency so an AU org lands on
 * AUD, not NZD.
 */
export function currencyForCountry(
  country: string | null | undefined,
  fallback: SupportedCurrency = 'NZD',
): SupportedCurrency {
  if (!country) return fallback;
  return COUNTRY_CURRENCY_MAP[country.toUpperCase()] ?? fallback;
}

/**
 * Resolve the currency a visitor should land on, in priority order:
 *   1. their saved preference (if valid)
 *   2. the geo-detected country
 *   3. the fallback (the org's base currency; NZD when unknown)
 */
export function resolveCurrency({
  saved,
  country,
  fallback = 'NZD',
}: {
  saved: string | null | undefined;
  country: string | null | undefined;
  fallback?: SupportedCurrency;
}): SupportedCurrency {
  if (isSupportedCurrency(saved)) return saved;
  return currencyForCountry(country, fallback);
}
```

In `lib/currency/server-currency.ts`, replace `resolveInitialCurrency` (and its doc comment's trailing "-> NZD" with "-> fallback"):

```ts
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
```

- [x] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run lib/currency/__tests__/detect.test.ts` then `npx tsc --noEmit`
Expected: PASS (all detect tests, old and new); typecheck clean (existing callers pass no fallback and get the NZD default).

- [x] **Step 5: Commit**

```bash
git add lib/currency/detect.ts lib/currency/server-currency.ts lib/currency/__tests__/detect.test.ts
git commit -m "feat(currency): thread an org base-currency fallback through detection

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Unpin CurrencyContext, rewire the layout, delete convertNZD

**Files:**
- Modify: `contexts/CurrencyContext.tsx` (full rewrite of the pin logic)
- Modify: `app/(portal)/layout.tsx:44-56, 63-69`
- Modify: `lib/currency/format.ts` (delete `convertNZD`)
- Modify: `lib/currency/index.ts:7`
- Test: `contexts/__tests__/CurrencyContext.test.tsx` (create)

**Interfaces:**
- Consumes: `convertBetween` (Task 1), `resolveInitialCurrency(fallback)` (Task 2), `isSupportedCurrency` from `lib/currency/detect.ts`.
- Produces: `CurrencyProvider` props become `{ children, initialRates?, initialCurrency?, baseCurrency?: SupportedCurrency }` (the `billingCurrency` prop is deleted). The context value becomes:

```ts
interface CurrencyContextValue {
  currency: SupportedCurrency;
  setCurrency: (c: SupportedCurrency) => void;
  rates: ExchangeRates | null;
  loading: boolean;
  /** Denomination of the org's stored numbers (default billing country). */
  baseCurrency: SupportedCurrency;
  convert: (amount: number) => number;
  format: (amount: number) => string;
  /** Formats an amount denominated in an arbitrary currency into the display currency. */
  formatFrom: (amount: number, sourceCurrency: string) => string;
  formatDirect: (amount: number) => string;
}
```

`billingLocked` is deleted from the value (its only two mentions are inside this file; no consumer reads it, verified by grep). Tasks 4 and 7 consume `formatFrom` and `baseCurrency`.

This is one task because the provider prop change and the layout's prop passing are coupled: splitting them leaves a commit that does not compile.

- [x] **Step 1: Write the failing tests**

Create `contexts/__tests__/CurrencyContext.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { CurrencyProvider, useCurrency } from '../CurrencyContext'
import { formatCurrency } from '@/lib/currency/format'
import type { ExchangeRates, SupportedCurrency } from '@/lib/currency/types'

// Keep the rates-absent test deterministic: the client-side rate fetch never
// resolves, so the provider stays in its fallback formatting path.
vi.mock('@/lib/currency/exchange-rates', () => ({
  fetchExchangeRates: () => new Promise(() => {}),
}))

const rates: ExchangeRates = { NZD: 1, AUD: 0.8, USD: 0.6, GBP: 0.44, EUR: 0.51 }

function Probe() {
  const { currency, setCurrency, format, formatFrom, baseCurrency } = useCurrency()
  return (
    <div>
      <span data-testid="currency">{currency}</span>
      <span data-testid="base">{baseCurrency}</span>
      <span data-testid="formatted">{format(100)}</span>
      <span data-testid="from-aud">{formatFrom(100, 'AUD')}</span>
      <button type="button" onClick={() => setCurrency('USD')}>
        pick USD
      </button>
    </div>
  )
}

function renderProvider(props: {
  initialRates?: ExchangeRates | null
  initialCurrency?: SupportedCurrency
  baseCurrency?: SupportedCurrency
}) {
  return render(
    <CurrencyProvider {...props}>
      <Probe />
    </CurrencyProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  document.cookie = 'prs-currency=; path=/; max-age=0'
})

describe('CurrencyProvider with an AUD base', () => {
  it('converts a base AUD amount into the picked display currency', () => {
    renderProvider({ initialRates: rates, initialCurrency: 'USD', baseCurrency: 'AUD' })
    // 100 AUD -> USD through the NZD-base table: 100 * 0.6 / 0.8 = 75.
    expect(screen.getByTestId('formatted')).toHaveTextContent(formatCurrency(75, 'USD'))
  })

  it('lets an AU org change currency, updating state and persistence', () => {
    renderProvider({ initialRates: rates, initialCurrency: 'AUD', baseCurrency: 'AUD' })
    expect(screen.getByTestId('currency')).toHaveTextContent('AUD')
    fireEvent.click(screen.getByRole('button', { name: 'pick USD' }))
    expect(screen.getByTestId('currency')).toHaveTextContent('USD')
    expect(localStorage.getItem('prs-currency')).toBe('USD')
    expect(document.cookie).toContain('prs-currency=USD')
  })

  it('formats in the base currency, not NZD, while rates are absent', () => {
    renderProvider({ initialRates: null, initialCurrency: 'USD', baseCurrency: 'AUD' })
    // No rates: fall back to the authored denomination rather than relabelling.
    expect(screen.getByTestId('formatted')).toHaveTextContent(formatCurrency(100, 'AUD'))
  })
})

describe('formatFrom', () => {
  it('converts an amount denominated in another supported currency into display', () => {
    renderProvider({ initialRates: rates, initialCurrency: 'NZD', baseCurrency: 'NZD' })
    // 100 AUD -> NZD: 100 * 1 / 0.8 = 125.
    expect(screen.getByTestId('from-aud')).toHaveTextContent(formatCurrency(125, 'NZD'))
  })

  it('renders an unconvertible amount verbatim in its own currency', () => {
    renderProvider({ initialRates: null, initialCurrency: 'USD', baseCurrency: 'NZD' })
    expect(screen.getByTestId('from-aud')).toHaveTextContent(formatCurrency(100, 'AUD'))
  })
})
```

The `setCurrency` test is the one that would have caught the original defect.

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run contexts/__tests__/CurrencyContext.test.tsx`
Expected: FAIL. `baseCurrency` and `formatFrom` do not exist on the context value, and the typecheck inside vitest rejects the `baseCurrency` prop.

- [x] **Step 3: Rewrite `contexts/CurrencyContext.tsx`**

Replace the whole file with:

```tsx
'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import type { SupportedCurrency, ExchangeRates } from '@/lib/currency/types';
import { CURRENCY_STORAGE_KEY } from '@/lib/currency/types';
import { fetchExchangeRates } from '@/lib/currency/exchange-rates';
import { formatCurrency, convertBetween } from '@/lib/currency/format';
import { isSupportedCurrency } from '@/lib/currency/detect';

const STORAGE_KEY = CURRENCY_STORAGE_KEY;
// 1 year: keep the preference around long enough to feel permanent.
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
  /** Denomination of the org's stored numbers (default billing country). */
  baseCurrency: SupportedCurrency;
  convert: (amount: number) => number;
  format: (amount: number) => string;
  /** Formats an amount denominated in an arbitrary currency into the display currency. */
  formatFrom: (amount: number, sourceCurrency: string) => string;
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
  baseCurrency = 'NZD',
}: {
  children: React.ReactNode
  initialRates?: ExchangeRates | null
  initialCurrency?: SupportedCurrency
  /**
   * Denomination of the org's stored numbers (its default billing country's
   * currency). convert/format cross-rate FROM this INTO the picked display
   * currency; when they are equal the amount passes through untouched.
   */
  baseCurrency?: SupportedCurrency
}) {
  // `initialCurrency` is resolved server-side (saved cookie -> geo country ->
  // org base currency) so the first paint already shows the right currency.
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
    (amount: number): number => {
      if (!rates) return amount;
      return convertBetween(amount, baseCurrency, currency, rates);
    },
    [baseCurrency, currency, rates],
  );

  const formatFrom = useCallback(
    (amount: number, sourceCurrency: string): string => {
      // An unconvertible amount (no rates yet, or a currency outside the rate
      // table) renders verbatim in its own currency rather than relabelled in
      // the display currency.
      if (!rates || !isSupportedCurrency(sourceCurrency)) {
        return formatCurrency(amount, sourceCurrency);
      }
      return formatCurrency(convertBetween(amount, sourceCurrency, currency, rates), currency);
    },
    [currency, rates],
  );

  const format = useCallback(
    (amount: number): string => formatFrom(amount, baseCurrency),
    [formatFrom, baseCurrency],
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
      baseCurrency,
      convert,
      format,
      formatFrom,
      formatDirect,
    }),
    [currency, setCurrency, rates, loading, baseCurrency, convert, format, formatFrom, formatDirect],
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
```

- [x] **Step 4: Rewire `app/(portal)/layout.tsx`**

Three edits:

1. In `CountryAwareCompanyProvider`, delete the `initialCurrency` prop (from both the props object and its type) and resolve it inside, after `defaultBillingCountry` is known. Replace lines 33-58 with:

```tsx
  const defaultBillingCountry = initialAccess?.companyId
    ? await getOrgDefaultBillingCountry(getSupabaseServer(), initialAccess.companyId)
    : await getPlatformBillingCountry(getSupabaseServer(), 'NZ')

  // Saved cookie -> geo country -> org base currency. Resolved here rather
  // than in PortalLayout because the terminal fallback is the org's base
  // currency, which is only known once defaultBillingCountry loads.
  const initialCurrency = await resolveInitialCurrency(defaultBillingCountry.currency)

  return (
    <CompanyProvider
      initialAccess={initialAccess}
      initialUserId={initialUserId}
      countryPartitionEnabled={countryPartitionEnabled}
      defaultBillingCountry={defaultBillingCountry}
    >
      <CurrencyProvider
        initialRates={initialRates}
        initialCurrency={initialCurrency}
        baseCurrency={defaultBillingCountry.currency}
      >
        {children}
      </CurrencyProvider>
    </CompanyProvider>
  )
```

2. In `PortalLayout`, drop `resolveInitialCurrency()` from the `Promise.all` (lines 64-69) and the `initialCurrency={initialCurrency}` prop from the `CountryAwareCompanyProvider` mount (line 80):

```tsx
  const [user, access, exchangeRates] = await Promise.all([
    getPortalUser(),
    getPortalCompanyAccess(),
    getServerExchangeRates(),
  ])
```

3. Keep the `resolveInitialCurrency` import (line 10); it is now used inside `CountryAwareCompanyProvider`.

`defaultBillingCountry.currency` is already typed `SupportedCurrency` (`lib/account/org-countries.ts:13`), so no cast is needed.

- [x] **Step 5: Delete `convertNZD`**

In `lib/currency/format.ts`, delete the whole `convertNZD` function (its last callers were replaced in Step 3). In `lib/currency/index.ts` line 7, change:

```ts
export { formatCurrency, convertBetween } from './format';
```

- [x] **Step 6: Run tests, typecheck, and the leftover grep**

Run: `npx vitest run contexts/__tests__/CurrencyContext.test.tsx lib/currency` then `npx tsc --noEmit` then:

```bash
grep -rn "convertNZD\|billingLocked\|billingCurrency=" --include='*.ts' --include='*.tsx' components app lib contexts
```

Expected: tests PASS, typecheck clean, grep returns nothing (the server-side `billingCurrency` variable in `lib/checkout/submit.ts` has no `=` JSX form and is untouched by design).

- [x] **Step 7: Run the full suite to catch consumer fallout**

Run: `npm test`
Expected: PASS. The ten `useCurrency()` consumers all route through `format()` and are untouched. `Money.test.tsx` and `CatalogueGrid.test.tsx` mock the context module wholesale, so the interface change does not break them yet; `Money` itself still has its old props until Task 4.

- [x] **Step 8: Commit**

```bash
git add contexts/CurrencyContext.tsx "app/(portal)/layout.tsx" lib/currency/format.ts lib/currency/index.ts contexts/__tests__/CurrencyContext.test.tsx
git commit -m "feat(currency): replace the AU billing pin with a base-currency FX layer

setCurrency now works for every org. convert/format cross-rate from the org
base currency into the picked display currency; the rates-absent fallback
formats in base, not NZD. convertNZD is gone, convertBetween replaces it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Money converts instead of relabelling

**Files:**
- Modify: `components/shop/Money.tsx` (full rewrite)
- Modify: `components/shop/ProductCard.tsx:99-108` (4 call sites)
- Modify: `components/shop/__tests__/Money.test.tsx` (rewrite)
- Modify: `components/shop/__tests__/CatalogueGrid.test.tsx:8-14` (mock gains `formatFrom`)
- Modify: `lib/format/price.ts:4` (doc comment)

**Interfaces:**
- Consumes: `formatFrom` from the context (Task 3).
- Produces: `Money` props become `{ amount: number, sourceCurrency?: string, className?: string }` (`nzd` and `currency` are gone). `<Money` has exactly these call sites: `ProductCard.tsx` (4) and its own test (verified by grep).

The old `currency` prop meant "bypass FX and relabel". The new `sourceCurrency` means "this amount is denominated in X, convert it to display". The old loading branch (hardcoded NZD) is subsumed: `format`/`formatFrom` already fall back to the source denomination while rates are absent.

- [x] **Step 1: Rewrite the test to assert the D8 boundary**

Replace `components/shop/__tests__/Money.test.tsx` with:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Money } from '../Money'

vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({
    currency: 'USD',
    loading: false,
    format: (amount: number) => `BASE>USD ${amount.toFixed(2)}`,
    formatFrom: (amount: number, sourceCurrency: string) =>
      `${sourceCurrency}>USD ${amount.toFixed(2)}`,
  }),
}))

// The pre-D8 rule from be9e931 ("an authored currency bypasses visitor
// conversion") moved to the billing surfaces: /checkout/review renders
// authored figures verbatim via CountryBilledOrderSummary's default
// formatter. On shopping surfaces Money now converts; the rule is to convert
// wherever the number is not the number you will be billed.
describe('Money display conversion', () => {
  it('converts an amount denominated in sourceCurrency into the display currency', () => {
    render(<Money amount={25.5} sourceCurrency="AUD" />)
    expect(screen.getByText('AUD>USD 25.50')).toBeInTheDocument()
  })

  it('formats through the base-currency path when sourceCurrency is omitted', () => {
    render(<Money amount={25.5} />)
    expect(screen.getByText('BASE>USD 25.50')).toBeInTheDocument()
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run components/shop/__tests__/Money.test.tsx`
Expected: FAIL. `Money` has no `amount`/`sourceCurrency` props and the authored-currency branch bypasses `formatFrom`.

- [x] **Step 3: Rewrite `components/shop/Money.tsx`**

```tsx
'use client'

import { useCurrency } from '@/contexts/CurrencyContext'

interface Props {
  /** Amount denominated in `sourceCurrency`, or in the org's base currency when omitted. */
  amount: number
  /**
   * Denomination of `amount` (e.g. a country price list's currency). Converted
   * into the viewer's display currency; billing surfaces that must render the
   * authored figure verbatim do not use Money.
   */
  sourceCurrency?: string
  /** Class on the wrapping span. */
  className?: string
}

export function Money({ amount, sourceCurrency, className }: Props) {
  const { format, formatFrom } = useCurrency()
  return (
    <span className={className}>
      {sourceCurrency ? formatFrom(amount, sourceCurrency) : format(amount)}
    </span>
  )
}
```

- [x] **Step 4: Update the four `ProductCard.tsx` call sites**

Lines 99-108: replace each `nzd=` with `amount=` and each `currency=` with `sourceCurrency=`:

```tsx
              {product.stock_unit_price != null ? (
                <Money amount={product.stock_unit_price} sourceCurrency={product.price_currency} />
              ) : product.price_status === 'missing' ? (
                'On request'
              ) : product.price_high > product.price_low ? (
                <>
                  <Money amount={product.price_high} sourceCurrency={product.price_currency} /> –{' '}
                  <Money amount={product.price_low} sourceCurrency={product.price_currency} />
                </>
              ) : (
                <Money amount={product.price_low} sourceCurrency={product.price_currency} />
              )}
```

(The `–` between the range values is the existing en dash in the JSX text, kept as is; the no-em-dash rule concerns em dashes in prose and names, not this pre-existing numeric range separator.)

- [x] **Step 5: Update the `CatalogueGrid.test.tsx` mock and the `price.ts` comment**

In `components/shop/__tests__/CatalogueGrid.test.tsx`, the `useCurrency` mock (lines 8-14) gains `formatFrom` so `Money`'s new destructure finds it:

```ts
vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({
    format: (n: number) => `$${n.toFixed(2)}`,
    formatFrom: (n: number) => `$${n.toFixed(2)}`,
    loading: false,
    currency: 'NZD',
  }),
}))
```

In `lib/format/price.ts` line 4, change `<Money nzd={…} />` to `<Money amount={…} />`.

- [x] **Step 6: Run the shop tests and the typecheck**

Run: `npx vitest run components/shop` then `npx tsc --noEmit`
Expected: PASS and clean. The typecheck is the rename's safety net: any missed `nzd=` call site is a compile error.

- [x] **Step 7: Commit**

```bash
git add components/shop/Money.tsx components/shop/ProductCard.tsx components/shop/__tests__/Money.test.tsx components/shop/__tests__/CatalogueGrid.test.tsx lib/format/price.ts
git commit -m "feat(catalogue): Money converts sourceCurrency to display instead of relabelling

Replaces be9e931's authored-currency bypass on the shopping surface; the
verbatim-authored rule now lives on the billing surfaces (D8).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: CountryBilledOrderSummary learns the display/billing split

**Files:**
- Modify: `components/checkout/BilledOrderSummary.tsx:27-129, 179`
- Test: `components/checkout/BilledOrderSummary.test.tsx` (extend)

**Interfaces:**
- Produces: three new optional props on `CountryBilledOrderSummary`, consumed by Task 7's `/checkout` wiring:

```ts
formatMoney?: (amount: number, billingCurrency: string) => string
showCurrencyInHeading?: boolean   // default true
totalInfo?: ReactNode             // rendered beside each "Country total" label
```

The default `formatMoney` is the current exact formatter (`formatCurrency(amount, currency) + ' ' + currency`). Defaulting to exact is the deliberate polarity: the safe default renders authored figures verbatim (billing surfaces), and `/checkout` opts into display conversion. `/checkout/review` therefore needs no edits at all, and the existing tests in this file stay green.

- [x] **Step 1: Write the failing tests**

Append to `components/checkout/BilledOrderSummary.test.tsx` (inside the file, after the existing `CountryBilledOrderSummary` describe; it reuses the existing `previewGroup` and `renderLine` helpers):

```tsx
describe('CountryBilledOrderSummary display formatting for /checkout', () => {
  const nzShape = () =>
    checkoutBillingShape([
      previewGroup({ key: 'NZ:stock_on_hand', countryCode: 'NZ', orderType: 'stock_on_hand' }),
    ])

  it('renders exact authored figures with the currency code by default', () => {
    render(<CountryBilledOrderSummary shape={nzShape()} renderLine={renderLine} />)
    expect(screen.getAllByText('$115.00 NZD').length).toBeGreaterThan(0)
    expect(screen.getByText('$100.00 NZD')).toBeInTheDocument()
  })

  it('routes every money figure through formatMoney when provided', () => {
    render(
      <CountryBilledOrderSummary
        shape={nzShape()}
        renderLine={renderLine}
        formatMoney={(amount, currency) => `DISPLAY(${amount}:${currency})`}
      />,
    )
    expect(screen.getAllByText('DISPLAY(115:NZD)').length).toBeGreaterThan(0)
    expect(screen.getByText('DISPLAY(100:NZD)')).toBeInTheDocument()
    expect(screen.queryByText('$115.00 NZD')).not.toBeInTheDocument()
  })

  it('drops the currency chip from the heading when showCurrencyInHeading is false', () => {
    render(
      <CountryBilledOrderSummary
        shape={nzShape()}
        renderLine={renderLine}
        showCurrencyInHeading={false}
      />,
    )
    expect(screen.getByText('New Zealand')).toBeInTheDocument()
    expect(screen.queryByText('New Zealand · NZD')).not.toBeInTheDocument()
  })

  it('renders totalInfo beside the country total', () => {
    render(
      <CountryBilledOrderSummary
        shape={nzShape()}
        renderLine={renderLine}
        totalInfo={<span data-testid="invoice-info" />}
      />,
    )
    expect(screen.getByTestId('invoice-info')).toBeInTheDocument()
    expect(screen.getByText('Country total')).toBeInTheDocument()
  })
})
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run components/checkout/BilledOrderSummary.test.tsx`
Expected: the three new-prop tests FAIL (unknown props / unchanged output); the default-formatter test PASSES already (it pins current behaviour before the change). All pre-existing tests PASS.

- [x] **Step 3: Implement the props**

In `components/checkout/BilledOrderSummary.tsx`:

1. Extend the `CountryBilledOrderSummary` signature (lines 27-37):

```tsx
export function CountryBilledOrderSummary({
  shape,
  failures = [],
  partitionOutcomes = {},
  renderLine,
  formatMoney,
  showCurrencyInHeading = true,
  totalInfo,
}: {
  shape: CheckoutBillingShape
  failures?: CheckoutCountryFailure[]
  partitionOutcomes?: Record<string, StoredPartitionOutcome>
  renderLine: (line: BilledLine, currency: string, countryName: string) => ReactNode
  /**
   * Formats one amount denominated in a group's billing currency. The default
   * renders the authored figure verbatim ("$123.45 NZD"): the truthful choice
   * for billing surfaces. /checkout passes a display-currency converter.
   */
  formatMoney?: (amount: number, billingCurrency: string) => string
  /** /checkout drops the currency chip: it would contradict converted figures below it. */
  showCurrencyInHeading?: boolean
  /** Rendered beside each "Country total" label; /checkout mounts InvoiceCurrencyInfo here. */
  totalInfo?: ReactNode
}) {
```

2. Replace the `exact` helper (lines 61-62) with:

```tsx
  const money =
    formatMoney ??
    ((amount: number, currency: string) => `${formatCurrency(amount, currency)} ${currency}`)
```

and replace all five `exact(` call sites (`partition.total`, `group.subtotal`, `group.pickingFee`, `group.tax`, `group.total`) with `money(`.

3. The heading (lines 68-70):

```tsx
          <h2 className="text-lg font-medium text-black">
            {showCurrencyInHeading ? `${countryName} · ${currency}` : countryName}
          </h2>
```

4. The country total row (line 122):

```tsx
              <CountryRow
                label={
                  totalInfo ? (
                    <span className="flex items-center gap-1.5">Country total {totalInfo}</span>
                  ) : (
                    'Country total'
                  )
                }
                value={money(group.total, currency)}
                bold
              />
```

5. `CountryRow`'s `label` prop type (line 163) changes from `string` to `ReactNode`.

6. The flag-off `BilledOrderSummaryProps.format` (line 179) renames its parameter: `format: (amount: number) => string`.

- [x] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run components/checkout/BilledOrderSummary.test.tsx`
Expected: PASS, including every pre-existing test (the default path is unchanged behaviour).

- [x] **Step 5: Commit**

```bash
git add components/checkout/BilledOrderSummary.tsx components/checkout/BilledOrderSummary.test.tsx
git commit -m "feat(checkout): let CountryBilledOrderSummary opt into display formatting

Default stays exact authored figures (billing surfaces); /checkout will pass
a display converter, drop the heading currency chip, and mount the invoice
currency tooltip beside the country total.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: InvoiceCurrencyInfo tooltip

**Files:**
- Create: `components/checkout/InvoiceCurrencyInfo.tsx`
- Test: `components/checkout/InvoiceCurrencyInfo.test.tsx` (colocated, matching this directory's convention)

**Interfaces:**
- Produces: `InvoiceCurrencyInfo({ billingCurrencies, displayCurrency, direction? })`. Renders `null` when the distinct billing set is exactly `[displayCurrency]` (spec D5). Task 7 mounts it via `CountryBilledOrderSummary`'s `totalInfo` prop.
- Modelled on `components/pricing/PickingFeeInfo.tsx`: same trigger button, hover/focus handlers, Escape-to-close, `role="dialog"`, same popover classes.

- [x] **Step 1: Write the failing tests**

Create `components/checkout/InvoiceCurrencyInfo.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { InvoiceCurrencyInfo } from './InvoiceCurrencyInfo'

function openTooltip() {
  fireEvent.focus(screen.getByRole('button', { name: 'Invoicing currency' }))
}

describe('InvoiceCurrencyInfo', () => {
  it('names the single invoicing currency and flags converted totals as estimates', () => {
    render(<InvoiceCurrencyInfo billingCurrencies={['NZD']} displayCurrency="USD" />)
    openTooltip()
    expect(
      screen.getByText(
        "You will be invoiced in NZD. Converted totals are an estimate at today's rate.",
      ),
    ).toBeInTheDocument()
  })

  it('lists every destination currency for a multi-country order', () => {
    render(<InvoiceCurrencyInfo billingCurrencies={['NZD', 'AUD']} displayCurrency="USD" />)
    openTooltip()
    expect(
      screen.getByText(
        "This order is invoiced per destination country: NZD and AUD. Converted totals are an estimate at today's rate.",
      ),
    ).toBeInTheDocument()
  })

  it('renders nothing when the billing set is exactly the display currency', () => {
    const { container } = render(
      <InvoiceCurrencyInfo billingCurrencies={['NZD', 'NZD']} displayCurrency="NZD" />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('still renders for a multi-currency set that includes the display currency', () => {
    render(<InvoiceCurrencyInfo billingCurrencies={['NZD', 'AUD']} displayCurrency="NZD" />)
    expect(screen.getByRole('button', { name: 'Invoicing currency' })).toBeInTheDocument()
  })

  it('closes on Escape', () => {
    render(<InvoiceCurrencyInfo billingCurrencies={['NZD']} displayCurrency="USD" />)
    openTooltip()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run components/checkout/InvoiceCurrencyInfo.test.tsx`
Expected: FAIL, module not found.

- [x] **Step 3: Implement the component**

Create `components/checkout/InvoiceCurrencyInfo.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'

interface InvoiceCurrencyInfoProps {
  /** Billing currencies across the order's country groups; deduplicated here. */
  billingCurrencies: string[]
  displayCurrency: string
  /** 'up' when the mount sits at the bottom of an overflow-hidden panel. */
  direction?: 'up' | 'down'
}

function listJoin(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/**
 * The /checkout counterpart of PickingFeeInfo: while the page shows totals in
 * the viewer's display currency, this names the currency (or per-country set)
 * the invoice will actually be raised in. Billing currency is per destination
 * country, so a mixed-destination cart lists a set.
 *
 * Renders nothing when the invoice currency IS the display currency: warning
 * someone that NZD will be invoiced as NZD is noise (spec D5).
 */
export function InvoiceCurrencyInfo({
  billingCurrencies,
  displayCurrency,
  direction = 'down',
}: InvoiceCurrencyInfoProps) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  const distinct = Array.from(new Set(billingCurrencies))
  if (distinct.length === 0 || (distinct.length === 1 && distinct[0] === displayCurrency)) {
    return null
  }

  const copy =
    distinct.length === 1
      ? `You will be invoiced in ${distinct[0]}. Converted totals are an estimate at today's rate.`
      : `This order is invoiced per destination country: ${listJoin(distinct)}. Converted totals are an estimate at today's rate.`

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label="Invoicing currency"
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="flex h-4 w-4 items-center justify-center rounded-full border border-gray-300 text-[10px] font-medium leading-none text-gray-500 transition-colors hover:border-gray-400 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-300"
      >
        i
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Invoicing currency"
          className={`absolute left-0 z-30 w-60 rounded-xl border border-gray-200 bg-white p-3 text-left shadow-lg ${
            direction === 'up' ? 'bottom-full mb-2' : 'top-full mt-2'
          }`}
        >
          <p className="text-xs leading-snug text-gray-600">{copy}</p>
        </div>
      )}
    </span>
  )
}
```

Note the hook ordering: `useState` and `useEffect` run before the early `return null`, keeping the rules of hooks satisfied on every render path.

- [x] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run components/checkout/InvoiceCurrencyInfo.test.tsx`
Expected: PASS (5 tests).

- [x] **Step 5: Commit**

```bash
git add components/checkout/InvoiceCurrencyInfo.tsx components/checkout/InvoiceCurrencyInfo.test.tsx
git commit -m "feat(checkout): add the invoicing-currency tooltip

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Wire /checkout into display currency

**Files:**
- Create: `lib/checkout/display-totals.ts`
- Test: `lib/checkout/display-totals.test.ts` (colocated, matching `billed-figures.test.ts`)
- Modify: `components/checkout/CheckoutClient.tsx:93-94, 311-316, 419-423, 622-630` (plus imports)
- NOT modified: `components/checkout/CheckoutReviewClient.tsx` (the review page's billing-currency rendering is already correct; leaving it untouched IS the requirement)

**Interfaces:**
- Consumes: `formatFrom`, `currency`, `rates` from the context (Task 3); `CountryBilledOrderSummary`'s new props (Task 5); `InvoiceCurrencyInfo` (Task 6); `convertBetween` (Task 1).
- Produces: `displayCurrencyTotals(totals: CurrencyTotal[], displayCurrency: SupportedCurrency, rates: ExchangeRates | null): CurrencyTotal[]`, used only by `/checkout`'s sticky bar. `CheckoutCTAStickyBar` itself is untouched: it already renders whatever denominations it is handed (the flag-off branch feeds it converted display totals today), so the split lives in what each page passes it.

- [x] **Step 1: Write the failing test for the totals helper**

Create `lib/checkout/display-totals.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { displayCurrencyTotals } from './display-totals'
import type { ExchangeRates } from '@/lib/currency/types'

const rates: ExchangeRates = { NZD: 1, AUD: 0.8, USD: 0.6, GBP: 0.44, EUR: 0.51 }

describe('displayCurrencyTotals', () => {
  it('collapses per-billing-currency totals into one summed display figure', () => {
    const result = displayCurrencyTotals(
      [
        { currency: 'NZD', total: 100 },
        { currency: 'AUD', total: 80 },
      ],
      'USD',
      rates,
    )
    // 100 NZD -> 60 USD, 80 AUD -> 60 USD.
    expect(result).toEqual([{ currency: 'USD', total: 120 }])
  })

  it('passes a single total already in the display currency through unchanged', () => {
    expect(displayCurrencyTotals([{ currency: 'NZD', total: 115 }], 'NZD', rates)).toEqual([
      { currency: 'NZD', total: 115 },
    ])
  })

  it('returns the exact billing totals when rates are absent', () => {
    const totals = [{ currency: 'AUD', total: 80 }]
    expect(displayCurrencyTotals(totals, 'USD', null)).toBe(totals)
  })

  it('returns the exact billing totals when any currency cannot be cross-rated', () => {
    const totals = [
      { currency: 'NZD', total: 100 },
      { currency: 'JPY', total: 5000 },
    ]
    expect(displayCurrencyTotals(totals, 'USD', rates)).toBe(totals)
  })

  it('leaves an empty list empty rather than inventing a zero total', () => {
    expect(displayCurrencyTotals([], 'USD', rates)).toEqual([])
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/checkout/display-totals.test.ts`
Expected: FAIL, module not found.

- [x] **Step 3: Implement the helper**

Create `lib/checkout/display-totals.ts`:

```ts
import { convertBetween } from '@/lib/currency/format'
import { isSupportedCurrency } from '@/lib/currency/detect'
import type { ExchangeRates, SupportedCurrency } from '@/lib/currency/types'
import type { CurrencyTotal } from '@/lib/pricing/order-billing-shape'

/**
 * Collapse per-billing-currency totals into one display-currency estimate for
 * the /checkout sticky bar. Billing surfaces never call this: /checkout/review
 * passes its exact totals straight through.
 *
 * Fail-safe: when rates are absent or any currency cannot be cross-rated, the
 * exact billing totals are returned unchanged rather than mislabelled.
 */
export function displayCurrencyTotals(
  totals: CurrencyTotal[],
  displayCurrency: SupportedCurrency,
  rates: ExchangeRates | null,
): CurrencyTotal[] {
  if (totals.length === 0 || !rates) return totals
  let sum = 0
  for (const { currency, total } of totals) {
    if (!isSupportedCurrency(currency)) return totals
    sum += convertBetween(total, currency, displayCurrency, rates)
  }
  return [{ currency: displayCurrency, total: sum }]
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/checkout/display-totals.test.ts`
Expected: PASS (5 tests).

- [x] **Step 5: Wire `CheckoutClient.tsx`**

Five edits:

1. Add imports:

```ts
import { InvoiceCurrencyInfo } from './InvoiceCurrencyInfo'
import { displayCurrencyTotals } from '@/lib/checkout/display-totals'
```

2. Widen the context destructure (lines 93-94):

```ts
  const currencyContext = useCurrency()
  const { format, formatFrom, currency: displayCurrency, rates } = currencyContext
```

3. `renderShipLine`'s formatter (lines 314-316): flag-on lines convert billing into display instead of exact-formatting:

```ts
    const lineFormat = currency
      ? (amount: number) => formatFrom(amount, currency)
      : format
```

4. The `CountryBilledOrderSummary` mount (lines 419-423) opts into display formatting and mounts the tooltip:

```tsx
            <CountryBilledOrderSummary
              shape={countryShape}
              failures={previewFailures}
              renderLine={renderShipLine}
              formatMoney={(amount, currency) => formatFrom(amount, currency)}
              showCurrencyInHeading={false}
              totalInfo={
                <InvoiceCurrencyInfo
                  billingCurrencies={countryShape.countryGroups.map((group) => group.currency)}
                  displayCurrency={displayCurrency}
                />
              }
            />
```

(`InvoiceCurrencyInfo` deduplicates the list itself, and returns null for the all-NZD-viewed-in-NZD common case, so this mounts unconditionally.)

5. The sticky bar's flag-on totals (lines 622-626) convert to display; the flag-off branch is untouched:

```tsx
        totalsByCurrency={
          countryPartitionEnabled
            ? preview.status === 'ready'
              ? displayCurrencyTotals(preview.totalsByCurrency, displayCurrency, rates)
              : []
            : [{
                currency: currencyContext.currency ?? defaultBillingCountry.currency,
                total: currencyContext.convert?.(shape.grandTotal) ?? shape.grandTotal,
              }]
        }
```

- [x] **Step 6: Verify the review page is untouched and the invoice path is display-free**

Run:

```bash
git diff --stat components/checkout/CheckoutReviewClient.tsx
grep -n "formatFrom\|displayCurrencyTotals\|convert(" lib/checkout/submit.ts
```

Expected: empty diff for the review client; no hits in `submit.ts` (display FX still cannot reach an invoice; the server derives billing currency from `billingCountry.currency`).

- [x] **Step 7: Run the checkout tests and the typecheck**

Run: `npx vitest run components/checkout lib/checkout/display-totals.test.ts` then `npx tsc --noEmit`
Expected: PASS and clean.

- [x] **Step 8: Commit**

```bash
git add lib/checkout/display-totals.ts lib/checkout/display-totals.test.ts components/checkout/CheckoutClient.tsx
git commit -m "feat(checkout): render /checkout in display currency with an invoicing tooltip

Line prices, country totals, and the sticky bar convert billing into the
viewer's display currency; /checkout/review keeps exact invoice figures.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Hide the picker on /checkout/review, and test the picker

**Files:**
- Modify: `components/layout/CurrencyPicker.tsx`
- Test: `components/layout/__tests__/CurrencyPicker.test.tsx` (create)

**Interfaces:**
- Consumes: `usePathname` from `next/navigation`; `currency`/`setCurrency` from the context.
- Produces: nothing new; `CurrencyPicker` returns `null` when `pathname === '/checkout/review'`. The check lives inside `CurrencyPicker` rather than `PortalTopBar` so the visibility rule sits where someone debugging the picker will look for it (spec D4).

- [x] **Step 1: Write the failing tests**

Create `components/layout/__tests__/CurrencyPicker.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CurrencyPicker } from '../CurrencyPicker'

const setCurrency = vi.fn()
let pathname = '/catalogue'

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
}))

vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({
    currency: 'AUD',
    setCurrency,
  }),
}))

beforeEach(() => {
  setCurrency.mockClear()
  pathname = '/catalogue'
})

describe('CurrencyPicker', () => {
  it('opens the menu on click', () => {
    render(<CurrencyPicker />)
    fireEvent.click(screen.getByRole('button', { name: 'Currency' }))
    expect(screen.getByRole('menu')).toHaveAttribute('aria-hidden', 'false')
  })

  it('calls setCurrency with the selection and closes the menu', () => {
    render(<CurrencyPicker />)
    fireEvent.click(screen.getByRole('button', { name: 'Currency' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'US$ USD' }))
    expect(setCurrency).toHaveBeenCalledWith('USD')
    expect(screen.getByRole('menu', { hidden: true })).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders nothing on /checkout/review', () => {
    pathname = '/checkout/review'
    const { container } = render(<CurrencyPicker />)
    expect(container.firstChild).toBeNull()
  })
})
```

(`getByRole('menu', { hidden: true })` is needed for the closed state: testing-library excludes `aria-hidden` elements from role queries by default.)

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run components/layout/__tests__/CurrencyPicker.test.tsx`
Expected: the first two PASS (they pin behaviour that already works and would have caught Defect 1's silent no-op at the context layer); "renders nothing on /checkout/review" FAILS.

- [x] **Step 3: Implement the hide**

In `components/layout/CurrencyPicker.tsx`, add the import:

```tsx
import { usePathname } from 'next/navigation'
```

then inside the component add the hook alongside the existing ones (before the `useEffect`), and the early return after all hooks, immediately before the main `return`:

```tsx
  const pathname = usePathname()
```

```tsx
  // /checkout/review renders billing currency only; a visible picker there is
  // a false affordance, since nothing on the page responds to it (spec D4).
  if (pathname === '/checkout/review') return null
```

The early return must come after every hook call so the hook order is stable across renders.

- [x] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run components/layout/__tests__/CurrencyPicker.test.tsx`
Expected: PASS (3 tests).

- [x] **Step 5: Commit**

```bash
git add components/layout/CurrencyPicker.tsx components/layout/__tests__/CurrencyPicker.test.tsx
git commit -m "feat(currency): hide the picker on /checkout/review and cover the picker with tests

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Rename leftovers (D6 sweep)

**Files:**
- Modify: `components/pricing/PickingFeeInfo.tsx:9`
- Modify: `components/pricing/PriceBreakdown.tsx:17`
- Modify: `components/checkout/PrepaidLinePrice.tsx:27`

**Interfaces:** none change; these are parameter names inside function-type annotations (`format: (nzdAmount: number) => string` becomes `format: (amount: number) => string`). Post Task 3 these callbacks receive base-currency amounts (AUD for WHITEFOX), so the `nzd` name lies about its unit. Every other rename site from the spec's section 7 inventory was handled by earlier tasks (format.ts/index.ts/context in Tasks 1 and 3, Money/ProductCard/price.ts in Task 4, BilledOrderSummary in Task 5).

- [x] **Step 1: Rename the three annotation parameters**

In each file, change the one line:

`components/pricing/PickingFeeInfo.tsx:9`
```ts
  format: (amount: number) => string
```

`components/pricing/PriceBreakdown.tsx:17` (also reword the prop's doc comment just above it: "falls back to NZD-only formatPrice" stays true; change "Pass `useCurrency().format`" comment's mention of nothing else; only the parameter name changes):
```ts
  format?: (amount: number) => string
```

`components/checkout/PrepaidLinePrice.tsx:27`
```ts
  format: (amount: number) => string
```

- [x] **Step 2: Sweep for stragglers**

Run:

```bash
grep -rn "nzdAmount\|nzd={\|convertNZD" --include='*.ts' --include='*.tsx' components app lib contexts
```

Expected: no output.

- [x] **Step 3: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npm test`
Expected: clean and PASS (type-level parameter names cannot break call sites, so this is a pure confirmation).

- [x] **Step 4: Commit**

```bash
git add components/pricing/PickingFeeInfo.tsx components/pricing/PriceBreakdown.tsx components/checkout/PrepaidLinePrice.tsx
git commit -m "refactor(currency): finish renaming nzdAmount to amount in formatter types

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Full verification

**Files:** none modified (fixes discovered here fold back into the task that owns the file).

- [ ] **Step 1: Full test suite, typecheck, lint, build**

Run, in order:

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
```

Expected: all pass. `npm run lint` tolerates up to 200 warnings by configuration; it must introduce no new errors.

- [ ] **Step 2: Em dash sweep over the diff**

Run:

```bash
git diff main -- '*.ts' '*.tsx' | grep -n "—"
```

Expected: no output from added lines (the spec and plan markdown files are excluded by the pathspec; pre-existing em dashes in unchanged code lines are out of scope).

- [ ] **Step 3: Manual QA checklist (dev server)**

`CHECKOUT_COUNTRY_PARTITION_ENABLED` is `false` in `.env.local` but `true` in production, so both flag states need a pass. With `npm run dev`:

Flag as-is (off):
1. `/catalogue`: pick USD in the top-bar picker; grid prices convert (this was Defect 2: previously the grid never moved).
2. PDP and cart drawer follow the same pick (already worked; regression check).

Then set `CHECKOUT_COUNTRY_PARTITION_ENABLED=true` in `.env.local`, restart, and:
3. `/catalogue` with a NZ org, display USD: grid converts.
4. `/checkout`: totals and line prices render in the display currency; country heading has no currency chip; the `i` beside "Country total" shows "You will be invoiced in NZD..." (only when display is not NZD).
5. `/checkout/review`: figures render as `$X.XX NZD` exact; the top-bar picker is gone on this page and present everywhere else.
6. If a WHITEFOX (AU) login is available: the picker changes currency (Defect 1 fixed), and with no cookie the first paint lands on AUD.
7. Place no orders; confirm `/orders` and any past order confirmation still render their stored currency (D7 untouched).

Restore `.env.local` to its original flag value afterwards.

- [ ] **Step 4: Re-assert the invoice-safety claim on the final diff**

Run:

```bash
git diff main --stat -- lib/checkout/submit.ts components/checkout/CheckoutReviewClient.tsx
```

Expected: empty. The server-side billing derivation and the review page are byte-identical to `main`.

---

## Self-Review (completed)

- **Spec coverage:** D1/D2 (Tasks 1-3), D3 (Tasks 5-7), D4 (Task 8), D5 (Task 6), D6 (Tasks 1, 3, 4, 5, 9), D7 (untouched, asserted in Tasks 7 and 10), D8 (Tasks 4, 5, 7). Testing table: `format.test.ts` (Task 1), `detect.test.ts` extension (Task 2), `CurrencyContext.test.tsx` (Task 3), `Money.test.tsx` rewrite (Task 4), `InvoiceCurrencyInfo.test.tsx` (Task 6), `CurrencyPicker.test.tsx` (Task 8). Beyond the spec's table: `BilledOrderSummary.test.tsx` additions (Task 5) and `display-totals.test.ts` (Task 7) cover the new props and the sticky-bar summing the spec left implementation-defined.
- **Deviations from the spec, deliberate:** (a) `formatMoney` is optional with the exact formatter as default, so the safe default is the billing-faithful one and `/checkout/review` needs no edit; (b) the sticky-bar split is implemented in what each page passes `CheckoutCTAStickyBar` rather than inside it, matching how the flag-off branch already feeds it converted totals; (c) `InvoiceCurrencyInfo.test.tsx` is colocated (this directory's convention) rather than in `__tests__/`; (d) multi-currency display totals are summed into one figure, since two amounts in the same display currency side by side would read as a broken duplicate.
- **Type consistency:** `formatFrom(amount: number, sourceCurrency: string)` is defined in Task 3 and consumed with that signature in Tasks 4 and 7. `formatMoney(amount: number, billingCurrency: string)` is defined in Task 5 and passed as `(amount, currency) => formatFrom(amount, currency)` in Task 7. `displayCurrencyTotals(totals, displayCurrency, rates)` is defined and consumed in Task 7. `baseCurrency: SupportedCurrency` flows from `EnabledCountry.currency` (already `SupportedCurrency`).
- **Placeholder scan:** none found; every code step carries the code.

## Execution deviations

- Before Task 1, the baseline full suite reported 1,721 passing and 5 failing tests. The failures are in `OrdersTable.test.tsx`, `TeamClient.branch.test.tsx`, and `CartProvider.test.tsx`, outside this plan's change surfaces. `OrdersTable.tsx` is also protected by D7 and remains untouched.
- Task 1's supplied test contains 8 cases, although Step 4 says to expect 9. The exact supplied test was kept and all 8 cases pass.
- Task 2's required typecheck reported 14 pre-existing errors in `lib/__tests__/next-config-redirects.test.ts` and `lib/email/__tests__/tracker-notification.test.ts`. No error points to a Task 2 file; the 19 targeted detection tests pass.
- Task 3's supplied context test assumes jsdom owns a usable global `localStorage`. Under the installed Node 26.4.0, that global is unavailable unless Node receives a storage-file flag, which also explains the baseline `CartProvider.test.tsx` failure. The context test now installs a file-local in-memory `Storage` stub before each case so it reaches the planned assertions.
- Task 3's leftover grep would match Task 1's supplied test name containing the removed symbol. The test name now says "previous conversion path" so the exact removal sweep returns no output.
- Task 3's full suite exposed `app/(portal)/layout.test.ts` as an unlisted coupled test that asserted the removed AU pin. It now asserts the org base fallback and verifies that no `billingCurrency` prop remains.
- After the Task 3 coupled-test update, the full suite reported 1,741 passing and the same 5 baseline failures. The required typecheck still reports only the 14 baseline errors documented under Task 2.
- Task 4's 107 shopping tests pass. Its required typecheck repeats only the 14 baseline errors documented under Task 2.
- Task 7's checkout suite exposed `CheckoutClient.review-redirect.test.tsx` as an unlisted coupled test whose currency-context mock lacked `formatFrom`, display currency, and rates, and whose assertions expected the old billing-currency checkout presentation. The mock and assertions now cover the converted country total, collapsed sticky total, currency-free heading, and tooltip trigger.
- After that Task 7 coupled-test update, all 91 checkout tests pass. Its required typecheck repeats only the 14 baseline errors documented under Task 2.
- Task 9's chained `npx tsc --noEmit && npm test` stopped at the same 14 baseline type errors, so `npm test` was run separately. It reported 1,759 passing and the same 5 baseline failures across 1,764 tests; the rename grep is empty.
