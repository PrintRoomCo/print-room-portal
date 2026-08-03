# Edit location addresses on `/account`

**Date:** 2026-08-04
**Status:** Approved — ready for implementation plan

## Problem

The `/account` page shows a **Default Address** card (the org's first location) and,
for org admins, a **Locations** grid. Today there is no way to *edit* an existing
location's address anywhere — the Locations section only supports *adding* new
locations. Customers who need to correct or update their default shipping address
have no self-service path.

## Goal

Let org admins edit any of their organisation's location addresses — including the
default (the oldest location) — from `/account`, via a pre-filled modal that reuses
the existing Add Location form. Buyers and staff continue to see addresses
read-only.

## Decisions

- **Who can edit:** org admins only. Mirrors the existing gate — `createLocationAction`
  already rejects non-admins server-side, and address edits change the org-wide
  shipping address everyone sees. Buyers/staff keep the read-only view.
- **Scope:** every location is editable (each Locations card **and** the Default
  Address card get an Edit affordance). The default address is also the first card
  in the Locations grid, so scoping edit to "only the default" would leave the other
  cards inconsistently un-editable. Same action and form for all of them.
- **UI:** a modal dialog reusing the Add Location form's styling and all seven fields,
  pre-filled with current values. Roomier than the compact card and consistent with
  the add flow.

## Data model (current, unchanged)

The "default address" is `stores[0]` — the organisation's oldest row in the `stores`
table (`order('created_at', { ascending: true })`). There is **no** `is_default`
column; "default" is purely "oldest". This spec does not add one.

`stores` columns touched by the form:

| Form field   | Column        | Notes                                             |
|--------------|---------------|---------------------------------------------------|
| Location Name| `name`        | required                                          |
| Street       | `address`     | address line 1                                    |
| Unit / Suite | `location`    | address line 2                                    |
| City         | `city`        |                                                   |
| Region       | `state`       | stored as the region **name** (e.g. "Auckland")   |
| Postal Code  | `postal_code` |                                                   |
| Phone        | `phone`       | normalised to E.164 (`+64…`)                      |
| —            | `country`     | hardcoded `'New Zealand'` (form is NZ-only)       |

## Components

### 1. `updateLocationAction(formData)` — `app/(portal)/account/actions.ts`

New server action mirroring `createLocationAction`:

1. `isPreviewRequest()` guard → auth (`getSupabaseServerComponent`) → membership
   lookup (`user_organizations`) → `role === 'org_admin'` (else reject).
2. Read `storeId`; reject if blank. Read + trim `storeName`; reject if blank.
   Read the remaining fields and apply the **same** mapping as create
   (`address`←street, `location`←unit, `state`←region name via `NZ_REGIONS`,
   `country`='New Zealand', phone via `formatPhoneE164`).
3. **Org-scoped update** (the security boundary — service-role client bypasses RLS):

   ```ts
   await adminClient
     .from('stores')
     .update({ name, address, location, city, state, country: 'New Zealand', postal_code, phone })
     .eq('id', storeId)
     .eq('organization_id', membership.organization_id)
   ```

   The double `.eq()` means a forged `storeId` belonging to another org matches no
   row and updates nothing — an admin can only edit their own org's stores.
4. On success: `revalidateTag(cacheTags.accountData, { expire: 0 })`.
   `cacheTags.companyAccess` is **not** busted: it carries `locationIds`/logo, not
   address fields, and an edit changes neither the set of location IDs nor the logo.
   (Create busts it because it adds a new location ID; an edit does not.)

Returns the shared `ActionResult` shape.

### 2. `components/account/LocationFormModal.tsx` — shared add/edit modal

`AccountClient.tsx` is ~940 lines and embeds the Add Location form as a large inline
block. Rather than duplicate that markup for edit, extract **one** modal component
that serves both flows:

- Props: `mode: 'add' | 'edit'`, `store?: Store` (required in edit mode), `open`,
  `onClose`, `onSuccess`.
- Renders the Dialog + seven fields (`NZ_REGIONS` select included), pre-filled from
  `store` when `mode === 'edit'`.
- Owns its own submit/loading/result state and calls `createLocationAction` or
  `updateLocationAction` (passing a hidden `storeId`) depending on `mode`.
- Title/submit label switch on mode ("Add New Location" / "Create Location" vs
  "Edit Location" / "Save Changes").

**Region pre-fill helper** — `regionCodeFromState(state)`:
- Reverse-map the stored `state` (a region *name*) to its `NZ_REGIONS` code so the
  `<select>` shows the right option. Try name match, then code match.
- If it matches nothing (legacy/free-text data), inject the current value as a
  pre-selected `<option>` so submitting round-trips it. On save, `NZ_REGIONS.find`
  won't match, and `state = region?.name || regionCode` falls back to the raw value —
  no silent data loss.

Extracting this shrinks `AccountClient` and removes the add/edit duplication.

### 3. `AccountClient.tsx` wiring

- Replace the ad-hoc add-modal state with the shared modal, driven by a single piece
  of state: e.g. `modalState: { mode: 'add' } | { mode: 'edit', store: Store } | null`.
- **Default Address card:** add an **Edit** button (styled like the Profile card's
  `text-[rgb(var(--color-primary))]` link) shown only when `access.isOrgAdmin` and a
  `primaryStore` exists. Opens the modal in edit mode for `primaryStore`.
- **Locations grid:** add an **Edit** link to each store card, shown only for
  `access.isOrgAdmin` (the section is already gated by `access.canViewLocations`).
- On success: close the modal and call `fetchAccountData()` to repaint — same pattern
  the current add flow uses.

## Testing

Extend `app/(portal)/account/__tests__/actions.test.ts` (Vitest, existing chainable
Supabase stub) with an `updateLocationAction` suite:

1. **Non-admin rejected** — `role: 'buyer'` → `success: false`, `stores.update` never
   called.
2. **Org-scoped** — happy path asserts the update chain applies both
   `.eq('id', storeId)` and `.eq('organization_id', 'org-1')` (extend the stub's
   `stores` builder to record `update` payload + the `eq` filters).
3. **Validation** — blank `storeId` (and blank `storeName`) → `success: false`, no
   update.
4. **Success** — org admin with valid fields → `success: true`, update called once
   with the mapped payload.

Optionally, a small unit test for `regionCodeFromState` (name match, code match,
unmatched-passthrough).

## Out of scope (YAGNI)

- Re-designating *which* location is the default (would need an `is_default` column;
  default stays "oldest").
- Non-NZ regions / free-text region entry (form is NZ-only, matching the add flow).
- Editing addresses for solo customers with no organisation (they have no `stores`
  row and aren't org admins, so no edit affordance appears).
