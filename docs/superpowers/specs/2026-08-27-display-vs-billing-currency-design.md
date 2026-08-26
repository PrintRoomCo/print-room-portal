# Display currency vs billing currency — free picker while shopping, true invoice figures at review

**Date:** 2026-08-27
**Status:** Design approved, awaiting implementation plan
**Origin:** Jon, 2026-08-27: *"so the currency picker on the portal dosent work anymore?"* — followed by: *"Can you have the currency picker work for the catalogue/ shopping throughout the portal but only on the review page show the actual currency thats being invoiced, and on the checkout page have a tool tip like the picking fee but just an alert to show 'you will be invoiced in NZD/ currency they are ordering from'."*

## Problem

The currency picker renders a menu of five currencies, opens correctly, and then silently ignores the click. Two independent defects cause this, and with `CHECKOUT_COUNTRY_PARTITION_ENABLED=true` in production **both are live**.

### Defect 1 — the AU billing pin makes `setCurrency` a no-op

`contexts/CurrencyContext.tsx:120-121`:

```ts
const setCurrency = useCallback((c: SupportedCurrency) => {
  if (pinned) return;
```

`pinned` is set from `app/(portal)/layout.tsx:51-55` whenever the signed-in org's default billing country is not NZD. Per `organization_countries`, exactly one org qualifies:

| Org | Country | Currency | Picker |
| --- | --- | --- | --- |
| WHITEFOX Real Estate | AU | AUD | **inert** |
| Anytime Fitness, Dept of Conservation, Hydro Surf, MTF, Otago Polytech, Print Room Demo, Re burger, Test Account, Trades Services | NZ | NZD | works |

Introduced by `eb9747f feat(au-stage-1): AUD billing-currency pin on the display FX layer` (2026-08-17) — hence "anymore". The pin's *reasoning* is sound: for an AU org the stored numbers already **are** AUD, so feeding them through an NZD-base FX layer would corrupt them. The defect is that `CurrencyPicker` never reads `billingLocked`, so it offers choices it will discard.

### Defect 2 — the catalogue grid bypasses FX for every org

**This one is a collision with a deliberate decision, not a plain mistake.** `be9e931 feat(pricing): use the default-country list in cart` (2026-08-24, Jamie) introduced the bypass on purpose, documented it, and pinned it with a test:

```tsx
/** Authored canonical currency. When present, visitor FX conversion is bypassed. */
currency?: string
```

> *"formats an authored AUD amount directly instead of applying visitor conversion"* — `components/shop/__tests__/Money.test.tsx:15`

The reasoning is sound and is preserved by this spec (see D8): a price drawn from a **country price list** is a real commercial price, not an FX derivation, and rendering A$29.00 as a converted NZ$34.78 would misrepresent it.

The mechanism is `components/shop/Money.tsx:17-19`:

```tsx
if (currency) {
  return <span className={className}>{formatCurrency(nzd, currency)}</span>
}
```

`formatCurrency` **relabels without converting**, and `app/(portal)/catalogue/page.tsx:753` stamps every tile with `price_currency: defaultCountry?.currency`. With the partition flag on, `defaultCountry` is populated for every org, so every catalogue card price is hard-formatted in the org's billing currency and ignores the picker. This hits NZ orgs too — the symptom is "prices change on the product page and in the cart, but the grid never moves".

What makes it a defect is the wiring, not the idea. Because `price_currency` is always `defaultCountry.currency`, `sourceCurrency === baseCurrency` at **every current call site**. The "authored foreign price" case the bypass was written to protect is never actually exercised; its only live effect is to pin the grid to base.

### Why the tests did not catch this

The two defects failed differently, and the difference matters for the Testing section below.

**Defect 1 had no test at all.** There is nothing covering `CurrencyPicker` or `CurrencyContext` — `components/layout/__tests__/` holds `AccountMenu`, `PortalShell` and `Sidebar` only. A silent no-op in a click handler is precisely what a render-and-click test catches, and none existed.

**Defect 2 had a passing test that asserted it.** `Money.test.tsx` was green throughout, because the bypass was the intended behaviour when it was written. No test was wrong; the requirement changed underneath it. That is the ordinary cost of a deliberate decision meeting a later one, and the fix is to move the assertion (§4), not to treat the old test as a failure.

## Vocabulary

Three distinct currencies are presently collapsed into one concept. Naming them is most of the fix.

| Term | Meaning | Source of truth |
| --- | --- | --- |
| **base** | what the stored numbers are denominated in | org's default billing country → `countries.currency` |
| **display** | what the viewer picked | picker → cookie + `localStorage` (`prs-currency`) |
| **billing** | what the invoice is actually raised in | **per destination country** at checkout |

