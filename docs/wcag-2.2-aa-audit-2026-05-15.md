# WCAG 2.2 AA Audit — print-room-portal

**Date:** 2026-05-15
**Scope:** Customer B2B portal (`print-room-portal`) — all routes under `app/(portal)/*` and `app/(auth)/*`
**Target:** WCAG 2.2 Level AA
**Method:** Four parallel static-code audits across (1) semantics & landmarks, (2) keyboard & focus, (3) forms & errors, (4) contrast & images. Computed contrast ratios from CSS-variable token values. No live browser/AT testing performed.
**Stack note:** Next.js 16 / React 19 / Tailwind 3. **No primitive UI library** (no Radix, no Headless UI). Every dialog, menu, picker, and tab is hand-rolled — this is the single biggest accessibility risk and the driver of most failures below.

---

## TL;DR

| Area | Status | Headline issue |
|---|---|---|
| Semantics & landmarks | 🟢 Mostly good | No skip link, missing per-route metadata on ~8 pages |
| Keyboard & focus | 🔴 Multiple critical | Custom modals lack focus trap + return-focus; pickers have no arrow-key nav; clickable `<div>` backdrops |
| Forms & errors | 🟡 Mixed | Labels & autocomplete largely correct; error messages not announced; hCaptcha is the only path on reset/request-access (3.3.8) |
| Contrast & visuals | 🟠 Three critical token failures | PR Yellow on white **1.09:1**, border **1.26:1**, PR Blue on charcoal **1.64:1** |
| Images & reflow | 🟢 Good | Alt text generally correct; no fixed-width offenders |

**Estimated effort to AA-clean:** ~1.5 days (1 day for keyboard/focus + token tweaks, ½ day for form announcements + skip link + metadata). Aesthetic preserved — most fixes are token nudges or invisible ARIA.

---

## 1. Findings by criterion

### 🟢 What's already correct
- `app/layout.tsx:23` — `<html lang="en">` and root `metadata` with title template.
- `components/layout/PortalTopBar.tsx:59` — `<header role="banner">` landmark.
- `components/layout/Sidebar.tsx:101–128` — `<aside aria-label>` + `<nav>` + `<ul>/<li>` nav items.
- `components/shop/CatalogueTopBar.tsx:28` — `<nav aria-label="Breadcrumb">` + `<ol>` + `aria-current="page"`.
- `components/layout/PortalTopBar.tsx:45,70` — `aria-expanded` + `aria-haspopup="menu"` on menu triggers.
- `components/layout/AccountMenu.tsx:58–65` — `role="menuitem"` + Escape key + tabindex management.
- `components/shop/VariantPicker.tsx` — `aria-label` + `aria-pressed`.
- `components/shop/ProductImageGallery.tsx:145–173` — `role="tab"` + `aria-selected`.
- `components/cart/CartChip.tsx` — `aria-label` reflects qty.
- All auth inputs use `htmlFor`/`id` + correct `autoComplete` tokens (`email`, `current-password`, `new-password`, `one-time-code`).
- `components/proofs/ProofStagingForm.tsx:113–140` — `role="alert"` on error, `role="status"` on success — **reference implementation**.
- No `position: fixed` width hacks; no `min-w-[1024px]`; reflow at 320 CSS px should hold.

---

### 🔴 Critical — fix before claiming AA

