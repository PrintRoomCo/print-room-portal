# Cart merge must adopt the incoming pooling identity — IDE PROMPT

**Date:** 2026-08-26
**Repo:** `print-room-portal` (customer portal) — this bug is customer-side only, no schema change, no staff-repo work.
**Cut a branch:** `fix/cart-merge-pooling-identity` off `main` (currently `a0827e5`, in sync with `origin/main`).
**Background reading, in this order:**
1. `docs/2026-08-13-pooled-decoration-pricing.md` — the pooling spec (§5 eligibility, §8 the customer-facing pill).
2. `docs/2026-08-26-pooled-manual-decoration-own-ladder.md` — the manual_final amendment.
3. Commit `a04dd2a` — the sibling fix that already landed. **Read this first; it is the other half of the same defect.**

---

## What is wrong

`CartProvider.addLine` merges a repeat add into the existing cart line by spreading the existing line and refreshing only a hand-picked set of fields. `poolingEnabled` and `catalogueId` are not in that set, so an existing line **never adopts them from the incoming add**.

`components/cart/CartProvider.tsx:194`:

```ts
const merged: CartLine[] = existing
  ? s.lines.map((l) =>
      // Refresh brackets AND decoration brackets from the incoming
      // add — the new PDP fetch is the latest source of truth — and
      // let recomputeProductTierPrices below settle unitPrice across
      // every same-product line at the new total qty. ...
      l === existing
        ? {
            ...l,                                   // <-- stale identity survives
            qty: l.qty + line.qty,
            brackets: line.brackets ?? l.brackets,
            decorations:
              line.decorations && line.decorations.length > 0
                ? line.decorations
                : l.decorations,
            manualDecorationPerUnit:
              line.manualDecorationPerUnit ?? l.manualDecorationPerUnit,
            manualDecorationBrackets:
              line.manualDecorationBrackets ?? l.manualDecorationBrackets,
          }
        : l,
    )
  : [ ...s.lines, { ...line, decorations: line.decorations ?? [], lineId: crypto.randomUUID() } ]
```

The comment above that block already states the governing rule — *"the new PDP fetch is the latest source of truth"*. `poolingEnabled` and `catalogueId` simply were not added when pooling shipped.

### Why it matters

`poolingEnabled` is an **add-time snapshot** of `b2b_catalogues.decoration_pooling_enabled`. So a line added while the catalogue was *not* opted in carries `false` for the life of that line.

The moment an AM switches pooling on for a real customer's catalogue, every customer with that product already in their cart is silently excluded from pooling — `isPoolingLine` returns false, their line neither contributes to nor receives a pool, and they quietly miss the discount the catalogue now advertises. Adding more of the same product does not repair it, because of the merge above. Only removing the line and re-adding does.

Right now the demo catalogue (`4d21bd07-b5f8-4b9a-a71f-fe3e40b51bb6`) is the only one with the flag on, so live blast radius is limited — but this fires the first time pooling is enabled on a real org, which is exactly when nobody will be watching for it.

### Note the merge is reachable

`lineSignature` hashes decorations via `decorationSignature`, which uses **`decorationId` only** (`lib/cart/types.ts:225`) — not price, not brackets, not `poolable`. So a stale line and a fresh PDP add of the same product/variant/decoration set **do** collide and merge. This is not a theoretical path.

---

## Already fixed — do not redo

Commit `a04dd2a` fixed the *other* half: `normalizePersisted` (`lib/cart/normalize.ts`) is an allow-list that rebuilt every line field by field and dropped `catalogueId`, `poolingEnabled`, `poolable`, `manualDecorationPerUnit` and `manualDecorationBrackets` on every page load — then persisted the stripped state back over the good one. That is landed and tested (`lib/cart/__tests__/normalize.test.ts`, 5 tests).

`pooledQty` is deliberately **not** persisted — it is derived from the other lines in the cart, and a stored copy could outlive the cart that produced it. `recomputeProductTierPrices` rebuilds it on hydrate. Keep that decision.

---

## The blocker you must clear first

`components/cart/__tests__/CartProvider.test.tsx` **cannot run at HEAD.** Its `beforeEach` calls `window.localStorage.clear()` and dies with:

```
TypeError: Cannot read properties of undefined (reading 'clear')
```

This is pre-existing — it fails identically on a clean checkout of `main` with no local changes. That file's single existing test (`setFulfilmentType`) has therefore never actually executed.

Diagnosis already done, so don't repeat it:

| Check | Result |
|---|---|
| `jsdom` installed | yes, **25.0.1** |
| `vitest` | **2.1.9** |
| `vitest.config.ts` | `environment: 'jsdom'`, `include` covers `components/**/*.test.tsx` |
| `typeof window` in a test | `"object"` — jsdom is active |
| `window.location.origin` | `"http://localhost:3000"` — **not** an opaque origin, so this is not the usual jsdom localStorage caveat |
| `typeof window.localStorage` | **`"undefined"`** |
| `typeof globalThis.localStorage` | **`"undefined"`** |
| `// @vitest-environment jsdom` pragma | no effect |
| Any other test using localStorage | none — this file is the only one |

So jsdom is running with a valid origin and still exposes no `localStorage`. Isolate it with a throwaway probe test under `lib/` if you want to re-confirm before changing anything.

### Two ways forward — prefer A, and A does not preclude B

**Option A (preferred): make the merge a pure function and test it there.**

Extract the merge into `lib/cart/` — e.g. `mergeAddedLine(existing: CartLine, incoming: Omit<CartLine, 'lineId'>): CartLine` — and have `CartProvider` call it. Then unit-test it in `lib/cart/__tests__/`, which runs clean today.

