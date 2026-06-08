import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyToken, COOKIE_NAME } from '@/lib/auth'
import { VaultsPageClient } from '@/components/admin/VaultsPageClient'
import { getVaultsConfig } from '@/lib/vault-config'
import { readVaultBuildMeta, type VaultRow } from '@/lib/vault-admin'

export default async function AdminVaultsPage() {
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  if (!token) redirect('/login')
  const user = await verifyToken(token)
  if (!user?.isAdmin) redirect('/')

  const { vaults } = getVaultsConfig()
  const rows: VaultRow[] = vaults.map((v) => ({ ...v, ...readVaultBuildMeta(v.slug) }))

  return <VaultsPageClient initialVaults={rows} currentUsername={user.username} isAdmin={user.isAdmin} />
}
