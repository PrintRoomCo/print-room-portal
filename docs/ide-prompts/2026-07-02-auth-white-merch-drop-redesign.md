# IDE prompt — redesign the auth pages (sign-in + "sign up"): all-white, keep the spinning cog, add a dropping merch pile, clean/flat form

> Paste everything below the line into your in-repo IDE agent (run it inside `print-room-portal`).
> This restyles the **sign-in** and **request-access** ("sign up") pages. They currently share one component (`AuthBrandPanel`) and the same split-screen shell, so both change together. Keep every auth behaviour (email-code + password flows, hCaptcha, the captcha-free fallback, redirects, links) exactly as-is — this is a **visual** redesign only.

---

## Objective

Replace the two-column "blue brand panel + grey form" auth layout with a single **all-white** page:

- The existing **spinning gear cog stays** (same geometry + 22s spin), recoloured for white and holding the page heading in its centre.
- Five **flat vibrant cutout illustrations** — tee, hoodie, mug, drink bottle, lanyard — **drop in from above the top of the screen and settle into an overlapping, tilted row along the bottom edge** ("merch shelf", cropped by the floor), like the reference.
- The form is centred and restyled **clean & flat** (hairline-bordered fields, more whitespace), and the buttons are unified to a calm charcoal.

Reference aesthetic: flat single-colour cutout silhouettes on white (à la the Koto/"People Doing Things" bottom-row art), but with our own merch objects and our own composition.

## Design decisions (already settled — don't re-litigate)

- **Scope:** both `/sign-in` and `/request-access` (incl. its success state). No other auth pages.
- **Layout:** normal document flow — a `min-h-screen` flex **column**: cog+heading (top) → logo → form (centre) → merch pile (floor via `mt-auto`). **No fixed/absolute positioning for layout.** The long request-access form just grows the page; the pile lands at the bottom. No collisions.
- **Cog:** unchanged geometry + `animate-spin-slow`; recolour to a **pale brand-blue solid disc** with the heading in **charcoal**; ~180px on both pages.
- **Pile:** 5 flat cutouts, overlapping + tilted + bottoms cropped by the screen edge. **Animate with framer-motion** (spring + stagger), gated on `useReducedMotion()`. Decorative → `aria-hidden` + `pointer-events-none`, layered **behind** the form.
- **Colours (flat, one per item):** tee `#FF8FA3`, hoodie `#5AA9E6`, mug `#A3D63B`, bottle `#FF9F45`, lanyard `#45C4B0`.
- **Fields:** hairline-bordered flat fields, as **NEW classes** — do **not** touch the shared `.input-glass`/`.textarea-glass` (used in 11 files across the portal). Keep real `<label htmlFor>` associations.
- **Buttons:** unified **charcoal** (`--color-primary`), sentence-case, calm shadow, keep the rounded-full pill. Do **not** touch the shared `.btn-primary/.btn-accent/.btn-hero` (used in 7 non-auth files).
- **Removed:** the split screen, the blue panel background, the yellow diamond, the copyright footer.

## Where the code is (verify before editing)

- `components/auth/AuthBrandPanel.tsx` — the shared blue side panel (cog + heading + yellow diamond + copyright). **Rename → `components/auth/AuthScene.tsx`** and rebuild as the white full-page stage (below). Keep `gearPath` + `COG_D` **exactly** (unchanged maths → identical SSR/client string, no hydration drift).
- `app/(auth)/sign-in/SignInClient.tsx` — split-screen shell at the `return`: `<div className="min-h-screen flex"><AuthBrandPanel … /> <div className="flex-1 … bg-gray-50">…form…</div></div>`. Swap the shell for `<AuthScene>`, restyle fields/tabs/button. **Keep** all state, the three form variants (`password`, code `request`, code `verify`), hCaptcha, error/info banners, and the links.
- `app/(auth)/request-access/RequestAccessClient.tsx` — same split-screen shell in **both** the success branch and the main form. Swap both to `<AuthScene>`, restyle fields/selects/textarea/toggle/button. **Keep** all state, `submitAccessRequest`, the customer-type toggle logic, the industry/volume/referral options, hCaptcha, and — importantly — the exact accessible text the test relies on (see Constraints).
- `app/globals.css` — add the new `.auth-field` / `.auth-btn` classes (in the existing `@layer components`). Do not modify `.input-glass`, `.textarea-glass`, or the `.btn-*` classes.
- `tailwind.config.ts` — `spin-slow` (22s) already exists. **Do not change it.**
- `package.json` — `framer-motion@^12` is already installed.

