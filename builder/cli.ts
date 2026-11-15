import type { VaultConfig } from '@/types'

export interface CliArgs {
  vault?: string
  all: boolean
  first: string[]
}

// Parse sequencial: --first e --vault consomem o argumento seguinte, então uma nota
// chamada "--all" (ou "--vault") passada via --first não vira flag.
export function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { all: false, first: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--first') {
      if (i + 1 < argv.length) out.first.push(argv[++i])
    } else if (a === '--vault') {
      if (i + 1 < argv.length) out.vault = argv[++i]
      else out.vault = ''
    } else if (a === '--all') {
      out.all = true
    }
  }
  return out
}

// Constrói todos os vaults; uma falha num vault é logada e não impede os seguintes.
// Devolve os slugs que falharam.
export async function buildAll(
  vaults: VaultConfig[],
  build: (vault: VaultConfig) => Promise<unknown>,
): Promise<string[]> {
  const failed: string[] = []
  for (const vault of vaults) {
    try {
      await build(vault)
    } catch (err) {
      console.error(`[${vault.slug}] Build falhou:`, err)
      failed.push(vault.slug)
    }
  }
  return failed
}
