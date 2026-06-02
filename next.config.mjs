/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  transpilePackages: ['@printroom/onboarding'],
  turbopack: {
    root: import.meta.dirname,
  },
  experimental: {
    // Enable Next.js integration with the browser View Transitions API so
    // route navigations animate via CSS ::view-transition-* pseudo-elements.
    // CSS-only — no React <ViewTransition> usage in this codebase yet.
    viewTransition: true,
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.supabase.co' },
      { protocol: 'https', hostname: 'cdn.fashionbizapps.nz' },
      { protocol: 'https', hostname: 'go.cin7.com' },
      { protocol: 'https', hostname: 'cdn11.bigcommerce.com' },
      { protocol: 'https', hostname: 'cdn.shopify.com' },
      { protocol: 'https', hostname: 'www.dropbox.com' },
    ],
  },
  async redirects() {
    return [
      // 2026-05-08 sidebar rename — keep /projects bookmarks alive for one cycle.
      { source: '/projects', destination: '/tracking', permanent: true },
      { source: '/projects/:path*', destination: '/tracking/:path*', permanent: true },
      // 2026-05-13 MF-6 quote retirement — old /quote-requests bookmarks now
      // surface as orders in /tracking. Per-id deep links collapse to the
      // index since the /quote-requests/[id] page no longer exists.
      { source: '/quote-requests', destination: '/tracking', permanent: true },
      { source: '/quote-requests/:path*', destination: '/tracking', permanent: true },
      // 2026-05-14 catalogue merge — /shop folded into /catalogue.
      // PDPs deep-link from /shop/[id] preserved via per-id redirect.
      { source: '/shop', destination: '/catalogue', permanent: true },
      { source: '/shop/:productId', destination: '/catalogue/:productId', permanent: true },
      // 2026-06-02 — /inventory reinstated as a distinct org-admin Inventory page;
      // its old `/inventory -> /catalogue` redirect is intentionally removed (a
      // permanent 308 would otherwise shadow the new route on every environment).
    ]
  },
}

export default nextConfig