## The changes

### 1. `components/auth/AuthScene.tsx` (renamed from `AuthBrandPanel.tsx`)

Keep `gearPath` and `const COG_D = gearPath(100, 100, 74, 94, 11)` byte-for-byte. Replace the component body:

```tsx
import Image from 'next/image'
import MerchPile from './MerchPile'

// … keep gearPath(...) and COG_D exactly as they are in the current file …

export default function AuthScene({
  heading,
  children,
}: {
  heading: string
  children: React.ReactNode
}) {
  return (
    <div className="relative flex min-h-screen w-full flex-col items-center overflow-hidden bg-white px-4 py-10 sm:py-12">
      {/* Cog hero. The <svg> is decorative (aria-hidden); the heading is a real,
          announced <h1> layered over it — keep them as SIBLINGS so the h1 is read. */}
      <div className="relative flex items-center justify-center">
        <svg
          viewBox="0 0 200 200"
          className="h-44 w-44 animate-spin-slow text-pr-blue/10 motion-reduce:animate-none sm:h-48 sm:w-48"
          fill="currentColor"
          aria-hidden
        >
          <path
            d={COG_D}
            stroke="currentColor"
            strokeWidth={7}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center px-6">
          <h1 className="max-w-[9rem] text-center text-2xl font-bold leading-[1.05] tracking-heading text-pr-charcoal sm:max-w-[11rem] sm:text-3xl">
            {heading}
          </h1>
        </div>
      </div>

      {/* Logo */}
      <Image
        src="/print-room-logo.png"
        alt="The Print Room"
        width={128}
        height={32}
        style={{ width: 'auto', height: 'auto' }}
        className="mt-6 h-7 w-auto"
      />

      {/* Form slot — centred in the space between the hero and the pile.
          Each page sets its own max-width on its inner wrapper. */}
      <div className="z-10 flex w-full flex-1 items-center justify-center py-8">
        {children}
      </div>

      {/* Merch pile — decorative floor, layered BEHIND the form (z-0). */}
      <MerchPile />
    </div>
  )
}
```

### 2. `components/auth/merch-shapes.tsx` (new) — the 5 cutout silhouettes

Flat single-fill silhouettes on a `0 0 100 100` grid. **These path strings are STARTERS** — drop them in, then refine each with the screenshot check until it clearly reads as the object (simple bold silhouettes, no interior detail). Mug uses `fillRule="evenodd"` for the handle hole.

```tsx
type ShapeProps = React.SVGProps<SVGSVGElement>

export function Tee(props: ShapeProps) {
  return (
    <svg viewBox="0 0 100 100" fill="currentColor" aria-hidden {...props}>
      <path d="M38 12 L28 16 L10 28 L18 42 L30 36 L30 88 L70 88 L70 36 L82 42 L90 28 L72 16 L62 12 C58 20 42 20 38 12 Z" />
    </svg>
  )
}

export function Hoodie(props: ShapeProps) {
  return (
    <svg viewBox="0 0 100 100" fill="currentColor" aria-hidden {...props}>
      <path d="M36 16 L26 18 L8 30 L17 45 L30 40 L28 90 L72 90 L70 40 L83 45 L92 30 L74 18 L64 16 C64 3 36 3 36 16 Z" />
    </svg>
  )
}

export function Mug(props: ShapeProps) {
  return (
    <svg viewBox="0 0 100 100" fill="currentColor" fillRule="evenodd" aria-hidden {...props}>
      <path d="M28 22 h30 a8 8 0 0 1 8 8 v40 a10 10 0 0 1 -10 10 h-26 a10 10 0 0 1 -10 -10 v-40 a8 8 0 0 1 8 -8 Z M66 34 a14 14 0 0 1 0 28 v-7 a7 7 0 0 0 0 -14 Z" />
    </svg>
  )
}

export function Bottle(props: ShapeProps) {
  return (
    <svg viewBox="0 0 100 100" fill="currentColor" aria-hidden {...props}>
      <path d="M42 8 h16 a3 3 0 0 1 3 3 v6 h-22 v-6 a3 3 0 0 1 3 -3 Z M40 18 h20 a8 8 0 0 1 8 8 v58 a8 8 0 0 1 -8 8 h-20 a8 8 0 0 1 -8 -8 v-58 a8 8 0 0 1 8 -8 Z" />
    </svg>
  )
}

export function Lanyard(props: ShapeProps) {
  return (
    <svg viewBox="0 0 100 100" fill="currentColor" aria-hidden {...props}>
      <path d="M30 6 L50 40 L70 6 L61 6 L50 26 L39 6 Z M45 38 h10 v9 h-10 Z M30 47 h40 a4 4 0 0 1 4 4 v37 a4 4 0 0 1 -4 4 h-40 a4 4 0 0 1 -4 -4 v-37 a4 4 0 0 1 4 -4 Z" />
    </svg>
  )
}
```

