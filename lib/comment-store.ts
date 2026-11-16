// Escrita de comentários no vault: criar, editar e apagar arquivos dentro de
// `<vault>/_comments/`, e só ali. É a única parte do viewer que escreve no vault.
//
// O que este módulo garante:
//   - o frontmatter é sempre gerado aqui, com os textos entre aspas JSON (que é YAML
//     válido): nada do que o usuário manda vira YAML;
//   - o arquivo novo só aparece no nome final já inteiro e nunca sobrescreve outro;
//   - a edição troca o arquivo de uma vez (temporário + `rename`);
//   - todo caminho que vem de fora passa pelo `safePagePath` e pela checagem canônica
//     (`scannedVaultFile`), e a pasta de destino não pode passar por link;
//   - as escritas de um vault rodam uma de cada vez (`withVaultLock`), para o "conferir a
//     versão e gravar" do editar e a cascata do apagar não se cruzarem.
import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import { randomBytes, randomInt } from 'crypto'
import { setTimeout as sleep } from 'timers/promises'
import matter from 'gray-matter'
import type { VaultConfig } from '@/types'
import type { PageComment, PageMeta } from '@/builder/types'
import { isInCommentsFolder, noteFamilyFields, parentRef } from '@/builder/note-family'
import { commentTime, toPageComment } from '@/builder/comments'
import { renderComment, type CommentRenderOptions } from '@/builder/comment-render'
import { LinkResolver } from '@/builder/link-resolver'
import { isScannedPath, scanCanvases, scanVault } from '@/builder/scanner'
import { loadVaultIgnore, type VaultIgnore } from '@/builder/vault-ignore'
import { commentVersion } from '@/lib/comment-version'
import { safePagePath, scannedVaultFile } from '@/lib/pending-page'
import { pageFilePath } from '@/lib/vault'

export const MAX_COMMENT_CHARS = 10_000
const COMMENTS_DIR = '_comments'
const NAME_ATTEMPTS = 10
// Uma cadeia de `parent` escrita à mão pode ser longa ou circular; a subida para aqui.
const MAX_CHAIN = 50

// Erro com o status HTTP que a rota devolve. `extra` vai junto no corpo da resposta.
export class CommentError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message)
  }
}

// Relógio e sorteio trocáveis nos testes (colisão de nome, datas fixas).
export const commentHooks = {
  now: (): Date => new Date(),
  suffix: (): string => {
    const abc = 'abcdefghijklmnopqrstuvwxyz0123456789'
    return Array.from({ length: 4 }, () => abc[randomInt(abc.length)]).join('')
  },
}

// ─── Texto do arquivo ─────────────────────────────────────────────────────────

const pad = (n: number, len = 2): string => String(n).padStart(len, '0')

