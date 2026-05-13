// Catalogue PDP route re-exports the shop PDP so /catalogue/[id] and
// /shop/[id] render identical product pages without duplicating logic.
// Linking from the catalogue listing uses /catalogue/[id]; the shop listing
// (inventory mode) uses /shop/[id].
//
// `dynamic` is declared locally — Next.js requires route segment config to be
// a literal export per file and can't follow a re-export across modules.
export const dynamic = 'force-dynamic'
export { default } from '../../shop/[productId]/page'
