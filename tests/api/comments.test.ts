import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import fsp from 'fs/promises'
import os from 'os'
import path from 'path'
import { NextRequest } from 'next/server'
import type { PageComment, PageMeta } from '@/builder/types'
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

import { POST, PATCH, DELETE } from '@/app/api/vault/[slug]/comments/route'
import { buildVault } from '@/builder/pipeline'
import { extractFrontmatter } from '@/builder/frontmatter'
import { commentVersion } from '@/lib/comment-version'
import { commentHooks } from '@/lib/comment-store'

const MOTHER = 'Notas/Minha Nota'
const HANDLERS = { POST, PATCH, DELETE }

let root: string
let vaultDir: string

function write(rel: string, content: string) {
  const f = path.join(vaultDir, rel)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, content)
}
const read = (p: string) => fs.readFileSync(path.join(vaultDir, `${p}.md`), 'utf-8')
const exists = (p: string) => fs.existsSync(path.join(vaultDir, `${p}.md`))
const fm = (p: string) => extractFrontmatter(read(p), 'x')

// Todos os arquivos dentro do vault (caminho relativo com `/`), para provar onde se escreveu.
function allFiles(dir = vaultDir, rel = ''): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? allFiles(path.join(dir, e.name), `${rel}${e.name}/`) : [`${rel}${e.name}`],
  )
}

async function build() {
  await buildVault(vault, { dataRoot: path.join(root, 'data') })
}
function builtPage(p: string): PageMeta {
  return JSON.parse(fs.readFileSync(path.join(root, 'data', 'v', 'pages', `${p}.json`), 'utf-8'))
}

async function call(
  method: 'POST' | 'PATCH' | 'DELETE',
  body: unknown,
  opts: { slug?: string; headers?: Record<string, string>; raw?: string } = {},
) {
  const slug = opts.slug ?? 'v'
  const req = new NextRequest(`http://localhost/api/vault/${slug}/comments`, {
    method,
    headers: opts.headers ?? { 'content-type': 'application/json' },
    body: opts.raw ?? JSON.stringify(body),
  })
  const res = await HANDLERS[method](req, { params: Promise.resolve({ slug }) })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.status, json: (await res.json()) as any, headers: res.headers }
}

