import { cookies } from 'next/headers'
import { verifyToken, COOKIE_NAME } from '@/lib/auth'
import { getT } from '@/lib/i18n/server'
import { Topbar } from '@/components/shared/Topbar'
import { VaultCard } from '@/components/vault-list/VaultCard'

async function getVaultsForUser() {
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value!
  const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'}/api/vaults`, {
    headers: { Cookie: `vault_session=${token}` },
    cache: 'no-store',
  })
  if (!res.ok) return { vaults: [] }
  return res.json() as Promise<{ vaults: Array<{
    slug: string; name: string; description: string
    coverImage: string | null; homePage: string
    pageCount: number; folderCount: number; lastBuilt: string | null
  }> }>
}

export default async function VaultListPage() {
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value!
  const user = (await verifyToken(token))!
  const { vaults } = await getVaultsForUser()
  const t = await getT()

  return (
    <div className="flex min-h-screen flex-col" style={{ background: 'var(--bg)' }}>
      <Topbar username={user.username} isAdmin={user.isAdmin} />
      <main className="mx-auto w-full max-w-5xl px-8 py-14">
        <div className="mb-10">
          <h1 className="mb-1.5 text-3xl font-extrabold tracking-tight text-[var(--text)]">{t('vaultList.title')}</h1>
          <p style={{ color: 'var(--text-muted)' }}>{t('vaultList.subtitle')}</p>
        </div>
        {vaults.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>{t('vaultList.empty')}</p>
        ) : (
          <div className="grid gap-6" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
            {vaults.map((v) => (
              <VaultCard key={v.slug} {...v} />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