#### K-1 — Modals lack focus trap + return-focus
**Criterion:** 2.1.2 No Keyboard Trap, 2.4.3 Focus Order, 4.1.2 Name/Role/Value
**Files:** `components/shop/RequestReorderModal.tsx`, `components/leavers/CustomerDetailsModal.tsx`, plus modal pattern reused in `components/leavers/QuoteBuilder.tsx` and `app/(portal)/my-collections/[collectionId]/page.tsx`
**Issue:** Tab focus escapes the modal to background content. Focus does not return to the trigger element on close. Backdrops are clickable `<div onClick>` with no `role`/`tabindex`/`onKeyDown`.
**Fix:**
- Wrap dialog content in a `role="dialog" aria-modal="true" aria-labelledby={titleId}` container.
- Trap Tab cycle within the dialog (first/last focusable detection).
- Store trigger ref before opening; `.focus()` it on unmount.
- Replace clickable backdrops with `<button>` or add `role="button" tabindex={0} onKeyDown` for Enter/Space.
- Strategic alternative: adopt `@radix-ui/react-dialog`. Solves all four sub-issues at once, no aesthetic impact (it's a headless primitive).

#### K-2 — Custom pickers have no arrow-key navigation
**Criterion:** 2.1.1 Keyboard
**Files:** `components/shop/VariantPicker.tsx:90–108`, `components/shop/DecorationSwatchPicker.tsx`, `components/shop/VariantlessSizeGrid.tsx`, `components/shop/ProductImageGallery.tsx:145–173`
**Issue:** Color/size swatches and gallery thumbnails respond to click only. Arrow keys do nothing.
**Fix:** Roving-tabindex pattern. On `onKeyDown` for ArrowLeft/Right (and Up/Down for grids), move focus to next swatch, set `tabIndex={-1}` on others, `tabIndex={0}` on focused.

#### F-1 — Errors not announced to screen readers
**Criterion:** 3.3.1 Error Identification, 4.1.3 Status Messages
**Files:** `app/(auth)/sign-in/page.tsx:252`, `app/(auth)/invite-accept/page.tsx:62`, `components/orders/ReorderForm.tsx:113`, `components/leavers/ArtworkUpload.tsx:36` (uses native `alert()`)
**Fix:** Wrap error containers with `role="alert"` (assertive) or `aria-live="polite"` (non-blocking). Replace `alert()` in `ArtworkUpload` with an inline `role="alert"` region — `alert()` is unreliable for screen readers and disruptive to keyboard users.

#### F-2 — hCaptcha is the only auth path on two routes
**Criterion:** 3.3.8 Accessible Authentication (Minimum) — **new in WCAG 2.2**
**Files:** `app/(auth)/reset-password/page.tsx:51`, `app/(auth)/request-access/page.tsx:144`
**Issue:** hCaptcha is a cognitive function test. AA requires either (a) an alternative that does not require a cognitive function test, or (b) help to bypass it. Sign-in has an email-code mode; reset-password and request-access don't.
**Fix:** Add an "email me a verification code" path on both routes (no captcha), or remove the captcha and rely on server-side rate-limiting + email verification.

#### C-1 — PR Yellow on white background — **1.09:1**
**Criterion:** 1.4.3 Contrast (Minimum) when used for text, 1.4.11 Non-text Contrast when used for UI
**Files:** `app/globals.css` (`--color-brand-yellow`), used by `glass-badge-yellow`, `glass-info-box`, sidebar accents.
**Math:** `hsl(71 100% 78%)` → RGB(234, 255, 143) → L=0.91 vs white L=1.0 → **1.09:1**.
**Fix:** Darken to ≈`hsl(71 100% 38%)` (#A4D200) for 4.5:1 on white, OR keep current pale yellow as background only and force black foreground text on it (current usage often has text *on* the yellow, which is fine since charcoal-on-yellow = 14.77:1 ✓). The failure mode is yellow **text** on white, and yellow swatches/icons used to convey state on white.

#### C-2 — PR Blue on PR Charcoal — **1.64:1**
**Criterion:** 1.4.11 Non-text Contrast (UI states)
**Files:** `app/globals.css` (`--color-brand-blue` ≈ `hsl(231 54% 37%)`), used in `components/orders/ProductionProgressBar.tsx` for completed/active step circles.
**Math:** Blue L=0.057 vs Charcoal L=0.015 → **1.64:1**. Adjacent step states are visually indistinguishable.
**Fix:** Use white text/iconography on blue, or swap to PR Yellow on charcoal (14.77:1). Prefer the second — keeps brand and works on both light and dark backgrounds.

#### C-3 — Border token — **1.26:1**
**Criterion:** 1.4.11 Non-text Contrast (only when the border conveys information — e.g. selected state, error state, input boundary)
**Files:** `app/globals.css` (`--border: 0 0% 89.8%`), used app-wide on inputs, cards, table rows.
**Math:** RGB(229,229,229) → L=0.784 vs white L=1.0 → **1.26:1**.
**Impact:** Inputs without explicit fill rely on the border to communicate the field boundary — fails. Decorative card separators are exempt.
**Fix:** Darken to `hsl(0 0% 70%)` (#B3B3B3) → 3.0:1 for the *informational* border. Keep a lighter `--border-decorative` token at the current value for pure-aesthetic separators. Two tokens, one rule: structure stays identical, only inputs/focus/error borders darken.

---

### 🟠 Medium — degrades but doesn't break

| Ref | Criterion | Where | Fix |
|---|---|---|---|
| S-1 | 2.4.1 Bypass Blocks | `components/layout/PortalShell.tsx` (no skip link); `components/layout/Sidebar.tsx:163` (`<main>` has no id) | Add `<a href="#main-content" class="sr-only focus:not-sr-only ...">Skip to main content</a>` as first child of PortalShell; add `id="main-content"` to `<main>`. |
| S-2 | 2.4.2 Page Titled | `app/(auth)/sign-in/page.tsx`, `app/(portal)/cart/page.tsx`, `app/(portal)/account/page.tsx`, `app/(portal)/catalogue/page.tsx`, `app/(portal)/catalogue/[productId]/page.tsx`, `app/(portal)/checkout/page.tsx`, `app/(portal)/proofs/page.tsx`, `app/(portal)/my-collections/page.tsx` | Add `export const metadata: Metadata = { title: '...' }`. For PDP use `generateMetadata({ params })` for product-name title. |
| K-3 | 2.4.11 Focus Not Obscured | `components/cart/CartChip.tsx` (fixed top-right) | Add `focus:ring-2 focus:ring-ring focus:ring-offset-2`. Scroll-padding-top on `<html>` if focus could land under the chip on small viewports. |
| K-4 | 2.5.8 Target Size (Minimum) | `components/layout/AccountMenu.tsx:55` (Chevron `h-3 w-3`), `components/shop/FilterSheetTrigger.tsx:33,69` (`h-4 w-4`), `FilterAutoSubmitSelect.tsx` (Check `h-3 w-3`) | Icons can stay small visually; expand the *button* padding to ≥24×24 CSS px (e.g. `p-1.5` on a `h-3 w-3` icon = 24px hit box). |
| F-3 | 1.3.5 Identify Input Purpose | `app/(auth)/request-access/page.tsx:107,112` (email/phone), `components/leavers/CustomerDetailsModal.tsx:18,32` | Add `autoComplete="email"` / `autoComplete="tel"`. |
| F-4 | 3.3.3 Error Suggestion | `components/checkout/CheckoutClient.tsx:213+`, `components/orders/ReorderForm.tsx:113` | Add `aria-describedby="<field>-error"` linking input to its error message. |
| F-5 | 3.3.4 Error Prevention (Legal/Financial) | `components/checkout/CheckoutClient.tsx:350` | Add an explicit "Review & Confirm" step or modal before order POST. The order summary is already on-page; gate the final submit behind a confirm action. |
| F-6 | 2.1.1 / 3.3.2 | `components/leavers/ArtworkUpload.tsx:54–71` | Hidden file input fires from button click — keyboard-OK, but no drag-and-drop fallback. Optional: add `onDrop` + visible drop zone with keyboard alternative announced. |
| C-4 | 1.4.3 Contrast | `--muted-foreground` (`hsl(0 0% 45.1%)`) on `--muted` (`hsl(0 0% 96.1%)`) — **4.35:1**, fails 4.5:1 for normal text | Darken `--muted-foreground` to `hsl(0 0% 38%)` (≈5.5:1). |
| C-5 | 1.4.3 | `--destructive-foreground` on `--destructive` — **3.61:1** for text | Lighten foreground to `hsl(0 0% 100%)` (white) on destructive. |

---

## 2. Coverage gaps (didn't audit, need verification)

1. **Live browser + AT testing** — this is a static-source audit. Recommend a NVDA + VoiceOver + keyboard-only smoke pass once code fixes land.
2. **`ProductDetailClient.tsx`, `AccountClient.tsx`** — couldn't confirm `<h1>` per route; one h1 expected.
3. **Dark mode** — no `@media (prefers-color-scheme: dark)` tokens in `globals.css`. Either declare none-supported, or audit when added.
4. **1.4.4 Resize Text @ 200%** — needs browser test. Tailwind defaults usually pass.
5. **1.4.13 Content on Hover/Focus** — no tooltips found in scope. Confirm none exist.
6. **Nested modals** — none exhaustively traced. If `QuoteBuilder` opens `CustomerDetailsModal`, focus return path is undefined.
7. **Filter components keyboard behaviour** — `FilterAutoSubmitSelect`/`Checkbox` aria-label is set; full keyboard interaction not traced.
8. **Checkout payment flow** — if Stripe/payment iframe is added, accessibility delegates to provider; verify keyboard pass-through.

---

## 3. Remediation strategy (aesthetic-preserving)

The fixes split cleanly into three workstreams. None require a redesign.

### Phase 1 — Invisible wins (½ day)
Token + ARIA changes. Zero visual diff for sighted users.

- [ ] Add skip link to `PortalShell.tsx` (visible on focus only).
- [ ] Add `id="main-content"` to `<main>` in `Sidebar.tsx`.
- [ ] Add `metadata` exports to 8 routes listed in S-2.
- [ ] Add `role="alert"` to error containers in sign-in, invite-accept, ReorderForm, ArtworkUpload.
- [ ] Replace `alert()` in `ArtworkUpload.tsx:36` with inline `role="alert"`.
- [ ] Add `autoComplete` to email/phone fields in request-access + CustomerDetailsModal.
- [ ] Add `aria-describedby` linking errors to inputs in checkout + ReorderForm.
- [ ] Replace clickable `<div>` backdrops with `<button>` or add `role="button" tabindex={0} onKeyDown`.

### Phase 2 — Token nudges (1–2 hours)
Tiny visual diff. All token edits in `app/globals.css` only.

- [ ] **C-1** — Split brand yellow into `--color-brand-yellow` (background, current pale value) + `--color-brand-yellow-text` (text token, darker). Audit usages and pick the right token per surface.
- [ ] **C-2** — Switch `ProductionProgressBar` completed-state to yellow-on-charcoal or white-on-blue.
- [ ] **C-3** — Split border into `--border` (informational, darker, ≥3:1) + `--border-decorative` (current). Replace `border-border` with `border-border-decorative` on aesthetic separators (cards, list dividers).
- [ ] **C-4** — Darken `--muted-foreground` to `hsl(0 0% 38%)`.
- [ ] **C-5** — Confirm `--destructive-foreground` is white.
- [ ] **K-4** — Bump icon-button hit boxes to ≥24×24 (padding, not icon size).

### Phase 3 — Behavioural fixes (1 day)
The custom-widget pile. This is where the time goes.

**Recommendation:** Adopt `@radix-ui/react-dialog`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-toggle-group`. They are unstyled (no aesthetic lock-in), drop into the existing Tailwind setup, and remove 90% of the keyboard/focus burden across all current and future modals/menus/pickers. Bundle cost ≈ 25–40 kB gzip for what's used here.

- [ ] **Modals** — Migrate `RequestReorderModal`, `CustomerDetailsModal`, `QuoteBuilder` design picker to Radix Dialog. Inherit focus trap, return-focus, Esc, `aria-modal`, scroll lock for free.
- [ ] **Variant/swatch pickers** — Replace `VariantPicker`, `DecorationSwatchPicker`, `VariantlessSizeGrid` with Radix Toggle Group (roving tabindex + arrow keys built in).
- [ ] **Product image gallery** — Add arrow-key handlers (ArrowLeft/Right cycles thumbs) — Radix Tabs works here, or roll roving tabindex.
- [ ] **F-2** — Add email-code fallback to reset-password + request-access, or pull hCaptcha and rate-limit server-side.
- [ ] **F-5** — Add checkout confirm-step (modal or `/checkout/review` route between cart and submit).

### Phase 4 — Verify (½ day)
- [ ] Run axe-core via `@axe-core/playwright` in CI on key flows (sign-in → catalogue → PDP → cart → checkout → confirmation).
- [ ] Manual keyboard-only run-through of the same flow.
- [ ] NVDA pass on Windows; VoiceOver pass on macOS (or Mac/Safari delegated).
- [ ] Zoom-to-200% smoke test (1.4.4) + text-spacing override test (1.4.12) via a Stylish/userstyle injection.

### Phase 5 — Hold the line (ongoing)
- [ ] Add `eslint-plugin-jsx-a11y` (already comes with `eslint-config-next`, confirm it's active in `eslint.config.mjs`).
- [ ] Add an axe-core check to the existing Vitest setup for component-level smoke.
- [ ] One-page ADR or doc note: "Custom interactive widgets must use Radix primitives. PRs introducing hand-rolled dialogs/menus/pickers will be rejected." Prevents regression.

---

## 4. Effort & risk

| Phase | Effort | Risk to aesthetic | Risk to schedule |
|---|---|---|---|
| 1 — Invisible wins | ½ day | None | None |
| 2 — Token nudges | 1–2 hrs | Tiny — borders slightly darker, yellow text reads as a different shade in 2-3 places | Low |
| 3 — Behavioural fixes | 1 day | None if Radix adopted; modals/pickers re-render with identical Tailwind classes | Medium — needs care on `QuoteBuilder` which is complex |
| 4 — Verify | ½ day | None | Low |
| 5 — Hold the line | ongoing | None | None |

**Total: ~2 days to AA-clean** (subject to one decision: Radix adoption vs hand-rolling each widget fix).

---

## 5. Decisions (locked 2026-05-15)

1. **Radix adopted.** Use `@radix-ui/react-dialog`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-toggle-group` for all modal / menu / picker rework in Phase 3.
2. **hCaptcha — Option A.** Add an email-code fallback to `reset-password` and `request-access`. hCaptcha stays as the primary path; the email-code route is the accessible alternative for 3.3.8.
3. **Checkout — Option B.** Add a separate `/checkout/review` route sitting between cart and submit. Submit button on `/checkout` now navigates to the review route; review route holds the final POST.
4. **Brand yellow — Option A + foreground rule.** Split into `--color-brand-yellow` (current pale, background-only) and `--color-brand-yellow-text` (darker, ≈`#A4D200`). **Yellow is never used as text.** Existing modals/cards/badges currently rendering yellow text on light surfaces must switch to a contrasting foreground (`--foreground` / charcoal) — find-and-fix sweep required in Phase 2.

---

## 6. References

- WCAG 2.2 standard: https://www.w3.org/TR/WCAG22/
- WCAG 2.2 "What's New": https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/
- axe-core rules mapped to WCAG: https://dequeuniversity.com/rules/axe/
- Radix Primitives accessibility: https://www.radix-ui.com/primitives/docs/overview/accessibility

---

*Audit conducted via static code analysis only. Live browser + assistive-tech verification recommended before issuing an accessibility statement.*
