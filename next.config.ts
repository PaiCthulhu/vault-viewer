import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3'],
  // The app never uses next/image. Turning the optimizer off makes
  // `/_next/image` answer 404, so it can't fetch `public/vault-assets/…`
  // through a path the proxy's asset check never sees.
  images: { unoptimized: true },
}

export default nextConfig
