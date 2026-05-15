# Customer portal performance audit - 2026-05-15

Scope: `print-room-portal` customer portal only. No app code was changed in this phase.

## 1. Rendering strategy audit

Global portal shell: `app/layout.tsx` wraps the app in client `AuthProvider`; `app/(portal)/layout.tsx` wraps all portal routes in client `CompanyProvider`, `CurrencyProvider`, `CartProvider`, and `PortalShell`. `PortalShell` returns the generic `PortalSkeleton` until `CompanyContext` finishes `/api/company-access`, so even Server Component pages can be hidden behind a client-side company fetch.

| Route | Strategy | Initial data source | `loading.tsx` | RSC usage |
|---|---|---|---|---|
| `/catalogue` | Server Component page, `dynamic = 'force-dynamic'`, with small client islands for top-bar context, filters, money/currency, cart shell | `requireB2BCustomer()` plus Supabase service-role queries for catalogue grants, products, facets, bulk prices, images, tier floors, decorations, stock, swatches | No | Yes, but visible page is gated by client `PortalShell` company loading |
| `/catalogue/[productId]` | Server Component parent plus `ProductDetailClient` island | Server Supabase loads auth, catalogue item, product, variants, brackets, availability, images, colours, decorations; client then debounces `/api/shop/pricing` and `/api/shop/decoration-pricing` | No | Yes, but shell gate still applies |
| `/shop` | No `app/(portal)/shop/page.tsx`; `next.config.mjs` redirects `/shop` to `/catalogue` and `/shop/:productId` to `/catalogue/:productId` | Redirect only | No | N/A |
| `/order-tracker` | Whole page is `'use client'` | `useCompany()` first, then `useEffect` fetches `/api/order-tracker`; API uses Supabase auth plus service-role job tracker queries | No | No page-level RSC data fetch |
| `/my-collections` | Whole page is `'use client'` | `useCompany()` first, then `useEffect` fetches `/api/account-data`; API loads stores and quotes | No | No page-level RSC data fetch |
| `/my-collections/[collectionId]` | Whole page is `'use client'`; reads `collectionId` from `window.location` | `useCompany()` first, then `useEffect` fetches `/api/collections/[collectionId]`; API branches quote vs collection | No | No page-level RSC data fetch |
| `/account` | Server Component wrapper plus `AccountClient` island | Server fetches one AUD exchange-rate row; client waits for `useCompany()`, then fetches `/api/account-data` | No | Partial only; main account data is client fetch |

No `loading.tsx` files exist under `app/(portal)`.

## 2. Network waterfall audit

Method: local `npm run dev -- --port 3000`, authenticated as `hello@theprint-room.co.nz` via generated Supabase magic-link cookie, Chrome 148 headless through CDP with cache disabled. `agent-browser` and a Chrome DevTools MCP binary were not available in this environment. These are dev-mode numbers, so React Strict Mode duplicate effects are visible and should be rechecked against `next start` before treating duplicate counts as production facts.

| Route | TTFB | FCP | Main content visible | Fetch/XHR before content |
|---|---:|---:|---:|---|
| `/catalogue` | 95 ms | 556 ms | 3536 ms to first product-card grid | `/api/company-access` twice, Supabase `exchange_rates` once |
| `/order-tracker` | 143 ms | 592 ms | 2119 ms to tracking content | `/api/company-access` twice, Supabase `exchange_rates` once, `/api/order-tracker` three times |
| `/catalogue/02bd7a2a-eb6f-4714-ac99-bfb5c11d0cd7` | 125 ms | 620 ms | 2468 ms to PDP add-to-cart surface | `/api/company-access` twice, Supabase `exchange_rates` once |

Sequential chain observed on client-fetch pages:

1. Document and generic shell paint.
2. Browser JS hydrates `AuthProvider`, `CompanyProvider`, `CurrencyProvider`.
3. `CompanyContext` fetches `/api/company-access`.
4. `/order-tracker`, `/my-collections`, `/account`, and collection detail start their own data fetch only after company loading flips false.

The catalogue/PDP server payload arrives early, but the user still sees the shell skeleton until the client company gate resolves. Tracker compounds this with a second fetch layer after company access.

## 3. Loading-bug hunt

Findings:

- `CompanyContext`, `CurrencyContext`, `AuthContext`, `/order-tracker`, `/my-collections`, `/my-collections/[collectionId]`, and `AccountClient` all run async effects without `AbortController` or a mounted/stale-request guard.
- `CompanyContext` does not set `loading` back to true when `user` changes. A user/org switch can leave old `access` visible until the new `/api/company-access` response lands.
- The client-fetch pages do not clear existing data when `access` changes, so stale trackers/quotes/account rows can flash after an account switch.
- Dev Chrome CDP showed duplicate `/api/company-access` calls and triple `/api/order-tracker` calls. This is consistent with React Strict Mode and auth-state effect churn, but the code is not idempotent or abortable, so late responses can still win.
- `/api/order-tracker` logs repeated Supabase `22P02` errors because `attachProductImages()` sends non-UUID `designInstanceId` values such as `plant-a-seed-mens` into `design_submissions.id`. This wastes a request and adds noisy error logging on tracker load.
- There is no refetch-on-focus or polling in the audited portal pages.
- Skeletons do not match final layouts: `PortalSkeleton` is generic, has `shadow-sm`, and uses a 4:3 card; collection detail and account use older `animate-pulse` blocks. None are co-located route fallbacks.
- Catalogue filter controls submit a real GET form with `requestSubmit()`, so the navigation can replace the grid instead of keeping the old results dimmed during transition.
- `/catalogue` is not in `proxy.ts` protected route matchers. The page handles unauthenticated users in RSC, but `x-pathname` is absent, so the fallback redirect uses `returnTo=/`.
- Out of scope encountered: Next logged an above-the-fold product image/LCP hint for a catalogue image. Per brief, image optimisation is a separate sprint and is not included in the punch list.

