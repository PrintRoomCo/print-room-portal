# IDE prompt — make the auth brand-panel "cog" actually look like a cog (not a flower/star)

> Paste everything below the line into your in-repo IDE agent (run it inside `print-room-portal`).
> One focused component change. The shape is shared by the sign-in and request-access ("sign up") pages, so fixing the one component fixes both.

---

## Objective

The rotating grey shape at the top of the auth brand panel is meant to read as a **cog/gear** (à la the Readymag "Getting Started" reference). It currently reads as a **flower / clover / starburst**. Replace the shape generator so it produces a genuine **spur-gear silhouette** — flat tooth tips, straight slanted flanks, flat valleys — with lightly rounded corners for a modern/soft gear. Everything else about the panel (rotation, layout, heading overlay, colours) stays exactly as-is.

## Why the current shape fails (do NOT just retune numbers)

`components/auth/AuthBrandPanel.tsx` builds the outline by modulating the **radius with a cosine** (`rBase + amp*cos(lobes*θ)`) and splining it. A sinusoidal radius mathematically produces **rounded petals** — that's a flower/star, full stop. No value of `amp` / `lobes` / `samplesPerLobe` turns rounded petals into gear teeth. The generator itself is the wrong shape family and must be **replaced**, not tuned. Gear teeth need **flat tops + straight sides + flat gaps**, which a sine wave never has.

## Where the code is (verify before editing)

`components/auth/AuthBrandPanel.tsx`:
- `function cogPath(cx, cy, rBase, amp, lobes, samplesPerLobe)` — the cosine+Catmull-Rom generator. **Replace this whole function** with `gearPath` below.
- `const COG_D = cogPath(100, 100, 87, 10, 12, 6)` — **replace** with the `gearPath(...)` call below.
- `<path d={COG_D} />` inside the `<svg viewBox="0 0 200 200" className="... animate-spin-slow ... motion-reduce:animate-none" fill="currentColor" aria-hidden>` — **keep the svg**, only add the stroke props shown below to the `<path>`.
- The heading overlay (`<div className="absolute inset-0 grid place-items-center px-8"><h2>…</h2></div>`) sits on top and must stay unchanged — so **no centre hole**; the gear body stays solid so the heading has a solid backing.

## The fix

**1. Replace `cogPath` with this `gearPath`** (real gear geometry — flat valley arc → straight rising flank → flat tip arc → straight falling flank, per tooth):

```ts
// Mechanical spur-gear silhouette: flat valleys (arc at rRoot), straight slanted
// flanks, flat tooth tips (arc at rTip). Reads as a cog. A sine-modulated radius
// (the old approach) only makes rounded petals => flower/star, so the generator
// is REPLACED, not retuned. Deterministic; computed once at module load, so the
// `d` string is identical on server and client (no hydration drift).
function gearPath(
  cx: number,
  cy: number,
  rRoot: number, // valley radius (the gaps between teeth)
  rTip: number,  // flat tooth-tip radius
  teeth: number,
): string {
  const pitch = (Math.PI * 2) / teeth
  // Fractions of one tooth pitch, in order: gap → flank → tip → flank. Sum = 1.
  const gTip = 0.3 // width of the flat tooth top
  const gGap = 0.42 // width of the flat valley
  const gFlank = (1 - gTip - gGap) / 2 // 0.14 each — the slanted sides

  const P = (r: number, a: number): string =>
    `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`

  let d = ''
  for (let i = 0; i < teeth; i++) {
    const a0 = i * pitch // bottom-land start (rRoot)
    const a1 = a0 + gGap * pitch // bottom-land end (rRoot)
    const a2 = a1 + gFlank * pitch // top-land start (rTip)
    const a3 = a2 + gTip * pitch // top-land end (rTip)
    const a4 = a3 + gFlank * pitch // == a0 + pitch (rRoot) — next tooth start

    if (i === 0) d += `M${P(rRoot, a0)}`
    d += `A${rRoot.toFixed(2)} ${rRoot.toFixed(2)} 0 0 1 ${P(rRoot, a1)}` // flat valley
    d += `L${P(rTip, a2)}` // rising flank
    d += `A${rTip.toFixed(2)} ${rTip.toFixed(2)} 0 0 1 ${P(rTip, a3)}` // flat tip
    d += `L${P(rRoot, a4)}` // falling flank
  }
  return `${d}Z`
}
```

