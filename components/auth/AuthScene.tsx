/**
 * All-white full-page stage for the auth pages (sign-in, request-access).
 *
 * Three flow-stacked layers: the slowly-rotating scalloped "cog" carrying the
 * page heading, the centred form (passed as children), and a decorative row of
 * flat merch cutouts (MerchPile) that drops in and settles along the bottom
 * edge. Shared across both auth pages — each passes its own `heading`.
 * Only the cog spins; the text stays upright.
 */

import Image from 'next/image'
import MerchPile from './MerchPile'

// Mechanical spur-gear silhouette: flat valleys (arc at rRoot), straight slanted
// flanks, flat tooth tips (arc at rTip). Reads as a cog. A sine-modulated radius
// (the old approach) only makes rounded petals => flower/star, so the generator
// is REPLACED, not retuned. Deterministic; computed once at module load, so the
// `d` string is identical on server and client (no hydration drift).
function gearPath(
  cx: number,
  cy: number,
  rRoot: number, // valley radius (the gaps between teeth)
  rTip: number, // flat tooth-tip radius
  teeth: number,
): string {
  const pitch = (Math.PI * 2) / teeth
  // Fractions of one tooth pitch, in order: gap -> flank -> tip -> flank. Sum = 1.
  const gTip = 0.3 // width of the flat tooth top
  const gGap = 0.42 // width of the flat valley
  const gFlank = (1 - gTip - gGap) / 2 // 0.14 each - the slanted sides

  const P = (r: number, a: number): string =>
    `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`

  let d = ''
  for (let i = 0; i < teeth; i++) {
    const a0 = i * pitch // bottom-land start (rRoot)
    const a1 = a0 + gGap * pitch // bottom-land end (rRoot)
    const a2 = a1 + gFlank * pitch // top-land start (rTip)
    const a3 = a2 + gTip * pitch // top-land end (rTip)
    const a4 = a3 + gFlank * pitch // == a0 + pitch (rRoot) - next tooth start

    if (i === 0) d += `M${P(rRoot, a0)}`
    d += `A${rRoot.toFixed(2)} ${rRoot.toFixed(2)} 0 0 1 ${P(rRoot, a1)}` // flat valley
    d += `L${P(rTip, a2)}` // rising flank
    d += `A${rTip.toFixed(2)} ${rTip.toFixed(2)} 0 0 1 ${P(rTip, a3)}` // flat tip
    d += `L${P(rRoot, a4)}` // falling flank
  }
  return `${d}Z`
}

// viewBox 0 0 200 200 -> centre (100,100). Tip r94 + the 7px round-join stroke
// below (~3.5px) ~= 97.5px, so it stays inside the 100px half-frame. 11 teeth.
const COG_D = gearPath(100, 100, 74, 94, 11)

export default function AuthScene({
  heading,
  children,
}: {
  heading: string
  children: React.ReactNode
}) {
  return (
    // No bottom padding — the merch pile must sit on (and be cropped by) the
    // true bottom edge of the page.
    <div className="relative flex min-h-screen w-full select-none flex-col items-center overflow-hidden bg-white px-4 pt-10 sm:pt-12">
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
        priority
        style={{ width: 'auto', height: 'auto' }}
        className="mt-6 h-7 w-auto"
      />

      {/* Form slot — centred in the space between the hero and the pile.
          Each page sets its own max-width on its inner wrapper.
          pointer-events-none lets the mouse fall THROUGH the slot's empty area to
          the merch canvas behind it (so you can shove/drag merch around the form);
          every actual control is re-enabled so the form stays fully usable. */}
      <div className="pointer-events-none z-10 flex w-full flex-1 items-center justify-center py-8 [&_a]:pointer-events-auto [&_button]:pointer-events-auto [&_input]:pointer-events-auto [&_iframe]:pointer-events-auto [&_select]:pointer-events-auto [&_textarea]:pointer-events-auto">
        {children}
      </div>

      {/* Merch pile — decorative floor, layered BEHIND the form (z-0). */}
      <MerchPile />
    </div>
  )
}
