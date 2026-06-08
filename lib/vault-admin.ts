import fs from 'fs'
import path from 'path'
import type { VaultConfig, VaultsConfigFile } from '@/types'

export interface VaultRow extends VaultConfig {
  pageCount: number | null
  builtAt: string | null
}

/**
 * Read a vault's build metadata (data/[slug]/index.json) when present.
 * Tolerates a missing/unbuilt vault by returning nulls.
 */
export function readVaultBuildMeta(slug: string): { pageCount: number | null; builtAt: string | null } {
  const indexPath = path.join(process.cwd(), 'data', slug, 'index.json')
  if (!fs.existsSync(indexPath)) return { pageCount: null, builtAt: null }
  try {
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'))
    return { pageCount: index.pageCount ?? null, builtAt: index.builtAt ?? null }
  } catch {
    return { pageCount: null, builtAt: null }
  }
}

/** Fresh-read config and augment each vault with build metadata. */
export function loadVaultRows(): VaultRow[] {
  const filePath = path.join(process.cwd(), 'vaults.config.json')
  const config = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as VaultsConfigFile
  return config.vaults.map((v) => ({ ...v, ...readVaultBuildMeta(v.slug) }))
}
