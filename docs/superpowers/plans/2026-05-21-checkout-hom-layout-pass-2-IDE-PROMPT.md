# Checkout — House of Miracles layout alignment, pass 2

**Background:** First pass (`db06901`) brought the checkout closer to the House of Miracles reference — neutral TierBadge, flat divider rows, in-section "Add all to my inventory" pill, OEM black/85 submit. This pass closes the remaining visual gap.

What still reads as "B2B form" vs the HoM editorial feel:

1. **No sticky bottom CTA bar.** Reference has a full-width fixed bar — "Cart: N items" left + a pill "Check Out" right. Today the Review button is just a right-floated button after the pricing card.
2. **Line rows are still cramped.** Reference uses a generous grid — large square thumbnail, name + sub-attr lines, variant column, meta column, right-aligned price. Today's row is image + name (no real columns) + ship-to + inventory toggle.
3. **Total row is buried** in a separate `rounded-[32px]` pricing card with a "Pricing for [TierBadge]" header. Reference has a single bold "Total | $60.00" line sitting directly under the items, with a tiny subtext below ("Tax and shipping applied at checkout").
4. **Section-card chrome is heavy.** Multiple rounded-32 white panels stacked together → bento-card vibe rather than the airy single-column ref.
5. **Thumbnail is too small** (`h-12 w-12`) — ref looks ~h-20 w-20.

