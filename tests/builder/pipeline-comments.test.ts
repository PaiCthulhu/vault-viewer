import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import type { VaultConfig } from '../../types'
import { buildVault } from '../../builder/pipeline'
import { COMMENTS_MARKER } from '../../builder/comments'
import { renderComment, renderCommentFallback } from '../../builder/comment-render'
import { executeDataviewJS } from '../../builder/plugins/dataview'

// O `executeDataviewJS` real, espionado: prova direta de qual código o build executou.
vi.mock('../../builder/plugins/dataview', async importOriginal => {
  const m = await importOriginal<typeof import('../../builder/plugins/dataview')>()
  return { ...m, executeDataviewJS: vi.fn(m.executeDataviewJS) }
})

// O `renderComment` real, espionado: um teste o faz lançar.
vi.mock('../../builder/comment-render', async importOriginal => {
  const m = await importOriginal<typeof import('../../builder/comment-render')>()
  return { ...m, renderComment: vi.fn(m.renderComment) }
})

// Códigos de dataviewjs que o build mandou executar.
const executados = (): string[] => vi.mocked(executeDataviewJS).mock.calls.map(c => String(c[0]))

let TMP: string
let vault: VaultConfig

function write(rel: string, content: string) {
  const f = path.join(TMP, 'vault', rel)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, content)
}

function listFiles(dir: string, base = dir): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const abs = path.join(dir, e.name)
    return e.isDirectory() ? listFiles(abs, base) : [path.relative(base, abs).split(path.sep).join('/')]
  }).sort()
}

// Registra os arquivos gravados, na ordem, sem mudar o comportamento.
function spyWrites(): { file: string; content: string }[] {
  const writes: { file: string; content: string }[] = []
  const real = fs.writeFileSync
  vi.spyOn(fs, 'writeFileSync').mockImplementation(((f: fs.PathOrFileDescriptor, d: string | NodeJS.ArrayBufferView, o?: fs.WriteFileOptions) => {
    writes.push({ file: String(f).replace(/\.tmp-\d+$/, '').split(path.sep).join('/'), content: String(d) })
    return real(f, d, o)
  }) as typeof fs.writeFileSync)
  return writes
}

const DIR = '_comments/Notas/Minha Nota'
const ANTIGO = `${DIR}/2026-11-10 100000 ana-aaaa`
const NOVO = `${DIR}/2026-11-16 120000 bia-bbbb`
const RESPOSTA = `${DIR}/2026-11-11 100000 ana-cccc`
const RESPOSTA_DE_RESPOSTA = `${DIR}/2026-11-12 100000 bia-dddd`
const SEM_ASPAS = `${DIR}/2026-11-16 153012 ana-k3f9`
const DATAVIEW = `${DIR}/2026-11-13 100000 ana-eeee`
const DE_SEM_PROPS = '_comments/Notas/Sem Props/2026-11-16 100000 ana-ffff'
const DE_ABA = '_comments/Abas/Aba/2026-11-16 100000 ana-gggg'
const ORFAO = '_comments/Perdido/2026-11-16 100000 ana-hhhh'

