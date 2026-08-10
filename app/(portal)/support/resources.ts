export type CustomerSupportCapability = 'companyUser' | 'orgAdmin'

export interface CustomerSupportDestination {
  label: string
  href: string
  requires?: CustomerSupportCapability
  fallback?: Omit<CustomerSupportDestination, 'requires' | 'fallback'>
}

export interface CustomerSupportGuide {
  id: string
  title: string
  intro: string
  steps: readonly string[]
  destination?: CustomerSupportDestination
  videoUrl?: string
}

// These guides deliberately live in source rather than a CMS so the wording,
// deep links, and access gates ship together. Add a videoUrl when a hosted
// walkthrough is ready; the UI will then expose a Watch video link.
export const CUSTOMER_SUPPORT_GUIDES: readonly CustomerSupportGuide[] = [
  {
    id: 'place-an-order',
    title: 'Place an order',
    intro: 'Start a new order from the catalogue available to your organisation.',
    steps: [
      'Open your catalogue and find the product you need.',
      'Choose a product and select the options you need.',
      'Add the product to your cart and repeat for every item in the order.',
      'Review the cart before continuing to checkout.',
    ],
    destination: {
      label: 'Open catalogue',
      href: '/catalogue',
      requires: 'companyUser',
    },
  },
  {
    id: 'cart-and-checkout',
    title: 'Cart & checkout',
    intro: 'Review everything in one place before you submit your order.',
    steps: [
      'Open your cart after adding the items you need.',
      'Check product options, quantities, delivery details, and any notes.',
      'Continue to checkout and confirm the order details.',
      'Submit the order and keep the confirmation for your records.',
    ],
    destination: {
      label: 'Open cart',
      href: '/cart',
    },
  },
  {
    id: 'track-an-order',
    title: 'Track an order',
    intro: 'Use the order pages to check the progress of work that has been submitted.',
    steps: [
      'If you manage the organisation, open Current Orders to see active work and its latest status.',
      'Select an order to review its production and delivery updates.',
      'Use Past orders to find completed work and previous order details when Current Orders is not available to you.',
    ],
    destination: {
      label: 'View current orders',
      href: '/current-orders',
      requires: 'orgAdmin',
      fallback: {
        label: 'View past orders',
        href: '/past-orders',
      },
    },
  },
]
