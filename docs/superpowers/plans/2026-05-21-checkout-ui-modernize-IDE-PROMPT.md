# Checkout UI modernize — tier pill + per-line inventory toggle — IDE prompt

Paste the block below into a fresh Claude Code session.

**Background:** Two coupled UI changes on the customer-portal checkout page.

1. **Tier pill polish.** The "Catalogue pricing" pill on checkout (rendered by `components/pricing/TierBadge.tsx`, currently `border-[rgb(var(--color-brand-blue))]/20 bg-[rgb(var(--color-brand-blue))]/10 text-[rgb(var(--color-brand-blue))]`) reads as a brand-blue brand-stamp. Should match the more refined oem.care aesthetic already shipped on the staff portal's `/products` and `/catalogues` pages (branch `feat/oem-topbar-port-products-catalogues`, sprint `2026-05-18`). Flatter, lighter, more neutral.
2. **Per-line "Add to my inventory" toggle.** Today it's a single order-level checkbox in `CheckoutClient.tsx` (`routeToInventory` state, lines ~245–272 post-2026-05-21 commit `bfa6e6b`). Move to a small toggle per cart line on the checkout page, with a master "Add all to my inventory" toggle bottom-right of the line list. **Plus:** the cart drawer + ShipToRow keeps its existing inventory-badge UI; this prompt is checkout-only.

