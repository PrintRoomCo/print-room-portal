import { TERMS_VERSION } from '@/lib/checkout/terms'

/**
 * Provisional-but-real plain-English B2B terms (design 2026-08-11, Decision 7).
 * NOT lorem ipsum — agreeing to filler on a live portal undermines the consent
 * record. Jon reviews this wording before merge; final legal copy is a later
 * edit here. Bump TERMS_VERSION in lib/checkout/terms.ts on substantive change.
 */
export function TermsContent() {
  return (
    <div className="space-y-4 text-sm leading-relaxed text-gray-700">
      <p className="text-xs text-gray-500">
        Version {TERMS_VERSION} · These terms may be updated from time to time.
      </p>

      <section>
        <h3 className="font-medium text-gray-900">1. Quotes &amp; pricing</h3>
        <p>
          Prices shown at checkout are valid for 30 days unless stated otherwise.
          All prices are in New Zealand dollars and exclude GST, which is added
          at the prevailing rate on your invoice.
        </p>
      </section>

      <section>
        <h3 className="font-medium text-gray-900">2. Payment</h3>
        <p>
          Payment is due on the terms agreed for your account. Where a deposit
          applies, production begins once the deposit is received. We may place
          orders on hold where an account is overdue.
        </p>
      </section>

      <section>
        <h3 className="font-medium text-gray-900">3. Artwork &amp; proof approval</h3>
        <p>
          You are responsible for the accuracy of artwork, names, sizes and
          quantities you supply. Where a proof is provided, production follows
          your approval; we are not liable for errors in approved artwork.
        </p>
      </section>

      <section>
        <h3 className="font-medium text-gray-900">4. Changes &amp; cancellations</h3>
        <p>
          Once production has started, orders cannot usually be changed or
          cancelled. Custom and decorated goods are made to order and are not
          returnable except where faulty.
        </p>
      </section>

      <section>
        <h3 className="font-medium text-gray-900">5. Delivery &amp; risk</h3>
        <p>
          Delivery dates are estimates and not guaranteed. Risk in the goods
          passes to you on delivery. Please inspect goods on arrival and tell us
          of any shortage or fault within 7 days.
        </p>
      </section>

      <section>
        <h3 className="font-medium text-gray-900">6. Updates to these terms</h3>
        <p>
          We may update these terms from time to time. The version shown above
          applies to the order you are placing now.
        </p>
      </section>
    </div>
  )
}
