# Preview as Member — Design Spec

**Date:** 2026-06-19
**Status:** Design approved (grill complete); awaiting spec review → implementation plan
**Repos:** `print-room-staff-portal` (launcher) + `print-room-portal` (preview surface)
**Staged here in plans dir for safety; to be mirrored into both repos' `docs/superpowers/specs/` on the build branch — see "Repo & autopush constraints".**

---

## Problem

Staff author catalogues, products, members, roles, grants and per-member `ordering_permission` in the staff portal, but have **no way to see what a given customer member will actually experience** (which catalogues/items they see, their stock-vs-reorder pills, dead-zones, tenant behaviour, pricing) until the work is published and a real member logs in. Per-member permissions therefore can't be verified before go-live. (Directly addresses the manual workflow in the B2B org test-case kit.)

## Goal

A **read-only "Preview only"** render of the customer portal, launched from the staff portal, shown exactly as a chosen org member sees it — **including the still-draft item being edited** — so staff can verify permissions and presentation before publishing. Mirrors Shopify's "preview before publish".

## Non-goals

- **Not** impersonation — no real Supabase session for the member; no ability to act or order as them.
- **Not** editing from within the preview.
- **Synthetic / custom profile** (no real member row) is **phase 2** — phase 1 is real members only.
- **Not** on the product (master) editor — products are global, with no org/member context.
- Ship-to-location enforcement is unchanged (separate, pre-existing concern).

## Approach

**Read-only server-side render-as-member, via a signed token + service-role reads.** Staff portal mints a short-lived signed token naming (org, target member); customer portal verifies it, drops a preview cookie, and builds the member's context server-side through the service-role client, strictly read-only.

Alternatives rejected:
- **True impersonation** (mint a real Supabase session): real session = real ordering power; breaks for never-logged-in invites; cross-domain cookie juggling. Risky.
- **Client-side mock** (pass member params, override in browser): fails — RLS filters against the *staff* user's JWT, returning wrong/empty data.

---

## Decisions (locked via grill 2026-06-19)

| Area | Decision |
|---|---|
| **Target** | Real member incl. pending invites (**phase 1**); synthetic custom profile (**phase 2**) |
| **Depth** | Full walkthrough incl. checkout; final order submit hard-blocked |
| **Draft item** | Member-permission lens, but **force-show the item being edited** even if draft/unpublished |
| **Landing** | Editor button → in-edit item's **PDP**; member-row shortcut → member's catalogue home |
| **Read-only** | **Write path rejects the preview cookie** (fail closed); cart works (ephemeral, preview-scoped localStorage key) |
| **Block copy** | **"Preview only"** — banner, disabled write buttons, toast backstop |
| **Token** | Stateless **HMAC-SHA256** `{org, target, exp, iat, purpose, nonce}` |
| **Secret** | Dedicated **`PREVIEW_TOKEN_SECRET`** set identically in both apps |
| **Lifetimes** | Token **10 min**, cookie **30 min** fixed |
| **Entry points** | Catalogue item editor button + member-row "Preview as" (not the product editor) |
| **Access** | Any authenticated staff user |
| **Precedence** | Preview cookie checked **before** `auth.getUser()` → always wins when present; "Exit preview" clears it |
| **Audit** | A real **`audit_events`** row via `recordAuditEvent` on mint → visible on the existing staff **/audit** page |

---

## Architecture

### 1. Trust handoff (cross-domain)

Separate domains share one Supabase; staff are **not** authenticated on the customer domain. The signed token is the trust bridge.

1. Staff clicks Preview → staff route **`POST /api/preview-token`**:
   - Authenticates the caller as staff (existing staff-portal auth).
   - Builds payload `{ v:1, org, target:{ kind:'member', membershipId }, ret?:{ itemId }, purpose:'preview', iat, exp:iat+600, nonce }`.
   - Signs HMAC-SHA256 with `PREVIEW_TOKEN_SECRET` → `base64url(payload) + "." + base64url(sig)`.
   - Writes an `audit_events` row (`member.preview_as`).
   - Returns the full URL `${CUSTOMER_PORTAL_URL}/preview?token=…`.
2. Staff UI opens that URL in a new tab.
3. Customer route **`GET /preview`** verifies signature + `exp` + `purpose`, sets a short-lived `pr_preview` cookie (httpOnly, SameSite=Lax, secure) carrying the verified payload, then redirects:
   - to the in-edit item's PDP if `ret.itemId` present (editor launch),
   - else to `/catalogue` (member-row launch).
4. **`GET /preview/exit`** clears the cookie and redirects to `/`.

### 2. Context override (the one chokepoint)

