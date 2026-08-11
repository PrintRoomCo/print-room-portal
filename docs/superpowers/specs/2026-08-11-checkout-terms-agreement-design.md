# Design — Checkout Terms & Conditions agreement + honeypot

> **Date:** 2026-08-11 · **Author:** grounded code inspection + `/grilling` decisions with Jon.
> **Repos:** **P** = `print-room-portal` (customer, this repo) · **S** = `print-room-staff-portal` (schema owner).
> **Status:** design approved via grilling (all 9 decisions locked, 2026-08-11). Next: `writing-plans`.
> **Scope:** self-contained in **P**. **No schema change** — the `orders`/RPC schema is owned by **S**
> and must not be altered from this repo (no `apply_migration`, no dashboard SQL).

---

## Goal

Require a customer to **read and agree to Terms & Conditions before an order is placed**, and record
that agreement as a durable, legally-defensible consent trail. Add a **client-side honeypot** as a
low-cost bot deterrent. Ship with **genuine (not lorem-ipsum) provisional** terms that Jon reviews,
versioned so each consent record maps to exact text in git.

The single insertion point is the **review step** (`/checkout/review`) — the one place an order is
POSTed (`confirmOrder()` in `CheckoutReviewClient.tsx`). The earlier `/checkout` edit step is untouched,
and the shared `CheckoutCTAStickyBar` is **not** modified (the checkbox lives in review-page content).

## The controlling constraint

The consent record **cannot be atomic with the order.** `submit_b2b_order` is a Postgres RPC owned by
**S**; we cannot add a column to `orders` or a `p_terms_*` param to the RPC. So the consent artefacts
are necessarily separate `audit_events` inserts written *after* the RPC commits, and those inserts are
best-effort (logged-not-thrown, like every other post-commit side-effect in `submitCustomerOrder`).
This constraint is why the **server gate**, not the audit write, carries the legal weight (Decision 2).

## Decisions locked (grilling, 2026-08-11)

