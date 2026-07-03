# IDE prompt — auth merch SVG art: continue refinement, fix the cap silhouette

Paste everything below this line into your in-repo IDE agent.

---

You are continuing SVG artwork refinement for the auth-page merch pile in this
repo (branch `feat/auth-white-merch-drop`). Your immediate task is **fixing the
silhouette of the cap shape**, plus any further art tweaks the user asks for.

## Setup facts

- All artwork lives in **`components/auth/merch-shapes.tsx`** — normally the
  ONLY file you edit. Read it first; it is the single source of truth for the
  six shapes (tee, crew, mug, bottle, tote, cap).
- A dev server is already running on **localhost:3000 — never kill or restart
  it.** HMR shows your edits instantly and the user usually watches it live.
- Branch already has six modified files (`RequestAccessClient.tsx`,
  `SignInClient.tsx`, `AuthScene.tsx`, `MerchPile.tsx`, `merch-shapes.tsx`,
  `tailwind.config.ts`). Do not commit anything unless explicitly asked.

## Hard constraints

- **Art-only edits.** Do NOT change logic in `MerchPile.tsx` or
  `AuthScene.tsx`. Single exception: `MerchPile.tsx` holds two per-shape config
  arrays (`SIZE_MULT`, `FALLBACK_TILT`) that need exactly one entry per shape —
  touch those data values only if a shape is added or removed.
- The user gives terse art direction. "Colour and silhouette" means exactly
  those two things — don't over-interpret, don't add unrequested detail.
- Prints/embroidery text from reference photos are deliberately omitted
  (illegible at pile scale). Don't add them back.
- NZ English: a "dome" is a press-stud/eyelet detail, not the crown shape.

## The shape contract (`merch-shapes.tsx`)

- Shapes draw on a 0–100 grid as flat fills, no strokes.
- `box` = TIGHT bounding box of the artwork. `merchTextureUrl()` crops the
  sprite texture to it and `MerchPile` builds the physics rectangle from it, so
  art outside the box gets cropped and padding inside it breaks the
  pieces-visibly-touch behaviour. **Recompute the box after every silhouette
  change** — mind Q/A curve extrema, not just endpoints.
- Paths paint in array order (later over earlier). Abutting fills must overlap
  ~1–2 units, or paint one under the other, so anti-aliasing can't open
  hairline gaps (e.g. bottle cap band overlaps neck; cap crown paints over the
  brim's top edge).

## House style

- Chunky poster cutouts, integer coordinates.
- 45° chamfers/mitres (equal dx/dy) for hard corners; Q quadratic curves for
  organic rounding; `evenodd` + subpaths for punched holes (mug handle).
- Tone system on garments: body colour + mid-tone secondary panels (crew
  ribbing, cap brim) + dark accents (neckhole lenses, cap stitching).
- Current palette: tee red `#D2232A` (+`#8F161D` neck), crew periwinkle
  `#C5CDE8` (+`#A7B1D8` rib, `#8D97C4` neck), mug pale blue `#BCD1E3`, bottle
  grey `#8E939B` (+`#4470DB` cap), tote brown `#6D342B` (+`#3BA5D5` dots), cap
  azure `#1E9FE0` (+`#1A87C4` brim, `#0E679F` stitching).

## Verification loop (per round)

1. `npx eslint components/auth/merch-shapes.tsx` — run via a **Bash/POSIX
   shell tool, NOT PowerShell** (Volta breaks npx resolution under the
   PowerShell tool in this environment).
2. Playwright MCP: `browser_resize` to 1440×900 **FIRST**, then
   `browser_navigate` to `http://localhost:3000/sign-in` (resizing after
   navigation leaves sleeping physics bodies stranded against a stale floor),
   wait ~4s for the pile to settle, screenshot, read the image, check console.
3. Clean baseline = 0 console errors, 1 pre-existing Next.js Image warning for
   `/print-room-logo.png`.
4. Delete screenshot files and any `.playwright-mcp/` directory afterwards;
   `git status --short` must show only the six pre-existing modified files.
5. The user often iterates faster than this loop and may reject the browser
   steps — if they do, just edit + report and let them eyeball HMR.

## The task: cap silhouette

The cap (`name: 'cap'`, last entry in `MERCH_SHAPES`) is a front-view dad cap.
Current state after several rounds:

- `box: { x: 12, y: 24, w: 76, h: 58 }`
- `brim` (painted first, mid-tone `#1A87C4`):
  `M12 60 H88 Q88 76 50 82 Q12 76 12 60 Z`
- `crown` (azure, painted over the brim's top edge):
  `M16 62 A34 34 0 0 1 84 62 Z` — a true semicircle, radius 34, flat base.
- `details` (dark `#0E679F`): covered button at the apex (r=4 disc bumping
  above the arc), centre seam + two side seams fanning from the button to the
  crown base, and one small dome on each front panel:
  `M46 28 a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0 M49 30 H51 L52 62 H48 Z M46 30 Q33 38 30 62 L33 62 Q37 41 48 32 Z M54 30 Q67 38 70 62 L67 62 Q63 41 52 32 Z M38 38 a2 2 0 1 0 4 0 a2 2 0 1 0 -4 0 M58 38 a2 2 0 1 0 4 0 a2 2 0 1 0 -4 0`

Reference image: royal-blue dad cap photographed front-on (user screenshot at
`C:\Users\MSI\Pictures\Screenshots\Screenshot 2026-07-03 120837.png` — ask the
user to re-attach it if you can't read that path). Colours stay the azure set
above; ONLY the silhouette follows the reference.

Feedback history on this shape (avoid re-treading rejected ground):

1. v1 was a side-profile cap — rejected: "needs so much more detail… look like
   a cap not just some shapes".
2. v2 front view with a tapering crescent brim whose tips curled up past the
   crown sides — rejected: "the brim is nowhere near accurate", crown must be
   "half a circle", seams/domes better placed.
3. v3 (current): semicircle crown, wide rounded-band brim, seams fanning from
   the button. **The user has not yet signed off on the brim** — expect the
   next round of direction to target it. Things to study in the reference
   before editing: front-on, the crown/brim junction bows down slightly at
   centre; the peak's visible depth is roughly half the crown height; the
   peak ends are blunt and sit beside/behind the crown base, not winging past
   it; the bottom edge is a smooth continuous curve.

Iterate in small rounds: one edit, recompute `box`, lint, show/verify, wait
for direction. Keep every other shape untouched unless asked.