There is **no `middleware.ts`** in the customer portal — every route gates itself via `requireB2BCustomer*` (which bails if no `auth.getUser()`). That makes those functions the single override point.

- **Read path** (`requireB2BCustomer` / `requireB2BCustomerCached`, used by server components):
  - **Before** the `auth.getUser()` check, look for a valid `pr_preview` cookie.
  - If present + valid: build `B2BCustomerContext` for the **target membership** using the **service-role** client (`getSupabaseServer()` → `SUPABASE_SERVICE_ROLE_KEY`, already how `admin` is constructed), reading the target's `user_organizations` row + `organizations` + `b2b_accounts` + `stores`. Stamp `isPreview: true`.
  - No member auth session is needed — service-role + explicit `membershipId` is sufficient.
- **Write path** (`requireB2BCustomerApi`, and any server action that writes):
  - If a `pr_preview` cookie is present, **reject** with a `403 "preview only"` result. Fail closed — no mutation can ever run under a preview cookie, no enumeration of write sites required for the safety guarantee.

### 3. Visible item set

`getGrantedCatalogueItemIds(admin, membershipId, organizationId)` already returns the correct set per member (org_admin → all active items; staff → grants by membershipId). For the **editor launch**, union in the in-edit `itemId` from the token so a still-draft item is visible:

```
visibleIds = getGrantedCatalogueItemIds(admin, membershipId, org)
if (ctx.isPreview && ctx.previewItemId) visibleIds = unique([...visibleIds, ctx.previewItemId])
```

(Implement at the catalogue/PDP fetch sites, or as an optional param to the helper.)

### 4. Pricing, stores, cart

- **Pricing** is org-level (`effective_unit_price_for_item(orgId, qty)`), so it follows the overridden context automatically — no per-member price input.
- **Stores** load from the org via service-role; needed only for checkout's `ship_to_store_id` validation, which never runs because submit is blocked. Populating `storeIds` is enough for the checkout page to render.
- **Cart** is React context + `localStorage` keyed `pr-cart:${org}` (no DB). In preview, use a **preview-scoped key** (`pr-cart-preview:${org}`) so a previewing staffer (who might also be a real customer in that org) never pollutes a real cart.

### 5. Audit

Mint endpoint calls existing `recordAuditEvent`:
- `action: 'member.preview_as'` (new entry in `AUDIT_ACTIONS` as `PREVIEW_AS_MEMBER`)
- `actor_user_id`: staff user · `org_id`: org · `target_type: 'user_organizations'` · `target_id`: membershipId
- `metadata`: `{ role, ordering_permission, launched_from: 'catalogue_editor' | 'member_row', catalogue_item_id? }`

Appears on the existing `/audit` page — no new table, no new UI.

---

## Components & files

### Staff portal (`print-room-staff-portal`)
- **New** `src/lib/preview/sign.ts` — HMAC sign (Node `crypto.createHmac`); no signing util exists today.
- **New** `src/app/api/preview-token/route.ts` — staff-auth, mint, `recordAuditEvent`, return URL.
- **New** `PreviewLauncher` component (member picker: name · role · `ordering_permission`) — mounted near Publish/Save in `src/components/catalogues/CatalogueItemEditor.tsx` (~line 650; `catalogue.organization_id` + `organization` already in scope).
- **Edit** `src/components/b2b-accounts/MembersPanel.tsx` — add a "Preview as" row action (membership already in scope; reuses members API which already carries `ordering_permission`).
- **Edit** `src/lib/audit/actions.ts` — add `PREVIEW_AS_MEMBER: 'member.preview_as'`.
- **Env** `PREVIEW_TOKEN_SECRET` (new); `CUSTOMER_PORTAL_URL` (exists).

### Customer portal (`print-room-portal`)
- **New** `lib/preview/verify.ts` — HMAC verify + payload decode.
- **New** `lib/preview/cookie.ts` — read/set/clear `pr_preview`.
- **New** `app/preview/route.ts` — verify → set cookie → redirect (PDP or `/catalogue`).
- **New** `app/preview/exit/route.ts` — clear cookie → redirect.
- **Edit** `lib/checkout/server.ts` — preview branch in `requireB2BCustomer` / `requireB2BCustomerCached` (read, honour cookie via service-role, stamp `isPreview`/`previewItemId`); `requireB2BCustomerApi` rejects cookie.
- **Edit** visible-set call sites in `app/(portal)/catalogue/page.tsx` and `app/(portal)/catalogue/[productId]/page.tsx` (union in-edit item).
- **New** `PreviewBanner` component, mounted in the `(portal)` layout when the cookie is present.
- **Edit** checkout Place-order control → "Preview only" disabled state in preview; toast backstop on any write 403.
- **Edit** `components/cart/CartProvider.tsx` — preview-scoped storage key.
- **Edit** write routes/actions to surface the 403 cleanly (`/api/checkout`, `/api/checkout/reorder-request`, `account` actions, `my-collections` actions).
- **Env** `PREVIEW_TOKEN_SECRET` (new, same value as staff).

