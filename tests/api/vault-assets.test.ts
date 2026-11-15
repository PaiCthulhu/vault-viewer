import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { NextRequest } from 'next/server'

let mockToken: string | undefined
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (mockToken !== undefined ? { name, value: mockToken } : undefined),
  }),
}))

vi.mock('@/lib/auth', () => ({
  COOKIE_NAME: 'vault_session',
  verifyToken: async (t: string) => {
    if (t === 'admin') return { userId: 1, username: 'a', isAdmin: true }
    if (t === 'leitor') return { userId: 2, username: 'l', isAdmin: false }
    if (t === 'outro') return { userId: 3, username: 'o', isAdmin: false }
    return null
  },
}))

vi.mock('@/lib/db', () => ({
  dbUserHasVaultAccess: (userId: number) => userId === 2,
}))

let vaultDir: string
vi.mock('@/lib/vault-config', () => ({
  getVaultBySlug: (slug: string) => (slug === 'v' ? { slug: 'v', path: vaultDir } : undefined),
}))

import { GET, HEAD } from '@/app/vault-assets/[slug]/[...path]/route'
import { IMAGE_CONTENT_TYPES, resolveInsideRoot } from '@/lib/vault-assets'
import { IMAGE_EXTS } from '@/builder/scanner'

let work: string
const PNG = Buffer.from('89504e470d0a1a0a0000', 'hex')

function writeList(list: string[], mtimeOffsetSec = 0) {
  const dir = path.join(work, 'data', 'v')
  fs.mkdirSync(dir, { recursive: true })
  const f = path.join(dir, 'assets.json')
  fs.writeFileSync(f, JSON.stringify(list))
  if (mtimeOffsetSec) {
    const t = new Date(Date.now() + mtimeOffsetSec * 1000)
    fs.utimesSync(f, t, t)
  }
}

function put(rel: string, data: Buffer | string = PNG) {
  const f = path.join(vaultDir, rel)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, data)
}

async function get(segments: string[], headers: Record<string, string> = {}, slug = 'v') {
  const req = new NextRequest(`http://localhost/vault-assets/${slug}/${segments.join('/')}`, { headers })
  return GET(req, { params: Promise.resolve({ slug, path: segments }) })
}

beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-assets-'))
  vaultDir = path.join(work, 'vault')
  fs.mkdirSync(vaultDir, { recursive: true })
  vi.spyOn(process, 'cwd').mockReturnValue(work)
  mockToken = 'admin'
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(work, { recursive: true, force: true })
})