async function create(parent: string, body = 'oi', token = 'ana'): Promise<PageComment> {
  mockToken = token
  const res = await call('POST', { parent, body })
  expect(res.status).toBe(201)
  return res.json.comment
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'comments-api-'))
  vaultDir = path.join(root, 'vault')
  vault = {
    slug: 'v', name: 'v', path: vaultDir, description: '', homePage: '', coverImage: null, comments: true,
  }
  write(`${MOTHER}.md`, '---\nstatus: ok\n---\nCorpo da nota.\n')
  write('Notas/Outra.md', '---\nstatus: ok\n---\nOutra.\n')
  write('Notas/Sem Props.md', 'Sem frontmatter.\n')
  write('Notas/Aba.md', `---\nnote_type: tab\nparent: "[[${MOTHER}]]"\n---\nAba.\n`)
  vi.spyOn(process, 'cwd').mockReturnValue(root)
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  await build()
  mockToken = 'ana'
  runRebuild.mockReset()
  runRebuild.mockResolvedValue({ ok: true, output: '' })
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('POST: criar', () => {
  it('cria o comentário em _comments/<mãe>/ com o frontmatter do servidor', async () => {
    vi.spyOn(commentHooks, 'now').mockReturnValue(new Date(2026, 10, 16, 15, 30, 12))
    const res = await call('POST', { parent: MOTHER, body: '  Olá, **mundo**  ' })
    expect(res.status).toBe(201)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    const c: PageComment = res.json.comment
    expect(res.json.replyTo).toBeNull()
    expect(c.path).toMatch(/^_comments\/Notas\/Minha Nota\/2026-11-16 153012 ana-[a-z0-9]{4}$/)
    expect(c.author).toBe('ana')
    expect(c.body).toBe('Olá, **mundo**')
    expect(c.html).toContain('<strong>mundo</strong>')
    expect(c.createdAt).toBe(new Date(2026, 10, 16, 15, 30, 12).toISOString())
    expect(c.updatedAt).toBeNull()

    const raw = read(c.path)
    expect(raw).toMatch(
      /^---\nnote_type: comment\nparent: "\[\[Notas\/Minha Nota\]\]"\nauthor: "ana"\ncreated_at: 2026-11-16T15:30:12[+-]\d\d:\d\d\n---\nOlá, \*\*mundo\*\*\n$/,
    )
    // Só o comentário foi escrito, e nada de temporário ficou para trás.
    expect(allFiles().sort()).toEqual(
      ['Notas/Aba.md', 'Notas/Minha Nota.md', 'Notas/Outra.md', 'Notas/Sem Props.md', `${c.path}.md`].sort(),
    )
  })

  it('pede o rebuild com a mãe na frente, sem esperar por ele', async () => {
    let finish!: (r: unknown) => void
    runRebuild.mockReturnValue(new Promise(r => { finish = r }))
    const res = await call('POST', { parent: MOTHER, body: 'oi' })
    expect(res.status).toBe(201)
    expect(runRebuild).toHaveBeenCalledTimes(1)
    expect(runRebuild).toHaveBeenCalledWith('v', { first: [MOTHER] })
    finish({ ok: true, output: '' })
  })

  it('um rebuild que rejeita não derruba a resposta', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    runRebuild.mockRejectedValue(new Error('x'))
    expect((await call('POST', { parent: MOTHER, body: 'oi' })).status).toBe(201)
    await new Promise(r => setTimeout(r, 0))
    expect(err).toHaveBeenCalled()
  })

  it('o comentário devolvido é igual ao que o build grava depois', async () => {
    write('Mapa.canvas', '{"nodes":[],"edges":[]}')
    const body = 'Veja [[Outra]], [[Notas/Outra|a outra]], [[Mapa]] e [[Não Existe]].\n<b>cru</b>\n\n```dataviewjs\ndv.paragraph(1)\n```'
    const c = await create(MOTHER, body)
    const reply = await create(c.path, 'resposta com [[Minha Nota#Seção]]', 'bia')
    expect(c.html).toContain('href="/vault/v/Notas/Outra"')
    expect(c.html).toContain('href="/vault/v/Mapa"')
    expect(c.html).toContain('vault-dead-link')
    expect(c.html).toContain('&#x3C;b>cru&#x3C;/b>')

    await build()
    expect(builtPage(MOTHER).comments).toEqual([{ comment: c, replies: [reply] }])
  })

  it('aceita a mãe em outra caixa e grava o caminho canônico', async () => {
    const c = await create('notas/minha nota')
    expect(fm(c.path).frontmatter.parent).toBe(`[[${MOTHER}]]`)
    expect(c.path.startsWith(`_comments/${MOTHER}/`)).toBe(true)
    expect(runRebuild).toHaveBeenCalledWith('v', { first: [MOTHER] })
  })

  it('responde um comentário: mesma pasta, parent = o comentário', async () => {
    const principal = await create(MOTHER)
    mockToken = 'bia'
    const res = await call('POST', { parent: principal.path, body: 'resposta' })
    expect(res.status).toBe(201)
    expect(res.json.replyTo).toBe(principal.path)
    const reply: PageComment = res.json.comment
    expect(path.posix.dirname(reply.path)).toBe(`_comments/${MOTHER}`)
    expect(reply.author).toBe('bia')
    expect(fm(reply.path).frontmatter.parent).toBe(`[[${principal.path}]]`)
    expect(runRebuild).toHaveBeenLastCalledWith('v', { first: [MOTHER] })
  })

  it('responder uma resposta grava o parent do principal', async () => {
    const principal = await create(MOTHER)
    const reply = await create(principal.path, 'r1', 'bia')
    mockToken = 'ana'
    const res = await call('POST', { parent: reply.path, body: 'r2' })
    expect(res.status).toBe(201)
    expect(res.json.replyTo).toBe(principal.path)
    expect(fm(res.json.comment.path).frontmatter.parent).toBe(`[[${principal.path}]]`)

    await build()
    const threads = builtPage(MOTHER).comments!
    expect(threads).toHaveLength(1)
    expect(threads[0].replies.map(r => r.body).sort()).toEqual(['r1', 'r2'])
  })

  it('responde um comentário escrito à mão fora de _comments/, gravando em _comments/', async () => {
    write('Notas/Recado.md', `---\nnote_type: comment\nparent: "[[${MOTHER}]]"\nauthor: zé\n---\nà mão\n`)
    const reply = await create('Notas/Recado', 'resposta')
    expect(reply.path.startsWith(`_comments/${MOTHER}/`)).toBe(true)
    expect(fm(reply.path).frontmatter.parent).toBe('[[Notas/Recado]]')
  })

  it('colisão de nome: sorteia de novo e não sobrescreve', async () => {
    vi.spyOn(commentHooks, 'now').mockReturnValue(new Date(2026, 10, 16, 15, 30, 12))
    const taken = `_comments/${MOTHER}/2026-11-16 153012 ana-aaaa`
    write(`${taken}.md`, 'já existia')
    const suffix = vi.spyOn(commentHooks, 'suffix')
    suffix.mockReturnValueOnce('aaaa').mockReturnValueOnce('aaaa').mockReturnValueOnce('bbbb')
    const res = await call('POST', { parent: MOTHER, body: 'novo' })
    expect(res.status).toBe(201)
    expect(res.json.comment.path).toBe(`_comments/${MOTHER}/2026-11-16 153012 ana-bbbb`)
    expect(read(taken)).toBe('já existia')
  })

  it('colisão em todos os sorteios: 500, sem sobrescrever', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(commentHooks, 'now').mockReturnValue(new Date(2026, 10, 16, 15, 30, 12))
    vi.spyOn(commentHooks, 'suffix').mockReturnValue('aaaa')
    const taken = `_comments/${MOTHER}/2026-11-16 153012 ana-aaaa`
    write(`${taken}.md`, 'já existia')
    expect((await call('POST', { parent: MOTHER, body: 'novo' })).status).toBe(500)
    expect(read(taken)).toBe('já existia')
    expect(runRebuild).not.toHaveBeenCalled()
    err.mockRestore()
  })

  it('sem hard link no disco: cria pelo plano B, sem sobrescrever', async () => {
    const link = vi.spyOn(fsp, 'link').mockRejectedValue(Object.assign(new Error('x'), { code: 'EPERM' }))
    vi.spyOn(commentHooks, 'now').mockReturnValue(new Date(2026, 10, 16, 15, 30, 12))
    vi.spyOn(commentHooks, 'suffix').mockReturnValueOnce('aaaa').mockReturnValue('bbbb')
    const taken = `_comments/${MOTHER}/2026-11-16 153012 ana-aaaa`
    write(`${taken}.md`, 'já existia')
    const c = await create(MOTHER, 'plano b')
    expect(c.path).toBe(`_comments/${MOTHER}/2026-11-16 153012 ana-bbbb`)
    expect(fm(c.path).body).toBe('plano b')
    expect(link).toHaveBeenCalledTimes(2)
    expect(read(taken)).toBe('já existia')
    expect(allFiles().filter(f => f.endsWith('.tmp'))).toEqual([])
  })

  it('vinte criações ao mesmo tempo dão vinte arquivos', async () => {
    const all = await Promise.all(
      Array.from({ length: 20 }, (_, i) => call('POST', { parent: MOTHER, body: `c${i}` })),
    )
    expect(all.every(r => r.status === 201)).toBe(true)
    expect(new Set(all.map(r => r.json.comment.path)).size).toBe(20)
  })

  it('o corpo não consegue virar frontmatter', async () => {
    const body = '---\nnote_type: tab\nauthor: root\n---\ntexto'
    const c = await create(MOTHER, body)
    const parsed = fm(c.path)
    expect(parsed.frontmatter.note_type).toBe('comment')
    expect(parsed.frontmatter.author).toBe('ana')
    expect(parsed.body).toBe(body)
  })

  it('normaliza CRLF e tira o espaço das pontas', async () => {
    const c = await create(MOTHER, '\r\n a\r\nb\rc \r\n')
    expect(c.body).toBe('a\nb\nc')
    expect(read(c.path).endsWith('---\na\nb\nc\n')).toBe(true)
  })

  it.each([
    ['nota inexistente', 'Notas/Nao Existe', 404],
    ['nota sem Propriedades', 'Notas/Sem Props', 400],
    ['aba', 'Notas/Aba', 400],
    ['path traversal', '../fora', 400],
    ['path traversal no meio', 'Notas/../../fora', 400],
    ['barra invertida', 'Notas\\Minha Nota', 400],
    ['segmento com ponto', '.obsidian/app', 400],
    ['caminho absoluto', 'C:/Windows/win', 400],
    ['stream do NTFS', 'Notas/Minha Nota::$DATA', 400],
    ['vazio', '', 400],
    ['não é texto', 5, 400],
  ])('recusa parent: %s', async (_, parent, status) => {
    const before = allFiles()
    const res = await call('POST', { parent, body: 'oi' })
    expect(res.status).toBe(status)
    expect(allFiles()).toEqual(before)
    expect(runRebuild).not.toHaveBeenCalled()
  })

  it('recusa nota criada depois do último build (ainda não é comentável no build)', async () => {
    write('Notas/Nova.md', '---\nstatus: ok\n---\nNova.\n')
    expect((await call('POST', { parent: 'Notas/Nova', body: 'oi' })).status).toBe(404)
  })

  it('recusa nota que saiu do vault depois do build', async () => {
    fs.rmSync(path.join(vaultDir, `${MOTHER}.md`))
    expect((await call('POST', { parent: MOTHER, body: 'oi' })).status).toBe(404)
  })

  it('recusa resposta a comentário órfão e a arquivo inválido de _comments/', async () => {
    write('_comments/x/orfao.md', '---\nnote_type: comment\nparent: "[[Nao/Existe]]"\nauthor: ana\n---\noi\n')
    write('_comments/x/lixo.md', 'sem frontmatter')
    expect((await call('POST', { parent: '_comments/x/orfao', body: 'oi' })).status).toBe(400)
    expect((await call('POST', { parent: '_comments/x/lixo', body: 'oi' })).status).toBe(404)
  })

  it('corpo vazio, só espaço, ausente ou que não é texto: 400', async () => {
    for (const body of ['', '  \n\t ', undefined, 5, null, ['a']]) {
      expect((await call('POST', { parent: MOTHER, body })).status).toBe(400)
    }
    expect(allFiles().some(f => f.startsWith('_comments/'))).toBe(false)
  })

  it('corpo com 10.000 caracteres passa, com 10.001 não', async () => {
    expect((await call('POST', { parent: MOTHER, body: 'a'.repeat(10_000) })).status).toBe(201)
    expect((await call('POST', { parent: MOTHER, body: ` ${'a'.repeat(10_000)} ` })).status).toBe(201)
    expect((await call('POST', { parent: MOTHER, body: 'a'.repeat(10_001) })).status).toBe(400)
  })

  it('exige application/json', async () => {
    const raw = JSON.stringify({ parent: MOTHER, body: 'oi' })
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data']) {
      expect((await call('POST', null, { raw, headers: { 'content-type': type } })).status).toBe(415)
    }
    expect((await call('POST', null, { raw, headers: {} })).status).toBe(415)
    expect((await call('POST', null, { raw, headers: { 'content-type': 'application/json; charset=utf-8' } })).status).toBe(201)
  })

  it('JSON inválido ou que não é objeto: 400', async () => {
    for (const raw of ['{', '5', '"x"', 'null', '[]']) {
      expect((await call('POST', null, { raw })).status).toBe(400)
    }
  })

  it('requisição grande demais: 413', async () => {
    const res = await call('POST', { parent: MOTHER, body: 'a'.repeat(200_000) })
    expect(res.status).toBe(413)
  })

  it('_comments escondida pelo .viewerignore: 409, sem escrever', async () => {
    write('.viewerignore', '_comments/\n')
    const res = await call('POST', { parent: MOTHER, body: 'oi' })
    expect(res.status).toBe(409)
    expect(fs.existsSync(path.join(vaultDir, '_comments'))).toBe(false)
  })

  it('_comments que é uma junção para fora do vault: 409, sem escrever lá', async () => {
    const outside = path.join(root, 'fora')
    fs.mkdirSync(outside)
    try {
      fs.symlinkSync(outside, path.join(vaultDir, '_comments'), 'junction')
    } catch {
      return // ambiente sem permissão para criar link
    }
    const res = await call('POST', { parent: MOTHER, body: 'oi' })
    expect(res.status).toBe(409)
    expect(fs.readdirSync(outside)).toEqual([])
  })

  it('username que não cabe em nome de arquivo: saneado no nome, intacto no author', async () => {
    USERS[2].username = '../a:b/c'
    try {
      const res = await call('POST', { parent: MOTHER, body: 'oi' })
      expect(res.status).toBe(201)
      const c: PageComment = res.json.comment
      expect(c.author).toBe('../a:b/c')
      expect(path.posix.dirname(c.path)).toBe(`_comments/${MOTHER}`)
      expect(path.posix.basename(c.path)).toMatch(/^\d{4}-\d\d-\d\d \d{6} __a_b_c-[a-z0-9]{4}$/)
    } finally {
      USERS[2].username = 'ana'
    }
  })

  it('author hostil não quebra o YAML', async () => {
    USERS[2].username = 'ana: x\nnote_type: tab # "\'\\'
    try {
      const c = await create(MOTHER)
      const parsed = fm(c.path).frontmatter
      expect(parsed.author).toBe('ana: x\nnote_type: tab # "\'\\')
      expect(parsed.note_type).toBe('comment')
    } finally {
      USERS[2].username = 'ana'
    }
  })

  it('nota com # no nome: o parent é gravado de um jeito que o builder lê', async () => {
    write('Notas/C# e [x].md', '---\nstatus: ok\n---\nNota.\n')
    await build()
    const c = await create('Notas/C# e [x]')
    await build()
    expect(builtPage('Notas/C# e [x]').comments).toEqual([{ comment: c, replies: [] }])
  })
})

