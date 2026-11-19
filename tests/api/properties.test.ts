import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import fsp from 'fs/promises'
import os from 'os'
import path from 'path'
import { NextRequest } from 'next/server'
import type { PageMeta, PageProperty } from '@/builder/types'
import type { VaultConfig } from '@/types'

let mockToken: string | undefined
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (mockToken !== undefined ? { name, value: mockToken } : undefined),
  }),
}))
// O token traz papel e nome "velhos" de propósito em alguns casos: a rota tem de usar o banco.
vi.mock('@/lib/auth', () => ({
  COOKIE_NAME: 'vault_session',
  verifyToken: async (t: string) => {
    if (t === 'admin') return { userId: 1, username: 'root', isAdmin: true }
    if (t === 'ana') return { userId: 2, username: 'ana', isAdmin: false }
    if (t === 'bia') return { userId: 3, username: 'bia', isAdmin: false }
    if (t === 'bia-token-admin') return { userId: 3, username: 'root', isAdmin: true }
    if (t === 'sem-acesso') return { userId: 4, username: 'caio', isAdmin: false }
    if (t === 'apagado') return { userId: 99, username: 'ana', isAdmin: true }
    return null
  },
}))
const USERS: Record<number, { id: number; username: string; is_admin: number }> = {
  1: { id: 1, username: 'root', is_admin: 1 },
  2: { id: 2, username: 'ana', is_admin: 0 },
  3: { id: 3, username: 'bia', is_admin: 0 },
  4: { id: 4, username: 'caio', is_admin: 0 },
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
const runRebuild = vi.fn()
vi.mock('@/lib/rebuild', async importActual => ({
  ...(await importActual<typeof import('@/lib/rebuild')>()),
  runRebuild: (...a: unknown[]) => runRebuild(...a),
}))

import { PATCH } from '@/app/api/vault/[slug]/properties/route'
import { buildVault } from '@/builder/pipeline'
import { MAX_EDIT_ATTEMPTS, propertyHooks } from '@/lib/property-store'
import { afterPropertyWrite } from '@/lib/property-api'

const NOTE = 'Notas/Minha Nota'
const NOTE_TEXT = [
  '---',
  'status: ok',
  'rating: 3',
  'done: false',
  'due: 2024-01-05',
  'genres:',
  '  - a',
  '  - b',
  'cover: img/a.png',
  'note_type: character',
  'ID: 7',
  'meta: {a: 1}',
  'poster: img/a.png',
  '---',
  'Corpo da nota.',
  '',
].join('\n')

let root: string
let vaultDir: string

function write(rel: string, content: string | Buffer) {
  const f = path.join(vaultDir, rel)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, content)
}
// Troca o `.obsidian/types.json` (sem rebuild).
const setTypes = (types: Record<string, string>) => write('.obsidian/types.json', JSON.stringify({ types }))
const noteFile = (p = NOTE) => path.join(vaultDir, `${p}.md`)
const read = (p = NOTE) => fs.readFileSync(noteFile(p), 'utf-8')
const bytes = (p = NOTE) => fs.readFileSync(noteFile(p))

// Todos os arquivos dentro do vault (caminho relativo com `/`), para provar onde se escreveu.
function allFiles(dir = vaultDir, rel = ''): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? allFiles(path.join(dir, e.name), `${rel}${e.name}/`) : [`${rel}${e.name}`],
  )
}
const snapshot = () => allFiles().sort().map(f => [f, fs.readFileSync(path.join(vaultDir, f), 'latin1')])

async function build() {
  await buildVault(vault, { dataRoot: path.join(root, 'data') })
}
function builtPage(p: string): PageMeta {
  return JSON.parse(fs.readFileSync(path.join(root, 'data', 'v', 'pages', `${p}.json`), 'utf-8'))
}
const builtRow = (p: string, key: string): PageProperty | undefined =>
  builtPage(p).properties?.find(r => r.key === key)

async function patch(body: unknown, opts: { slug?: string; headers?: Record<string, string>; raw?: string } = {}) {
  const slug = opts.slug ?? 'v'
  const req = new NextRequest(`http://localhost/api/vault/${slug}/properties`, {
    method: 'PATCH',
    headers: opts.headers ?? { 'content-type': 'application/json' },
    body: opts.raw ?? JSON.stringify(body),
  })
  const res = await PATCH(req, { params: Promise.resolve({ slug }) })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.status, json: (await res.json()) as any, headers: res.headers }
}

const edit = (key: string, value: unknown, expected: unknown, extra: Record<string, unknown> = {}) =>
  patch({ path: NOTE, key, value, expected, ...extra })