**Billing currency is per country group, not per order.** `CountryBilledOrderSummary` (`components/checkout/BilledOrderSummary.tsx:37-47`) maps `shape.countryGroups`, each carrying its own `currency`. A NZ org shipping part of a cart to Australia receives **two invoices in two currencies**. Any copy that says "you will be invoiced in NZD" must therefore handle a set.

## Decisions

| # | Decision | Rationale |
| --- | --- | --- |
| D1 | **Remove the pin. Full FX for every org, including AU.** Cross-rate through the existing NZD-base table. | The widest reading of "work throughout the portal". No new FX data needed — see D2. |
| D2 | **Cross-rate rather than add an AUD-base rate table.** `amount × rates[to] / rates[from]`. | `exchange_rates` holds NZD→{NZD,AUD,USD,GBP,EUR}, refreshed 2026-08-26. AUD→USD is `/0.833920 × 0.597219`. A second base row set would be redundant data that can drift out of sync with the first. |
| D3 | **`/checkout` shows display currency + tooltip; `/checkout/review` shows billing currency.** | Jon's explicit instruction. The tooltip earns its place: it explains a number that is about to change one page later. |
| D4 | **Hide the picker on `/checkout/review` only.** | Nothing on that page responds to it. Leaving it visible reproduces the exact false affordance that opened this ticket. |
| D5 | **The tooltip renders nothing when billing set == display currency.** | An NZ org browsing in NZD — most traffic — sees no change at all. Warning someone that NZD will be invoiced as NZD is noise. |
| D6 | **Rename `nzd`/`nzdAmount`/`convertNZD` to base-currency-neutral names.** | Post-D1 these parameters hold AUD for WHITEFOX. A parameter that lies about its unit is how the next money bug gets written. |
| D7 | **Confirmation and past-orders are left alone.** | They already read the immutable stored order currency (`ConfirmationView.tsx:118-122`, `OrdersTable.tsx:92-95`), which is correct: a historical invoice must not move with today's FX rate. |
| D8 | **Convert on shopping surfaces; never convert on billing surfaces.** Catalogue, PDP and cart convert freely. `/checkout/review`, confirmation and past-orders render authored figures verbatim. | Keeps `be9e931`'s intent and relocates it to the layer where it is actually load-bearing. One rule, stated once: **convert wherever the number is not the number you will be billed.** |

### D1 in detail — why the pin can be removed safely

The pin exists because display FX must never reach an invoice. Verified that it cannot:

- `lib/checkout/submit.ts:358` derives `billingCurrency` from `billingCountry.currency` server-side and uses it at every write (`:750`, `:926`, `:1355`, `:1424`, `:1446`). The client's display currency is not an input.
- `currencyContext.convert` appears exactly twice in checkout — `CheckoutReviewClient.tsx:976` and `CheckoutClient.tsx:629` — and both feed only `CheckoutCTAStickyBar`'s `totalsByCurrency`, which is presentational (`CheckoutCTAStickyBar.tsx:73-75`). Both are on the `countryPartitionEnabled === false` branch; with the flag on, the bar reads server-computed `preview.totalsByCurrency`.

So display currency is display-only today, and stays display-only after this change.

### D2 in detail — the zero-rate guard

`convertBetween` divides by `rates[from]`. If the rate table is missing a row, or holds `0`, the naive form emits `Infinity` or `NaN` — which would render as `$NaN` on a price. The guard returns the amount **unconverted** when `rates[from]` is absent or zero, matching the existing fail-safe posture of `fetchExchangeRates` (falls back to hardcoded rates rather than throwing).

## Design

### 1. FX core — `lib/currency/format.ts`

```ts
export function convertBetween(
  amount: number,
  from: SupportedCurrency,
  to: SupportedCurrency,
  rates: ExchangeRates,
): number
```

`amount × (rates[to] / rates[from])`, with the D2 guard. `from === to` returns `amount` untouched — no float drift on the common path.

`convertNZD` is **replaced by** `convertBetween`, not wrapped by it. Its only three callers all live inside `CurrencyContext` (`:7`, `:130`, `:139`), so there is no external surface needing a compatibility alias — see §7.

### 2. Context — `contexts/CurrencyContext.tsx`

| Before | After |
| --- | --- |
| `billingCurrency` prop (a lock) | `baseCurrency` prop (a denomination) |
| `pinned`, `billingLocked` | removed |
| `setCurrency` early-returns when pinned | always sets and persists |
| `convert` returns input when pinned | `convertBetween(amount, baseCurrency, currency, rates)` |
| `format` falls back to `formatCurrency(amount, 'NZD')` when rates absent | falls back to **`baseCurrency`** |

The rates-absent fallback matters: today an AU org rendering before rates resolve shows AUD magnitudes labelled `NZ$`.

Two additions to the context value:

- `baseCurrency` — so a consumer that needs the un-converted figure opts out deliberately rather than by accident.
- `formatFrom(amount, sourceCurrency)` — formats an amount denominated in an *arbitrary* currency into the display currency. `format(amount)` becomes `formatFrom(amount, baseCurrency)`. Needed by `Money` (§4) and by the `/checkout` formatter (§5), both of which hold amounts whose denomination is carried in the data rather than implied by the org.

All ten `useCurrency()` consumers — `CartTable`, `CartDrawer`, `ProductDetailClient`, `PeriodSavingsBar`, `Money`, both checkout clients, `CurrencySelector`, `CurrencyPicker` — become correct for AU orgs without being edited, because they already route through `format()`.

### 3. Layout — `app/(portal)/layout.tsx`

`initialCurrency` currently **forces** non-NZD orgs onto their billing currency, defeating the cookie. The new chain is: saved cookie → geo (`x-vercel-ip-country`) → **org base currency**.

That last step replaces a hardcoded NZD, and it cannot be expressed as a `??` at the call site. `resolveCurrency` (`lib/currency/detect.ts:45-46`) hard-defaults to NZD and never returns null, so `resolveInitialCurrency() ?? base` would never fire and an AU org with no cookie would land on NZD — the original bug in a new location. The fallback must be threaded in:

```ts
// lib/currency/detect.ts
currencyForCountry(country, fallback: SupportedCurrency = 'NZD')
resolveCurrency({ saved, country, fallback })

// lib/currency/server-currency.ts
resolveInitialCurrency(fallback: SupportedCurrency = 'NZD')
```

```tsx
<CurrencyProvider
  initialRates={initialRates}
  initialCurrency={await resolveInitialCurrency(defaultBillingCountry.currency)}
  baseCurrency={defaultBillingCountry.currency}
>
```

**Geo still outranks the org's base currency**, deliberately. For every NZ org `base === 'NZD'`, so this chain is byte-identical to today's behaviour and the geo feature from `6380fa0` is preserved intact — a US-based viewer of a NZ org still lands on USD. Only the terminal default moves. WHITEFOX with no cookie and no geo header now lands on AUD instead of NZD; WHITEFOX with a USD preference gets USD.

### 4. Catalogue — `components/shop/Money.tsx`

The `currency` prop's meaning is the bug. It becomes `sourceCurrency` — "this amount is denominated in X" — and converts to display rather than relabelling:

```tsx
export function Money({ amount, sourceCurrency, className }: Props) {
  const { format, formatFrom } = useCurrency()
  return <span className={className}>
    {sourceCurrency ? formatFrom(amount, sourceCurrency) : format(amount)}
  </span>
}
```

`ProductCard.tsx:99-108` keeps passing `product.price_currency` at all four sites; only the semantics change. The loading branch formats in the source currency instead of hardcoded NZD.

`components/shop/__tests__/Money.test.tsx` is **rewritten, not deleted**. Its current assertion ("formats an authored AUD amount directly instead of applying visitor conversion") encodes the pre-D8 rule. The replacement asserts the D8 boundary: `Money` converts `sourceCurrency` → display, and the verbatim-authored path now lives on the billing surfaces in §5. Deleting the test would discard the intent; rewriting it records where that intent moved.

### 5. Checkout vs review — `components/checkout/BilledOrderSummary.tsx`

`CountryBilledOrderSummary` hardcodes `exact()` (`:59-60`). It gains a formatter prop:

```ts
formatMoney: (amount: number, billingCurrency: string) => string
```

| Page | Formatter | Renders | Country heading |
| --- | --- | --- | --- |
| `/checkout/review` | exact — `formatCurrency(a, c) + ' ' + c` | `$123.45 NZD` | `New Zealand · NZD` |
| `/checkout` | display — cross-rate `billing → display` | `US$ 1,436.30` | `New Zealand` |

The heading drops its currency chip on `/checkout` because `· NZD` sitting above `US$` figures reads as a contradiction; the invoicing currency moves into the tooltip instead.

`CheckoutCTAStickyBar` needs the same split — it renders `totalsByCurrency` as `$X NZD` on both pages today (`:73-75`). On `/checkout` its totals convert to display; on `/checkout/review` they stay billing.

The review page's behaviour is **unchanged** by this spec. It already renders billing currency correctly with the flag on.

### 6. New — `components/checkout/InvoiceCurrencyInfo.tsx`

Modelled on `components/pricing/PickingFeeInfo.tsx`: 4×4 `i` button, `onMouseEnter`/`onMouseLeave` plus `onFocus`/`onBlur`, Escape-to-close effect, `role="dialog"`, popover styled `w-60 rounded-xl border border-gray-200 bg-white p-3 shadow-lg`.

```ts
interface InvoiceCurrencyInfoProps {
  billingCurrencies: string[]   // distinct, from shape.countryGroups
  displayCurrency: string
  direction?: 'up' | 'down'
}
```

