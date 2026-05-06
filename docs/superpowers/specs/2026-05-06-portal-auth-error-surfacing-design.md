# Portal Auth Error Surfacing — Design

**Date:** 2026-05-06
**Repo:** `print-room-portal`
**Status:** draft

## Why

Today the PDP at `/shop/[productId]` swallows every `requireB2BCustomer` failure as `notFound()`. A signed-in customer whose org isn't seeded, a customer whose session has expired, and a real "product not in catalogue" all render the same generic 404. We just spent log-diving time diagnosing a PostgREST 300 (ambiguous embed) only because the symptom showed up as 404 — there was no signal that the failure was server-side, not data-side.

The other six server-component pages (`/shop`, `/cart`, `/checkout`, `/checkout/confirmation/[orderId]`, `/quote-requests`, `/quote-requests/[id]`) blanket-redirect to `/account` on auth failure. That's also lossy — the redirect doesn't carry a reason, so `/account` can't explain *why* the customer landed there.

Goal: every auth/data failure on a portal server-component page produces a response that tells the customer (and the dev tailing logs) what actually happened.

## Goal

Two coupled deliverables, ordered:

1. **Phase A — typed failure mode on `requireB2BCustomer`.** Replace the `NextResponse`-shaped `error` field (which is invalid for server components anyway — server components can't return a JSON response object) with a discriminated union: `{ kind: 'unauthenticated' | 'no_org' | 'org_not_found' | 'missing_customer_code' }`. API routes still need their NextResponse — keep a separate helper or a small adapter so the change is non-breaking on that side.
2. **Phase B — page-level handling that surfaces the kind.** The PDP stops calling `notFound()` for auth errors. All seven server-component pages route by `kind`:
   - `unauthenticated` → redirect to `/sign-in?next=<originalPath>` (preserves intent — customer lands back on PDP after signing in)
   - `no_org` / `org_not_found` → redirect to `/account?reason=no_org` (account page reads the param and renders an explanatory block instead of the default account view)
   - `missing_customer_code` (only `/checkout` triggers this) → render an inline error block on the checkout page itself, not a redirect — customer needs to know the action they tried to take is gated
   - **No catch-all 404 for auth.** If `requireB2BCustomer` itself throws (Supabase down, etc.), the page lets it throw → Next renders `error.tsx`, which we add.

`notFound()` is reserved for genuine resource-not-found: the catalogue lookup or product lookup returning null *after* auth has succeeded.

## Non-goals

- No new auth flow. We're not redesigning sign-in, sign-up, invite, or customer-code provisioning.
- No new account self-service. The `/account?reason=no_org` block is a static "your account isn't set up yet — contact sales@…" message; we're not adding a flow for the customer to fix it themselves.
- No structured logging / Sentry wiring. Out of scope; tracked separately.
- No changes to the 14 API route call-sites. They already return `auth.error` correctly. The adapter mentioned in Phase A keeps that working unchanged.
- No changes to staff portal. Different repo, different auth helper.

## Why this stack

Per `feedback_web_project_pre_plan_strategy.md` — quick stack check before writing the plan.

- **Rendering.** All affected pages are already `export const dynamic = 'force-dynamic'` server components. No SSG/ISR concerns. `redirect()` and `notFound()` are the App Router primitives we're already using; this spec just routes between them more carefully.
- **Caching.** No cache changes. Auth-gated pages were already opted out via `force-dynamic`. The `error.tsx` boundary doesn't cache.
- **Performance.** Net-zero. We're trading one branch (`if error → notFound`) for one branch with a switch (`if error → switch on kind`). No new queries, no new round-trips.
- **Ecommerce pattern.** `?next=` redirect-after-sign-in is the standard pattern (Shopify, Stripe Checkout, every SaaS). It's what customers expect, and it preserves the deep-link share use case (someone forwarding a PDP URL to a colleague who isn't signed in yet).

## Architecture

### Discriminated union vs status code

We considered keeping `requireB2BCustomer` returning `{ error: NextResponse }` and having pages parse the status code. Rejected: NextResponse is a route-handler primitive, server components can't return it, and parsing `.status` after the fact loses type narrowing. A discriminated union gives us exhaustive `switch (auth.kind)` checking at every call site.

### Two helpers, not one

Splitting into:
- `requireB2BCustomer()` — returns `{ admin, context } | { kind: AuthFailureKind }`. Used by server components.
- `requireB2BCustomerApi()` — thin adapter around the above; converts `kind` into the appropriate `NextResponse.json({ error }, { status })`. Used by route handlers.

