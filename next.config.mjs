/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: import.meta.dirname,
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.supabase.co' },
      { protocol: 'https', hostname: 'cdn.fashionbizapps.nz' },
      { protocol: 'https', hostname: 'go.cin7.com' },
    ],
  },
}

export default nextConfig
