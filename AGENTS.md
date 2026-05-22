# Agent guide — print-room-portal

This is **not** the Next.js you may remember. The repo runs **Next 16**, which
shipped breaking changes to caching, view transitions, and data-fetching
conventions. Before writing code that touches any of those, read the bundled
docs in `node_modules/next/dist/docs/` — your training data is likely stale.

## Read these before editing

Specifically, before touching cache or transition code:

```bash
cat node_modules/next/dist/docs/01-app/03-api-reference/04-functions/unstable_cache.md
cat node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidateTag.md
cat node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/viewTransition.md
cat node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/loading.md
```

## What the bundled docs nail down

- **`unstable_cache(fn, keyParts, { tags, revalidate })`** still works as a
  legacy path in Next 16. The new `'use cache'` directive needs
  `cacheComponents: true` in `next.config.mjs` — out of scope at the moment.
- **`revalidateTag(tag, profile)`** is now two-arg. The single-arg form is
  deprecated. Use `{ expire: 0 }` for immediate invalidation:
  ```ts
  import { revalidateTag } from 'next/cache'
  revalidateTag('order-tracker', { expire: 0 })
  ```
- **`experimental.viewTransition: true`** in `next.config.mjs` wires
  `document.startViewTransition()` into client-side navigations. The fade is
  driven by CSS `::view-transition-old(root)` / `::view-transition-new(root)`
  in `app/globals.css`, plus `view-transition-name` via the
  `data-vt-name="…"` attributes on persistent shell elements (Sidebar,
  PortalTopBar, cart pill).
- **`loading.tsx` wraps `page.tsx` + nested layouts in a `<Suspense>`
  boundary, but does NOT wrap the parent `layout.tsx`.** If the layout
  awaits uncached data, navigation **blocks on the layout** before any
  loading.tsx fallback can show. Move uncached data into the page, or wrap
  the layout's data access in its own `<Suspense>`.

## Caching conventions in this repo

- Tag constants live in [`lib/cache/tags.ts`](lib/cache/tags.ts). Use them —
  do not hand-roll string tags at call sites.
- `unstable_cache` only accepts **static tags** at registration. Coarse
  invalidation (per dataset, not per user) is the trade-off. Per-user
  precision needs `'use cache'` + `cacheTag()`, which is a future sprint.
- Cached server functions must not call `cookies()` / `headers()` inside.
  Resolve the user / auth in an outer wrapper, then call the cached fn with
  explicit args. See [`lib/portal-data.ts`](lib/portal-data.ts) for the
  pattern (`fetchOrderTrackerDataForUser`, `fetchAccountDataForUser`).

## Skeleton + view-transition conventions

- Shared `Skeleton` primitive at [`components/ui/Skeleton.tsx`](components/ui/Skeleton.tsx).
  Use it instead of bare `animate-pulse` divs for content shimmer. Image
  and avatar placeholders that are square/circle masses can keep
  `animate-pulse` — a horizontal shimmer looks off on those shapes.
- Route-shape skeleton components live in
  [`components/ui/PortalRouteSkeletons.tsx`](components/ui/PortalRouteSkeletons.tsx)
  and are wired through `loading.tsx` one-liners.
- Persistent shell elements (Sidebar, top bar, cart pill) carry
  `data-vt-name="…"`; the CSS in `app/globals.css` maps each attribute to
  a `view-transition-name`, so those elements morph rather than crossfade.

## Things to leave alone

- The `(public)/` route group bypasses auth. Don't add a redirect to
  `(portal)/layout.tsx` that would catch public routes.
- Cart is a floating top-right pill scoped to ordering routes (per Jamie's
  feedback memory). Do not move it into the sidebar nav.
- `force-dynamic` was removed from every `(portal)/*` page in this PR —
  pages are still inherently dynamic via cookies / `requireB2BCustomer`.
  Don't reintroduce the export unless you've confirmed Next 16's heuristics
  are over-caching something.
