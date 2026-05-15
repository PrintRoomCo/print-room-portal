# Sprint: WCAG 2.2 AA remediation — print-room-portal

**Date:** 2026-05-15
**Branch:** `feat/wcag-aa-remediation` (25 commits, not yet pushed)
**Owner:** Jamie
**For:** Jon (decision on push + open PR)

---

## What changed

Five-phase remediation across the customer portal:

| Phase | Scope | Outcome |
|-------|-------|---------|
| **1. Invisible wins** | Skip-link, page titles, `role="alert"`, `autoComplete`, `aria-describedby` | No visual diff for sighted users; full keyboard + screen-reader support added |
| **2. Token nudges** | Split `--border` and `--color-brand-yellow` tokens; darkened `--muted-foreground`; focus-visible ring on CartChip; icon hit-boxes ≥24×24 | Contrast meets AA on inputs, structural borders, and muted copy. Pale brand yellow now banned as text colour (background-only). |
| **3. Behavioural fixes** | Migrated 8 hand-rolled modals to Radix Dialog; VariantPicker/DecorationSwatchPicker/VariantlessSizeGrid to Radix ToggleGroup; AccountMenu to Radix DropdownMenu; ProductImageGallery gets arrow-key nav; email-code fallback on `/reset-password` and `/request-access`; new `/checkout/review` confirm step | All custom interactives now ship with focus trap, return-focus, Esc-to-close, ARIA roles for free |
| **4. Verification** | `vitest-axe` smoke suite + manual smoke log template | Caught one real Radix quirk (redundant `aria-pressed` on toggle items) on first run |
| **5. Hold-the-line** | `eslint-plugin-jsx-a11y` on warn (baseline 73 → 200); ADR locking Radix as the policy | New regressions surface in CI; new modals/menus must use Radix or raise an explicit PR exception |

---

## Why this sprint

Source audit: `docs/wcag-2.2-aa-audit-2026-05-15.md`. Headline findings before
this work:

- 8 modals had no focus trap, no return-focus, no Escape close. Click-outside
  was wired via raw `onClick` on a backdrop div.
- 3 pickers had no keyboard navigation (arrow keys did nothing).
- `AccountMenu` was a stateful toggle without `aria-haspopup` or arrow-key
  item navigation.
- Multiple structural borders + body copy failed 4.5:1 contrast.
- Reset-password and request-access were captcha-gated with no AT-friendly
  alternative — a hard block for users on assistive tech.

Compliance risk aside, this is the kind of polish that quietly costs the brand
trust with corporate buyers who run procurement checks against AA. The All
Blacks integration is the immediate forcing function.

---

## How to verify

- **Automated:** `npm test` → 54/54 green, including the new `axe-smoke` suite
  in `components/__tests__/axe-smoke.test.tsx`.
- **Lint:** `npm run lint` → 0 errors, 200 warnings (under the new ceiling).
- **Build:** `npm run build` → 28 static pages prerender cleanly.
- **Manual:** walk the checklist in
  `docs/wcag-2.2-aa-manual-test-log-2026-05-15.md` — keyboard-only smoke, 200%
  zoom, and the WCAG 1.4.12 text-spacing override. This is the row that still
  needs human eyes before merge.

---

## Decisions Jon already signed off on (audit §5)

1. **Adopt Radix** for Dialog / DropdownMenu / ToggleGroup. Locked in ADR
   `docs/adr/2026-05-15-wcag-radix-policy.md`.
2. **hCaptcha Option A** — email-code fallback on `/reset-password` and
   captcha-free fallback on `/request-access`, both gated by Supabase OTP +
   server-side rate-limit.
3. **Checkout Option B** — separate `/checkout/review` confirm route between
   the form and the order POST.
4. **Brand yellow Option A** — split into a background-only `--color-brand-yellow`
   and a new darker `--color-brand-yellow-strong` for any future foreground
   need. Pale yellow is now banned as text colour.

No new decisions needed from Jon.

---

## Gotchas (UX shifts users will notice)

- **New `/checkout/review` step.** Submit on `/checkout` now navigates to a
  read-only summary; the actual order POST fires from the review page's
  "Confirm & place order" button. This is the only user-visible behavioural
  shift in the sprint. Manual smoke row 1.11–1.13 walks it.
- **Modal aesthetic preserved.** Radix migrations reuse the existing
  `glass-modal-backdrop` / `glass-modal-content` Tailwind classes on
  `Dialog.Overlay` / `Dialog.Content` — no visual diff.
- **Lint baseline jumped 73 → 200.** Pre-existing `jsx-a11y` violations are
  visible as warnings; Strategy A cleanup is a follow-up sprint per the
  existing TODOs in `eslint.config.mjs`.

---

## What I need from Jon

Are you happy for me to push `feat/wcag-aa-remediation` and open the PR, or
would you like to walk the manual smoke log together first?