**2. Replace the `COG_D` constant:**

```ts
// viewBox 0 0 200 200 → centre (100,100). Tip r94 + the 7px round-join stroke
// below (~3.5px) ≈ 97.5px, so it stays inside the 100px half-frame. 11 teeth.
const COG_D = gearPath(100, 100, 74, 94, 11)
```

**3. Round the tooth corners** (turns razor-sharp teeth into the reference's soft gear) by adding a same-colour round-join stroke to the existing `<path>` — the `svg` keeps `fill="currentColor"`:

```tsx
<path
  d={COG_D}
  stroke="currentColor"
  strokeWidth={7}
  strokeLinejoin="round"
  strokeLinecap="round"
/>
```

## Constraints — keep all of this exactly as-is

- `viewBox="0 0 200 200"`, `fill="currentColor"`, `text-gray-200` on the svg (grey shape). Only the `<path>` gains the stroke props above.
- Rotation: `animate-spin-slow` **and** `motion-reduce:animate-none` stay on the svg. Do not touch `tailwind.config.ts` (`spin-slow` keyframe/animation) or the entrance animations.
- The `COG_D` string must stay a **module-load constant** built from pure maths — no `Date.now()` / `Math.random()` / state — so SSR and client render byte-identical (no hydration warning).
- Heading overlay, diamond, logo, copyright, panel container classes: unchanged.
- Component stays server-safe (no `'use client'` needed) and keeps its `heading` / `diamondLabel` props.

## Tunables (only if the look needs nudging after you see it)

- `teeth` — 10–12 (reference ≈ 11–12). More teeth = finer, more mechanical.
- Tooth depth — raise `rRoot` toward `rTip` for shallower teeth, lower it for chunkier teeth (keep `rTip` ≤ ~94 so the stroke stays in-frame).
- `gTip` / `gGap` — bigger `gTip` = wider flat tops; bigger `gGap` = wider gaps. Keep `gFlank` ≥ ~0.10 so flanks don't go vertical.
- Corner softness — `strokeWidth` 5–9 (more = rounder/plumper teeth).

## Verify

1. `pnpm exec eslint components/auth/AuthBrandPanel.tsx` → 0 errors. Type-check clean for this file.
2. Run the app and open `/sign-in` (and `/request-access`). The top shape must have **flat tooth tips and flat valleys with straight sides** and read as a **gear** — not petals, not a starburst. The "Welcome Back" / "Join Us" heading still sits centred and legible on the solid body, and the shape still slowly rotates.
3. Optional screenshot check (chromium is already installed via `pnpm exec playwright install chromium`):
   ```js
   // ._shot.mjs — node ._shot.mjs "http://localhost:3000/sign-in" out.png ; then delete the file
   import { chromium } from '@playwright/test'
   const b = await chromium.launch()
   const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
   await p.goto(process.argv[2], { waitUntil: 'networkidle' })
   await p.waitForTimeout(1500)
   await p.screenshot({ path: process.argv[3] })
   await b.close()
   ```

## Done when

- [ ] `cogPath` (cosine/Catmull-Rom) is gone; `gearPath` + the new `COG_D` are in.
- [ ] `<path>` has the round-join stroke; svg still `fill="currentColor"` / `text-gray-200`.
- [ ] Shape reads as a mechanical cog (flat tops/valleys/straight flanks) on both `/sign-in` and `/request-access`, heading legible, still spinning, reduced-motion still disables the spin.
- [ ] eslint/type-check clean; no hydration warning; nothing else in the panel changed.