Working directory (no worktrees — Jamie's standing rule):
- `C:/Users/MSI/Documents/Projects/print-room-portal` (base: `main`)

Branch:
- `feat/checkout-hom-layout-pass-2`

**DO NOT work on the base branch.** NO git worktrees. Push guard was removed on 2026-05-21 — Jamie can self-merge, but you still ship on a branch.

---

## Pre-flight decisions Jamie needs to confirm

Three forks. **Don't assume — ask first**, then dispatch the independent slices in parallel.

### Q1 — Sticky bottom CTA bar (the headline change)

The HoM reference's defining visual signature is the bright orange sticky bar at the bottom of the viewport. We use OEM colourway, not orange.

Three options:

- **A. Yes, sticky bar in OEM black.** Full-width fixed `bottom-0 inset-x-0`, `bg-black/[0.85]` or `bg-gray-900`, white text. Left: `"Cart: N items"` (count + cart total). Right: pill `"Review order"` button (off-white pill, black text). Eats ~72px from the viewport — pages need `pb-[88px]` extra padding to prevent the bar from covering the bottom of the pricing card on short viewports. Existing right-floated Review button **retires** (the sticky bar IS the submit).
- **B. Yes, sticky bar in white with subtle shadow.** Same layout but `bg-white border-t border-gray-200 shadow-[0_-2px_24px_rgba(0,0,0,0.06)]` — softer, less dominant. Pill button is OEM black.
- **C. No sticky bar.** Keep the right-floated Review button. Slice B becomes a no-op; Slices A + C still ship.

**Recommended default:** A — the sticky bar is the strongest single move toward the HoM aesthetic, and OEM black avoids the orange-loud vibe Jamie called out.

### Q2 — Section-card chrome

Today's checkout stacks ~5 rounded-32 white cards (items, master pill no-longer-separate, optional custom address, required-by/notes, pricing). Reference has zero card chrome — it reads as one flowing column.

- **A. Edge-to-edge in the container.** Drop all `rounded-[32px] bg-white p-7 md:p-8` wrappers. Sections are just visual groups separated by spacing + light dividers. Page bg stays `#FAFAFA`, sections sit on it directly.
- **B. Selective — keep items + pricing as cards, drop required-by/notes + custom address.** Items stays as a card to anchor the eye; supporting form sections inline.
- **C. Keep all current cards.**

**Recommended default:** B. Items is the visual centre — keeping it as a single light card matches how the ref groups the line list. Form noise (notes, required-by, custom address) gets less weight.

### Q3 — Total row placement

- **A. Move Total into the bottom of the items card** as a final non-line row (mirrors the ref's "Total | $60.00" sitting beneath the line list). Keep the full PriceBreakdown collapsed into a `<details>` ("Show breakdown") below the Total. TierBadge moves to the items-card header.
- **B. Keep Total in the existing pricing card** but slim it down — drop the "Pricing for [TierBadge]" header line, make Total the visually dominant row, breakdown lines (subtotal, GST, deposit) shrink to `text-xs text-gray-500`.
- **C. Status quo.**

**Recommended default:** A. The ref's signature is the Total sitting directly below the items, not in its own card. Hiding the breakdown behind a disclosure keeps the page calm.

If Jamie says "as recommended": A / B / A.

---

You are implementing the checkout HoM layout pass 2.

**Reference surfaces:**
- The HoM screenshot Jamie shared in the conversation that produced this prompt — the canonical visual target.
- `print-room-staff-portal/src/app/(portal)/products/page.tsx` + `catalogues/page.tsx` — OEM colourway / button shapes already in production.
- Already-shipped first pass: `db06901` (this branch's parent).

**Touch points:**
- `components/checkout/CheckoutClient.tsx` — section structure, sticky bar, page padding-bottom
- `components/checkout/ShipToRow.tsx` — row grid refactor + bigger thumbnail
- `components/checkout/AddAllToInventoryToggle.tsx` — no change expected; stays as the in-section pill
- `components/pricing/PriceBreakdown.tsx` — slim variant for Q3-A or Q3-B
- `app/globals.css` or `tailwind.config.*` — only if `safe-area-inset-bottom` needs to be added to the sticky bar

---

## Slice A — Line-row grid + larger thumbnails (independent, ship first)

**Goal:** Each cart line row reads as an editorial product entry — generous thumbnail, name + sub-attrs (decoration summary), then ship-to / inventory column right-aligned. No per-row borders (already shipped); divider lines stay.

### Visual brief

- **Thumbnail:** `h-20 w-20` (was `h-12 w-12`). `rounded-lg bg-gray-50` stays.
- **Name + attrs column:**
  - Product name: `text-base font-medium text-gray-900` (was truncate-medium 14px).
  - Sub-line 1: `variantLabel` (e.g. "Small", "OS").
  - Sub-line 2: `qty NN` only.
  - Sub-line 3 (only if `line.decorations.length > 0`): "1 decoration" / "N decorations" in `text-xs text-gray-500`. Detailed list lives in the existing CheckoutReviewClient.
- **Right column:**
  - Vertical-stack: ship-to dropdown on top, "Add to inventory" toggle below.
  - When `inventoryMode === true`, hide ship-to dropdown and show only the toggle right-aligned.
  - Toggle keeps Switch primitive + sub-label for `make_to_stock` forced-on state.
- **Row spacing:** `py-5` (was `py-4`). `gap-4` between thumbnail/name and right column. `flex flex-wrap` stays for mobile.

### Files

- `components/checkout/ShipToRow.tsx` — grid refactor. Keep all props identical. The internal layout becomes:
  ```
  <row>
    <thumbnail (h-20 w-20)/>
    <name+attrs column (min-w-0 flex-1)/>
    <right column (vertical-stack: ship-to, toggle)/>
  </row>
  ```

### Test gate

- `pnpm tsc --noEmit` clean.
- Visual: items section at `/checkout` renders 3+ lines with new spacing. Mobile (`<sm`) wraps cleanly — right column slides under name on small screens.

### Commit

`refactor(checkout): line-row grid + bigger thumbnails (HoM pass 2)`

---

## Slice B — Sticky bottom CTA bar (depends on Q1)

**Skip this slice entirely if Jamie picks Q1=C.**

**Goal:** Full-width fixed bar at the bottom of the viewport on the `/checkout` page only (NOT global). Left: cart count + total. Right: "Review order" pill. The bar IS the submit — retires the existing right-floated Review button.

### Scope under Q1=A (OEM black)

- New component `components/checkout/CheckoutCTAStickyBar.tsx`:
  ```tsx
  interface Props {
    itemCount: number
    totalLabel: string         // formatted via useCurrency()
    onSubmit: () => void
    disabled: boolean
    submitting: boolean
    // a11y: needs role="region" aria-label="Checkout actions"
  }
  ```
  - Fixed positioning: `fixed inset-x-0 bottom-0 z-40`.
  - Padding: `px-4 py-4 md:px-6` + `pb-[max(1rem,env(safe-area-inset-bottom))]` for iOS.
  - Background: `bg-gray-900 text-white`.
  - Left content: `<span className="text-sm font-medium">Cart: {itemCount} item{itemCount === 1 ? '' : 's'}</span>` + `<span className="text-base font-semibold">{totalLabel}</span>` (stacked on mobile, inline `md:gap-6` on md+).
  - Right button: pill, `rounded-full bg-white text-gray-900 px-6 py-3 text-sm font-medium hover:bg-gray-100 disabled:opacity-50`.
- `CheckoutClient.tsx`:
  - Drop the existing right-floated Review button at the bottom of the section stack.
  - Render `<CheckoutCTAStickyBar … />` once, right before the closing wrapper.
  - Add `pb-[120px] md:pb-[96px]` to the page container so the bar doesn't cover the pricing card on short viewports.

### Scope under Q1=B (white)

Same as A but:
- Bar bg: `bg-white border-t border-gray-200 shadow-[0_-2px_24px_rgba(0,0,0,0.06)]`.
- Text colour: `text-gray-900`.
- Button: `bg-black/[0.85] text-white hover:bg-black` (OEM black on white).

### Accessibility constraints (apply to both)

- The bar needs `role="region"` + `aria-label="Checkout actions"` so screen readers can land on it.
- The submit button keeps the existing `disabled={!canSubmitOrder}` semantics — mixed-state banner above the items section stays, and the disabled button + banner together tell the user why submit is blocked.
- Focus order: tab from anywhere on the page should reach the sticky button after all form fields.

### Test gate

- `pnpm tsc --noEmit` clean.
- Manual smoke on `/checkout`:
  1. Bar visible on all viewport heights (resize browser, scroll up/down).
  2. Disabled state propagates from `canSubmitOrder`.
  3. Mixed-inventory state → button disabled, banner above items section visible.
  4. iOS safe-area: open Chrome DevTools mobile emulation (iPhone 14 Pro), confirm the bar doesn't sit under the home-indicator area.
  5. Mobile (`<sm`): cart-count + total stack vertically on the left.

### Commit

`feat(checkout): sticky bottom CTA bar in OEM black (HoM pass 2)`

(or `feat(checkout): sticky bottom CTA bar in soft white` for Q1=B)

---

## Slice C — Total-row alignment (depends on Q3)

**Skip if Jamie picks Q3=C.**

### Scope under Q3=A (Total in items card + breakdown disclosure)

- `CheckoutClient.tsx`:
  - Move `<TierBadge …/>` from the pricing card into the items-card header line. Header becomes: `[empty] <TierBadge>` right-aligned at the top of the items card.
  - After the line list AND the master toggle pill, render the Total row inline:
    ```
    <div className="mt-6 flex items-baseline justify-between border-t border-gray-200 pt-5">
      <span className="text-base font-medium text-gray-900">Total</span>
      <span className="text-xl font-medium text-gray-900">{format(breakdown.grossTotal)}</span>
    </div>
    <p className="mt-1 text-xs text-gray-500">incl. GST · billed per account terms</p>
    ```
  - Wrap the existing `<PriceBreakdown />` in a `<details>`:
    ```
    <details className="mt-3">
      <summary className="cursor-pointer select-none text-xs text-gray-500 hover:text-gray-700">Show breakdown</summary>
      <div className="mt-3"><PriceBreakdown ... /></div>
    </details>
    ```
  - **Retire** the separate `<section>` wrapper around the pricing card — the breakdown now lives inside the items section as a disclosure.

### Scope under Q3=B (slim pricing card)

- Drop the "Pricing for [TierBadge]" header line from the pricing card.
- Move TierBadge into the items card header (as above).
- In `PriceBreakdown.tsx`, add a new variant `'checkout-slim'` or update `'checkout-review'`:
  - Total row: `text-xl font-medium text-gray-900`, right-aligned amount, baseline-aligned.
  - Subtotal / GST / deposit rows: `text-xs text-gray-500`, low visual weight.

### Files

- `components/checkout/CheckoutClient.tsx`
- `components/pricing/PriceBreakdown.tsx` (Q3=B only — Q3=A leaves PriceBreakdown untouched and just wraps it in `<details>`)

### Test gate

- `pnpm tsc --noEmit` clean.
- Existing `PriceBreakdown` tests still pass — `pnpm vitest run components/pricing` clean.
- Visual: Total row reads as the dominant line at the bottom of the items section (Q3=A) or pricing section (Q3=B). Breakdown is accessible but secondary.

### Commit

`refactor(checkout): collapse pricing into items section with disclosure (HoM pass 2)`

(or `refactor(checkout): slim pricing card, Total as headline` for Q3=B)

---

## Constraints (apply to all slices)

- **No server / payload changes.** This is pure UI alignment.
- **No new dependencies.** Hand-roll everything. The Switch primitive in `components/ui/Switch.tsx` is already in the repo.
- **WCAG AA stays.** Sticky bar needs `role="region"` + `aria-label`. Disabled button still has discernible text. The `<details>` disclosure is native and keyboard-accessible by default.
- **Buyer lock-down respected.** `isBuyer === true` still hides the inventory toggles entirely (canRouteToInventory gate stays). Sticky bar's Review button respects `canSubmitOrder` exactly like the existing button.
- **No worktrees.** One branch, work in main repo.
- **No commit to main** — feature branch only. (Push guard is gone but the rule still applies.)
- **Mobile-first.** Sticky bar must work on `<sm` viewports without overlapping the iOS home indicator (`env(safe-area-inset-bottom)`).
- **Do NOT touch:** the cart drawer, the cart chip at top-right, the CheckoutReviewClient, the `/checkout/review` step, `lib/checkout/submit.ts`, or any RPC.

---

## Stop conditions

- **Stop** if Jamie picks Q1=C AND Q2=C AND Q3=C — there'd be nothing left to ship; come back and ask what changed.
- **Stop** if a subagent proposes adding a qty stepper or "Remove" link on a checkout row — those are cart-drawer affordances, NOT checkout.
- **Stop** if a subagent proposes changing the page background, the topbar, or anything outside the `<div className="space-y-6">` checkout content area.
- **Stop** if a subagent proposes new state (`useCheckoutLayout`, layout context, etc.) — this is purely styling/JSX restructure.

---

## Repo facts the subagent needs

- **Next.js 16** customer portal. `pnpm`. Default branch `main`. Verify with `pnpm tsc --noEmit` + targeted `pnpm vitest run components/checkout components/pricing`.
- **Sticky-bar viewport:** the checkout page already uses `min-h-screen bg-[#FAFAFA]`. The bar sits above this. iOS safe-area handled via `env(safe-area-inset-bottom)` — Tailwind v3.4+ supports `pb-[max(1rem,env(safe-area-inset-bottom))]` directly.
- **PriceBreakdown variant API:** check `components/pricing/PriceBreakdown.tsx` — the `variant` prop currently includes `'checkout-review'`. Add a new variant rather than mutating the existing one if Q3=B.
- **TierBadge:** already neutral after `b482d92`. No prop changes — only relocation in the JSX tree.
- **Existing tests to not break:** `components/pricing/TierBadge.test.tsx`, `components/checkout/__tests__/CheckoutClient.review-redirect.test.tsx` (latter is pre-existing broken on CurrencyProvider mock — leave it).
- **Commit conventions:** `feat` for the sticky bar (new UI surface), `refactor` for grid + Total moves.

---

## Review checkpoints

After Slice A:
```bash
git show HEAD -- components/checkout/ShipToRow.tsx
```
Confirm:
- Thumbnail is `h-20 w-20`.
- Right column is a vertical-stack flex container with ship-to above toggle.
- No new props; signature identical to pre-slice version.

After Slice B (if Q1 ≠ C):
```bash
git show HEAD -- components/checkout/CheckoutCTAStickyBar.tsx components/checkout/CheckoutClient.tsx
```
Confirm:
- `fixed inset-x-0 bottom-0 z-40` on the bar wrapper.
- `pb-[max(1rem,env(safe-area-inset-bottom))]` present.
- Existing right-floated Review button GONE from CheckoutClient.
- Page container has extra bottom padding (`pb-[120px]` or similar).
- `role="region"` + `aria-label` on the bar.

After Slice C (if Q3 ≠ C):
```bash
git show HEAD -- components/checkout/CheckoutClient.tsx components/pricing/PriceBreakdown.tsx
```
Confirm:
- TierBadge no longer inside `<section>{... PriceBreakdown ...}</section>` block — it's in the items-card header.
- (Q3=A only) `<details>` element wraps PriceBreakdown.
- (Q3=B only) New variant on PriceBreakdown OR slimmed `'checkout-review'` rendering.

```bash
grep -rn "rounded-\[32px\] bg-white" components/checkout/
```
Should return only the items section card (Q2=B) or zero (Q2=A) — verify against Jamie's Q2 pick.

---

## Final handoff (after all opted-in slices)

- `git log --oneline -5` showing the slice commits.
- `pnpm tsc --noEmit` clean.
- Targeted `pnpm vitest run components/checkout components/pricing` clean (modulo the pre-existing CurrencyProvider failure).
- Browser smoke on `/checkout`: walk the four scenarios from the prior prompt's test gate (all-on / all-off / mixed-blocker / make-to-stock-forced-on) on the new layout, plus a viewport-resize check to confirm the sticky bar doesn't overlap content at any height.
- `git push -u origin feat/checkout-hom-layout-pass-2`
- Do **not** open a PR — Jamie owns the PR copy.

Then tell Jamie:

> "HoM checkout layout pass 2 done. Branch pushed. Sticky bottom CTA bar [in/out per Q1] + line-row grid + Total-row alignment [per Q3] shipped. Manual smoke at /checkout walks the same four states on the new layout plus a viewport-resize check on the sticky bar."

Begin by asking Jamie to confirm Q1, Q2, Q3 (or "as recommended" = A/B/A), then dispatch Slice A (independent) while waiting on Q1/Q3 answers.