Returns `null` when `billingCurrencies` is exactly `[displayCurrency]` (D5).

| Case | Copy |
| --- | --- |
| One | "You will be invoiced in NZD. Converted totals are an estimate at today's rate." |
| Several | "This order is invoiced per destination country: NZD and AUD. Converted totals are an estimate at today's rate." |

Mounted beside the order total on `/checkout`, matching `PickingFeeInfo`'s placement pattern (`BilledOrderSummary.tsx:316-320`).

### 7. Rename (D6) — inventory

Confirmed in scope. **24 occurrences across 11 files**, all mechanical and all type-checked:

| Old | New | Sites |
| --- | --- | --- |
| `convertNZD(nzdAmount, currency, rates)` | `convertBetween(amount, from, to, rates)` | `lib/currency/format.ts:19`, `lib/currency/index.ts:7`, `contexts/CurrencyContext.tsx:7,130,139` |
| `Money`'s `nzd` prop | `amount` | `components/shop/Money.tsx:8,15,18,21`, `ProductCard.tsx:99,104,105,108`, `Money.test.tsx:16` |
| `Money`'s `currency` prop | `sourceCurrency` | same call sites |
| `format: (nzdAmount: number)` | `format: (amount: number)` | `CurrencyContext.tsx:32,33,127,136`, `PrepaidLinePrice.tsx:27`, `BilledOrderSummary.tsx:179`, `PriceBreakdown.tsx:17`, `PickingFeeInfo.tsx:9` |
| doc comment `<Money nzd={…} />` | `<Money amount={…} />` | `lib/format/price.ts:4` |

**`convertNZD` is removed, not kept as an alias.** Leaving a deprecated wrapper is how the misleading name survives the rename — and its only three callers are all inside `CurrencyContext`, so there is no external surface to keep compatible. `lib/currency/index.ts:7` re-exports it; that export changes with it.

The `/** NZD amount stored in DB. */` comment on `Money.tsx:8` is factually wrong post-D1 and is replaced with a note that the amount is denominated in `sourceCurrency`, defaulting to the org's base currency.

### 8. Picker hidden on review — `components/layout/CurrencyPicker.tsx`

```tsx
const pathname = usePathname()
if (pathname === '/checkout/review') return null
```

Kept inside `CurrencyPicker` rather than in `PortalTopBar` so the visibility rule sits where someone debugging the picker will look for it.

## Testing

`lib/currency/__tests__/detect.test.ts` is the only existing currency test — nothing covers the context, the picker, or conversion. This spec adds three files, extends one and rewrites one:

| File | Covers |
| --- | --- |
| `lib/currency/__tests__/format.test.ts` | `convertBetween` — AUD→USD cross-rate against real table values, `from === to` identity, missing-rate and zero-rate guards return input unconverted |
| `contexts/__tests__/CurrencyContext.test.tsx` | AUD base converts to USD; **regression: `setCurrency` persists and updates for an AU org**; rates-absent fallback formats in base, not NZD |
| `components/layout/__tests__/CurrencyPicker.test.tsx` | opens on click, selection calls through and closes, returns null on `/checkout/review` |
| `components/checkout/__tests__/InvoiceCurrencyInfo.test.tsx` | single-currency copy, multi-currency copy, renders null when sets match |
| `components/shop/__tests__/Money.test.tsx` *(rewrite)* | `sourceCurrency` converts rather than relabels; replaces the pre-D8 bypass assertion from `be9e931` |
| `lib/currency/__tests__/detect.test.ts` *(extend)* | fallback chain — saved cookie wins over geo; geo wins over base; base used only when both absent; NZ org chain unchanged from today |

The `CurrencyContext` `setCurrency` test is the one that would have caught the original defect.

## Risks

| Risk | Mitigation |
| --- | --- |
| A converted figure reaches an invoice | Verified impossible — see D1 detail. Server re-prices from `billingCountry.currency`. Worth re-asserting in review of the diff. |
| Stale FX rate makes `/checkout` and `/checkout/review` totals appear to disagree | The tooltip says "estimate at today's rate". `getServerExchangeRate` already warns past a 36h staleness threshold. |
| Rename (D6) touches ~15 sites and risks a mechanical slip | Type-driven: renaming the prop makes every un-updated call site a compile error. |
| `price_currency` diverging from the org base currency | Today it is always `defaultCountry.currency`, so `sourceCurrency` equals base and conversion is a no-op for NZ orgs. The explicit prop keeps it correct if products are ever authored in a foreign currency. |

## Out of scope

- Confirmation page and past-orders currency handling (D7 — already correct).
- Hiding the picker anywhere other than `/checkout/review` (D4).
- Adding an AUD-base rate table (D2).
- Any change to how `CHECKOUT_COUNTRY_PARTITION_ENABLED` gates behaviour.
