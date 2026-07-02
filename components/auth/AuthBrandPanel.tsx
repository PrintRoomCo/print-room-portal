/**
 * Readymag-style brand panel for the auth pages (sign-in, request-access).
 *
 * A deep brand-blue field carrying two focal shapes: a slowly-rotating
 * scalloped "cog" up top with a static, readable heading, and a lime diamond
 * below. Shared across both auth pages — each passes its own `heading`.
 * Only the cog spins; the text stays upright.
 */

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

// Shared one-time entrance; the hero motion is the continuous spin.
const ENTER = 'animate-[fadeSlideIn_0.7s_cubic-bezier(0.16,1,0.3,1)_both] motion-reduce:animate-none'

export default function AuthBrandPanel({
  heading,
}: {
  heading: string
}) {
  return (
    <div className="relative hidden h-screen flex-col justify-end overflow-hidden bg-pr-blue p-8 lg:flex lg:w-1/2 xl:p-12">
      {/* Faint radial lift so the flat blue field reads with a touch of depth. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 90% at 50% 40%, rgba(255,255,255,0.12), rgba(255,255,255,0) 62%)',
        }}
      />

      {/* Centered composition: rotating cog + heading, then focal diamond. */}
      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-12 px-8 xl:gap-16">
        {/* Scallop (spins) with a static, upright heading centred on top. */}
        <div className={`relative flex items-center justify-center ${ENTER}`}>
          <svg
            viewBox="0 0 200 200"
            className="h-64 w-64 animate-spin-slow text-gray-200 motion-reduce:animate-none xl:h-72 xl:w-72"
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
          <div className="absolute inset-0 grid place-items-center px-8">
            <h2 className="max-w-[11rem] text-center text-3xl font-bold leading-[1.05] tracking-heading text-pr-blue xl:max-w-[13rem] xl:text-4xl">
              {heading}
            </h2>
          </div>
        </div>

        {/* Focal diamond (rotated square). */}
        <div className={`relative flex items-center justify-center ${ENTER} [animation-delay:160ms]`}>
          <div className="h-40 w-40 rotate-45 rounded-[2.25rem] bg-pr-yellow shadow-[0_22px_55px_-14px_rgba(0,0,0,0.5)] ring-1 ring-black/5 xl:h-44 xl:w-44" />
        </div>
      </div>

      {/* Copyright */}
      <div className="relative z-10 flex-shrink-0 text-xs text-white/50 xl:text-sm">
        &copy; {new Date().getFullYear()} The Print Room. All rights reserved.
      </div>
    </div>
  )
}