Working directory (no worktrees — Jamie's standing instruction):
- `C:/Users/MSI/Documents/Projects/print-room-portal` (base: `main`)

Branch:
- `feat/checkout-ui-modernize-tier-pill-and-per-line-inventory`

DO NOT work on the base branch. NO git worktrees.

---

## Pre-flight decision Jamie needs to confirm BEFORE Slice B

The per-line inventory toggle has an architectural fork. **Don't assume — ask Jamie first.**

> **Q1: What does the per-line toggle mean server-side?**
>
> Context: the `Mixed-intent order split Phase 2` work was implemented earlier and reverted on commit `18cdb95` (auto-pushed to main without PR — i.e. urgent rollback). That branch tried to make the server accept mixed-intent (some lines to customer, some to inventory) by splitting one cart into two orders at submit. It didn't survive.
>
> Three options for this sprint:
>
> - **A. UI-only, derived global intent (recommended default).** Per-line checkboxes are visual affordances. The submit payload still carries a single `intent` value derived as: all per-line checkboxes ticked → `intent: 'inventory'`; none ticked → `intent: 'customer'`; mixed → disable the submit button and show a banner ("All lines must be the same route — use Add all to my inventory or untick all"). Zero server change, no schema change, mirrors today's behaviour. Master "Add all" toggle simply checks/unchecks every per-line box.
> - **B. Full mixed-intent (re-open the reverted path).** Server accepts per-line intent. `submit_b2b_order` RPC needs the mixed-intent split logic back. Out of scope of this prompt — would require its own spec + plan.
> - **C. Per-line UI, server-side aggregation that picks the dominant intent.** Hybrid; not recommended (confusing UX).
>
> **Default if Jamie says "as recommended":** A. If Jamie picks B, STOP and tell him this needs a separate spec — the reverted Phase 2 commit is the starting point to understand what broke.

Slice A (the pill polish) is independent and can ship regardless of which option Jamie picks.

---

You are implementing the checkout UI modernize sprint.

**Reference surfaces for the oem.care aesthetic** (read once, in the staff portal repo):
- `print-room-staff-portal/src/app/(portal)/products/page.tsx` — the OEM-port reference
- `print-room-staff-portal/src/app/(portal)/catalogues/page.tsx` — sibling reference
- Project memory `project_staff_portal_polish_spec_set.md` (2026-05-18) — design directives for the OEM port

**Touch points (customer portal):**
- `components/pricing/TierBadge.tsx` — the pill component
- `components/checkout/CheckoutClient.tsx` — the order-level inventory toggle to retire + the new per-line + master-all UI to add
- `components/checkout/ShipToRow.tsx` — per-line render; add the per-line inventory toggle here OR in a parallel new component
- `lib/cart/types.ts` — confirm `CartLine` shape (it already carries `fulfilmentType: 'stocked' | 'make_to_stock'` per the PDP toggle; the new per-line "send to inventory" choice is a separate concern — see Decision below)

**Approach:** Use the `frontend-design` skill for visual choices. Use `superpowers:subagent-driven-development` if you want to split Slices A and B across two subagents — but they're small enough to do in one session.

---

## Slice A — Tier pill polish

**Goal:** TierBadge component renders in the new aesthetic without changing any consumer call-site. PDP, cart, and checkout all pick up the new look automatically.

### Visual brief

- **Drop the brand-blue tint as the default colour.** Neutral palette baseline (subtle neutral border, near-white or very pale tinted background, gray-800 text).
- **Mode marker via a small leading dot or icon**, not by tinting the whole pill. Catalogue mode = neutral dot; volume-pricing mode (if `pricingMode === 'tier'` or whatever the existing variants are — check the component's prop) = small pricing-up icon or coloured dot.
- **Tighter padding, finer border, smaller text** — the existing pill at `text-xs font-medium px-2.5 py-0.5` is already small; the goal is *cleaner*, not smaller. Possibly slightly larger and lighter.
- **No tabular-nums or special font.** Match the typography choices already used in the staff portal's OEM-ported badges.
- **Hover/focus** — none needed (it's informational, not interactive).

### Files

- `components/pricing/TierBadge.tsx` — rewrite the component body. Keep the existing prop signature exactly (`label: string`, `pricingMode: 'catalogue' | ...`). No consumer changes.
- Verify in browser at: `/checkout` (the existing usage), `/shop/[productId]` (PDP), and the cart drawer if it surfaces TierBadge.

### Test gate

- `pnpm tsc --noEmit` clean.
- Visual smoke on the three surfaces above — pill renders, label is correct, mode marker (if any) differentiates the modes.

### Commit

`refactor(pricing): modernize TierBadge to match OEM port aesthetic`

---

## Slice B — Per-line "Add to my inventory" toggle + master "Add all"

**Default-recommended interpretation: Option A** (UI-only, derived global intent).

### Scope under Option A

1. **Per-line toggle on the checkout page.** Add a small checkbox (or modern toggle switch) at the right edge of each line in the `Shipping — per line` section. Component lives either inside `ShipToRow.tsx` (preferred — colocated with the line UI) or as a sibling row. Label: "Add to my inventory" (short form on small screens: tooltip or icon-only with `aria-label`). State lives in the parent `CheckoutClient.tsx` as `Record<lineId, boolean>`.
2. **Master "Add all to my inventory" toggle** bottom-right of the line list, between the line list and the "Required by / Notes" section. Visually distinct from the per-line toggles (slightly larger, bolder label). Clicking it checks/unchecks every per-line box.
3. **Derived order-level `intent`.** Replace the existing standalone `routeToInventory` state with a computed `intent`:
   - All per-line ticks ON → `intent: 'inventory'`
   - All per-line ticks OFF → `intent: 'customer'`
   - Mixed → `intent: null` (treated as a submit-blocker)
4. **Retire the existing order-level checkbox section** (lines ~245–272 in current `CheckoutClient.tsx`). The "Add to my inventory" + amber-warning banner block goes. Its auto-engage-when-make-to-stock-lines-exist behaviour ports forward as: when `hasMakeToStockLines === true`, the per-line ticks for those specific lines start checked.
5. **Mixed-state UX.** When the per-line ticks are mixed (some on, some off), disable the "Review order" button and show a small banner above it: "All lines must go to the same destination — either tick 'Add all to my inventory' or untick all". The banner uses the same styling as the existing `mixedCustom` error.
6. **Inventory-mode replaces the per-line ship-to UI** (already shipped in `bfa6e6b` — the warehouse panel). That behaviour stays: when `intent === 'inventory'`, render the warehouse panel and hide per-line `ShipToRow` ship-to dropdowns. The new per-line *inventory toggle* itself stays visible inside the warehouse panel so customers can untick lines back to customer-route.

### Modern aesthetic constraints for the toggle

- **Toggle switch over checkbox.** Use a small switch component (e.g. Radix Switch primitive or hand-rolled) — flat, no shadows, ~36×20px or similar. Match the OEM port's input style.
- **Inline with the line content**, not in a separate column. Right-aligned, vertical-centered with the line label.
- **Disabled state** when the line is `fulfilmentType === 'make_to_stock'` — toggle is forced ON and shows a small "(over current stock — production required)" sub-label below.
- **Master "Add all" sits in a card** matching the existing rounded `bg-white p-7 md:p-8` style of other checkout sections.

### Files

- `components/checkout/CheckoutClient.tsx` — state refactor (`Record<lineId, boolean>` replaces `routeToInventory: boolean`), derived `intent`, mixed-state submit guard, retire the old section.
- `components/checkout/ShipToRow.tsx` — add the per-line toggle column. New prop `inventoryEnabled: boolean` + `onInventoryChange: (next: boolean) => void` + `disabled: boolean` (for the make-to-stock forced-on case).
- New component `components/checkout/AddAllToInventoryToggle.tsx` (or inline in CheckoutClient — judgement call by the subagent based on file length). Renders the master toggle in its own card.
- No server changes. `submit_b2b_order` RPC and `lib/checkout/submit.ts` payload shape stay identical; `intent` is still a single value at submit time.
- No schema changes.

### Test gate

- `pnpm tsc --noEmit` clean.
- Existing checkout tests still pass (pre-existing CheckoutClient.review-redirect.test.tsx stays broken on the CurrencyProvider mock — DO NOT touch it).
- **Manual smoke against dev:**
  1. Submit an order with all lines ticked for inventory → submit succeeds, server gets `intent: 'inventory'`, warehouse panel showed correctly.
  2. Submit an order with no lines ticked → `intent: 'customer'`, per-line ship-to dropdowns shown.
  3. Tick *some* lines → submit button disabled, mixed-state banner shows.
  4. Make-to-stock line forces its own toggle ON and shows the sub-label.

### Commit

`feat(checkout): per-line "Add to my inventory" + master "Add all" with modern toggle UI`

---

## Constraints (apply to both slices)

- **No server-intent shape change.** The submit payload still carries one `intent: 'customer' | 'inventory'`. Mixed-intent server work is out of scope (Decision Q1).
- **No cart-drawer changes.** The chip at top-right + the drawer's inventory badge UI stay exactly as they are today.
- **No new env vars, no new dependencies.** If a toggle-switch primitive isn't already in the repo, hand-roll it — Radix UI is already installed (Dialog used in CartDrawer) so prefer `@radix-ui/react-switch` if needed; check `package.json` first.
- **WCAG AA.** Per the `feat/wcag-aa-remediation` sprint (memory `project_wcag_aa_remediation_2026_05_15`). Every toggle needs an accessible name (`aria-label` or labelled `<label>`), focus ring, keyboard activation. The mixed-state banner needs `role="alert"`.
- **No worktrees.** One branch, work in main repo.

---

## Stop conditions

- **Stop** if Jamie picks Option B for Decision Q1 — that needs its own spec.
- **Stop** if a subagent proposes server-side `intent` changes "to keep the UI cleaner". The architectural premise of this sprint is UI-only.
- **Stop** if a subagent proposes touching `submit_b2b_order` RPC or the `lib/checkout/submit.ts` payload shape — both are off-limits.
- **Stop** if the new toggle UI breaks the existing buyer-role lock-down (`isBuyer === true` currently forces a single store and hides the custom-address path; the new toggle must respect the same lock — buyers can still inventory-route their own ticks, but the UI must not let buyers escape `defaultStoreId` via the toggle).

---

## Repo facts the subagent needs

- **Next.js 16** customer portal. `pnpm` package manager. Default branch `main`. Verification: `pnpm tsc --noEmit` + `pnpm vitest run components/checkout` (targeted) + manual browser smoke.
- **Buyer auth:** `requireB2BCustomer()` from `@/lib/checkout/server`. The `isBuyer` + `lockToBuyerDefault` state in `CheckoutClient.tsx` enforces buyer-scope; the new toggle must coexist.
- **Cart state:** `useCart()` from `@/components/cart/useCart`. CartLine type at `lib/cart/types.ts`. Lines already carry `fulfilmentType: 'stocked' | 'make_to_stock'`.
- **Existing inventory state in CheckoutClient:** see commit `bfa6e6b` for the current `routeToInventory` toggle, warehouse panel, and `inventoryMode` gating of mixedCustom + customIncomplete.
- **OEM port aesthetic source-of-truth:** `print-room-staff-portal/src/app/(portal)/{products,catalogues}/page.tsx`. Branch `feat/oem-topbar-port-products-catalogues` in the staff repo.
- **Commit conventions:** `feat` for the per-line toggle, `refactor` for the pill rewrite.

---

## Review checkpoints

After Slice A:
```bash
git show HEAD -- components/pricing/TierBadge.tsx
```
Read the diff. Confirm:
- Prop signature unchanged.
- Component still exports the same named export.
- No tailwind classes referencing `--color-brand-blue` directly — should use neutral tokens.

After Slice B:
```bash
git show HEAD -- components/checkout/CheckoutClient.tsx components/checkout/ShipToRow.tsx
```
Confirm:
- `routeToInventory` (the old single boolean) is gone — replaced by the per-line record.
- `intent` is derived, not stored as separate state.
- Submit payload at the `proceedToReview` call site still sends one `intent: 'customer' | 'inventory'` value.
- Mixed-state path has `role="alert"` banner + disabled submit button.

```bash
grep -rn "routeToInventory" components/checkout/
```
Should return zero hits.

```bash
grep -rn "aria-label\|<label" components/checkout/ShipToRow.tsx components/checkout/AddAllToInventoryToggle.tsx 2>/dev/null
```
Every new toggle has an accessible name.

---

## Final handoff (after both slices)

- `git log --oneline -4` showing the two slice commits (and any minor fixup commits).
- `pnpm tsc --noEmit` clean.
- Targeted vitest clean.
- Browser smoke on `/checkout` walking through the four scenarios in Slice B's test gate.
- `git push -u origin feat/checkout-ui-modernize-tier-pill-and-per-line-inventory`
- Do **not** open a PR — Jamie owns the PR copy.

Then tell Jamie:

> "Checkout UI modernize done. Branch pushed. TierBadge rewritten to neutral palette; per-line + master 'Add all to my inventory' toggles ship with derived single-intent server payload (Option A). Manual smoke at /checkout walks all four states (all-on, all-off, mixed-blocker, make-to-stock-forced-on)."

Begin by asking Jamie to confirm Q1 (Option A vs B vs C), then dispatch Slice A while waiting for the answer.
