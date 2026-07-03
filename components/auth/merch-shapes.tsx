/**
 * Poster-style merch cutouts for the auth-page MerchPile.
 *
 * Single source of truth: each product is drawn on a 0 0 100 100 grid as a
 * flat fill with no outline. Consumed two ways:
 *   1. `merchTextureUrl()` builds an <svg> data URL used as a Matter.js body
 *      sprite texture (the interactive canvas pile), and
 *   2. `<MerchSvg>` renders the same drawing as a real element for the static
 *      fallback (reduced motion / touch / SSR, no canvas, no physics).
 */

type MerchPath = {
  id: string
  path: string
  fill?: string
  fillRule?: 'evenodd' | 'nonzero'
  /** Render as thin open stroked lines (stitching) instead of a filled
   *  region — uniform hairline width with round caps. `fill` is ignored. */
  stroke?: string
  strokeWidth?: number
}

export type MerchShape = {
  name: string
  color: string
  /** Tight bounding box of the artwork on the 0-100 grid. Textures, fallback
   *  SVGs and physics bodies are all cropped to this, so pieces collide (and
   *  rest) exactly where the artwork ends — no transparent padding. */
  box: { x: number; y: number; w: number; h: number }
  paths: MerchPath[]
}

export const MERCH_SHAPES: MerchShape[] = [
  {
    name: 'tee',
    color: '#D2232A',
    box: { x: 9, y: 10, w: 82, h: 82 },
    paths: [
      {
        id: 'body',
        // Boxy crew-neck tee laid flat: shoulder seams sit just inside the
        // body, sleeves angle gently downward with a wide armhole opening,
        // the armhole drops to ~40% of body length, and the side seams run
        // dead vertical to a square hem. The top edge across the neck is the
        // back-collar dip.
        path: 'M38 10 Q50 13 62 10 L74 14 L91 22 L81 44 L72 42 V92 H28 V42 L19 44 L9 22 L26 14 Z',
      },
      {
        id: 'neck',
        fill: '#8F161D',
        // Darker inside-of-garment lens between the back collar and the
        // deeper front neckline, so the neckhole reads at pile scale.
        path: 'M38 10 Q50 13 62 10 Q50 24 38 10 Z',
      },
    ],
  },
  {
    name: 'crew',
    color: '#C5CDE8',
    box: { x: 2, y: 10, w: 96, h: 82 },
    paths: [
      {
        id: 'body',
        // Baggy long-sleeve crew laid flat: wide drop-shouldered body, deep
        // armholes, chunky sleeves that bow out at the elbows then blouse in
        // over wide straight-sided rib cuffs that finish dead level, and the
        // body blousing in over a narrower ribbed waistband. Collar dip
        // matches the tee.
        path: 'M38 10 Q50 13 62 10 L74 14 L98 46 L97 78 L95 80 V88 H83 V80 L81 78 L76 46 V80 L70 84 V92 H30 V84 L24 80 V46 L19 78 L17 80 V88 H5 V80 L3 78 L2 46 L26 14 Z',
      },
      {
        id: 'ribbing',
        fill: '#A7B1D8',
        // Mid-tone ribbing: waistband and cuff fills bounded by the outline
        // itself (the silhouette steps in where rib meets fabric), plus a
        // collar plate whose top edge coincides with the back-collar dip —
        // the inset neck lens on top leaves a thin rib ring flush around
        // the opening.
        path: 'M30 84 H70 V92 H30 Z M83 80 H95 V88 H83 Z M5 80 H17 V88 H5 Z M38 10 Q50 13 62 10 Q50 29 38 10 Z',
      },
      {
        id: 'neck',
        fill: '#8D97C4',
        // Darker inside-of-garment lens, inset ~2 units within the collar
        // plate so the rib ring shows evenly around the neck opening.
        path: 'M41 12 Q50 15 59 12 Q50 23 41 12 Z',
      },
    ],
  },
  {
    name: 'mug',
    color: '#BCD1E3',
    box: { x: 8, y: 8, w: 88, h: 84 },
    paths: [
      {
        id: 'body',
        // Milk-glass stacking mug: gently tapered body, stepped stacking
        // foot, and a chunky left D-handle with 45-degree chamfered corners
        // and one punched opening.
        path: 'M30 8 H96 L92 76 H84 L86 92 H40 L42 76 H34 L33 58 H14 L8 52 V26 L14 20 H31 Z M30 27 H18 L14 31 V47 L18 51 H30 Z',
        fillRule: 'evenodd',
      },
    ],
  },
  {
    name: 'bottle',
    color: '#8E939B',
    box: { x: 25, y: 10, w: 50, h: 88 },
    paths: [
      {
        id: 'body',
        // Tall wide-mouth cylinder with smoothly rounded shoulders, rounded
        // bottom corners and a short neck reveal under the cap.
        path: 'M34 25 H66 V30 Q75 30 75 42 V92 Q75 98 69 98 H31 Q25 98 25 92 V42 Q25 30 34 30 Z',
      },
      {
        id: 'cap',
        fill: '#4470DB',
        // Screw cap band with a raised lid puck; the band overlaps the neck
        // by one unit so no hairline gap opens between the fills.
        path: 'M38 10 H62 V14 H68 V26 H32 V14 H38 Z',
      },
    ],
  },
  {
    name: 'tote',
    color: '#6D342B',
    box: { x: 9, y: 4, w: 82, h: 90 },
    paths: [
      {
        id: 'handle',
        // Single squared strap: straight legs, flat top bar, 45-degree mitred
        // top corners (webbing folded flat, not a rounded arch).
        path: 'M24 40 L24 14 L34 4 L66 4 L76 14 L76 40 L70 40 L70 17 L63 10 L37 10 L30 17 L30 40 Z',
      },
      {
        id: 'body',
        // Wide boxy body with a gently sagging bottom edge.
        path: 'M12 40 H88 L91 92 Q50 96 9 92 Z',
      },
      {
        id: 'dots',
        fill: '#3BA5D5',
        // Oversized polka dots; the last one is a half-dot cropped by the
        // bag's top edge. All sit fully inside the body outline (no clipping
        // infra, so a dot may never poke past the silhouette).
        path: 'M12 56 a10 10 0 1 0 20 0 a10 10 0 1 0 -20 0 M38 56 a10 10 0 1 0 20 0 a10 10 0 1 0 -20 0 M68 60 a10 10 0 1 0 20 0 a10 10 0 1 0 -20 0 M22 80 a10 10 0 1 0 20 0 a10 10 0 1 0 -20 0 M50 80 a10 10 0 1 0 20 0 a10 10 0 1 0 -20 0 M78 40 A10 10 0 0 1 58 40 Z',
      },
    ],
  },
  {
    name: 'cap',
    color: '#273150',
    box: { x: 10, y: 6, w: 84, h: 80 },
    paths: [
      {
        id: 'brim',
        fill: '#1D2540',
        // Short round work-cap visor seen from above, narrower than the
        // crown's full width: the outer edge drops from the left root,
        // rounds under the front and pokes out past the crown to a
        // squared-off right tip; the whole inner edge is buried under the
        // crown fill so the attachment can never open a hairline gap.
        // Painted first — the crown overlaps it.
        path: 'M34 66 Q34 80 56 86 Q76 86 88 72 Q94 64 94 56 Q86 46 76 46 Q56 50 44 58 Q37 61 34 66 Z',
      },
      {
        id: 'brim-stitching',
        stroke: '#F8FAFF',
        strokeWidth: 1,
        // Six concentric visor rows at even ~2.7-unit spacing, each a clean
        // inward offset of the visor's outer edge. Painted BEFORE the crown
        // so every row's left end (and the top rows' right ends) overshoots
        // underneath the crown fill and is cropped by it — each visible row
        // emerges from under the crown and sweeps across to the visor tip
        // with no stray line ends, matching the tight rows in the reference.
        path: 'M37 66 Q36 78 56 84 Q75 84 86 70 Q92 63 91 55 M39 66 Q38 76 56 81 Q74 81 84 69 Q89 62 89 53 M42 66 Q39 74 56 78 Q73 79 82 67 Q87 61 86 51 M45 66 Q41 72 56 75 Q72 76 80 65 Q84 60 83 49 M47 66 Q43 70 56 73 Q71 74 78 63 Q82 59 78 52 M50 66 Q45 68 56 70 Q70 71 76 62 Q79 58 76 53',
      },
      {
        id: 'crown',
        // Tall dark-denim dome viewed from the front three-quarter top:
        // the dome sticks up prominently with a rounded apex, steep sides
        // and a hem that dips at the front and tucks behind the visor,
        // leaving a small step where the visor tip emerges on the right.
        path: 'M10 50 Q10 14 44 6 Q76 12 80 48 Q78 60 64 66 Q46 72 30 68 Q12 62 10 50 Z',
      },
      {
        id: 'crown-panel-stitching',
        stroke: '#F8FAFF',
        strokeWidth: 0.85,
        // Reference-style crown seams: three double-needle panel seams radiate
        // from one crown point and land cleanly on the lower band.
        path: 'M45 9 C37 17 28 34 21 58 M47 10 C40 19 32 37 26 62 M45.5 9 C44.3 26 43.8 47 44 67 M48 10 C49.2 28 50 49 51 67 M47 9.5 C56 17 66 35 74 57 M49.2 10.8 C59 20 69 37 77 52',
      },
      {
        id: 'band-stitching',
        stroke: '#F8FAFF',
        strokeWidth: 0.95,
        // Two quiet stitch rows following the crown band above the visor.
        path: 'M13 50 Q16 61 31 66 Q46 70 62 64 Q74 57 77 47 M15 48 Q18 58 32 64 Q46 68 61 62 Q72 55 75 46',
      },
    ],
  },
]

