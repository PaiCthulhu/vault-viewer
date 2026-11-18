import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { NextResponse } from 'next/server'
import type { VaultConfig } from '@/types'

let mockToken: string | undefined
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (mockToken !== undefined ? { name, value: mockToken } : undefined),
  }),
}))

// Os ids são preenchidos no beforeAll, depois de criar os usuários no banco temporário.
const ids: Record<string, number> = {}
vi.mock('@/lib/auth', () => ({
  COOKIE_NAME: 'vault_session',
  verifyToken: async (t: string) => {
    if (t === 'root') return { userId: ids.root, username: 'root', isAdmin: true }
    if (t === 'ana') return { userId: ids.ana, username: 'ana', isAdmin: false }
    if (t === 'ana-token-admin') return { userId: ids.ana, username: 'ana', isAdmin: true }
    if (t === 'bia') return { userId: ids.bia, username: 'bia', isAdmin: false }
    if (t === 'apagado') return { userId: 99999, username: 'root', isAdmin: true }
    return null
  },
}))

const VAULTS: Record<string, VaultConfig> = {
  'my-vault': { slug: 'my-vault', name: 'My Vault', path: 'x' } as unknown as VaultConfig,
  'test-vault': { slug: 'test-vault', name: 'Test Vault', path: 'y' } as unknown as VaultConfig,
}
vi.mock('@/lib/vault-config', () => ({
  getVaultBySlug: (slug: string) => VAULTS[slug],
}))

type DbModule = typeof import('@/lib/db')
type SessionModule = typeof import('@/lib/vault-session')

let tmpDir: string
let db: DbModule
let mod: SessionModule

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vv-session-'))
  vi.spyOn(process, 'cwd').mockReturnValue(tmpDir)
  vi.resetModules()
  db = await import('@/lib/db')
  mod = await import('@/lib/vault-session')
  ids.root = db.dbCreateUser('root', 'x', true).id
  ids.ana = db.dbCreateUser('ana', 'x').id
  ids.bia = db.dbCreateUser('bia', 'x').id
  db.dbSetUserPermissions(ids.ana, [
    { slug: 'my-vault', level: 'editor' },
    { slug: 'test-vault', level: 'reader' },
    { slug: 'ghost', level: 'editor' },
    { slug: 'ghost-reader', level: 'reader' },
  ])
})

afterAll(() => {
  db.getDb().close()
  vi.restoreAllMocks()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

async function expectError(r: unknown, status: number, error: string) {
  expect(r).toBeInstanceOf(NextResponse)
  const res = r as NextResponse
  expect(res.status).toBe(status)
  expect(res.headers.get('Cache-Control')).toBe('no-store')
  expect(await res.json()).toEqual({ error })
}

describe('editorSession', () => {
  it('sem cookie: 401', async () => {
    mockToken = undefined
    await expectError(await mod.editorSession('my-vault'), 401, 'Não autenticado')
  })

  it('token inválido: 401', async () => {
    mockToken = 'lixo'
    await expectError(await mod.editorSession('my-vault'), 401, 'Token inválido')
  })

  it('usuário apagado: 401 mesmo com token de admin', async () => {
    mockToken = 'apagado'
    await expectError(await mod.editorSession('my-vault'), 401, 'Usuário não existe mais')
  })

  it('sem acesso ao vault: 403 antes de olhar se o vault existe', async () => {
    mockToken = 'bia'
    await expectError(await mod.editorSession('my-vault'), 403, 'Sem acesso')
    await expectError(await mod.editorSession('nao-existe'), 403, 'Sem acesso')
  })

  it('vault fora da config: 404', async () => {
    mockToken = 'ana'
    await expectError(await mod.editorSession('ghost'), 404, 'Vault não encontrado')
    mockToken = 'root'
    await expectError(await mod.editorSession('nao-existe'), 404, 'Vault não encontrado')
  })

  it('vault fora da config com grant de leitor: 404 vem antes do nível', async () => {
    mockToken = 'ana'
    await expectError(await mod.editorSession('ghost-reader'), 404, 'Vault não encontrado')
  })

  it('leitor recebe 403', async () => {
    mockToken = 'ana'
    await expectError(await mod.editorSession('test-vault'), 403, 'Sem permissão de edição neste vault')
  })

  it('editor recebe a sessão', async () => {
    mockToken = 'ana'
    expect(await mod.editorSession('my-vault')).toEqual({
      vault: VAULTS['my-vault'],
      userId: ids.ana,
      username: 'ana',
      isAdmin: false,
    })
  })

  it('admin edita qualquer vault, sem permissão gravada', async () => {
    mockToken = 'root'
    expect(await mod.editorSession('test-vault')).toEqual({
      vault: VAULTS['test-vault'],
      userId: ids.root,
      username: 'root',
      isAdmin: true,
    })
  })

  it('papel vem do banco, não do JWT', async () => {
    mockToken = 'ana-token-admin'
    await expectError(await mod.editorSession('test-vault'), 403, 'Sem permissão de edição neste vault')
  })

  it('rebaixar vale na hora, com o mesmo token', async () => {
    mockToken = 'ana'
    const full = [
      { slug: 'my-vault', level: 'editor' as const },
      { slug: 'test-vault', level: 'reader' as const },
      { slug: 'ghost', level: 'editor' as const },
    ]
    expect(await mod.editorSession('my-vault')).toMatchObject({ username: 'ana' })
    db.dbSetUserPermissions(ids.ana, full.map(p => (p.slug === 'my-vault' ? { ...p, level: 'reader' as const } : p)))
    await expectError(await mod.editorSession('my-vault'), 403, 'Sem permissão de edição neste vault')
    db.dbSetUserPermissions(ids.ana, full)
    expect(await mod.editorSession('my-vault')).toMatchObject({ username: 'ana' })
  })
})

describe('vaultSession', () => {
  it('deixa o leitor passar', async () => {
    mockToken = 'ana'
    expect(await mod.vaultSession('test-vault')).toMatchObject({ username: 'ana', isAdmin: false })
  })
})

describe('canEditVault', () => {
  it('editor do vault pode; no vault em que é leitor, não', () => {
    expect(mod.canEditVault(ids.ana, 'my-vault')).toBe(true)
    expect(mod.canEditVault(ids.ana, 'test-vault')).toBe(false)
  })

  it('admin pode em qualquer vault', () => {
    expect(mod.canEditVault(ids.root, 'my-vault')).toBe(true)
    expect(mod.canEditVault(ids.root, 'nao-existe')).toBe(true)
  })

  it('usuário apagado não pode', () => {
    expect(mod.canEditVault(99999, 'my-vault')).toBe(false)
  })

  it('usuário sem grant não pode', () => {
    expect(mod.canEditVault(ids.bia, 'my-vault')).toBe(false)
  })
})
