import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3'],
  // As imagens dos vaults saem da pasta do vault pela rota
  // `app/vault-assets/[slug]/[...path]/route.ts`, limitadas ao `assets.json`.
  // O app nunca usa next/image; com o otimizador desligado `/_next/image`
  // responde 404 e não vira outro caminho até elas, fora da checagem de sessão.
  images: { unoptimized: true },
}

export default nextConfig