// As linhas de log das gravações.
const writeLogs = () =>
  vi.mocked(console.log).mock.calls.map(c => c[0]).filter(m => typeof m === 'string' && m.startsWith('[properties]'))

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'properties-api-'))
  vaultDir = path.join(root, 'vault')
  vault = {
    slug: 'v', name: 'v', path: vaultDir, description: '', homePage: '', coverImage: null, comments: true,
  }
  write(`${NOTE}.md`, NOTE_TEXT)
  write('Notas/Outra.md', '---\nstatus: ok\n---\nOutra.\n')
  write('Notas/Aba.md', `---\nnote_type: tab\nparent: "[[${NOTE}]]"\norder: 1\nstatus: x\n---\nAba.\n`)
  write('Notas/Comum.md', '---\nparent: x\nstatus: ok\n---\nComum.\n')
  write('Notas/Sem Props.md', 'Sem frontmatter.\n')
  write('.vaultwright/properties.json', '{"version":1,"properties":{"ID":{"readonly":true}}}')
  write('.obsidian/types.json', '{"types":{"rating":"number"}}')
  write('img/a.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  vi.spyOn(process, 'cwd').mockReturnValue(root)
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  await build()
  vi.mocked(console.log).mockClear()
  mockToken = 'ana'
  runRebuild.mockReset()
  runRebuild.mockResolvedValue({ ok: true, output: '' })
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('quem pode', () => {
  async function expectRefused(status: number) {
    const before = snapshot()
    expect((await edit('status', 'novo', 'ok')).status).toBe(status)
    expect(snapshot()).toEqual(before)
    expect(runRebuild).not.toHaveBeenCalled()
    expect(writeLogs()).toEqual([])
  }

  it.each([
    ['sem sessão', undefined, 401],
    ['token inválido', 'lixo', 401],
    ['usuário apagado com token ainda válido (e de admin)', 'apagado', 401],
    ['sem acesso ao vault', 'sem-acesso', 403],
    ['leitora', 'bia', 403],
    ['leitora com token que diz admin: o papel vem do banco', 'bia-token-admin', 403],
  ])('%s: recusa, sem gravar nem pedir build', async (_, token, status) => {
    mockToken = token
    await expectRefused(status)
  })

  it('vault inexistente: 404 para o admin, 403 para a editora', async () => {
    const before = snapshot()
    mockToken = 'admin'
    expect((await patch({ path: NOTE, key: 'status', value: 'novo', expected: 'ok' }, { slug: 'zzz' })).status).toBe(404)
    mockToken = 'ana'
    expect((await patch({ path: NOTE, key: 'status', value: 'novo', expected: 'ok' }, { slug: 'zzz' })).status).toBe(403)
    expect(snapshot()).toEqual(before)
    expect(runRebuild).not.toHaveBeenCalled()
  })

  it('editora: 200', async () => {
    const res = await edit('status', 'novo', 'ok')
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(res.json.property).toEqual({ key: 'status', type: 'text', value: 'novo', html: 'novo' })
    expect(read()).toBe(NOTE_TEXT.replace('status: ok\n', 'status: "novo"\n'))
  })

  it('admin, sem permissão explícita: 200, e o log leva o nome do banco', async () => {
    mockToken = 'admin'
    expect((await edit('status', 'novo', 'ok')).status).toBe(200)
    expect(writeLogs()).toEqual(['[properties] "root" "v" "Notas/Minha Nota" "status"'])
  })

  it('a sessão é conferida antes do corpo da requisição', async () => {
    mockToken = undefined
    expect((await patch(null, { raw: '{' })).status).toBe(401)
    mockToken = 'bia'
    expect((await patch(null, { raw: '{' })).status).toBe(403)
  })
})

describe('corpo da requisição', () => {
  it('exige application/json: 415', async () => {
    const raw = JSON.stringify({ path: NOTE, key: 'status', value: 'novo', expected: 'ok' })
    expect((await patch(null, { raw, headers: { 'content-type': 'text/plain' } })).status).toBe(415)
    expect((await patch(null, { raw, headers: {} })).status).toBe(415)
    expect(read()).toBe(NOTE_TEXT)
  })

  it('requisição grande demais: 413', async () => {
    expect((await edit('status', 'a'.repeat(200_000), 'ok')).status).toBe(413)
    expect(read()).toBe(NOTE_TEXT)
  })

  it('JSON inválido ou que não é objeto: 400', async () => {
    for (const raw of ['{', '[]', '5', 'null']) expect((await patch(null, { raw })).status).toBe(400)
  })

  it.each([
    ['sem path', { key: 'status', value: 'x', expected: 'ok' }, 'path ausente ou inválido'],
    ['path vazio', { path: '', key: 'status', value: 'x', expected: 'ok' }, 'path ausente ou inválido'],
    ['path que não é texto', { path: 5, key: 'status', value: 'x', expected: 'ok' }, 'path ausente ou inválido'],
    ['sem key', { path: NOTE, value: 'x', expected: 'ok' }, 'key ausente ou inválida'],
    ['key vazia', { path: NOTE, key: '', value: 'x', expected: 'ok' }, 'key ausente ou inválida'],
    ['key que não é texto', { path: NOTE, key: 5, value: 'x', expected: 'ok' }, 'key ausente ou inválida'],
    ['key longa demais', { path: NOTE, key: 'k'.repeat(1001), value: 'x', expected: 'ok' }, 'key ausente ou inválida'],
    ['sem value', { path: NOTE, key: 'status', expected: 'ok' }, 'value ausente'],
    ['sem expected', { path: NOTE, key: 'status', value: 'x' }, 'expected ausente'],
    ['confirm que não é boolean', { path: NOTE, key: 'status', value: 'x', expected: 'ok', confirm: 'sim' }, 'confirm inválido'],
  ])('%s: 400', async (_, body, error) => {
    const res = await patch(body)
    expect(res.status).toBe(400)
    expect(res.json).toEqual({ error })
    expect(read()).toBe(NOTE_TEXT)
    expect(runRebuild).not.toHaveBeenCalled()
  })

  it('value e expected null contam como presentes', async () => {
    expect((await edit('status', null, 'ok')).status).toBe(200)
    expect((await edit('status', 'de novo', null)).status).toBe(200)
  })
})

describe('caminho', () => {
  const COMMENT = '---\nnote_type: comment\nparent: "[[Notas/Minha Nota]]"\nauthor: ana\nstatus: ok\n---\noi\n'

  it.each([
    ['path traversal', '../fora', 400],
    ['barra invertida', 'Notas\\Minha Nota', 400],
    ['stream do NTFS', 'Notas::$INDEX_ALLOCATION/Minha Nota', 400],
    ['segmento com ponto', 'Notas/.oculta', 400],
    ['dentro de _comments/', '_comments/x/c', 404],
    ['dentro de _comments/ em outra caixa', '_COMMENTS/x/c', 404],
    ['inexistente', 'Notas/Nao Existe', 404],
    ['extensão em outra caixa', 'Notas/Maiuscula', 404],
    ['ponto no fim do segmento', 'Notas./Minha Nota', 404],
    ['com a extensão', 'Notas/Minha Nota.md', 404],
    ['uma pasta', 'Notas', 404],
  ])('%s: %i, sem gravar', async (_, p, status) => {
    write('_comments/x/c.md', COMMENT)
    write('Notas/Maiuscula.MD', '---\nstatus: ok\n---\n')
    fs.writeFileSync(path.join(root, 'fora.md'), '---\nstatus: ok\n---\nfora\n')
    const before = snapshot()
    const res = await patch({ path: p, key: 'status', value: 'novo', expected: 'ok' })
    expect(res.status).toBe(status)
    expect(res.json.error).toBe(status === 400 ? 'Caminho inválido' : 'Nota não encontrada')
    expect(snapshot()).toEqual(before)
    expect(fs.readFileSync(path.join(root, 'fora.md'), 'utf-8')).toContain('fora')
    expect(runRebuild).not.toHaveBeenCalled()
  })

  // Nos dois casos abaixo há JSON no build, então só a checagem do caminho barra a escrita.
  it('extensão que passou a ser .MD depois do build: 404, sem gravar', async () => {
    write('Notas/Maiuscula.md', '---\nstatus: ok\n---\n')
    await build()
    const md = path.join(vaultDir, 'Notas', 'Maiuscula.md')
    fs.renameSync(md, `${md}.tmp-rename`)
    fs.renameSync(`${md}.tmp-rename`, path.join(vaultDir, 'Notas', 'Maiuscula.MD'))
    expect(fs.existsSync(path.join(root, 'data', 'v', 'pages', 'Notas', 'Maiuscula.json'))).toBe(true)
    const res = await patch({ path: 'Notas/Maiuscula', key: 'status', value: 'novo', expected: 'ok' })
    expect(res.status).toBe(404)
    expect(fs.readFileSync(path.join(vaultDir, 'Notas', 'Maiuscula.MD'), 'utf-8')).toBe('---\nstatus: ok\n---\n')
  })

  it('_comments/ com um JSON de página no build (resto de build antigo): 404, sem gravar', async () => {
    write('_comments/x/c.md', COMMENT)
    for (const dir of ['_comments', '_COMMENTS']) {
      const json = path.join(root, 'data', 'v', 'pages', dir, 'x', 'c.json')
      fs.mkdirSync(path.dirname(json), { recursive: true })
      fs.writeFileSync(json, JSON.stringify({ path: `${dir}/x/c`, properties: [] }))
    }
    for (const p of ['_comments/x/c', '_COMMENTS/x/c']) {
      expect((await patch({ path: p, key: 'status', value: 'novo', expected: 'ok' })).status).toBe(404)
    }
    expect(read('_comments/x/c')).toBe(COMMENT)
  })

  it('nota escondida pelo .viewerignore: 404', async () => {
    write('.viewerignore', 'Notas/Minha Nota.md\n')
    const res = await edit('status', 'novo', 'ok')
    expect(res.status).toBe(404)
    expect(read()).toBe(NOTE_TEXT)
  })

  it('pasta escondida pelo .viewerignore: 404', async () => {
    write('.viewerignore', 'Notas/\n')
    expect((await edit('status', 'novo', 'ok')).status).toBe(404)
    expect(read()).toBe(NOTE_TEXT)
  })

  it('nota alcançada por uma junção dentro do vault: 404', async ({ skip }) => {
    try {
      fs.symlinkSync(path.join(vaultDir, 'Notas'), path.join(vaultDir, 'Atalho'), 'junction')
    } catch {
      skip('ambiente sem permissão para criar link')
    }
    const res = await patch({ path: 'Atalho/Minha Nota', key: 'status', value: 'novo', expected: 'ok' })
    expect(res.status).toBe(404)
    expect(read()).toBe(NOTE_TEXT)
    expect(runRebuild).not.toHaveBeenCalled()
  })

  it('pasta trocada por uma junção para fora do vault depois do build: 404, sem gravar lá', async ({ skip }) => {
    // No build, `Ponte/` era pasta comum: o JSON de `Ponte/N` existe, e só a checagem
    // canônica impede a escrita de seguir a junção.
    write('Ponte/N.md', '---\nstatus: ok\n---\ndentro\n')
    await build()
    fs.rmSync(path.join(vaultDir, 'Ponte'), { recursive: true })
    const outside = path.join(root, 'fora-dir')
    fs.mkdirSync(outside)
    fs.writeFileSync(path.join(outside, 'N.md'), '---\nstatus: ok\n---\nfora\n')
    try {
      fs.symlinkSync(outside, path.join(vaultDir, 'Ponte'), 'junction')
    } catch {
      skip('ambiente sem permissão para criar link')
    }
    expect(fs.existsSync(path.join(root, 'data', 'v', 'pages', 'Ponte', 'N.json'))).toBe(true)
    const res = await patch({ path: 'Ponte/N', key: 'status', value: 'novo', expected: 'ok' })
    expect(res.status).toBe(404)
    expect(fs.readdirSync(outside)).toEqual(['N.md'])
    expect(fs.readFileSync(path.join(outside, 'N.md'), 'utf-8')).toBe('---\nstatus: ok\n---\nfora\n')
    expect(runRebuild).not.toHaveBeenCalled()
  })

  it('outra caixa: grava o arquivo canônico e pede o build com o caminho canônico', async () => {
    const before = allFiles().sort()
    const res = await patch({ path: 'notas/minha nota', key: 'status', value: 'novo', expected: 'ok' })
    expect(res.status).toBe(200)
    expect(read()).toBe(NOTE_TEXT.replace('status: ok\n', 'status: "novo"\n'))
    expect(allFiles().sort()).toEqual(before)
    expect(runRebuild).toHaveBeenCalledWith('v', { first: [NOTE] })
    expect(writeLogs()).toEqual(['[properties] "ana" "v" "Notas/Minha Nota" "status"'])
  })
})

describe('build', () => {
  it('nota criada depois do build: 404', async () => {
    write('Notas/Nova.md', '---\nstatus: ok\n---\nNova.\n')
    const res = await patch({ path: 'Notas/Nova', key: 'status', value: 'novo', expected: 'ok' })
    expect(res.status).toBe(404)
    expect(res.json.error).toBe('Nota não encontrada')
    expect(read('Notas/Nova')).toBe('---\nstatus: ok\n---\nNova.\n')
  })

  it('nota sem propriedades no build: 422', async () => {
    const res = await patch({ path: 'Notas/Sem Props', key: 'status', value: 'novo', expected: null })
    expect(res.status).toBe(422)
    expect(res.json.error).toBe('A nota não tem propriedades editáveis')
  })

  it('JSON do build ilegível: 404', async () => {
    fs.writeFileSync(path.join(root, 'data', 'v', 'pages', `${NOTE}.json`), '{')
    expect((await edit('status', 'novo', 'ok')).status).toBe(404)
    expect(read()).toBe(NOTE_TEXT)
  })

  it('a chave é conferida no disco, não no JSON do build', async () => {
    write(`${NOTE}.md`, NOTE_TEXT.replace('status: ok\n', 'status: ok\nnova: 1\n'))
    const res = await edit('nova', 2, 1)
    expect(res.status).toBe(200)
    expect(read()).toContain('nova: 2\n')
  })
})

describe('chave', () => {
  it.each([
    ['ausente', NOTE, 'nada', 'A propriedade não existe na nota'],
    ['cover (escondida)', NOTE, 'cover', 'Esta propriedade não se edita'],
    ['note_type (escondida)', NOTE, 'note_type', 'Esta propriedade não se edita'],
    ['parent numa aba', 'Notas/Aba', 'parent', 'Esta propriedade não se edita'],
    ['order numa aba', 'Notas/Aba', 'order', 'Esta propriedade não se edita'],
    ['ID (readonly)', NOTE, 'ID', 'A propriedade é somente leitura'],
    ['objeto', NOTE, 'meta', 'A propriedade é somente leitura'],
    ['imagem', NOTE, 'poster', 'A propriedade é somente leitura'],
  ])('%s: 422', async (_, p, key, error) => {
    const before = snapshot()
    mockToken = 'admin' // nem o admin edita
    const res = await patch({ path: p, key, value: 'x', expected: null })
    expect(res.status).toBe(422)
    expect(res.json.error).toBe(error)
    expect(snapshot()).toEqual(before)
    expect(runRebuild).not.toHaveBeenCalled()
  })

  it('parent numa nota comum é propriedade como outra qualquer', async () => {
    const res = await patch({ path: 'Notas/Comum', key: 'parent', value: 'y', expected: 'x' })
    expect(res.status).toBe(200)
    expect(read('Notas/Comum')).toBe('---\nparent: "y"\nstatus: ok\n---\nComum.\n')
  })
})

describe('valor', () => {
  it.each([
    ['número em texto', 'rating', '12', 3],
    ['texto com quebra de linha', 'status', 'a\nb', 'ok'],
    ['lista com item repetido', 'genres', ['a', 'a'], ['a', 'b']],
    ['data que não existe', 'due', '2024-02-30', '2024-01-05'],
    ['checkbox em texto', 'done', 'true', false],
  ])('%s: 400, sem gravar', async (_, key, value, expected) => {
    const res = await edit(key, value, expected)
    expect(res.status).toBe(400)
    expect(typeof res.json.error).toBe('string')
    expect(read()).toBe(NOTE_TEXT)
    expect(runRebuild).not.toHaveBeenCalled()
  })

  it.each([
    ['caminho solto', 'status', 'img/b.png', 'ok'],
    ['wikilink', 'status', '[[img/b.png]]', 'ok'],
    ['wikilink com alias e extensão em maiúsculas', 'status', '[[b.PNG|capa]]', 'ok'],
    ['imagem que existe no vault', 'status', 'img/a.png', 'ok'],
    ['item de lista', 'genres', ['a', 'img/c.jpg'], ['a', 'b']],
  ])('citar imagem do vault (%s): 400, sem gravar', async (_, key, value, expected) => {
    const res = await edit(key, value, expected)
    expect(res.status).toBe(400)
    expect(res.json.error).toBe('O valor não pode citar imagem do vault')
    expect(read()).toBe(NOTE_TEXT)
    expect(runRebuild).not.toHaveBeenCalled()
    expect(writeLogs()).toEqual([])
  })

  it('URL http(s) terminada em .png passa', async () => {
    const res = await edit('status', 'https://example.com/a.png', 'ok')
    expect(res.status).toBe(200)
    expect(res.json.property.locked).toBeUndefined()
    expect(read()).toContain('status: "https://example.com/a.png"\n')
  })

  it('texto só de espaços é gravado como chave vazia', async () => {
    const res = await edit('status', '   ', 'ok')
    expect(res.status).toBe(200)
    expect(res.json.property).toEqual({ key: 'status', type: 'text', value: null, html: '' })
    expect(read()).toBe(NOTE_TEXT.replace('status: ok\n', 'status:\n'))
  })

  it('lista vazia', async () => {
    const res = await edit('genres', [], ['a', 'b'])
    expect(res.status).toBe(200)
    expect(read()).toBe(NOTE_TEXT.replace('genres:\n  - a\n  - b\n', 'genres: []\n'))
  })
})

// Uma edição pelo viewer nunca muda o tipo da propriedade: o tipo que o próximo build daria ao
// valor gravado tem de ser o da linha.
describe('tipo da propriedade', () => {
  const TYPED = NOTE_TEXT.replace(
    'due: 2024-01-05\n',
    'due: 2024-01-05\nwhen: 2024-01-05T10:30\ntags:\n  - x\naliases:\n  - y\n',
  )

  beforeEach(() => {
    write(`${NOTE}.md`, TYPED)
  })

  it.each([
    ['limpar um número inferido', 'rating', null, 3],
    ['limpar um checkbox inferido', 'done', null, false],
    ['limpar uma data inferida', 'due', null, '2024-01-05'],
    ['limpar uma data-hora inferida', 'when', null, '2024-01-05T10:30'],
    ['texto que recebe cara de data', 'status', '2024-01-02', 'ok'],
    ['texto que recebe cara de data-hora', 'status', '2024-01-02T10:00', 'ok'],
  ])('%s: 400, sem gravar, sem log nem build', async (_, key, value, expected) => {
    setTypes({})
    const res = await edit(key, value, expected)
    expect(res.status).toBe(400)
    expect(res.json).toEqual({ error: 'O valor mudaria o tipo da propriedade' })
    expect(read()).toBe(TYPED)
    expect(allFiles().filter(f => f.endsWith('.tmp'))).toEqual([])
    expect(runRebuild).not.toHaveBeenCalled()
    expect(writeLogs()).toEqual([])
  })

  it('limpar um tipo declarado no types.json grava a chave vazia', async () => {
    const res = await edit('rating', null, 3)
    expect(res.status).toBe(200)
    expect(res.json.property).toEqual({ key: 'rating', type: 'number', value: null, html: '' })
    expect(read()).toBe(TYPED.replace('rating: 3\n', 'rating:\n'))
  })

  it.each([
    ['tags esvaziada', 'tags', [], ['x'], 'tags'],
    ['aliases esvaziada', 'aliases', [], ['y'], 'aliases'],
    ['tags com outro item', 'tags', ['z'], ['x'], 'tags'],
    ['lista esvaziada com []', 'genres', [], ['a', 'b'], 'multitext'],
    ['texto comum', 'status', 'novo', 'ok', 'text'],
    ['texto limpo com null', 'status', null, 'ok', 'text'],
    ['texto limpo com espaços', 'status', '   ', 'ok', 'text'],
    ['texto "true"', 'status', 'true', 'ok', 'text'],
    ['texto "123"', 'status', '123', 'ok', 'text'],
    ['número trocado', 'rating', 5, 3, 'number'],
    ['checkbox trocado', 'done', true, false, 'checkbox'],
    ['data trocada', 'due', '2025-03-04', '2024-01-05', 'date'],
    ['data-hora trocada', 'when', '2025-03-04T00:00', '2024-01-05T10:30', 'datetime'],
  ])('%s: 200, o tipo fica', async (_, key, value, expected, type) => {
    setTypes({})
    const res = await edit(key, value, expected)
    expect(res.status).toBe(200)
    expect(res.json.property.type).toBe(type)
    expect(res.json.property.mismatch).toBeUndefined()
    expect(read()).not.toBe(TYPED)
  })
})

describe('conflito', () => {
  it('expected diferente do disco: 409 com a linha atual, sem gravar', async () => {
    const changed = NOTE_TEXT.replace('status: ok', 'status: mudou')
    write(`${NOTE}.md`, changed)
    const res = await edit('status', 'novo', 'ok')
    expect(res.status).toBe(409)
    expect(res.json.error).toBe('A propriedade mudou desde que foi aberta')
    expect(res.json.property).toMatchObject({ key: 'status', value: 'mudou' })
    expect(read()).toBe(changed)
    expect(runRebuild).not.toHaveBeenCalled()
  })

  it('mismatch sem confirm: 409; com confirm: grava no tipo da propriedade', async () => {
    const mismatched = NOTE_TEXT.replace('rating: 3', 'rating: "12"')
    write(`${NOTE}.md`, mismatched)
    for (const extra of [{}, { confirm: false }]) {
      const res = await edit('rating', 12, '12', extra)
      expect(res.status).toBe(409)
      expect(res.json.error).toBe('O valor atual não é do tipo da propriedade: confirme para substituir')
      expect(res.json.property).toMatchObject({ key: 'rating', type: 'number', value: '12', mismatch: true })
    }
    expect(read()).toBe(mismatched)
    expect(runRebuild).not.toHaveBeenCalled()

    const res = await edit('rating', 12, '12', { confirm: true })
    expect(res.status).toBe(200)
    expect(res.json.property).toEqual({ key: 'rating', type: 'number', value: 12, html: '12' })
    expect(read()).toBe(NOTE_TEXT.replace('rating: 3', 'rating: 12'))
  })

  // O `expected` e o `confirm` vêm antes da validação do valor: o tipo do disco pode não ser
  // mais o que o cliente viu, e então o valor mandado não vale para ele.
  it('o disco mudou de tipo sem rebuild: 409 com a linha atual, não 400', async () => {
    setTypes({})
    await build()
    expect(builtRow(NOTE, 'rating')).toMatchObject({ type: 'number', value: 3 })
    const changed = NOTE_TEXT.replace('rating: 3', 'rating: três')
    write(`${NOTE}.md`, changed)
    const res = await edit('rating', 4, 3)
    expect(res.status).toBe(409)
    expect(res.json.error).toBe('A propriedade mudou desde que foi aberta')
    expect(res.json.property.type).toBe('text')
    expect(res.json.property.value).toBe('três')
    expect(read()).toBe(changed)
    expect(runRebuild).not.toHaveBeenCalled()
    expect(writeLogs()).toEqual([])
  })

  it('types.json mudou o tipo depois do build: 409 com a linha atual, sem gravar', async () => {
    setTypes({})
    await build()
    setTypes({ rating: 'text' })
    const res = await edit('rating', 4, 3)
    expect(res.status).toBe(409)
    expect(res.json.error).toBe('A propriedade mudou desde que foi aberta')
    expect(res.json.property).toMatchObject({ key: 'rating', type: 'text', value: '3' })
    expect(read()).toBe(NOTE_TEXT)
    expect(runRebuild).not.toHaveBeenCalled()
  })

  it('types.json passou a checkbox depois do build: 409 de mismatch antes do 400 do valor', async () => {
    setTypes({ rating: 'checkbox' })
    const res = await edit('rating', 4, 3)
    expect(res.status).toBe(409)
    expect(res.json.error).toBe('O valor atual não é do tipo da propriedade: confirme para substituir')
    expect(res.json.property).toMatchObject({ key: 'rating', type: 'checkbox', value: 3, mismatch: true })
    // Com o confirm, o valor é conferido contra o tipo da linha. Um número ainda é o valor do
    // tipo do build (number): o cliente recebe de novo a linha atual, e nada se grava.
    const stale = await edit('rating', 4, 3, { confirm: true })
    expect(stale.status).toBe(409)
    expect(stale.json.property).toMatchObject({ key: 'rating', type: 'checkbox', mismatch: true })
    expect(read()).toBe(NOTE_TEXT)
    expect(runRebuild).not.toHaveBeenCalled()
    // Um booleano, o valor do tipo novo, passa.
    const ok = await edit('rating', true, 3, { confirm: true })
    expect(ok.status).toBe(200)
    expect(ok.json.property).toMatchObject({ key: 'rating', type: 'checkbox', value: true })
    expect(read()).toBe(NOTE_TEXT.replace('rating: 3', 'rating: true'))
  })

  it('o tipo do build é o do disco: um valor fora do tipo continua 400', async () => {
    const res = await edit('rating', 'quatro', 3)
    expect(res.status).toBe(400)
    expect(res.json.property).toBeUndefined()
    expect(read()).toBe(NOTE_TEXT)
  })

  // O `types.json` mudou o tipo sem mudar o valor normalizado: nenhum dos dois 409 acima
  // dispara, e o valor mandado foi pensado para o tipo do build. O 400 da validação vira o 409
  // com a linha atual; um valor válido no tipo novo passa, sem laço até o rebuild.
  it('types.json mudou o tipo sem mudar o valor: 409 com a linha atual, e o valor do tipo novo passa', async () => {
    setTypes({ due: 'text' })
    await build()
    expect(builtRow(NOTE, 'due')).toMatchObject({ type: 'text', value: '2024-01-05' })
    setTypes({ due: 'date' })
    const res = await edit('due', 'amanhã', '2024-01-05')
    expect(res.status).toBe(409)
    expect(res.json.error).toBe('A propriedade mudou desde que foi aberta')
    expect(res.json.property).toMatchObject({ key: 'due', type: 'date', value: '2024-01-05' })
    expect(read()).toBe(NOTE_TEXT)
    expect(runRebuild).not.toHaveBeenCalled()
    expect(writeLogs()).toEqual([])

    const again = await edit('due', '2024-02-03', res.json.property.value)
    expect(again.status).toBe(200)
    expect(again.json.property).toMatchObject({ key: 'due', type: 'date', value: '2024-02-03' })
    expect(read()).toBe(NOTE_TEXT.replace('due: 2024-01-05', 'due: 2024-02-03'))
  })

  it('a declaração saiu do types.json depois do build (mismatch confirmado): 409, não 400', async () => {
    const mismatched = NOTE_TEXT.replace('rating: 3', 'rating: "12"')
    write(`${NOTE}.md`, mismatched)
    await build()
    expect(builtRow(NOTE, 'rating')).toMatchObject({ type: 'number', value: '12', mismatch: true })
    setTypes({})
    const res = await edit('rating', 12, '12', { confirm: true })
    expect(res.status).toBe(409)
    expect(res.json.error).toBe('A propriedade mudou desde que foi aberta')
    expect(res.json.property).toEqual({ key: 'rating', type: 'text', value: '12', html: '12' })
    expect(read()).toBe(mismatched)
    expect(runRebuild).not.toHaveBeenCalled()
  })

  it('a nota muda em outra chave durante a gravação: refaz e mantém as duas mudanças', async () => {
    const hook = vi.spyOn(propertyHooks, 'beforeCommit').mockImplementationOnce(file => {
      fs.writeFileSync(file, fs.readFileSync(file, 'utf-8').replace('rating: 3', 'rating: 4'))
    })
    const res = await edit('status', 'novo', 'ok')
    expect(res.status).toBe(200)
    expect(hook).toHaveBeenCalledTimes(2)
    expect(read()).toBe(NOTE_TEXT.replace('status: ok', 'status: "novo"').replace('rating: 3', 'rating: 4'))
    expect(allFiles().filter(f => f.endsWith('.tmp'))).toEqual([])
    expect(runRebuild).toHaveBeenCalledWith('v', { first: [NOTE] })
  })

  it('rename preso (EBUSY) enquanto outra chave muda no disco: refaz e mantém as duas mudanças', async () => {
    const rename = vi.spyOn(fsp, 'rename').mockImplementationOnce(async (_from, to) => {
      fs.writeFileSync(to, fs.readFileSync(to, 'utf-8').replace('rating: 3', 'rating: 4'))
      throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' })
    })
    const res = await edit('status', 'novo', 'ok')
    expect(res.status).toBe(200)
    expect(rename).toHaveBeenCalledTimes(2)
    expect(read()).toBe(NOTE_TEXT.replace('status: ok', 'status: "novo"').replace('rating: 3', 'rating: 4'))
    expect(allFiles().filter(f => f.endsWith('.tmp'))).toEqual([])
    expect(runRebuild).toHaveBeenCalledWith('v', { first: [NOTE] })
  })

  it('a nota muda na mesma chave durante a gravação: 409 com o valor externo, que fica', async () => {
    vi.spyOn(propertyHooks, 'beforeCommit').mockImplementationOnce(file => {
      fs.writeFileSync(file, fs.readFileSync(file, 'utf-8').replace('status: ok', 'status: externo'))
    })
    const res = await edit('status', 'novo', 'ok')
    expect(res.status).toBe(409)
    expect(res.json.error).toBe('A propriedade mudou desde que foi aberta')
    expect(res.json.property).toMatchObject({ key: 'status', value: 'externo' })
    expect(read()).toBe(NOTE_TEXT.replace('status: ok', 'status: externo'))
    expect(allFiles().filter(f => f.endsWith('.tmp'))).toEqual([])
    expect(runRebuild).not.toHaveBeenCalled()
    expect(writeLogs()).toEqual([])
  })

  it('a nota muda a cada tentativa: 409 depois de MAX_EDIT_ATTEMPTS, sem perder nada', async () => {
    expect(MAX_EDIT_ATTEMPTS).toBe(4)
    const hook = vi.spyOn(propertyHooks, 'beforeCommit').mockImplementation(file => {
      const t = fs.readFileSync(file, 'utf-8')
      fs.writeFileSync(file, t.replace(/rating: (\d+)/, (_, n: string) => `rating: ${Number(n) + 1}`))
    })
    const res = await edit('status', 'novo', 'ok')
    expect(res.status).toBe(409)
    expect(res.json.error).toBe('A nota mudou enquanto era gravada')
    expect(res.json.property).toMatchObject({ key: 'status', value: 'ok' })
    expect(hook).toHaveBeenCalledTimes(4)
    expect(read()).toBe(NOTE_TEXT.replace('rating: 3', 'rating: 7'))
    expect(allFiles().filter(f => f.endsWith('.tmp'))).toEqual([])
    expect(runRebuild).not.toHaveBeenCalled()
  })

  it('duas edições ao mesmo tempo em chaves diferentes: as duas ficam', async () => {
    const [a, b] = await Promise.all([edit('status', 'novo', 'ok'), edit('rating', 5, 3)])
    expect([a.status, b.status]).toEqual([200, 200])
    expect(read()).toBe(NOTE_TEXT.replace('status: ok', 'status: "novo"').replace('rating: 3', 'rating: 5'))
  })

  it('duas edições ao mesmo tempo na mesma chave com o mesmo expected: uma passa, a outra leva 409', async () => {
    const res = await Promise.all([edit('status', 'um', 'ok'), edit('status', 'dois', 'ok')])
    expect(res.map(r => r.status).sort()).toEqual([200, 409])
    expect(read()).toBe(NOTE_TEXT.replace('status: ok', 'status: "um"'))
  })
})

// A configuração de propriedades (tipos e travas) é lida a cada requisição. Ausente conta como
// vazia, como no build; um erro de leitura, ou um arquivo que segue malformado, não falha aberto.
describe('configuração de propriedades do vault', () => {
  const CONFIG_ERROR = 'A configuração de propriedades do vault não pôde ser lida'
  const warns = () => vi.mocked(console.warn).mock.calls.map(c => String(c[0]))

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  it.each([
    ['.vaultwright/properties.json', 'ID', 8, 7],
    ['.obsidian/types.json', 'status', 'novo', 'ok'],
  ])('%s ilegível (uma pasta, EISDIR): 503, sem gravar nem pedir build', async (rel, key, value, expected) => {
    fs.rmSync(path.join(vaultDir, rel))
    fs.mkdirSync(path.join(vaultDir, rel))
    const before = snapshot()
    const res = await edit(key, value, expected)
    expect(res.status).toBe(503)
    expect(res.json).toEqual({ error: CONFIG_ERROR })
    expect(snapshot()).toEqual(before)
    expect(runRebuild).not.toHaveBeenCalled()
    expect(writeLogs()).toEqual([])
    // O aviso diz o arquivo e o código, sem o caminho absoluto.
    const warning = warns().find(w => w.includes(rel))
    expect(warning).toContain('EISDIR')
    expect(warning).not.toContain(vaultDir)
    expect(warning).not.toContain(root)
    // O 503 sai antes de tocar a nota: nem uma nota inexistente chega ao 404.
    expect((await patch({ path: 'Notas/Nao Existe', key, value, expected })).status).toBe(503)
  })

  // O caso que motivou o 503: o Windows segura o arquivo (antivírus, indexador, sincronizador).
  // A leitura espera a trava como a da nota, e só depois das tentativas recusa a edição.
  describe('.vaultwright/properties.json preso pelo Windows (EBUSY)', () => {
    const busyError = () => Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' })
    const isLockFile = (p: unknown): boolean =>
      typeof p === 'string' && path.basename(p) === 'properties.json' && path.basename(path.dirname(p)) === '.vaultwright'
    function holdLockFile(times: number): () => number {
      let reads = 0
      const realAsync = fsp.readFile.bind(fsp) as (...a: unknown[]) => Promise<unknown>
      vi.spyOn(fsp, 'readFile').mockImplementation(((p: unknown, ...rest: unknown[]) => {
        if (!isLockFile(p)) return realAsync(p, ...rest)
        reads++
        return reads <= times ? Promise.reject(busyError()) : realAsync(p, ...rest)
      }) as typeof fsp.readFile)
      return () => reads
    }

    it('preso em toda leitura: 503 depois das tentativas, sem gravar nem pedir build', async () => {
      const reads = holdLockFile(Infinity)
      const before = snapshot()
      const res = await edit('ID', 8, 7)
      expect(res.status).toBe(503)
      expect(res.json).toEqual({ error: CONFIG_ERROR })
      // A primeira leitura e as 5 repetições do `overLocks`.
      expect(reads()).toBe(6)
      expect(snapshot()).toEqual(before)
      expect(runRebuild).not.toHaveBeenCalled()
      expect(writeLogs()).toEqual([])
      expect(warns().find(w => w.includes('.vaultwright/properties.json'))).toContain('EBUSY')
    })

    it('preso só na primeira leitura: espera, e a trava readonly vale', async () => {
      const reads = holdLockFile(1)
      const res = await edit('ID', 8, 7)
      expect(reads()).toBe(2)
      expect(res.status).toBe(422)
      expect(res.json.error).toBe('A propriedade é somente leitura')
      expect(read()).toBe(NOTE_TEXT)
      expect(runRebuild).not.toHaveBeenCalled()
    })
  })

  // Malformado não falha aberto: lido no meio de uma regravação que não é atômica, o arquivo
  // vazio ou cortado tiraria as travas readonly e os tipos declarados por um instante. A API
  // relê uma vez e, se continuar malformado, recusa a edição. O build segue ignorando o arquivo.
  describe('malformado', () => {
    const FILES = [
      ['.vaultwright/properties.json', 'ID', 8, 7],
      ['.obsidian/types.json', 'status', 'novo', 'ok'],
    ] as const
    // Conta as leituras do arquivo e, se pedido, troca o conteúdo das primeiras.
    function spyConfigReads(rel: string, firstReads: string[] = []): () => number {
      let reads = 0
      const realAsync = fsp.readFile.bind(fsp) as (...a: unknown[]) => Promise<unknown>
      vi.spyOn(fsp, 'readFile').mockImplementation(((p: unknown, ...rest: unknown[]) => {
        if (typeof p !== 'string' || path.relative(vaultDir, p).split(path.sep).join('/') !== rel) return realAsync(p, ...rest)
        reads++
        return reads <= firstReads.length ? Promise.resolve(firstReads[reads - 1]) : realAsync(p, ...rest)
      }) as typeof fsp.readFile)
      return () => reads
    }

    it.each(FILES.flatMap(f => [[...f, '{'], [...f, '']]))(
      '%s malformado nas duas leituras (%#): 503, sem gravar nem pedir build',
      async (rel, key, value, expected, content) => {
        write(rel, content)
        const reads = spyConfigReads(rel)
        const before = snapshot()
        const res = await edit(key, value, expected)
        expect(res.status).toBe(503)
        expect(res.json).toEqual({ error: CONFIG_ERROR })
        expect(reads()).toBe(2)
        expect(snapshot()).toEqual(before)
        expect(runRebuild).not.toHaveBeenCalled()
        expect(writeLogs()).toEqual([])
        expect(warns().find(w => w.includes(rel))).toContain('edição recusada')
        // O 503 sai antes de tocar a nota: nem uma nota inexistente chega ao 404.
        expect((await patch({ path: 'Notas/Nao Existe', key, value, expected })).status).toBe(503)
      },
    )

    it('.vaultwright/properties.json cortado só na primeira leitura: relê, e a trava readonly vale', async () => {
      const reads = spyConfigReads('.vaultwright/properties.json', ['{"version":1,"propert'])
      const res = await edit('ID', 8, 7)
      expect(reads()).toBe(2)
      expect(res.status).toBe(422)
      expect(res.json.error).toBe('A propriedade é somente leitura')
      expect(read()).toBe(NOTE_TEXT)
      expect(runRebuild).not.toHaveBeenCalled()
    })

    it('.obsidian/types.json vazio só na primeira leitura: relê, e o tipo declarado vale', async () => {
      // Com o `number` declarado, `"12"` é mismatch e pede confirmação; sem tipos, seria texto.
      write(`${NOTE}.md`, NOTE_TEXT.replace('rating: 3', 'rating: "12"'))
      const reads = spyConfigReads('.obsidian/types.json', [''])
      const res = await edit('rating', 13, '12')
      expect(reads()).toBe(2)
      expect(res.status).toBe(409)
      expect(res.json.property).toMatchObject({ key: 'rating', type: 'number', mismatch: true })
      expect(read()).toContain('rating: "12"')
    })

    it('arquivo bem formado é lido uma vez só', async () => {
      const reads = spyConfigReads('.vaultwright/properties.json')
      expect((await edit('ID', 8, 7)).status).toBe(422)
      expect(reads()).toBe(1)
    })
  })

  it('os dois arquivos ausentes: sem tipos declarados nem travas', async () => {
    fs.rmSync(path.join(vaultDir, '.vaultwright'), { recursive: true })
    fs.rmSync(path.join(vaultDir, '.obsidian'), { recursive: true })
    const res = await edit('ID', 8, 7)
    expect(res.status).toBe(200)
    expect(res.json.property.locked).toBeUndefined()
    expect(read()).toContain('ID: 8\n')
    expect(warns()).toEqual([])
  })

  it('a config é relida a cada requisição', async () => {
    expect((await edit('status', 'um', 'ok')).status).toBe(200)
    write('.vaultwright/properties.json', '{"version":1,"properties":{"status":{"readonly":true}}}')
    const res = await edit('status', 'dois', 'um')
    expect(res.status).toBe(422)
    expect(res.json.error).toBe('A propriedade é somente leitura')
  })
})

describe('sucesso', () => {
  it('a linha devolvida é igual à que o build grava depois', async () => {
    const cases: [string, string, unknown, unknown][] = [
      [NOTE, 'status', 'Veja [[Notas/Outra]] e [[Nao Existe]] <b>', 'ok'],
      [NOTE, 'genres', ['x', '[[Notas/Outra|outra]]'], ['a', 'b']],
      [NOTE, 'due', '2025-03-04', '2024-01-05'],
      [NOTE, 'done', true, false],
    ]
    const rows: PageProperty[] = []
    for (const [p, key, value, expected] of cases) {
      const res = await patch({ path: p, key, value, expected })
      expect(res.status).toBe(200)
      rows.push(res.json.property)
    }
    expect(rows[0].html).toContain('href="/vault/v/Notas/Outra"')
    expect(rows[0].html).toContain('vault-dead-link')
    expect(rows[0].html).toContain('&lt;b&gt;')

    await build()
    cases.forEach(([p, key], i) => expect(rows[i]).toEqual(builtRow(p, key)))
  })

  it('pede o rebuild com a nota na frente e loga a gravação', async () => {
    const res = await edit('status', 'novo', 'ok')
    expect(res.status).toBe(200)
    expect(runRebuild).toHaveBeenCalledTimes(1)
    expect(runRebuild).toHaveBeenCalledWith('v', { first: [NOTE] })
    expect(writeLogs()).toEqual(['[properties] "ana" "v" "Notas/Minha Nota" "status"'])
  })

  it('um rebuild que rejeita não derruba a resposta', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    runRebuild.mockRejectedValue(new Error('x'))
    expect((await edit('status', 'novo', 'ok')).status).toBe(200)
    await new Promise(r => setTimeout(r, 0))
    expect(err).toHaveBeenCalled()
  })

  it('fora do bloco, a nota fica byte a byte igual (CRLF, BOM e comentários)', async () => {
    const crlf =
      '\uFEFF---\r\n# comentário de topo\r\nstatus: ok # fim de linha\r\n# entre chaves\r\nrating: 3\r\n---\r\nCorpo\r\ncom CRLF.\r\n'
    write('Notas/Crlf.md', crlf)
    await build()
    const res = await patch({ path: 'Notas/Crlf', key: 'status', value: 'novo', expected: 'ok' })
    expect(res.status).toBe(200)
    const want = Buffer.from(crlf.replace('status: ok # fim de linha\r\n', 'status: "novo"\r\n'), 'utf8')
    expect(bytes('Notas/Crlf').equals(want)).toBe(true)
    expect(bytes('Notas/Crlf').subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(true)
  })

  it('só a nota muda no vault: nada de temporário nem de _comments/', async () => {
    const before = snapshot().filter(([f]) => f !== `${NOTE}.md`)
    expect((await edit('genres', ['c'], ['a', 'b'])).status).toBe(200)
    expect(snapshot().filter(([f]) => f !== `${NOTE}.md`)).toEqual(before)
    expect(read()).toBe(NOTE_TEXT.replace('genres:\n  - a\n  - b\n', 'genres:\n  - "c"\n'))
  })

  it('mesmo valor: 200 com a linha atual, sem gravar, sem build e sem log', async () => {
    const mtime = fs.statSync(noteFile()).mtimeMs
    for (const [key, value] of [
      ['status', 'ok'],
      ['rating', 3],
      ['genres', ['a', 'b']],
      ['due', '2024-01-05'],
      ['done', false],
    ] as const) {
      const res = await edit(key, value, value)
      expect(res.status).toBe(200)
      expect(res.json.property).toEqual(builtRow(NOTE, key))
    }
    expect(read()).toBe(NOTE_TEXT)
    expect(fs.statSync(noteFile()).mtimeMs).toBe(mtime)
    expect(runRebuild).not.toHaveBeenCalled()
    expect(writeLogs()).toEqual([])
  })
})

describe('erros', () => {
  it('erro depois de gravar: 500, o arquivo já mudou e o build é pedido assim mesmo', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(propertyHooks, 'afterCommit').mockImplementation(() => {
      throw new Error('depois da gravação')
    })
    const res = await edit('status', 'novo', 'ok')
    expect(res.status).toBe(500)
    expect(res.json).toEqual({ error: 'Erro ao gravar a propriedade' })
    expect(read()).toBe(NOTE_TEXT.replace('status: ok', 'status: "novo"'))
    expect(runRebuild).toHaveBeenCalledWith('v', { first: [NOTE] })
    expect(writeLogs()).toEqual(['[properties] "ana" "v" "Notas/Minha Nota" "status"'])
    expect(err).toHaveBeenCalled()
  })

  it('erro antes de gravar: 500 sem build', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(propertyHooks, 'beforeCommit').mockImplementation(() => {
      throw new Error('antes da gravação')
    })
    const res = await edit('status', 'novo', 'ok')
    expect(res.status).toBe(500)
    expect(read()).toBe(NOTE_TEXT)
    expect(allFiles().filter(f => f.endsWith('.tmp'))).toEqual([])
    expect(runRebuild).not.toHaveBeenCalled()
    expect(err).toHaveBeenCalled()
  })

  it.each([
    ['âncora no alvo', 'status: &s ok', 'A propriedade usa âncora ou alias do YAML e não pode ser reescrita'],
    ['alias no alvo', 'base: &b ok\nstatus: *b', 'A propriedade usa âncora ou alias do YAML e não pode ser reescrita'],
  ])('frontmatter que não se reescreve (%s): 422, sem gravar', async (_, line, error) => {
    const text = NOTE_TEXT.replace('status: ok', line)
    write(`${NOTE}.md`, text)
    const res = await edit('status', 'novo', 'ok')
    expect(res.status).toBe(422)
    expect(res.json.error).toBe(error)
    expect(read()).toBe(text)
    expect(runRebuild).not.toHaveBeenCalled()
  })

  it.each([
    ['sem frontmatter', 'status: ok\n', 'A nota não tem frontmatter'],
    ['YAML quebrado', '---\nstatus: [\n---\n', 'O frontmatter da nota não pôde ser lido'],
    ['chave repetida', '---\nstatus: ok\nstatus: ok\n---\n', 'O frontmatter da nota tem chave repetida'],
    ['outro motor', '---js\n{ status: "ok" }\n---\n', 'O frontmatter da nota não pôde ser lido'],
    ['lista em vez de mapa', '---\n- status\n---\n', 'O frontmatter da nota não é um mapa de propriedades'],
  ])('frontmatter ilegível no disco (%s): 422, sem gravar', async (_, text, error) => {
    write(`${NOTE}.md`, text)
    const res = await edit('status', 'novo', 'ok')
    expect(res.status).toBe(422)
    expect(res.json.error).toBe(error)
    expect(read()).toBe(text)
  })

  it('nota que não é UTF-8: 422, sem gravar', async () => {
    const latin1 = Buffer.from('---\nstatus: ok\ntitulo: caf\xe9\n---\n', 'latin1')
    write(`${NOTE}.md`, latin1)
    const res = await edit('status', 'novo', 'ok')
    expect(res.status).toBe(422)
    expect(res.json.error).toBe('A nota não está em UTF-8')
    expect(bytes().equals(latin1)).toBe(true)
  })

  it('nota que sumiu depois do build: 404', async () => {
    fs.rmSync(noteFile())
    expect((await edit('status', 'novo', 'ok')).status).toBe(404)
  })

  it('nota presa pelo Windows na primeira leitura (EBUSY): espera e grava', async () => {
    // A primeira leitura da nota, pela API que for, recusa como o Windows recusa um arquivo
    // que o antivírus ou o indexador segura naquele instante.
    let busy = 0
    const firstNoteRead = (p: unknown): boolean => {
      if (busy > 0 || typeof p !== 'string' || path.basename(p) !== 'Minha Nota.md') return false
      busy++
      return true
    }
    const busyError = () => Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' })
    const realSync = fs.readFileSync.bind(fs) as (...a: unknown[]) => unknown
    vi.spyOn(fs, 'readFileSync').mockImplementation(((p: unknown, ...rest: unknown[]) => {
      if (firstNoteRead(p)) throw busyError()
      return realSync(p, ...rest)
    }) as typeof fs.readFileSync)
    const realAsync = fsp.readFile.bind(fsp) as (...a: unknown[]) => Promise<unknown>
    vi.spyOn(fsp, 'readFile').mockImplementation(((p: unknown, ...rest: unknown[]) =>
      firstNoteRead(p) ? Promise.reject(busyError()) : realAsync(p, ...rest)) as typeof fsp.readFile)

    const res = await edit('status', 'novo', 'ok')
    expect(busy).toBe(1)
    expect(res.status).toBe(200)
    expect(read()).toBe(NOTE_TEXT.replace('status: ok', 'status: "novo"'))
  })
})

