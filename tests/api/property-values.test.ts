import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { NextRequest } from 'next/server'
import type { VaultConfig } from '@/types'

let mockToken: string | undefined
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (mockToken !== undefined ? { name, value: mockToken } : undefined),
  }),
}))
vi.mock('@/lib/auth', () => ({
  COOKIE_NAME: 'vault_session',
  verifyToken: async (t: string) => {
    if (t === 'admin') return { userId: 1, username: 'root', isAdmin: true }
    if (t === 'ana') return { userId: 2, username: 'ana', isAdmin: false }
    if (t === 'bia') return { userId: 3, username: 'bia', isAdmin: false }
    if (t === 'apagado') return { userId: 99, username: 'ana', isAdmin: true }
    return null
  },
}))
const USERS: Record<number, { id: number; username: string; is_admin: number }> = {
  1: { id: 1, username: 'root', is_admin: 1 },
  2: { id: 2, username: 'ana', is_admin: 0 },
  3: { id: 3, username: 'bia', is_admin: 0 },
}
vi.mock('@/lib/db', () => ({
  dbGetUserById: (id: number) => USERS[id],
  dbUserHasVaultAccess: (userId: number, slug: string) => slug === 'v' && (userId === 2 || userId === 3),
  dbGetUserVaultLevel: (userId: number, slug: string) =>
    slug !== 'v' ? null : userId === 2 ? 'editor' : userId === 3 ? 'reader' : null,
}))
let vault: VaultConfig
vi.mock('@/lib/vault-config', () => ({
  getVaultBySlug: (slug: string) => (slug === 'v' ? vault : undefined),
}))

import { GET } from '@/app/api/vault/[slug]/property-values/route'
import { buildVault } from '@/builder/pipeline'

let root: string
let vaultDir: string

function write(rel: string, content: string) {
  const f = path.join(vaultDir, rel)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, content)
}
const valuesFile = () => path.join(root, 'data', 'v', 'property-values.json')

async function get(query: string, slug = 'v') {
  const req = new NextRequest(`http://localhost/api/vault/${slug}/property-values${query}`)
  const res = await GET(req, { params: Promise.resolve({ slug }) })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.status, json: (await res.json()) as any, headers: res.headers }
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'property-values-api-'))
  vaultDir = path.join(root, 'vault')
  vault = { slug: 'v', name: 'v', path: vaultDir, description: '', homePage: '', coverImage: null, comments: true }
  write('Notas/Um.md', '---\ngenres:\n  - a\n  - b\n---\nUm.\n')
  write('Notas/Dois.md', '---\ngenres:\n  - b\n---\nDois.\n')
  vi.spyOn(process, 'cwd').mockReturnValue(root)
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  await buildVault(vault, { dataRoot: path.join(root, 'data') })
  mockToken = 'ana'
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('GET /api/vault/[slug]/property-values', () => {
  it('editora recebe os valores distintos, sem cache', async () => {
    const r = await get('?key=genres')
    expect(r.status).toBe(200)
    expect(r.json).toEqual({ values: ['a', 'b'] })
    expect(r.headers.get('cache-control')).toBe('no-store')
  })

  it('admin recebe 200', async () => {
    mockToken = 'admin'
    expect((await get('?key=genres')).status).toBe(200)
  })

  it('leitora recebe 403, sem cookie 401, usuário apagado 401', async () => {
    mockToken = 'bia'
    expect((await get('?key=genres')).status).toBe(403)
    mockToken = undefined
    expect((await get('?key=genres')).status).toBe(401)
    mockToken = 'apagado'
    expect((await get('?key=genres')).status).toBe(401)
  })

  it('admin em vault inexistente recebe 404', async () => {
    mockToken = 'admin'
    expect((await get('?key=genres', 'nada')).status).toBe(404)
  })

  it('chave sem índice e __proto__ dão lista vazia', async () => {
    expect((await get('?key=outra')).json).toEqual({ values: [] })
    expect((await get('?key=__proto__')).json).toEqual({ values: [] })
  })

  it('sem key dá 400', async () => {
    expect((await get('')).status).toBe(400)
    expect((await get('?key=')).status).toBe(400)
  })

  it('índice ausente ou quebrado dá lista vazia', async () => {
    fs.rmSync(valuesFile())
    expect((await get('?key=genres')).json).toEqual({ values: [] })
    fs.writeFileSync(valuesFile(), '{quebrado')
    expect((await get('?key=genres')).json).toEqual({ values: [] })
  })
})
