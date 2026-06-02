# IDE Prompt — WRITE the Plans for the Remaining Chris-Notes Sprint Items

> Paste everything below the line into a fresh coding-agent session, with **both** repos open
> (`print-room-portal` and `print-room-staff-portal`).
> **This prompt produces implementation *plans* — it does NOT write feature code.** The output is
> markdown plan files only. Jamie executes them later via a separate prompt.

---

You are an expert TypeScript / Next.js 16 engineer **writing TDD implementation plans** for the **four un-built items** from a locked sprint spec. You are NOT implementing them. Your deliverable is a set of plan documents another agent will execute task-by-task. Do not write feature code, do not run migrations, do not touch app source.

## Repos

- `print-room-portal` (customer B2B portal) — `c:\Users\MSI\Documents\Projects\print-room-portal`
- `print-room-staff-portal` (staff tools) — `c:\Users\MSI\Documents\Projects\print-room-staff-portal`

Items 1 and 4 are **cross-repo**. Keep both open. Save all plan files into the **portal** repo at `print-room-portal/docs/superpowers/plans/` (that is where this sprint's spec and its sibling plans already live).

## Source of truth (read first, in full)

**Locked spec:** [`docs/superpowers/specs/2026-06-02-chris-notes-sprint-design.md`](../specs/2026-06-02-chris-notes-sprint-design.md)

It defines five items. **Item 5 (Inventory nav link) already shipped** — the org-admin-gated Inventory tab landed with the audit-view feature (`a9c5fa0`) and was repaired by `f4868e3` + `b4ed7f8`. **Do NOT plan item 5.** You are planning **items 1, 2, 3, and 4 only.**

> ⚠️ The spec's line-10 note ("this sprint ships items 1–5… reorder and the audit view are NOT in this build") is now **inverted** — reorder + the audit view shipped on 2026-06-02; items 1–4 did not. Ignore that stale framing; trust this prompt's scope.

Every per-item design decision is already grilled and **locked** (see each item's "Decisions locked"). **Do not re-open them.** This is a planning task, not a brainstorming task — skip `superpowers:brainstorming`; go straight to writing plans.

## Required sub-skill

Use **`superpowers:writing-plans`**. Follow it exactly: the plan header it mandates, bite-sized TDD tasks (failing test → run/confirm fail → minimal impl → run/confirm green → commit), exact file paths, complete code in every step, no placeholders, and the **Self-Review** pass at the end of each plan. Track your own progress with **TodoWrite** (one todo per plan).

## Recommended decomposition — three plans (build order)

Each plan must produce independently working, testable software. Write them in this order; **keep the rename standalone**. If you find a genuinely cleaner boundary while planning, you may adjust — but state why, and never fold the prod data-migration item into a UI plan.

1. **Plan A — Role rename `buyer` → `staff`** (spec Item 1) → suggested file `2026-06-02-role-rename-buyer-to-staff.md`, branch `feat/role-rename-staff`.
   Foundational + riskiest (prod data migration + RLS + cross-repo TS). Everything else's role-gating assumes it. Independently testable: existing members must function identically as `staff`, proof-amendment access intact.
2. **Plan B — Catalogue fulfilment-mode authoring** (spec Item 4) → `2026-06-02-catalogue-fulfilment-mode-authoring.md`, branch `feat/catalogue-fulfilment-mode`.
   Staff-portal only. Adds the editor control that writes `b2b_catalogue_items.fulfilment_type_override`. Independently shippable — an AM can set modes before the pills consume them.
3. **Plan C — Ordering-mode pills + PDP size behaviour** (spec Items 2 **and** 3 — same PDP/shop surface) → `2026-06-02-ordering-mode-pills-and-pdp-sizes.md`, branch `feat/ordering-mode-pills`.
   Portal. Two pills (From inventory / Reorder), `mixed` → both, role-gated, catalogue filter + PDP order-mode toggle, correct checkout `fulfilment_type` on submit; **and** the From-inventory size picker shows only in-stock sizes with no "Available to order"/status text. Depends on the renamed role (A) and the override column being authored (B).

## Per-item grounding — verified anchors (live on `main`, 2026-06-02)

Confirm each against the live file before you write the task that touches it; if drifted, find the equivalent and adapt — never anchor a plan to a stale line number.

**Item 1 — rename (cross-repo, the big one):**
- `user_organizations.role` is a plain **TEXT** column (no PG enum → no `ALTER TYPE`; a one-shot `UPDATE` is the migration).
- TS union confirmed at `print-room-portal/types/company.ts:17` → `role: 'org_admin' | 'buyer'`. Comparisons in `lib/company.ts`, checkout/proof reads, `lib/checkout/server.ts` (`context.role`), `lib/shop/member-access.ts`.
- Known RLS hardcode: `print-room-staff-portal/supabase/migrations/20260513000100_proof_amendment_requests.sql:88` (`uo.role IN ('org_admin','buyer')`).
- Staff-side TS: `EditRoleDialog.tsx`, `mcp-server/src/tools/members.ts`, the members role API route.
- **Blast radius:** `'buyer'` appears **144× across 47 files in the portal repo alone** (incl. tests + docs). The plan must include a **scoped grep sweep of BOTH repos** as an explicit task and a **zero-`'buyer'`-in-live-code gate** (docs/historical excluded) as the done-condition. Do not hand-enumerate — plan the grep.

**Item 2 — pills:**
- Catalogue-item nature enum `product_fulfilment_type` = `stocked | made_to_order | mixed`, stored as `b2b_catalogue_items.fulfilment_type_override`, base `products.fulfilment_type`.
- Checkout-line routing `'stocked' | 'make_to_stock'` at `lib/checkout/submit.ts` (spec cites `:48`; verify). Mapping: From inventory → `stocked`; Reorder (replaces "Made to order") → `make_to_stock`; `mixed` → both pills. Effective mode = `fulfilment_type_override ?? products.fulfilment_type`.
- Role gating: staff see **only** From inventory; gate the **Reorder pill** on `isOrgAdmin`. (The job-tracker reorder entry is **already** `isOrgAdmin`-gated — `components/orders/ReorderButton.tsx:36` — do not re-plan that.)

**Item 3 — PDP size picker (From-inventory = in-stock only):**
- `print-room-portal/components/shop/VariantPicker.tsx` — confirmed live: **line 178** renders `Available to order`, **line 192** renders `'0 in stock' / '{qty} in stock'`. In From-inventory mode: suppress both (no "Available to order", no status text; zero-stock/untracked sizes not selectable). Reorder mode unchanged. Cart oversell guard (`CartTable`) stays the safety net.
- **Reconcile with existing code:** earlier PDP work already exists around From-Stock vs MTO (`907c388`, `0a306eb`). Before planning, read the current VariantPicker + ProductDetailClient state and build the plan **on top of** what's there — don't assume a greenfield toggle.

**Item 4 — catalogue editor mode select (staff portal):**
- `print-room-staff-portal/src/components/catalogues/CatalogueItemEditor.tsx` has **no fulfilment reference today** — confirm, then plan the select: options `stocked / made_to_order / mixed`; **default = inherit** master `products.fulfilment_type`; writes `fulfilment_type_override` **only**; **never** mutates the master `products` row.

## Schema / prod verification (READ-ONLY)

Use the Supabase MCP **read-only** to confirm, and cite the result in the relevant plan:
- Distinct `user_organizations.role` values + the **count of `role='buyer'` rows** (sizes the Item 1 migration; author the exact `UPDATE … WHERE role='buyer'` into the plan as a step **for a human to run later** — do not run it).
- `product_fulfilment_type` enum values exist; `b2b_catalogue_items.fulfilment_type_override` and `products.fulfilment_type` columns exist (Items 2 + 4).

**No writes. No migrations. No edge-function deploys.** This shared Supabase is **PRODUCTION with no staging** — every write touches live data. Plans *author* the migration SQL; they do not execute it.

## Hard constraints (non-negotiable)

- **Plans only.** No app/source edits, no test files written, no branches with code. Your commits (if any) are the plan `.md` files into the portal repo.
- Each plan stands alone and is independently testable per `superpowers:writing-plans`. Complete code in every TDD step — **no "TBD" / "add validation" / "similar to Task N"**.
- Role gating is on **derived `isOrgAdmin`** (`role === 'org_admin'`), so the gating in Plans B/C is **rename-independent** — note this so Plan C doesn't hard-depend on Plan A having executed first.
- Item 4 plan must state, in the task that writes the value, that the master `products` row is never touched.
- Anything that re-touches the Inventory nav or `/inventory` (shouldn't be needed) must **extend, not duplicate** — that surface already shipped.

## STOP — do not execute

`superpowers:writing-plans` ends by offering an execution handoff. **Override it: do NOT begin execution and do NOT offer to.** When all plans are written and each has passed its Self-Review, STOP and report:

> *"Plans written: `<fileA>`, `<fileB>`, `<fileC>`. Each self-reviewed against the spec. Cross-repo + prod-migration items flagged. Ready for Jamie to schedule execution."*

## Definition of done

- Three plan files (or your justified alternative split) saved under `print-room-portal/docs/superpowers/plans/`, each with the mandated header, bite-sized TDD tasks with full code, exact cross-repo paths, and a completed Self-Review section.
- Item 1's plan contains the authored (un-run) prod `UPDATE` migration + a both-repos grep sweep task + a zero-`'buyer'` gate.
- Item 4's plan explicitly keeps the master `products` row untouched.
- A final report: one line per plan, the suggested branch names, and any anchor that had drifted and how you adapted.