describe('PATCH: editar', () => {
  it('o autor edita: corpo novo, updated_at, o resto preservado', async () => {
    vi.spyOn(commentHooks, 'now').mockReturnValue(new Date(2026, 10, 16, 15, 30, 12))
    const c = await create(MOTHER, 'antes')
    vi.spyOn(commentHooks, 'now').mockReturnValue(new Date(2026, 10, 17, 9, 2, 0))
    runRebuild.mockClear()

    const res = await call('PATCH', { path: c.path, body: ' depois [[Outra]] ', version: commentVersion(c) })
    expect(res.status).toBe(200)
    const e: PageComment = res.json.comment
    expect(e).toMatchObject({
      path: c.path, author: 'ana', body: 'depois [[Outra]]', createdAt: c.createdAt,
      updatedAt: new Date(2026, 10, 17, 9, 2, 0).toISOString(),
    })
    expect(e.html).toContain('href="/vault/v/Notas/Outra"')
    expect(read(c.path)).toMatch(
      /^---\nnote_type: comment\nparent: "\[\[Notas\/Minha Nota\]\]"\nauthor: "ana"\ncreated_at: 2026-11-16T15:30:12[+-]\d\d:\d\d\nupdated_at: 2026-11-17T09:02:00[+-]\d\d:\d\d\n---\ndepois \[\[Outra\]\]\n$/,
    )
    expect(runRebuild).toHaveBeenCalledWith('v', { first: [MOTHER] })
    expect(allFiles().filter(f => f.endsWith('.tmp'))).toEqual([])

    await build()
    expect(builtPage(MOTHER).comments).toEqual([{ comment: e, replies: [] }])
  })

  it('editar uma resposta mantém o parent e pede o build da mãe', async () => {
    const principal = await create(MOTHER)
    const reply = await create(principal.path, 'r', 'bia')
    runRebuild.mockClear()
    const res = await call('PATCH', { path: reply.path, body: 'r2', version: commentVersion(reply) })
    expect(res.status).toBe(200)
    expect(fm(reply.path).frontmatter.parent).toBe(`[[${principal.path}]]`)
    expect(runRebuild).toHaveBeenCalledWith('v', { first: [MOTHER] })
  })

  it('versão desatualizada: 409 com o comentário atual, sem gravar', async () => {
    const c = await create(MOTHER, 'v1')
    const first = await call('PATCH', { path: c.path, body: 'v2', version: commentVersion(c) })
    expect(first.status).toBe(200)
    runRebuild.mockClear()
    const stale = await call('PATCH', { path: c.path, body: 'v3', version: commentVersion(c) })
    expect(stale.status).toBe(409)
    expect(stale.json.comment).toEqual(first.json.comment)
    expect(fm(c.path).body).toBe('v2')
    expect(runRebuild).not.toHaveBeenCalled()
    // Com a versão nova, passa.
    const ok = await call('PATCH', { path: c.path, body: 'v3', version: commentVersion(first.json.comment) })
    expect(ok.status).toBe(200)
  })

  it('arquivo mexido à mão (corpo trocado, sem updated_at): 409', async () => {
    const c = await create(MOTHER, 'v1')
    write(`${c.path}.md`, read(c.path).replace('v1', 'mexido no editor'))
    const res = await call('PATCH', { path: c.path, body: 'v2', version: commentVersion(c) })
    expect(res.status).toBe(409)
    expect(res.json.comment.body).toBe('mexido no editor')
  })

  it('duas edições ao mesmo tempo com a mesma versão: uma passa, a outra leva 409', async () => {
    const c = await create(MOTHER, 'v1')
    const version = commentVersion(c)
    vi.spyOn(commentHooks, 'now').mockReturnValue(new Date(2030, 0, 1))
    const [a, b] = await Promise.all([
      call('PATCH', { path: c.path, body: 'a', version }),
      call('PATCH', { path: c.path, body: 'b', version }),
    ])
    expect([a.status, b.status].sort()).toEqual([200, 409])
  })

  it('outro leitor não edita, e o admin também não', async () => {
    const c = await create(MOTHER, 'da ana')
    for (const token of ['bia', 'admin']) {
      mockToken = token
      runRebuild.mockClear()
      const res = await call('PATCH', { path: c.path, body: 'invadido', version: commentVersion(c) })
      expect(res.status).toBe(403)
      expect(fm(c.path).body).toBe('da ana')
      expect(runRebuild).not.toHaveBeenCalled()
    }
  })

  it('o autor é o do banco: quem trocou de nome não edita o que era do nome antigo', async () => {
    const c = await create(MOTHER, 'da ana')
    USERS[2].username = 'ana2'
    try {
      expect((await call('PATCH', { path: c.path, body: 'x', version: commentVersion(c) })).status).toBe(403)
    } finally {
      USERS[2].username = 'ana'
    }
  })

  it('edita um comentário escrito à mão: mantém as chaves extras, o parent e o instante da criação', async () => {
    const p = `_comments/${MOTHER}/na mao`
    write(`${p}.md`, `---\nnote_type: comment\nparent: ${MOTHER}\nauthor: ana\ncreated_at: "2026-11-16T10:00:00+02:00"\ntags: [x, "a: b"]\nresolvido: true\nnota: "linha 1\\nlinha 2 --- # fim"\naninhado:\n  n: 3\n---\nà mão\n`)
    const current = { body: 'à mão', createdAt: '2026-11-16T08:00:00.000Z', updatedAt: null }
    const res = await call('PATCH', { path: p, body: 'editado', version: commentVersion(current) })
    expect(res.status).toBe(200)
    expect(res.json.comment.createdAt).toBe('2026-11-16T08:00:00.000Z')
    const parsed = fm(p).frontmatter
    expect(Object.keys(parsed).sort()).toEqual([
      'aninhado', 'author', 'created_at', 'nota', 'note_type', 'parent', 'resolvido', 'tags', 'updated_at',
    ])
    expect(parsed.parent).toBe(MOTHER)
    expect(parsed.author).toBe('ana')
    expect(parsed.tags).toEqual(['x', 'a: b'])
    expect(parsed.resolvido).toBe(true)
    expect(parsed.nota).toBe('linha 1\nlinha 2 --- # fim')
    expect(parsed.aninhado).toEqual({ n: 3 })
    expect(fm(p).body).toBe('editado')

    // Uma segunda edição mantém tudo de novo.
    const again = await call('PATCH', { path: p, body: 'de novo', version: commentVersion(res.json.comment) })
    expect(again.status).toBe(200)
    expect(fm(p).frontmatter.tags).toEqual(['x', 'a: b'])
    expect(fm(p).frontmatter.aninhado).toEqual({ n: 3 })
  })

  it.each([
    ['YAML quebrado', '---\nnote_type: comment\nparent: "[[x]]\nauthor: [ana\n---\ncorpo\n'],
    ['note_type trocado', `---\nnote_type: tab\nparent: "[[${MOTHER}]]"\nauthor: ana\n---\ncorpo\n`],
    ['parent que não é texto', '---\nnote_type: comment\nparent: [[x]]\nauthor: ana\n---\ncorpo\n'],
    ['frontmatter em JSON', '---json\n{"note_type":"comment","parent":"x","author":"ana"}\n---\ncorpo\n'],
  ])('arquivo que não é comentário válido (%s): 422, sem regravar', async (_, content) => {
    const p = `_comments/${MOTHER}/quebrado`
    write(`${p}.md`, content)
    const res = await call('PATCH', { path: p, body: 'x', version: commentVersion({ body: 'corpo', createdAt: null, updatedAt: null }) })
    expect(res.status).toBe(422)
    expect(read(p)).toBe(content)
    expect(runRebuild).not.toHaveBeenCalled()
  })

  it('arquivo com a extensão em outra caixa não é comentário para a API (o build não o vê)', async () => {
    const p = `_comments/${MOTHER}/caixa`
    const content = `---\nnote_type: comment\nparent: "[[${MOTHER}]]"\nauthor: ana\n---\ncorpo\n`
    write(`${p}.MD`, content)
    const version = commentVersion({ body: 'corpo', createdAt: null, updatedAt: null })
    expect((await call('PATCH', { path: p, body: 'x', version })).status).toBe(404)
    expect((await call('DELETE', { path: p })).status).toBe(404)
    expect(fs.readFileSync(path.join(vaultDir, `${p}.MD`), 'utf-8')).toBe(content)
  })

  it('frontmatter em JavaScript não roda: 422 no editar, 404 no apagar', async () => {
    const p = `_comments/${MOTHER}/js`
    const g = globalThis as { __commentJsRan?: boolean }
    delete g.__commentJsRan
    const content = '---js\n{ note_type: "comment", parent: "x", author: (globalThis.__commentJsRan = true, "ana") }\n---\ncorpo\n'
    write(`${p}.md`, content)
    const version = commentVersion({ body: 'corpo', createdAt: null, updatedAt: null })
    expect((await call('PATCH', { path: p, body: 'x', version })).status).toBe(422)
    expect((await call('DELETE', { path: p })).status).toBe(404)
    expect((await call('POST', { parent: p, body: 'x' })).status).not.toBe(201)
    expect(g.__commentJsRan).toBeUndefined()
    expect(read(p)).toBe(content)
  })

  it.each([
    ['fora de _comments/ (uma nota)', MOTHER, 400],
    ['comentário escrito à mão fora de _comments/', 'Notas/Recado', 400],
    ['path traversal', '_comments/../Notas/Minha Nota', 400],
    ['path traversal para fora do vault', '_comments/../../fora', 400],
    ['barra invertida', '_comments\\x', 400],
    ['segmento com ponto', '_comments/.x/y', 400],
    ['inexistente', '_comments/Notas/Minha Nota/nao existe', 404],
    ['arquivo de _comments/ que não é comentário', '_comments/x/lixo', [422, 404]],
    ['a pasta _comments em si', '_comments', 400],
  ])('recusa alvo: %s', async (_, target, status) => {
    write('Notas/Recado.md', `---\nnote_type: comment\nparent: "[[${MOTHER}]]"\nauthor: ana\n---\nà mão\n`)
    write('_comments/x/lixo.md', '---\nauthor: ana\n---\nnão é comentário\n')
    write('../fora.md', '---\nnote_type: comment\nparent: x\nauthor: ana\n---\nfora\n')
    const before = allFiles().map(f => [f, fs.readFileSync(path.join(vaultDir, f), 'utf-8')])
    const version = commentVersion({ body: 'à mão', createdAt: null, updatedAt: null })
    for (const method of ['PATCH', 'DELETE'] as const) {
      const res = await call(method, { path: target, body: 'x', version })
      const want = Array.isArray(status) ? status[method === 'PATCH' ? 0 : 1] : status
      expect(res.status).toBe(want)
    }
    expect(allFiles().map(f => [f, fs.readFileSync(path.join(vaultDir, f), 'utf-8')])).toEqual(before)
    expect(fs.readFileSync(path.join(root, 'fora.md'), 'utf-8')).toContain('fora')
    expect(runRebuild).not.toHaveBeenCalled()
  })

  it('comentário alcançado por uma junção dentro de _comments/: 404', async () => {
    const real = path.join(root, 'fora')
    fs.mkdirSync(real)
    fs.writeFileSync(path.join(real, 'c.md'), '---\nnote_type: comment\nparent: x\nauthor: ana\n---\nfora\n')
    fs.mkdirSync(path.join(vaultDir, '_comments'))
    try {
      fs.symlinkSync(real, path.join(vaultDir, '_comments', 'atalho'), 'junction')
    } catch {
      return // ambiente sem permissão para criar link
    }
    const version = commentVersion({ body: 'fora', createdAt: null, updatedAt: null })
    expect((await call('PATCH', { path: '_comments/atalho/c', body: 'x', version })).status).toBe(404)
    expect((await call('DELETE', { path: '_comments/atalho/c' })).status).toBe(404)
    expect(fs.readFileSync(path.join(real, 'c.md'), 'utf-8')).toContain('fora')
  })

  it('corpo vazio, corpo longo demais e versão ausente: 400', async () => {
    const c = await create(MOTHER, 'v1')
    const version = commentVersion(c)
    expect((await call('PATCH', { path: c.path, body: '  ', version })).status).toBe(400)
    expect((await call('PATCH', { path: c.path, body: 'a'.repeat(10_001), version })).status).toBe(400)
    expect((await call('PATCH', { path: c.path, body: 'x' })).status).toBe(400)
    expect((await call('PATCH', { path: c.path, body: 'x', version: 5 })).status).toBe(400)
    expect(fm(c.path).body).toBe('v1')
  })
})

