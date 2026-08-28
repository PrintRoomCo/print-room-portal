# Test suite repairs — plan

**Date:** 2026-08-28
**Branch:** `docs/split-shipment-spec` (current) — see *Global constraints* before you start
**Written for:** Jon to implement by hand.

## Goal

Get `npm test` back to green, and leave the suite harder to break next time. Three
failing files, three different reasons — only one of which is a bug in the tests'
*intent*.

Nothing here ships to users. Every change is test-side or test-infrastructure.

## Architecture

Two independent repairs, plus one optional third:

| Failure | Root cause | Category |
|---|---|---|
| `CartProvider.test.tsx` | Node 26 shadows jsdom's `localStorage` | **Environment** — the floor moved under the test |
| `TeamClient.branch.test.tsx` | Test asserts a checkbox UI replaced by chips+combobox in `34a0c4c` | **Stale test** — behaviour survived, affordance didn't |
| `OrdersTable.test.tsx` | Status column deliberately removed in `31f9fc5` (2026-08-04); tests left behind | **Orphaned test** — the behaviour itself is gone, so delete |

They share no code. You can do them in any order and stop after any one.

The middle and bottom rows look identical in the reporter — both "text not found" —
but they need opposite fixes. Task 2's behaviour survived a redesign, so its test gets
**rewritten**; Task 3's behaviour was deleted on purpose, so its test gets **deleted**.
Telling those apart is the actual skill in this plan.

## Tech stack

- vitest 2.1.9, `environment: 'jsdom'`, jsdom ^25.0.1
- @testing-library/react + @testing-library/jest-dom (loaded in `vitest.setup.ts`)
- **Node v26.4.0** — this is the load-bearing fact for Task 1

## Global constraints

- **Branch.** You are on `docs/split-shipment-spec` with `4ffb99f` (layout.tsx) on
  top. This work is unrelated to the split-shipment epic. Branch off before you
  start — `git switch -c fix/test-suite-repairs` — so these commits don't
  contaminate a docs branch. (Memory note: branch contamination has bitten this repo
  before — the display-vs-billing-currency branch carries three unrelated PO-minimum
  docs commits.)
- **Lint has 1 warning of headroom.** `npm run lint` is `eslint . --max-warnings=200`
  and currently emits **199**. One new warning turns the suite red. Check lint after
  every task, not just at the end.
- Do not touch `app/api/team/members/[membershipId]/store-grants/route.ts` or
  `TeamClient.tsx`. The components are correct; the tests are what's wrong.

## Concepts you'll practise

- **Environment repair vs test fixture** — a global belongs in `vitest.setup.ts` when
  it fills a gap between your runtime and a real browser, and next to the test when
  the test needs to *observe or control* it. Getting this boundary wrong is how setup
  files turn into junk drawers. Task 1.
- **Testing behaviour, not affordance** — `getByLabelText('Avalon')` + `.checked`
  encodes "there is a checkbox called Avalon". `getByRole('button', { name: 'Remove
  Avalon' })` encodes "there is a way to remove Avalon". The second survives a
  redesign; the first is why you're here. Tasks 2 and 3.
- **Accessible-name queries as a two-for-one** — querying by role+name means the test
  fails if the control loses its accessible name, so your test doubles as an a11y
  regression guard. Task 2.

## Order of play

- [ ] Task 1 — localStorage environment repair — `CartProvider.test.tsx` green — ~15 min
- [ ] Task 2 — rewrite branch-grants test against the combobox — `TeamClient.branch.test.tsx` green — ~40 min
- [ ] Task 3 — delete orphaned OrdersTable status tests — suite green — ~10 min

Ships dark throughout — no user-facing change at any point. Safe to stop after any
ticked task.

## Baselines (measure before you start)

I measured these on `4ffb99f` at 2026-08-28 08:28. Re-run them yourself and confirm
you get the same numbers, so you never debug someone else's mess:

