import fs from 'fs'
import path from 'path'
import type { JWTPayload } from '@/types'
import { dbGetUserPermissions } from '@/lib/db'
import { getVaultsConfig } from '@/lib/vault-config'

export interface VaultSummary {
  slug: string
  name: string
  description: string
  coverImage: string | null
  homePage: string
  pageCount: number
  folderCount: number
  lastBuilt: string | null
}

// Vaults the user may see, with build metadata merged in. Used by both the
// /api/vaults route and the home page (the page calls this directly instead of
// HTTP-fetching its own API, so it isn't coupled to the server's port/host).
export function getVisibleVaults(payload: JWTPayload): VaultSummary[] {
  const { vaults } = getVaultsConfig()

  // Admin sees all; others see only permitted vaults
  const allowedSlugs = payload.isAdmin
    ? vaults.map((v) => v.slug)
    : dbGetUserPermissions(payload.userId)

  return vaults
    .filter((v) => allowedSlugs.includes(v.slug))
    .map((v) => {
      // Try to read build metadata (data/[slug]/index.json) if it exists
      const indexPath = path.join(process.cwd(), 'data', v.slug, 'index.json')
      let pageCount = 0
      let folderCount = 0
      let lastBuilt: string | null = null

      if (fs.existsSync(indexPath)) {
        try {
          const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'))
          pageCount = index.pageCount ?? 0
          folderCount = index.folderCount ?? 0
          lastBuilt = index.builtAt ?? null
        } catch {
          // index doesn't exist yet — vault not built
        }
      }

      return {
        slug: v.slug,
        name: v.name,
        description: v.description,
        coverImage: v.coverImage,
        homePage: v.homePage,
        pageCount,
        folderCount,
        lastBuilt,
      }
    })
}