function comentario(parent: string, extra: string, body: string): string {
  return `---\nnote_type: comment\nparent: "[[${parent}]]"\nauthor: ana\n${extra}---\n${body}\n`
}

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-comments-test-'))
  write('Notas/Minha Nota.md', '---\nstatus: ativo\n---\n# Minha Nota\n\ncorpo')
  write('Notas/Sem Props.md', 'só corpo')
  write('Abas/Aba.md', '---\nnote_type: tab\nparent: "[[Notas/Minha Nota]]"\ncor: azul\n---\naba')
  write(`${ANTIGO}.md`, comentario('Notas/Minha Nota', 'created_at: "2026-11-10T10:00:00Z"\n', 'comentário **antigo**'))
  write(`${NOVO}.md`, comentario('Notas/Minha Nota', 'created_at: "2026-11-16T12:00:00Z"\n', 'comentário novo'))
  write(`${RESPOSTA}.md`, comentario(ANTIGO, 'created_at: "2026-11-11T10:00:00Z"\n', 'resposta'))
  write(`${RESPOSTA_DE_RESPOSTA}.md`, comentario(RESPOSTA, 'created_at: "2026-11-12T10:00:00Z"\n', 'resposta da resposta'))
  write(`${SEM_ASPAS}.md`, comentario(NOVO, 'created_at: 2026-11-16T15:30:12-03:00\n', 'sem aspas'))
  write(`${DATAVIEW}.md`, comentario(ANTIGO, 'created_at: "2026-11-13T10:00:00Z"\n', '```dataviewjs\ndv.paragraph("SAIDA-DV")\n```'))
  write(`${DE_SEM_PROPS}.md`, comentario('Notas/Sem Props', '', 'x'))
  write(`${DE_ABA}.md`, comentario('Abas/Aba', '', 'x'))
  write(`${ORFAO}.md`, comentario('Não Existe', '', 'x'))
  vault = { slug: 'v', name: 'V', path: path.join(TMP, 'vault') } as VaultConfig
  vi.mocked(executeDataviewJS).mockClear()
  vi.mocked(renderComment).mockReset() // volta ao render real (um teste o faz lançar)
  vi.spyOn(process, 'cwd').mockReturnValue(TMP)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(TMP, { recursive: true, force: true })
})

const read = (out: string, rel: string) => JSON.parse(fs.readFileSync(path.join(out, 'v', rel), 'utf-8'))