### 3. `components/auth/MerchPile.tsx` (new) — the drop + pile

Client component (framer-motion). Items overlap via negative `space-x`, sit on the floor (`items-end`), and are cropped by `AuthScene`'s `overflow-hidden` (nudged down with `translate-y`). The drop triggers on-enter (`whileInView` + `once`) so it plays on sign-in load **and** when the pile scrolls into view on the long request-access page. Reduced-motion → render already-settled.

```tsx
'use client'

import { motion, useReducedMotion } from 'framer-motion'
import { Tee, Hoodie, Mug, Bottle, Lanyard } from './merch-shapes'

const ITEMS = [
  { Shape: Tee, color: '#FF8FA3', tilt: -8 },
  { Shape: Hoodie, color: '#5AA9E6', tilt: 6 },
  { Shape: Mug, color: '#A3D63B', tilt: -4 },
  { Shape: Bottle, color: '#FF9F45', tilt: 8 },
  { Shape: Lanyard, color: '#45C4B0', tilt: -6 },
]

export default function MerchPile() {
  const reduce = useReducedMotion()
  return (
    <div
      aria-hidden
      className="pointer-events-none relative z-0 mt-auto flex w-full max-w-2xl translate-y-3 items-end justify-center -space-x-5 sm:translate-y-5 sm:-space-x-7"
    >
      {ITEMS.map(({ Shape, color, tilt }, i) => (
        <motion.div
          key={i}
          className="w-20 origin-bottom drop-shadow-[0_10px_16px_rgba(0,0,0,0.10)] sm:w-28"
          style={{ color }}
          initial={reduce ? false : { y: '-110vh', rotate: 0 }}
          whileInView={{ y: 0, rotate: tilt }}
          viewport={{ once: true, amount: 0.3 }}
          transition={
            reduce
              ? { duration: 0 }
              : { type: 'spring', stiffness: 110, damping: 13, delay: i * 0.12 }
          }
        >
          <Shape className="h-auto w-full" />
        </motion.div>
      ))}
    </div>
  )
}
```

### 4. `app/globals.css` — new auth-only classes (inside `@layer components`)

```css
  /* Auth redesign — flat, clean fields + button. Scoped names so they don't
     touch the shared .input-glass / .btn-* used across the portal. */
  .auth-field {
    @apply w-full rounded-lg border border-[hsl(var(--border))] bg-white px-4 py-2.5 text-foreground placeholder:text-gray-400 transition-colors duration-200;
  }
  .auth-field:focus {
    @apply border-[rgb(var(--color-primary))] outline-none;
    box-shadow: 0 0 0 3px rgba(30, 35, 38, 0.08);
  }
  select.auth-field {
    @apply cursor-pointer appearance-none;
  }
  textarea.auth-field {
    @apply resize-none;
  }

  .auth-btn {
    @apply inline-flex w-full items-center justify-center rounded-full bg-[rgb(var(--color-primary))] px-6 py-3 text-sm font-semibold text-white transition-all duration-300 hover:bg-[rgb(var(--color-primary-dark))] disabled:cursor-not-allowed disabled:opacity-50;
    transition-timing-function: cubic-bezier(0.16, 1, 0.3, 1);
  }
  .auth-btn:hover {
    box-shadow: var(--shadow-md);
  }
```