- [ ] `npm run lint` → expect **199 problems (0 errors, 199 warnings)** — record: ____
- [ ] `npx tsc --noEmit 2>&1 | grep -c 'error TS'` → expect **14** — record: ____
      (pre-existing, concentrated in `lib/email/__tests__/tracker-notification.test.ts`;
      not yours, don't fix them here)
- [ ] `npm test` → expect **3 files failed / 5 tests failed, 296 files / 1822 tests passed** — record: ____

### Before anything: fix how you read test output

Not a code task — a habit. The output you were reading was garbled scrollback from
vitest's live-redraw reporter, which is why `×` lines appeared under a file that
actually passed. When you want output you can trust:

```bash
npm test -- --reporter=basic --no-color > vitest-out.txt 2>&1
```

**Redirection order is the whole trick.** `> file 2>&1` points stdout at the file,
then points stderr at the same place. `2>&1 > file` points stderr at the *old*
stdout — your terminal — and only stdout at the file, so you lose the error you were
trying to capture. Vitest also drops the interactive redraw automatically when stdout
isn't a TTY, so `--reporter=basic` is belt-and-braces rather than strictly required.

---

### Task 1: localStorage environment repair   `[Routine]`   ~15 min

> Downgraded from `[Stretch]` on request — the contract and the code are below.

**Goal:** any jsdom test in this repo can use `window.localStorage` the way a real
browser provides it, on Node 26.

**Files:**
- Modify: `vitest.setup.ts`
- Test: `components/cart/__tests__/CartProvider.test.tsx` — **already exists, do not edit it**

**Interfaces:**
- Produces: a working `globalThis.localStorage` / `window.localStorage` for every test file.

**Read first:**
- [ ] `vitest.setup.ts:31-47` — the `IntersectionObserver` no-op shim. This is the
      exact pattern and the exact category: an API real browsers have, jsdom doesn't,
      stubbed once for everyone. Note that it explains *why* in a comment — match that.
- [ ] `contexts/__tests__/CurrencyContext.test.tsx:15-55` — a per-file `Storage` stub
      installed with `vi.stubGlobal`. This test **must keep passing untouched**. It is
      the other category (it asserts on `localStorage.getItem('prs-currency')` at
      line 71), and it is your regression check that a setup-level stub doesn't fight
      a file-level one.

**Steps:**

- [x] *1. Reproduce, and confirm it fails for the RIGHT reason.**

  ```bash
  npx vitest run components/cart/__tests__/CartProvider.test.tsx --reporter=basic --no-color
  ```

  Expect: `TypeError: Cannot read properties of undefined (reading 'clear')` at
  `CartProvider.test.tsx:37:23`.

  Note *where* it dies — in `beforeEach`, before the test body. This failure has
  nothing to do with `setFulfilmentType`. If you see any other message, stop and
  re-read the baseline.

- [ ] **2. Implement.** Open `vitest.setup.ts` and **append this to the very end of
  the file** — after the `globalThis.IntersectionObserver ??= …` line, which is
  currently the last statement. Nothing above it changes.

  ```ts
  /* Node 26 ships its own `localStorage` global that resolves to `undefined`
   * unless the process was started with `--localstorage-file`, and it shadows the
   * one jsdom provides — so `window.localStorage` is undefined in tests while
   * `sessionStorage` (which Node does not claim) still works. Restore a
   * Map-backed Storage so tests get it the way a browser provides it.
   * Cleared before each test: one object is shared by every test in the worker. */
  const localStorageValues = new Map<string, string>()
  const localStorageShim: Storage = {
    get length() {
      return localStorageValues.size
    },
    clear: () => localStorageValues.clear(),
    getItem: (key) => localStorageValues.get(key) ?? null,
    key: (index) => Array.from(localStorageValues.keys())[index] ?? null,
    removeItem: (key) => localStorageValues.delete(key),
    setItem: (key, value) => localStorageValues.set(key, String(value)),
  }

  if (!globalThis.localStorage) {
    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageShim,
      configurable: true,
      writable: true,
    })
  }

  beforeEach(() => {
    localStorageValues.clear()
  })
  ```

  `beforeEach` is already imported at the top of the file (line 2) — you do **not**
  need to add an import. I ran this exact block against the suite: CartProvider goes
  green, CurrencyContext and normalize stay green, lint stays at 199 warnings, tsc
  stays at 14 errors.

  **Why each piece is the way it is:**

  - **`: Storage`** is the DOM's own type. It makes TypeScript reject the file if you
    miss a method or get a signature wrong, so the shim can't quietly drift from the
    real interface.
  - **`?? null` in `getItem`** — real `localStorage` returns `null` for a missing key,
    but `Map.get` returns `undefined`. Skip this and the shim lies about production
    behaviour in exactly the case tests care about.
  - **`String(value)` in `setItem`** — real storage coerces everything to a string.
    Without it, `setItem('k', 42)` then `getItem('k')` hands back a number and a
    `JSON.parse` downstream behaves differently under test than in the browser.
  - **`Object.defineProperty` rather than `globalThis.localStorage = …`** — plain
    assignment does work here (I checked: the descriptor is
    `{ get: true, set: true, configurable: true }`), but it routes through Node's
    setter. `defineProperty` replaces the accessor outright with a plain data
    property, so there's no Node-version-specific setter in the path.
  - **`if (!globalThis.localStorage)`** guards the whole thing, mirroring the `??=`
    on the `IntersectionObserver` shim above it. On a Node version where jsdom's
    `localStorage` survives, this block does nothing.
  - **The `beforeEach` clear** is the part that matters most and is easiest to omit —
    see the trap below.

  **Trap:** the `Map` is created **once per worker**, not once per test. Without the
  `beforeEach` clear, a value written by one test is visible to the next, and you get
  order-dependent failures that pass when you run the file in isolation — the most
  expensive kind to debug. `CartProvider.test.tsx:37` happens to call `.clear()`
  itself, so it would mask the problem for that one file; don't rely on every future
  test remembering to.

  **Second trap:** lint has **1 warning of headroom** (199/200). A stray `any` or an
  unused variable in this block fails the whole build.

- [x] **3. Run the target test.**
  `npx vitest run components/cart/__tests__/CartProvider.test.tsx --reporter=basic --no-color`
  → expect **1 passed**

- [x] **4. Run the regression trio.** This is the step that proves you got the
  boundary right, not just the symptom:

  ```bash
  npx vitest run components/cart/__tests__/CartProvider.test.tsx \
    contexts/__tests__/CurrencyContext.test.tsx \
    lib/cart/__tests__/normalize.test.ts --reporter=basic --no-color
  ```

  → expect **3 files passed, 23 tests passed**. If `CurrencyContext` broke, your
  setup-level stub is fighting its per-file stub — that's the boundary error this
  task is about.

- [x] **5. Run the guards.** `npm run lint && npx tsc --noEmit 2>&1 | grep -c 'error TS'`
  Expect: **199 warnings / 0 errors**, and **14** tsc errors. No new failures against baseline.

- [x] **6. Commit.** `git commit -m "test: repair localStorage global shadowed by Node 26"`

- [x] **7. Checkpoint.** Ask Claude: *"review Task 1 against the plan"*.

**Why this shape:** the `IntersectionObserver` shim already establishes that this repo
puts "browser API our runtime lacks" in `vitest.setup.ts`. `localStorage` under Node 26
is the same category — nothing about the cart code changed, the platform moved — so
consistency with the existing precedent beats a local patch.

**Rejected:** *fix it inline in `CartProvider.test.tsx` only.* It's two lines and has
zero blast radius, which is a real argument when only one file is currently broken.
It loses because the cart is localStorage-backed, so the next cart test hits the same
wall and the next person has to rediscover a Node-version root cause from a
`Cannot read properties of undefined` — the expensive part of this bug was the
diagnosis, and a local patch throws that away.

**Done when:** `npm test` reports **2 files failed / 4 tests failed** (down from 3 and 5),
and `CurrencyContext.test.tsx` still passes.

---

### Task 2: rewrite the branch-grants test against the real UI   `[Routine]`   ~40 min

**Goal:** `MemberBranchGrants` has a test that pins the PUT contract to
`/api/team/members/:id/store-grants` and survives the next visual redesign.

**Files:**
- Modify (replace contents): `app/(portal)/users/__tests__/TeamClient.branch.test.tsx`
- Do **not** modify: `app/(portal)/users/TeamClient.tsx`

**Read first:**
- [x] `app/(portal)/users/TeamClient.tsx:297-482` — the whole component. In particular
      the affordances your queries must use:
      - granted branch → `<button aria-label={`Remove ${s.name}`}>` (a chip)
      - the search box → `<input type="search" aria-label="Add a branch this member manages">`,
        dropdown opens on **focus or change**, starts closed (`useState(false)`)
      - a dropdown row → `<button>` whose accessible name is just the branch name
      - save → `<button disabled={!dirty || saving}>Save branches</button>`
- [x] `app/(portal)/users/TeamClient.tsx:302-304` — the comment explaining why
      checkboxes were dropped ("Orgs can have ~65 branches, so a checkbox-per-branch
      list is unusable"). This is why the old test is the thing that's wrong.
- [x] `app/api/team/members/[membershipId]/store-grants/route.test.ts:90-118` — what
      the **server** already covers (403 / 404 / 422 / happy-path diff + audit). Your
      test must not duplicate this. The gap it fills is the *client* half: that the
      component sends `{ storeIds: [...] }` to the right URL at all.

**Steps:**

- [x] **1. Replace the test file.** Copy verbatim into
      `app/(portal)/users/__tests__/TeamClient.branch.test.tsx`:

  ```tsx
  import { render, screen, waitFor } from '@testing-library/react'
  import userEvent from '@testing-library/user-event'
  import { beforeEach, describe, it, expect, vi } from 'vitest'
  import { MemberBranchGrants } from '../TeamClient'

  vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

  let lastPut: { url: string; body: unknown } | null = null

  beforeEach(() => {
    lastPut = null
    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        lastPut = { url: String(url), body: JSON.parse(String(init.body)) }
        return {
          ok: true,
          json: async () => ({
            stores: [
              { id: 's-1', name: 'Avalon', granted: true },
              { id: 's-2', name: 'CBD', granted: true },
            ],
          }),
        } as Response
      }
      return {
        ok: true,
        json: async () => ({
          stores: [
            { id: 's-1', name: 'Avalon', granted: true },
            { id: 's-2', name: 'CBD', granted: false },
          ],
        }),
      } as Response
    }) as unknown as typeof fetch
  })

  describe('MemberBranchGrants', () => {
    it('shows granted branches as chips and leaves ungranted ones out', async () => {
      render(<MemberBranchGrants membershipId="m-1" />)
      expect(await screen.findByRole('button', { name: 'Remove Avalon' })).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Remove CBD' })).toBeNull()
    })

    it('PUTs the granted branch ids to the mirror route when a branch is added', async () => {
      const user = userEvent.setup()
      render(<MemberBranchGrants membershipId="m-1" />)
      await screen.findByRole('button', { name: 'Remove Avalon' })

      expect(screen.getByRole('button', { name: 'Save branches' })).toBeDisabled()

      await user.click(screen.getByLabelText('Add a branch this member manages'))
      await user.click(await screen.findByRole('button', { name: 'CBD' }))
      await user.click(screen.getByRole('button', { name: 'Save branches' }))

      await waitFor(() => expect(lastPut).not.toBeNull())
      expect(lastPut?.url).toContain('/api/team/members/m-1/store-grants')
      expect(lastPut?.body).toEqual({ storeIds: ['s-1', 's-2'] })
    })
  })
  ```

  I've run this against the current component — it passes as written. The `fetch`
  mock and the two-store fixture are carried over unchanged from the old file; what
  changed is every query and the assertion about *when* saving is possible.

- [x] **2. Run it.**
  `npx vitest run 'app/(portal)/users/__tests__/TeamClient.branch.test.tsx' --reporter=basic --no-color`
  → expect **2 passed**

  If it fails, the component changed since 2026-08-28 — re-read the render block at
  `TeamClient.tsx:388-482` before touching the test.

- [ ] **3. Now make it earn its place.** Read your own new test and answer, in the
  commit message: *what would have to break in `TeamClient.tsx` for test 1 to fail
  that test 2 wouldn't already catch?* If you can't answer it, delete test 1.

  **Trap:** the two tests are not equally valuable and you should not keep both by
  default. Test 2 exercises load → mutate → save → assert-the-wire-contract, which
  subsumes most of test 1's coverage. Test 1's only independent claim is the negative
  one — that an ungranted branch does *not* render a chip. Decide whether that's worth
  a test or whether it belongs folded into test 2.

- [x] **4. Run the guards.** `npm run lint && npx tsc --noEmit 2>&1 | grep -c 'error TS'`
  Expect: **199 warnings / 0 errors**, **14** tsc errors.

- [x] **5. Commit.** `git commit -m "test: rewrite branch-grants test against chips+combobox UI"`

- [ ] **6. Checkpoint.** Ask Claude: *"review Task 2 against the plan"*.

**Why this shape:** the queries are all role+accessible-name rather than
label+`.checked`. That ties the test to what a *user* can do ("remove Avalon", "save
branches") rather than to which widget currently implements it — so the next redesign
of this control breaks the test only if it breaks the user's ability to do the thing.
It also means the test fails if a control silently loses its accessible name, which
is a free a11y guard.

**Rejected:** *delete the file, since the checkbox UI is gone.* This was your first
instinct and it's the wrong read — the UI wasn't deleted, it was redesigned, and the
behaviour underneath still ships. The route test covers the server, but it mocks the
client away, so nothing else asserts the component sends `{ storeIds: [...] }` to that
URL. Delete the file and a refactor that sends `{ branchIds: [...] }` passes every
remaining test while silently breaking branch permissions in production. Also
rejected: *patch the selectors only* — that leaves test 2 asserting
`['s-1','s-2']` while `dirty` gates the save button, so it would still fail.

**Done when:** `npm test` reports **1 file failed / 2 tests failed** (assuming Task 1
is done), and the only remaining red is `OrdersTable.test.tsx`.

---

### Task 3: delete the orphaned OrdersTable status tests   `[Routine]`   ~10 min

> **This is outside the three things you asked about.** I found it while measuring the
> baseline: `npm test` has **three** red files, not two.
>
> **Correction to the first draft of this plan.** I originally wrote this task as
> "align the assertions with the rendered labels" and told you to work out which side
> moved. I've since checked, and the answer removes the judgement call: commit
> **`31f9fc5` "Removed Status Column from the past orders page"` (2026-08-04)**
> deliberately deleted the status column. `OrdersTable.tsx` now renders six columns —
> Date, Order ref, Placed by, Type, Product value, Billed — and no status or
> fulfilment cell at all. The tests weren't left asserting a *renamed* label; they're
> asserting a **feature that was intentionally removed four weeks ago**. So the task
> is deletion, not repair.

**Goal:** `OrdersTable.test.tsx` stops asserting a column that no longer exists.

**Files:**
- Modify: `app/(portal)/past-orders/__tests__/OrdersTable.test.tsx` — delete lines **59–80**
- Do **not** modify: `app/(portal)/past-orders/OrdersTable.tsx`

**Read first:**
- [ ] `app/(portal)/past-orders/OrdersTable.tsx:13-20` — the `COLUMNS` array. Six
      entries, none of them status. This is the whole evidence base for deleting.
- [ ] `git show 31f9fc5 --stat` — confirm for yourself that the removal was deliberate
      and that the tests were simply missed.

**Steps:**

- [ ] **1. Reproduce.**
  `npx vitest run 'app/(portal)/past-orders/__tests__/OrdersTable.test.tsx' --reporter=basic --no-color`
  → expect 2 failures: `Unable to find an element with the text: Unfulfilled` and
  `…: In production`

- [ ] **2. Confirm the column is genuinely gone** — don't take my word for it:

  ```bash
  grep -n 'label:' 'app/(portal)/past-orders/OrdersTable.tsx'
  ```

  → expect exactly six labels: `Date`, `Order ref`, `Placed by`, `Type`,
  `Product value`, `Billed`. No status, no fulfilment.

- [ ] **3. Delete the two orphaned tests.** They are lines 59–80 — the blank line
  before `it('shows a fulfilment badge…')` through the closing `})` of
  `it('keeps the production status label…')`. Line 81 is the `})` that closes the
  `describe`; **leave it**.

  ```bash
  sed -i '' '59,80d' 'app/(portal)/past-orders/__tests__/OrdersTable.test.tsx'
  ```

  Or delete them by hand in the editor — same result. Afterwards the file should end:

  ```tsx
    it('rows link to the past-orders detail page keyed on quoteId', () => {
      render(<OrdersTable orders={[cheap]} />)
      expect(screen.getByRole('link', { name: 'REF-1' }).getAttribute('href')).toBe('/past-orders/q1')
    })
  })
  ```

  **Trap I checked so you don't have to:** `within` is imported on line 2 and used at
  lines 33–34, *outside* the deleted range — so it does **not** become an unused
  import. If it had, that's a new lint warning and lint has exactly 1 of headroom.

- [ ] **4. Run it.**
  `npx vitest run 'app/(portal)/past-orders/__tests__/OrdersTable.test.tsx' --reporter=basic --no-color`
  → expect **3 passed** (down from 5 tests, 2 of which were failing)

- [ ] **5. Run the guards.** `npm run lint && npx tsc --noEmit 2>&1 | grep -c 'error TS'`
  Expect: **199 warnings / 0 errors**, **14** tsc errors.

- [ ] **6. Commit.** `git commit -m "test: drop OrdersTable status assertions orphaned by 31f9fc5"`

  Reference the commit in the message. The next person to wonder where past-orders
  status coverage went should land on `31f9fc5` in one hop.

- [ ] **7. Checkpoint.** Ask Claude: *"review Task 3 against the plan"*.

**Why this shape:** deletion is right when the *behaviour* is gone, as opposed to
Task 2 where the behaviour survived and only the affordance changed. That's the same
distinction that made "just delete it" the wrong answer for the branch-grants test and
the right answer here — worth holding onto, because the two failures looked identical
from the reporter output.

**Rejected:** *keep the tests and restore the status column.* That's a product
decision someone already made in the other direction, and reversing it from inside a
test-cleanup branch would be smuggling a UI change past review. If you think the
column should come back, that's a separate conversation with Chris, not this commit.

**Also rejected:** *port the assertions to wherever the badge lives now.* The
Fulfilled/Unfulfilled logic is already covered directly at
`lib/orders/__tests__/fulfilment-status.test.ts`, so re-asserting it through a table
component would duplicate coverage rather than add any.

**Done when:** `npm test` reports **0 files failed** — 299 files, 1825 tests passing
(1827 minus the 2 you deleted).

---

## Definition of done

- [ ] `npm test` → 0 failures, 299 files / **1825** tests passing (1827 minus the 2 deleted in Task 3)
- [ ] `npm run lint` → still 0 errors, ≤199 warnings
- [ ] `npx tsc --noEmit` → still 14 errors, none new
- [ ] Commits sit on `fix/test-suite-repairs`, not on `docs/split-shipment-spec`
