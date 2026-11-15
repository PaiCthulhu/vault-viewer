import { getVaultsConfig, getVaultBySlug } from '@/lib/vault-config'
import { buildVault } from './pipeline'
import { parseArgs, buildAll } from './cli'

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  if (!args.all && args.vault === undefined) {
    console.error('Uso: npx tsx builder/index.ts --vault <slug> | --all')
    process.exit(1)
  }

  if (args.all) {
    const failed = await buildAll(getVaultsConfig().vaults, vault => buildVault(vault))
    if (failed.length > 0) {
      console.error(`Vaults com falha: ${failed.join(', ')}`)
      process.exit(1)
    }
    return
  }

  const slug = args.vault
  if (!slug) {
    console.error('Erro: --vault requer um slug. Ex: --vault drachegotter')
    process.exit(1)
  }

  const vault = getVaultBySlug(slug)
  if (!vault) {
    console.error(`Erro: vault "${slug}" não encontrado em vaults.config.json`)
    process.exit(1)
  }

  await buildVault(vault, { first: args.first })
}

main().catch(err => {
  console.error('Build falhou:', err)
  process.exit(1)
})
