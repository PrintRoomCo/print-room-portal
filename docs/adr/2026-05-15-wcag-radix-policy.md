# ADR: Custom interactive widgets must use Radix primitives

**Date:** 2026-05-15
**Status:** Accepted
**Sprint context:** WCAG 2.2 AA remediation
**Companion docs:**
- Audit: `docs/wcag-2.2-aa-audit-2026-05-15.md`
- Plan: `~/.claude/plans/2026-05-15-wcag-aa-remediation-plan.md`
- Manual smoke log: `docs/wcag-2.2-aa-manual-test-log-2026-05-15.md`

---

## Context

Before this sprint, `print-room-portal` had multiple WCAG 2.2 AA failures across
hand-rolled interactive widgets:

- Modals built as plain `<div>` overlays with click-outside via `onClick` on a
  backdrop — no focus trap, no return-focus, no Escape handling, no
  `aria-modal`, no `role="dialog"`.
- Variant pickers / size grids as ad-hoc button rows — no arrow-key navigation,
  no roving `tabindex`, mixed `aria-pressed` + radio semantics.
- Account menu as a stateful `<button>` toggling a `<div>` — no `aria-haspopup`,
  no arrow-key item navigation, no return-focus.
- Product gallery as `role="tab"` markup without keyboard handling.

These are all problems with established, well-tested solutions. The total
remediation effort (Tasks 3.1–3.9 + 3.13) was ~1 day. The cost of preventing
recurrence is effectively zero, provided new code uses Radix from the start.

## Decision

Any new interactive widget that has an established Radix primitive **MUST** use
the Radix primitive. Specifically:

| Pattern | Radix primitive |
|---------|-----------------|
| Modal / dialog / drawer / confirm | `@radix-ui/react-dialog` |
| Dropdown / menu / overflow / kebab | `@radix-ui/react-dropdown-menu` |
| Variant picker / size grid / segmented selector | `@radix-ui/react-toggle-group` |
| Tabs (tablist + tabpanel) | `@radix-ui/react-tabs` |
| Tooltips on icon-only buttons | `@radix-ui/react-tooltip` |
| Popover (non-menu floating panel) | `@radix-ui/react-popover` |
| Select (single-value picker with many options) | `@radix-ui/react-select` |

PRs introducing hand-rolled equivalents will be rejected during review.

## Exceptions

Where the Radix primitive cannot be styled to meet a design constraint **without
forking the primitive's structure**, raise the exception explicitly in the PR
description:

- Name the constraint that Radix can't satisfy.
- Demonstrate keyboard handling, focus trap (where applicable), and ARIA roles
  manually.
- Reference this ADR as the policy being deviated from.

Silent forks are not allowed. "I didn't know Radix had this" is not an
exception.

## Consequences

**Bundle size:** Adding all of Dialog + DropdownMenu + ToggleGroup increased
the production bundle by ~30 KB gzip. Tabs / Tooltip / Popover / Select will
add similar increments only when first introduced. Acceptable cost given the
volume of accessibility wiring inherited for free.

**Learning curve:** The pattern is identical across primitives (`Root` →
`Trigger` → `Portal` → `Content`). Examples are in
`components/shop/RequestReorderModal.tsx`, `components/layout/AccountMenu.tsx`,
and `components/shop/VariantPicker.tsx`.

**Forward leverage:** Radix patches accessibility regressions on our behalf.
Recent examples relevant to this codebase: `aria-activedescendant` handling in
ToggleGroup, scrollbar gutter handling in Dialog on iOS, `display: none`
handling in Portal under Suspense.

**Migration debt:** All known custom interactives are migrated as part of this
sprint. The lint baseline (`eslint-plugin-jsx-a11y` on warn) catches new
regressions; the axe-smoke suite catches role/ARIA contradictions at unit-test
time.

## Related

- `eslint-plugin-jsx-a11y` was added to the lint config on warn-level
  (Strategy A — sprint-by-sprint cleanup). New warnings should still be fixed
  before merging unless explicitly waived.
- The `vitest-axe` smoke suite in `components/__tests__/axe-smoke.test.tsx`
  is the first defence; expand it whenever a new shared interactive
  component lands.