describe('trava do Windows e falha depois da escrita', () => {
  const errno = (code: string) => Object.assign(new Error(code), { code })
  afterEach(() => vi.restoreAllMocks())

  it('editar insiste quando o rename é recusado por trava', async () => {
    const c = await create(MOTHER, 'antes')
    const real = fsp.rename.bind(fsp)
    let refusals = 0
    vi.spyOn(fsp, 'rename').mockImplementation(async (a, b) => {
      if (refusals < 2) {
        refusals++
        throw errno(refusals === 1 ? 'EPERM' : 'EBUSY')
      }
      return real(a, b)
    })
    const res = await call('PATCH', { path: c.path, body: 'depois', version: commentVersion(c) })
    expect(res.status).toBe(200)
    expect(refusals).toBe(2)
    expect(fm(c.path).body).toBe('depois')
    expect(allFiles().filter(f => f.endsWith('.tmp'))).toEqual([])
  })

  it('editar que não consegue trocar o arquivo: 500, o antigo fica inteiro e sem temporário', async () => {
    const c = await create(MOTHER, 'antes')
    const before = read(c.path)
    runRebuild.mockClear()
    vi.spyOn(fsp, 'rename').mockRejectedValue(errno('EIO'))
    const res = await call('PATCH', { path: c.path, body: 'depois', version: commentVersion(c) })
    expect(res.status).toBe(500)
    expect(read(c.path)).toBe(before)
    expect(allFiles().filter(f => f.endsWith('.tmp'))).toEqual([])
    expect(runRebuild).not.toHaveBeenCalled()
  })

  it('cascata que falha no meio: 500, mas o build é pedido com a mãe na frente', async () => {
    const c = await create(MOTHER, 'principal')
    const r = await create(c.path, 'resposta')
    runRebuild.mockClear()
    const real = fsp.unlink.bind(fsp)
    vi.spyOn(fsp, 'unlink').mockImplementation(async p => {
      if (String(p).endsWith(`${path.basename(c.path)}.md`)) throw errno('EIO')
      return real(p)
    })
    const res = await call('DELETE', { path: c.path })
    expect(res.status).toBe(500)
    expect(exists(r.path)).toBe(false)
    expect(exists(c.path)).toBe(true)
    expect(runRebuild).toHaveBeenCalledWith('v', { first: [MOTHER] })
  })
})

