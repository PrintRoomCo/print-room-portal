/**
 * Flat single-fill merch cutout silhouettes for the auth-page MerchPile.
 *
 * Single source of truth: each shape is one SVG path on a 0 0 100 100 grid in
 * one brand colour. Consumed two ways —
 *   1. `merchTextureUrl()` builds an <svg> data URL used as a Matter.js body
 *      sprite texture (the interactive canvas pile), and
 *   2. `<MerchSvg>` renders the same path as a real element for the static
 *      fallback (reduced motion / touch / SSR — no canvas, no physics).
 */

export type MerchShape = {
  name: string
  color: string
  path: string
  fillRule?: 'evenodd' | 'nonzero'
}

export const MERCH_SHAPES: MerchShape[] = [
  {
    name: 'tee',
    color: '#FF8FA3',
    path: 'M38 12 L28 16 L10 28 L18 42 L30 36 L30 88 L70 88 L70 36 L82 42 L90 28 L72 16 L62 12 C58 20 42 20 38 12 Z',
  },
  {
    name: 'hoodie',
    color: '#5AA9E6',
    path: 'M36 16 L26 18 L8 30 L17 45 L30 40 L28 90 L72 90 L70 40 L83 45 L92 30 L74 18 L64 16 C70 -1 30 -1 36 16 Z',
  },
  {
    name: 'mug',
    color: '#A3D63B',
    path: 'M28 22 h30 a8 8 0 0 1 8 8 v40 a10 10 0 0 1 -10 10 h-26 a10 10 0 0 1 -10 -10 v-40 a8 8 0 0 1 8 -8 Z M66 34 a14 14 0 0 1 0 28 v-7 a7 7 0 0 0 0 -14 Z',
    fillRule: 'evenodd',
  },
  {
    name: 'bottle',
    color: '#FF9F45',
    path: 'M42 8 h16 a3 3 0 0 1 3 3 v6 h-22 v-6 a3 3 0 0 1 3 -3 Z M40 18 h20 a8 8 0 0 1 8 8 v58 a8 8 0 0 1 -8 8 h-20 a8 8 0 0 1 -8 -8 v-58 a8 8 0 0 1 8 -8 Z',
  },
  {
    name: 'lanyard',
    color: '#45C4B0',
    path: 'M30 6 L50 40 L70 6 L61 6 L50 26 L39 6 Z M45 38 h10 v9 h-10 Z M30 47 h40 a4 4 0 0 1 4 4 v37 a4 4 0 0 1 -4 4 h-40 a4 4 0 0 1 -4 -4 v-37 a4 4 0 0 1 4 -4 Z',
  },
]

/**
 * SVG data URL for a shape — used as a Matter.js body sprite texture. Rendered
 * at `size` px (default 512, so it stays crisp when a body is drawn large).
 */
export function merchTextureUrl(shape: MerchShape, size = 512): string {
  const fr = shape.fillRule ? ` fill-rule="${shape.fillRule}"` : ''
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">` +
    `<path d="${shape.path}" fill="${shape.color}"${fr}/></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

/** Static <svg> for the reduced-motion / touch / SSR fallback (no canvas). */
export function MerchSvg({
  shape,
  ...props
}: { shape: MerchShape } & React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 100 100" fill={shape.color} fillRule={shape.fillRule} aria-hidden {...props}>
      <path d={shape.path} />
    </svg>
  )
}
