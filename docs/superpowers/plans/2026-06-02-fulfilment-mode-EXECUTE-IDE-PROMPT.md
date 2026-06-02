You are an expert TypeScript / Next.js 16 engineer **executing a locked, written implementation plan**. You are implementing it task-by-task with tests — you are NOT redesigning it. Every design decision is already settled in the plan; do not re-open them.

## The plan (read first, in full)

**Execute:** [`docs/superpowers/plans/2026-06-02-catalogue-fulfilment-mode-authoring.md`](./2026-06-02-catalogue-fulfilment-mode-authoring.md)

This adds a fulfilment-mode `Dropdown` to the staff catalogue-item editor, writing `b2b_catalogue_items.fulfilment_type_override` only ("Inherit master" = default). Read the whole plan, including its `⚠️ Flags` and Self-Review, before touching anything.

## Repo

`print-room-staff-portal` — `c:\Users\MSI\Documents\Projects\print-room-staff-portal`. **Single repo, staff-only.** **Branch:** `feat/catalogue-fulfilment-mode` (Task 1 Step 5 creates it).

## Required sub-skill

Use **`superpowers:subagent-driven-development`**: fresh subagent per task (Tasks 1–5), two-stage review between tasks, each subagent following **`superpowers:test-driven-development`** (failing test → confirm fail → minimal impl → confirm green → commit). Honour **`superpowers:verification-before-completion`** — paste real passing output, never assert green without evidence. Track with **TodoWrite**, one todo per task.

## Hard constraints (non-negotiable)

- **NO migration.** The column `b2b_catalogue_items.fulfilment_type_override` already exists in prod (verified read-only 2026-06-02: nullable `product_fulfilment_type` enum, default NULL). Do **not** author DDL, do **not** call `apply_migration`. You may use **read-only** `execute_sql` once to re-confirm the column + enum values if you want a sanity check — no writes.
- **The master `products` row is NEVER mutated.** The editor writes only to `b2b_catalogue_items` via `PATCH /api/catalogues/[id]/items/[itemId]`. Task 2's final test asserts the built patch carries no master column; keep it. If any step tempts you to write `products.fulfilment_type`, stop — that's a defect.
- **Staff UI rules.** Per the repo `AGENTS.md`, read [`docs/ui/oem-rules.md`](../../ui/oem-rules.md) before editing the `.tsx`. The new control mirrors the existing `Field` + `Dropdown` pattern already in `CatalogueItemEditor` / `DetailsTab`, so it inherits approved styling — do not invent a new visual treatment.
- **Reuse the existing fulfilment const.** `FULFILMENT_TYPES` / `FULFILMENT_TYPE_LABELS` live in `src/types/products.ts`; the plan imports them. Don't duplicate the enum.
- **Follow the plan's code verbatim.** On genuine drift (a line moved, the `Dropdown` primitive's prop shape differs, a test fixture needs the new fields), adapt minimally and **note it in your task report**. The plan flags two known soft spots — confirm them against live code before relying on them:
  - **Task 3 Step 1** locates the editor's server data loader by grepping `lead_time_days_override`. Confirm the file, then add `fulfilment_type_override` to the item select and `fulfilment_type` to the master `products` select.
  - **Task 4 Step 1** test query (`getByLabelText('Fulfilment mode')`): verify whether `@/components/ui/dropdown` renders a native `<select>` (use `getByLabelText`) or a Radix-style button (use `getByRole('button', { name: /fulfilment mode/i })`) and match the query to reality.

## Verify-as-you-go gates

- Each task: its own test(s) green (paste output).
- Tasks 2, 3, 4 end before commit with `npx tsc --noEmit` clean.
- Task 5: full `npx vitest run && npm run build` green. If a pre-existing unrelated test is already red on `main`, say so with evidence rather than absorbing it.
- Round-trip sanity (Task 5 Step 1) is a **read-only** MCP check against a **test catalogue** item only: set a mode, confirm `b2b_catalogue_items.fulfilment_type_override` updated and `products.fulfilment_type` unchanged. No writes via MCP — the write happens through the app's PATCH route in a browser, or you simply trust the unit-covered route logic and skip the live round-trip if no test item is safe to touch.

## Workflow / handoff

- Commit per task on `feat/catalogue-fulfilment-mode`. **Push the branch** when green (Task 5). **Do NOT merge** — Jamie merges.
- This plan is independent of Plan A (the role rename) and Plan C — no ordering dependency. It can run before or after them.
- If the branch already exists or `main` has advanced, stop and surface it.
- No force-push, no history rewrite.

## STOP — when done

When Tasks 1–5 are complete, the suite + build are green, and the branch is pushed, STOP and report:

> *"Plan B executed on `feat/catalogue-fulfilment-mode` @ `<sha>`, pushed, not merged. Fulfilment-mode select writes `fulfilment_type_override` only; master `products` row untouched (asserted). Full suite + build green. No migration (column pre-existing). Ready for Jamie to merge."*

Then offer to write the sprint doc (What/Why/How/Decisions/Gotchas/Where) before moving on.

## Definition of done

- `feat/catalogue-fulfilment-mode` with Tasks 1–5 committed, passing tests, `tsc` clean, build green, branch pushed (not merged).
- AM can set/clear the fulfilment mode on a catalogue item; unset = "Inherit master".
- Writes target `b2b_catalogue_items.fulfilment_type_override` exclusively; the master `products` row is provably untouched.
- No DDL authored or applied.
