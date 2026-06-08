import fs from 'fs'
import path from 'path'
import type { VaultConfig, VaultsConfigFile } from '@/types'

let _config: VaultsConfigFile | null = null
let _mtimeMs = 0

export function getVaultsConfig(): VaultsConfigFile {
  const filePath = path.join(process.cwd(), 'vaults.config.json')
  // Re-read when the file changes (mtime) so newly added vaults appear without a
  // server restart — and stay consistent across separately-bundled routes in dev.
  let mtimeMs = 0
  try {
    mtimeMs = fs.statSync(filePath).mtimeMs
  } catch {
    /* fall back to cached config if stat fails */
  }
  if (!_config || mtimeMs !== _mtimeMs) {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8')
      _config = JSON.parse(raw) as VaultsConfigFile
    } catch {
      // No vaults.config.json yet (e.g. a fresh clone — it's gitignored). Treat
      // as "no vaults" instead of crashing; copy vaults.config.example.json to
      // get started.
      _config = { vaults: [] }
    }
    _mtimeMs = mtimeMs
  }
  return _config
}

export function getVaultBySlug(slug: string): VaultConfig | undefined {
  return getVaultsConfig().vaults.find((v) => v.slug === slug)
}

export function getAllVaultSlugs(): string[] {
  return getVaultsConfig().vaults.map((v) => v.slug)
}
