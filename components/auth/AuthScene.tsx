/**
 * All-white full-page stage for the auth pages (sign-in, request-access).
 *
 * Flow-stacked layers: the page heading, the logo, the centred form (passed as
 * children), and a decorative pile of flat merch cutouts (MerchPile) that drops
 * in and settles along the bottom edge. Shared across both auth pages — each
 * passes its own `heading`.
 */

import Image from 'next/image'
import MerchPile from './MerchPile'

export default function AuthScene({
  heading,
  headingHidden,
  merchFloorOffset,
  children,
}: {
  heading: string
  /** Keep the <h1> in the DOM for a11y but hide it visually (sr-only). */
  headingHidden?: boolean
  merchFloorOffset?: number
  children: React.ReactNode
}) {
  return (
    // No bottom padding — the merch pile must sit on (and be cropped by) the
    // true bottom edge of the page.
    <div className="relative flex min-h-screen w-full select-none flex-col items-center overflow-hidden bg-white px-4 pt-10 sm:pt-12">
      {/* Page heading — the single announced <h1> for each auth page.
          `headingHidden` keeps it for screen readers but removes it visually. */}
      <h1
        className={
          headingHidden
            ? 'sr-only'
            : 'mt-2 max-w-[18rem] text-center text-3xl font-bold leading-tight tracking-heading text-pr-charcoal sm:mt-4 sm:text-4xl'
        }
      >
        {heading}
      </h1>

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
      <div className="pointer-events-none relative z-10 flex w-full flex-1 items-center justify-center py-8 [&_a]:pointer-events-auto [&_button]:pointer-events-auto [&_input]:pointer-events-auto [&_iframe]:pointer-events-auto [&_select]:pointer-events-auto [&_textarea]:pointer-events-auto">
        {children}
      </div>

      {/* Merch pile — decorative floor, layered BEHIND the form (z-0). */}
      <MerchPile floorOffset={merchFloorOffset} />
    </div>
  )
}
