import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import fs from 'fs'
import path from 'path'
import { verifyToken, COOKIE_NAME } from '@/lib/auth'
import type { VaultsConfigFile } from '@/types'

/**
 * Validate/normalize an incoming titleProperty value.
 * Returns `{ value }` (string|null) when valid, or `{ error }` when invalid.
 * Pure helper — unit tested in tests/api/title-property.test.ts.
 */
export function validateTitleProperty(
  input: unknown,
): { value: string | null } | { error: string } {
  if (input === null) return { value: null }
  if (typeof input !== 'string') return { error: 'titleProperty deve ser string ou null' }
  const trimmed = input.trim()
  if (trimmed === '') return { value: null }
  if (!/^[\w .\-]{1,40}$/.test(trimmed)) {
    return { error: 'titleProperty inválido (use até 40 caracteres: letras, números, espaço, ponto, hífen)' }
  }
  return { value: trimmed }
}

async function requireAdmin(): Promise<NextResponse | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  const payload = token ? await verifyToken(token) : null
  if (!payload) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  if (!payload.isAdmin) return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
  return null
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const denied = await requireAdmin()
  if (denied) return denied

  const { slug } = await params

  // --- Validate body (partial set of editable fields) ---
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}

  if ('name' in body) {
    if (typeof body.name !== 'string' || body.name.trim() === '') {
      return NextResponse.json({ error: 'Nome deve ser uma string não-vazia' }, { status: 400 })
    }
    updates.name = body.name.trim()
  }

  if ('path' in body) {
    if (typeof body.path !== 'string' || body.path.trim() === '') {
      return NextResponse.json({ error: 'Caminho deve ser uma string não-vazia' }, { status: 400 })
    }
    if (!fs.existsSync(body.path)) {
      return NextResponse.json({ error: 'Caminho não existe no servidor' }, { status: 400 })
    }
    updates.path = body.path
  }

  if ('description' in body) {
    if (typeof body.description !== 'string') {
      return NextResponse.json({ error: 'Descrição deve ser string' }, { status: 400 })
    }
    updates.description = body.description
  }

  if ('homePage' in body) {
    if (typeof body.homePage !== 'string') {
      return NextResponse.json({ error: 'Página inicial deve ser string' }, { status: 400 })
    }
    updates.homePage = body.homePage
  }

  if ('coverImage' in body) {
    if (body.coverImage !== null && typeof body.coverImage !== 'string') {
      return NextResponse.json({ error: 'Imagem de capa deve ser string ou null' }, { status: 400 })
    }
    const cover = typeof body.coverImage === 'string' ? body.coverImage.trim() : null
    updates.coverImage = cover === '' ? null : cover
  }

  if ('titleProperty' in body) {
    const validated = validateTitleProperty(body.titleProperty)
    if ('error' in validated) {
      return NextResponse.json({ error: validated.error }, { status: 400 })
    }
    updates.titleProperty = validated.value
  }

  if ('coverProperty' in body) {
    if (body.coverProperty !== null && typeof body.coverProperty !== 'string') {
      return NextResponse.json({ error: 'Propriedade de capa deve ser string ou null' }, { status: 400 })
    }
    const cover = typeof body.coverProperty === 'string' ? body.coverProperty.trim() : null
    if (cover && !/^[\w.\- ]{1,40}$/.test(cover)) {
      return NextResponse.json(
        { error: 'Propriedade de capa inválida (use até 40 caracteres: letras, números, espaço, ponto, hífen)' },
        { status: 400 },
      )
    }
    updates.coverProperty = cover === '' ? null : cover
  }

  // --- Read fresh, mutate, write back ---
  const filePath = path.join(process.cwd(), 'vaults.config.json')
  let config: VaultsConfigFile
  try {
    config = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as VaultsConfigFile
  } catch {
    return NextResponse.json({ error: 'Falha ao ler vaults.config.json' }, { status: 500 })
  }

  const vault = config.vaults.find((v) => v.slug === slug)
  if (!vault) return NextResponse.json({ error: 'Vault não encontrado' }, { status: 404 })

  // Apply provided fields only (never change the slug).
  Object.assign(vault, updates)

  try {
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
  } catch {
    return NextResponse.json({ error: 'Falha ao gravar vaults.config.json' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, vault })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const denied = await requireAdmin()
  if (denied) return denied

  const { slug } = await params

  // Sanitize before any filesystem path use.
  if (!/^[a-zA-Z0-9_-]+$/.test(slug)) {
    return NextResponse.json({ error: 'Slug inválido' }, { status: 400 })
  }

  const filePath = path.join(process.cwd(), 'vaults.config.json')
  let config: VaultsConfigFile
  try {
    config = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as VaultsConfigFile
  } catch {
    return NextResponse.json({ error: 'Falha ao ler vaults.config.json' }, { status: 500 })
  }

  const idx = config.vaults.findIndex((v) => v.slug === slug)
  if (idx === -1) return NextResponse.json({ error: 'Vault não encontrado' }, { status: 404 })

  config.vaults.splice(idx, 1)

  try {
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
  } catch {
    return NextResponse.json({ error: 'Falha ao gravar vaults.config.json' }, { status: 500 })
  }

  // Best-effort removal of built data + assets.
  for (const dir of [
    path.join(process.cwd(), 'data', slug),
    path.join(process.cwd(), 'public', 'vault-assets', slug),
  ]) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      /* non-fatal */
    }
  }

  return NextResponse.json({ ok: true })
}