| # | Decision | Choice | Why |
|---|---|---|---|
| 1 | What is the record for? | **Both** legal proof + operational log | Build to the stricter (legal) bar; the log falls out for free. |
| 2 | How to make it trustworthy when it can't be atomic? | **Server gate is the proof; event corroborates (belt-and-braces)** | `route.ts` returns 400 and never calls `submitCustomerOrder` unless `terms_accepted === true`, so "an order exists" ⇒ "terms accepted", provable from the code path. `terms_version` is *also* folded into the reliably-written `ORDER_SUBMIT` metadata, and a dedicated `TERMS_ACCEPTED` event is the clean queryable signal. |
| 3 | Split cart — one consent event or two? | **Two — one per order** | Each order independently carries its own proof; a dispute over one order needs no reasoning about its sibling. Correlate via shared base `idempotency_key`. Recorded *inside* `submitCustomerOrder` so any caller inherits it. |
| 4 | Retries → duplicate events? | **Accept duplicates** | Matches existing `ORDER_SUBMIT` (post-commit block runs unconditionally on idempotent replay). Deduping needs a uniqueness constraint (schema change — barred) or a racy pre-read. A duplicate consent row is harmless; the shared key collapses them in a query. |
| 5 | Honeypot — client-only or server too? | **Client-side only** | Endpoint is already behind `requireB2BCustomerApi` auth, so the honeypot is decorative; auth+rate-limiting handle the authenticated-attacker case better. A server honeypot check adds a false-positive risk that could silently harm a real customer, for ~zero marginal protection. |
| 6 | Re-agree every order, or remember? | **Re-agree every order** | Matches "when customers complete orders they should read and agree before placing an order"; keeps each checkout a deliberate affirmation; simplest — no per-user "last accepted version" store (which we can't add cheaply). Terms bumps auto-force re-acceptance. |
| 7 | Placeholder terms content | **Genuine short plain-English B2B terms (Jon reviews before merge)** | On a live portal, agreeing to lorem-ipsum is worse than nothing — it undermines the consent record. Provisional-but-real keeps it defensible from day one; final legal copy is a later edit to one component. |
| 8 | Button gating | **Keep button enabled; guard in `confirmOrder()` with `setBanner()`** | Terms is a *validation* concern (like the existing `missingShipTo` guard), not a *system-readiness* concern (the `disabled` prop's current job). More accessible than a dead disabled button; reuses the file's own idiom. |
| 9 | Version string format | **`v1-2026-08-11`** (sequence + effective date) | Unambiguous ordering without date-parsing; effective date carries legal meaning. Bump to `v2-<date>` on substantive change (not typo fixes). |

---

## Architecture

### Data flow

```
CheckoutReviewClient (review page, client)
  ├─ termsAccepted: boolean  (ephemeral React state, default false, resets on reload)
  ├─ honeypot: string        (ephemeral, default '')
  ├─ TermsModal (radix dialog) ← opened by the checkbox's inline link
  │    └─ TermsContent (placeholder clauses)
  └─ confirmOrder()
       ├─ if honeypot !== '' → silent return (no POST)          [Decision 5, client-only]
       ├─ if !termsAccepted  → setBanner(error) + return         [Decision 8, mirrors missingShipTo]
       └─ POST /api/checkout { …existing…, terms_accepted: true, terms_version: TERMS_VERSION }
                │
                ▼
app/api/checkout/route.ts
       ├─ if body.terms_accepted !== true OR body.terms_version is not a non-empty string
       │        → 400 { error: 'terms_not_accepted' }                             [Decision 2, THE gate]
       └─ for each partition: submitCustomerOrder(admin, { …, terms_accepted, terms_version })
                │
                ▼
lib/checkout/submit.ts · submitCustomerOrder (after RPC commit, per order)
       ├─ ORDER_SUBMIT audit metadata gains terms_version                          [Decision 2, reliable copy]
       └─ recordAuditEvent(TERMS_ACCEPTED, { order_ref, terms_version, idempotency_key })  [Decision 3]
```

`terms_version` originates from a single constant so shown-text and recorded-version can't drift.

### New files (P)

| File | Purpose |
|---|---|
| `lib/checkout/terms.ts` | `export const TERMS_VERSION = 'v1-2026-08-11'`. **Imported by the client only.** The client rendered the exact text the customer saw, so it is the authoritative source of the version: it sends `terms_version: TERMS_VERSION` in the POST, and the server records that value verbatim (see *version provenance* below). The string is git-versioned alongside `TermsContent.tsx`, so any recorded value maps back to the text that was live. |
| `components/checkout/TermsContent.tsx` | Pure presentational placeholder clauses (real plain-English B2B terms — see below). Rendered inside the modal. Final legal copy is a later edit here; bump `TERMS_VERSION` when substance changes. |
| `components/checkout/TermsModal.tsx` | Radix `@radix-ui/react-dialog` wrapper mirroring `components/shop/RequestReorderModal.tsx` (no shared UI dialog exists). Renders `TermsContent`. Focus trap handled by Radix. |

### Edited files (P)

| File | Change |
|---|---|
| `components/checkout/CheckoutReviewClient.tsx` | Add `termsAccepted` + `honeypot` ephemeral state (NOT persisted to `reviewState`). Render, above the CTA: (a) checkbox + `<label>` "I have read and agree to the [Terms & Conditions]" whose link opens `TermsModal`; (b) a visually-hidden honeypot `<input name="company_url" autoComplete="off" tabIndex={-1} aria-hidden>`. In `confirmOrder()`: honeypot guard (silent return) + terms guard (`setBanner` + return) at the top, alongside the existing `missingShipTo` guard; add `terms_accepted: true, terms_version: TERMS_VERSION` to the POST body. |
| `app/api/checkout/route.ts` | Extend `CheckoutRequestBody` with `terms_accepted?: boolean; terms_version?: string`. After the JSON parse + before order creation, **reject with `400 { error: 'terms_not_accepted' }` unless `terms_accepted === true` AND `terms_version` is a non-empty string** (so no order is ever created with an acceptance record that lacks a version). Thread `terms_accepted` + `terms_version` into each `submitCustomerOrder(auth.admin, { … })` call. (No honeypot handling — client-only.) |
| `lib/checkout/submit.ts` | Add `terms_accepted?: boolean; terms_version?: string` to `CheckoutInput`. Fold `terms_version` into the existing `ORDER_SUBMIT` audit metadata (`:1483`). Immediately after, record a `TERMS_ACCEPTED` event (same resilient try/catch shape as `ORDER_TYPE_STAMP_FAILED`) with `{ order_ref, terms_version, idempotency_key: input.idempotency_key }`, `targetType: 'order'`, `targetId: order_id`. |
| `lib/audit/actions.ts` | Add `TERMS_ACCEPTED: 'order.terms_accepted'` to `AUDIT_ACTIONS`. Customer-only — **no staff mirror** (the file's `order.*` actions like `ORDER_SUBMIT` are not mirrored; only `member.*`/`b2b_member_store_grants.*`/`proof.*` carry the MIRROR contract). |

---

## Server enforcement (the legal guarantee)

The route validates `terms_accepted === true` **and** a non-empty `terms_version` **before** any
`submitCustomerOrder` call. A forged or UI-skipping POST that omits either gets a 400 and creates no
order. Therefore the existence of an order is itself structural proof of consent, independent of whether
any audit write succeeded. This is the claim the design is built on (Decision 2): *"we structurally
cannot create an order without a recorded consent version."*

### Version provenance

The server records the **client-sent** `terms_version`, not a server-side constant, because the client
is what rendered the exact text the customer saw — so it is the accurate record of *what they agreed
to*, which matters most during a deploy window when client JS and server code can briefly disagree on
the current version. The forgery risk is negligible (a buyer forging their own consent version only
weakens their own later dispute), and the route's non-empty-string check plus the git-versioned
`terms.ts`/`TermsContent.tsx` keep every recorded value meaningful and resolvable to real text.

## Recording detail

- **`ORDER_SUBMIT`** (existing, reliably written): metadata gains `terms_version`. This is the redundant
  reliable copy — if the dedicated event's write is lost, this still proves which version was accepted.
- **`TERMS_ACCEPTED`** (new): `action: 'order.terms_accepted'`, `targetType: 'order'`, `targetId: order_id`,
  metadata `{ order_ref, terms_version, idempotency_key }`. Written per order (two for a split cart),
  best-effort in a try/catch that never turns a committed order into a 500.
- **Who/when** come free: `actor_user_id` + the `audit_events.created_at` DB default.
- **Retries** (same idempotency key) may write duplicate `TERMS_ACCEPTED`/`ORDER_SUBMIT` rows; accepted
  (Decision 4). Queries collapse on the shared base `idempotency_key`.

## Honeypot (client-side only)

A visually-hidden `<input name="company_url">` (`autoComplete="off"`, `tabIndex={-1}`, `aria-hidden`,
off-screen via an `sr-only`-style / off-screen style). Real users never see/focus it; an autofill-resistant name
avoids the one false-positive path. In `confirmOrder()`, if it is non-empty, return silently before the
POST. It is **never** sent to the server (Decision 5) — the auth gate is the real anti-bot control.

## UX

- Checkbox starts **unticked every checkout** (Decision 6); ephemeral state, resets on reload → re-affirm.
- Real `<label>` bound to the checkbox; the "Terms & Conditions" link opens `TermsModal` (Radix focus trap).
- Button stays **enabled** re: terms; the `confirmOrder()` guard shows a banner
  ("Please read and agree to the Terms & Conditions before placing your order.") and returns if unticked,
  optionally focusing the checkbox. The checkbox sits directly above the CTA so the requirement is visible
  up front; the guard only handles a click-anyway.
- Preview mode already never POSTs — no change.

## Terms content (placeholder, provisional-but-real)

`TermsContent.tsx` ships short plain-English B2B clauses (Jon reviews wording before merge). Draft covers:
quote/price validity, GST, payment terms, artwork/proof approval, cancellations & changes, delivery/risk,
and a "these terms may be updated" line. Not lorem ipsum. `TERMS_VERSION = 'v1-2026-08-11'`; final legal
copy is a later edit here (bump version on substantive change).

## Testing

- **Route** (`app/api/checkout/__tests__/`): 400 `terms_not_accepted` when `terms_accepted` is missing /
  `false`; happy path threads `terms_accepted` + `terms_version` into `submitCustomerOrder`.
- **Client** (`components/checkout/__tests__/`): guard shows the banner and does **not** POST when the box
  is unticked; ticking then confirming POSTs with `terms_accepted: true` + `terms_version`; the link opens
  the modal; a filled honeypot aborts with no POST.
- **Submit** (`lib/checkout/__tests__/` if present, else route-level): `TERMS_ACCEPTED` recorded per order
  (both partitions for a split cart); `ORDER_SUBMIT` metadata carries `terms_version`.

## Out of scope (YAGNI)

No `/terms` route/page; no DB columns or RPC change; no per-user "remember my agreement"; no server-side
honeypot; no IP/user-agent capture (authenticated named B2B buyers make `actor_user_id` sufficient); no
time-trap / rate-limit changes; no audit-event dedup.