function pathToSvg(shape: MerchShape, part: MerchPath): string {
  if (part.stroke) {
    return (
      `<path d="${part.path}" fill="none" stroke="${part.stroke}" ` +
      `stroke-width="${part.strokeWidth ?? 1}" stroke-linecap="round" stroke-linejoin="round"/>`
    )
  }
  const fill = part.fill ?? shape.color
  const fillRule = part.fillRule ? ` fill-rule="${part.fillRule}"` : ''
  return `<path d="${part.path}" fill="${fill}"${fillRule}/>`
}

/**
 * SVG data URL for a shape — used as a Matter.js body sprite texture. Cropped
 * to the shape's tight `box` so the image has zero transparent padding, and
 * rendered at `scale` px per 100 grid units (default 512, so it stays crisp
 * when a body is drawn large).
 */
export function merchTextureUrl(shape: MerchShape, scale = 512): string {
  const { x, y, w, h } = shape.box
  const width = Math.round((w / 100) * scale)
  const height = Math.round((h / 100) * scale)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${x} ${y} ${w} ${h}">` +
    `${shape.paths.map((part) => pathToSvg(shape, part)).join('')}</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

/** Static <svg> for the reduced-motion / touch / SSR fallback (no canvas). */
export function MerchSvg({
  shape,
  ...props
}: { shape: MerchShape } & React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox={`${shape.box.x} ${shape.box.y} ${shape.box.w} ${shape.box.h}`}
      aria-hidden
      {...props}
    >
      {shape.paths.map((part) =>
        part.stroke ? (
          <path
            key={part.id}
            d={part.path}
            fill="none"
            stroke={part.stroke}
            strokeWidth={part.strokeWidth ?? 1}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <path
            key={part.id}
            d={part.path}
            fill={part.fill ?? shape.color}
            fillRule={part.fillRule}
          />
        )
      )}
    </svg>
  )
}