### 5. `SignInClient.tsx` — swap the shell + restyle (keep ALL logic)

- Replace the outer `return (<div className="min-h-screen flex"> … </div>)` shell with:

```tsx
return (
  <AuthScene heading="Welcome Back">
    <div className="w-full max-w-md">
      {/* logo block is now in AuthScene — delete the in-form logo <Image> */}
      {/* …mode tabs, banners, and the three form variants… */}
    </div>
  </AuthScene>
)
```

- Update the import: `import AuthScene from '@/components/auth/AuthScene'` (remove the `AuthBrandPanel` import and the in-form logo `<Image>`).
- **Mode tabs** (Email code / Password): replace the grey pill with a flat segmented control:

```tsx
<div className="mb-8 inline-flex w-full rounded-full border border-[hsl(var(--border))] p-1 text-sm">
  {(['code', 'password'] as const).map((m) => (
    <button
      key={m}
      type="button"
      onClick={() => switchMode(m)}
      className={`flex-1 rounded-full px-4 py-2 font-medium transition ${
        mode === m ? 'bg-[rgb(var(--color-primary))] text-white' : 'text-gray-500 hover:text-gray-800'
      }`}
    >
      {m === 'code' ? 'Email code' : 'Password'}
    </button>
  ))}
</div>
```

- Every form input: `className="input-glass"` → `className="auth-field"` (the code-input keeps its extra `tracking-widest text-center text-lg`).
- Every submit button: replace the long inline blue-uppercase class with `className="auth-btn mt-8"`, and change the label text from `Sign In` → `Sign in` (sentence case; loading text stays "Signing in…" etc.).
- Keep the info/error banners, "Forgot password?", "Use a different email", and "Request access" links (they can keep their current link styling or switch the blue to `text-pr-charcoal underline-offset-4 hover:underline` — your call).

### 6. `RequestAccessClient.tsx` — swap both shells + restyle (keep ALL logic + test contracts)

