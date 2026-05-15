# WCAG 2.2 AA — Manual Smoke Test Log

**Date:** 2026-05-15
**Branch:** `feat/wcag-aa-remediation`
**Tester:** Jamie
**Browser:** Chrome / Firefox / Safari (note version)

This log captures the human-driven verifications that automated tests can't cover:
keyboard-only navigation, browser zoom, and forced text-spacing. Tick each row as
you walk it; jot a note for anything that snags.

---

## 1. Keyboard-only walk (no mouse)

For each row: Tab through the flow start-to-finish using only the keyboard. Note
the first focused element, any unreachable controls, and any focus traps.

| # | Flow | Pass / Fail | Notes |
|---|------|-------------|-------|
| 1.1 | `/sign-in` → submit credentials → land on `/welcome` | | |
| 1.2 | `/welcome` → sidebar nav to `/catalogue` | | |
| 1.3 | `/catalogue` → arrow-key into a product card → product detail | | |
| 1.4 | Product detail → arrow-key through `VariantPicker` colour swatches | | |
| 1.5 | Product detail → arrow-key through size grid | | |
| 1.6 | Product detail → arrow-key through `ProductImageGallery` thumbnails | | |
| 1.7 | Add to cart (Enter on the "Add" button) | | |
| 1.8 | Tab to CartChip → Enter opens `/cart` | | |
| 1.9 | `/cart` → Tab to "Checkout" → `/checkout` | | |
| 1.10 | `/checkout` → fill custom address (Tab between fields, errors via `aria-describedby` announce) | | |
| 1.11 | `/checkout` → Submit → land on `/checkout/review` | | |
| 1.12 | `/checkout/review` → "Back to edit" returns to `/checkout` with state preserved | | |
| 1.13 | `/checkout/review` → "Confirm & place order" → success page | | |
| 1.14 | TopBar → `AccountMenu` opens with Enter; arrow keys move between items; Esc closes; focus returns to trigger | | |
| 1.15 | Sidebar drawer → opens, Tab cycles within, Esc closes, focus returns to trigger | | |
| 1.16 | `/reset-password` → "Verify via email code instead" → email-code fallback flow completes | | |
| 1.17 | `/request-access` → captcha-free fallback submits successfully | | |
| 1.18 | Skip-to-content link appears as first Tab from any portal page; Enter jumps focus to `#main-content` | | |
| 1.19 | All Radix Dialogs (CustomerDetailsModal, RequestReorderModal, QuoteBuilder design picker, my-collections × 4, AccountClient location modal, JobTrackerOrderCard reorder modal, StandardDesignPicker): Esc closes, focus returns to opener, click-outside overlay closes, focus trapped inside | | |

---

## 2. Browser zoom 200%

DevTools → Settings → Zoom → 200%, OR Ctrl/Cmd-+ four times. Walk the same critical
flows above. Log any horizontal scroll, overlapping content, or cut-off interactive
controls.

| Flow | Pass / Fail | Notes |
|------|-------------|-------|
| `/catalogue` grid | | |
| Product detail (image + buy box) | | |
| `/cart` line items | | |
| `/checkout` form + sidebar summary | | |
| `/checkout/review` summary | | |
| Sidebar nav at narrow viewport | | |
| Modals (any one Radix Dialog) | | |
| CartChip floating position doesn't obscure focused controls | | |

---

## 3. Text-spacing override (WCAG 1.4.12)

DevTools → Sources → Snippets → New snippet → paste:

```css
* {
  line-height: 1.5 !important;
  letter-spacing: 0.12em !important;
  word-spacing: 0.16em !important;
}
p { margin-bottom: 2em !important; }
```

Run on each route. Verify nothing breaks (clipped text, overlapping rows, lost
controls).

| Route | Pass / Fail | Notes |
|-------|-------------|-------|
| `/sign-in` | | |
| `/welcome` | | |
| `/catalogue` | | |
| Product detail | | |
| `/cart` | | |
| `/checkout` | | |
| `/checkout/review` | | |
| `/account` | | |
| `/proofs` | | |
| `/my-collections` | | |
| `/order-tracker` | | |

---

## 4. Findings summary

After all rows above are walked, paste a short summary here:

- **Blocking issues:** _(any failure that breaks AA — file follow-up tasks)_
- **Polish opportunities:** _(non-blocking — capture for backlog)_
- **Surprises / regressions:** _(behaviour that changed unexpectedly vs. pre-WCAG branch)_

---

## 5. Sign-off

- [ ] All rows green or with logged follow-ups
- [ ] Findings summary completed
- [ ] Sprint doc updated with any blockers before opening PR