// ISO 8601 com o offset do servidor, sem milissegundos: `2026-11-16T15:30:12-03:00`.
export function isoWithOffset(d: Date): string {
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const abs = Math.abs(off)
  return (
    `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  )
}

// Texto entre aspas JSON, que o YAML lê como texto entre aspas duplas. O JSON já escapa
// aspas, barra invertida e controles C0; os demais caracteres que o YAML trata como quebra
// de linha ou não imprimível saem como `\uXXXX`.
const BACKSLASH = String.fromCharCode(92)

function yamlString(s: string): string {
  let out = ''
  for (const ch of JSON.stringify(s)) {
    const code = ch.charCodeAt(0)
    const escape = (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029 || code === 0xfeff
    out += escape ? `${BACKSLASH}u${code.toString(16).padStart(4, '0')}` : ch
  }
  return out
}

// `parent` como o builder vai ler (`parentRef`): com colchetes quando o caminho sobrevive a
// eles; sem colchetes quando tem `#` ou `]`; `null` quando nenhum dos dois devolve o caminho
// (por exemplo um arquivo `Nota.md.md`).
function parentValue(ref: string): string | null {
  for (const v of [`[[${ref}]]`, ref]) if (parentRef(v) === ref) return v
  return null
}

export interface CommentFields {
  parent: string // caminho no vault, sem `.md`
  author: string
  createdAt: Date | null
  updatedAt: Date | null
  // Só na edição: o `parent` como está escrito no arquivo, mantido tal qual.
  rawParent?: string
  // Só na edição: as chaves que não são do servidor, escritas à mão, que a edição mantém.
  extra?: Record<string, unknown>
}

// As chaves que o servidor escreve. Qualquer outra é "extra".
const SERVER_KEYS = new Set(['note_type', 'parent', 'author', 'created_at', 'updated_at'])

// As chaves extras em YAML, pelo serializador do gray-matter (o `safeDump` do js-yaml, que
// põe aspas no que precisa). `''` sem extras.
function extraYaml(extra: Record<string, unknown> | undefined): string {
  if (!extra || Object.keys(extra).length === 0) return ''
  const dumped = matter.stringify('', extra).split('\n')
  const end = dumped.lastIndexOf('---')
  if (dumped[0] !== '---' || end <= 1) throw new Error('frontmatter extra não serializável')
  return dumped.slice(1, end).join('\n')
}

export function serializeComment(f: CommentFields, body: string): string {
  const parent = f.rawParent ?? parentValue(f.parent)
  if (parent === null) throw new CommentError(400, 'Caminho de nota não suportado')
  const lines = ['---', 'note_type: comment', `parent: ${yamlString(parent)}`, `author: ${yamlString(f.author)}`]
  if (f.createdAt) lines.push(`created_at: ${isoWithOffset(f.createdAt)}`)
  if (f.updatedAt) lines.push(`updated_at: ${isoWithOffset(f.updatedAt)}`)
  const extra = extraYaml(f.extra)
  if (extra) lines.push(extra)
  lines.push('---')
  return `${lines.join('\n')}\n${body}\n`
}

// Corpo como vai para o disco: quebras de linha em `\n` e sem espaço nas pontas (o builder
// lê com trim). `null` se não for texto; quem chama confere vazio e tamanho.
export function normalizeBody(v: unknown): string | null {
  return typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim() : null
}

// Nome do arquivo: `<AAAA-MM-DD HHmmss> <username>-<4 caracteres>`, na hora do servidor. O
// username entra sem os caracteres que não cabem num nome de arquivo; o `author` do
// frontmatter guarda o original.
export function commentFileName(now: Date, username: string, suffix: string): string {
  const stamp =
    `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const clean = username.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+/, '_').trim()
  // Corte por caractere, não por unidade UTF-16: metade de um emoji não é nome de arquivo.
  const user = Array.from(clean).slice(0, 40).join('').trim() || 'user'
  return `${stamp} ${user}-${suffix}`
}

// ─── Trava do Windows e escrita atômica ───────────────────────────────────────

// Códigos com que o Windows recusa um arquivo que outro programa segura naquele instante
// (antivírus, indexador, o serviço de sincronização, o próprio build lendo).
const LOCKED = new Set(['EPERM', 'EBUSY', 'EACCES'])
const RETRY_DELAYS_MS = [10, 20, 40, 80, 160]

const codeOf = (e: unknown): string => (e as NodeJS.ErrnoException | undefined)?.code ?? ''

// Repete `op` enquanto a recusa for de trava; qualquer outro erro sai na hora.
async function overLocks<T>(op: () => Promise<T>): Promise<T> {
  for (const delay of RETRY_DELAYS_MS) {
    try {
      return await op()
    } catch (e) {
      if (!LOCKED.has(codeOf(e))) throw e
    }
    await sleep(delay)
  }
  return op()
}

// Temporário na mesma pasta: começa com ponto e não termina em `.md`, então nem o scanner
// nem o Obsidian o tomam por nota.
const tempPath = (file: string): string =>
  path.join(path.dirname(file), `.${path.basename(file)}.${randomBytes(6).toString('hex')}.tmp`)

// Apaga o temporário, insistindo sob trava (um antivírus costuma segurar o arquivo recém
// escrito). Se não sair, fica: começa com ponto e ninguém o lê.
const dropTemp = (temp: string): Promise<void> =>
  overLocks(() => fsp.unlink(temp)).catch(() => undefined)

// Cria `file` já inteiro e sem sobrescrever. `false` = o nome já existe (sorteie outro).
// O conteúdo vai para um temporário e o nome final nasce com `link`, que é atômico e falha
// se o destino existe. Num disco sem hard link (exFAT, alguns compartilhamentos) o plano B
// reserva o nome com `wx` e renomeia o temporário por cima: o nome final fica vazio por um
// instante, e arquivo vazio em `_comments/` o builder ignora.
async function writeNewFile(file: string, content: string): Promise<boolean> {
  const temp = tempPath(file)
  await fsp.writeFile(temp, content, { encoding: 'utf8', flag: 'wx' })
  try {
    try {
      await fsp.link(temp, file)
      return true
    } catch (e) {
      if (codeOf(e) === 'EEXIST') return false
    }
    try {
      await (await fsp.open(file, 'wx')).close()
    } catch (e) {
      if (codeOf(e) === 'EEXIST') return false
      throw e
    }
    try {
      await overLocks(() => fsp.rename(temp, file))
      return true
    } catch (e) {
      await fsp.unlink(file).catch(() => undefined)
      throw e
    }
  } finally {
    await dropTemp(temp)
  }
}

// Troca o conteúdo de `file` de uma vez: ou fica o antigo inteiro, ou o novo inteiro.
async function replaceFile(file: string, content: string): Promise<void> {
  const temp = tempPath(file)
  try {
    await fsp.writeFile(temp, content, { encoding: 'utf8', flag: 'wx' })
    await overLocks(() => fsp.rename(temp, file))
  } catch (e) {
    await dropTemp(temp)
    throw e
  }
}

// Cria `<vault>/<relDir>` (que começa em `_comments`) segmento a segmento. Um segmento que
// já existe tem de ser pasta comum: link ou junção levaria a escrita para fora do vault.
// Devolve o caminho absoluto canônico.
function ensureCommentDir(vaultPath: string, relDir: string): string {
  const realRoot = fs.realpathSync.native(vaultPath)
  const refuse = () => new CommentError(409, 'A pasta de comentários do vault não é uma pasta comum')
  let cur = realRoot
  for (const seg of relDir.split('/')) {
    cur = path.join(cur, seg)
    let st: fs.Stats | null = null
    try {
      st = fs.lstatSync(cur)
    } catch (e) {
      if (codeOf(e) !== 'ENOENT') throw e
    }
    if (st === null) {
      try {
        fs.mkdirSync(cur)
        continue
      } catch (e) {
        if (codeOf(e) !== 'EEXIST') throw e
        st = fs.lstatSync(cur)
      }
    }
    if (!st.isDirectory()) throw refuse()
  }
  const real = fs.realpathSync.native(cur)
  const canon = path.relative(realRoot, real).split(path.sep).join('/')
  if (canon.toLowerCase() !== relDir.toLowerCase()) throw refuse()
  return real
}

// ─── Leitura e resolução ──────────────────────────────────────────────────────

interface Note {
  path: string // canônico, sem `.md`
  abs: string
  frontmatter: Record<string, unknown>
  body: string
}

// Nota `.md` do vault pelo caminho sem extensão; `null` se o caminho é inseguro, não
// existe, o scanner não a visitaria ou não é o caminho canônico do arquivo.
function findNote(vault: VaultConfig, ig: VaultIgnore, ref: string): Note | null {
  if (!safePagePath(ref)) return null
  const file = scannedVaultFile(vault.path, `${ref}.md`, ig)
  // Extensão em minúsculas, como o scanner exige: um `x.MD` o build não vê.
  if (!file || !file.rel.endsWith('.md')) return null
  return readNote(file.abs, file.rel.slice(0, -3))
}

// O gray-matter escolhe o motor pelo nome depois do `---`, e o de JavaScript roda o
// frontmatter com `eval`. Aqui só YAML: qualquer outro motor é frontmatter ilegível.
const refuseEngine = (): never => {
  throw new Error('motor de frontmatter não aceito')
}
const YAML_ONLY = { engines: { javascript: refuseEngine, coffee: refuseEngine, json: refuseEngine } }

// Lê como o builder lê (CRLF → LF, frontmatter pelo gray-matter, corpo com trim), mas só
// YAML. Frontmatter ilegível vira `{}` com o arquivo inteiro como corpo, como no
// `extractFrontmatter`. `null` se o arquivo sumiu.
function readNote(abs: string, notePath: string): Note | null {
  let raw: string
  try {
    raw = fs.readFileSync(abs, 'utf-8').replace(/\r\n/g, '\n')
  } catch (e) {
    if (codeOf(e) === 'ENOENT') return null
    throw e
  }
  try {
    const parsed = matter(raw, YAML_ONLY)
    const data: unknown = parsed.data
    if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error('frontmatter não é um mapa')
    return { path: notePath, abs, frontmatter: data as Record<string, unknown>, body: parsed.content.trim() }
  } catch {
    return { path: notePath, abs, frontmatter: {}, body: raw.trim() }
  }
}

// Comentário para a API: `note_type: comment` com um `parent` em texto.
function isComment(n: Note): boolean {
  return noteFamilyFields(n.frontmatter).noteType === 'comment' && parentRef(n.frontmatter.parent) !== null
}

const sameNote = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

// Sobe por `parent` como o `groupComments` do builder: enquanto o alvo é comentário, sobe;
// o último comentário da cadeia é o principal e o alvo dele é a mãe. `mother` é `null`
// para um órfão: `parent` que não resolve, ciclo, ou alvo dentro de `_comments/` que não é
// comentário.
function climb(vault: VaultConfig, ig: VaultIgnore, start: Note): { principal: Note; mother: string | null } {
  const seen = [start.path]
  let cur = start
  for (let i = 0; i < MAX_CHAIN; i++) {
    const ref = parentRef(cur.frontmatter.parent)
    const next = ref ? findNote(vault, ig, ref) : null
    if (!next || seen.some(p => sameNote(p, next.path))) break
    if (!isComment(next)) return { principal: cur, mother: isInCommentsFolder(next.path) ? null : next.path }
    seen.push(next.path)
    cur = next
  }
  return { principal: cur, mother: null }
}

// A nota existe no build e é comentável (tem Propriedades e não é aba de uma barra).
function isCommentableInBuild(vault: VaultConfig, notePath: string): 'ok' | 'not-built' | 'not-commentable' {
  const file = pageFilePath(vault.slug, notePath)
  if (!file) return 'not-built'
  try {
    const page = JSON.parse(fs.readFileSync(file, 'utf-8')) as PageMeta
    return page.commentable === true ? 'ok' : 'not-commentable'
  } catch {
    return 'not-built'
  }
}

// O mesmo `LinkResolver` do build (`builder/pipeline.ts`): as notas e os canvases que o
// scanner visita, sem os canvases de `_comments/`. Com outro conjunto, o HTML devolvido
// aqui sairia diferente do que o build grava logo depois.
function renderOptions(vault: VaultConfig, ig: VaultIgnore): CommentRenderOptions {
  const resolver = new LinkResolver([
    ...scanVault(vault.path, ig),
    ...scanCanvases(vault.path, ig).filter(c => !isInCommentsFolder(c.relativePath)),
  ])
  return { vaultSlug: vault.slug, resolveLink: t => resolver.resolve(t) }
}

const toComment = (n: Note, opts: CommentRenderOptions): PageComment =>
  toPageComment({ path: n.path, frontmatter: n.frontmatter, body: n.body }, opts)

// Alvo do editar e do apagar: um comentário existente dentro de `_comments/`.
function commentTarget(vault: VaultConfig, ig: VaultIgnore, p: string, invalidStatus = 404): Note {
  if (!safePagePath(p) || !isInCommentsFolder(p)) throw new CommentError(400, 'Caminho de comentário inválido')
  const note = findNote(vault, ig, p)
  if (!note || !isInCommentsFolder(note.path)) throw new CommentError(404, 'Comentário não encontrado')
  if (!isComment(note)) {
    throw new CommentError(
      invalidStatus,
      invalidStatus === 404 ? 'Comentário não encontrado' : 'O arquivo não é um comentário válido',
    )
  }
  return note
}

// Autoria para editar e apagar: o `author` do arquivo igual ao username, sem trim (um
// usuário `ana` não é o autor do que `" ana"` escreveu).
function isAuthor(n: Note, username: string): boolean {
  const a = n.frontmatter.author
  return (typeof a === 'string' || typeof a === 'number') && String(a) === username
}

// Erro que aconteceu depois de o disco já ter mudado: leva a mãe, para a rota pedir o build
// mesmo respondendo erro (senão a página ficaria velha até a próxima escrita).
const WROTE = Symbol('comment-wrote')

function afterWrite(e: unknown, mother: string | null): unknown {
  if (typeof e === 'object' && e !== null) (e as { [WROTE]?: { mother: string | null } })[WROTE] = { mother }
  return e
}

// `undefined` se o erro não veio depois de uma escrita; senão a mãe (ou `null`).
export function wroteMother(e: unknown): string | null | undefined {
  return typeof e === 'object' && e !== null ? (e as { [WROTE]?: { mother: string | null } })[WROTE]?.mother : undefined
}

function parseTime(v: unknown): Date | null {
  const iso = commentTime(v)
  return iso === null ? null : new Date(iso)
}

// ─── Fila por vault ───────────────────────────────────────────────────────────

// Em `globalThis` pelo mesmo motivo do estado do build (`lib/rebuild.ts`): uma variável de
// módulo pode existir em mais de uma cópia no mesmo processo.
const LOCK_KEY = Symbol.for('vault-viewer.comment-locks')
type GlobalWithLocks = typeof globalThis & { [LOCK_KEY]?: Map<string, Promise<void>> }

function withVaultLock<T>(slug: string, fn: () => Promise<T>): Promise<T> {
  const g = globalThis as GlobalWithLocks
  const locks = (g[LOCK_KEY] ??= new Map<string, Promise<void>>())
  const run = (locks.get(slug) ?? Promise.resolve()).then(fn, fn)
  const tail = run.then(
    () => undefined,
    () => undefined,
  )
  locks.set(slug, tail)
  void tail.then(() => {
    if (locks.get(slug) === tail) locks.delete(slug)
  })
  return run
}

// ─── Operações ────────────────────────────────────────────────────────────────

export interface CreatedComment {
  comment: PageComment
  // Caminho do comentário principal quando é resposta; `null` quando é principal.
  replyTo: string | null
  mother: string
}

// Cria um comentário em `parent` (uma nota comentável) ou uma resposta a `parent` (um
// comentário). Responder uma resposta grava o `parent` do principal da conversa.
// `body` já vem normalizado e conferido.
export function createComment(
  vault: VaultConfig,
  input: { parent: string; body: string; author: string },
): Promise<CreatedComment> {
  return withVaultLock(vault.slug, async () => {
    if (!safePagePath(input.parent)) throw new CommentError(400, 'Caminho inválido')
    const ig = loadVaultIgnore(vault.path)
    const target = findNote(vault, ig, input.parent)
    if (!target) throw new CommentError(404, 'Nota ou comentário não encontrado')

    let mother: string
    let replyTo: string | null = null
    if (isComment(target)) {
      const chain = climb(vault, ig, target)
      if (chain.mother === null) throw new CommentError(400, 'O comentário não está ligado a uma nota')
      mother = chain.mother
      replyTo = chain.principal.path
    } else {
      if (isInCommentsFolder(target.path)) throw new CommentError(404, 'Nota ou comentário não encontrado')
      mother = target.path
    }

    const built = isCommentableInBuild(vault, mother)
    if (built === 'not-built') throw new CommentError(404, 'Nota não encontrada')
    if (built === 'not-commentable') throw new CommentError(400, 'A nota não aceita comentários')

    const relDir = `${COMMENTS_DIR}/${mother}`
    const now = commentHooks.now()
    const content = serializeComment(
      { parent: replyTo ?? mother, author: input.author, createdAt: now, updatedAt: null },
      input.body,
    )

    // Conferido antes de criar qualquer pasta: nome seguro e visível para o build.
    const names = Array.from({ length: NAME_ATTEMPTS }, () =>
      commentFileName(now, input.author, commentHooks.suffix()),
    )
    for (const name of names) {
      const rel = `${relDir}/${name}`
      if (!safePagePath(rel)) throw new CommentError(400, 'Caminho de nota não suportado')
      if (!isScannedPath(`${rel}.md`, ig)) {
        throw new CommentError(409, 'A pasta de comentários está escondida pelo .viewerignore')
      }
    }

    // Renderizado antes de criar pasta ou gravar: um render que lança sai daqui com o disco
    // intacto (500 sem build). As mesmas opções servem para ler de volta depois de gravar: o
    // arquivo novo entra no conjunto do build, mas o nome dele (com sufixo sorteado) não é
    // alvo de link nenhum do corpo.
    const opts = renderOptions(vault, ig)
    renderComment(input.body, opts)

    const dir = ensureCommentDir(vault.path, relDir)
    for (const name of names) {
      const abs = path.join(dir, `${name}.md`)
      if (!(await writeNewFile(abs, content))) continue
      const note = findNote(vault, ig, `${relDir}/${name}`)
      if (!note || !isInCommentsFolder(note.path)) {
        // O arquivo não ficou onde devia (apelido de caminho do Windows): desfaz.
        await fsp.unlink(abs).catch(() => undefined)
        throw new CommentError(400, 'Caminho de nota não suportado')
      }
      try {
        return { comment: toComment(note, opts), replyTo, mother }
      } catch (e) {
        throw afterWrite(e, mother)
      }
    }
    throw new CommentError(500, 'Não foi possível criar o arquivo do comentário')
  })
}

export interface EditedComment {
  comment: PageComment
  mother: string | null
}

// Edita o corpo de um comentário. Só o autor; `version` é a `commentVersion` do comentário
// que o cliente leu, e a edição é recusada (409, com o comentário atual) se o arquivo mudou
// desde então. O frontmatter é regravado pelo serializador, mantendo `parent`, `author` e as
// chaves extras escritas à mão. Um arquivo que não é um comentário válido (frontmatter
// ilegível, `note_type` ou `parent` trocados) é recusado com 422, sem regravar.
export function editComment(
  vault: VaultConfig,
  input: { path: string; body: string; version: string; username: string },
): Promise<EditedComment> {
  return withVaultLock(vault.slug, async () => {
    const ig = loadVaultIgnore(vault.path)
    const note = commentTarget(vault, ig, input.path, 422)
    if (!isAuthor(note, input.username)) throw new CommentError(403, 'Só o autor edita o comentário')
    const mother = climb(vault, ig, note).mother

    const opts = renderOptions(vault, ig)
    const createdAt = parseTime(note.frontmatter.created_at)
    const current = {
      body: note.body,
      createdAt: commentTime(note.frontmatter.created_at),
      updatedAt: commentTime(note.frontmatter.updated_at),
    }
    if (commentVersion(current) !== input.version) {
      throw new CommentError(409, 'O comentário mudou desde que foi aberto', {
        comment: toComment(note, opts),
      })
    }

    const extra: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(note.frontmatter)) if (!SERVER_KEYS.has(k)) extra[k] = v
    const rawParent = note.frontmatter.parent
    let content: string
    try {
      content = serializeComment(
        {
          parent: parentRef(rawParent)!,
          author: input.username,
          createdAt,
          updatedAt: commentHooks.now(),
          rawParent: typeof rawParent === 'string' ? rawParent : undefined,
          extra,
        },
        input.body,
      )
    } catch (e) {
      if (e instanceof CommentError) throw e
      throw new CommentError(422, 'O frontmatter do comentário não pôde ser regravado')
    }
    // Renderizado antes de gravar, como no criar: um render que lança deixa o arquivo como
    // estava (500 sem build).
    renderComment(input.body, opts)
    await replaceFile(note.abs, content)

    try {
      const after = readNote(note.abs, note.path)
      if (!after) throw new CommentError(404, 'Comentário não encontrado')
      return { comment: toComment(after, opts), mother }
    } catch (e) {
      throw afterWrite(e, mother)
    }
  })
}

// Todos os `.md` dentro de `dir`, sem entrar em entrada com ponto nem em link.
function listMarkdown(dir: string, rel: string, out: { abs: string; path: string }[]): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch (e) {
    if (codeOf(e) === 'ENOENT') return
    throw e
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) listMarkdown(abs, `${rel}/${entry.name}`, out)
    else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push({ abs, path: `${rel}/${entry.name.slice(0, -3)}` })
    }
  }
}

async function removeFile(abs: string): Promise<boolean> {
  try {
    await overLocks(() => fsp.unlink(abs))
    return true
  } catch (e) {
    if (codeOf(e) === 'ENOENT') return false
    throw e
  }
}

// Remove as pastas que ficaram vazias, de `dir` para cima, sem chegar a `stop`.
function pruneEmptyDirs(dir: string, stop: string): void {
  let cur = dir
  while (cur.length > stop.length && cur.toLowerCase().startsWith(stop.toLowerCase() + path.sep)) {
    try {
      fs.rmdirSync(cur)
    } catch {
      return
    }
    cur = path.dirname(cur)
  }
}

export interface DeletedComment {
  // Arquivos removidos, contando o próprio comentário.
  deleted: number
  mother: string | null
}

// Apaga um comentário: o autor, ou um admin. Apagar um principal apaga junto as respostas
// dele que estão em `_comments/` (todo comentário cuja cadeia de `parent` sobe até ele);
// apagar uma resposta apaga só o arquivo dela. As respostas saem antes do principal: se
// algo falhar no meio, o que sobrou continua numa conversa visível.
export function deleteComment(
  vault: VaultConfig,
  input: { path: string; username: string; isAdmin: boolean },
): Promise<DeletedComment> {
  return withVaultLock(vault.slug, async () => {
    const ig = loadVaultIgnore(vault.path)
    const note = commentTarget(vault, ig, input.path)
    if (!input.isAdmin && !isAuthor(note, input.username)) {
      throw new CommentError(403, 'Só o autor ou um admin apaga o comentário')
    }

    const chain = climb(vault, ig, note)
    const commentsRoot = path.join(fs.realpathSync.native(vault.path), note.path.split('/')[0])
    const targets: string[] = []
    if (sameNote(chain.principal.path, note.path)) {
      const files: { abs: string; path: string }[] = []
      listMarkdown(commentsRoot, note.path.split('/')[0], files)
      for (const f of files) {
        if (sameNote(f.path, note.path) || !isScannedPath(`${f.path}.md`, ig)) continue
        const other = readNote(f.abs, f.path)
        if (!other || !isComment(other)) continue
        if (sameNote(climb(vault, ig, other).principal.path, note.path)) targets.push(f.abs)
      }
    }
    targets.push(note.abs)

    let deleted = 0
    try {
      for (const abs of targets) if (await removeFile(abs)) deleted++
    } catch (e) {
      throw deleted > 0 ? afterWrite(e, chain.mother) : e
    }
    for (const abs of targets) pruneEmptyDirs(path.dirname(abs), commentsRoot)
    return { deleted, mother: chain.mother }
  })
}
