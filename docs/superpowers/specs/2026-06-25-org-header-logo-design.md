# Org Header Logo — Design Spec

**Date:** 2026-06-25
**Status:** Design approved; awaiting spec review → implementation plan
**Repo:** `print-room-portal`

---

## Problem

The portal's top header bar shows the Print Room brand mark (`/print-room-logo.png`) for every org. Organisations have no way to surface their own branding, so a customer's staff always see the supplier's logo rather than their own company's identity while ordering.

## Goal

Let an **org admin** upload their organisation's logo from the `/account` page. Once set, that logo replaces the Print Room mark **in the top header bar** for every member of that org (and in staff "preview as member" sessions). Admins can also remove the logo to revert to the Print Room default.

## Non-goals

- **Header bar only.** The slide-out `Sidebar`, the favicon, and email templates keep the Print Room mark. (Confirmed with requester.)
- **No broader theming.** Per-org colours, fonts, or a general branding bundle are out of scope — logo only (YAGNI).
- **No image processing.** No server-side crop/resize/optimisation; the uploaded file is stored as-is and fitted with CSS `object-contain`.
- **Not buyer-editable.** Only `org_admin` may change the logo; staff buyers see it but cannot edit.
- **Not for individual / no-org users.** They have no organisation, so `logoUrl` is always null and they keep the default mark.

## Approach

**Server-action upload**, mirroring the existing `createLocationAction` in `app/(portal)/account/actions.ts`.

The file is posted to a new server action via `FormData`; the action validates it, uploads it to public storage with the service-role client, and writes the resulting public URL to `organizations.logo_url`. The URL threads through the existing access pipeline (`organizations` → `getCompanyAccess` → `B2BCustomerAccess` → `/api/company-access` → `useCompany()`) to the header.

**Alternative rejected — signed-URL direct upload** (client requests a signed URL, PUTs straight to storage, then persists the URL; the pattern used by `components/leavers/ArtworkUpload.tsx`). It offloads bytes from the server, which matters for large artwork files — but a logo is small and uploaded rarely, and the direct-upload path splits validation across client and server and adds a second round trip. The server-action path keeps validation in one place and matches the account-page conventions.

---

## Decisions

| Area | Decision |
|---|---|
| **Surfaces** | Top header bar (`PortalTopBar.tsx`) only. Sidebar untouched. |
| **Logo shape** | Wider slot for rectangular/wordmark logos: capped height (~28px) + max-width (~140px), `object-contain`. |
| **Reset** | Admins can remove the logo and revert to the Print Room default. |
| **Who edits** | `org_admin` only — UI-gated and enforced server-side. |
| **Who sees it** | All members of the org, plus staff preview-as-member sessions. |
| **Upload mechanism** | Server action receives the file via `FormData` and uploads server-side. |
| **Storage** | Reuse the existing public `org-artworks` bucket under an `org-logos/{organizationId}/` prefix. |
| **Refresh** | On success the account page reloads so the header repaints (same pattern as the profile save). |

---

## Architecture

Data flow once a logo is set:

```
organizations.logo_url
  → getCompanyAccess()            (lib/company.ts, org branch)
  → B2BCustomerAccess.logoUrl     (types/company.ts)
  → GET /api/company-access       (already returns the whole access object)
  → useCompany().access.logoUrl   (contexts/CompanyContext.tsx)
  → PortalTopBar                  (renders org logo, else Print Room mark)
```

Staff "preview as member" inherits the logo for free: `buildPreviewAccess` (`lib/preview/context.ts`) spreads the result of `getCompanyAccess`, so `logoUrl` carries through with no extra wiring.

### Units of work

**1. Migration — `supabase/migrations/<ts>_organizations_logo_url.sql`**
- `alter table organizations add column logo_url text;` (nullable, no default).

**2. Storage**
- Bucket: existing public `org-artworks`.
- Object key: `org-logos/{organizationId}/logo-{timestamp}.{ext}` where `{ext}` derives from the validated file type.
- Public URL via `storage.from('org-artworks').getPublicUrl(key)`.

