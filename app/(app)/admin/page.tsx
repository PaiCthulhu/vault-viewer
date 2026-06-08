import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyToken, COOKIE_NAME } from '@/lib/auth'
import { AdminPageClient } from '@/components/admin/AdminPageClient'
import { dbGetAllUsers, dbGetUserPermissions } from '@/lib/db'
import { getVaultsConfig } from '@/lib/vault-config'
import type { UserPublic } from '@/types'

export default async function AdminPage() {
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  if (!token) redirect('/login')
  const user = await verifyToken(token)
  if (!user?.isAdmin) redirect('/')

  const users: UserPublic[] = dbGetAllUsers().map((u) => ({
    id: u.id,
    username: u.username,
    isAdmin: Boolean(u.is_admin),
    createdAt: u.created_at,
    vaultSlugs: dbGetUserPermissions(u.id),
  }))

  const { vaults } = getVaultsConfig()

  return <AdminPageClient initialUsers={users} vaults={vaults} currentUsername={user.username} isAdmin={user.isAdmin} />
}
