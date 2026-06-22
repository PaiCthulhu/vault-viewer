import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { uniqueSlug } from '@/lib/slugify'
import { loadVaultRows } from '@/lib/vault-admin'
import { requireAdmin } from '@/lib/admin-guard'
import type { VaultConfig, VaultsConfigFile } from '@/types'

export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied

  try {
    return NextResponse.json({ vaults: loadVaultRows() })
  } catch {
    return NextResponse.json({ error: 'Falha ao ler vaults.config.json' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }

  if (typeof body.name !== 'string' || body.name.trim() === '') {
    return NextResponse.json({ error: 'Nome é obrigatório' }, { status: 400 })
  }
  if (typeof body.path !== 'string' || body.path.trim() === '') {
    return NextResponse.json({ error: 'Caminho é obrigatório' }, { status: 400 })
  }
  if (!fs.existsSync(body.path)) {
    return NextResponse.json({ error: 'Caminho não existe no servidor' }, { status: 400 })
  }

  const filePath = path.join(process.cwd(), 'vaults.config.json')
  let config: VaultsConfigFile
  try {
    config = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as VaultsConfigFile
  } catch {
    return NextResponse.json({ error: 'Falha ao ler vaults.config.json' }, { status: 500 })
  }

  const slug = uniqueSlug(body.name, config.vaults.map((v) => v.slug))

  const vault: VaultConfig = {
    slug,
    name: body.name.trim(),
    path: body.path,
    description: typeof body.description === 'string' ? body.description : '',
    homePage: typeof body.homePage === 'string' ? body.homePage : '',
    coverImage:
      typeof body.coverImage === 'string' && body.coverImage.trim() !== ''
        ? body.coverImage.trim()
        : null,
    titleProperty:
      typeof body.titleProperty === 'string' && body.titleProperty.trim() !== ''
        ? body.titleProperty.trim()
        : null,
    coverProperty:
      typeof body.coverProperty === 'string' && body.coverProperty.trim() !== ''
        ? body.coverProperty.trim()
        : null,
  }

  config.vaults.push(vault)

  try {
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
  } catch {
    return NextResponse.json({ error: 'Falha ao gravar vaults.config.json' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, vault })
}
