import { getVaultsConfig, getVaultBySlug } from '@/lib/vault-config'
import { buildVault } from './pipeline'

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const vaultIdx = args.indexOf('--vault')
  const allFlag = args.includes('--all')

  if (!allFlag && vaultIdx === -1) {
    console.error('Uso: npx tsx builder/index.ts --vault <slug> | --all')
    process.exit(1)
  }

  if (allFlag) {
    const config = getVaultsConfig()
    for (const vault of config.vaults) {
      await buildVault(vault)
    }
    return
  }

  const slug = args[vaultIdx + 1]
  if (!slug) {
    console.error('Erro: --vault requer um slug. Ex: --vault drachegotter')
    process.exit(1)
  }

  const vault = getVaultBySlug(slug)
  if (!vault) {
    console.error(`Erro: vault "${slug}" não encontrado em vaults.config.json`)
    process.exit(1)
  }

  await buildVault(vault)
}

main().catch(err => {
  console.error('Build falhou:', err)
  process.exit(1)
})