---

## Token format (precise)

```
token   = base64url(JSON(payload)) + "." + base64url(HMAC_SHA256(base64url(JSON(payload)), PREVIEW_TOKEN_SECRET))
payload = { v:1, org, target:{kind:'member', membershipId}, ret?:{itemId}, purpose:'preview', iat, exp, nonce }
```
Verify: constant-time compare the signature; reject if `purpose !== 'preview'`, `exp < now`, or signature mismatch. `nonce` + `iat` give per-mint uniqueness (no DB single-use tracking in phase 1).

---

## Read-only enforcement (precise)

1. **Server, primary:** write gate (`requireB2BCustomerApi` + writing server actions) returns `403 { error: 'preview only' }` whenever `pr_preview` is present. Reads (`requireB2BCustomerCached`) accept it. → no mutation possible, no partial writes.
2. **Client, polish:** Place-order (and the few obvious write buttons) render disabled, labelled **"Preview only"**. Any other write a previewer hits shows a toast **"Preview only — nothing was saved."**
3. **Cart isolation:** preview-scoped localStorage key.

---

## Copy

- **Banner (all pages):** `Preview only — viewing as {full_name} ({role} · {ordering_permission}). No changes are saved. · Exit preview`
- **Blocked write buttons:** `Preview only` (disabled)
- **Toast backstop:** `Preview only — nothing was saved.`
- **Expired/invalid token page:** `This preview link has expired. Generate a new one from the staff portal.`

---

## Security

- Only staff can mint (staff-portal auth on the mint route).
- Org-scoped: token names the org; can't cross into another org's members.
- `PREVIEW_TOKEN_SECRET` and the service-role key are server-only; all override logic is server-side.
- Cookie: httpOnly, SameSite=Lax, secure, 30-min max-age.
- A real customer with no cookie sees the normal store; they cannot forge the cookie (no secret).
- Preview cookie precedence; "Exit preview" restores the normal session.
- One `audit_events` row per mint.

---

## Edge cases

- Expired/tampered/wrong-secret token → friendly expiry page.
- No cookie → normal store, untouched.
- Staff who is also a logged-in customer in that org → preview cookie wins; exit restores.
- `org_admin` target → all active items (helper already bypasses grants).
- Pending invite target → works (it's a real `user_organizations` row pre-login).
- Draft in-edit item → visible only via the editor-launch union; not leaked to normal members.
- Checkout store validation never executes (submit blocked), so a sparse store set is fine.

---

## Testing

- **Unit:** token sign/verify (valid / tampered / expired / wrong-purpose / wrong-secret); context override builds correct member context; write gate rejects on preview; cart key isolation.
- **Integration:** `stock_only` staff on `made_to_order` → dead-zone + Place-order blocked; `reorder_only` on `stocked` → dead-zone; `org_admin` → all catalogues + multi-store; editor-launched draft item visible; real customer session unaffected by an active preview.

---

## Repo & autopush constraints (build-time)

- **Staff portal `AGENTS.md`:** "This is NOT the Next.js you know" — read `node_modules/next/dist/docs/` before writing code. **UI work must satisfy `docs/ui/oem-rules.md`** pre-flight checklist (the `PreviewLauncher` button + picker are `.tsx`).
- **Autopush hazard (both repos):** the harness auto-commits/pushes the checked-out branch to its upstream at turn boundaries; a feat branch off master inherits `origin/master` → commits can hit PROD. Build on feature branches with upstream **unset/repointed**; never commit on a master-tracking branch; main agent commits (not subagents).
- This spec is staged in the plans dir; mirror into each repo's `docs/superpowers/specs/` only once on a safe branch.

---

## Phasing

- **Phase 1 (MVP):** real-member preview, both entry points, full read-only walkthrough, "Preview only" chrome, audit row, banner.
- **Phase 2:** synthetic/custom profile — parallel granted-items path (no membership row), fabricated context (role + ordering_permission + chosen grants + org stores), profile-builder form reusing the catalogue-grant tree API.

---

## To verify at build start

- Enumerate every writing server action under `(portal)/account` and `(portal)/my-collections` and confirm each routes through a gate that rejects preview (or add an explicit `assertNotPreview`).
- Confirm the exact `(portal)` layout file to mount `PreviewBanner`.
- Confirm `requireB2BCustomerApi` is the sole write gate, or list server actions that call `requireB2BCustomer` directly so they're guarded too.