describe('rota /vault-assets', () => {
  it('imagem gravada depois de a rota carregar é servida', async () => {
    writeList([])
    expect((await get(['nova.png'])).status).toBe(404)
    put('nova.png')
    writeList(['nova.png'], 2)
    const res = await get(['nova.png'])
    expect(res.status).toBe(200)
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true)
  })

  it('401 sem sessão, 404 para leitor sem permissão, 200 para leitor com permissão e para admin', async () => {
    put('a.png')
    writeList(['a.png'])
    mockToken = undefined
    expect((await get(['a.png'])).status).toBe(401)
    mockToken = 'lixo'
    expect((await get(['a.png'])).status).toBe(401)
    mockToken = 'outro'
    expect((await get(['a.png'])).status).toBe(404)
    mockToken = 'leitor'
    expect((await get(['a.png'])).status).toBe(200)
    mockToken = 'admin'
    expect((await get(['a.png'])).status).toBe(200)
  })

  it('404 fora da lista, para .md listado, para .. e para entrada que sai do vault', async () => {
    put('Nota.md', 'x')
    put('livre.png')
    fs.writeFileSync(path.join(work, 'fora.png'), PNG)
    writeList(['Nota.md', '../fora.png'])
    expect((await get(['livre.png'])).status).toBe(404)
    expect((await get(['Nota.md'])).status).toBe(404)
    expect((await get(['..', 'fora.png'])).status).toBe(404)
    expect((await get(['%2e%2e', 'fora.png'])).status).toBe(404)
    expect((await get(['..\\fora.png'])).status).toBe(404)
    expect((await get(['livre.png'], {}, 'inexistente')).status).toBe(404)
  })

  it('acha sem diferenciar caixa', async () => {
    put('Imagens/a.png')
    writeList(['Imagens/a.png'])
    expect((await get(['imagens', 'A.PNG'])).status).toBe(200)
  })

  it('nome com espaço, acento e %, chegando decodificado ou codificado', async () => {
    put('Imagens/Ação (1).png')
    put('100%.png')
    writeList(['Imagens/Ação (1).png', '100%.png'])
    expect((await get(['Imagens', 'Ação (1).png'])).status).toBe(200)
    expect((await get(['Imagens', 'A%C3%A7%C3%A3o%20(1).png'])).status).toBe(200)
    expect((await get(['100%.png'])).status).toBe(200)
  })

  it('cabeçalhos e 304', async () => {
    put('a.png')
    writeList(['a.png'])
    const res = await get(['a.png'])
    expect(res.headers.get('Content-Type')).toBe('image/png')
    expect(res.headers.get('Content-Length')).toBe(String(PNG.length))
    expect(res.headers.get('Cache-Control')).toBe('private, no-cache')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    const etag = res.headers.get('ETag')!
    expect(etag.startsWith('W/')).toBe(true)
    const lm = res.headers.get('Last-Modified')!
    expect(lm).toBeTruthy()
    await res.arrayBuffer()

    const r304 = await get(['a.png'], { 'If-None-Match': etag })
    expect(r304.status).toBe(304)
    expect(r304.headers.get('ETag')).toBe(etag)
    expect(r304.headers.get('Cache-Control')).toBe('private, no-cache')
    expect((await get(['a.png'], { 'If-Modified-Since': lm })).status).toBe(304)
    expect((await get(['a.png'], { 'If-None-Match': 'W/"outro"' })).status).toBe(200)
  })

  it('SVG ganha CSP com sandbox', async () => {
    put('i.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>')
    writeList(['i.svg'])
    const res = await get(['i.svg'])
    expect(res.headers.get('Content-Type')).toBe('image/svg+xml')
    expect(res.headers.get('Content-Security-Policy')).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    )
  })

  it('%2F que vira .. depois do decode morre na validação do caminho juntado', async () => {
    fs.writeFileSync(path.join(work, 'fora.png'), PNG)
    writeList(['../fora.png'])
    const res = await get(['..%2Ffora.png'])
    expect(res.status).toBe(404)
  })

  it('entrada absoluta na lista que sai do vault dá 404 pela contenção', async () => {
    const fora = path.join(work, 'fora.png')
    fs.writeFileSync(fora, PNG)
    const fwd = fora.split(path.sep).join('/')
    writeList([fwd])
    expect((await get(fwd.split('/').filter(Boolean))).status).toBe(404)
  })

  it('resolveInsideRoot aceita filhos e recusa saída, raiz e prefixo parecido', () => {
    const root = path.join(work, 'vault')
    expect(resolveInsideRoot(root, 'a/b.png')).toBe(path.join(root, 'a', 'b.png'))
    expect(resolveInsideRoot(root, '../fora.png')).toBeNull()
    expect(resolveInsideRoot(root, '../vault2/x.png')).toBeNull()
    expect(resolveInsideRoot(root, '.')).toBeNull()
    expect(resolveInsideRoot(root, path.join(work, 'fora.png'))).toBeNull()
  })

  it('diretório chamado x.png na lista dá 404', async () => {
    fs.mkdirSync(path.join(vaultDir, 'x.png'), { recursive: true })
    writeList(['x.png'])
    expect((await get(['x.png'])).status).toBe(404)
  })

  it('respostas de erro têm corpo vazio', async () => {
    writeList([])
    for (const t of [undefined, 'outro', 'admin']) {
      mockToken = t
      const res = await get(['nada.png'])
      expect(res.status).toBeGreaterThanOrEqual(401)
      expect(await res.text()).toBe('')
    }
  })

  it('HEAD devolve 200 com os cabeçalhos e sem corpo; 304 e 404 também', async () => {
    put('a.png')
    writeList(['a.png'])
    const res = await HEAD(
      new NextRequest('http://localhost/vault-assets/v/a.png', { method: 'HEAD' }),
      { params: Promise.resolve({ slug: 'v', path: ['a.png'] }) },
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/png')
    expect(res.headers.get('Content-Length')).toBe(String(PNG.length))
    expect(res.headers.get('ETag')).toMatch(/^W\//)
    expect(await res.text()).toBe('')
    const etag = res.headers.get('ETag')!
    const r304 = await HEAD(
      new NextRequest('http://localhost/vault-assets/v/a.png', {
        method: 'HEAD',
        headers: { 'If-None-Match': etag },
      }),
      { params: Promise.resolve({ slug: 'v', path: ['a.png'] }) },
    )
    expect(r304.status).toBe(304)
    const r404 = await HEAD(
      new NextRequest('http://localhost/vault-assets/v/b.png', { method: 'HEAD' }),
      { params: Promise.resolve({ slug: 'v', path: ['b.png'] }) },
    )
    expect(r404.status).toBe(404)
  })

  it('assets.json reescrito com o mesmo mtime mas outro tamanho recarrega a lista', async () => {
    put('a.png')
    put('b.png')
    writeList(['a.png'])
    const f = path.join(work, 'data', 'v', 'assets.json')
    const t = fs.statSync(f).mtime
    expect((await get(['b.png'])).status).toBe(404)
    fs.writeFileSync(f, JSON.stringify(['a.png', 'b.png']))
    fs.utimesSync(f, t, t)
    expect((await get(['b.png'])).status).toBe(200)
  })
})

describe('IMAGE_CONTENT_TYPES', () => {
  it('cobre exatamente as extensões de IMAGE_EXTS', () => {
    expect(Object.keys(IMAGE_CONTENT_TYPES).sort()).toEqual([...IMAGE_EXTS].sort())
  })
})