**3. Access type & builder**
- `types/company.ts`: add `logoUrl: string | null` to `B2BCustomerAccess`.
- `lib/company.ts`: add `logoUrl` to `AccessInput` and pass it through `buildAccess`. In `getCompanyAccess`, set it from `org.logo_url` in the company-membership branch; set `null` in the individual / no-org / soft-deleted-org branches and in `buildAccessForIndividual`.
- No change needed in `/api/company-access/route.ts` (returns the whole object) or `CompanyContext.tsx`.

**4. Header — `components/layout/PortalTopBar.tsx`**
- Import and call `useCompany()`.
- Centre brand link: if `access?.logoUrl`, render an `Image` (or `<img>`) of the org logo with `className="h-7 w-auto max-w-[140px] object-contain"` and `alt={access.companyName ?? ''}`. Otherwise render the existing Print Room `Image` unchanged.
- The link target (`/account`) and surrounding layout stay the same.

**5. Admin UI — `app/(portal)/account/AccountClient.tsx`**
- New "Organisation logo" card, rendered only when `access.isCompanyUser && access.isOrgAdmin`.
- Contents:
  - Current state: a preview of `access.logoUrl`, or the text "Using the Print Room default" when null.
  - A file `<input accept="image/png,image/jpeg,image/webp,image/svg+xml">` to upload/replace, wired to `updateOrgLogoAction` (submit on file selection or via a Save button).
  - A **Remove** button shown only when `access.logoUrl` is set, wired to `removeOrgLogoAction`.
  - Success/error boxes using the existing `glass-success-box` / `glass-error-box` patterns.
- On a successful upload or removal, `window.location.reload()` so the top bar repaints (consistent with the profile-save flow already in this file).

**6. Server actions — `app/(portal)/account/actions.ts`**
- `updateOrgLogoAction(formData): Promise<ActionResult>`
  1. `isPreviewRequest()` guard → "Preview only — nothing was saved."
  2. Auth: `getSupabaseServerComponent().auth.getUser()`.
  3. Load `user_organizations` membership (org id + role).
  4. Require `membership.role === 'org_admin'` (server mirror of the UI gate).
  5. Read `formData.get('logo')` as a `File`; validate type ∈ {png, jpeg, webp, svg+xml} and size ≤ 2 MB; reject otherwise.
  6. Upload to `org-artworks` at `org-logos/{organizationId}/logo-{timestamp}.{ext}` with the service-role client (`getSupabaseServer()`), `upsert: true`.
  7. Resolve the public URL and `update organizations set logo_url = <url> where id = <organizationId>`.
  8. Revalidate the account-data cache tag (consistent with `createLocationAction`); the header refresh is handled by the client reload.
  9. Return success/error `ActionResult`.
- `removeOrgLogoAction(): Promise<ActionResult>`
  - Same guards (preview, auth, membership, `org_admin`).
  - Set `organizations.logo_url = null`; best-effort delete the stored object (failure to delete does not fail the action).
  - Revalidate; return `ActionResult`.

**7. Tests — `app/(portal)/account/__tests__/actions.test.ts`**
- `updateOrgLogoAction`: rejects when role is not `org_admin`; rejects an over-size or wrong-type file; happy path writes `logo_url` and returns success.
- `removeOrgLogoAction`: rejects non-admin; happy path nulls `logo_url`.
- Follow the mocking style already in that test file.

## Error handling

- **Not authenticated / no membership / not admin** → `{ success: false, errors: [...] }`, surfaced in the card's error box. The server check is the source of truth; the UI gate is convenience only.
- **Invalid file (type/size)** → rejected server-side with a clear message; nothing is uploaded or written.
- **Storage upload failure** → log and return a generic failure; `logo_url` is left unchanged.
- **Remove with a stale/already-deleted object** → object delete is best-effort; nulling `logo_url` still succeeds.
- **Broken/blocked logo URL at render** → header shows whatever `next/image` renders; no JS fallback in v1 (acceptable — the admin controls the source and can re-upload or remove).

## Testing strategy

- Unit tests for both server actions as above (Vitest, matching `actions.test.ts`).
- Manual verification: upload a wide logo and a square logo as an org admin → confirm the top bar swaps and the sidebar does not; remove → confirm revert to the Print Room mark; confirm a staff buyer sees the logo but has no edit card; confirm an individual user is unaffected.

## Rollout / migration notes

- The migration is purely additive (one nullable column); existing orgs default to `null` and keep the Print Room mark until an admin uploads one.
- No backfill required.