describe('buildVault — comentários', () => {
  it('conversas anexadas à mãe certa, com resposta de resposta no principal', async () => {
    const out = path.join(TMP, 'out')
    await buildVault(vault, { dataRoot: out })
    const page = read(out, 'pages/Notas/Minha Nota.json')
    const threads = page.comments as { comment: { path: string; html: string }; replies: { path: string }[] }[]
    // Novo tem a resposta mais recente (2026-11-16 18:30 UTC): vem primeiro.
    expect(threads.map(t => t.comment.path)).toEqual([NOVO, ANTIGO])
    // Respostas cronológicas: resposta (11), dataviewjs (13) e resposta da resposta (12).
    expect(threads[1].replies.map(r => r.path)).toEqual([RESPOSTA, RESPOSTA_DE_RESPOSTA, DATAVIEW])
    expect(threads[0].replies.map(r => r.path)).toEqual([SEM_ASPAS])
    expect(threads[0].replies[0]).toEqual({
      path: SEM_ASPAS,
      author: 'ana',
      createdAt: '2026-11-16T18:30:12.000Z',
      updatedAt: null,
      body: 'sem aspas',
      html: '<p>sem aspas</p>',
    })
    expect(threads[1].comment).toMatchObject({ author: 'ana', createdAt: '2026-11-10T10:00:00.000Z', body: 'comentário **antigo**' })
    expect(threads[1].comment.html).toBe('<p>comentário <strong>antigo</strong></p>')
  })

  it('órfão e comentário de mãe não comentável não aparecem', async () => {
    const out = path.join(TMP, 'out')
    await buildVault(vault, { dataRoot: out })
    const todos = listFiles(path.join(out, 'v', 'pages')).map(f => fs.readFileSync(path.join(out, 'v', 'pages', f), 'utf-8')).join('\n')
    for (const p of [ORFAO, DE_SEM_PROPS, DE_ABA]) expect(todos).not.toContain(p)
    expect('comments' in read(out, 'pages/Notas/Sem Props.json')).toBe(false)
    expect('comments' in read(out, 'pages/Abas/Aba.json')).toBe(false)
  })

  it('commentable e marcador só em nota principal com Propriedades', async () => {
    const out = path.join(TMP, 'out')
    await buildVault(vault, { dataRoot: out })
    const mae = read(out, 'pages/Notas/Minha Nota.json')
    expect(mae.commentable).toBe(true)
    const html: string = mae.html
    const marcador = html.indexOf(COMMENTS_MARKER)
    expect(marcador).toBeGreaterThan(-1)
    expect(html.indexOf(COMMENTS_MARKER, marcador + 1)).toBe(-1)
    expect(html.slice(0, marcador).endsWith('</details>')).toBe(true)
    expect(html.indexOf('corpo')).toBeGreaterThan(marcador)
    for (const p of ['Notas/Sem Props', 'Abas/Aba']) {
      const page = read(out, `pages/${p}.json`)
      expect('commentable' in page).toBe(false)
      expect(page.html).not.toContain(COMMENTS_MARKER)
    }
  })

  it('dataviewjs de comentário não roda no build', async () => {
    const out = path.join(TMP, 'out')
    await buildVault(vault, { dataRoot: out })
    const threads = read(out, 'pages/Notas/Minha Nota.json').comments as { replies: { path: string; html: string }[] }[]
    const c = threads.flatMap(t => t.replies).find(r => r.path === DATAVIEW)!
    expect(c.html).toContain('language-dataviewjs')
    expect(c.html).toContain('dv.paragraph("SAIDA-DV")')
    for (const f of listFiles(path.join(out, 'v', 'pages'))) {
      expect(fs.readFileSync(path.join(out, 'v', 'pages', f), 'utf-8')).not.toContain('<p>SAIDA-DV</p>')
    }
  })

  it('--first dá saída idêntica com comentários, e comentário alterado põe a mãe na frente', async () => {
    const ref = path.join(TMP, 'ref')
    await buildVault(vault, { dataRoot: ref })

    const out = path.join(TMP, 'out')
    await buildVault(vault, { dataRoot: out })
    const futuro = new Date(Date.now() + 60_000)
    fs.utimesSync(path.join(TMP, 'vault', `${RESPOSTA_DE_RESPOSTA}.md`), futuro, futuro)

    const writes = spyWrites()
    await buildVault(vault, { dataRoot: out, first: [] })
    const primeira = writes.find(w => /\/pages\/.+\.json$/.test(w.file))
    expect(primeira?.file).toMatch(/\/pages\/Notas\/Minha Nota\.json$/)

    const a = listFiles(path.join(ref, 'v'))
    expect(listFiles(path.join(out, 'v'))).toEqual(a)
    for (const f of a) {
      if (f === 'index.json') continue
      expect(fs.readFileSync(path.join(out, 'v', f), 'utf-8'), f).toBe(fs.readFileSync(path.join(ref, 'v', f), 'utf-8'))
    }
  })

  // Simula o comentário apagado entre a varredura e a leitura: a primeira leitura (a do
  // passe 1) passa; depois, leitura e stat desse arquivo lançam ENOENT.
  function apagarDepoisDaVarredura(rel: string) {
    const alvo = path.join(TMP, 'vault', `${rel}.md`)
    let lido = false
    const erro = () => Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' })
    const realRead = fs.readFileSync
    vi.spyOn(fs, 'readFileSync').mockImplementation(((f: fs.PathOrFileDescriptor, o?: unknown) => {
      if (String(f) === alvo) {
        if (lido) throw erro()
        lido = true
      }
      return (realRead as (...a: unknown[]) => unknown)(f, o)
    }) as typeof fs.readFileSync)
    const realStat = fs.statSync
    vi.spyOn(fs, 'statSync').mockImplementation(((f: fs.PathLike, o?: unknown) => {
      if (String(f) === alvo && lido) throw erro()
      return (realStat as (...a: unknown[]) => unknown)(f, o)
    }) as typeof fs.statSync)
  }

  it('comentário apagado durante o build é pulado sem derrubar o build', async () => {
    apagarDepoisDaVarredura(RESPOSTA_DE_RESPOSTA)
    const out = path.join(TMP, 'out')
    await buildVault(vault, { dataRoot: out })
    const threads = read(out, 'pages/Notas/Minha Nota.json').comments as { comment: { path: string }; replies: { path: string }[] }[]
    expect(threads.map(t => t.comment.path)).toEqual([NOVO, ANTIGO])
    expect(threads[1].replies.map(r => r.path)).toEqual([RESPOSTA, DATAVIEW])
  })

  it('principal apagado durante o build leva a conversa inteira junto', async () => {
    apagarDepoisDaVarredura(NOVO)
    const out = path.join(TMP, 'out')
    await buildVault(vault, { dataRoot: out })
    const threads = read(out, 'pages/Notas/Minha Nota.json').comments as { comment: { path: string } }[]
    expect(threads.map(t => t.comment.path)).toEqual([ANTIGO])
  })

  it('erro de leitura que não é ENOENT pula o comentário com aviso e o build termina', async () => {
    const alvo = path.join(TMP, 'vault', `${RESPOSTA}.md`)
    let n = 0
    const realRead = fs.readFileSync
    vi.spyOn(fs, 'readFileSync').mockImplementation(((f: fs.PathOrFileDescriptor, o?: unknown) => {
      if (String(f) === alvo && ++n > 1) throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
      return (realRead as (...a: unknown[]) => unknown)(f, o)
    }) as typeof fs.readFileSync)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = path.join(TMP, 'out')
    await buildVault(vault, { dataRoot: out })
    const threads = read(out, 'pages/Notas/Minha Nota.json').comments as { comment: { path: string }; replies: { path: string }[] }[]
    expect(threads.map(t => t.comment.path)).toEqual([NOVO, ANTIGO])
    expect(threads[1].replies.map(r => r.path)).toEqual([RESPOSTA_DE_RESPOSTA, DATAVIEW])
    expect(warn.mock.calls.map(c => c.join(' ')).some(m => m.includes(RESPOSTA) && m.includes('EACCES'))).toBe(true)
  })
})