- Import `AuthScene`; delete the `AuthBrandPanel` import and the in-form logo `<Image>` in both branches.
- **Main form branch:** replace the `<div className="min-h-screen flex"> … </div>` shell with `<AuthScene heading="Join Us"><div className="w-full max-w-lg">…</div></AuthScene>`. Keep the "Request B2B Access" `<h2>` + description inside the form area.
- **Success branch:** wrap in `<AuthScene heading="Join Us"><div className="w-full max-w-md text-center">…</div></AuthScene>`; keep the check-circle, heading, message, and the "Back to Sign In" link (restyle the link with `auth-btn` or leave as a charcoal link).
- Fields: every `input-glass`/`textarea-glass` → `auth-field`. The three `<select className="input-glass appearance-none cursor-pointer">` → `<select className="auth-field">` (the class already handles appearance/cursor).
- **Customer-type toggle** (Company / Individual-Creative): keep the logic; restyle to the same flat segmented control as the sign-in tabs (charcoal active, `text-gray-500` inactive).
- Submit button → `auth-btn`; label `Submit Request` → `Submit request` (still matches the test's case-insensitive `/submit request/i`). Keep the "Trouble with the captcha?…" button and its exact text.

## Constraints — do not break these

- **Keep `gearPath` + `COG_D` byte-identical** and keep `animate-spin-slow` + `motion-reduce:animate-none` on the cog `<svg>`. Do not edit `tailwind.config.ts`.
- The cog `<svg>` stays `aria-hidden`; the `<h1>` heading stays a **sibling** (not inside the hidden svg) so it's announced. One `<h1>` per page.
- **Do not modify** the shared `.input-glass`, `.textarea-glass`, `.btn-primary`, `.btn-accent`, `.btn-hero` (used across the portal). Only add the new `.auth-*` classes.
- **Preserve the request-access test contracts** (`app/(auth)/request-access/__tests__/RequestAccessClient.test.tsx`): real associated labels for First name / Last name / Email / Company name (`getByLabelText` must still work — keep `<label htmlFor>` + matching `id`, no placeholder-only fields); the button text **"Trouble with the captcha? Send us your request via email"**; the submit button matching `/submit request/i`; and hCaptcha still rendering.
- Decorative art (cog + pile) is `aria-hidden` + `pointer-events-none`. The form stays fully interactive and above the pile (`z-10` vs `z-0`).
- **SSR/hydration:** `MerchPile` is `'use client'`; its `initial` state is static (no window/measurement), so server render is deterministic and items just animate in on the client. No `Date.now()`/`Math.random()` anywhere in the shapes/pile.
- **Reduced motion:** cog stops (existing `motion-reduce`), pile renders already-settled (the `useReducedMotion()` branch).
- Charcoal = `rgb(var(--color-primary))`; brand yellow is **never** used as text. All five fills stay flat single colours.
- Remove the yellow diamond, the blue panel background, and the copyright footer. No new npm deps.

## Tunables (adjust after you see it)

- Cog tint: `text-pr-blue/10` → `/15`–`/20` if the disc reads too faint behind the heading. Size: `h-44/h-48`.
- Pile: item widths (`w-20`/`w-28`), overlap (`-space-x-*`), crop depth (`translate-y-*`), per-item `tilt`, and the exact five hex colours.
- Drop feel: spring `stiffness`/`damping` and the `delay: i * 0.12` stagger. Want a firmer bounce? lower `damping`.
- Field radius (`rounded-lg`) and the focus-ring alpha.

## Verify

1. `pnpm exec eslint components/auth/AuthScene.tsx components/auth/MerchPile.tsx components/auth/merch-shapes.tsx app/(auth)/sign-in/SignInClient.tsx app/(auth)/request-access/RequestAccessClient.tsx` → 0 errors. Type-check clean.
2. `pnpm test -- request-access` (or `pnpm exec vitest run RequestAccessClient`) → the existing captcha-free-fallback test still **passes** (this proves labels + button texts survived).
3. Run the app and check `/sign-in` and `/request-access` (+ submit it to see the success state):
   - All-white page, no split screen, no blue panel, no diamond, no footer.
   - Cog spins with the heading centred and legible; five vibrant cutouts drop from the top and settle into a tilted, overlapping row cropped by the bottom edge.
   - Fields are hairline-bordered/flat with a clear focus ring; the primary button is charcoal + sentence-case; tabs/toggle are the flat segmented control.
   - Tab through every field: focus is clearly visible; labels read correctly.
   - `prefers-reduced-motion: reduce` (DevTools → Rendering): cog still, pile already-piled (no fall).
   - Optional screenshot check (chromium is installed via `pnpm exec playwright install chromium`):
     ```js
     // ._shot.mjs — node ._shot.mjs "http://localhost:3000/sign-in" out.png ; then delete the file
     import { chromium } from '@playwright/test'
     const b = await chromium.launch()
     const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
     await p.goto(process.argv[2], { waitUntil: 'networkidle' })
     await p.waitForTimeout(1800)
     await p.screenshot({ path: process.argv[3], fullPage: true })
     await b.close()
     ```

## Done when

- [ ] `AuthBrandPanel.tsx` is renamed to `AuthScene.tsx` (white full-page stage); `gearPath`/`COG_D` unchanged; both clients import `AuthScene`.
- [ ] `MerchPile.tsx` + `merch-shapes.tsx` exist; the five silhouettes read clearly and are the five brand colours.
- [ ] On load, the pile drops from above and settles into an overlapping, tilted, floor-cropped row; reduced-motion renders it settled.
- [ ] Both pages are all-white, form centred, cog spinning with a legible charcoal heading; no split screen / diamond / footer.
- [ ] Fields use `.auth-field`, buttons use `.auth-btn` (charcoal, sentence-case); tabs + customer-type toggle are the flat segmented control; shared `.input-glass`/`.btn-*` untouched.
- [ ] request-access success state also uses `AuthScene`; the existing vitest test passes; eslint/type-check clean; no hydration warning; no new deps.
