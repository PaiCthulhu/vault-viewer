import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyToken, COOKIE_NAME } from '@/lib/auth'
import { dbGetUserPermissions } from '@/lib/db'
import { getVaultsConfig } from '@/lib/vault-config'
import fs from 'fs'
import path from 'path'

export async function GET() {
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  if (!token) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const payload = await verifyToken(token)
  if (!payload) return NextResponse.json({ error: 'Token inválido' }, { status: 401 })

  const { vaults } = getVaultsConfig()

  // Admin sees all; others see only permitted vaults
  const allowedSlugs = payload.isAdmin
    ? vaults.map((v) => v.slug)
    : dbGetUserPermissions(payload.userId)

  const visibleVaults = vaults
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

  return NextResponse.json({ vaults: visibleVaults })
}