describe('buildVault — comentário que o render não aguenta', () => {
  const FUNDO = `${DIR}/2026-11-16 130000 ana-fund`
  const LISTA = `${DIR}/2026-11-16 130001 ana-list`
  const avisos = (warn: { mock: { calls: unknown[][] } }) => warn.mock.calls.map(c => c.map(String).join(' '))

  it('corpo fundo demais não derruba o build: a conversa sai com o fallback e um aviso com o caminho', async () => {
    const fundo = '>'.repeat(3000)
    const lista = '- '.repeat(4990).trimEnd()
    write(`${FUNDO}.md`, comentario('Notas/Minha Nota', 'created_at: "2026-11-16T13:00:00Z"\n', fundo))
    write(`${LISTA}.md`, comentario('Notas/Minha Nota', 'created_at: "2026-11-16T13:00:01Z"\n', lista))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = path.join(TMP, 'out')
    await buildVault(vault, { dataRoot: out })
    const threads = read(out, 'pages/Notas/Minha Nota.json').comments as { comment: { path: string; body: string; html: string } }[]
    const de = (p: string) => threads.find(t => t.comment.path === p)!.comment
    expect(de(FUNDO).body).toBe(fundo)
    expect(de(FUNDO).html).toBe(renderCommentFallback(fundo))
    expect(de(LISTA).html).toBe(renderCommentFallback(lista))
    // As outras conversas continuam com o render normal.
    expect(de(ANTIGO).html).toBe('<p>comentário <strong>antigo</strong></p>')
    expect(avisos(warn).some(m => m.includes(FUNDO))).toBe(true)
    expect(avisos(warn).some(m => m.includes(LISTA))).toBe(true)
  })

  it('renderComment que lança cai no fallback, com aviso, e o build termina', async () => {
    vi.mocked(renderComment).mockImplementation(() => {
      throw new RangeError('Maximum call stack size exceeded')
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = path.join(TMP, 'out')
    await buildVault(vault, { dataRoot: out })
    const threads = read(out, 'pages/Notas/Minha Nota.json').comments as { comment: { path: string; html: string } }[]
    const antigo = threads.find(t => t.comment.path === ANTIGO)!.comment
    expect(antigo.html).toBe(renderCommentFallback('comentário **antigo**'))
    expect(avisos(warn).some(m => m.includes(ANTIGO) && m.includes('Maximum call stack'))).toBe(true)
  })
})

describe('buildVault — pasta _comments/', () => {
  const QUEBRADO = '_comments/Notas/Minha Nota/quebrado'
  const dvjs = (marca: string) => '```dataviewjs\ndv.paragraph("' + marca + '")\n```\n'
  // YAML que o gray-matter rejeita (aspa sem fechar): o `extractFrontmatter` devolve
  // `frontmatter: {}` com o arquivo inteiro como corpo.
  const yamlQuebrado = (marca: string) =>
    '---\nnote_type: comment\nparent: "[[Notas/Minha Nota\n---\n' + dvjs(marca)

  // Todos os arquivos de `data/v/`, com o conteúdo.
  const saida = (out: string) =>
    listFiles(path.join(out, 'v')).map(f => ({ f, c: fs.readFileSync(path.join(out, 'v', f), 'utf-8') }))

  // O arquivo ignorado não aparece em nenhum lugar da saída e o script dele não rodou.
  function semRastro(out: string, rel: string, marca: string) {
    const arquivos = saida(out)
    expect(arquivos.filter(a => a.f.toLowerCase().startsWith('pages/_comments/'))).toEqual([])
    for (const a of arquivos) expect(a.c, a.f).not.toContain(marca)
    const index = read(out, 'pages-index.json') as { path: string }[]
    expect(index.map(e => e.path)).not.toContain(rel)
    // Nada de `_comments/` (nem os comentários válidos do vault de base) nas listas.
    for (const f of ['pages-index.json', 'tree.json', 'graph.json']) {
      const conteudo = JSON.stringify(read(out, f))
      expect(conteudo, f).not.toContain(rel)
      expect(conteudo.toLowerCase(), f).not.toContain('_comments/')
    }
    expect(read(out, 'index.json').pageCount).toBe(listFiles(path.join(out, 'v', 'pages')).length)
    expect(executados().filter(c => c.includes(marca))).toEqual([])
  }

  it('.md com YAML quebrado em _comments/ não vira página e o dataviewjs dele não roda', async () => {
    write(`${QUEBRADO}.md`, yamlQuebrado('MARCA_NAO_RODA'))
    const out = path.join(TMP, 'out')
    await buildVault(vault, { dataRoot: out })
    semRastro(out, QUEBRADO, 'MARCA_NAO_RODA')
    // As conversas válidas da mesma pasta continuam anexadas como antes.
    const threads = read(out, 'pages/Notas/Minha Nota.json').comments as { comment: { path: string } }[]
    expect(threads.map(t => t.comment.path)).toEqual([NOVO, ANTIGO])
  })

  it('comentário com frontmatter em JavaScript: o bloco não roda e o arquivo é ignorado', async () => {
    const g = globalThis as { __pipelineComentarioJsRan?: boolean }
    delete g.__pipelineComentarioJsRan
    // Rodado, o bloco faria deste arquivo um comentário válido da mãe.
    const js =
      '---js\n{ note_type: "comment", parent: "[[Notas/Minha Nota]]", author: "ana",' +
      ' created_at: (globalThis.__pipelineComentarioJsRan = true, "2026-11-20T10:00:00Z") }\n---\n'
    write(`${QUEBRADO}.md`, js + dvjs('MARCA_JS'))
    const out = path.join(TMP, 'out')
    await buildVault(vault, { dataRoot: out })
    expect(g.__pipelineComentarioJsRan).toBeUndefined()
    semRastro(out, QUEBRADO, 'MARCA_JS')
    const threads = read(out, 'pages/Notas/Minha Nota.json').comments as { comment: { path: string } }[]
    expect(threads.map(t => t.comment.path)).toEqual([NOVO, ANTIGO])
  })

  it('controle: o mesmo bloco numa nota comum fora de _comments/ roda', async () => {
    write('Notas/Controle.md', dvjs('MARCA_NAO_RODA'))
    const out = path.join(TMP, 'out')
    await buildVault(vault, { dataRoot: out })
    expect(executados().filter(c => c.includes('MARCA_NAO_RODA'))).toHaveLength(1)
    expect(read(out, 'pages/Notas/Controle.json').html).toContain('<p>MARCA_NAO_RODA</p>')
  })

  it('outra caixa e mais fundo, sem frontmatter: ignorado igual', async () => {
    // Sem a pasta `_comments/` do vault de base: num disco sem diferenciar caixa, o
    // arquivo cairia nela e o caminho sairia em minúsculas.
    fs.rmSync(path.join(TMP, 'vault', '_comments'), { recursive: true })
    write('_Comments/a/b/c.md', dvjs('MARCA_FUNDO'))
    const out = path.join(TMP, 'out')
    await buildVault(vault, { dataRoot: out })
    semRastro(out, '_Comments/a/b/c', 'MARCA_FUNDO')
    expect(fs.existsSync(path.join(out, 'v', 'pages', '_Comments'))).toBe(false)
  })

  it('aba dentro de _comments/ é ignorada: sem página e a mãe não ganha barra', async () => {
    write('Notas/Outra.md', '---\nstatus: x\n---\ncorpo')
    write('_comments/Notas/Outra/aba.md', '---\nnote_type: tab\nparent: "[[Notas/Outra]]"\n---\n' + dvjs('MARCA_ABA'))
    const out = path.join(TMP, 'out')
    await buildVault(vault, { dataRoot: out })
    semRastro(out, '_comments/Notas/Outra/aba', 'MARCA_ABA')
    const mae = read(out, 'pages/Notas/Outra.json')
    expect('tabs' in mae).toBe(false)
    expect(mae.commentable).toBe(true)
  })

  it('comentário que responde a um ignorado de _comments/ é órfão, dentro ou fora da pasta', async () => {
    write(`${QUEBRADO}.md`, '---\nparent: "[[Notas/Minha Nota]]"\n---\nsem note_type')
    const DENTRO = '_comments/Notas/Minha Nota/responde-dentro'
    const FORA = 'Fora/responde-fora'
    write(`${DENTRO}.md`, comentario(QUEBRADO, 'created_at: "2026-11-20T10:00:00Z"\n', 'dentro'))
    write(`${FORA}.md`, comentario(QUEBRADO, 'created_at: "2026-11-20T10:00:00Z"\n', 'fora'))
    const out = path.join(TMP, 'out')
    await buildVault(vault, { dataRoot: out })
    const threads = read(out, 'pages/Notas/Minha Nota.json').comments as { comment: { path: string } }[]
    expect(threads.map(t => t.comment.path)).toEqual([NOVO, ANTIGO])
    const todos = JSON.stringify(threads)
    for (const p of [QUEBRADO, DENTRO, FORA]) expect(todos).not.toContain(p)
    const paginas = listFiles(path.join(out, 'v', 'pages'))
    expect(paginas).not.toContain('Fora/responde-fora.json')
    expect(paginas.filter(f => f.startsWith('_comments/'))).toEqual([])
  })

  it('--first com o caminho do ignorado não gera página nem quebra o build', async () => {
    write(`${QUEBRADO}.md`, yamlQuebrado('MARCA_FIRST'))
    const out = path.join(TMP, 'out')
    const writes = spyWrites()
    await buildVault(vault, { dataRoot: out, first: [QUEBRADO, 'Notas/Sem Props'] })
    const primeira = writes.find(w => /\/pages\/.+\.json$/.test(w.file))
    expect(primeira?.file).toMatch(/\/pages\/Notas\/Sem Props\.json$/)
    semRastro(out, QUEBRADO, 'MARCA_FIRST')
  })

  it('Notas/_comments/x.md sem note_type continua página comum', async () => {
    write('Notas/_comments/x.md', 'nota comum')
    const out = path.join(TMP, 'out')
    await buildVault(vault, { dataRoot: out })
    expect(read(out, 'pages/Notas/_comments/x.json').html).toContain('nota comum')
    expect((read(out, 'pages-index.json') as { path: string }[]).map(e => e.path)).toContain('Notas/_comments/x')
  })

  it('_comments.md na raiz continua página comum', async () => {
    write('_comments.md', 'nota na raiz')
    const out = path.join(TMP, 'out')
    await buildVault(vault, { dataRoot: out })
    expect(read(out, 'pages/_comments.json').html).toContain('nota na raiz')
    expect((read(out, 'pages-index.json') as { path: string }[]).map(e => e.path)).toContain('_comments')
  })

  // Canvas com um nó de texto que traz um bloco dataviewjs (o render de canvas passa o texto
  // dos nós pelo `renderBody`, que roda dataviewjs).
  const canvas = (marca: string) =>
    JSON.stringify({
      nodes: [{ id: '1', type: 'text', text: dvjs(marca), x: 0, y: 0, width: 200, height: 100 }],
      edges: [],
    })

  it('.canvas em _comments/ não vira página, não roda dataviewjs e link para ele é morto', async () => {
    write('_comments/x.canvas', canvas('MARCA_CANVAS'))
    write('Notas/Liga.md', 'veja [[_comments/x]]')
    const out = path.join(TMP, 'out')
    await buildVault(vault, { dataRoot: out })
    const liga: string = read(out, 'pages/Notas/Liga.json').html
    expect(liga).toContain('<span class="vault-dead-link">_comments/x</span>')
    expect(liga).not.toContain('href="/vault/v/_comments')
    semRastro(out, '_comments/x', 'MARCA_CANVAS')
  })

  it('.canvas em _Comments/ (outra caixa, mais fundo) também fica fora de tudo', async () => {
    // Sem a pasta `_comments/` do vault de base, pelo mesmo motivo do teste do `.md`.
    fs.rmSync(path.join(TMP, 'vault', '_comments'), { recursive: true })
    write('_Comments/a/b/y.canvas', canvas('MARCA_CANVAS_FUNDO'))
    const out = path.join(TMP, 'out')
    await buildVault(vault, { dataRoot: out })
    semRastro(out, '_Comments/a/b/y', 'MARCA_CANVAS_FUNDO')
    expect(fs.existsSync(path.join(out, 'v', 'pages', '_Comments'))).toBe(false)
  })

  it('controle: o mesmo canvas fora de _comments/ vira página e roda o dataviewjs', async () => {
    write('Notas/z.canvas', canvas('MARCA_CANVAS'))
    const out = path.join(TMP, 'out')
    await buildVault(vault, { dataRoot: out })
    expect(executados().filter(c => c.includes('MARCA_CANVAS'))).toHaveLength(1)
    expect(read(out, 'pages/Notas/z.json').html).toContain('<p>MARCA_CANVAS</p>')
    expect((read(out, 'pages-index.json') as { path: string }[]).map(e => e.path)).toContain('Notas/z')
  })

  it('Notas/_comments/w.canvas continua gerando página', async () => {
    write('Notas/_comments/w.canvas', canvas('MARCA_CANVAS_W'))
    const out = path.join(TMP, 'out')
    await buildVault(vault, { dataRoot: out })
    expect(read(out, 'pages/Notas/_comments/w.json').html).toContain('<p>MARCA_CANVAS_W</p>')
    expect((read(out, 'pages-index.json') as { path: string }[]).map(e => e.path)).toContain('Notas/_comments/w')
  })

  it('o Dataview continua vendo os ignorados de _comments/', async () => {
    write('_comments/Contagem/ignorado.md', yamlQuebrado('MARCA_CONTAGEM'))
    write('_comments/Contagem/valido.md', comentario('Notas/Minha Nota', '', 'válido'))
    write(
      'Notas/Conta.md',
      '```dataviewjs\n' +
        'dv.paragraph("VISTOS=" + dv.pages(\'"_comments/Contagem"\').map(p => p.file.path).sort().join(","))\n' +
        '```\n',
    )
    const out = path.join(TMP, 'out')
    await buildVault(vault, { dataRoot: out })
    expect(read(out, 'pages/Notas/Conta.json').html).toContain(
      '<p>VISTOS=_comments/Contagem/ignorado,_comments/Contagem/valido</p>',
    )
    expect(executados().filter(c => c.includes('MARCA_CONTAGEM'))).toEqual([])
  })
})