describe('linha de log da gravação', () => {
  it('escapa U+2028, U+2029 e U+0085 do que o usuário digitou', () => {
    afterPropertyWrite({ slug: 'v', username: 'a\u2028b\u0085c', key: 'k\u2029' }, 'Notas/N\u2028')
    const [line] = writeLogs() as string[]
    expect(line).not.toMatch(/[\u2028\u2029\u0085]/)
    expect(line).toBe('[properties] "a\\u2028b\\u0085c" "v" "Notas/N\\u2028" "k\\u2029"')
  })

  it('sem caminho de nota, loga null sem aspas', () => {
    afterPropertyWrite({ slug: 'v', username: 'ana', key: 'status' }, null)
    expect(writeLogs()).toEqual(['[properties] "ana" "v" null "status"'])
    expect(runRebuild).toHaveBeenCalledWith('v', { first: [] })
  })
})

describe('seleção única', () => {
  beforeEach(async () => {
    write('.vaultwright/properties.json', JSON.stringify({
      version: 1,
      properties: { ID: { readonly: true }, status: { select: ['ok', 'todo', 'done'], colors: { done: 'green' } } },
    }))
    await build()
    vi.mocked(console.log).mockClear()
  })

  it('a linha devolvida é a que o build seguinte grava', async () => {
    const res = await edit('status', 'done', 'ok')
    expect(res.status).toBe(200)
    await build()
    expect(res.json.property).toStrictEqual(builtRow(NOTE, 'status'))
    expect(res.json.property).toMatchObject({ select: true, colors: { done: 'green' } })
  })

  it('um valor fora da lista é aceito e gravado como texto entre aspas', async () => {
    const res = await edit('status', 'novo', 'ok')
    expect(res.status).toBe(200)
    expect(read()).toContain('status: "novo"')
    await build()
    expect(res.json.property).toStrictEqual(builtRow(NOTE, 'status'))
  })
})