## 4. Caching audit

Current cache state: `next.config.mjs` does not enable `cacheComponents`; portal catalogue/PDP/account pages set `dynamic = 'force-dynamic'`; no customer-portal data source currently uses `use cache`, `unstable_cache`, fetch cache options, or React `cache()` except unrelated proof field config. Next 16 docs in this install say `use cache` requires `cacheComponents: true`, `cacheLife` must run inside a cached scope, and `unstable_cache` has been replaced by `use cache`.

| Data source | Scope and churn | Recommended primitive |
|---|---|---|
| Auth user and company resolution | Request/cookie scoped; changes on sign-in, membership edits, role/store changes | No persistent cache. Use React `cache()` for `requireB2BCustomer()` / company resolution within one server request. Prefer passing the resolved access from RSC into the shell to remove `/api/company-access` from initial paint. |
| Catalogue item ids and product list | Org + membership + filters + page; staff-published, not customer-mutated; grants can change | After enabling Cache Components, use function-level `'use cache'` keyed by serializable `{ orgId, membershipId, tenantType, filters, page }`, with `cacheLife({ stale: 300-3600, revalidate: 300-3600 })` depending on how quickly staff catalogue edits must surface. Do not pass a Supabase client into the cached function. |
| Facets: brands, categories, garment families | Org/catalogue scoped; changes when catalogue products change | `'use cache'` with a longer profile such as `cacheLife({ stale: 3600, revalidate: 3600 })`, ideally tagged per org/catalogue for future invalidation. |
| Pricing tiers and decoration price floors | Org/catalogue item scoped; changes when staff edits pricing/decorations | Cache short or tag-based. A safe first step is React `cache()` per request; next step is `'use cache'` keyed by `{ orgId, productIds/catalogueItemIds, qtys }` with 5-15 minute revalidate unless staff needs immediate pricing propagation. |
| Stock/availability | Org scoped; can change when orders/inventory move | Avoid long persistent cache. Use request dedupe only unless the business accepts stale stock chips. |
| Tracker list | User/org scoped; changes from Monday webhooks and reorder flow | No cross-request cache. Convert to RSC data fetch and use React `cache()` to dedupe within the request. |
| Quote/order list | User/org scoped; changes after customer submit or staff approval | No cross-request cache. Convert list load to RSC where viable and dedupe within request. |
| Exchange rates | Global-ish, hourly churn | Existing browser module cache helps only per tab. Consider a server cached function with hourly `cacheLife` and pass initial rates to the currency provider. |

## Phase 2 punch list

| Item | Severity | Effort | Dependencies |
|---|---|---:|---|
| Seed portal shell from server-resolved auth/company access so RSC pages are not hidden behind `/api/company-access` | P0 paint blocker | M | Needs careful `AuthProvider`/`CompanyProvider` API shape |
| Convert `/order-tracker` initial load to RSC parent plus client island for search/filter/reorder UI | P0 paint blocker | M | Server auth/company helper dedupe first |
| Convert `/my-collections` initial quote list to RSC parent plus client island | P1 perceptible | M | Same server auth helper; decide whether `/api/account-data` is split |
| Add co-located OEM-style `loading.tsx` for catalogue, PDP, tracker, my-collections, account | P1 perceptible | S | Can ship independently; keep gray-100/rounded-3xl/no heavy shadows |
| Replace `PortalSkeleton` usage in portal shell or make it match OEM visual system | P1 perceptible | S | Coordinate with route skeletons |
| Make catalogue filter selects navigate through `useTransition`/`router.push` and keep current grid dimmed | P1 perceptible | M | Preserve mobile custom dropdown behavior |
| Add abort/stale guards to client fetch effects that remain after RSC conversion | P1 perceptible | S | Depends on which pages remain client-fetch |
| Fix `CompanyContext` user-switch stale access handling | P1 perceptible | S | Easier if server-seeded provider is done first |
| Validate tracker `designInstanceId` values before querying `design_submissions.id` | P1 perceptible | S | Independent tracker API cleanup |
| Add `/catalogue` and `/catalogue/:path*` to the protected proxy matcher or otherwise pass the pathname header | P2 polish | XS | Confirm desired auth redirect behavior |
| Enable Cache Components and introduce narrow cached data functions for facets/catalogue static data | P1 perceptible | M | Requires removing/rethinking `force-dynamic`; run `next build` route summary after each cache change |
| Cache/dedupe exchange rates server-side and hydrate currency provider | P2 polish | S | Optional, but it is in the measured waterfall |

Stop point: wait for sign-off before Phase 3 implementation.