describe('DELETE: apagar', () => {
  it('apagar um principal leva as respostas junto e diz quantos arquivos saíram', async () => {
    const principal = await create(MOTHER, 'p')
    const r1 = await create(principal.path, 'r1', 'bia')
    const r2 = await create(r1.path, 'r2', 'ana')
    const outro = await create(MOTHER, 'outra conversa', 'bia')
    const respostaDoOutro = await create(outro.path, 'fica', 'ana')
    // Resposta de resposta escrita à mão, em outra pasta de _comments/.
    write('_comments/Avulsos/mao.md', `---\nnote_type: comment\nparent: "[[${r1.path}]]"\nauthor: zé\n---\nà mão\n`)
    // Fora de _comments/: a API não apaga.
    write('Notas/Recado.md', `---\nnote_type: comment\nparent: "[[${principal.path}]]"\nauthor: zé\n---\nfora\n`)
    runRebuild.mockClear()

    mockToken = 'ana'
    const res = await call('DELETE', { path: principal.path })
    expect(res.status).toBe(200)
    expect(res.json).toEqual({ deleted: 4 })
    for (const p of [principal.path, r1.path, r2.path, '_comments/Avulsos/mao']) expect(exists(p)).toBe(false)
    for (const p of [outro.path, respostaDoOutro.path, 'Notas/Recado', MOTHER]) expect(exists(p)).toBe(true)
    // A pasta que ficou vazia sai; a que ainda tem comentário fica.
    expect(fs.existsSync(path.join(vaultDir, '_comments', 'Avulsos'))).toBe(false)
    expect(fs.existsSync(path.join(vaultDir, '_comments', MOTHER))).toBe(true)
    expect(runRebuild).toHaveBeenCalledWith('v', { first: [MOTHER] })

    await build()
    expect(builtPage(MOTHER).comments).toEqual([{ comment: outro, replies: [respostaDoOutro] }])
  })

  it('apagar o último comentário remove as pastas vazias, mas não _comments', async () => {
    const c = await create(MOTHER)
    expect((await call('DELETE', { path: c.path })).json).toEqual({ deleted: 1 })
    expect(fs.readdirSync(path.join(vaultDir, '_comments'))).toEqual([])
  })

  it('apagar uma resposta apaga só ela', async () => {
    const principal = await create(MOTHER, 'p')
    const r1 = await create(principal.path, 'r1', 'bia')
    write('_comments/Avulsos/mao.md', `---\nnote_type: comment\nparent: "[[${r1.path}]]"\nauthor: zé\n---\nà mão\n`)
    mockToken = 'bia'
    const res = await call('DELETE', { path: r1.path })
    expect(res.json).toEqual({ deleted: 1 })
    expect(exists(principal.path)).toBe(true)
    expect(exists('_comments/Avulsos/mao')).toBe(true)
    expect(runRebuild).toHaveBeenLastCalledWith('v', { first: [MOTHER] })
  })

  it('o admin apaga o comentário de outro; outro leitor não', async () => {
    const c = await create(MOTHER, 'da ana')
    mockToken = 'bia'
    expect((await call('DELETE', { path: c.path })).status).toBe(403)
    expect(exists(c.path)).toBe(true)
    mockToken = 'admin'
    const res = await call('DELETE', { path: c.path })
    expect(res.status).toBe(200)
    expect(res.json).toEqual({ deleted: 1 })
    expect(exists(c.path)).toBe(false)
  })

  it('a dona do principal apaga a conversa com respostas de outros', async () => {
    const principal = await create(MOTHER, 'p', 'ana')
    await create(principal.path, 'r', 'bia')
    mockToken = 'ana'
    expect((await call('DELETE', { path: principal.path })).json).toEqual({ deleted: 2 })
  })

  it('apagar duas vezes: a segunda é 404', async () => {
    const c = await create(MOTHER)
    expect((await call('DELETE', { path: c.path })).status).toBe(200)
    expect((await call('DELETE', { path: c.path })).status).toBe(404)
  })

  it('comentário órfão em _comments/: o autor apaga, e o build é pedido sem frente', async () => {
    write('_comments/x/orfao.md', '---\nnote_type: comment\nparent: "[[Nao/Existe]]"\nauthor: ana\n---\noi\n')
    const res = await call('DELETE', { path: '_comments/x/orfao' })
    expect(res.json).toEqual({ deleted: 1 })
    expect(runRebuild).toHaveBeenCalledWith('v', { first: [] })
  })

  it('ciclo de parent escrito à mão não trava', async () => {
    write('_comments/x/a.md', '---\nnote_type: comment\nparent: "[[_comments/x/b]]"\nauthor: ana\n---\na\n')
    write('_comments/x/b.md', '---\nnote_type: comment\nparent: "[[_comments/x/a]]"\nauthor: ana\n---\nb\n')
    expect((await call('POST', { parent: '_comments/x/a', body: 'oi' })).status).toBe(400)
    expect((await call('DELETE', { path: '_comments/x/a' })).status).toBe(200)
    expect(exists('_comments/x/b')).toBe(true)
  })
})

