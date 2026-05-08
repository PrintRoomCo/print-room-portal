/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  turbopack: {
    root: import.meta.dirname,
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
    ]
  },
}

export default nextConfig