Single source of truth for the status mapping lives in `requireB2BCustomerApi`. Adding a new `kind` only requires updating one mapping table.

### Error boundary for unhandled failures

Add `app/(portal)/error.tsx` as a client error boundary for the portal route group. Catches anything `requireB2BCustomer` throws (e.g. Supabase 500), shows a generic "something went wrong, contact support" UI with a retry button. Without this boundary, Next falls back to its default error page, which leaks stack traces in dev and shows a blank "An error occurred" screen in prod — neither surfaces the failure to support.

### `/sign-in?next=` flow

`requireB2BCustomer` doesn't know the request URL. The page does. So the `next=` param is constructed at the call site:

```ts
import { headers } from 'next/headers'
const path = (await headers()).get('x-pathname') ?? '/'
if (auth.kind === 'unauthenticated') redirect(`/sign-in?next=${encodeURIComponent(path)}`)
```

Requires `x-pathname` to be set in middleware (one-line addition). After sign-in, the `/sign-in` page reads `next` and redirects there if it's a same-origin pathname (validate to prevent open redirect).

### `/account?reason=no_org`

`/account` server component reads `searchParams.reason`. If `'no_org'`, renders an explanatory block (PortalEmptyState component already exists) above the normal account view. Otherwise renders normally. No new component needed.

## File structure

### New files

- `print-room-portal/app/(portal)/error.tsx` — client error boundary for the portal route group.
- `print-room-portal/docs/superpowers/plans/2026-05-06-portal-auth-error-surfacing-plan.md` — implementation plan derived from this spec.

### Modified files

- `print-room-portal/lib/checkout/server.ts` — refactor `requireB2BCustomer` to return discriminated union; add `requireB2BCustomerApi` adapter.
- `print-room-portal/lib/supabase-middleware.ts` (or equivalent middleware) — set `x-pathname` request header so server components can read it.
- `print-room-portal/app/(portal)/shop/[productId]/page.tsx` — replace `notFound()` with `kind`-based switch; keep `notFound()` only for the genuine catalogue/product-row-null cases.
- `print-room-portal/app/(portal)/shop/page.tsx` — same switch (replaces blanket `redirect('/account')`).
- `print-room-portal/app/(portal)/cart/page.tsx` — same switch.
- `print-room-portal/app/(portal)/checkout/page.tsx` — same switch + render `missing_customer_code` inline.
- `print-room-portal/app/(portal)/checkout/confirmation/[orderId]/page.tsx` — same switch.
- `print-room-portal/app/(portal)/quote-requests/page.tsx` — same switch.
- `print-room-portal/app/(portal)/quote-requests/[id]/page.tsx` — same switch.
- `print-room-portal/app/(portal)/account/page.tsx` (and/or `AccountClient.tsx`) — read `searchParams.reason`, render explanatory block when `=no_org`.
- `print-room-portal/app/(auth)/sign-in/page.tsx` — read and validate `next` param, redirect post-sign-in.
- 6× API routes — no changes to call sites; switch the import from `requireB2BCustomer` to `requireB2BCustomerApi` (one-line change each).

### Deleted files

None.

## Acceptance criteria

- Hitting `/shop/<id>` while signed out: redirects to `/sign-in?next=%2Fshop%2F<id>`, then back to the PDP after sign-in.
- Hitting `/shop/<id>` signed in but with no `user_organizations` row: redirects to `/account?reason=no_org`, account page shows the explanatory block.
- Hitting `/shop/<id>` signed in, org is fine, but the product isn't in the catalogue: returns proper 404 (genuine `notFound()`), unchanged.
- Hitting `/shop/<id>` signed in, org is fine, product is fine, but Supabase throws 500: `error.tsx` boundary renders, server logs the throw with stack.
- All 6 API routes still return their existing JSON shapes and status codes after the import swap (smoke test each one).
- `tsc --noEmit` passes — exhaustive switch checking should catch any missed `kind`.

## Open questions

1. Does the existing `/sign-in` page already accept a `next` param, or is this net-new? (If the customer-checkout-mvp work added it, the spec needs updating.) **Answer needed before plan is written.**
2. Should `unauthenticated` on `/checkout` redirect to `/sign-in?next=/cart` instead of `/sign-in?next=/checkout`? Cart preserves their basket; checkout requires the cart to still exist. Likely yes, but worth confirming the cart-store's session persistence model.
3. Is there value in adding a `kind: 'expired_session'` distinct from `unauthenticated` so we can show "your session expired, please sign back in" vs "please sign in"? Probably not for MVP — Supabase auth doesn't make this distinction cleanly anyway. Leave for follow-up if customers complain.