describe('quem pode', () => {
  let target: PageComment
  const calls = (): [string, () => ReturnType<typeof call>][] => [
    ['POST', () => call('POST', { parent: MOTHER, body: 'oi' })],
    ['PATCH', () => call('PATCH', { path: target.path, body: 'x', version: commentVersion(target) })],
    ['DELETE', () => call('DELETE', { path: target.path })],
  ]
  async function expectRefused(status: number) {
    const before = allFiles().map(f => [f, fs.readFileSync(path.join(vaultDir, f), 'utf-8')])
    for (const [, run] of calls()) expect((await run()).status).toBe(status)
    expect(allFiles().map(f => [f, fs.readFileSync(path.join(vaultDir, f), 'utf-8')])).toEqual(before)
    expect(runRebuild).not.toHaveBeenCalled()
  }
  beforeEach(async () => {
    target = await create(MOTHER, 'da ana')
    runRebuild.mockClear()
  })

  it('sem sessão: 401', async () => {
    mockToken = undefined
    await expectRefused(401)
  })
  it('token inválido: 401', async () => {
    mockToken = 'lixo'
    await expectRefused(401)
  })
  it('usuário apagado com token ainda válido (e de admin): 401', async () => {
    mockToken = 'apagado'
    await expectRefused(401)
  })
  it('sem acesso ao vault: 403', async () => {
    mockToken = 'sem-acesso'
    await expectRefused(403)
  })
  it('vault desconhecido: 404 para o admin, 403 para o leitor', async () => {
    mockToken = 'admin'
    expect((await call('POST', { parent: MOTHER, body: 'oi' }, { slug: 'zzz' })).status).toBe(404)
    mockToken = 'ana'
    expect((await call('POST', { parent: MOTHER, body: 'oi' }, { slug: 'zzz' })).status).toBe(403)
  })
  it('flag desligada ou ausente: 403, até para o admin', async () => {
    for (const flag of [false, undefined]) {
      vault = { ...vault, comments: flag }
      mockToken = 'ana'
      await expectRefused(403)
      mockToken = 'admin'
      await expectRefused(403)
    }
  })
  it('a sessão é conferida antes do corpo da requisição', async () => {
    mockToken = undefined
    expect((await call('POST', null, { raw: '{', headers: { 'content-type': 'text/plain' } })).status).toBe(401)
  })
  it('o papel vem do banco: token de admin de quem não é admin não apaga o de outro', async () => {
    mockToken = 'bia-token-admin'
    expect((await call('DELETE', { path: target.path })).status).toBe(403)
    expect(exists(target.path)).toBe(true)
  })
  it('o papel vem do banco: quem virou admin depois do login apaga o de outro', async () => {
    USERS[3].is_admin = 1
    try {
      mockToken = 'bia'
      expect((await call('DELETE', { path: target.path })).status).toBe(200)
    } finally {
      USERS[3].is_admin = 0
    }
  })
  it('autor com espaço nas pontas não é o mesmo usuário', async () => {
    const p = `_comments/${MOTHER}/espaco`
    write(`${p}.md`, `---\nnote_type: comment\nparent: "[[${MOTHER}]]"\nauthor: " ana"\n---\nde outro\n`)
    mockToken = 'ana'
    const version = commentVersion({ body: 'de outro', createdAt: null, updatedAt: null })
    expect((await call('PATCH', { path: p, body: 'x', version })).status).toBe(403)
    expect((await call('DELETE', { path: p })).status).toBe(403)
    expect(exists(p)).toBe(true)
  })
  it('leitor com acesso comenta e responde; admin sem permissão explícita também', async () => {
    mockToken = 'bia'
    expect((await call('POST', { parent: target.path, body: 'resposta' })).status).toBe(201)
    mockToken = 'admin'
    const res = await call('POST', { parent: MOTHER, body: 'do admin' })
    expect(res.status).toBe(201)
    expect(res.json.comment.author).toBe('root')
  })
})
