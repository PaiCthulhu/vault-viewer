import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { PageMeta } from '@/builder/types'

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => ({ name, value: 'tok' }) }),
}))
vi.mock('@/lib/auth', () => ({
  COOKIE_NAME: 'vault_session',
  verifyToken: async () => ({ userId: 1, username: 'bia', isAdmin: true }),
}))

let mockComments: boolean | undefined = true
vi.mock('@/lib/vault-config', () => ({
  getVaultBySlug: (slug: string) =>
    slug === 'v'
      ? { slug: 'v', path: 'x', homePage: 'Notas/Minha Nota', comments: mockComments }
      : undefined,
}))

const dbGetDisplayNames = vi.fn()
vi.mock('@/lib/db', () => ({
  dbUserHasVaultAccess: () => true,
  dbGetDisplayNames: (...a: unknown[]) => dbGetDisplayNames(...a),
}))
vi.mock('@/lib/pending-page', async importActual => ({
  ...(await importActual<typeof import('@/lib/pending-page')>()),
  isPending: () => false,
}))
vi.mock('@/components/viewer/VaultViewer', () => ({ VaultViewer: () => null }))

import VaultPage from '@/app/(app)/vault/[slug]/[[...path]]/page'
import { currentPageVersion } from '@/lib/page-version'

const diskPage: PageMeta = {
  path: 'Notas/Minha Nota',
  title: 'Minha Nota',
  html: '<p>oi</p>',
  commentable: true,
  comments: [
    {
      comment: { path: 'c1', author: 'ana', createdAt: null, updatedAt: null, body: 'oi', html: '<p>oi</p>' },
      replies: [],
    },
  ],
} as unknown as PageMeta

let tmp: string
let cwdSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-page-'))
  const base = path.join(tmp, 'data', 'v')
  fs.mkdirSync(path.join(base, 'pages', 'Notas'), { recursive: true })
  fs.writeFileSync(path.join(base, 'pages', 'Notas', 'Minha Nota.json'), JSON.stringify(diskPage))
  fs.writeFileSync(
    path.join(base, 'pages-index.json'),
    JSON.stringify([{ path: 'Notas/Minha Nota', title: 'Minha Nota', file: 'Minha Nota', tags: [] }]),
  )
  fs.writeFileSync(path.join(base, 'graph.json'), JSON.stringify({ nodes: [], edges: [] }))
  fs.writeFileSync(path.join(base, 'tree.json'), JSON.stringify([]))
  cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmp)
  mockComments = true
  dbGetDisplayNames.mockReset()
  dbGetDisplayNames.mockImplementation(() => ({ ana: 'Ana Souza', bia: null }))
})

afterEach(() => {
  cwdSpy.mockRestore()
  fs.rmSync(tmp, { recursive: true, force: true })
})

async function render() {
  const el = (await VaultPage({
    params: Promise.resolve({ slug: 'v', path: ['Notas', 'Minha Nota'] }),
  })) as unknown as { props: Record<string, unknown> }
  return el.props
}

describe('página do vault com comentários', () => {
  it('a versão renderizada é a do disco e os nomes vão à parte', async () => {
    const props = await render()
    expect(props.pageVersion).toBe(currentPageVersion('v', 'Notas/Minha Nota'))
    expect(props.pageVersion).not.toBeNull()
    expect(props.displayNames).toEqual({ ana: 'Ana Souza', bia: null })
    expect(props.page).toEqual(diskPage)
    expect(Object.keys(props.page as object)).not.toContain('displayNames')
  })

  it('flag desligada: sem consulta de nomes e o page vai ao cliente com comments vazio', async () => {
    mockComments = false
    const props = await render()
    expect(props.displayNames).toEqual({})
    expect(dbGetDisplayNames).not.toHaveBeenCalled()
    expect(props.page).toEqual({ ...diskPage, comments: [] })
    expect(props.pageVersion).toBe(currentPageVersion('v', 'Notas/Minha Nota'))
  })

  it('a versão é a mesma com a flag ligada e desligada, e é o hash do JSON do disco', async () => {
    const on = await render()
    mockComments = false
    const off = await render()
    expect((on.page as PageMeta).comments).toEqual(diskPage.comments)
    expect((off.page as PageMeta).comments).toEqual([])
    expect(off.pageVersion).toBe(on.pageVersion)
    expect(on.pageVersion).toBe(currentPageVersion('v', 'Notas/Minha Nota'))
  })

  it('flag desligada numa página sem comments: o page vai como está, sem a chave', async () => {
    const plain: Partial<PageMeta> = { ...diskPage }
    delete plain.comments
    fs.writeFileSync(path.join(tmp, 'data', 'v', 'pages', 'Notas', 'Minha Nota.json'), JSON.stringify(plain))
    mockComments = false
    const props = await render()
    expect(props.page).toEqual(plain)
    expect(Object.keys(props.page as object)).not.toContain('comments')
  })
})