This is the codebase's existing idiom: the pooling rule itself lives once in `lib/pricing/decoration-pooling.ts` with cart and checkout both adapting into it, precisely so the rule is testable without a React tree. It also sidesteps the environment problem entirely rather than betting the fix on fixing jsdom.

**Option B (complementary, optional): give the suite a localStorage.**

Add a minimal `Storage` shim to `vitest.setup.ts`, installed only when `window.localStorage` is undefined so it disappears the day the environment starts providing one. That revives the dead `setFulfilmentType` test as a side effect. Expect it to fail on first run — it has never executed, so treat any failure as a genuine finding and report it rather than editing the assertion to match.

If you take A alone, say so explicitly in the summary and leave `CartProvider.test.tsx` untouched and still failing — do not delete or `.skip` it to make the suite green.

---

## The fix

Refresh `poolingEnabled` and `catalogueId` from the incoming add, on the same "latest source of truth" basis as `brackets` and `decorations`.

Judgement calls to make deliberately and record in the commit message:

- **`poolingEnabled`** — take the incoming value outright. It is a live flag that can legitimately go **either** direction (an AM can switch pooling off), so `incoming ?? existing` is wrong; it must be able to flip back to `false`.
- **`catalogueId`** — `catalogueItemId` is already the first discriminator in `lineSignature`, so a merge implies the same catalogue item and the incoming id will match. Refresh it anyway for consistency, but prefer `line.catalogueId ?? l.catalogueId` so a legacy incoming line carrying `null` cannot wipe a good id off an existing line.
- Do **not** touch anything else in the merge. `fulfilmentType`, `sizeId`, `locationLabel`, `customName` and `priceCurrency` are all part of the signature; if they differed there would be no merge.

---

## TDD — failing test first, no exceptions

Write the test, watch it fail for the stated reason, then make it pass. Cases:

1. **Adopts a newly-enabled flag.** Existing line has `poolingEnabled: false` and no `catalogueId`; incoming add carries `poolingEnabled: true` and `catalogueId: 'cat-1'`. Merged line has both, and `qty` is the sum.
2. **Honours a switched-off flag.** Existing `poolingEnabled: true`; incoming `false`. Merged line is `false` — this is the case a `??` would get wrong.
3. **A null incoming `catalogueId` does not wipe a good one.**
4. **Everything else is untouched.** `lineId`, `fulfilmentType`, `catalogueItemId`, `shipToStoreId`, `nature`, `billingMode` survive the merge unchanged.
5. **End-to-end, the pool actually forms.** Merge a stale tee line with a fresh pooled add, put a hoodie line sharing the same `decorationId` beside it, run `recomputeProductTierPrices`, and assert `decorations[].pooledQty` is the combined quantity and `sameArtworkSavings(line)` returns non-null. This is the test that proves the user-visible symptom is gone; the other four only prove the field moved.

---

## Locked — do not relitigate

- Spec §5 eligibility, including **stocked lines neither contributing to nor receiving a pool**. A `mixed` item drawing stock is correctly excluded; that is the print-run economics, not a bug.
- The max rule and its deliberate non-transitivity.
- Pooling identity is the `org_decorations` row scoped per catalogue.
- `pooledQty` stays derived, never persisted.
- **Flag-off byte parity.** `lib/cart/flag-off-parity.test.ts` must keep passing **unmodified**. If your change makes it fail, the change is wrong — do not edit that test.
- A pooled quantity is a **band-selection quantity only**. It must never reach MOQ, billed totals, picking fee, or order-type classification.

---

## Verification gates

Run all of these and report actual output. **Known-failing baselines** — these fail on clean `main` and are not yours to fix:

| Gate | Command | Baseline at HEAD |
|---|---|---|
| Targeted | `npx vitest run lib/cart lib/pricing` | all pass |
| Cart + checkout sweep | `npx vitest run lib/cart lib/pricing lib/checkout components/cart` | **1 failure**: `components/cart/__tests__/CartProvider.test.tsx` (`window.localStorage` undefined). 548 pass. If you take Option B this must become 0. |
| Typecheck | `npx tsc --noEmit` | **14 errors**, all in `lib/__tests__/next-config-redirects.test.ts` and `lib/email/__tests__/tracker-notification.test.ts`. None in `lib/cart` or `components/cart`. |
| Lint | `npx eslint <files you touched>` | clean |

Any *new* failure outside those baselines is yours. Do not adjust a baseline count to make a run look clean — if a baseline shifts, say so and explain why.

---

## Deliverables

1. The fix, on `fix/cart-merge-pooling-identity`, committed but **not pushed or merged**.
2. Tests written before the fix, with the five cases above.
3. A short note appended to `docs/2026-08-26-pooled-manual-decoration-own-ladder.md` recording that the merge half is now closed, alongside the `a04dd2a` round-trip half.
4. A commit message that states the user-visible symptom (existing carts stay pooling-blind when an AM enables pooling), the two judgement calls above, and which option you took for the test environment.
5. If you hit a genuine blocker, **stop**. Write the evidence under a `## Blockers found` heading in that same design note, mark the affected step `⚠ BLOCKED`, and report back rather than guessing.

## Out of scope

- The staff repo and any schema change. This is customer-side TypeScript only.
- Re-fixing `normalizePersisted` (done in `a04dd2a`).
- The two pre-existing tsc-error files.
- Spec §5, the stocked-line exclusion, and the demo catalogue's data.
