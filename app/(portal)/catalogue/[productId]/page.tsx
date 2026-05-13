// Catalogue PDP route re-exports the shop PDP so /catalogue/[id] and
// /shop/[id] render identical product pages without duplicating logic.
// Linking from the catalogue listing uses /catalogue/[id]; the shop listing
// (inventory mode) uses /shop/[id].
export { default } from '../../shop/[productId]/page'
export { dynamic } from '../../shop/[productId]/page'
